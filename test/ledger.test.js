import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLedgerService } from '../lib/ledger/service.js'

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-token-usage-test-'))
  return { path: join(dir, 'usage.sqlite'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const T0 = Date.UTC(2026, 6, 10, 8, 0, 0)
const HOUR = 3_600_000

/** Build one synthetic model call as the durable events DSH would log. */
function modelCall({ seq, time, turn = 0, step = 0, provider = 'deepseek', model = 'deepseek-chat', usage, interrupted } = {}) {
  const events = [
    { type: 'request/header', seq, time, data: { config: { provider, model } } },
    {
      type: 'assistant/message',
      seq: seq + 1,
      time: time + 1000,
      data: {
        turn,
        step,
        message: { source: { kind: 'model', provider, model } },
        ...(usage === undefined ? {} : { usage }),
        ...(interrupted ? { interrupted: true } : {}),
      },
    },
  ]
  return events
}

/** A standard session: two calls in one turn/session. */
function standardSession({ id = 's1', cwd = '/work/repo-a', start = T0 } = {}) {
  const events = [
    { type: 'session/start', seq: 0, time: start, data: {} },
    ...modelCall({
      seq: 1,
      time: start + 1000,
      turn: 0,
      step: 0,
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 200, cacheWriteTokens: 10, reasoningTokens: 20 },
    }),
    { type: 'step/end', seq: 3, time: start + 2000, data: {} },
    ...modelCall({
      seq: 4,
      time: start + HOUR,
      turn: 1,
      step: 0,
      model: 'deepseek-reasoner',
      usage: { inputTokens: 30, outputTokens: 70 },
    }),
    { type: 'step/end', seq: 6, time: start + HOUR + 3000, data: {} },
    { type: 'turn/end', seq: 7, time: start + HOUR + 4000, data: { reason: 'completed' } },
  ]
  return { header: { version: 0, id, createdAt: start, cwd }, events }
}

test('one call per (session, turn, step); repeated usage samples replace instead of adding', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({ databasePath: db.path })
    const session = standardSession()
    service.importSession(session)

    // Live path re-delivers the same step with a refined sample: replace, not add.
    service.ingestEvent(session.header, {
      type: 'assistant/message',
      seq: 2,
      time: T0 + 1500,
      data: {
        turn: 0,
        step: 0,
        message: { source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } },
        usage: { inputTokens: 120, outputTokens: 55 },
      },
    })

    const totals = service.getOverview({ timezone: 'UTC' }).totals
    // s1 step0 replaced by the refined sample (cache fields omitted → 0):
    // 120+55 ; s1 turn1: 30+70.
    assert.equal(totals.calls, 2)
    assert.equal(totals.processingTokens, (120 + 55) + (30 + 70))
    assert.equal(totals.newComputeTokens, (120 + 55) + (30 + 70))
    assert.equal(totals.cacheReadTokens, 0) // last sample wins in full
    assert.equal(totals.requests, 2)
    let request = service.query({ filter: { timezone: 'UTC', time: { preset: 'all' } }, views: ['page'], page: { entity: 'request', limit: 10 } }).page.rows.find((row) => row.turn === 0)
    assert.equal(request.cacheReadState, 'absent')

    service.ingestEvent(session.header, {
      type: 'assistant/message', seq: 2, time: T0 + 1600,
      data: {
        turn: 0, step: 0,
        message: { source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } },
        usage: { inputTokens: 120, outputTokens: 55, cacheReadTokens: 0 },
      },
    })
    request = service.query({ filter: { timezone: 'UTC', time: { preset: 'all' } }, views: ['page'], page: { entity: 'request', limit: 10 } }).page.rows.find((row) => row.turn === 0)
    assert.equal(request.cacheReadState, 'reported', 'an explicit zero remains distinguishable from an omitted cache field')
    service.dispose()
  } finally {
    db.cleanup()
  }
})

