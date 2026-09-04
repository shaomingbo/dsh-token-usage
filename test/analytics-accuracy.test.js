import test from 'node:test'
import assert from 'node:assert/strict'
import { createLedgerService } from '../lib/ledger/service.js'
import { OFFICIAL_OBSERVATION_STALE_MS } from '../lib/ledger/analytics.js'

const DAY = 86_400_000
const HOUR = 3_600_000
const MINUTE = 60_000
// Wednesday 2026-09-02 08:00 UTC: mid-week, mid-month, so every boundary
// assertion below is off the calendar edges.
const T0 = Date.UTC(2026, 8, 2, 8)

function session({ id, cwd = '/w/a', time, provider = 'deepseek', model = 'deepseek-chat', connectionId, input = 100, output = 50, cache = 0 }) {
  return {
    header: { version: 0, id, createdAt: time, cwd },
    events: [
      { type: 'session/start', seq: 0, time, data: {} },
      { type: 'request/header', seq: 1, time: time + 1, data: { config: { provider, model } } },
      { type: 'assistant/message', seq: 2, time: time + 2, data: { turn: 0, step: 0, message: { source: { kind: 'model', provider, model, ...(connectionId === undefined ? {} : { connectionId }) } }, usage: { inputTokens: input, outputTokens: output, cacheReadTokens: cache } } },
      { type: 'step/end', seq: 3, time: time + 3, data: { turn: 0, step: 0 } },
    ],
  }
}

function observation({ id, providerId, connectionId, observedAt, percentUsed, resetsAt, brittle = true }) {
  const windowId = `${providerId}:window`
  return {
    id, providerId, connectionId, observedAt,
    source: 'official_ui', brittle, complete: true, quotaApplicable: true,
    windows: [{ id: windowId, kind: 'fixed', label: 'Quota', resetsAt }],
    limits: [{ id: `${providerId}:limit`, windowId, metric: 'cloud_usage', unit: 'percent', mode: 'dynamic', percentUsed, observedAt }],
    warnings: [], metadata: null,
  }
}

test('A: a provider-reported null percent stays unknown and never becomes tightest', () => {
  // Antigravity models without a `remaining` fraction report percentUsed
  // null; Number(null) === 0 used to display them as a fresh 0% account.
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    service.saveAccountConnection({ providerId: 'antigravity', connectionId: 'antigravity:default', displayName: 'Antigravity', configured: true })
    service.saveAccountConnection({ providerId: 'glm', connectionId: 'glm:default', displayName: 'GLM', configured: true })
    const nullPool = service.ensureConnectionAccount(
      { providerId: 'antigravity', connectionId: 'antigravity:default', displayName: 'Antigravity', configured: true },
      { aliases: ['antigravity'], attribution: 'connection' },
    )
    const stringPool = service.ensureConnectionAccount(
      { providerId: 'glm', connectionId: 'glm:default', displayName: 'GLM', configured: true },
      { aliases: ['glm'], attribution: 'connection' },
    )
    service.saveAccountObservation(observation({
      id: 'ag:null', providerId: 'antigravity', connectionId: 'antigravity:default',
      observedAt: T0 - MINUTE, percentUsed: null, resetsAt: T0 + DAY,
    }))
    // Strictly parsable strings stay acceptable input.
    service.saveAccountObservation(observation({
      id: 'glm:string', providerId: 'glm', connectionId: 'glm:default',
      observedAt: T0 - MINUTE, percentUsed: '40', resetsAt: T0 + DAY,
    }))

    const pools = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now: T0 }).pools
    const unknown = pools.pools.find((pool) => pool.id === nullPool.id)
    const measured = pools.pools.find((pool) => pool.id === stringPool.id)
    assert.equal(unknown.officialUsedPct, null, 'null percent is not coerced to 0')
    assert.equal(unknown.official.windows[0].percentUsed, null, 'the window stays visible with a null value')
    assert.equal(measured.officialUsedPct, 40, 'a strictly parsable string percent is accepted')
    assert.equal(pools.tightestPoolId, stringPool.id, 'the unknown pool is not the tightest account')

    const summary = service.entrySummary({ now: T0, timezone: 'UTC' })
    assert.equal(summary.tightest.id, stringPool.id)
    assert.equal(summary.tightest.usedPct, 40)
  } finally {
    service.dispose()
  }
})

