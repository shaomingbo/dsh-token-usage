import test from 'node:test'
import assert from 'node:assert/strict'
import { createLedgerService } from '../lib/ledger/service.js'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 7, 1, 8)

function session({ id, cwd, time, model = 'deepseek-chat', provider = 'deepseek', connectionId, input = 100, output = 50, cache = 200 }) {
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

test('query returns consistent KPIs, daily series, rankings, and request page from one filter', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    service.importSession(session({ id: 'a', cwd: '/work/repo-a', time: T0 }))
    service.importSession(session({ id: 'b', cwd: '/work/repo-b', time: T0 + DAY, model: 'deepseek-reasoner', input: 30, output: 70, cache: 0 }))

    const result = service.query({
      filter: { timezone: 'UTC', time: { fromMs: T0, toMs: T0 + 2 * DAY } },
      views: ['kpis', 'series', 'rankings', 'page'],
      series: { granularity: 'day' },
      ranking: { dimension: 'project', by: 'processingTokens', limit: 10 },
      page: { entity: 'request', limit: 10 },
      now: T0 + 2 * DAY,
    })

    assert.equal(result.kpis.processingTokens, 450)
    assert.equal(result.kpis.newComputeTokens, 250)
    assert.equal(result.kpis.requests, 2)
    assert.equal(result.series.buckets.reduce((sum, bucket) => sum + bucket.measures.processingTokens, 0), 450)
    assert.equal(Number.isFinite(result.series.buckets[0].fromMs), true)
    assert.equal(Number.isFinite(result.series.buckets[0].toMs), true)
    assert.deepEqual(result.rankings.rows.map((row) => row.key), ['cwd:/work/repo-a', 'cwd:/work/repo-b'])
    assert.deepEqual(result.rankings.rows.map((row) => row.label), ['repo-a', 'repo-b'])
    assert.equal(result.page.rows.length, 2)
    assert.equal(result.page.nextCursor, null)
  } finally {
    service.dispose()
  }
})

test('inspect reports session lineage and request facts without conversation content', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const parent = session({ id: 'parent', cwd: '/work/repo-a', time: T0 })
    const child = session({ id: 'child', cwd: undefined, time: T0 + 1000, input: 40, output: 10, cache: 0 })
    child.header.parentSession = 'parent'
    child.header.origin = 'subagent'
    service.importSession(parent)
    service.importSession(child)

    const report = service.inspect({ kind: 'session', id: 'parent', filter: { timezone: 'UTC' } })
    assert.equal(report.direct.processingTokens, 350)
    assert.equal(report.includingChildren.processingTokens, 400)
    assert.deepEqual(report.children.map((entry) => entry.id), ['child'])
    assert.equal(report.page.rows.length, 1)

    const request = service.inspect({ kind: 'request', id: 'parent:0:0', filter: { timezone: 'UTC' } })
    assert.equal(request.direct.processingTokens, 350)
    assert.equal(request.identity.model, 'deepseek-chat')
    assert.equal(JSON.stringify(request).includes('message'), false)

    const model = service.inspect({ kind: 'model', id: 'deepseek-chat', filter: { timezone: 'UTC', time: { preset: 'all' } } })
    assert.equal(model.direct.processingTokens, 400)
    assert.equal(model.page.entity, 'session')
  } finally {
    service.dispose()
  }
})

test('project identity can merge cwd sources without rewriting request facts', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    service.importSession(session({ id: 'root', cwd: '/work/repo-a', time: T0 }))
    service.importSession(session({ id: 'subdir', cwd: '/work/repo-a/packages/web', time: T0 + 1000 }))
    const project = service.assignProject({ cwd: '/work/repo-a', identityKind: 'git', identityValue: 'github:acme/repo-a', displayName: 'Repo A' })
    service.assignProject({ cwd: '/work/repo-a/packages/web', projectId: project.id })
    service.updateProject(project.id, { displayName: 'Core Repo', hidden: true, color: '#4176e6' })

    const result = service.query({
      filter: { timezone: 'UTC', time: { fromMs: T0, toMs: T0 + DAY } },
      views: ['rankings'],
      ranking: { dimension: 'project' },
      now: T0 + DAY,
    })
    assert.equal(result.rankings.rows.length, 1)
    assert.equal(result.rankings.rows[0].key, project.id)
    assert.equal(result.rankings.rows[0].label, 'Core Repo')
    assert.equal(result.rankings.rows[0].requests, 2)
    assert.equal(service.listProjects().length, 1)

    const report = service.inspect({ kind: 'project', id: project.id })
    assert.equal(report.identity.hidden, true)
    assert.equal(report.identity.color, '#4176e6')
    assert.equal(report.direct.processingTokens, 700)
  } finally {
    service.dispose()
  }
})

test('append-only request corrections affect analytics and can be revoked', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    service.importSession(session({ id: 'corrected', cwd: '/work/repo-a', time: T0 }))
    assert.throws(() => service.correctRequest('corrected:0:0', { inputTokens: -1 }), (error) => error.code === 'invalid-correction')
    const correction = service.correctRequest('corrected:0:0', {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      note: 'provider reported duplicated cache tokens',
    })
    let result = service.query({ filter: { time: { preset: 'all' } }, views: ['kpis'] })
    assert.equal(result.kpis.processingTokens, 15)
    const report = service.inspect({ kind: 'request', id: 'corrected:0:0' })
    assert.equal(report.request.originalProcessingTokens, 350)
    assert.equal(report.request.correction.note, 'provider reported duplicated cache tokens')

    service.revokeCorrection(correction.id)
    result = service.query({ filter: { time: { preset: 'all' } }, views: ['kpis'] })
    assert.equal(result.kpis.processingTokens, 350)
    const audit = service.inspect({ kind: 'request', id: 'corrected:0:0' }).corrections
    assert.equal(audit.length, 2)
    assert.equal(audit.every((entry) => entry.active), true)
    assert.equal(audit[0].note, `reverted correction #${correction.id}`)
  } finally {
    service.dispose()
  }
})

test('analytics mark results sourced from deleted session logs', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    service.importSession(session({ id: 'deleted-source', cwd: '/work/repo-a', time: T0 }))
    assert.equal(service.query({ filter: { time: { preset: 'all' } }, views: ['kpis'] }).partial.sourceDeleted, false)
    service.reconcileSources([])
    const result = service.query({ filter: { time: { preset: 'all' } }, views: ['kpis'] })
    assert.equal(result.kpis.requests, 1)
    assert.equal(result.partial.sourceDeleted, true)
  } finally {
    service.dispose()
  }
})

test('lifetime analytics include anonymous purged days and mark partial dimensions', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    service.importSession(session({ id: 'purged', cwd: '/work/repo-a', time: T0 - 40 * DAY }))
    service.importSession(session({ id: 'kept', cwd: '/work/repo-a', time: T0 }))
    service.purgeBefore(T0 - 20 * DAY, { timezone: 'UTC' })
    const result = service.query({ filter: { timezone: 'UTC', time: { preset: 'all' } }, views: ['kpis', 'series'], series: { granularity: 'auto' }, now: T0 + DAY })
    assert.equal(result.kpis.requests, 2)
    assert.equal(result.kpis.processingTokens, 700)
    assert.equal(result.partial.purgedDays, true)
    assert.equal(result.partial.dimensionBreakdown, true)
  } finally {
    service.dispose()
  }
})