test('processed vs new-compute token definitions and category breakdowns', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({ databasePath: db.path })
    const session = standardSession()
    service.importSession(session)
    const totals = service.getOverview({ timezone: 'UTC' }).totals
    // With the replaced sample from the other test NOT applied here:
    // call1 = 100+50+200+10 (reasoning 20 inside output), call2 = 30+70.
    assert.equal(totals.processingTokens, (100 + 50 + 200 + 10) + (30 + 70))
    assert.equal(totals.newComputeTokens, (100 + 50) + (30 + 70))
    assert.equal(totals.inputTokens, 130)
    assert.equal(totals.outputTokens, 120)
    assert.equal(totals.cacheReadTokens, 200)
    assert.equal(totals.cacheWriteTokens, 10)
    assert.equal(totals.reasoningTokens, 20) // displayed subset, never re-added
    service.dispose()
  } finally {
    db.cleanup()
  }
})

test('historical import is idempotent and overlaps live capture safely', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({ databasePath: db.path })
    const session = standardSession()
    service.importSession(session)
    service.importSession(session) // rescan
    for (const event of session.events) service.ingestEvent(session.header, event) // live replay of same facts
    const totals = service.getOverview({ timezone: 'UTC' }).totals
    assert.equal(totals.calls, 2)
    assert.equal(totals.requests, 2)
    assert.equal(totals.processingTokens, (100 + 50 + 200 + 10) + (30 + 70))
    service.dispose()
  } finally {
    db.cleanup()
  }
})

test('fork-inherited prefix (seq < seedLength) is excluded from aggregates', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({ databasePath: db.path })
    // Parent owns one call.
    const parent = standardSession({ id: 'parent', cwd: '/work/repo-a' })
    service.importSession(parent)

    // Fork physically copies the parent log (8 events, seqs 0..7) and adds its
    // own call at seq 8 in a NEW turn (the child continues after the seed).
    // seedLength counts every inherited leading event.
    const forkEvents = [
      ...parent.events.map((event) => ({ ...event })),
      ...modelCall({ seq: 8, time: T0 + 2 * HOUR, turn: 2, step: 0, usage: { inputTokens: 5, outputTokens: 5 } }),
      { type: 'step/end', seq: 10, time: T0 + 2 * HOUR + 1000, data: { turn: 2, step: 0 } },
    ]
    const forkHeader = { version: 0, id: 'fork', createdAt: T0 + 2 * HOUR, cwd: '/work/repo-a', parentSession: 'parent', seedLength: 8 }
    service.importSession({ header: forkHeader, events: forkEvents })

    const totals = service.getOverview({ timezone: 'UTC' }).totals
    // Parent 2 calls + fork-owned 1 call; the copied parent events inside the
    // fork add nothing.
    assert.equal(totals.calls, 3)
    assert.equal(totals.processingTokens, (100 + 50 + 200 + 10) + (30 + 70) + (5 + 5))

    // Fork detail: own usage vs inherited context.
    const forkDetail = service.getSessionDetail('fork', { timezone: 'UTC' })
    assert.equal(forkDetail.ownTotals.processingTokens, 10)
    assert.equal(forkDetail.inheritedTotals.processingTokens, 100 + 50 + 200 + 10 + 30 + 70)
    service.dispose()
  } finally {
    db.cleanup()
  }
})

test('subagent usage counts once in its own session and rolls up through lineage', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({ databasePath: db.path })
    const parent = standardSession({ id: 'parent', cwd: '/work/repo-a' })
    service.importSession(parent)

    const childEvents = [
      { type: 'session/start', seq: 0, time: T0 + 1000, data: {} },
      ...modelCall({ seq: 1, time: T0 + 2000, turn: 0, step: 0, usage: { inputTokens: 40, outputTokens: 10 } }),
      { type: 'step/end', seq: 3, time: T0 + 3000, data: {} },
    ]
    const childHeader = { version: 0, id: 'child', createdAt: T0 + 1000, cwd: undefined, parentSession: 'parent', origin: 'subagent' }
    service.importSession({ header: childHeader, events: childEvents })

    const totals = service.getOverview({ timezone: 'UTC' }).totals
    // Parent two calls + child one call; nothing duplicated into the parent.
    assert.equal(totals.calls, 3)
    assert.equal(totals.processingTokens, (100 + 50 + 200 + 10) + (30 + 70) + (40 + 10))

    // Child has no cwd: project inherits through parentSession lineage.
    const projects = service.getRankings({ dimension: 'project', timezone: 'UTC' })
    assert.equal(projects.rows.length, 1)
    assert.equal(projects.rows[0].key, '/work/repo-a')
    assert.equal(projects.rows[0].requests, 3)

    // Session detail rolls children up on request.
    const parentDetail = service.getSessionDetail('parent', { timezone: 'UTC' })
    assert.equal(parentDetail.direct.processingTokens, (100 + 50 + 200 + 10) + (30 + 70))
    assert.equal(parentDetail.includingChildren.processingTokens, (100 + 50 + 200 + 10) + (30 + 70) + (40 + 10))
    service.dispose()
  } finally {
    db.cleanup()
  }
})

