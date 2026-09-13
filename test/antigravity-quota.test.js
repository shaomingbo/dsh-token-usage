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
 *
 * Verified live 2026-09-13: the split is not clean. Daily answers some
 * consumer accounts without remainingFraction for the gemini-* runtimes
 * (resetTime only) while prod still carries the real fractions with the same
 * fixed reset instant — so first-answer-wins read those rows as percent-less
 * dashes. And the claude-* and gpt-oss rows answer the now+5h full-quota echo on
 * every surface, so no surface order can avoid it; the usage layer detects
 * the echo signature instead of persisting it as a 0% fact.
 */

const ECHO_RESET = '2026-09-08T15:56:13Z' // exactly fixture clock + 5h, recomputed per request
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
  const clock = () => 1788864973000
  const client = createAntigravityClient({ fetchImpl: quotaFetch(tally, options), clock })
  return createUsageService({ auth: fakeAuth, client, clock })
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

// --- 2026-09-13: surface merge + placeholder-echo detection ---

const SANDBOX_ENDPOINT = 'https://daily-cloudcode-pa.sandbox.googleapis.com'

/**
 * Surface-aware fixture: each quota endpoint answers with its own models map
 * so tests can express the observed 2026-09-13 splits (daily omits gemini
 * fractions; prod carries them; the claude-* and gpt-oss echo appears on all).
 */
function surfaceFetch(tally, surfaces) {
  return async (url) => {
    const respond = (data, status = 200) => new Response(JSON.stringify(data), { status })
    for (const [name, base] of [['daily', DEFAULT_GENERATION_ENDPOINT], ['prod', DEFAULT_ENDPOINT], ['sandbox', SANDBOX_ENDPOINT]]) {
      if (url === `${base}/v1internal:fetchAvailableModels`) {
        tally[name] += 1
        const models = surfaces[name]?.models
        return models === undefined ? respond({ error: { message: 'absent' } }, 404) : respond({ models })
      }
      if (url === `${base}/v1internal:retrieveUserQuotaSummary`) {
        tally[name] += 1
        return respond(surfaces[name]?.summary ?? { groups: [] })
      }
    }
    return respond({ error: { message: `unexpected url ${url}` } }, 404)
  }
}

function surfaceService(tally, surfaces) {
  const clock = () => 1788864973000
  const client = createAntigravityClient({ fetchImpl: surfaceFetch(tally, surfaces), clock })
  return createUsageService({ auth: fakeAuth, client, clock })
}

test('fills quota fields the daily surface omits from the fallback surface', async () => {
  const tally = {}
  const service = surfaceService(tally, {
    daily: { models: { 'gemini-3.7-flash-tiered': { quotaInfo: { resetTime: REAL_RESET } } } },
    prod: { models: { 'gemini-3.7-flash-tiered': { quotaInfo: { remainingFraction: 0.0014313, resetTime: REAL_RESET } } } },
  })
  const result = await service.fetchUsage({ accountId: 'a1', refresh: true })

  const model = result.models?.find(entry => entry.id === 'gemini-3.7-flash-tiered')
  assert.ok(model, 'merged model row missing')
  assert.equal(model.remaining, 0.0014313, 'the real fraction must be filled from the fallback surface')
  assert.equal(model.resetsAt, REAL_RESET)
  assert.equal(tally.sandbox ?? 0, 0, 'a complete merged answer must stop the surface walk')
})

test('does not add models the first answering surface does not list', async () => {
  const tally = {}
  const service = surfaceService(tally, {
    daily: { models: { 'gemini-3.7-flash-tiered': { quotaInfo: { resetTime: REAL_RESET } } } },
    prod: {
      models: {
        'gemini-3.7-flash-tiered': { quotaInfo: { remainingFraction: 0.5, resetTime: REAL_RESET } },
        'claude-extra-9': { quotaInfo: { remainingFraction: 0.9, resetTime: REAL_RESET } },
      },
    },
  })
  const result = await service.fetchUsage({ accountId: 'a1', refresh: true })

  assert.deepEqual(result.models?.map(entry => entry.id), ['gemini-3.7-flash-tiered'])
  assert.equal(result.models[0].remaining, 0.5, 'the fill must still apply to catalog entries')
})

