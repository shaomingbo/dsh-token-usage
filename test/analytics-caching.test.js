import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createLedgerService } from '../lib/ledger/service.js'

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-token-usage-test-'))
  return { path: join(dir, 'usage.sqlite'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const DAY = 86_400_000
const HOUR = 3_600_000
const MINUTE = 60_000
const T0 = Date.UTC(2026, 6, 10, 8)

/** One usage-bearing model call as the durable events DSH would log. */
function usageEvents({ seq, time, provider = 'deepseek', model = 'deepseek-chat', usage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 20 } } = {}) {
  return [
    { type: 'request/header', seq, time, data: { config: { provider, model } } },
    {
      type: 'assistant/message',
      seq: seq + 1,
      time: time + 1000,
      data: { turn: 0, step: 0, message: { source: { kind: 'model', provider, model } }, usage },
    },
  ]
}

function importUsage(service, sessionId, time, usage) {
  service.importSession({
    header: { version: 0, id: sessionId, createdAt: time, cwd: '/w/cache' },
    events: [{ type: 'session/start', seq: 0, time, data: {} }, ...usageEvents({ seq: 1, time: time + 1000, usage })],
  })
}

test('a fresh observation moves pool output without rebuilding the request projection', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({ databasePath: db.path })
    const account = service.ensureConnectionAccount(
      { providerId: 'ollama-cloud', displayName: 'Ollama Cloud', configured: true },
      { aliases: ['ollama-cloud'] },
    )
    importUsage(service, 'obs-session', T0)
    const now = T0 + HOUR
    const poolsAt = (ms) => service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now: ms })
      .pools.pools.find((pool) => pool.id === account.id)
    assert.equal(poolsAt(now)?.officialUsedPct ?? null, null)
    const rebuildsAfterWarm = service.diagnostics().effectiveRebuilds
    assert.equal(rebuildsAfterWarm, 1)

    service.saveAccountObservation({
      id: `ollama-cloud-ui:${now}`, providerId: 'ollama-cloud', connectionId: 'ollama-cloud:default',
      observedAt: now, source: 'official_ui', brittle: true, complete: true, quotaApplicable: true,
      windows: [{ id: 'ollama-cloud-window:weekly', kind: 'rolling', label: 'Weekly', durationMs: 7 * DAY, resetsAt: now + 6 * DAY }],
      limits: [{ id: 'ollama-cloud-limit:weekly', windowId: 'ollama-cloud-window:weekly', metric: 'cloud_usage', unit: 'percent', mode: 'dynamic', percentUsed: 64, observedAt: now }],
      warnings: [], metadata: null,
    })

    assert.equal(poolsAt(now).officialUsedPct, 64, 'the pools output reflects the just-saved observation')
    assert.equal(
      service.diagnostics().effectiveRebuilds,
      rebuildsAfterWarm,
      'observation-driven result-cache invalidation must not rebuild the effective projection',
    )
    service.dispose()
  } finally {
    db.cleanup()
  }
})

test('live ingest bumps the revision only when a usage row is actually written', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({ databasePath: db.path })
    const header = { version: 0, id: 'live-cache', createdAt: T0, cwd: '/w/live' }
    const now = T0 + HOUR
    const kpis = () => ({ filter: { timezone: 'UTC', time: { preset: 'all' } }, views: ['kpis'], now })
    service.ingestEvent(header, { type: 'session/start', seq: 0, time: T0, data: {} })
    const baseline = service.query(kpis()).asOf.revision // first query builds the projection
    const rebuildsAtBaseline = service.diagnostics().effectiveRebuilds

    // Metadata-only traffic: headers, step starts and buffered usage-less
    // assistant messages write no request rows and must not move anything.
    service.ingestEvent(header, { type: 'request/header', seq: 1, time: T0 + 1, data: { config: { provider: 'deepseek', model: 'deepseek-chat' } } })
    service.ingestEvent(header, { type: 'step/start', seq: 2, time: T0 + 2, data: { turn: 0, step: 0 } })
    service.ingestEvent(header, { type: 'assistant/message', seq: 3, time: T0 + 3, data: { turn: 0, step: 0, message: { source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } } } })
    assert.equal(service.query(kpis()).asOf.revision, baseline, 'metadata-only events must not move the revision')
    assert.equal(service.diagnostics().effectiveRebuilds, rebuildsAtBaseline)

    // The usage sample persists a row: the revision moves, and the next
    // query pays for exactly one projection rebuild.
    service.ingestEvent(header, {
      type: 'assistant/message', seq: 4, time: T0 + 4,
      data: { turn: 0, step: 0, message: { source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } }, usage: { inputTokens: 10, outputTokens: 5 } },
    })
    const rebuildsBeforeQuery = service.diagnostics().effectiveRebuilds
    assert.ok(service.query(kpis()).asOf.revision > baseline, 'a persisted usage row moves the revision')
    assert.equal(service.diagnostics().effectiveRebuilds, rebuildsBeforeQuery + 1, 'the next query rebuilds the projection once')
    service.query(kpis())
    assert.equal(service.diagnostics().effectiveRebuilds, rebuildsBeforeQuery + 1, 'steady-state queries never rebuild again')
    service.dispose()
  } finally {
    db.cleanup()
  }
})