test('compaction and surface events never create calls or tokens', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({ databasePath: db.path })
    const session = standardSession()
    session.events.push(
      { type: 'compaction/start', seq: 8, time: T0 + 2 * HOUR, data: { brand: 'b1' } },
      { type: 'compaction/summary', seq: 9, time: T0 + 2 * HOUR, data: { brand: 'b1' } },
      { type: 'compaction/end', seq: 10, time: T0 + 2 * HOUR, data: { brand: 'b1' } },
    )
    service.importSession(session)
    const totals = service.getOverview({ timezone: 'UTC' }).totals
    assert.equal(totals.calls, 2)
    service.dispose()
  } finally {
    db.cleanup()
  }
})

test('usage-less failures are request-health records without tokens or cost', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({ databasePath: db.path })
    const events = [
      { type: 'session/start', seq: 0, time: T0, data: {} },
      { type: 'request/header', seq: 1, time: T0 + 1, data: { config: { provider: 'deepseek', model: 'deepseek-chat' } } },
      { type: 'step/start', seq: 2, time: T0 + 2, data: { turn: 0, step: 0 } },
      { type: 'step/end', seq: 3, time: T0 + 3, data: { turn: 0, step: 0, error: 'LlmFailure' } },
      { type: 'turn/end', seq: 4, time: T0 + 4, data: { reason: { error: 'LlmFailure' } } },
    ]
    service.importSession({ header: { version: 0, id: 'fail', createdAt: T0, cwd: '/work/repo-a' }, events })
    const totals = service.getOverview({ timezone: 'UTC' }).totals
    assert.equal(totals.requests, 1)
    assert.equal(totals.failedRequests, 1)
    assert.equal(totals.calls, 0)
    assert.equal(totals.processingTokens, 0)
    service.dispose()
  } finally {
    db.cleanup()
  }
})

test('missing usage can be estimated; estimated usage is separable at every level', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({
      databasePath: db.path,
      estimator: (events) => ({ inputTokens: 10, outputTokens: 5, estimator: 'fixture-meter', estimatorVersion: 'test-1' }),
    })
    const events = [
      { type: 'session/start', seq: 0, time: T0, data: {} },
      ...modelCall({ seq: 1, time: T0 + 1000, turn: 0, step: 0, usage: { inputTokens: 100, outputTokens: 50 } }),
      { type: 'step/end', seq: 3, time: T0 + 2000, data: {} },
      { type: 'request/header', seq: 4, time: T0 + HOUR, data: { config: { provider: 'deepseek', model: 'deepseek-chat' } } },
      // No usage-bearing assistant/message: the estimator may run on the observed step.
      { type: 'step/end', seq: 6, time: T0 + HOUR + 1000, data: { turn: 1, step: 0 } },
    ]
    service.importSession({ header: { version: 0, id: 'est', createdAt: T0, cwd: '/work/repo-a' }, events }, { eventsForEstimation: events })
    const overview = service.getOverview({ timezone: 'UTC' })
    assert.equal(overview.totals.calls, 1) // only the exact call is an observable call
    assert.equal(overview.totals.requests, 2)
    assert.equal(overview.totalsIncludingEstimates.processingTokens, (100 + 50) + (10 + 5))
    assert.equal(overview.totals.processingTokens, 100 + 50)
    assert.ok(overview.estimatedShare > 0 && overview.estimatedShare < 1)
    service.dispose()
  } finally {
    db.cleanup()
  }
})

