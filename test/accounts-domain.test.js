import test from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../lib/ledger/db.js'
import {
  AccountsError,
  AccountsStore,
  GlmAdapter,
  OllamaCloudAdapter,
  OllamaLocalAdapter,
  ProviderAdapterRegistry,
  allowedCookieHeader,
  normalizeRecord,
  parseOllamaSettings,
  serializePublic,
  toPublicValue,
} from '../lib/accounts/index.js'

const NOW = 1_800_000_000_000

function response({ status = 200, url, json, text }) {
  return {
    status,
    url,
    async json() { return typeof json === 'function' ? json() : json },
    async text() { return typeof text === 'function' ? text() : text },
  }
}

test('canonical records enforce limit modes and window semantics', () => {
  const exact = normalizeRecord('limit', {
    id: 'limit-1', windowId: 'window-1', metric: 'tokens', unit: 'token', mode: 'exact', value: 100, used: 25,
  })
  assert.equal(exact.remaining, null)
  assert.ok(Object.isFrozen(exact))
  assert.deepEqual(normalizeRecord('limit', {
    id: 'range', windowId: 'w', metric: 'requests', unit: 'request', mode: 'range', min: 10, max: 20,
  }).mode, 'range')
  assert.equal(normalizeRecord('limit', {
    id: 'dynamic', windowId: 'w', metric: 'usage', unit: 'percent', mode: 'dynamic', percentUsed: 42,
  }).value, null)
  assert.equal(normalizeRecord('limit', {
    id: 'hidden', windowId: 'w', metric: 'usage', unit: 'unknown', mode: 'unpublished',
  }).mode, 'unpublished')
  assert.equal(normalizeRecord('limit', {
    id: 'manual', windowId: 'w', metric: 'usd', unit: 'usd', mode: 'manual', value: 12,
  }).mode, 'manual')
  assert.throws(() => normalizeRecord('limit', {
    id: 'bad', windowId: 'w', metric: 'x', unit: 'x', mode: 'range', min: 3, max: 2,
  }), /max >= min/)

  for (const window of [
    { id: 'rolling', kind: 'rolling', durationMs: 3_600_000 },
    { id: 'fixed', kind: 'fixed', startsAt: 10, endsAt: 20 },
    { id: 'billing', kind: 'billing', anchorDay: 7, timezone: 'UTC' },
    { id: 'rate', kind: 'rate', durationMs: 60_000 },
  ]) assert.equal(normalizeRecord('window', window).kind, window.kind)
})

test('connections and credential metadata cannot serialize secrets', () => {
  assert.throws(() => normalizeRecord('credential_metadata', {
    id: 'credential-1', kind: 'api_key', apiKey: 'sk-live-secret',
  }), (error) => error instanceof AccountsError && error.code === 'secret-in-public-record')
  assert.throws(() => normalizeRecord('connection', {
    id: 'c', providerId: 'glm', endpoint: 'https://user:pass@api.z.ai/quota',
  }), /must not contain credentials/)

  const publicValue = toPublicValue({
    ok: true,
    authorization: 'secret',
    cookieHeader: 'session=secret',
    nested: {
      api_key: 'secret', rawAuthorization: 'secret', message: 'request included sk-live-secret',
      error: new Error('failed with sk-live-secret'),
    },
  }, { secrets: ['sk-live-secret'] })
  assert.deepEqual(publicValue, { ok: true, nested: { message: '[REDACTED]', error: '[REDACTED]' } })
  assert.throws(() => normalizeRecord('provider_template', {
    id: 'unsafe', providerId: 'x', name: 'unsafe', endpoint: 'https://user:pass@example.com/quota',
  }), /credential-free HTTPS URL/)
  const json = serializePublic(publicValue)
  assert.equal(json.includes('sk-live-secret'), false)
  assert.equal(json.includes('authorization'), false)
})

test('provider registry has one observation seam and redacts adapter output', async () => {
  const registry = new ProviderAdapterRegistry([{
    id: 'fake', credentialKinds: ['token'],
    async observe({ credential }) {
      return {
        id: 'obs', connectionId: 'c', observedAt: NOW, source: 'official_usage_api', complete: true,
        windows: [], limits: [], warnings: [], metadata: { echoed: credential.token },
      }
    },
  }])
  assert.deepEqual(registry.list(), [{ id: 'fake', credentialKinds: ['token'] }])
  const result = await registry.observe('fake', { credential: { token: 'top-secret' } })
  assert.equal(result.metadata.echoed, '[REDACTED]')
  assert.equal(JSON.stringify(result).includes('top-secret'), false)
  await assert.rejects(registry.observe('missing'), (error) => error.code === 'provider-not-registered')
  const leaking = new ProviderAdapterRegistry([{
    id: 'leaking',
    async observe({ credential }) { throw new AccountsError('upstream', credential.token) },
  }])
  await assert.rejects(leaking.observe('leaking', { credential: { token: 'top-secret' } }),
    (error) => error.code === 'upstream' && !error.message.includes('top-secret'))
})

