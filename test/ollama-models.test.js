import test from 'node:test'
import assert from 'node:assert/strict'
import { OllamaCloudModels } from '../lib/accounts/ollama-models.js'

function settingsFixture(value = {}) {
  return {
    value: structuredClone(value),
    get(namespace) { return this.value[namespace] },
    async update(namespace, patch) {
      const current = this.value[namespace] ?? {}
      this.value[namespace] = {
        ...current,
        ...patch,
        providers: { ...(current.providers ?? {}), ...(patch.providers ?? {}) },
      }
    },
  }
}

function jsonResponse(body, url, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('configured Ollama Cloud credentials produce a selectable model route from official model details', async () => {
  const calls = []
  const settings = settingsFixture({
    'llm-pi-ai': { providers: { existing: { apiKeyEnv: 'EXISTING_KEY' } } },
  })
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url) === 'https://ollama.com/api/tags') {
      return jsonResponse({ models: [
        { name: 'kimi-k2.6', model: 'kimi-k2.6' },
        { name: 'mistral-large-3:675b', model: 'mistral-large-3:675b' },
      ] }, String(url))
    }
    if (JSON.parse(init.body).model === 'kimi-k2.6') {
      return jsonResponse({
        capabilities: ['vision', 'thinking', 'completion', 'tools'],
        details: { family: 'kimi-k2', parameter_size: '1T' },
        model_info: { 'general.architecture': 'kimi-k2', 'kimi-k2.context_length': 262144 },
      }, String(url))
    }
    return jsonResponse({
      capabilities: ['completion', 'tools', 'vision'],
      parameters: 'num_ctx 131072\nnum_predict 8192',
      model_info: { 'general.architecture': 'mistral3', 'mistral3.context_length': 262144 },
    }, String(url))
  }

  const models = new OllamaCloudModels({ fetch, settings })
  const result = await models.sync({ apiKey: 'test-secret' })

  assert.deepEqual(result, {
    providerId: 'ollama-cloud', routeId: 'ollama-cloud', modelCount: 2,
    enrichedCount: 2, failedDetails: 0,
  })
  assert.deepEqual(settings.value['llm-pi-ai'].providers.existing, { apiKeyEnv: 'EXISTING_KEY' })
  assert.deepEqual(settings.value['llm-pi-ai'].providers['ollama-cloud'], {
    displayName: 'Ollama Cloud',
    apiKeyEnv: 'OLLAMA_API_KEY',
    api: 'openai-completions',
    baseURL: 'https://ollama.com/v1',
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      supportsUsageInStreaming: true,
      maxTokensField: 'max_tokens',
      supportsStrictMode: false,
      thinkingFormat: 'openai',
    },
    models: [
      {
        id: 'kimi-k2.6', name: 'kimi-k2.6', contextWindow: 262144,
        input: ['text', 'image'],
        reasoningEfforts: { off: 'none', low: 'low', medium: 'medium', high: 'high', max: 'max' },
      },
      {
        id: 'mistral-large-3:675b', name: 'mistral-large-3:675b', contextWindow: 131072,
        maxTokens: 8192, input: ['text', 'image'], reasoningEfforts: false,
      },
    ],
  })
  assert.equal(calls.length, 3)
  for (const call of calls) {
    assert.equal(call.init.redirect, 'error')
    assert.equal(call.init.headers.Authorization, 'Bearer test-secret')
  }
  assert.equal(JSON.stringify(result).includes('test-secret'), false)
  assert.equal(JSON.stringify(settings.value).includes('test-secret'), false)
})