test('live step/end writes bump only when a request row was actually touched', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({ databasePath: db.path })
    const header = { version: 0, id: 'live-failure', createdAt: T0, cwd: '/w/failures' }
    const now = T0 + HOUR
    const revisionAt = () => service.query({ filter: { timezone: 'UTC', time: { preset: 'all' } }, views: ['kpis'], now }).asOf.revision
    service.ingestEvent(header, { type: 'request/header', seq: 0, time: T0, data: { config: { provider: 'deepseek', model: 'deepseek-chat' } } })
    const baseline = revisionAt()

    // A failure for an untouched step fills the empty slot: that is a write.
    service.ingestEvent(header, { type: 'step/end', seq: 1, time: T0 + 1, data: { turn: 0, step: 0, error: 'LlmFailure' } })
    const afterFailure = revisionAt()
    assert.ok(afterFailure > baseline, 'an inserted failure row moves the revision')

    // A clean step/end for a step with no request row updates nothing: no bump.
    service.ingestEvent(header, { type: 'step/end', seq: 2, time: T0 + 2, data: { turn: 7, step: 7 } })
    assert.equal(revisionAt(), afterFailure, 'a no-op step/end must not move the revision')
    service.dispose()
  } finally {
    db.cleanup()
  }
})

test('query cache identity buckets only the clock and keeps result identity stable', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({ databasePath: db.path })
    importUsage(service, 'bucket-session', T0)
    const spec = { filter: { timezone: 'UTC', time: { fromMs: T0, toMs: T0 + 2 * HOUR } }, views: ['kpis'] }
    const base = T0 + 2 * HOUR // minute-aligned: 5s later stays in one bucket
    const first = service.query({ ...spec, now: base })
    const second = service.query({ ...spec, now: base + 5_000 })
    assert.equal(second, first, 'same revision and clock bucket share one cached result object')

    const third = service.query({ ...spec, now: base + 61_000 })
    assert.notEqual(third, first, 'crossing the 60s bucket is a cache miss')
    assert.equal(third.asOf.generatedAtMs, base + 61_000)
    assert.notEqual(third.asOf.generatedAtMs, first.asOf.generatedAtMs)
    assert.deepEqual(third.kpis, first.kpis, 'the miss recomputes the same data, not a different answer')
    service.dispose()
  } finally {
    db.cleanup()
  }
})

test('a freshly ingested request is counted by the very next query despite bucketed cache keys', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({ databasePath: db.path })
    importUsage(service, 'kpi-before', T0)
    const spec = { filter: { timezone: 'UTC', time: { preset: '7d' } }, views: ['kpis'] }
    const now = T0 + HOUR + 30_000 // 30s into its clock bucket
    assert.equal(service.query({ ...spec, now }).kpis.requests, 1)

    // The new request lands after the bucket start but before `now`: a
    // bucket-quantized window would exclude it, the exact window must not.
    service.ingestEvent(
      { version: 0, id: 'kpi-live', createdAt: T0 + HOUR, cwd: '/w/live' },
      { type: 'assistant/message', seq: 1, time: now + 15_000, data: { turn: 0, step: 0, message: { source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } }, usage: { inputTokens: 10, outputTokens: 5 } } },
    )
    // event.time is 15s after `now` — pull the query clock past it instead.
    const later = now + 30_000 // same clock bucket, no revision change since ingest
    const result = service.query({ ...spec, now: later })
    assert.equal(result.kpis.requests, 2, 'the fresh request is counted without waiting for a bucket rollover')
    assert.equal(result.asOf.generatedAtMs, later)
    service.dispose()
  } finally {
    db.cleanup()
  }
})

test('saveAccountConnection is physically idempotent for identical input', () => {
  const db = tempDb()
  try {
    const service = createLedgerService({ databasePath: db.path })
    const createdAt = 1_700_000_000_000
    const connection = {
      providerId: 'antigravity', connectionId: 'conn-cache',
      displayName: 'Account Cache', accountKey: 'key-1',
      configured: true, credentialKind: 'oauth',
      credentialRef: 'ref-1', credentialExpiresAt: 1_000,
      updatedAt: createdAt,
    }
    const first = service.saveAccountConnection(connection)
    assert.equal(first.changed, true)

    // Same stored content with a fresh caller timestamp: nothing is written,
    // so `updated_at` keeps its original value and the flag reports no-op.
    const repeat = service.saveAccountConnection({ ...connection, updatedAt: createdAt + 5_000 })
    assert.equal(repeat.changed, false)

    const renamed = service.saveAccountConnection({ ...connection, displayName: 'Renamed', updatedAt: createdAt + 60_000 })
    assert.equal(renamed.changed, true, 'a real change is reported as such')
    const repeatRenamed = service.saveAccountConnection({ ...connection, displayName: 'Renamed', updatedAt: createdAt + 65_000 })
    assert.equal(repeatRenamed.changed, false)

    service.dispose()
    const probe = new DatabaseSync(db.path)
    try {
      const row = probe.prepare('SELECT updated_at AS updatedAt, display_name AS displayName FROM account_connections WHERE id = ?').get('conn-cache')
      assert.equal(row.displayName, 'Renamed')
      assert.equal(Number(row.updatedAt), createdAt + 60_000, 'no-op saves never touch updated_at')
      const credential = probe.prepare('SELECT updated_at AS updatedAt, credential_ref AS credentialRef FROM credential_metadata WHERE id = ?').get('conn-cache:credential')
      assert.equal(credential.credentialRef, 'ref-1')
      assert.equal(Number(credential.updatedAt), createdAt, 'unchanged credential metadata is not rewritten')
    } finally {
      probe.close()
    }
  } finally {
    db.cleanup()
  }
})
