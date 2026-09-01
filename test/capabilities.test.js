import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { OAuthCredentialFileStore, parseOAuthDocument } from '../lib/capabilities/chatgpt-grok/oauth-store.js'
import { AuthStore, parseAuthDocument } from '../lib/capabilities/antigravity/auth-store.js'
import { createAccountRouter, isQuotaExhaustion } from '../lib/capabilities/antigravity/account-router.js'
import { createProxy } from '../lib/capabilities/antigravity/proxy.js'
import { attributedResponseId, connectionIdFromAssistantSource } from '../lib/capabilities/antigravity/response-provenance.js'
import {
  antigravityRoutePatch,
  antigravityRouteNeedsProvisioning,
  ensureAntigravityRoute,
} from '../lib/capabilities/antigravity/capability.js'

async function mode(path) {
  return (await stat(path)).mode & 0o777
}

test('OAuth credential store preserves .oauth.json schema and owner-only modes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cap-oauth-'))
  const directory = join(root, 'private')
  const filename = join(directory, '.oauth.json')
  const store = new OAuthCredentialFileStore({ filename, onChanged: () => {}, onError: assert.fail })
  await store.init()
  await store.modify('openai-codex', () => ({
    type: 'oauth', access: 'access-token', refresh: 'refresh-token', expires: 123456789,
    accountId: 'account-id',
  }))
  const parsed = parseOAuthDocument(await readFile(filename, 'utf8'))
  assert.equal(parsed.get('openai-codex').accountId, 'account-id')
  if (process.platform !== 'win32') {
    assert.equal(await mode(directory), 0o700)
    assert.equal(await mode(filename), 0o600)
  }
  await store.dispose()
})

test('Antigravity auth store preserves v2 account/failover state and owner-only modes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cap-antigravity-'))
  const directory = join(root, 'private')
  const filename = join(directory, '.antigravity-auth.json')
  const store = new AuthStore({ filename, onError: assert.fail })
  await store.init()
  await store.upsertAccount('account-a', {
    type: 'oauth', access: 'access-token', refresh: 'refresh-token', expires: 123456789,
    email: 'user@example.com', projectId: 'project-a', createdAt: 1,
  })
  await store.setAutoFailover(true)
  const parsed = parseAuthDocument(await readFile(filename, 'utf8'))
  assert.equal(parsed.activeAccountId, 'account-a')
  assert.equal(parsed.autoFailover, true)
  assert.equal(parsed.accounts.get('account-a').projectId, 'project-a')
  if (process.platform !== 'win32') {
    assert.equal(await mode(directory), 0o700)
    assert.equal(await mode(filename), 0o600)
  }
  await store.dispose()
})

test('Antigravity response ids carry only strict plugin-owned connection provenance', () => {
  const responseId = attributedResponseId('connection-b', 'fixture')
  const source = {
    kind: 'model', provider: 'antigravity', model: 'gemini',
    replayState: {
      response: {
        kind: 'pi-ai', version: 2, api: 'openai-completions', provider: 'antigravity', responseId,
      },
    },
  }
  assert.equal(connectionIdFromAssistantSource(source), 'connection-b')
  assert.equal(connectionIdFromAssistantSource({ ...source, connectionId: 'core-compat' }), 'core-compat')
  assert.equal(connectionIdFromAssistantSource({ ...source, provider: 'other' }), undefined)
  assert.equal(connectionIdFromAssistantSource({ ...source, replayState: { response: { ...source.replayState.response, version: 3 } } }), undefined)
  assert.equal(connectionIdFromAssistantSource({ ...source, replayState: { response: { ...source.replayState.response, responseId: `${responseId}.extra` } } }), undefined)
  assert.notEqual(attributedResponseId('connection-b'), attributedResponseId('connection-b'))
  assert.throws(() => attributedResponseId('x'.repeat(201)), /at most 200/)
})

test('Antigravity route patch keeps user models while repairing owned connectivity fields', () => {
  const models = [{ id: 'custom', name: 'Custom' }]
  const proxyUrl = 'http://127.0.0.1:51122/v1'
  const patch = antigravityRoutePatch({ displayName: 'Mine', models }, proxyUrl)
  assert.equal(patch.displayName, 'Mine')
  assert.equal(patch.models, models)
  assert.equal(patch.apiKeyEnv, 'ANTIGRAVITY_ACCESS_TOKEN')
  assert.equal(patch.api, 'openai-completions')
  assert.equal(patch.baseURL, proxyUrl)
  assert.equal('connectionIdHeader' in patch, false)
  assert.deepEqual(patch.compat, { supportsDeveloperRole: false, maxTokensField: 'max_tokens' })
  assert.equal(antigravityRouteNeedsProvisioning(patch, proxyUrl), false)
  assert.equal(antigravityRouteNeedsProvisioning({ ...patch, connectionIdHeader: 'x-dsh-connection-id' }, proxyUrl), true)
})