test('GLM uses raw Authorization, redirect:error, confined origin, and partial quota parsing', async () => {
  const calls = []
  const adapter = new GlmAdapter({
    endpoint: 'https://api.z.ai/injected/quota',
    fetch: async (url, init) => {
      calls.push({ url: String(url), init })
      return response({
        status: 200,
        url: 'https://api.z.ai/injected/quota',
        json: {
          code: 200,
          data: {
            limits: [
              { type: 'TOKENS_LIMIT', name: '5 hours', total: 1000, currentValue: 250, nextResetTime: NOW + 1000 },
              {},
            ],
          },
        },
      })
    },
  })
  const result = await adapter.observe({ connection: { id: 'glm-main' }, credential: { rawAuthorization: 'raw-token' }, now: () => NOW })
  assert.equal(calls[0].init.headers.Authorization, 'raw-token')
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(result.limits.length, 1)
  assert.equal(result.limits[0].mode, 'exact')
  assert.equal(result.limits[0].used, 250)
  assert.equal(result.windows[0].durationMs, 5 * 3_600_000)
  assert.equal(result.complete, false)
  assert.equal(result.source, 'official_plugin_internal_api')
  assert.equal(result.brittle, true)
  assert.match(result.warnings[0], /could not be interpreted/)
  assert.equal(JSON.stringify(result).includes('raw-token'), false)

  assert.throws(() => new GlmAdapter({ fetch: async () => {}, endpoint: 'https://evil.example/quota' }), (error) => error.code === 'origin-not-allowed')
  assert.throws(() => new GlmAdapter({ fetch: async () => {} }), (error) => error.code === 'endpoint-required')
})

test('GLM queries official model/tool usage with the official local-time range', async () => {
  const calls = []
  const adapter = new GlmAdapter({
    endpoint: 'https://api.z.ai/api/monitor/usage/quota/limit',
    modelUsageEndpoint: 'https://api.z.ai/api/monitor/usage/model-usage',
    toolUsageEndpoint: 'https://api.z.ai/api/monitor/usage/tool-usage',
    fetch: async (url, init) => {
      const parsed = new URL(url)
      calls.push({ url: parsed, init })
      return response({
        status: 200,
        url: parsed.href,
        json: parsed.pathname.endsWith('/limit')
          ? { code: 200, data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 20 }] } }
          : { code: 200, data: { rows: [{ count: 1 }] } },
      })
    },
  })
  const result = await adapter.observe({ credential: { secret: 'raw-token' }, now: () => Date.UTC(2027, 0, 15, 12, 30) })
  assert.equal(calls.length, 3)
  for (const call of calls) assert.equal(call.init.headers.Authorization, 'raw-token')
  for (const call of calls.slice(1)) {
    assert.match(call.url.searchParams.get('startTime'), /^2027-01-1[45] \d{2}:00:00$/)
    assert.match(call.url.searchParams.get('endTime'), /^2027-01-1[45] \d{2}:59:59$/)
  }
  assert.deepEqual(result.metadata.usage.model, { records: 1, collections: ['rows'] })
  assert.deepEqual(result.metadata.usage.tool, { records: 1, collections: ['rows'] })
})

