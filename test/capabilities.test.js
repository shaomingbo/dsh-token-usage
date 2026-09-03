import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { OAuthCredentialFileStore, parseOAuthDocument } from '../lib/capabilities/chatgpt-grok/oauth-store.js'
import { chatGptGrokEnvelopeOutcome } from '../lib/capabilities/chatgpt-grok/capability.js'
import { AuthStore, parseAuthDocument } from '../lib/capabilities/antigravity/auth-store.js'
import { antigravityEnvelopeOutcome } from '../lib/capabilities/antigravity/capability.js'
import { createAccountRouter, isQuotaExhaustion } from '../lib/capabilities/antigravity/account-router.js'
import { createProxy } from '../lib/capabilities/antigravity/proxy.js'
import { attributedResponseId, connectionIdFromAssistantSource } from '../lib/capabilities/antigravity/response-provenance.js'
import {
  antigravityRoutePatch,
  antigravityRouteNeedsProvisioning,
  ensureAntigravityRoute,
} from '../lib/capabilities/antigravity/capability.js'
import { OwnerFileStore } from '../lib/capabilities/owner-file-store.js'
import { createCapabilityEnvelope } from '../lib/capabilities/rpc-envelope.js'

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

test('Owner file store load distinguishes missing, invalid, and valid documents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cap-kernel-'))
  const filename = join(root, 'doc.json')
  const invalid = []
  const store = new OwnerFileStore({
    path: filename,
    parse: text => {
      const value = JSON.parse(text)
      if (value.broken === true) throw new Error('rejected document')
      return value
    },
    onInvalid: error => invalid.push(error),
  })
  assert.equal(await store.load(), null)
  await writeFile(filename, '{"broken":true}', 'utf8')
  assert.equal(await store.load(), undefined)
  assert.equal(invalid.length, 1)
  await writeFile(filename, '{"answer":42}', 'utf8')
  assert.deepEqual(await store.load(), { answer: 42 })
})

test('Owner file store serializes operations and isolates their failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cap-kernel-'))
  const store = new OwnerFileStore({ path: join(root, 'queue.json'), parse: JSON.parse })
  const order = []
  const first = store.enqueue(async () => {
    order.push('first')
    return 'one'
  })
  const second = store.enqueue(async () => {
    order.push('second')
    throw new Error('boom')
  })
  const third = store.enqueue(async () => {
    order.push('third')
    return 'three'
  })
  assert.deepEqual(await Promise.all([
    first,
    second.then(() => 'resolved', error => error.message),
    third,
  ]), ['one', 'boom', 'three'])
  assert.deepEqual(order, ['first', 'second', 'third'])
  await store.close()
})

test('Owner file store drains queued operations on close and rejects new ones', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cap-kernel-'))
  const store = new OwnerFileStore({ path: join(root, 'close.json'), parse: JSON.parse })
  const pending = store.enqueue(async () => 'drained')
  await store.close()
  assert.equal(await pending, 'drained')
  await assert.rejects(store.enqueue(async () => 'late'), /closed/)
  await store.close()
})

test('Owner file store commits with owner-only modes and legacy bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cap-kernel-'))
  const directory = join(root, 'private')
  const filename = join(directory, 'doc.json')
  const store = new OwnerFileStore({ path: filename, parse: JSON.parse })
  await store.commit({ value: 1 })
  assert.equal(await readFile(filename, 'utf8'), '{\n  "value": 1\n}\n')
  if (process.platform !== 'win32') {
    assert.equal(await mode(directory), 0o700)
    assert.equal(await mode(filename), 0o600)
  }
  await store.close()
})

test('Owner file store cleans up the temp file when the atomic rename fails', async () => {
  if (process.platform === 'win32') return
  const root = await mkdtemp(join(tmpdir(), 'dsh-cap-kernel-'))
  const filename = join(root, 'occupied')
  await mkdir(filename)
  const store = new OwnerFileStore({ path: filename, parse: JSON.parse })
  await assert.rejects(store.commit({ value: 1 }))
  assert.deepEqual((await readdir(root)).filter(name => name.includes('.tmp-')), [])
})

test('Capability envelope degrades unknown errors and never leaks provider details', () => {
  const envelope = createCapabilityEnvelope({
    cancelledCodes: ['TEST_ABORTED'],
    credentialCodes: ['TEST_AUTH_FAILED'],
  })
  assert.deepEqual(envelope.success(42), { ok: true, value: 42 })
  assert.deepEqual(envelope.failure('boom'), {
    ok: false, error: { code: 'internal', message: 'boom', details: {} },
  })
  assert.deepEqual(envelope.failure('boom', 'SOME_CODE', { token: 'secret' }), {
    ok: false, error: { code: 'internal', message: '[SOME_CODE] boom', details: {} },
  })
  assert.deepEqual(envelope.failure('stopped', 'TEST_ABORTED', { token: 'secret' }), {
    ok: false, error: { code: 'cancelled', message: '[TEST_ABORTED] stopped', details: {} },
  })
  assert.deepEqual(envelope.failure('rejected', 'TEST_AUTH_FAILED', { ref: 'TEST_REF', access: 'secret' }), {
    ok: false, error: { code: 'credential-rejected', message: '[TEST_AUTH_FAILED] rejected', details: { ref: 'TEST_REF' } },
  })
  assert.equal(envelope.failure('rejected', 'TEST_AUTH_FAILED', { ref: 42 }).error.code, 'internal')
  assert.equal(envelope.failure('rejected', 'TEST_AUTH_FAILED').error.code, 'internal')
})