test('monthly budgets report scoped progress and suppress immature forecasts', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    service.importSession(session({ id: 'budgeted', cwd: '/work/repo-a', time: T0 }))
    const budget = service.setBudget({ scope: 'profile', unit: 'processingTokens', periodMonth: '2026-08', limitValue: '1000' })
    const result = service.query({
      filter: { timezone: 'UTC', time: { fromMs: T0 - DAY, toMs: T0 + DAY } },
      views: ['kpis', 'budgets'],
      now: Date.UTC(2026, 7, 2, 12),
    })
    assert.equal(result.budgets.rows[0].id, budget.id)
    assert.equal(result.budgets.rows[0].spent, 350)
    assert.equal(result.budgets.rows[0].progress, 0.35)
    assert.equal(result.budgets.rows[0].forecast, null)
    assert.equal(result.budgets.rows[0].forecastReason, 'insufficient-sample')
  } finally {
    service.dispose()
  }
})

test('session page uses the last session/title and updates after a title-only reimport', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const untitled = session({ id: 'named', cwd: '/work/repo-a', time: T0 })
    service.importSession(untitled)
    const before = service.query({
      filter: { timezone: 'UTC', time: { preset: 'all' } },
      views: ['page'],
      page: { entity: 'session', limit: 10 },
    })
    assert.match(before.page.rows[0].label, /^Session • /)
    assert.equal(before.page.rows[0].sessionTitle, null)

    service.importSession({
      header: untitled.header,
      events: [
        { type: 'session/title', seq: 10, time: T0 + 10, data: { title: 'New Conversation' } },
        { type: 'session/title', seq: 11, time: T0 + 11, data: { title: '用量统计插件交互重构' } },
      ],
    })
    const after = service.query({
      filter: { timezone: 'UTC', time: { preset: 'all' } },
      views: ['page'],
      page: { entity: 'session', limit: 10 },
    })
    assert.equal(after.page.rows[0].label, '用量统计插件交互重构')
    assert.equal(after.page.rows[0].sessionTitle, '用量统计插件交互重构')

    const inspected = service.inspect({ kind: 'session', id: 'named', filter: { timezone: 'UTC' } })
    assert.equal(inspected.identity.title, '用量统计插件交互重构')

    service.ingestEvent(untitled.header, {
      type: 'session/title',
      seq: 12,
      time: T0 + 12,
      data: { title: '部分条目无标题根因排查' },
    })
    const live = service.query({
      filter: { timezone: 'UTC', time: { preset: 'all' } },
      views: ['page'],
      page: { entity: 'session', limit: 10 },
    })
    assert.equal(live.page.rows[0].label, '部分条目无标题根因排查')
    assert.equal(live.page.rows[0].sessionTitle, '部分条目无标题根因排查')
  } finally {
    service.dispose()
  }
})

test('session page can rank by processing tokens instead of last activity', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    service.importSession(session({ id: 'small-recent', cwd: '/work/repo-a', time: T0 + DAY, input: 10, output: 5, cache: 0 }))
    service.importSession(session({ id: 'large-older', cwd: '/work/repo-a', time: T0, input: 1000, output: 500, cache: 2000 }))
    const recent = service.query({
      filter: { timezone: 'UTC', time: { preset: 'all' } },
      views: ['page'],
      page: { entity: 'session', limit: 6 },
    })
    assert.deepEqual(recent.page.rows.map((row) => row.id), ['small-recent', 'large-older'])

    const largest = service.query({
      filter: { timezone: 'UTC', time: { preset: 'all' } },
      views: ['page'],
      page: { entity: 'session', limit: 6, orderBy: 'processingTokens' },
    })
    assert.deepEqual(largest.page.rows.map((row) => row.id), ['large-older', 'small-recent'])
    assert.equal(largest.page.rows[0].processingTokens > largest.page.rows[1].processingTokens, true)

    assert.throws(
      () => service.query({
        filter: { timezone: 'UTC', time: { preset: 'all' } },
        views: ['page'],
        page: { entity: 'session', orderBy: 'not-a-metric' },
      }),
      /unsupported session page order/,
    )
  } finally {
    service.dispose()
  }
})

test('session exploration and activity views remain content-neutral', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    service.importSession(session({ id: 'session-a', cwd: '/work/repo-a', time: T0 }))
    service.importSession(session({ id: 'session-b', cwd: '/work/repo-a', time: T0 + 3600_000 }))
    service.importSession(session({ id: 'session-c', cwd: '/work/repo-a', time: T0 + DAY + 2 * 3600_000 }))
    service.importSession(session({ id: 'session-older', cwd: '/work/repo-a', time: T0 - 100 * DAY }))
    const result = service.query({
      filter: { timezone: 'UTC', time: { fromMs: T0, toMs: T0 + 2 * DAY } },
      views: ['page', 'activity'],
      page: { entity: 'session', limit: 2 },
      now: T0 + 2 * DAY,
    })
    assert.deepEqual(result.page.rows.map((row) => row.id), ['session-c', 'session-b'])
    assert.match(result.page.rows[0].label, /^Session • /)
    assert.equal(result.page.rows[0].label.includes('repo'), false)
    assert.equal(result.activity.calendar.reduce((sum, day) => sum + day.requests, 0), 4)
    assert.equal(result.activity.calendar.every((day) => Number.isFinite(day.fromMs) && Number.isFinite(day.toMs)), true)
    assert.equal(result.activity.matrix.reduce((sum, cell) => sum + cell.requests, 0), 3)
  } finally {
    service.dispose()
  }
})

test('series auto-granularity keeps long windows bounded', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    service.importSession(session({ id: 'old', cwd: '/work/repo-a', time: T0 - 180 * DAY }))
    service.importSession(session({ id: 'new', cwd: '/work/repo-a', time: T0 }))
    const result = service.query({
      filter: { timezone: 'UTC', time: { fromMs: T0 - 200 * DAY, toMs: T0 + DAY } },
      views: ['series'],
      series: { granularity: 'auto' },
      now: T0 + DAY,
    })
    assert.equal(result.series.granularity, 'month')
    assert.equal(result.series.buckets.length <= 12, true)
    assert.equal(result.series.buckets.reduce((sum, bucket) => sum + bucket.measures.processingTokens, 0), 700)
  } finally {
    service.dispose()
  }
})

test('all-time auto series never exceeds the 48-bucket payload bound', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    for (let year = 2020; year <= 2026; year += 1) {
      for (let month = 0; month < 12; month += 1) service.importSession(session({ id: `bound-${year}-${month}`, cwd: '/work/repo-a', time: Date.UTC(year, month, 2) }))
    }
    const result = service.query({ filter: { timezone: 'UTC', time: { preset: 'all' } }, views: ['series'], series: { granularity: 'auto' }, now: Date.UTC(2026, 11, 31) })
    assert.equal(result.series.buckets.length <= 48, true)
  } finally {
    service.dispose()
  }
})

test('request pages use a stable cursor rather than offset', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    for (let index = 0; index < 3; index += 1) service.importSession(session({ id: `page-${index}`, cwd: '/work/repo-a', time: T0 + index * 1000 }))
    const first = service.query({ filter: { time: { preset: 'all' } }, views: ['page'], page: { entity: 'request', limit: 2 } }).page
    const second = service.query({ filter: { time: { preset: 'all' } }, views: ['page'], page: { entity: 'request', limit: 2, cursor: first.nextCursor } }).page
    assert.deepEqual(first.rows.map((row) => row.sessionId), ['page-2', 'page-1'])
    assert.deepEqual(second.rows.map((row) => row.sessionId), ['page-0'])
    assert.equal(second.nextCursor, null)
  } finally {
    service.dispose()
  }
})