test('daily series and streaks respect the requested timezone', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({ databasePath: db.path })
    const now = Date.UTC(2026, 6, 12, 12)
    // Each session's calls stay inside one UTC day.
    service.importSession(standardSession({ start: Date.UTC(2026, 6, 10, 20, 0) }))
    service.importSession(standardSession({ id: 's2', start: Date.UTC(2026, 6, 11, 0, 30) }))
    const utc = service.getDailySeries({ from: '2026-07-10', to: '2026-07-12', timezone: 'UTC' })
    assert.equal(utc.days.length, 3)
    assert.equal(utc.days[0].date, '2026-07-10')
    assert.equal(utc.days[0].requests, 2)
    assert.equal(utc.days[1].date, '2026-07-11')
    assert.equal(utc.days[1].requests, 2)

    // Moving to a UTC+8 timezone pushes both sessions onto Jul 11 local.
    const plus8 = service.getDailySeries({ from: '2026-07-10', to: '2026-07-12', timezone: 'Asia/Shanghai' })
    assert.equal(plus8.days[0].requests, 0)
    assert.equal(plus8.days[1].requests, 4)
    assert.equal(plus8.days[2].requests, 0)

    const overview = service.getOverview({ timezone: 'UTC', now })
    assert.equal(overview.streaks.current, 2)
    assert.equal(overview.streaks.longest, 2)
    service.dispose()
  } finally {
    db.cleanup()
  }
})

test('rankings aggregate by model, provider, and project with all metrics', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({ databasePath: db.path })
    service.importSession(standardSession())
    const models = service.getRankings({ dimension: 'model', timezone: 'UTC' })
    assert.deepEqual(models.rows.map((row) => row.key).sort(), ['deepseek-chat', 'deepseek-reasoner'])
    const chat = models.rows.find((row) => row.key === 'deepseek-chat')
    assert.equal(chat.requests, 1)
    assert.equal(chat.processingTokens, 100 + 50 + 200 + 10)
    const providers = service.getRankings({ dimension: 'provider', timezone: 'UTC' })
    assert.equal(providers.rows.length, 1)
    assert.equal(providers.rows[0].requests, 2)
    service.dispose()
  } finally {
    db.cleanup()
  }
})

test('reconciliation marks sources deleted without erasing history', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({ databasePath: db.path })
    service.importSession(standardSession())
    const report = service.reconcileSources([])
    assert.deepEqual(report.deleted, ['s1'])
    const totals = service.getOverview({ timezone: 'UTC' }).totals
    assert.equal(totals.calls, 2) // history retained
    const sessions = service.listSessions({ timezone: 'UTC' })
    assert.equal(sessions.rows[0].sourceDeleted, true)
    service.dispose()
  } finally {
    db.cleanup()
  }
})

test('cost valuation uses the embedded snapshot and reports coverage; aliases revalue current only', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({ databasePath: db.path })
    service.importSession(standardSession())
    const overview = service.getOverview({ timezone: 'UTC' })
    // deepseek-chat + deepseek-reasoner exist in the embedded snapshot.
    assert.ok(overview.cost.usdNano > 0)
    assert.equal(overview.cost.coverage, 1)
    assert.ok(overview.cost.originalUsdNano > 0)

    // Alias deepseek-reasoner → deepseek-chat changes current valuation, not original.
    const before = overview.cost.usdNano
    const originalBefore = overview.cost.originalUsdNano
    service.setAlias('deepseek-reasoner', 'deepseek-chat')
    const after = service.getOverview({ timezone: 'UTC' }).cost
    assert.notEqual(after.usdNano, before)
    assert.equal(after.originalUsdNano, originalBefore) // original valuation immutable
    assert.ok(after.usdNano > 0)
    service.dispose()
  } finally {
    db.cleanup()
  }
})