test('GLM treats HTTP-200 unsuccessful JSON envelopes as safe errors', async () => {
  const secret = 'never-leak-this'
  const adapter = new GlmAdapter({
    endpoint: 'https://api.z.ai/quota',
    fetch: async () => response({ status: 200, url: 'https://api.z.ai/quota', json: { code: 401, message: `bad ${secret}` } }),
  })
  await assert.rejects(
    adapter.observe({ credential: { secret }, now: () => NOW }),
    (error) => error.code === 'provider-envelope-error' && !error.message.includes(secret) && !JSON.stringify(error).includes(secret),
  )
  const successFalse = new GlmAdapter({
    endpoint: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
    fetch: async () => response({ status: 200, url: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit', json: { success: false, code: 200, msg: `bad ${secret}` } }),
  })
  await assert.rejects(successFalse.observe({ credential: { secret } }), error => error.code === 'provider-envelope-error' && !error.message.includes(secret))
})

test('credentialed adapters reject oversized responses before parsing', async () => {
  const adapter = new GlmAdapter({
    endpoint: 'https://api.z.ai/quota',
    fetch: async () => ({ status: 200, url: 'https://api.z.ai/quota', headers: { get: name => name === 'content-length' ? '2000000' : null }, async json() { return {} } }),
  })
  await assert.rejects(adapter.observe({ credential: { secret: 'fixture' } }), error => error.code === 'provider-response-too-large')
})

test('Ollama Local reports quota as not applicable', async () => {
  const result = await new OllamaLocalAdapter().observe({ connection: { id: 'local' }, now: () => NOW })
  assert.equal(result.quotaApplicable, false)
  assert.deepEqual(result.limits, [])
  assert.equal(result.source, 'local_ledger')
})

test('Ollama Cloud validates API keys only against an injected official-origin endpoint', async () => {
  const calls = []
  const adapter = new OllamaCloudAdapter({
    apiKeyValidationEndpoint: 'https://ollama.com/injected/validate',
    apiKeyResponseValidator: (body) => body.authenticated === true,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init })
      return response({ status: 200, url: 'https://ollama.com/injected/validate', json: { authenticated: true, plan: { name: 'Pro' }, token: 'reflected' } })
    },
  })
  const result = await adapter.observe({ connection: { id: 'cloud' }, credential: { kind: 'api_key', secret: 'ollama-secret' }, now: () => NOW })
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ollama-secret')
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(result.product.name, 'Pro')
  assert.equal(result.source, 'official_response')
  assert.equal(result.complete, false)
  assert.equal(result.metadata.cloudEndpointReachable, true)
  assert.equal(result.metadata.credentialStatus, 'unverified')
  assert.equal(JSON.stringify(result).includes('ollama-secret'), false)
  assert.throws(() => new OllamaCloudAdapter({
    fetch: async () => {}, apiKeyValidationEndpoint: 'https://example.com/validate',
  }), (error) => error.code === 'origin-not-allowed')
})

test('Ollama settings parser tolerates complete hourly and weekly fields', () => {
  const parsed = parseOllamaSettings(`
    <script>{"plan":"Team","hourlyPercent":12.5,"hourlyReset":"2027-01-15T12:00:00Z",
      "weeklyPercent":63,"weeklyReset":"2027-01-19T12:00:00Z"}</script>
  `, { connectionId: 'cloud', observedAt: NOW })
  assert.equal(parsed.plan, 'Team')
  assert.deepEqual(parsed.limits.map((limit) => limit.percentUsed), [12.5, 63])
  assert.equal(parsed.windows.every((window) => Number.isInteger(window.resetsAt)), true)
  assert.deepEqual(parsed.warnings, [])
})

test('Ollama settings parser accepts CodexBar-style Cloud Usage, email, CSS widths, and data-time resets', () => {
  const parsed = parseOllamaSettings(`
    <main><h2>Cloud Usage</h2><div>Pro</div><span id="header-email">person@example.com</span>
      <section>Session usage <div style="width: 18%"></div><i data-time="2027-01-15T12:00:00Z"></i></section>
      <section>Weekly usage <b>63% used</b><i data-time="2027-01-19T12:00:00Z"></i></section>
    </main>
  `, { connectionId: 'cloud', observedAt: NOW })
  assert.equal(parsed.plan, 'Pro')
  assert.equal(parsed.email, 'person@example.com')
  assert.deepEqual(parsed.limits.map(limit => limit.percentUsed), [18, 63])
  assert.equal(parsed.windows[0].durationMs, 5 * 3_600_000)
  assert.equal(parsed.windows[0].kind, 'rate')
  assert.equal(parsed.windows.every(window => Number.isInteger(window.resetsAt)), true)
})

test('manual Ollama Cookie Header scraping is opt-in, allowlisted, confined, brittle, and partial', async () => {
  assert.equal(
    allowedCookieHeader('theme=dark; better-auth.session_token=session-secret; analytics=yes'),
    'better-auth.session_token=session-secret',
  )
  assert.throws(() => allowedCookieHeader('theme=dark'), (error) => error.code === 'credential-required')
  assert.throws(() => allowedCookieHeader('better-auth.session_token=x\r\nX-Evil: yes'), (error) => error.code === 'invalid-cookie-header')

  const calls = []
  const adapter = new OllamaCloudAdapter({
    enableManualCookieScraping: true,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init })
      return response({
        status: 200,
        url: 'https://ollama.com/settings',
        text: '<script>window.data={"planName":"Pro","hourlyPercent":37,"hourlyReset":"2027-01-15T12:00:00Z"}</script>',
      })
    },
  })
  await assert.rejects(adapter.observe({
    credential: { kind: 'manual_cookie_header', cookieHeader: 'better-auth.session_token=session-secret' },
  }), (error) => error.code === 'manual-opt-in-required')
  const result = await adapter.observe({
    connection: { id: 'cloud' },
    credential: { kind: 'manual_cookie_header', cookieHeader: 'theme=dark; better-auth.session_token=session-secret' },
    manualCookieOptIn: true,
    now: () => NOW,
  })
  assert.equal(calls[0].url, 'https://ollama.com/settings')
  assert.equal(calls[0].init.redirect, 'manual')
  assert.equal(calls[0].init.headers.Cookie, 'better-auth.session_token=session-secret')
  assert.equal(result.source, 'official_ui')
  assert.equal(result.brittle, true)
  assert.equal(result.complete, false)
  assert.equal(result.product.name, 'Pro')
  assert.equal(result.limits.length, 1)
  assert.equal(result.limits[0].percentUsed, 37)
  assert.match(result.warnings[0], /Weekly quota/)
  assert.equal(JSON.stringify(result).includes('session-secret'), false)
})