test('query cost keeps original valuation immutable while aliases change current rules', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    service.importSession(session({ id: 'valued', cwd: '/work/repo-a', time: T0, model: 'deepseek-reasoner', input: 100, output: 50, cache: 0 }))
    const before = service.query({ filter: { time: { preset: 'all' } }, views: ['kpis'] }).kpis.cost
    service.setAlias('deepseek-reasoner', 'deepseek-chat')
    const after = service.query({ filter: { time: { preset: 'all' } }, views: ['kpis'] }).kpis.cost
    assert.equal(after.originalUsdNano, before.originalUsdNano)
    assert.notEqual(after.currentUsdNano, before.currentUsdNano)
    assert.equal(after.coverage, 1)
    service.importSession(session({ id: 'canonical', cwd: '/work/repo-a', time: T0 + 1000, model: 'deepseek-chat', input: 10, output: 10, cache: 0 }))
    const models = service.query({ filter: { time: { preset: 'all' } }, views: ['rankings'], ranking: { dimension: 'model' } }).rankings.rows
    assert.deepEqual(models.map((row) => row.key), ['deepseek-chat'])
  } finally {
    service.dispose()
  }
})

test('previous-period comparison and deterministic insights expose their evidence', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    service.importSession(session({ id: 'previous', cwd: '/work/repo-a', time: T0 - DAY, input: 40, output: 60, cache: 0 }))
    service.importSession(session({ id: 'current', cwd: '/work/repo-a', time: T0, model: 'unpriced-model' }))
    const result = service.query({
      filter: { timezone: 'UTC', time: { fromMs: T0, toMs: T0 + DAY } },
      views: ['kpis', 'rankings', 'insights'],
      ranking: { dimension: 'project' },
      compare: { kind: 'previous-period' },
      now: T0 + DAY,
    })
    assert.equal(result.kpis.processingTokens, 350)
    assert.equal(result.kpis.compare.processingTokens, 100)
    assert.equal(result.kpis.delta.processingTokens, 2.5)
    assert.equal(result.insights.length <= 3, true)
    assert.equal(result.insights[0].id, 'price-coverage')
    assert.equal(result.insights[0].params.coverage, 0)
    assert.equal(result.insights.some((insight) => insight.id === 'concentration'), true)
  } finally {
    service.dispose()
  }
})

test('historical import backfills request duration and end reason when logged', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    service.importSession({
      header: { version: 0, id: 'timed', createdAt: T0, cwd: '/work/repo-a' },
      events: [
        { type: 'request/header', seq: 0, time: T0, data: { config: { provider: 'deepseek', model: 'deepseek-chat' } } },
        { type: 'step/start', seq: 1, time: T0 + 1000, data: { turn: 0, step: 0 } },
        { type: 'assistant/message', seq: 2, time: T0 + 5000, data: { turn: 0, step: 0, message: { source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } }, usage: { inputTokens: 10, outputTokens: 5 } } },
        { type: 'step/end', seq: 3, time: T0 + 9000, data: { turn: 0, step: 0, reason: 'max-tokens' } },
      ],
    })
    const report = service.inspect({ kind: 'request', id: 'timed:0:0' })
    assert.equal(report.request.durationMs, 8000)
    assert.equal(report.request.endReason, 'max-tokens')
    assert.equal(report.request.failureType, null)
  } finally {
    service.dispose()
  }
})

test('today preset uses local calendar boundaries rather than a rolling 24 hours', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const now = Date.UTC(2026, 7, 1, 1)
    service.importSession(session({ id: 'local-yesterday', cwd: '/work/repo-a', time: Date.UTC(2026, 6, 31, 15) }))
    service.importSession(session({ id: 'local-today', cwd: '/work/repo-a', time: Date.UTC(2026, 6, 31, 23) }))
    const result = service.query({ filter: { timezone: 'Asia/Shanghai', time: { preset: 'today' } }, views: ['kpis'], now })
    assert.equal(result.kpis.requests, 1)
  } finally {
    service.dispose()
  }
})

test('constrain narrows dimensions with OR within and AND across', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const base = { timezone: 'Asia/Shanghai', time: { preset: '30d' }, project: ['repo-a'] }
    const sameDimension = service.constrain(base, { op: 'add', dimension: 'project', key: 'repo-b' })
    assert.deepEqual(sameDimension.project, ['repo-a', 'repo-b'])
    assert.deepEqual(sameDimension.time, { preset: '30d' })

    const crossDimension = service.constrain(sameDimension, { op: 'add', dimension: 'model', key: 'gpt-5.6-sol' })
    assert.deepEqual(crossDimension.project, ['repo-a', 'repo-b'])
    assert.deepEqual(crossDimension.model, ['gpt-5.6-sol'])

    const reset = service.constrain(crossDimension, { op: 'reset' })
    assert.deepEqual(reset, {})
  } finally {
    service.dispose()
  }
})

