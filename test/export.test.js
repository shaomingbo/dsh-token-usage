import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createLedgerService } from '../lib/ledger/service.js'
import { requestsToCsv, reportToJson } from '../lib/ledger/export.js'
import { nanoToUsdString } from '../lib/ledger/pricing.js'

const T0 = Date.UTC(2026, 6, 10, 8, 0, 0)

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-token-usage-export-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function sampleRows() {
  return [{
    time: T0, sessionId: 'abcdefgh', cwd: '/Users/somebody/work/repo', provider: 'deepseek',
    model: 'deepseek-chat', status: 'ok', estimated: false,
    inputTokens: 100, outputTokens: 50, cacheReadTokens: 200, cacheWriteTokens: 10,
    reasoningTokens: 20, processingTokens: 360, originalUsdNano: 96000,
  }]
}

test('CSV export has a stable header and anonymizes identifiers by default', () => {
  const csv = requestsToCsv(sampleRows())
  assert.ok(csv.startsWith('time,project,sessionId,provider,model,status,estimated,'))
  assert.ok(!csv.includes('/Users/somebody/work/repo'), 'absolute paths must not leak')
  assert.ok(!csv.includes('abcdefgh'), 'session ids must not leak')
  assert.ok(csv.includes('project-1'))
  assert.ok(csv.includes('session-1'))
  assert.ok(csv.includes('96000'))
})

test('complete CSV export keeps local identifiers when explicitly requested', () => {
  const csv = requestsToCsv(sampleRows(), { anonymize: false, nanoToUsd: nanoToUsdString })
  assert.ok(csv.includes('/Users/somebody/work/repo'))
  assert.ok(csv.includes('abcdefgh'))
  assert.ok(csv.includes('0.000096'), `expected nano formatted: ${csv}`)
})

test('JSON report anonymizes projects and opaque session ids', () => {
  const report = reportToJson({
    totals: { requests: 2 },
    sessions: [{ id: 'abcdefgh', cwd: '/Users/somebody/work/repo', parentSession: 'ijklmn', requests: 2 }],
    filter: { project: ['cwd:/Users/somebody/work/repo'] },
    analysis: { rankings: { dimension: 'project', rows: [{ key: 'cwd:/Users/somebody/work/repo', label: '/Users/somebody/work/repo' }] } },
  })
  assert.equal(report.sessions[0].id, 'session-1')
  assert.equal(report.sessions[0].parentSession, 'session-2')
  assert.equal(report.sessions[0].cwd, 'project-1')
  assert.deepEqual(report.filter.project, ['project-1'])
  assert.equal(report.analysis.rankings.rows[0].key, 'project-1')
  assert.equal(report.analysis.rankings.rows[0].label, 'project-1')
  assert.ok(!JSON.stringify(report).includes('/Users/somebody'))
  const complete = reportToJson({ id: 'abcdefgh' }, { anonymize: false })
  assert.equal(complete.id, 'abcdefgh')
})

test('backup and replace-restore round-trip the ledger', () => {
  const env = tempDir()
  try {
    const dbPath = join(env.dir, 'usage.sqlite')
    const service = createLedgerService({ databasePath: dbPath })
    service.importSession({
      header: { version: 0, id: 's1', createdAt: T0, cwd: '/work/repo-a' },
      events: [
        { type: 'session/start', seq: 0, time: T0, data: {} },
        { type: 'request/header', seq: 1, time: T0 + 1, data: { config: { provider: 'deepseek', model: 'deepseek-chat' } } },
        { type: 'assistant/message', seq: 2, time: T0 + 2, data: { turn: 0, step: 0, message: { source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } }, usage: { inputTokens: 10, outputTokens: 5 } } },
        { type: 'step/end', seq: 3, time: T0 + 3, data: { turn: 0, step: 0 } },
      ],
    })
    const backupPath = join(env.dir, 'backup.sqlite')
    service.backupTo(backupPath)
    assert.ok(existsSync(backupPath))
    service.dispose()

    // Simulate a schema-v1 backup: restore must tolerate tables added later.
    const legacy = new DatabaseSync(backupPath)
    legacy.exec('DROP TABLE price_updates; DROP TABLE request_corrections; DROP TABLE budgets; DROP TABLE project_sources; DROP TABLE projects;')
    legacy.prepare("UPDATE meta SET value = '1' WHERE key = 'schema_version'").run()
    legacy.close()

    // Restore into a fresh (empty) database file.
    const target = join(env.dir, 'restored.sqlite')
    createLedgerService({ databasePath: target }).dispose()
    const restored = createLedgerService({ databasePath: target })
    restored.restoreFrom(backupPath, { mode: 'replace' })
    const totals = restored.getOverview({ timezone: 'UTC' }).totals
    assert.equal(totals.calls, 1)
    assert.equal(totals.processingTokens, 15)
    assert.equal(restored.listProjects().length, 1)
    assert.equal(restored.listProjects()[0].sources[0], '/work/repo-a')
    restored.dispose()
  } finally {
    env.cleanup()
  }
})

test('merge restore is idempotent and never duplicates rows', () => {
  const env = tempDir()
  try {
    const dbPath = join(env.dir, 'usage.sqlite')
    const service = createLedgerService({ databasePath: dbPath })
    service.importSession({
      header: { version: 0, id: 's1', createdAt: T0, cwd: '/work/repo-a' },
      events: [
        { type: 'session/start', seq: 0, time: T0, data: {} },
        { type: 'request/header', seq: 1, time: T0 + 1, data: { config: { provider: 'deepseek', model: 'deepseek-chat' } } },
        { type: 'assistant/message', seq: 2, time: T0 + 2, data: { turn: 0, step: 0, message: { source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } }, usage: { inputTokens: 10, outputTokens: 5 } } },
        { type: 'step/end', seq: 3, time: T0 + 3, data: { turn: 0, step: 0 } },
      ],
    })
    const backupPath = join(env.dir, 'backup.sqlite')
    service.backupTo(backupPath)
    service.dispose()

    const other = createLedgerService({ databasePath: join(env.dir, 'other.sqlite') })
    other.restoreFrom(backupPath, { mode: 'merge' })
    other.restoreFrom(backupPath, { mode: 'merge' }) // twice
    const totals = other.getOverview({ timezone: 'UTC' }).totals
    assert.equal(totals.calls, 1)
    assert.equal(totals.processingTokens, 15)
    other.dispose()
  } finally {
    env.cleanup()
  }
})
