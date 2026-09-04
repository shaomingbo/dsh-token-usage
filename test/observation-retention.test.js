import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { openDatabase } from '../lib/ledger/db.js'
import { createLedgerService, OBSERVATION_RETENTION_PER_CONNECTION } from '../lib/ledger/service.js'

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-token-usage-obs-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Minimal official observation: `usable` false models a window-less reachability probe. */
function observation(id, connectionId, observedAt, usable = true) {
  const windowId = `${id}:window`
  return {
    id, providerId: 'ollama-cloud', connectionId, observedAt,
    source: 'official_ui', brittle: false, complete: true, quotaApplicable: true,
    windows: usable ? [{ id: windowId, kind: 'rolling', label: 'Weekly', durationMs: 604_800_000, resetsAt: observedAt + 604_800_000 }] : [],
    limits: usable ? [{ id: `${id}:limit`, windowId, metric: 'cloud_usage', unit: 'percent', mode: 'dynamic', percentUsed: 42, observedAt }] : [],
    warnings: [], metadata: null,
  }
}

/** Count a connection's stored observation rows on a freshly opened handle. */
function storedRows(dbPath, connectionId) {
  const db = openDatabase(dbPath)
  try {
    return db.prepare('SELECT id, usable FROM account_observations WHERE connection_id = ? ORDER BY observed_at, id').all(connectionId)
      .map((row) => ({ ...row }))
  } finally {
    db.close()
  }
}

test('retention keeps only the newest 1,000 observations per connection', () => {
  const env = tempDir()
  try {
    const dbPath = join(env.dir, 'usage.sqlite')
    const service = createLedgerService({ databasePath: dbPath })
    try {
      assert.equal(OBSERVATION_RETENTION_PER_CONNECTION, 1_000)
      for (let i = 1; i <= 1_050; i += 1) {
        service.saveAccountObservation(observation(`kept-${i}`, 'retained:default', i))
      }
    } finally {
      service.dispose()
    }

    const rows = storedRows(dbPath, 'retained:default')
    assert.equal(rows.length, 1_000, 'the connection history is capped at the retention window')
    assert.equal(rows.at(-1).id, 'kept-1050', 'the newest observation survives')
    assert.equal(rows[0].id, 'kept-51', 'the oldest observations are pruned')
    assert.ok(rows.every((row) => row.usable === 1), 'every retained row is usable')
  } finally {
    env.cleanup()
  }
})

test('a flood of window-less probes neither evicts nor masks the newest usable observation', () => {
  const env = tempDir()
  try {
    const dbPath = join(env.dir, 'usage.sqlite')
    const service = createLedgerService({ databasePath: dbPath })
    try {
      service.saveAccountConnection({ providerId: 'ollama-cloud', connectionId: 'flood:default', displayName: 'Flood', configured: true })
      const account = service.ensureConnectionAccount(
        { providerId: 'ollama-cloud', connectionId: 'flood:default', displayName: 'Flood', configured: true },
        { aliases: ['ollama-cloud'], attribution: 'connection' },
      )
      // One real scrape, then 1,200 window-less probes — far beyond the
      // retention window, so the plain cap would drop the scrape.
      service.saveAccountObservation(observation('scrape-1', 'flood:default', 1))
      for (let i = 2; i <= 1_201; i += 1) {
        service.saveAccountObservation(observation(`probe-${i}`, 'flood:default', i, false))
      }

      const now = 1_201
      const pools = service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now }).pools
      const flood = pools.pools.find((pool) => pool.id === account.id)
      assert.equal(flood.official.sourceKind, 'official_ui', 'the guarded scrape is still the latest observation')
      assert.equal(flood.official.windows[0].percentUsed, 42, 'the probe run did not mask the usable payload')
      assert.equal(pools.tightestPoolId, account.id)
      const summary = service.entrySummary({ now, timezone: 'UTC' })
      assert.equal(summary.tightest.usedPct, 42)
    } finally {
      service.dispose()
    }

    const rows = storedRows(dbPath, 'flood:default')
    assert.equal(rows.length, OBSERVATION_RETENTION_PER_CONNECTION + 1, '1,000 newest probes plus the guarded usable row')
    assert.ok(rows.some((row) => row.id === 'scrape-1' && row.usable === 1), 'the newest usable row is never deleted')
    const probeNumbers = rows.filter((row) => row.id.startsWith('probe-')).map((row) => Number(row.id.slice('probe-'.length)))
    assert.equal(probeNumbers.length, 1_000)
    assert.equal(Math.min(...probeNumbers), 202, 'exactly the probes outside the newest 1,000 were pruned')
    assert.equal(Math.max(...probeNumbers), 1_201)
  } finally {
    env.cleanup()
  }
})

