import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PriceCatalog,
  normalizeModelKey,
  parseLiteLlmPrices,
  valueUsage,
} from '../lib/ledger/pricing.js'
import { createLedgerService } from '../lib/ledger/service.js'

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-token-usage-pricing-'))
  return { path: join(dir, 'usage.sqlite'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('LiteLLM prices convert USD/token to integer nano-USD', () => {
  const prices = parseLiteLlmPrices({
    'zai/glm-5.3': {
      input_cost_per_token: 0.0000014,
      output_cost_per_token: 0.0000044,
      cache_read_input_token_cost: 0.00000014,
    },
    incomplete: { input_cost_per_token: 0.000001 },
  }, { updatedAt: 123 })
  assert.equal(prices.size, 1)
  assert.deepEqual(prices.get('zai/glm-5.3'), {
    inputNano: 1400,
    outputNano: 4400,
    cacheReadNano: 140,
    cacheWriteNano: null,
    source: 'litellm-upstream',
    version: 'litellm-upstream-123',
    updatedAt: 123,
  })
})

test('normalization strips provider and date but keeps meaningful variants', () => {
  assert.equal(normalizeModelKey('zai/GLM-5.3'), 'glm-5.3')
  assert.equal(normalizeModelKey('vendor/model-2026-08-29'), 'model')
  assert.equal(normalizeModelKey('qwen3.8:27b-mlx'), 'qwen3.8:27b-mlx')
  assert.equal(normalizeModelKey('GLM-5.3-Flash'), 'glm-5.3-flash')
})

test('automatic matching is provider-safe; explicit alias may cross providers', () => {
  const updates = new Map([
    ['zai/glm-5.3', { inputNano: 1400, outputNano: 4400 }],
    ['together_ai/zai-org/GLM-5.3-Flash', { inputNano: 150, outputNano: 500 }],
  ])
  const catalog = new PriceCatalog({ snapshot: { version: 1, source: 'fixture', models: {} }, updates })
  assert.equal(catalog.priceFor('glm-5.3', 'zai-coding-cn').matchedModel, 'zai/glm-5.3')
  assert.equal(catalog.priceFor('glm-5.3-flash', 'zai-coding-cn'), null, 'must not silently use TogetherAI price for ZAI provider')

  catalog.aliases.set('glm-5.3-flash', 'together_ai/zai-org/GLM-5.3-Flash')
  assert.equal(catalog.priceFor('glm-5.3-flash', 'zai-coding-cn').matchedModel, 'together_ai/zai-org/GLM-5.3-Flash')
})

test('durable upstream catalog improves coverage and survives reopen', () => {
  const env = tempDb()
  try {
    const service = createLedgerService({ databasePath: env.path })
    service.importSession({
      header: { id: 'glm-session', version: 0, createdAt: Date.UTC(2026, 7, 29), cwd: '/repo' },
      events: [
        { type: 'request/header', seq: 0, time: 1, data: { config: { provider: 'zai-coding-cn', model: 'glm-5.3' } } },
        { type: 'assistant/message', seq: 1, time: 2, data: { turn: 0, step: 0, message: { source: { kind: 'model', provider: 'zai-coding-cn', model: 'glm-5.3' } }, usage: { inputTokens: 100, outputTokens: 10 } } },
      ],
    })
    assert.equal(service.getOverview({ timezone: 'UTC' }).cost.coverage, 0)
    service.setUpstreamPrices(new Map([
      ['zai/glm-5.3', { inputNano: 1400, outputNano: 4400, cacheReadNano: null, cacheWriteNano: null }],
    ]), { source: 'fixture-upstream', updatedAt: 456 })
    const after = service.getOverview({ timezone: 'UTC' }).cost
    assert.equal(after.coverage, 1)
    assert.equal(after.usdNano, 184000)
    service.dispose()

    const reopened = createLedgerService({ databasePath: env.path })
    const persisted = reopened.getOverview({ timezone: 'UTC' }).cost
    assert.equal(persisted.coverage, 1)
    assert.equal(reopened.snapshotMeta().updatedModels.length, 1)
    reopened.dispose()
  } finally {
    env.cleanup()
  }
})

test('user override remains highest precedence', () => {
  const catalog = new PriceCatalog({
    snapshot: { version: 1, source: 'fixture', models: { model: { inputNano: 100, outputNano: 200 } } },
    updates: new Map([['model', { inputNano: 300, outputNano: 400 }]]),
    overrides: new Map([['model', { inputNano: 500, outputNano: 600 }]]),
  })
  const value = valueUsage(catalog, {
    provider: 'provider',
    modelRaw: 'model',
    usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0 },
  })
  assert.equal(value.usdNano, 2800)
  assert.equal(value.source, 'override')
})

test('refreshed prices beat the bundled snapshot on every catalog matching path', () => {
  const snapshot = {
    version: 1,
    models: {
      'exact-model': { inputNano: 100, outputNano: 100 },
      'normalized-model-2026-01-01': { inputNano: 100, outputNano: 100 },
      'zai/glm-5.3': { inputNano: 100, outputNano: 100 },
      'alias/target': { inputNano: 100, outputNano: 100 },
      'snapshot-only-model': { inputNano: 700, outputNano: 700 },
    },
  }
  const updates = new Map([
    ['exact-model', { inputNano: 200, outputNano: 200 }],
    ['normalized-model-2026-02-02', { inputNano: 200, outputNano: 200 }],
    ['zai/glm-5.3', { inputNano: 200, outputNano: 200 }],
    ['alias/target', { inputNano: 200, outputNano: 200, source: 'models-dev-refresh' }],
  ])
  const catalog = new PriceCatalog({ snapshot, updates })
  catalog.aliases.set('raw-alias', 'alias/target')

  // exact id
  assert.equal(catalog.priceFor('exact-model', 'acme').inputNano, 200)
  assert.equal(catalog.priceFor('exact-model', 'acme').source, 'litellm-upstream')
  // normalized id (release-date suffix differs on both sides)
  const normalized = catalog.priceFor('normalized-model-2026-03-03', 'acme')
  assert.equal(normalized.matchedModel, 'normalized-model-2026-02-02')
  assert.equal(normalized.inputNano, 200)
  assert.equal(normalized.source, 'litellm-upstream')
  // provider-prefixed id
  const prefixed = catalog.priceFor('glm-5.3', 'zai-coding-cn')
  assert.equal(prefixed.matchedModel, 'zai/glm-5.3')
  assert.equal(prefixed.inputNano, 200)
  assert.equal(prefixed.source, 'litellm-upstream')
  // alias target; the refreshed layer may carry its own source label
  const aliasTarget = catalog.priceFor('raw-alias', 'acme')
  assert.equal(aliasTarget.matchedModel, 'alias/target')
  assert.equal(aliasTarget.source, 'models-dev-refresh')
  // a snapshot-only model still falls back to the snapshot
  const snapshotOnly = catalog.priceFor('snapshot-only-model', 'acme')
  assert.equal(snapshotOnly.inputNano, 700)
  assert.equal(snapshotOnly.source, 'snapshot')
  // valuation uses the refreshed price, not the snapshot price
  const valued = valueUsage(catalog, {
    provider: 'acme',
    modelRaw: 'exact-model',
    usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0 },
  })
  assert.equal(valued.usdNano, 1000) // 2×200 + 3×200, not the snapshot 500
  assert.equal(valued.source, 'litellm-upstream')
})

test('override beats both refreshed and snapshot prices, including alias targets', () => {
  const snapshot = { version: 1, models: { 'zai/glm-5.3': { inputNano: 100, outputNano: 100 } } }
  const updates = new Map([['zai/glm-5.3', { inputNano: 200, outputNano: 200 }]])
  const raw = new PriceCatalog({
    snapshot,
    updates,
    overrides: new Map([['zai/glm-5.3', { inputNano: 500, outputNano: 500 }]]),
  })
  const rawPrice = raw.priceFor('zai/glm-5.3', 'zai-coding-cn')
  assert.equal(rawPrice.source, 'override')
  assert.equal(rawPrice.inputNano, 500)

  const aliased = new PriceCatalog({ snapshot, updates })
  aliased.aliases.set('glm', 'zai/glm-5.3')
  aliased.overrides.set('zai/glm-5.3', { inputNano: 500, outputNano: 500 })
  const aliasPrice = aliased.priceFor('glm', 'zai-coding-cn')
  assert.equal(aliasPrice.matchedModel, 'zai/glm-5.3')
  assert.equal(aliasPrice.source, 'override')
  assert.equal(aliasPrice.inputNano, 500)
})