test('B: fixed windows follow calendar anchors instead of rolling arithmetic', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    // Weekly resets Monday 00:00 Asia/Shanghai; queried on Tuesday.
    const weekly = service.saveAccount({
      name: 'Weekly', kind: 'subscription', providerId: 'wshop',
      limits: [{ externalKey: 'weekly', unit: 'requests', valueMode: 'exact', value: 100, windowKind: 'fixed', windowSeconds: 604_800, anchor: { weekday: 1, hour: 0, timezone: 'Asia/Shanghai' } }],
      rules: [{ matchProvider: 'wshop', priority: 0 }],
    })
    // Daily resets 05:00 Asia/Shanghai; queried at 12:00 local, so today's
    // window started at 05:00 local and the 03:00 local request is excluded.
    const daily = service.saveAccount({
      name: 'Daily', kind: 'subscription', providerId: 'dshop',
      limits: [{ externalKey: 'daily', unit: 'requests', valueMode: 'exact', value: 10, windowKind: 'fixed', windowSeconds: 86_400, anchor: { hour: 5, timezone: 'Asia/Shanghai' } }],
      rules: [{ matchProvider: 'dshop', priority: 0 }],
    })
    // No anchor and no reset instant: unknown, never a silent rolling window.
    const unknown = service.saveAccount({
      name: 'Unknown fixed', kind: 'subscription', providerId: 'ushop',
      limits: [{ externalKey: 'term', unit: 'requests', valueMode: 'exact', value: 10, windowKind: 'fixed', windowSeconds: 12_345 }],
      rules: [{ matchProvider: 'ushop', priority: 0 }],
    })

    // Weekly: one request on Sunday (previous week), one on Monday evening.
    service.importSession(session({ id: 'w-sun', time: Date.UTC(2026, 7, 30, 4), provider: 'wshop', model: 'w1', input: 1, output: 0 }))
    service.importSession(session({ id: 'w-mon', time: Date.UTC(2026, 7, 31, 12), provider: 'wshop', model: 'w1', input: 1, output: 0 }))
    // Daily: 03:00 local (before today's 05:00 anchor) and 06:00 local.
    service.importSession(session({ id: 'd-early', time: Date.UTC(2026, 7, 31, 19), provider: 'dshop', model: 'd1', input: 1, output: 0 }))
    service.importSession(session({ id: 'd-late', time: Date.UTC(2026, 7, 31, 22), provider: 'dshop', model: 'd1', input: 1, output: 0 }))
    service.importSession(session({ id: 'u-one', time: T0, provider: 'ushop', model: 'u1', input: 1, output: 0 }))

    const pools = service.query({
      filter: { timezone: 'UTC' },
      views: ['pools'],
      now: Date.UTC(2026, 8, 1, 4), // Tuesday 2026-09-01 12:00 Asia/Shanghai
    }).pools
    const windowOf = (productId, key) => pools.pools.find((pool) => pool.id === productId).quotaWindows.find((entry) => entry.externalKey === key)

    assert.equal(windowOf(weekly.id, 'weekly').used, 1, 'the Sunday request is not inside the anchored week')
    assert.equal(windowOf(weekly.id, 'weekly').usedPct, 1)
    assert.equal(windowOf(daily.id, 'daily').used, 1, 'the 02:00 local request is before the anchored day start')
    assert.equal(windowOf(daily.id, 'daily').usedPct, 10)
    const unknownWindow = windowOf(unknown.id, 'term')
    assert.equal(unknownWindow.usedPct, null, 'an unanchored fixed window is unknown, not rolling')
    assert.equal(unknownWindow.used, undefined, 'no usage is attributed to an unknowable window')
  } finally {
    service.dispose()
  }
})

