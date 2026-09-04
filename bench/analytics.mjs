// Analytics benchmark over a synthetic 100k-request / 10k-session ledger.
//
// Scenarios and what "good" looks like under the revision + 60s clock-bucket
// result cache (lib/ledger/analytics.js):
// - cold: the first dashboard query of the process; it pays the one-time
//   effective-request projection rebuild.
// - liveLike: the Dashboard stays open and polls every 15s with a fresh
//   `now` and an otherwise identical spec — the production polling shape.
//   The clock buckets must absorb most polls: at least 15 of 20 answers
//   come from the cache (<5ms, zero prepared statements) and the effective
//   projection never rebuilds. NOW sits exactly on a bucket boundary, so
//   the 20 polls reuse the cold bucket and cross exactly 5 fresh ones.
// - interactive: 20 explore-style queries with distinct project filters;
//   every key is fresh, so this measures recompute cost.
// - cached: exact key replay (same spec, same `now`) — the floor, not the
//   production shape; use liveLike for that.
// - entrySummary: the sidebar micro indicator read.
// - afterObservation: an account observation lands between polls; it bumps
//   the result-cache revision without rebuilding the projection, so the
//   next poll is a plain recompute (rebuild delta 0).
// - afterLiveEvents: header-only live traffic (request/header, step/start)
//   must be free (rebuild delta 0); the first usage-bearing assistant
//   message writes a request row and the next poll rebuilds the projection
//   exactly once.
//
// Any unmet expectation is reported on stderr and sets exit code 1.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase, transaction } from '../lib/ledger/db.js'
import { createLedgerService } from '../lib/ledger/service.js'

const REQUESTS = 100_000
const SESSIONS = 10_000
const NOW = Date.UTC(2026, 7, 31, 12)
const DAY = 86_400_000
const POLLS = 20
const POLL_MS = 15_000
const dir = mkdtempSync(join(tmpdir(), 'dsh-token-usage-bench-'))
const path = join(dir, 'usage.sqlite')

const failures = []
function expect(condition, message) {
  if (!condition) failures.push(message)
}

// Count every prepared statement by wrapping the sqlite prototype: a result
// cache hit must answer without preparing anything. Restored in `finally`.
const originalPrepare = DatabaseSync.prototype.prepare
let prepareCalls = 0
DatabaseSync.prototype.prepare = function countedPrepare(...args) {
  prepareCalls += 1
  return originalPrepare.apply(this, args)
}