test('Antigravity route provisioning removes the obsolete core-only header field', async () => {
  const proxyUrl = 'http://127.0.0.1:51122/v1'
  const existing = {
    ...antigravityRoutePatch({}, proxyUrl),
    connectionIdHeader: 'x-dsh-connection-id',
  }
  const calls = []
  const settings = {
    get: () => ({ providers: { antigravity: existing } }),
    mutate: async (namespace, ops) => { calls.push(['mutate', namespace, ops]) },
    update: async (namespace, patch) => { calls.push(['update', namespace, patch]) },
  }
  assert.equal(await ensureAntigravityRoute(settings, proxyUrl), true)
  assert.deepEqual(calls[0], ['mutate', 'llm-pi-ai', [{
    op: 'unset', path: ['providers', 'antigravity', 'connectionIdHeader'],
  }]])
  assert.equal('connectionIdHeader' in calls[1][2].providers.antigravity, false)
})

test('Antigravity proxy identifies the final connection on a successful completion', async t => {
  const upstream = [
    'data: {"response":{"candidates":[{"content":{"parts":[{"text":"hello"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}}',
    '',
  ].join('\n')
  const proxy = createProxy({
    auth: {},
    accountRouter: {
      route: async () => ({
        ok: true,
        accountId: 'connection-b',
        response: new Response(upstream, { headers: { 'content-type': 'text/event-stream' } }),
        retry: async () => assert.fail('unexpected retry'),
      }),
    },
    client: {},
    port: 0,
  })
  await proxy.start()
  t.after(() => proxy.stop())

  const response = await fetch(`${proxy.url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gemini-3.6-flash', messages: [{ role: 'user', content: 'hi' }] }),
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-dsh-connection-id'), null)
  const completion = await response.json()
  assert.match(completion.id, new RegExp(`^chatcmpl-dsh-antigravity-v1\\.${Buffer.from('connection-b').toString('base64url')}\\.`))

  const streamed = await fetch(`${proxy.url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gemini-3.6-flash', messages: [{ role: 'user', content: 'hi' }], stream: true }),
  })
  assert.equal(streamed.status, 200)
  assert.equal(streamed.headers.get('x-dsh-connection-id'), null)
  const streamedBody = await streamed.text()
  assert.match(streamedBody, /hello/)
  assert.match(streamedBody, new RegExp(`chatcmpl-dsh-antigravity-v1\\.${Buffer.from('connection-b').toString('base64url')}\\.`))
})

test('Antigravity proxy does not identify a connection for an in-band stream error', async t => {
  const proxy = createProxy({
    auth: {},
    accountRouter: {
      route: async () => ({
        ok: true,
        accountId: 'connection-a',
        response: new Response('data: {"error":{"message":"upstream failed"}}\n\n'),
        retry: async () => assert.fail('unexpected retry'),
      }),
    },
    client: {},
    port: 0,
  })
  await proxy.start()
  t.after(() => proxy.stop())

  const response = await fetch(`${proxy.url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gemini-3.6-flash', messages: [{ role: 'user', content: 'hi' }], stream: true }),
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-dsh-connection-id'), null)
  assert.match(await response.text(), /upstream failed/)
})

test('Account router fails over only on quota exhaustion and activates successful account', async () => {
  assert.equal(isQuotaExhaustion({ status: 429, text: 'RESOURCE_EXHAUSTED' }), true)
  assert.equal(isQuotaExhaustion({ status: 429, text: 'RATE_LIMIT_EXCEEDED' }), false)
  let active = 'a'
  const activated = []
  const auth = {
    getActiveContext: async () => ({ accountId: active, token: active }),
    getAccountContext: async accountId => ({ accountId, token: accountId }),
    activeAccountId: () => active,
    autoFailoverEnabled: () => true,
    statuses: () => [{ accountId: 'a' }, { accountId: 'b' }],
    activateAccount: async accountId => { active = accountId },
  }
  const router = createAccountRouter({
    auth,
    usage: { remainingFor: () => 1 },
    onActivated: async accountId => activated.push(accountId),
  })
  const outcome = await router.route({
    runtimeModel: 'gemini-3.6-flash-low',
    attempt: async context => context.accountId === 'a'
      ? { ok: false, status: 429, text: 'QUOTA_EXHAUSTED' }
      : { ok: true, response: 'ok' },
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.accountId, 'b')
  assert.equal(outcome.switched, true)
  assert.equal(active, 'b')
  assert.deepEqual(activated, ['b'])
})