test('explicit sync reconciles the catalog while preserving user fields the official response does not provide', async () => {
  const settings = settingsFixture({
    'llm-pi-ai': { providers: {
      'ollama-cloud': {
        displayName: 'Ollama Cloud', apiKeyEnv: 'OLLAMA_API_KEY', api: 'openai-completions', baseURL: 'https://ollama.com/v1',
        models: [
          { id: 'kept', name: 'My Kept Model', contextWindow: 4096, maxTokens: 7777, customField: 'keep-me' },
          { id: 'removed', name: 'Removed' },
        ],
      },
    } },
  })
  const fetch = async (url, init = {}) => {
    if (String(url).endsWith('/tags')) return jsonResponse({ models: [{ name: 'kept', model: 'kept' }] }, String(url))
    assert.equal(JSON.parse(init.body).model, 'kept')
    return jsonResponse({
      capabilities: ['completion', 'thinking'],
      model_info: { 'general.architecture': 'kept', 'kept.context_length': 65536 },
    }, String(url))
  }

  await new OllamaCloudModels({ fetch, settings }).sync({ apiKey: 'test-secret' })

  assert.deepEqual(settings.value['llm-pi-ai'].providers['ollama-cloud'].models, [{
    id: 'kept', name: 'My Kept Model', contextWindow: 65536, maxTokens: 7777,
    customField: 'keep-me', input: ['text'],
    reasoningEfforts: { off: 'none', low: 'low', medium: 'medium', high: 'high', max: 'max' },
  }])
})

test('a conflicting user-owned ollama-cloud route is refused before credentials reach the network', async () => {
  let calls = 0
  const settings = settingsFixture({
    'llm-pi-ai': { providers: {
      'ollama-cloud': {
        displayName: 'Private Ollama Gateway', apiKeyEnv: 'PRIVATE_KEY',
        api: 'openai-completions', baseURL: 'https://gateway.example/v1', models: [{ id: 'private' }],
      },
    } },
  })
  const catalog = new OllamaCloudModels({ fetch: async () => { calls += 1 }, settings })

  await assert.rejects(catalog.sync({ apiKey: 'test-secret' }), error => error?.code === 'route-conflict')
  assert.equal(calls, 0)
  assert.equal(settings.value['llm-pi-ai'].providers['ollama-cloud'].baseURL, 'https://gateway.example/v1')
})

test('a failed detail request keeps the listed model and does not erase its last known metadata', async () => {
  const settings = settingsFixture({
    'llm-pi-ai': { providers: {
      'ollama-cloud': {
        displayName: 'Ollama Cloud', apiKeyEnv: 'OLLAMA_API_KEY', api: 'openai-completions', baseURL: 'https://ollama.com/v1',
        models: [{ id: 'kept', name: 'Kept', contextWindow: 131072, maxTokens: 4096, input: ['text', 'image'], reasoningEfforts: { high: 'high' } }],
      },
    } },
  })
  const fetch = async (url) => String(url).endsWith('/tags')
    ? jsonResponse({ models: [{ name: 'kept', model: 'kept' }, { name: 'new-model', model: 'new-model' }] }, String(url))
    : jsonResponse({ error: 'temporary' }, String(url), 502)

  const result = await new OllamaCloudModels({ fetch, settings }).sync({ apiKey: 'test-secret' })

  assert.equal(result.failedDetails, 2)
  assert.equal(result.enrichedCount, 0)
  assert.deepEqual(settings.value['llm-pi-ai'].providers['ollama-cloud'].models, [
    { id: 'kept', name: 'Kept', contextWindow: 131072, maxTokens: 4096, input: ['text', 'image'], reasoningEfforts: { high: 'high' } },
    { id: 'new-model', name: 'new-model', input: ['text'], reasoningEfforts: false },
  ])
})

test('caller cancellation is preserved and never replaces the existing catalog', async () => {
  const existing = {
    displayName: 'Ollama Cloud', apiKeyEnv: 'OLLAMA_API_KEY', api: 'openai-completions', baseURL: 'https://ollama.com/v1',
    models: [{ id: 'stable', name: 'Stable' }],
  }
  const settings = settingsFixture({ 'llm-pi-ai': { providers: { 'ollama-cloud': existing } } })
  const controller = new AbortController()
  controller.abort(new Error('caller stopped'))
  const catalog = new OllamaCloudModels({
    settings,
    fetch: async (_url, init) => { throw init.signal.reason },
  })

  await assert.rejects(catalog.sync({ apiKey: 'test-secret', signal: controller.signal }), error => error?.code === 'cancelled')
  assert.deepEqual(settings.value['llm-pi-ai'].providers['ollama-cloud'], existing)
})
