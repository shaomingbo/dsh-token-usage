import test from 'node:test'
import assert from 'node:assert/strict'
import { createLedgerService } from '../lib/ledger/service.js'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 7, 1, 8)

function session({ id, cwd, time, model = 'deepseek-chat', provider = 'deepseek', input = 100, output = 50, cache = 200 }) {
  return {
    header: { version: 0, id, createdAt: time, cwd },
    events: [
      { type: 'session/start', seq: 0, time, data: {} },
      { type: 'request/header', seq: 1, time: time + 1, data: { config: { provider, model } } },
      { type: 'assistant/message', seq: 2, time: time + 2, data: { turn: 0, step: 0, message: { source: { kind: 'model', provider, model } }, usage: { inputTokens: input, outputTokens: output, cacheReadTokens: cache } } },
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