test('plans attribute requests to pools with objective cycle math and rates', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    // Two pools: a subscription for glm models and a credit balance for relays.
    const openai = service.savePlan({ kind: 'sub', name: 'OpenAI Plus', priceUsd: 20, quotaUnit: 'newCompute', quotaValue: 1000, resetDay: 1 })
    const relay = service.savePlan({ kind: 'credit', name: 'OpenRouter', balanceUsd: 21.3, expiryDay: '2026-10-15' })
    service.savePlanRules(openai.id, [{ matchProvider: 'openai*', priority: 0 }])
    service.savePlanRules(relay.id, [{ matchProvider: 'relay-*', priority: 0 }])

    const now = Date.UTC(2026, 7, 30, 12)
    service.importSession(session({ id: 'p1', cwd: '/w/a', time: now - 2 * DAY, provider: 'openai-codex', model: 'gpt-5.6', input: 300, output: 100 }))
    service.importSession(session({ id: 'p2', cwd: '/w/a', time: now - 1 * DAY, provider: 'relay-grok', model: 'grok-4.6', input: 40, output: 10 }))
    service.importSession(session({ id: 'p3', cwd: '/w/a', time: now - 1 * DAY, provider: 'deepseek', model: 'glm-5.3-flash', input: 500, output: 250 }))

    const result = service.query({
      filter: { timezone: 'UTC' },
      views: ['pools', 'seriesBy'],
      seriesBy: { groupBy: 'pool' },
      now,
    })
    assert.equal(result.pools.configured, true)
    // Legacy plans flow through the v5 → account projection: pool ids are the
    // projected product ids.
    const poolId = (plan) => `legacy-plan:${plan.id}`
    const openaiPool = result.pools.pools.find((pool) => pool.id === poolId(openai))
    const relayPool = result.pools.pools.find((pool) => pool.id === poolId(relay))
    assert.equal(openaiPool.kind, 'subscription')
    assert.equal(openaiPool.sourceKind, 'legacy_v5_manual')
    assert.equal(openaiPool.kpis.newComputeTokens, 400)
    assert.equal(openaiPool.usedPct, 40)
    const openaiWindow = openaiPool.quotaWindows.find((entry) => entry.externalKey === 'primary')
    assert.equal(openaiWindow.usedPct, 40)
    // Cycle started 2026-08-01; the two sample days fall inside the last 7 days.
    assert.equal(openaiPool.pace.ratePerDay > 0, true)
    assert.equal(openaiWindow.leftoverAtReset > 0, true)
    assert.equal(relayPool.kind, 'prepaid')
    assert.equal(relayPool.balanceUsd, 21.3)
    assert.equal(relayPool.leftoverAtExpiryUsd > 0, true)
    // glm traffic did not match any rule → unassigned bucket over the last 30 days.
    assert.equal(result.pools.unassigned.newComputeTokens, 750)
    assert.equal(result.pools.tightestPoolId, poolId(openai))

    // seriesBy matrix: day keys with per-pool cells, plus the unassigned group.
    const groups = result.seriesBy.groups.map((group) => group.id)
    assert.equal(groups.includes(poolId(openai)), true)
    assert.equal(groups.includes('unassigned'), true)
    const totalProcessing = result.seriesBy.days.reduce((sum, day) =>
      sum + Object.values(day.groups).reduce((inner, cell) => inner + cell.processingTokens, 0), 0)
    // p1 300+100+200 cache, p2 40+10+200, p3 500+250+200 — cache rides in processing.
    assert.equal(totalProcessing, 600 + 250 + 950)

    // Model stacking groups by model and rankings can sort by current cost.
    const byModel = service.query({ filter: { timezone: 'UTC', time: { fromMs: now - 3 * DAY, toMs: now } }, views: ['seriesBy'], seriesBy: { groupBy: 'model' }, now })
    assert.equal(byModel.seriesBy.groups.some((group) => group.id === 'glm-5.3-flash'), true)
    const models = service.query({ filter: { timezone: 'UTC', time: { fromMs: now - 3 * DAY, toMs: now } }, views: ['rankings'], ranking: { dimension: 'model', by: 'currentUsdNano', limit: 10 }, now })
    assert.equal(models.rankings.rows.length, 3)
    assert.equal(typeof models.rankings.rows[0].cost.currentUsdNano, 'number')
    assert.equal(typeof models.rankings.rows[0].poolId, 'string')
    // Pool dimension ranking and pool filters narrow consistently.
    const poolRank = service.query({ filter: { timezone: 'UTC', time: { fromMs: now - 3 * DAY, toMs: now } }, views: ['rankings'], ranking: { dimension: 'pool', by: 'newComputeTokens' }, now })
    assert.equal(poolRank.rankings.rows.some((row) => row.key === 'unassigned'), true)
    const narrowed = service.query({ filter: { timezone: 'UTC', time: { fromMs: now - 3 * DAY, toMs: now }, pool: [poolId(openai)] }, views: ['kpis'], now })
    assert.equal(narrowed.kpis.newComputeTokens, 400)

    // Rule changes re-attribute on the next revision without touching history.
    service.savePlanRules(openai.id, [{ matchProvider: 'openai*', priority: 0 }, { matchModel: 'grok*', priority: 1 }])
    const after = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now })
    const relayAfter = after.pools.pools.find((pool) => pool.id === poolId(relay))
    // openai* still wins for relay-grok by priority 0, so relay keeps its request.
    assert.equal(relayAfter.kpis.newComputeTokens, 50)

    const summary = service.entrySummary({ now, timezone: 'UTC' })
    assert.equal(summary.configured, true)
    assert.equal(summary.tightest.id, poolId(openai))
    assert.equal(typeof summary.month.daysLeft, 'number')
    // Every pool carries its own primary window so the sidebar entry can
    // render a pinned account; the tightest pool's window matches the
    // top-level tightest selection.
    const tightestEntry = summary.pools.find((pool) => pool.id === summary.tightest.id)
    assert.notEqual(tightestEntry, undefined)
    assert.equal(tightestEntry.window != null, true)
    assert.equal(tightestEntry.window.usedPct, summary.tightest.usedPct)
    assert.equal(tightestEntry.window.label, summary.tightest.windowLabel)
    assert.equal(tightestEntry.window.resetsAt, summary.tightest.resetsAt)
  } finally {
    service.dispose()
  }
})

test('plans CRUD validates input and empty pools report unconfigured', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const empty = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now: T0 })
    assert.equal(empty.pools.configured, false)
    assert.equal(service.entrySummary({ now: T0, timezone: 'UTC' }).configured, false)

    assert.throws(() => service.savePlan({ kind: 'team', name: 'x' }), /invalid plan kind/)
    assert.throws(() => service.savePlan({ kind: 'sub', name: '', quotaValue: 10 }), /plan name is required/)
    assert.throws(() => service.savePlan({ kind: 'sub', name: 'x', quotaValue: -1 }), /quotaValue must be positive/)
    assert.throws(() => service.savePlan({ kind: 'sub', name: 'x', quotaValue: 10, resetDay: 31 }), /resetDay/)

    const plan = service.savePlan({ kind: 'sub', name: 'DeepSeek Pro', priceUsd: 20, quotaValue: 60e6 })
    assert.throws(() => service.savePlanRules(plan.id, [{}]), /matchProvider or matchModel is required/)
    assert.throws(() => service.savePlanRules('plan:missing', [{ matchModel: 'x' }]), /plan not found/)
    service.savePlanRules(plan.id, [{ matchModel: 'glm-*', priority: 0 }])
    const listed = service.listPlans()
    assert.equal(listed.length, 1)
    assert.equal(listed[0].rules.length, 1)
    assert.equal(listed[0].quotaValue, 60e6)

    service.archivePlan(plan.id)
    assert.equal(service.listPlans()[0].archived, true)
    const afterArchive = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now: T0 })
    assert.equal(afterArchive.pools.configured, false)
    service.archivePlan(plan.id, { archived: false })
    assert.equal(service.listPlans()[0].archived, false)
  } finally {
    service.dispose()
  }
})

test('rolling 5-hour windows ignore usage older than five hours', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const plan = service.savePlan({ kind: 'sub', name: 'Codex', quotaValue: 1000, windowKind: '5h' })
    service.savePlanRules(plan.id, [{ matchProvider: 'openai*', priority: 0 }])
    const now = Date.UTC(2026, 7, 30, 12)
    service.importSession(session({ id: 'old', cwd: '/w/a', time: now - 6 * 3_600_000, provider: 'openai-codex', model: 'gpt', input: 800, output: 0, cache: 0 }))
    service.importSession(session({ id: 'fresh', cwd: '/w/a', time: now - 1 * 3_600_000, provider: 'openai-codex', model: 'gpt', input: 100, output: 0, cache: 0 }))
    const result = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now })
    const pool = result.pools.pools[0]
    const window = pool.quotaWindows.find((entry) => entry.externalKey === 'primary')
    assert.equal(window.windowKind, 'rolling')
    assert.equal(window.windowSeconds, 18000)
    // Only the fresh sample lands inside the rolling window; the 30-day kpis
    // still see both.
    assert.equal(window.used, 100)
    assert.equal(window.usedPct, 10)
    assert.equal(pool.usedPct, 10)
    assert.equal(pool.kpis.newComputeTokens, 900)
    assert.equal(window.leftoverAtReset, null)
  } finally {
    service.dispose()
  }
})

