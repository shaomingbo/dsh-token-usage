import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  })
  assert.equal(report.sessions[0].id, 'session-1')
  assert.equal(report.sessions[0].parentSession, 'session-2')
  assert.equal(report.sessions[0].cwd, 'project-1')
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

    // Restore into a fresh (empty) database file.
    const target = join(env.dir, 'restored.sqlite')
    createLedgerService({ databasePath: target }).dispose()
    const restored = createLedgerService({ databasePath: target })
    restored.restoreFrom(backupPath, { mode: 'replace' })
    const totals = restored.getOverview({ timezone: 'UTC' }).totals
    assert.equal(totals.calls, 1)
    assert.equal(totals.processingTokens, 15)
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
