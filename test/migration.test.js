import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, SCHEMA_VERSION, LedgerError } from '../lib/ledger/db.js'
import { createLedgerService } from '../lib/ledger/service.js'

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-token-usage-mig-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('fresh databases open at the current schema version', () => {
  const env = tempDir()
  try {
    const dbPath = join(env.dir, 'usage.sqlite')
    const db = openDatabase(dbPath)
    const version = Number(db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version').value)
    assert.equal(version, SCHEMA_VERSION)
    db.close()
  } finally {
    env.cleanup()
  }
})

test('a database written by a newer schema refuses to open and stays untouched', () => {
  const env = tempDir()
  try {
    const dbPath = join(env.dir, 'usage.sqlite')
    createLedgerService({ databasePath: dbPath }).dispose()
    const db = openDatabase(dbPath)
    db.prepare("UPDATE meta SET value = '99' WHERE key = 'schema_version'").run()
    db.close()
    const before = existsSync(dbPath)
    assert.throws(() => createLedgerService({ databasePath: dbPath }), (error) => error instanceof LedgerError && error.code === 'database-newer')
    assert.equal(existsSync(dbPath), before)
  } finally {
    env.cleanup()
  }
})

test('re-running migrations on an existing file creates a pre-migration backup', () => {
  const env = tempDir()
  try {
    const dbPath = join(env.dir, 'usage.sqlite')
    createLedgerService({ databasePath: dbPath }).dispose()
    // Force the migration path by rewinding the recorded version.
    const db = openDatabase(dbPath)
    db.prepare("UPDATE meta SET value = '0' WHERE key = 'schema_version'").run()
    db.close()
    openDatabase(dbPath).close()
    assert.ok(existsSync(`${dbPath}.pre-migration`), 'expected a pre-migration backup copy')
  } finally {
    env.cleanup()
  }
})

test('truncated database files surface a contained error, not a crash', () => {
  const env = tempDir()
  try {
    const dbPath = join(env.dir, 'usage.sqlite')
    writeFileSync(dbPath, Buffer.from('this is not a database at all'))
    assert.throws(() => createLedgerService({ databasePath: dbPath }))
  } finally {
    env.cleanup()
  }
})