test('zero-config connection accounts attribute local usage and respect archives', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const now = Date.UTC(2026, 7, 30, 12)
    service.importSession(session({ id: 'c1', cwd: '/w/a', time: now - DAY, provider: 'openai-codex', model: 'gpt-5.6', input: 300, output: 100 }))
    service.importSession(session({ id: 'c2', cwd: '/w/a', time: now - DAY, provider: 'zai-coding-cn', model: 'glm-5.3', input: 50, output: 50 }))

    // A configured connection becomes an account with default rules, once.
    const ensured = service.ensureConnectionAccount(
      { providerId: 'openai-codex', displayName: 'ChatGPT Plus/Pro', configured: true },
      { aliases: ['openai-codex', 'openai'] },
    )
    assert.equal(ensured.archived, false)
    const again = service.ensureConnectionAccount(
      { providerId: 'openai-codex', displayName: 'ChatGPT Plus/Pro', configured: true },
      { aliases: ['openai-codex', 'openai'] },
    )
    assert.equal(again.id, ensured.id)

    const pools = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now })
    assert.equal(pools.pools.configured, true)
    const codex = pools.pools.pools.find((pool) => pool.id === ensured.id)
    assert.equal(codex.kind, 'track_only')
    assert.equal(codex.sourceKind, 'connection')
    assert.equal(codex.kpis.newComputeTokens, 400)
    assert.equal(pools.pools.unassigned.newComputeTokens, 100)

    // Archive: the connection account disappears and is never resurrected.
    service.archiveAccount(ensured.id, { archived: true })
    const revived = service.ensureConnectionAccount(
      { providerId: 'openai-codex', displayName: 'ChatGPT Plus/Pro', configured: true },
      { aliases: ['openai-codex', 'openai'] },
    )
    assert.equal(revived.archived, true)
    const afterArchive = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now })
    assert.equal(afterArchive.pools.pools.some((pool) => pool.id === ensured.id), false)
    assert.equal(afterArchive.pools.unassigned.newComputeTokens, 500)

    // The default rules carry the connection_default source kind.
    const accounts = service.listAccounts()
    const account = accounts.find((entry) => entry.id === ensured.id)
    assert.equal(account.archived, true)
    assert.ok(account.rules.every((rule) => rule.sourceKind === 'connection_default'))
  } finally {
    service.dispose()
  }
})

test('connection provenance attributes pooled provider traffic exactly and leaves legacy rows unassigned', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const now = Date.UTC(2026, 7, 30, 12)
    service.saveAccountConnection({ providerId: 'antigravity', connectionId: 'connection-a', displayName: 'Account A', configured: true })
    service.saveAccountConnection({ providerId: 'antigravity', connectionId: 'connection-b', displayName: 'Account B', configured: true })
    const first = service.ensureConnectionAccount(
      { providerId: 'antigravity', connectionId: 'connection-a', displayName: 'Account A', configured: true },
      { aliases: ['antigravity'], attribution: 'connection' },
    )
    const second = service.ensureConnectionAccount(
      { providerId: 'antigravity', connectionId: 'connection-b', displayName: 'Account B', configured: true },
      { aliases: ['antigravity'], attribution: 'connection' },
    )
    service.importSession(session({
      id: 'ag-a', cwd: '/w/a', time: now - DAY, provider: 'antigravity', model: 'gemini',
      connectionId: 'connection-a', input: 80, output: 20, cache: 0,
    }))
    service.importSession(session({
      id: 'ag-b', cwd: '/w/a', time: now - DAY, provider: 'antigravity', model: 'gemini',
      connectionId: 'connection-b', input: 150, output: 50, cache: 0,
    }))
    service.importSession(session({
      id: 'ag-legacy', cwd: '/w/a', time: now - DAY, provider: 'antigravity', model: 'gemini',
      input: 225, output: 75, cache: 0,
    }))

    const result = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now })
    assert.equal(result.pools.pools.find((pool) => pool.id === first.id).kpis.newComputeTokens, 100)
    assert.equal(result.pools.pools.find((pool) => pool.id === second.id).kpis.newComputeTokens, 200)
    assert.equal(result.pools.unassigned.newComputeTokens, 300)
  } finally {
    service.dispose()
  }
})

test('exact connection attribution outranks provider fallbacks', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const fallbackConnection = { providerId: 'antigravity', connectionId: 'fallback', displayName: 'Fallback', configured: true }
    const exactConnection = { providerId: 'antigravity', connectionId: 'connection-a', displayName: 'Account A', configured: true }
    service.saveAccountConnection(fallbackConnection)
    service.saveAccountConnection(exactConnection)
    const fallback = service.ensureConnectionAccount(fallbackConnection, { aliases: ['antigravity'], attribution: 'provider' })
    const exact = service.ensureConnectionAccount(exactConnection, { aliases: ['antigravity'], attribution: 'connection' })
    service.importSession(session({
      id: 'exact-rule', cwd: '/w/a', time: T0, provider: 'antigravity', model: 'gemini',
      connectionId: 'connection-a', input: 80, output: 20, cache: 0,
    }))
    service.importSession(session({
      id: 'fallback-rule', cwd: '/w/a', time: T0 + 1, provider: 'antigravity', model: 'gemini',
      input: 30, output: 20, cache: 0,
    }))

    const result = service.query({ filter: { timezone: 'UTC', time: { preset: 'all' } }, views: ['pools'], now: T0 + DAY })
    assert.equal(result.pools.pools.find((pool) => pool.id === exact.id).kpis.newComputeTokens, 100)
    assert.equal(result.pools.pools.find((pool) => pool.id === fallback.id).kpis.newComputeTokens, 50)
  } finally {
    service.dispose()
  }
})

test('live assistant messages retain connection provenance in request views', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const header = { version: 0, id: 'live-connection', createdAt: T0, cwd: '/w/a' }
    service.ingestEvent(header, {
      type: 'request/header', seq: 0, time: T0,
      data: { config: { provider: 'antigravity', model: 'gemini' } },
    })
    service.ingestEvent(header, {
      type: 'assistant/message', seq: 1, time: T0 + 1,
      data: {
        turn: 0, step: 0,
        message: { source: { kind: 'model', provider: 'antigravity', model: 'gemini', connectionId: 'connection-b' } },
        usage: { inputTokens: 12, outputTokens: 3 },
      },
    })

    const result = service.query({
      filter: { timezone: 'UTC', time: { preset: 'all' } },
      views: ['page'],
      page: { entity: 'request', limit: 10 },
    })
    assert.equal(result.page.rows[0].connectionId, 'connection-b')
  } finally {
    service.dispose()
  }
})

test('stock DSH replay response ids retain plugin-owned connection provenance', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const connectionId = 'connection-b'
    const responseId = `chatcmpl-dsh-antigravity-v1.${Buffer.from(connectionId).toString('base64url')}.fixture`
    const header = { version: 0, id: 'live-replay-connection', createdAt: T0, cwd: '/w/a' }
    service.ingestEvent(header, {
      type: 'assistant/message', seq: 1, time: T0 + 1,
      data: {
        turn: 0, step: 0,
        message: {
          source: {
            kind: 'model', provider: 'antigravity', model: 'gemini',
            replayState: {
              response: { kind: 'pi-ai', version: 2, api: 'openai-completions', provider: 'antigravity', responseId },
              blocks: [{ type: 'text' }],
            },
          },
        },
        usage: { inputTokens: 12, outputTokens: 3 },
      },
    })
    service.ingestEvent(header, {
      type: 'assistant/message', seq: 2, time: T0 + 2,
      data: {
        turn: 0, step: 0,
        message: { source: { kind: 'model', provider: 'antigravity', model: 'gemini' } },
        usage: { inputTokens: 12, outputTokens: 3 },
      },
    })

    const result = service.query({
      filter: { timezone: 'UTC', time: { preset: 'all' } },
      views: ['page'],
      page: { entity: 'request', limit: 10 },
    })
    assert.equal(result.page.rows[0].connectionId, connectionId)
  } finally {
    service.dispose()
  }
})

