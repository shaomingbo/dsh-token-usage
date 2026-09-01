import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_OLLAMA_CACHE_ESTIMATE_BPS,
  estimateOllamaCloudCacheRead,
  normalizeOllamaCacheEstimateBps,
} from '../lib/ledger/cache-estimate.js'

const request = {
  provider: 'ollama-cloud', status: 'ok', cacheReadState: 'unknown',
  inputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0,
}

test('Ollama Cloud cache scenario defaults to 95 percent without changing reported facts', () => {
  assert.equal(DEFAULT_OLLAMA_CACHE_ESTIMATE_BPS, 9500)
  assert.equal(estimateOllamaCloudCacheRead(request), 190)
  assert.equal(request.inputTokens, 200)
  assert.equal(request.cacheReadTokens, 0)
})

test('reported cache presence wins, including an explicit zero', () => {
  assert.equal(estimateOllamaCloudCacheRead({ ...request, cacheReadTokens: 50, cacheReadState: 'reported' }), 0)
  assert.equal(estimateOllamaCloudCacheRead({ ...request, cacheReadState: 'reported' }), 0)
  assert.equal(estimateOllamaCloudCacheRead({ ...request, cacheReadState: 'absent' }), 190)
})

test('cache scenario is provider-scoped, status-safe, configurable and validated', () => {
  assert.equal(estimateOllamaCloudCacheRead({ ...request, provider: 'ollama' }), 0)
  assert.equal(estimateOllamaCloudCacheRead({ ...request, status: 'failed' }), 0)
  assert.equal(estimateOllamaCloudCacheRead(request, { rateBps: 5000 }), 100)
  assert.equal(normalizeOllamaCacheEstimateBps(0), 0)
  assert.throws(() => normalizeOllamaCacheEstimateBps(10001), /integer from 0 to 10000/)
})