test('an Ollama settings redirect is diagnosed as an invalid or expired session cookie, never followed', async () => {
  const adapter = new OllamaCloudAdapter({
    enableManualCookieScraping: true,
    fetch: async () => response({ status: 303, url: 'https://ollama.com/signin', text: '' }),
  })
  await assert.rejects(adapter.observe({
    connection: { id: 'cloud' },
    credential: { kind: 'manual_cookie_header', cookieHeader: 'session=stale-value' },
    manualCookieOptIn: true,
    now: () => NOW,
  }), (error) => error.code === 'session-invalid-or-expired')
})

test('account storage helper round-trips canonical records through the parent v6 schema', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new AccountsStore(db, { now: () => NOW })
    const connection = store.put('connection', {
      id: 'glm-main', providerId: 'glm', label: 'GLM', credentialId: 'glm-key', createdAt: NOW,
    })
    assert.equal(connection.providerId, 'glm')
    assert.deepEqual(store.get('connection', 'glm-main'), connection)
    store.put('credential_metadata', {
      id: 'glm-key-meta', connectionId: 'glm-main', credentialRef: 'keychain:glm',
      kind: 'raw_authorization', scopes: ['quota:read'], updatedAt: NOW,
    })
    assert.deepEqual(store.get('credential_metadata', 'glm-key-meta').scopes, ['quota:read'])
    const product = store.put('product', {
      id: 'glm-plan', providerId: 'glm', code: 'coding', name: 'Coding Plan',
      sourceKind: 'official_usage_api', createdAt: NOW,
    })
    store.put('billing', {
      id: 'glm-billing', connectionId: 'glm-main', productId: product.id,
      model: 'subscription', currency: 'USD', amountNano: '1000000000',
      sourceKind: 'official_usage_api', observedAt: NOW,
    })
    assert.equal(store.get('billing', 'glm-billing').amountNano, '1000000000')
    store.put('limit', {
      id: 'glm-limit', connectionId: 'glm-main', productId: product.id,
      windowId: 'glm-window', window: { id: 'glm-window', kind: 'rolling', durationMs: 3_600_000 },
      metric: 'tokens', unit: 'token', mode: 'exact', value: 1000,
      sourceKind: 'official_usage_api', createdAt: NOW,
    })
    assert.equal(store.get('limit', 'glm-limit').window.durationMs, 3_600_000)
    store.put('limit', {
      id: 'fixed-limit', connectionId: 'glm-main', productId: product.id,
      windowId: 'fixed-window', window: { id: 'fixed-window', kind: 'fixed', startsAt: NOW, endsAt: NOW + 1000 },
      metric: 'requests', unit: 'count', mode: 'range', min: 10, max: 20,
      sourceKind: 'manual', createdAt: NOW,
    })
    assert.deepEqual(store.get('limit', 'fixed-limit').window, normalizeRecord('window', { id: 'fixed-window', kind: 'fixed', startsAt: NOW, endsAt: NOW + 1000 }))
    store.put('provider_template', {
      id: 'glm-template', providerId: 'glm', name: 'GLM plan', product, limits: [],
      sourceKind: 'manual', updatedAt: NOW,
    })
    const mapping = store.put('provider_mapping', {
      id: 'new', providerId: 'glm', externalKey: 'coding', templateId: 'glm-template', createdAt: NOW,
    })
    assert.equal(store.get('provider_mapping', mapping.id).externalKey, 'coding')
    store.put('observation', {
      id: 'obs-1', providerId: 'glm', connectionId: 'glm-main', observedAt: NOW,
      source: 'official_usage_api', complete: false, windows: [], limits: [], warnings: ['partial'],
    })
    assert.equal(store.list('observation', { connectionId: 'glm-main' })[0].warnings[0], 'partial')
    assert.equal(store.remove('observation', 'obs-1'), true)
    assert.equal(store.get('observation', 'obs-1'), null)
  } finally {
    db.close()
  }
})