test('connection-account reconciliation removes stale system attribution rules', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const connection = { providerId: 'antigravity', connectionId: 'connection-a', displayName: 'Account A', configured: true }
    service.saveAccountConnection(connection)
    const account = service.ensureConnectionAccount(connection, { aliases: ['antigravity'], attribution: 'provider' })
    assert.equal(service.listAccounts().find((item) => item.id === account.id).rules.length, 1)

    service.ensureConnectionAccount(connection, { aliases: ['antigravity'], attribution: 'none' })

    assert.deepEqual(service.listAccounts().find((item) => item.id === account.id).rules, [])
  } finally {
    service.dispose()
  }
})

test('saving a GLM adapter observation without registry providerId does not throw ERR_INVALID_ARG_TYPE', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const now = Date.UTC(2026, 7, 30, 12)
    const saved = service.saveAccountObservation({
      id: `glm:glm:default:${now}`,
      connectionId: 'glm:default',
      observedAt: now,
      source: 'official_plugin_internal_api',
      brittle: true,
      complete: false,
      windows: [],
      limits: [],
      warnings: ['No quota entries were published'],
    })
    assert.equal(saved.connectionId, 'glm:default')
  } finally {
    service.dispose()
  }
})

test('a later empty official_response does not hide an earlier official_ui observation', () => {
  // Connection accounts are keyed `provider:default`; adapter scrapes historically
  // stored `provider`. Both must join, and an API-key probe with no windows
  // must not hide Session usage 0%.
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const now = Date.UTC(2026, 7, 30, 12)
    const account = service.ensureConnectionAccount(
      { providerId: 'ollama-cloud', displayName: 'Ollama Cloud', configured: true },
      { aliases: ['ollama-cloud', 'ollama'] },
    )
    service.saveAccountObservation({
      id: `ollama-cloud-ui:${now - 60_000}`, providerId: 'ollama-cloud', connectionId: 'ollama-cloud',
      observedAt: now - 60_000, source: 'official_ui', brittle: true, complete: true, quotaApplicable: true,
      windows: [
        { id: 'ollama-cloud-window:session-hourly', kind: 'rate', label: 'Session usage', durationMs: 18_000_000, resetsAt: now + 5 * 3_600_000 },
        { id: 'ollama-cloud-window:weekly', kind: 'rolling', label: 'Weekly', durationMs: 604_800_000, resetsAt: now + 6 * DAY },
      ],
      limits: [
        { id: 'ollama-cloud-limit:session-hourly', windowId: 'ollama-cloud-window:session-hourly', metric: 'cloud_usage', unit: 'percent', mode: 'dynamic', percentUsed: 0, observedAt: now - 60_000 },
        { id: 'ollama-cloud-limit:weekly', windowId: 'ollama-cloud-window:weekly', metric: 'cloud_usage', unit: 'percent', mode: 'dynamic', percentUsed: 32.7, observedAt: now - 60_000 },
      ],
      warnings: [], metadata: null,
    })
    service.saveAccountObservation({
      id: `ollama-cloud:${now}`, providerId: 'ollama-cloud', connectionId: 'ollama-cloud',
      observedAt: now, source: 'official_response', brittle: false, complete: false, quotaApplicable: true,
      windows: [], limits: [],
      warnings: ['Quota limits were not published by this response'], metadata: { credentialStatus: 'unverified' },
    })
    const pools = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now })
    const cloud = pools.pools.pools.find((pool) => pool.id === account.id)
    assert.equal(cloud.official.sourceKind, 'official_ui')
    assert.deepEqual(cloud.official.windows.map((window) => [window.label, window.percentUsed]), [
      ['Session usage', 0],
      ['Weekly', 32.7],
    ])
    const detail = service.inspect({ kind: 'pool', id: account.id, filter: { timezone: 'UTC' }, now })
    assert.equal(detail.account.official.windows.length, 2)
    assert.equal(detail.account.official.windows[0].percentUsed, 0)
  } finally {
    service.dispose()
  }
})

test('a template account without a link is claimed by its provider connection so official windows reach it', () => {
  // Regression: a wizard-created GLM account kept connection_id NULL forever,
  // so glm:default observations (56% / 98%) never rendered and 刷新观察 looked
  // broken. The claim must link the account and be idempotent.
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const now = Date.UTC(2026, 7, 30, 12)
    const saved = service.saveAccount({ name: 'GLM Coding Plan', templateId: 'glm-coding-plan', providerId: 'glm' })
    assert.equal(service.listAccounts().find((item) => item.id === saved.id).connectionId, null)

    const linked = service.linkAccountConnection({ providerId: 'glm', connectionId: 'glm:default' })
    assert.equal(linked.linked, true)
    assert.equal(linked.id, saved.id)
    assert.equal(service.listAccounts().find((item) => item.id === saved.id).connectionId, 'glm:default')

    const repeat = service.linkAccountConnection({ providerId: 'glm', connectionId: 'glm:default' })
    assert.equal(repeat.linked, false)

    service.saveAccountObservation({
      id: `glm:glm:default:${now}`, providerId: 'glm', connectionId: 'glm:default',
      observedAt: now, source: 'official_plugin_internal_api', brittle: true, complete: true,
      windows: [{ id: 'glm-window:5', kind: 'rolling', label: '5小时', durationMs: 18_000_000, resetsAt: now + 3_600_000 }],
      limits: [{ id: 'glm-limit:5', windowId: 'glm-window:5', metric: 'TOKENS_LIMIT', unit: 'count', mode: 'dynamic', percentUsed: 56, observedAt: now }],
      warnings: [], metadata: null,
    })
    const pools = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now: now + 1_000 })
    const glm = pools.pools.pools.find((pool) => pool.id === saved.id)
    assert.equal(glm.official.sourceKind, 'official_plugin_internal_api')
    assert.equal(glm.officialUsedPct, 56)
    const detail = service.inspect({ kind: 'pool', id: saved.id, filter: { timezone: 'UTC' }, now: now + 1_000 })
    assert.equal(detail.account.official.windows[0].percentUsed, 56)

    // Archived accounts are never claimed.
    service.archiveAccount(saved.id, { archived: true })
    service.saveAccount({ name: 'GLM Coding Plan II', templateId: 'glm-coding-plan', providerId: 'glm' })
    const claimed = service.linkAccountConnection({ providerId: 'glm', connectionId: 'glm:default' })
    assert.equal(claimed.linked, true)
    assert.notEqual(claimed.id, saved.id)
  } finally {
    service.dispose()
  }
})

