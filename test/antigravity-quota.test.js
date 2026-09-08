import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createAntigravityClient,
  DEFAULT_ENDPOINT,
  DEFAULT_GENERATION_ENDPOINT,
} from '../lib/capabilities/antigravity/antigravity-api.js'
import { createUsageService } from '../lib/capabilities/antigravity/usage.js'

/**
 * Quota reads must answer from the surface where generation actually runs.
 *
 * Verified live 2026-09-08 against consumer-subscription tokens: prod
 * (cloudcode-pa) answers fetchAvailableModels and retrieveUserQuotaSummary
 * with 200 + placeholder quota (remainingFraction=1, resetTime=now+5h/7d) —
 * it holds no usage state — while daily-cloudcode-pa (the generation surface)
 * carries the real fractions and fixed reset times that match the official
 * Antigravity dashboard. Polling prod first persisted that echo as the
 * official observation: every model showed 0% with a ~5h countdown that
 * never converged, and the catalog flickered between the prod and daily sets.
 */

const ECHO_RESET = '2026-09-08T16:16:13Z' // ≈ request time + 5h, recomputed per request
const REAL_RESET = '2026-09-08T14:47:12Z' // fixed real window end

function quotaFetch(tally, { dailyStatus = 200 } = {}) {
  return async (url, init) => {
    const respond = (data, status = 200) => new Response(JSON.stringify(data), { status })
    if (url === `${DEFAULT_ENDPOINT}/v1internal:fetchAvailableModels`) {
      tally.prod += 1
      return respond({ models: { 'gemini-3.8-flash-medium': { quotaInfo: { remainingFraction: 1, resetTime: ECHO_RESET } } } })
    }
    if (url === `${DEFAULT_GENERATION_ENDPOINT}/v1internal:fetchAvailableModels`) {
      tally.daily += 1
      return respond({ models: { 'gemini-3.8-flash-medium': { quotaInfo: { remainingFraction: 0.8777074, resetTime: REAL_RESET } } } }, dailyStatus)
    }
    if (url === `${DEFAULT_ENDPOINT}/v1internal:retrieveUserQuotaSummary`) {
      tally.prod += 1
      return respond({ groups: [{ buckets: [{ bucketId: 'gemini-weekly', remainingFraction: 1, resetTime: '2026-09-15T11:16:17Z' }] }] })
    }
    if (url === `${DEFAULT_GENERATION_ENDPOINT}/v1internal:retrieveUserQuotaSummary`) {
      tally.daily += 1
      return respond({ groups: [{ buckets: [{ bucketId: 'gemini-weekly', remainingFraction: 0.95319355, resetTime: '2026-09-12T10:59:04Z' }] }] }, dailyStatus)
    }
    return respond({ error: { message: `unexpected url ${url}` } }, 404)
  }
}

const fakeAuth = {
  activeAccountId: () => 'a1',
  status: () => ({ configured: true, email: 'user@example.com' }),
  statuses: () => [{ accountId: 'a1' }],
  getAccountContext: async () => ({ accountId: 'a1', token: 'token', email: 'user@example.com', projectId: 'proj' }),
}

function makeService(tally, options = {}) {
  const client = createAntigravityClient({ fetchImpl: quotaFetch(tally, options), clock: () => 1788864973000 })
  return createUsageService({ auth: fakeAuth, client })
}

test('per-model quota answers from the daily generation surface, not the prod echo', async () => {
  const service = makeService({ prod: 0, daily: 0 })
  const result = await service.fetchUsage({ accountId: 'a1', refresh: true })

  const model = result.models?.find(entry => entry.id === 'gemini-3.8-flash-medium')
  assert.ok(model, 'model row missing')
  assert.equal(model.remaining, 0.8777074)
  assert.equal(model.resetsAt, REAL_RESET) // the service keeps the ISO string; observation persist parses it
})

test('quota summary answers from the daily generation surface, not the prod echo', async () => {
  const service = makeService({ prod: 0, daily: 0 })
  const result = await service.fetchUsage({ accountId: 'a1', refresh: true })

  const bucket = result.summary?.groups?.[0]?.buckets?.[0]
  assert.ok(bucket, 'summary bucket missing')
  assert.equal(bucket.remainingFraction, 0.95319355)
})

test('an explicit base URL still pins quota reads for gateways', async () => {
  const seen = []
  const pinned = async (url) => {
    seen.push(url)
    return new Response(JSON.stringify(
      url.includes('fetchAvailableModels')
        ? { models: { 'gemini-3.8-flash-medium': { quotaInfo: { remainingFraction: 0.5, resetTime: REAL_RESET } } } }
        : { groups: [] },
    ), { status: 200 })
  }
  const client = createAntigravityClient({ fetchImpl: pinned, baseUrl: 'https://gateway.example' })
  const usage = createUsageService({ auth: fakeAuth, client })
  const result = await usage.fetchUsage({ accountId: 'a1', refresh: true })

  assert.equal(result.models[0].remaining, 0.5)
  assert.ok(seen.length > 0)
  assert.ok(seen.every(url => url.startsWith('https://gateway.example')), `non-pinned quota request: ${seen.join(', ')}`)
})

test('prod remains a quota fallback when the daily surface fails', async () => {
  const tally = { prod: 0, daily: 0 }
  const service = makeService(tally, { dailyStatus: 500 })
  const result = await service.fetchUsage({ accountId: 'a1', refresh: true })

  const model = result.models?.find(entry => entry.id === 'gemini-3.8-flash-medium')
  assert.ok(model, 'fallback model row missing')
  assert.equal(tally.daily, 2) // summary + models fetch each walk daily first
  assert.equal(tally.prod, 2) // and each fall through to prod on the daily 500
})