test('C: expired windows stop reporting, stale observations keep their value with age flags', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    for (const provider of ['prov-fresh', 'prov-stale', 'prov-expired']) {
      service.saveAccountConnection({ providerId: provider, connectionId: `${provider}:default`, displayName: provider, configured: true })
    }
    const fresh = service.ensureConnectionAccount(
      { providerId: 'prov-fresh', connectionId: 'prov-fresh:default', displayName: 'Fresh', configured: true },
      { aliases: ['prov-fresh'], attribution: 'connection' },
    )
    const stale = service.ensureConnectionAccount(
      { providerId: 'prov-stale', connectionId: 'prov-stale:default', displayName: 'Stale', configured: true },
      { aliases: ['prov-stale'], attribution: 'connection' },
    )
    const expired = service.ensureConnectionAccount(
      { providerId: 'prov-expired', connectionId: 'prov-expired:default', displayName: 'Expired', configured: true },
      { aliases: ['prov-expired'], attribution: 'connection' },
    )
    service.saveAccountObservation(observation({
      id: 'fresh:1', providerId: 'prov-fresh', connectionId: 'prov-fresh:default',
      observedAt: T0 - MINUTE, percentUsed: 55, resetsAt: T0 + DAY,
    }))
    service.saveAccountObservation(observation({
      id: 'stale:1', providerId: 'prov-stale', connectionId: 'prov-stale:default',
      observedAt: T0 - 31 * MINUTE, percentUsed: 80, resetsAt: T0 + DAY,
    }))
    service.saveAccountObservation(observation({
      id: 'expired:1', providerId: 'prov-expired', connectionId: 'prov-expired:default',
      observedAt: T0 - 2 * MINUTE, percentUsed: 90, resetsAt: T0 - HOUR,
    }))

    const pools = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now: T0 }).pools
    const windowsOf = (productId) => pools.pools.find((pool) => pool.id === productId).official.windows[0]
    const freshWindow = windowsOf(fresh.id)
    assert.equal(freshWindow.stale, false)
    assert.equal(freshWindow.expired, false)
    assert.equal(freshWindow.percentUsed, 55)
    assert.equal(freshWindow.ageMs, MINUTE)

    const staleWindow = windowsOf(stale.id)
    assert.equal(staleWindow.stale, true, 'an observation older than the stale threshold is flagged')
    assert.equal(staleWindow.expired, false)
    assert.equal(staleWindow.percentUsed, 80, 'stale windows keep their measured value')
    assert.ok(staleWindow.ageMs >= 31 * MINUTE)

    const expiredWindow = windowsOf(expired.id)
    assert.equal(expiredWindow.expired, true, 'a past reset instant without a new observation is expired')
    assert.equal(expiredWindow.percentUsed, null, 'the old percentage must not keep showing')
    assert.equal(expiredWindow.expiredSince, T0 - HOUR)
    assert.equal(pools.pools.find((pool) => pool.id === expired.id).officialUsedPct, null)
    assert.equal(pools.tightestPoolId, stale.id, 'the stale 80% account is the tightest measurable')

    assert.equal(OFFICIAL_OBSERVATION_STALE_MS, 30 * MINUTE)
    const summary = service.entrySummary({ now: T0, timezone: 'UTC' })
    assert.equal(summary.tightest.id, stale.id)
    assert.equal(summary.tightest.stale, true)
    assert.equal(summary.tightest.brittle, true)
    assert.equal(summary.tightest.observedAt, T0 - 31 * MINUTE)
    assert.ok(summary.tightest.ageMs >= 31 * MINUTE)
    assert.equal(summary.tightest.expired, false)
    const expiredEntry = summary.pools.find((pool) => pool.id === expired.id)
    assert.equal(expiredEntry.window.expired, true)
    assert.equal(expiredEntry.window.usedPct, null)
    const freshEntry = summary.pools.find((pool) => pool.id === fresh.id)
    assert.equal(freshEntry.window.observedAt, T0 - MINUTE)
    assert.equal(freshEntry.window.stale, false)
    assert.equal(freshEntry.window.brittle, true)
  } finally {
    service.dispose()
  }
})

test('D: seriesBy values days on the same cost seam as the kpis view', () => {
  // Ollama Cloud with an unreported cache split under the default 95% scenario.
  const service = createLedgerService({
    databasePath: ':memory:',
    snapshot: {
      version: 'accuracy-fixture',
      source: 'fixture',
      models: { 'glm-5.3': { inputNano: 1400, outputNano: 4400, cacheReadNano: 260, cacheWriteNano: 0 } },
    },
  })
  try {
    service.importSession({
      header: { version: 0, id: 'seam-1', createdAt: T0, cwd: '/w/seam' },
      events: [
        { type: 'request/header', seq: 0, time: T0, data: { config: { provider: 'ollama-cloud', model: 'glm-5.3' } } },
        { type: 'assistant/message', seq: 1, time: T0 + 1, data: { turn: 0, step: 0, message: { source: { kind: 'model', provider: 'ollama-cloud', model: 'glm-5.3' } }, usage: { inputTokens: 100, outputTokens: 10 } } },
      ],
    })
    service.importSession({
      header: { version: 0, id: 'seam-2', createdAt: T0 + DAY, cwd: '/w/seam' },
      events: [
        { type: 'request/header', seq: 0, time: T0 + DAY, data: { config: { provider: 'ollama-cloud', model: 'glm-5.3' } } },
        { type: 'assistant/message', seq: 1, time: T0 + DAY + 1, data: { turn: 0, step: 0, message: { source: { kind: 'model', provider: 'ollama-cloud', model: 'glm-5.3' } }, usage: { inputTokens: 200, outputTokens: 5 } } },
      ],
    })

    const filter = { timezone: 'UTC', time: { preset: '7d' } }
    const result = service.query({ filter, views: ['kpis', 'seriesBy'], seriesBy: { groupBy: 'pool' }, now: T0 + 2 * DAY })
    assert.equal(result.kpis.cost.currentUsdNano, 161_100)
    assert.equal(result.kpis.cost.reportedUsageUsdNano, 486_000, 'the reported no-scenario bound differs, proving the seam matters')
    const seriesSum = result.seriesBy.days.reduce((sum, day) => sum + Object.values(day.groups).reduce((inner, cell) => inner + cell.currentUsdNano, 0), 0)
    assert.equal(seriesSum, result.kpis.cost.currentUsdNano, 'the stacked chart and the KPI total share one valuation')
    const estimated = result.seriesBy.days.reduce((sum, day) => sum + Object.values(day.groups).reduce((inner, cell) => inner + cell.estimatedCacheReadTokens, 0), 0)
    assert.equal(estimated, result.kpis.cost.estimatedCacheReadTokens)
    assert.equal(estimated, 285)
    const firstCell = Object.values(result.seriesBy.days[0].groups)[0]
    assert.equal(firstCell.cacheEstimationMethod, 'ollama-cloud-assumed-rate-v1')
    assert.equal(firstCell.cacheEstimateRateBps, 9_500)
  } finally {
    service.dispose()
  }
})