try {
  const db = openDatabase(path)
  transaction(db, () => {
    const source = db.prepare('INSERT INTO sources (session_id, last_seq, source, created_at, cwd, deleted) VALUES (?, 9, ?, ?, ?, 0)')
    const project = db.prepare("INSERT OR IGNORE INTO projects (id, identity_kind, identity_value, display_name, created_at) VALUES (?, 'git', ?, ?, ?)")
    const projectSource = db.prepare("INSERT OR IGNORE INTO project_sources (cwd, project_id, source, created_at) VALUES (?, ?, 'git', ?)")
    for (let index = 0; index < SESSIONS; index += 1) {
      const projectIndex = index % 100
      const cwd = `/bench/project-${projectIndex}`
      source.run(`s-${index}`, 'profile', NOW - (index % 30) * DAY, cwd)
      project.run(`p-${projectIndex}`, `remote-${projectIndex}`, `project-${projectIndex}`, NOW)
      projectSource.run(cwd, `p-${projectIndex}`, NOW)
    }
    const request = db.prepare(`
      INSERT INTO requests (session_id, turn, step, seq, time, provider, model_raw, owned,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
        status, estimated, original_usd_nano, price_version, duration_ms)
      VALUES (?, ?, 0, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'ok', 0, ?, 'bench', ?)
    `)
    for (let index = 0; index < REQUESTS; index += 1) {
      const model = index % 2 ? 'deepseek-chat' : 'deepseek-reasoner'
      const input = 300 + index % 100
      const output = 80 + index % 40
      const cacheRead = index % 3 ? 500 : 0
      request.run(`s-${index % SESSIONS}`, Math.floor(index / SESSIONS), index % 10, NOW - (index % 30) * DAY - (index % 86_400_000), 'deepseek', model, input, output, cacheRead, 0, index % 50, 1000, 2500 + index % 500)
    }
  })
  db.close()

  const service = createLedgerService({ databasePath: path })
  const rebuilds = () => service.diagnostics().effectiveRebuilds
  // `baseViewComputations` is being added to diagnostics in parallel; print
  // its delta when present, `n/a` otherwise, and never depend on it.
  const computationsAt = () => {
    const value = service.diagnostics().baseViewComputations
    return typeof value === 'number' ? value : null
  }
  const computationsDelta = (before) => {
    const value = computationsAt()
    return typeof value === 'number' && typeof before === 'number' ? value - before : 'n/a'
  }

  // Billing pools: two subscriptions and one credit balance with attribution rules.
  const poolA = service.savePlan({ kind: 'sub', name: 'Pool A', quotaUnit: 'newCompute', quotaValue: 1e9, resetDay: 1 })
  const poolB = service.savePlan({ kind: 'sub', name: 'Pool B', quotaUnit: 'newCompute', quotaValue: 5e8, resetDay: 1 })
  const poolC = service.savePlan({ kind: 'credit', name: 'Relay', balanceUsd: 50, expiryDay: '2026-10-15' })
  service.savePlanRules(poolA.id, [{ matchModel: 'deepseek-chat', priority: 0 }])
  service.savePlanRules(poolB.id, [{ matchModel: 'deepseek-reasoner', priority: 0 }])
  service.savePlanRules(poolC.id, [{ matchProvider: 'relay-*', priority: 0 }])

  const filter = { timezone: 'UTC', time: { fromMs: NOW - 30 * DAY, toMs: NOW + 1 } }
  const exploreSpec = {
    filter,
    views: ['kpis', 'series', 'rankings'],
    series: { granularity: 'auto' },
    ranking: { dimension: 'project', by: 'processingTokens', limit: 20 },
    now: NOW,
  }
  // The dashboard spec mirrors the web client: rolling 30d preset, reported
  // honesty, and a per-poll `now` instead of a pinned timestamp.
  const dashSpec = {
    filter: { timezone: 'UTC', time: { preset: '30d' }, honesty: 'reported' },
    views: ['kpis', 'pools', 'seriesBy', 'rankings'],
    seriesBy: { groupBy: 'pool' },
    ranking: { dimension: 'model', by: 'currentUsdNano', limit: 20 },
  }
  const poll = (now) => service.query({ ...dashSpec, now })

  // Cold start: the very first dashboard query, projection rebuild included.
  const coldStart = performance.now()
  poll(NOW)
  const coldMs = performance.now() - coldStart

  // Live-like: the Dashboard polls every 15s with an advancing `now`.
  const rebuildsBeforeLive = rebuilds()
  const computationsBeforeLive = computationsAt()
  const liveTimings = []
  let livePrepares = 0
  let liveHits = 0
  let pollNow = NOW
  for (let index = 0; index < POLLS; index += 1) {
    pollNow += POLL_MS
    const preparedBefore = prepareCalls
    const start = performance.now()
    poll(pollNow)
    const ms = performance.now() - start
    const queryPrepares = prepareCalls - preparedBefore
    livePrepares += queryPrepares
    if (ms < 5 && queryPrepares === 0) liveHits += 1
    liveTimings.push(ms)
  }
  const liveRebuilds = rebuilds() - rebuildsBeforeLive
  const liveComputations = computationsDelta(computationsBeforeLive)
  expect(liveHits >= 15, `liveLike cache hits: expected >= 15 of ${POLLS}, got ${liveHits}`)
  expect(liveRebuilds === 0, `liveLike effectiveRebuilds delta: expected 0, got ${liveRebuilds}`)

  const interactive = []
  for (let index = 0; index < 20; index += 1) {
    const start = performance.now()
    service.query({ ...exploreSpec, filter: { ...filter, project: [`p-${index}`] } })
    interactive.push(performance.now() - start)
  }
  interactive.sort((a, b) => a - b)
  for (let index = 0; index < 2; index += 1) poll(NOW)
  const timings = []
  for (let index = 0; index < 20; index += 1) {
    const start = performance.now()
    poll(NOW)
    timings.push(performance.now() - start)
  }
  // Entry summary must stay tiny: it feeds the sidebar micro indicator.
  const entryTimings = []
  for (let index = 0; index < 20; index += 1) {
    const start = performance.now()
    service.entrySummary({ now: NOW, timezone: 'UTC' })
    entryTimings.push(performance.now() - start)
  }

  // Observation refresh: saving an observation invalidates the result cache
  // through the combined revision but must not rebuild the projection; the
  // next poll pays a plain recompute.
  pollNow += POLL_MS
  const observedAt = pollNow
  const rebuildsBeforeObservation = rebuilds()
  const computationsBeforeObservation = computationsAt()
  service.saveAccountObservation({
    id: `deepseek-usage-api:${observedAt}`,
    providerId: 'deepseek',
    connectionId: 'deepseek:default',
    observedAt,
    source: 'official_usage_api',
    brittle: false,
    complete: true,
    quotaApplicable: true,
    windows: [{ id: 'deepseek-window:monthly', kind: 'rolling', label: 'Monthly', durationMs: 30 * DAY, resetsAt: observedAt + 10 * DAY }],
    limits: [{ id: 'deepseek-limit:monthly', windowId: 'deepseek-window:monthly', metric: 'cloud_usage', unit: 'percent', mode: 'dynamic', percentUsed: 42, observedAt }],
    warnings: [],
    metadata: null,
  })
  const observationStart = performance.now()
  poll(pollNow)
  const observationMs = performance.now() - observationStart
  const observationRebuilds = rebuilds() - rebuildsBeforeObservation
  const observationComputations = computationsDelta(computationsBeforeObservation)
  expect(observationRebuilds === 0, `afterObservation effectiveRebuilds delta: expected 0, got ${observationRebuilds}`)

  // Live events: metadata-only traffic writes no request rows and must not
  // rebuild; the first usage-bearing message persists a row, and the next
  // poll pays for exactly one projection rebuild.
  const liveAt = pollNow + POLL_MS
  const liveHeader = { version: 0, id: 'bench-live-session', createdAt: liveAt, cwd: '/bench/project-live' }
  const rebuildsBeforeHeaderOnly = rebuilds()
  const computationsBeforeHeaderOnly = computationsAt()
  service.ingestEvent(liveHeader, { type: 'request/header', seq: 1, time: liveAt, data: { config: { provider: 'deepseek', model: 'deepseek-chat' } } })
  service.ingestEvent(liveHeader, { type: 'step/start', seq: 2, time: liveAt + 1_000, data: { turn: 0, step: 0 } })
  pollNow = liveAt + POLL_MS
  const headerOnlyStart = performance.now()
  poll(pollNow)
  const headerOnlyMs = performance.now() - headerOnlyStart
  const headerOnlyRebuilds = rebuilds() - rebuildsBeforeHeaderOnly
  expect(headerOnlyRebuilds === 0, `afterLiveEvents header-only effectiveRebuilds delta: expected 0, got ${headerOnlyRebuilds}`)

  const rebuildsBeforeUsage = rebuilds()
  service.ingestEvent(liveHeader, {
    type: 'assistant/message', seq: 3, time: liveAt + 2_000,
    data: { turn: 0, step: 0, message: { source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } }, usage: { inputTokens: 10, outputTokens: 5 } },
  })
  const usageStart = performance.now()
  poll(pollNow)
  const usageMs = performance.now() - usageStart
  const usageRebuilds = rebuilds() - rebuildsBeforeUsage
  expect(usageRebuilds === 1, `afterLiveEvents usage effectiveRebuilds delta: expected exactly 1, got ${usageRebuilds}`)
  const liveEventsComputations = computationsDelta(computationsBeforeHeaderOnly)

  service.dispose()
  timings.sort((a, b) => a - b)
  entryTimings.sort((a, b) => a - b)
  liveTimings.sort((a, b) => a - b)
  const percentile = (sorted, ratio) => sorted[Math.floor(sorted.length * ratio)]
  const round = (ms) => Number(ms.toFixed(2))
  const p50 = percentile(timings, 0.5)
  const p95 = percentile(timings, 0.95)
  const interactiveP95 = percentile(interactive, 0.95)
  const entryP95 = percentile(entryTimings, 0.95)
  console.log(JSON.stringify({
    requests: REQUESTS,
    sessions: SESSIONS,
    runs: timings.length,
    coldMs: round(coldMs),
    interactiveP95Ms: round(interactiveP95),
    cachedP50Ms: round(p50),
    cachedP95Ms: round(p95),
    entrySummaryP95Ms: round(entryP95),
    targetMs: 100,
    liveLike: {
      p50Ms: round(percentile(liveTimings, 0.5)),
      p95Ms: round(percentile(liveTimings, 0.95)),
      hits: liveHits,
      prepares: livePrepares,
      rebuilds: liveRebuilds,
      baseViewComputations: liveComputations,
    },
    afterObservation: { ms: round(observationMs), rebuilds: observationRebuilds, baseViewComputations: observationComputations },
    afterLiveEvents: {
      headerOnlyMs: round(headerOnlyMs),
      headerOnlyRebuilds,
      usageMs: round(usageMs),
      usageRebuilds,
      baseViewComputations: liveEventsComputations,
    },
  }, null, 2))
  expect(interactiveP95 <= 100, `interactiveP95Ms ${round(interactiveP95)} exceeds targetMs 100`)
  expect(p95 <= 100, `cachedP95Ms ${round(p95)} exceeds targetMs 100`)
  expect(entryP95 <= 100, `entrySummaryP95Ms ${round(entryP95)} exceeds targetMs 100`)
  for (const message of failures) console.error(`bench: unmet expectation — ${message}`)
  if (failures.length > 0) process.exitCode = 1
} finally {
  DatabaseSync.prototype.prepare = originalPrepare
  rmSync(dir, { recursive: true, force: true })
}