test('a fresh observation is visible to pool summaries immediately, not one cache bucket late', () => {
  // Regression: saveAccountObservation never bumped the analytics revision,
  // so the revision-keyed pools cache served the pre-refresh official
  // percentages until the next clock bucket rolled over — the detail
  // refresh followed by "go back" showed a stale progress bar. Observations
  // bump the combined revision only; the projection rebuild is reserved for
  // projection changes (see test/analytics-caching.test.js).
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const bucketStart = 1_800_000 // both reads stay inside the same 60s bucket
    const account = service.ensureConnectionAccount(
      { providerId: 'ollama-cloud', displayName: 'Ollama Cloud', configured: true },
      { aliases: ['ollama-cloud', 'ollama'] },
    )
    const observation = (id, percentUsed, observedAt) => ({
      id: `ollama-cloud-ui:${id}`, providerId: 'ollama-cloud', connectionId: 'ollama-cloud:default',
      observedAt, source: 'official_ui', brittle: true, complete: true, quotaApplicable: true,
      windows: [{ id: 'ollama-cloud-window:weekly', kind: 'rolling', label: 'Weekly', durationMs: 604_800_000, resetsAt: observedAt + 6 * DAY }],
      limits: [{ id: 'ollama-cloud-limit:weekly', windowId: 'ollama-cloud-window:weekly', metric: 'cloud_usage', unit: 'percent', mode: 'dynamic', percentUsed, observedAt }],
      warnings: [], metadata: null,
    })
    service.saveAccountObservation(observation('before', 20, bucketStart))
    const readAt = (ms) => service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now: ms })
      .pools.pools.find((pool) => pool.id === account.id).officialUsedPct
    assert.equal(readAt(bucketStart + 1_000), 20)

    service.saveAccountObservation(observation('after', 64, bucketStart + 2_000))
    assert.equal(readAt(bucketStart + 3_000), 64, 'same-bucket pool read must observe the just-saved refresh')
    assert.equal(service.inspect({ kind: 'pool', id: account.id, filter: { timezone: 'UTC' }, now: bucketStart + 4_000 })
      .account.official.windows[0].percentUsed, 64)
  } finally {
    service.dispose()
  }
})

test('Ollama Cloud cost uses the configured cache scenario in totals and account detail', () => {
  const service = createLedgerService({
    databasePath: ':memory:',
    snapshot: {
      version: 'cache-fixture',
      source: 'fixture',
      models: { 'glm-5.3': { inputNano: 1400, outputNano: 4400, cacheReadNano: 260, cacheWriteNano: 0 } },
    },
  })
  try {
    service.importSession({
      header: { version: 0, id: 'ollama-cache', createdAt: T0, cwd: '/work/cache' },
      events: [
        { type: 'request/header', seq: 0, time: T0, data: { config: { provider: 'ollama-cloud', model: 'glm-5.3' } } },
        { type: 'assistant/message', seq: 1, time: T0 + 1, data: { turn: 0, step: 0, message: { source: { kind: 'model', provider: 'ollama-cloud', model: 'glm-5.3' } }, usage: { inputTokens: 100, outputTokens: 10 } } },
        { type: 'assistant/message', seq: 2, time: T0 + 60_001, data: { turn: 0, step: 1, message: { source: { kind: 'model', provider: 'ollama-cloud', model: 'glm-5.3' } }, usage: { inputTokens: 200, outputTokens: 5 } } },
      ],
    })
    const account = service.saveAccount({
      name: 'Ollama Cloud', kind: 'subscription', providerId: 'ollama',
      rules: [{ matchProvider: 'ollama-cloud', priority: 0 }],
    })

    const result = service.query({ filter: { timezone: 'UTC', time: { preset: 'all' } }, views: ['kpis'], now: T0 + DAY })
    assert.equal(result.kpis.inputTokens, 300, 'raw usage facts stay unchanged')
    assert.equal(result.kpis.cacheReadTokens, 0, 'estimated cache never rewrites reported cache facts')
    assert.equal(result.kpis.cost.currentUsdNano, 161100)
    assert.equal(result.kpis.cost.reportedUsageUsdNano, 486000)
    assert.equal(result.kpis.cost.estimatedCacheReadTokens, 285)
    assert.equal(result.kpis.cost.cacheEstimationMethod, 'ollama-cloud-assumed-rate-v1')

    const detail = service.inspect({ kind: 'pool', id: account.id, filter: { timezone: 'UTC', time: { preset: 'all' } }, now: T0 + DAY })
    assert.equal(detail.direct.cost.currentUsdNano, 161100, 'account cumulative cost uses the same estimate')
    assert.equal(detail.direct.cost.reportedUsageUsdNano, 486000)
    assert.equal(detail.direct.cost.estimatedCacheReadTokens, 285)
    assert.equal(detail.account.kpis.cost.currentUsdNano, 161100, 'account card cost uses the same valuation seam')
    const pools = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now: T0 + DAY })
    const pool = pools.pools.pools.find((entry) => entry.id === account.id)
    assert.equal(pool.kpis.cost.currentUsdNano, 161100)
    assert.equal(pool.kpis.cost.reportedUsageUsdNano, 486000)

    service.setOllamaCacheEstimateBps(5000)
    const adjusted = service.inspect({ kind: 'pool', id: account.id, filter: { timezone: 'UTC', time: { preset: 'all' } }, now: T0 + DAY })
    assert.equal(adjusted.direct.cost.currentUsdNano, 315000, 'changing the scenario revalues cumulative cost without rewriting usage')
    assert.equal(adjusted.direct.cost.reportedUsageUsdNano, 486000)
    assert.equal(adjusted.direct.cost.estimatedCacheReadTokens, 150)
  } finally {
    service.dispose()
  }
})

test('reported Ollama Cloud cache data wins and makes later zero values authoritative', () => {
  const service = createLedgerService({
    databasePath: ':memory:',
    snapshot: {
      version: 'cache-fixture', source: 'fixture',
      models: { 'glm-5.3': { inputNano: 1400, outputNano: 4400, cacheReadNano: 260, cacheWriteNano: 0 } },
    },
  })
  try {
    service.importSession({
      header: { version: 0, id: 'ollama-reported-cache', createdAt: T0, cwd: '/work/cache' },
      events: [
        { type: 'assistant/message', seq: 1, time: T0 + 1, data: { turn: 0, step: 0, message: { source: { kind: 'model', provider: 'ollama-cloud', model: 'glm-5.3' } }, usage: { inputTokens: 100, outputTokens: 10 } } },
        { type: 'assistant/message', seq: 2, time: T0 + 60_001, data: { turn: 0, step: 1, message: { source: { kind: 'model', provider: 'ollama-cloud', model: 'glm-5.3' } }, usage: { inputTokens: 30, outputTokens: 5, cacheReadTokens: 100 } } },
        { type: 'assistant/message', seq: 3, time: T0 + 120_001, data: { turn: 0, step: 2, message: { source: { kind: 'model', provider: 'ollama-cloud', model: 'glm-5.3' } }, usage: { inputTokens: 40, outputTokens: 5, cacheReadTokens: 0 } } },
      ],
    })
    const result = service.query({ filter: { timezone: 'UTC', time: { preset: 'all' } }, views: ['kpis', 'page'], page: { entity: 'request', limit: 10 }, now: T0 + DAY })
    assert.equal(result.kpis.cost.currentUsdNano, 243700)
    assert.equal(result.kpis.cost.reportedUsageUsdNano, 352000)
    assert.equal(result.kpis.cost.estimatedCacheReadTokens, 95)
    assert.equal(result.kpis.cost.cacheEstimationMethod, 'ollama-cloud-assumed-rate-v1')
    const reported = result.page.rows.find((row) => row.cacheReadTokens === 100)
    assert.equal(reported.estimatedCacheReadTokens, 0)
    const laterZero = result.page.rows.find((row) => row.step === 2)
    assert.equal(laterZero.estimatedCacheReadTokens, 0)
  } finally {
    service.dispose()
  }
})