test('E: pools expose calendar month, rolling 30 days, and per-product billing cycles', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const account = service.saveAccount({
      name: 'Cycle pool', kind: 'subscription', providerId: 'cycle',
      billing: { resetDay: 12 },
      rules: [{ matchProvider: 'cycle', priority: 0 }],
    })
    service.importSession(session({ id: 'cycle-1', time: T0, provider: 'cycle', model: 'c1', input: 1, output: 0 }))

    const now = Date.UTC(2026, 8, 20, 8)
    const pools = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now }).pools
    assert.equal(pools.calendarMonth.fromMs, Date.UTC(2026, 8, 1), 'the calendar month starts on the 1st')
    assert.equal(pools.calendarMonth.fromMs, pools.month.fromMs, 'month stays an alias of calendarMonth')
    assert.deepEqual(pools.rolling30d, { fromMs: now - 30 * DAY, toMs: now })
    const pool = pools.pools.find((entry) => entry.id === account.id)
    assert.equal(pool.cycle.fromMs, now - 30 * DAY, 'cycle keeps the rolling-30d value')
    assert.equal(pool.cycleKind, 'rolling30d')
    assert.equal(pool.billingCycle.fromMs, Date.UTC(2026, 8, 12), 'the product cycle starts on its own reset day')
    assert.equal(pool.billingCycle.resetLabel, '2026-10-12')
    assert.equal(pool.billingCycle.daysLeft > 0, true)
    assert.ok(pool.billingCycle.elapsedPct > 0 && pool.billingCycle.elapsedPct < 100)

    // A timezone query shifts the local start of the reset day.
    const shanghai = service.query({ filter: { timezone: 'Asia/Shanghai' }, views: ['pools'], now }).pools
    assert.equal(shanghai.pools.find((entry) => entry.id === account.id).billingCycle.fromMs, Date.UTC(2026, 8, 11, 16))

    const summary = service.entrySummary({ now, timezone: 'UTC' })
    assert.equal(summary.monthKind, 'calendar')
  } finally {
    service.dispose()
  }
})

test('F: unknownPrices flags unvalued usage in kpis and non-kpis views', () => {
  const unpriced = createLedgerService({
    databasePath: ':memory:',
    snapshot: { version: 'none', source: 'fixture', models: {} },
  })
  const priced = createLedgerService({
    databasePath: ':memory:',
    snapshot: { version: 'some', source: 'fixture', models: { 'deepseek-chat': { inputNano: 1, outputNano: 2 } } },
  })
  try {
    for (const service of [unpriced, priced]) {
      service.importSession(session({ id: 'price-1', time: T0, input: 10, output: 5 }))
    }
    assert.equal(unpriced.query({ filter: { time: { preset: 'all' } }, views: ['kpis'], now: T0 + DAY }).partial.unknownPrices, true)
    assert.equal(priced.query({ filter: { time: { preset: 'all' } }, views: ['kpis'], now: T0 + DAY }).partial.unknownPrices, false)
    // The same question answered without the kpis view (existence probe).
    assert.equal(unpriced.query({ filter: { time: { preset: 'all' } }, views: ['series'], series: { granularity: 'day' }, now: T0 + DAY }).partial.unknownPrices, true)
    assert.equal(priced.query({ filter: { time: { preset: 'all' } }, views: ['series'], series: { granularity: 'day' }, now: T0 + DAY }).partial.unknownPrices, false)
  } finally {
    unpriced.dispose()
    priced.dispose()
  }
})