test('stops after the first complete answer', async () => {
  const tally = {}
  const service = surfaceService(tally, {
    daily: { models: { 'gemini-3.7-flash-tiered': { quotaInfo: { remainingFraction: 0.5, resetTime: REAL_RESET } } } },
    prod: { models: { 'gemini-3.7-flash-tiered': { quotaInfo: { remainingFraction: 0.4, resetTime: REAL_RESET } } } },
  })
  const result = await service.fetchUsage({ accountId: 'a1', refresh: true })

  assert.equal(result.models[0].remaining, 0.5, 'the first answering surface owns reported fields')
  assert.equal(tally.prod ?? 0, 0, 'a complete daily answer must not reach any fallback surface')
})

test('records the now+5h full-quota echo as unknown instead of 0%', async () => {
  const echo = { quotaInfo: { remainingFraction: 1, resetTime: ECHO_RESET } } // exactly clock + 5h
  const tally = {}
  const service = surfaceService(tally, {
    daily: { models: { 'claude-sonnet-4-6': echo, 'gpt-oss-120b-medium': echo } },
    prod: { models: { 'claude-sonnet-4-6': echo, 'gpt-oss-120b-medium': echo } },
  })
  const result = await service.fetchUsage({ accountId: 'a1', refresh: true })

  for (const entry of result.models ?? []) {
    assert.equal(entry.remaining, undefined, `${entry.id} must not persist the echo fraction`)
    assert.equal(entry.resetsAt, undefined, `${entry.id} must not persist the per-request reset instant`)
  }
})

test('keeps a real full quota whose reset does not sit at the echo instant', async () => {
  const realFull = { quotaInfo: { remainingFraction: 1, resetTime: '2026-09-08T12:46:13Z' } } // clock + 90min, fixed
  const tally = {}
  const service = surfaceService(tally, {
    daily: { models: { 'claude-sonnet-4-6': realFull } },
    prod: { models: { 'claude-sonnet-4-6': realFull } },
  })
  const result = await service.fetchUsage({ accountId: 'a1', refresh: true })

  const model = result.models?.find(entry => entry.id === 'claude-sonnet-4-6')
  assert.equal(model.remaining, 1)
  assert.equal(model.resetsAt, '2026-09-08T12:46:13Z')
})

test('an echo row is still dropped when a real merge across surfaces happened', async () => {
  // The daily answer must be incomplete (the gemini row lacks a fraction) so
  // the walk really reaches prod and merges: the merge must not resurrect
  // echo fields the usage layer drops, and the fill must still apply.
  const tally = { daily: 0, prod: 0, sandbox: 0 }
  const service = surfaceService(tally, {
    daily: {
      models: {
        'claude-opus-4-6-thinking': { quotaInfo: { remainingFraction: 1, resetTime: ECHO_RESET } },
        'gemini-3.7-flash-tiered': { quotaInfo: { resetTime: REAL_RESET } },
      },
    },
    prod: {
      models: {
        'claude-opus-4-6-thinking': { quotaInfo: { remainingFraction: 1, resetTime: '2026-09-08T15:57:13Z' } }, // clock + 5h1m
        'gemini-3.7-flash-tiered': { quotaInfo: { remainingFraction: 0.0014313, resetTime: REAL_RESET } },
      },
    },
  })
  const result = await service.fetchUsage({ accountId: 'a1', refresh: true })
  assert.equal(tally.prod ?? 0, 1, 'the incomplete daily models answer must reach the fallback surface')

  const gemini = result.models?.find(entry => entry.id === 'gemini-3.7-flash-tiered')
  assert.equal(gemini.remaining, 0.0014313, 'the real fraction must be filled on the merged round')
  const echo = result.models?.find(entry => entry.id === 'claude-opus-4-6-thinking')
  assert.equal(echo.remaining, undefined, 'the merged echo must still be dropped')
  assert.equal(echo.resetsAt, undefined, 'the merged echo reset must still be dropped')
})