test('official reads stay flat as observation history grows a hundredfold', () => {
  const env = tempDir()
  try {
    // Rows are bulk-loaded so the test isolates read scaling from save cost;
    // retention caps each connection at the same 1,000 rows both paths would
    // reach in production anyway.
    const build = (dbPath, connections, rowsPerConnection) => {
      const setup = createLedgerService({ databasePath: dbPath })
      try {
        setup.ensureConnectionAccount(
          { providerId: 'ollama-cloud', connectionId: `scale-${connections - 1}`, displayName: 'Scale', configured: true },
          { aliases: ['ollama-cloud'], attribution: 'provider' },
        )
      } finally {
        setup.dispose()
      }
      const db = openDatabase(dbPath)
      try {
        db.exec('BEGIN')
        const connection = db.prepare(`INSERT INTO account_connections (id, provider_id, status, auth_kind, created_at, updated_at)
          VALUES (?, 'ollama-cloud', 'connected', 'external', 1, 1)`)
        const insert = db.prepare(`INSERT INTO account_observations
          (id, connection_id, observed_at, source_kind, brittle, usable, payload_json)
          VALUES (?, ?, ?, 'official_ui', 0, 1, ?)`)
        for (let c = 0; c < connections; c += 1) {
          const connectionId = `scale-${c}`
          connection.run(connectionId)
          for (let i = 1; i <= rowsPerConnection; i += 1) {
            const payload = JSON.stringify({
              observedAt: i,
              windows: [{ id: 'w', kind: 'rolling', label: 'Weekly', durationMs: 604_800_000, resetsAt: 900_000_000_000 }],
              limits: [{ id: 'l', windowId: 'w', metric: 'cloud_usage', unit: 'percent', mode: 'dynamic', percentUsed: 42, observedAt: i }],
            })
            insert.run(`${connectionId}:${i}`, connectionId, i, payload)
          }
        }
        db.exec('COMMIT')
      } finally {
        db.close()
      }
    }

    // Uncached reads only: every sample advances past the 60s clock bucket so
    // revision- and clock-keyed caches cannot hide the observation join.
    const medianReadMs = (dbPath) => {
      const service = createLedgerService({ databasePath: dbPath })
      try {
        const samples = []
        for (let i = 0; i < 9; i += 1) {
          const now = 1_000_000_000 + i * 61_000
          const start = performance.now()
          service.query({ filter: { timezone: 'UTC' }, views: ['pools'], now })
          service.entrySummary({ now, timezone: 'UTC' })
          samples.push(performance.now() - start)
        }
        return samples.sort((a, b) => a - b)[4]
      } finally {
        service.dispose()
      }
    }

    const smallPath = join(env.dir, 'small.sqlite')
    const largePath = join(env.dir, 'large.sqlite')
    build(smallPath, 1, 100)
    build(largePath, 10, 1_000)

    // Structural check: the latest-per-connection join returns one row per
    // connection on the 10,000-row database — never one per history row.
    const db = openDatabase(largePath)
    try {
      const latest = db.prepare(`
        SELECT o.connection_id AS connectionId
        FROM account_observations o
        JOIN (
          SELECT connection_id, MAX(observed_at) AS latest
          FROM account_observations
          WHERE connection_id IS NOT NULL AND usable = 1
          GROUP BY connection_id
        ) m ON m.connection_id = o.connection_id AND m.latest = o.observed_at
        WHERE o.usable = 1
      `).all()
      assert.equal(latest.length, 10, 'the latest read scales with connections, not history')
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM account_observations').get().count, 10_000)
    } finally {
      db.close()
    }

    const smallMs = medianReadMs(smallPath)
    const largeMs = medianReadMs(largePath)
    assert.ok(
      largeMs < Math.max(smallMs, 0.25) * 5,
      `pools/entrySummary latency must not track history: 100 rows ${smallMs.toFixed(3)}ms vs 10,000 rows ${largeMs.toFixed(3)}ms`,
    )
  } finally {
    env.cleanup()
  }
})