test('G: cost rankings value every group and share uses the full filtered total', () => {
  const models = {}
  for (let index = 1; index <= 5; index += 1) models[`cheap-${index}`] = { inputNano: 100, outputNano: 0 }
  models.expensive = { inputNano: 1_000_000, outputNano: 0 }
  const service = createLedgerService({
    databasePath: ':memory:',
    snapshot: { version: 'rank-fixture', source: 'fixture', models },
  })
  try {
    for (let index = 1; index <= 5; index += 1) {
      service.importSession(session({ id: `cheap-${index}`, time: T0, provider: 'rank', model: `cheap-${index}`, input: 10, output: 0 }))
    }
    // One token at a very high unit price: token-volume candidate pruning
    // used to drop it from the cost leaderboard entirely.
    service.importSession(session({ id: 'expensive', time: T0, provider: 'rank', model: 'expensive', input: 1, output: 0 }))

    const cost = service.query({
      filter: { timezone: 'UTC', time: { preset: 'all' } },
      views: ['rankings'],
      ranking: { dimension: 'model', by: 'currentUsdNano', limit: 1 },
      now: T0 + DAY,
    })
    assert.equal(cost.rankings.rows.length, 1)
    assert.equal(cost.rankings.rows[0].key, 'expensive', 'the expensive single-token model tops cost despite tiny volume')
    assert.equal(cost.rankings.rows[0].cost.currentUsdNano, 1_000_000)
    assert.equal(cost.rankings.total, 1_005_000, 'total covers the whole filtered set')
    assert.ok(cost.rankings.rows[0].share < 1, 'share is measured against everything, not the page')

    const volume = service.query({
      filter: { timezone: 'UTC', time: { preset: 'all' } },
      views: ['rankings'],
      ranking: { dimension: 'model', by: 'processingTokens', limit: 2 },
      now: T0 + DAY,
    })
    assert.equal(volume.rankings.total, 51, 'five 10-token models plus one single-token model')
    const pageShare = volume.rankings.rows.reduce((sum, row) => sum + row.share, 0)
    assert.ok(pageShare < 1, 'the share denominator is the full total, not the truncated rows')
    assert.throws(() => service.query({
      filter: { time: { preset: 'all' } },
      views: ['rankings'],
      ranking: { dimension: 'session', by: 'currentUsdNano' },
      now: T0 + DAY,
    }), /not supported for the session dimension/)
  } finally {
    service.dispose()
  }
})

test('H: saving an observation recomputes pools but not the observation-free views', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const account = service.ensureConnectionAccount(
      { providerId: 'ollama-cloud', displayName: 'Ollama Cloud', configured: true },
      { aliases: ['ollama-cloud'] },
    )
    service.importSession(session({ id: 'obs-cache-1', time: T0, provider: 'ollama-cloud', model: 'glm-5.3', input: 10, output: 5 }))
    const spec = {
      filter: { timezone: 'UTC', time: { preset: '30d' } },
      views: ['kpis', 'pools', 'seriesBy', 'rankings'],
      seriesBy: { groupBy: 'pool' },
      ranking: { dimension: 'model', by: 'processingTokens', limit: 5 },
      now: T0 + HOUR,
    }
    const first = service.query(spec)
    const computationsAtWarm = service.diagnostics().baseViewComputations
    assert.equal(computationsAtWarm, 1, 'the dashboard poll computed the base views once')
    assert.equal(service.query({ ...spec }).asOf.revision, first.asOf.revision)
    assert.equal(service.diagnostics().baseViewComputations, computationsAtWarm, 'repeat polls stay cached')

    const revisionBeforeSave = first.asOf.revision
    service.saveAccountObservation(observation({
      id: `ollama-cloud-ui:${T0 + HOUR}`, providerId: 'ollama-cloud', connectionId: 'ollama-cloud:default',
      observedAt: T0 + HOUR, percentUsed: 64, resetsAt: T0 + 6 * DAY,
    }))

    const second = service.query({ ...spec })
    assert.equal(second.asOf.revision, revisionBeforeSave + 1, 'asOf carries the live combined revision')
    assert.equal(second.pools.pools.find((pool) => pool.id === account.id).officialUsedPct, 64, 'pools reflect the fresh observation')
    assert.equal(service.diagnostics().baseViewComputations, computationsAtWarm, 'kpis/seriesBy/rankings were not recomputed')
    assert.equal(second.kpis.processingTokens, first.kpis.processingTokens, 'base view content is unchanged and correct')
  } finally {
    service.dispose()
  }
})