test('saveAccount creates template accounts with limits, rules and official-window merging', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const now = Date.UTC(2026, 7, 30, 12)
    service.importSession(session({ id: 'g1', cwd: '/w/a', time: now - 2 * 3_600_000, provider: 'zai-coding-cn', model: 'glm-5.3', input: 600, output: 200 }))
    service.importSession(session({ id: 'g2', cwd: '/w/a', time: now - 10 * DAY, provider: 'zai-coding-cn', model: 'glm-5.3', input: 100, output: 100 }))

    const created = service.saveAccount({
      name: 'GLM Coding Plan Pro',
      kind: 'subscription',
      templateId: 'glm-coding-plan',
      tierId: 'pro',
      providerId: 'glm',
      billing: { priceUsd: 14, resetDay: 12 },
      limits: [
        { externalKey: 'primary', unit: 'credits', valueMode: 'exact', value: 12000, windowKind: 'rolling', windowSeconds: 18000 },
        { externalKey: 'weekly', unit: 'credits', valueMode: 'exact', value: 60000, windowKind: 'fixed', windowSeconds: 604800 },
      ],
      rules: [{ matchProvider: 'zai-coding-cn*', priority: 0 }],
    })
    assert.ok(created.id.startsWith('account:'))

    // Credits are plan units, not ledger tokens: no local percent math.
    const pools = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now })
    const account = pools.pools.pools.find((pool) => pool.id === created.id)
    assert.equal(account.kind, 'subscription')
    assert.equal(account.kpis.newComputeTokens, 1000)
    assert.equal(account.quotaWindows.length, 2)
    assert.equal(account.quotaWindows.every((entry) => entry.usedPct === null), true)
    assert.equal(account.usedPct, null)

    // An official observation on the same connection drives the percent.
    const observedAt = now - 60_000
    service.saveAccountObservation({
      id: `glm:usage:${observedAt}`, providerId: 'glm', connectionId: 'glm', observedAt,
      source: 'official_plugin_internal_api', brittle: false, complete: true, quotaApplicable: true,
      windows: [
        { id: 'glm-window:5h', kind: 'rolling', label: 'Token usage(5 Hour)', durationMs: 18_000_000, resetsAt: now + 3_600_000 },
        { id: 'glm-window:month', kind: 'billing', label: 'MCP usage(1 Month)', resetsAt: null },
      ],
      limits: [
        { id: 'glm-limit:5h', windowId: 'glm-window:5h', metric: 'TOKENS_LIMIT', unit: 'percent', mode: 'dynamic', percentUsed: 42, observedAt },
        { id: 'glm-limit:month', windowId: 'glm-window:month', metric: 'TIME_LIMIT', unit: 'percent', mode: 'dynamic', percentUsed: 7, observedAt },
      ],
      warnings: [], metadata: null,
    })
    // Bind the account to the observed connection and re-query.
    service.saveAccount({
      id: created.id, name: 'GLM Coding Plan Pro', kind: 'subscription', templateId: 'glm-coding-plan', tierId: 'pro', providerId: 'glm',
      connectionId: 'glm', billing: { priceUsd: 14, resetDay: 12 },
      limits: [
        { externalKey: 'primary', unit: 'credits', valueMode: 'exact', value: 12000, windowKind: 'rolling', windowSeconds: 18000 },
        { externalKey: 'weekly', unit: 'credits', valueMode: 'exact', value: 60000, windowKind: 'fixed', windowSeconds: 604800 },
      ],
      rules: [{ matchProvider: 'zai-coding-cn*', priority: 0 }],
    })
    const merged = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now })
    const enriched = merged.pools.pools.find((pool) => pool.id === created.id)
    assert.equal(enriched.official.windows.length, 2)
    assert.equal(enriched.official.sourceKind, 'official_plugin_internal_api')
    assert.equal(enriched.officialUsedPct, 42)
    assert.equal(enriched.usedPct, 42)
    assert.equal(merged.pools.tightestPoolId, created.id)

    const summary = service.entrySummary({ now, timezone: 'UTC' })
    assert.equal(summary.tightest.id, created.id)
    assert.equal(summary.tightest.usedPct, 42)
    assert.equal(summary.tightest.sourceKind, 'official_plugin_internal_api')
    assert.equal(summary.tightest.windowLabel, 'Token usage(5 Hour)')
    assert.equal(summary.tightest.resetsAt, now + 3_600_000)
    // The per-pool window mirrors the official-first selection.
    const entryPool = summary.pools.find((pool) => pool.id === created.id)
    assert.equal(entryPool.window.label, 'Token usage(5 Hour)')
    assert.equal(entryPool.window.usedPct, 42)
    assert.equal(entryPool.window.resetsAt, now + 3_600_000)
    assert.equal(entryPool.window.sourceKind, 'official_plugin_internal_api')

    // inspect carries the account identity, declared limits, rules and trend.
    const detail = service.inspect({ kind: 'pool', id: created.id, filter: { timezone: 'UTC' }, now })
    assert.equal(detail.identity.name, 'GLM Coding Plan Pro')
    assert.equal(detail.identity.rules.length, 1)
    assert.equal(detail.identity.declaredLimits.length, 2)
    assert.equal(detail.account.officialUsedPct, 42)
    assert.equal(detail.direct.processingTokens, 1400)
    assert.ok(detail.trend.buckets.length > 0)
    assert.equal(detail.page.rows.length, 2)

    // Validation and archive round-trip.
    assert.throws(() => service.saveAccount({ name: '' }), /account name is required/)
    assert.throws(() => service.saveAccount({ name: 'x', kind: 'wallet' }), /invalid account kind/)
    assert.throws(() => service.saveAccount({ name: 'x', limits: [{ externalKey: 'a', unit: 'percent', valueMode: 'manual' }] }), /manual limits require a positive value/)
    assert.throws(() => service.saveAccount({ name: 'x', rules: [{}] }), /matchProvider or matchModel is required/)
    service.archiveAccount(created.id, { archived: true })
    const archivedPools = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now })
    assert.equal(archivedPools.pools.pools.some((pool) => pool.id === created.id), false)
    service.archiveAccount(created.id, { archived: false })
    assert.equal(service.listAccounts().find((entry) => entry.id === created.id).archived, false)
  } finally {
    service.dispose()
  }
})

test('legacy v5 plans created after the flip stay projected and read-only in the account editor', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const now = Date.UTC(2026, 7, 30, 12)
    const plan = service.savePlan({ kind: 'sub', name: 'Old pool', quotaUnit: 'newCompute', quotaValue: 500, windowKind: '5h' })
    service.savePlanRules(plan.id, [{ matchProvider: 'deepseek*' }])
    service.importSession(session({ id: 'l1', cwd: '/w/a', time: now - 3_600_000, provider: 'deepseek', model: 'deepseek-chat', input: 100, output: 100 }))

    const pools = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now })
    const projected = pools.pools.pools.find((pool) => pool.id === `legacy-plan:${plan.id}`)
    assert.equal(projected.kpis.newComputeTokens, 200)
    assert.equal(projected.quotaWindows[0].usedPct, 40)

    // The account editor refuses to mutate a projected legacy product.
    assert.throws(() => service.saveAccount({ id: `legacy-plan:${plan.id}`, name: 'hijack' }), /legacy v5 plans are read-only/)

    // Archiving through the account editor archives the plan and vice versa.
    service.archiveAccount(`legacy-plan:${plan.id}`, { archived: true })
    assert.equal(service.listPlans().find((entry) => entry.id === plan.id).archived, true)
    const afterArchive = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now })
    assert.equal(afterArchive.pools.pools.length, 0)
    assert.equal(afterArchive.pools.unassigned.newComputeTokens, 200)
  } finally {
    service.dispose()
  }
})