test('keeps the first answer fields when a merge is forced', async () => {
  const tally = {}
  const service = surfaceService(tally, {
    daily: {
      models: {
        'gemini-a': { quotaInfo: { remainingFraction: 0.7 } },
        'gemini-b': { quotaInfo: { resetTime: REAL_RESET } },
      },
    },
    prod: {
      models: {
        'gemini-a': { quotaInfo: { remainingFraction: 0.9, resetTime: '2026-09-08T14:00:00Z' } },
        'gemini-b': { quotaInfo: { remainingFraction: 0.2, resetTime: '2026-09-08T15:00:00Z' } },
      },
    },
  })
  const result = await service.fetchUsage({ accountId: 'a1', refresh: true })

  const a = result.models?.find(entry => entry.id === 'gemini-a')
  assert.equal(a.remaining, 0.7, 'an already-reported fraction must not be overridden')
  assert.equal(a.resetsAt, '2026-09-08T14:00:00Z', 'a missing reset must be filled')
  const b = result.models?.find(entry => entry.id === 'gemini-b')
  assert.equal(b.remaining, 0.2, 'a missing fraction must be filled')
  assert.equal(b.resetsAt, REAL_RESET, 'an already-reported reset must not be overridden')
})

test('keeps the first answering catalog when every fallback surface fails', async () => {
  const tally = {}
  const service = surfaceService(tally, {
    daily: { models: { 'gemini-3.7-flash-tiered': { quotaInfo: { resetTime: REAL_RESET } } } },
    prod: {}, // answered by the fixture as 404
    sandbox: {},
  })
  const result = await service.fetchUsage({ accountId: 'a1', refresh: true })

  assert.deepEqual(result.models?.map(entry => entry.id), ['gemini-3.7-flash-tiered'])
  assert.equal(result.models[0].remaining, undefined, 'no fraction existed anywhere; the row stays unknown')
})

test('echo detection sits at the models read, not the snapshot start', async () => {
  // A slow auth/discovery/summary prefix must not push a real echo outside
  // the tolerance window: the comparison time is taken again right before
  // the models read. Fixture clock advances 150s between the two reads and
  // the echo reset sits at modelsRead + 5h — detectable only from the later
  // instant.
  const t0 = 1788864973000
  let reads = 0
  const clock = () => (reads++ === 0 ? t0 : t0 + 150_000)
  const echoAtModelsRead = new Date(t0 + 150_000 + 5 * 60 * 60 * 1000).toISOString()
  const client = createAntigravityClient({
    fetchImpl: surfaceFetch({}, { daily: { models: { 'claude-sonnet-4-6': { quotaInfo: { remainingFraction: 1, resetTime: echoAtModelsRead } } } } }),
    clock,
  })
  const usage = createUsageService({ auth: fakeAuth, client, clock })
  const result = await usage.fetchUsage({ accountId: 'a1', refresh: true })

  const model = result.models?.find(entry => entry.id === 'claude-sonnet-4-6')
  assert.equal(model.remaining, undefined, 'the echo must be detected from the models-read instant')
  assert.equal(result.fetchedAt, t0, 'fetchedAt keeps the snapshot-start semantics')
})

test('echo tolerance boundary: exactly at +2 minutes drops, one second past keeps', async () => {
  const t0 = 1788864973000
  const at = (ms) => new Date(t0 + 5 * 60 * 60 * 1000 + ms).toISOString()
  const build = (resetTime) => surfaceService({}, {
    daily: { models: { 'claude-sonnet-4-6': { quotaInfo: { remainingFraction: 1, resetTime } } } },
    prod: { models: { 'claude-sonnet-4-6': { quotaInfo: { remainingFraction: 1, resetTime } } } },
  })

  const inside = await build(at(120_000)).fetchUsage({ accountId: 'a1', refresh: true })
  assert.equal(inside.models[0].remaining, undefined, '+120s is within the closed tolerance and drops')

  const outside = await build(at(121_000)).fetchUsage({ accountId: 'a1', refresh: true })
  assert.equal(outside.models[0].remaining, 1, '+121s is outside the tolerance and stays a fact')
})

test('a cached result repeats the same fetchedAt on re-persist', async () => {
  const tally = {}
  const service = surfaceService(tally, {
    daily: { models: { 'gemini-3.7-flash-tiered': { quotaInfo: { remainingFraction: 0.5, resetTime: REAL_RESET } } } },
    prod: { models: { 'gemini-3.7-flash-tiered': { quotaInfo: { remainingFraction: 0.4, resetTime: REAL_RESET } } } },
  })
  const fresh = await service.fetchUsage({ accountId: 'a1', refresh: true })
  const cached = await service.fetchUsage({ accountId: 'a1' })

  assert.equal(cached.fetchedAt, fresh.fetchedAt, 'the cached payload must not look fresher than its read')
  assert.deepEqual(cached.models, fresh.models)
})