test('Both capability channels declare their own envelope code sets', () => {
  assert.deepEqual(chatGptGrokEnvelopeOutcome('PI_AI_AUTH_ABORTED', {}), { code: 'cancelled', details: {} })
  assert.deepEqual(
    chatGptGrokEnvelopeOutcome('PI_AI_AUTH_RESOLUTION_FAILED', { ref: 'GROK_BUILD_ACCESS_TOKEN', access: 'secret' }),
    { code: 'credential-rejected', details: { ref: 'GROK_BUILD_ACCESS_TOKEN' } },
  )
  assert.deepEqual(chatGptGrokEnvelopeOutcome('PI_AI_AUTH_LOGIN_FAILED', { token: 'secret' }), { code: 'internal', details: {} })
  assert.deepEqual(antigravityEnvelopeOutcome('ANTIGRAVITY_LOGIN_ABORTED', {}), { code: 'cancelled', details: {} })
  assert.deepEqual(
    antigravityEnvelopeOutcome('ANTIGRAVITY_AUTH_EXPIRED', { ref: 'ANTIGRAVITY_ACCESS_TOKEN', refresh: 'secret' }),
    { code: 'credential-rejected', details: { ref: 'ANTIGRAVITY_ACCESS_TOKEN' } },
  )
  assert.deepEqual(antigravityEnvelopeOutcome('ANTIGRAVITY_AUTH_NOT_CONFIGURED', { not: 'a ref' }), { code: 'internal', details: {} })
})

test('OAuth credential store keeps its last good snapshot when the file turns invalid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cap-oauth-'))
  const filename = join(root, '.oauth.json')
  const errors = []
  const store = new OAuthCredentialFileStore({ filename, onChanged: () => {}, onError: error => errors.push(error) })
  await store.init()
  await store.modify('openai-codex', () => ({
    type: 'oauth', access: 'access-token', refresh: 'refresh-token', expires: 123456789,
  }))
  await writeFile(filename, '{"version":1,"credentials":{', 'utf8')
  await store.reload()
  assert.equal(errors.length, 1)
  assert.equal(store.get('openai-codex').access, 'access-token')
  await unlink(filename)
  await store.reload()
  assert.equal(store.has('openai-codex'), false)
  await store.dispose()
})

test('Both stores keep their pre-refactor on-disk byte format without temp leftovers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cap-bytes-'))
  const oauthFilename = join(root, '.oauth.json')
  const oauthStore = new OAuthCredentialFileStore({ filename: oauthFilename, onChanged: () => {}, onError: assert.fail })
  await oauthStore.init()
  const oauthCredential = {
    type: 'oauth', access: 'access-token', refresh: 'refresh-token', expires: 123456789,
    accountId: 'account-id',
  }
  await oauthStore.modify('xai', () => oauthCredential)
  assert.equal(
    await readFile(oauthFilename, 'utf8'),
    `${JSON.stringify({ version: 1, credentials: { xai: oauthCredential } }, null, 2)}\n`,
  )
  await oauthStore.dispose()

  const authFilename = join(root, '.antigravity-auth.json')
  const authStore = new AuthStore({ filename: authFilename, onError: assert.fail })
  await authStore.init()
  await authStore.upsertAccount('account-a', {
    type: 'oauth', access: 'access-token', refresh: 'refresh-token', expires: 123456789,
    email: 'user@example.com', projectId: 'project-a', createdAt: 1,
  })
  const account = {
    type: 'oauth', access: 'access-token', refresh: 'refresh-token', expires: 123456789,
    projectId: 'project-a', email: 'user@example.com', createdAt: 1,
  }
  assert.equal(
    await readFile(authFilename, 'utf8'),
    `${JSON.stringify({ version: 2, activeAccountId: 'account-a', autoFailover: false, accounts: { 'account-a': account } }, null, 2)}\n`,
  )
  await authStore.setAutoFailover(true)
  assert.equal(
    await readFile(authFilename, 'utf8'),
    `${JSON.stringify({ version: 2, activeAccountId: 'account-a', autoFailover: true, accounts: { 'account-a': account } }, null, 2)}\n`,
  )
  assert.deepEqual((await readdir(root)).filter(name => name.includes('.tmp-')), [])
  await authStore.dispose()
})
