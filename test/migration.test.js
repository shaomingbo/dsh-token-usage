import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, openDatabaseReadOnly, SCHEMA_VERSION, LedgerError } from '../lib/ledger/db.js'
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

test('v2 schema stores project identities, request metadata, corrections, and budgets', () => {
  const db = openDatabase(':memory:')
  try {
    const requestColumns = new Set(db.prepare("PRAGMA table_info('requests')").all().map((row) => row.name))
    assert.ok(requestColumns.has('duration_ms'))
    assert.ok(requestColumns.has('connection_id'))
    assert.ok(requestColumns.has('end_reason'))
    assert.ok(requestColumns.has('failure_type'))
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name))
    for (const name of ['projects', 'project_sources', 'request_corrections', 'budgets']) assert.ok(tables.has(name), `missing ${name}`)
  } finally {
    db.close()
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

test('v9 preserves legacy cache facts while restoring reported-versus-unknown presence', () => {
  const env = tempDir()
  try {
    const dbPath = join(env.dir, 'usage.sqlite')
    const legacy = openDatabase(dbPath)
    const insert = legacy.prepare(`INSERT INTO requests
      (session_id, turn, step, seq, time, provider, model_raw, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, status, original_usd_nano)
      VALUES (?, 0, 0, 1, ?, 'ollama-cloud', 'glm-5.3', 100, 10, ?, 0, 'ok', ?)`)
    insert.run('zero', 1, 0, 111)
    insert.run('positive', 2, 60, 222)
    legacy.exec(`
      ALTER TABLE requests DROP COLUMN cache_read_state;
      ALTER TABLE requests DROP COLUMN cache_write_state;
      UPDATE meta SET value = '8' WHERE key = 'schema_version';
    `)
    legacy.close()

    const migrated = openDatabase(dbPath)
    const rows = migrated.prepare('SELECT session_id, cache_read_tokens, cache_read_state, cache_write_state, original_usd_nano FROM requests ORDER BY session_id').all().map((row) => ({ ...row }))
    assert.deepEqual(rows, [
      { session_id: 'positive', cache_read_tokens: 60, cache_read_state: 'reported', cache_write_state: 'unknown', original_usd_nano: 222 },
      { session_id: 'zero', cache_read_tokens: 0, cache_read_state: 'unknown', cache_write_state: 'unknown', original_usd_nano: 111 },
    ])
    assert.equal(Number(migrated.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value), SCHEMA_VERSION)
    migrated.close()
    assert.ok(existsSync(`${dbPath}.pre-migration`))
  } finally {
    env.cleanup()
  }
})

test('v6 adds account-domain tables without removing legacy tables', () => {
  const db = openDatabase(':memory:')
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name))
    for (const name of [
      'plans', 'plan_rules', 'account_connections', 'credential_metadata',
      'account_products', 'account_billing', 'account_limits', 'account_observations',
      'provider_templates', 'provider_mappings', 'account_attribution_rules',
    ]) assert.ok(tables.has(name), `missing ${name}`)
    const secretColumns = db.prepare("PRAGMA table_info('credential_metadata')").all().map((row) => row.name)
    assert.equal(secretColumns.some((name) => /token|secret|cookie|authorization|value/i.test(name)), false)
  } finally {
    db.close()
  }
})

test('v8 adds nullable connection provenance without assigning historical requests', () => {
  const env = tempDir()
  try {
    const dbPath = join(env.dir, 'usage.sqlite')
    const legacy = openDatabase(dbPath)
    legacy.exec('DROP INDEX requests_connection_time')
    legacy.exec('ALTER TABLE requests DROP COLUMN connection_id')
    legacy.prepare(`INSERT INTO requests
      (session_id, turn, step, seq, time, provider, model_raw, owned)
      VALUES ('legacy', 0, 0, 1, 1, 'antigravity', 'gemini', 1)`).run()
    legacy.prepare("UPDATE meta SET value = '7' WHERE key = 'schema_version'").run()
    legacy.close()

    const migrated = openDatabase(dbPath)
    const row = migrated.prepare("SELECT connection_id AS connectionId, provider FROM requests WHERE session_id = 'legacy'").get()
    assert.equal(row.connectionId, null)
    assert.equal(row.provider, 'antigravity')
    assert.equal(Number(migrated.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value), SCHEMA_VERSION)
    migrated.close()
  } finally {
    env.cleanup()
  }
})

test('v5 plans and both windows migrate losslessly as manual estimates', () => {
  const env = tempDir()
  try {
    const dbPath = join(env.dir, 'usage.sqlite')
    const db = openDatabase(dbPath)
    db.prepare(`INSERT INTO plans
      (id, kind, name, quota_unit, quota_value, reset_day, created_at, window_kind,
       window2_kind, window2_quota_value, window2_quota_unit)
      VALUES ('p1', 'sub', 'Fixture', 'newCompute', '1000', 7, 1, '5h', '7d', '5000', 'newCompute')`).run()
    db.prepare("UPDATE meta SET value = '5' WHERE key = 'schema_version'").run()
    db.close()
    const migrated = openDatabase(dbPath)
    const product = migrated.prepare("SELECT * FROM account_products WHERE id = 'legacy-plan:p1'").get()
    assert.equal(product.name, 'Fixture')
    const limits = migrated.prepare("SELECT * FROM account_limits WHERE product_id = 'legacy-plan:p1' ORDER BY external_key").all()
    assert.equal(limits.length, 2)
    assert.deepEqual(limits.map((row) => [row.external_key, row.value_mode, row.exact_value, row.window_kind, row.window_seconds]), [
      ['primary', 'manual', '1000', 'rolling', 18000],
      ['secondary', 'manual', '5000', 'rolling', 604800],
    ])
    assert.equal(migrated.prepare("SELECT COUNT(*) AS count FROM plans WHERE id = 'p1'").get().count, 1)
    const billing = migrated.prepare("SELECT connection_id, kind FROM account_billing WHERE id = 'legacy-billing:p1'").get()
    assert.equal(billing.connection_id, null)
    assert.equal(billing.kind, 'subscription')
    migrated.close()
  } finally {
    env.cleanup()
  }
})

test('newer databases can be inspected only through the explicit read-only seam', () => {
  const env = tempDir()
  try {
    const dbPath = join(env.dir, 'usage.sqlite')
    const db = openDatabase(dbPath)
    db.prepare("UPDATE meta SET value = '99' WHERE key = 'schema_version'").run()
    db.close()
    const diagnostic = openDatabaseReadOnly(dbPath)
    assert.equal(diagnostic.schemaVersion, 99)
    assert.equal(diagnostic.readOnly, true)
    assert.throws(() => diagnostic.db.prepare("UPDATE meta SET value = '1' WHERE key = 'schema_version'").run())
    diagnostic.db.close()
  } finally {
    env.cleanup()
  }
})

test('provider observations persist separately from the local ledger and reject secrets', () => {
  const service = createLedgerService({ databasePath: ':memory:' })
  try {
    const observation = {
      id: 'ollama-local:fixture:1', recordType: 'observation', providerId: 'ollama-local', connectionId: 'fixture',
      observedAt: 1, source: 'local_ledger', brittle: false, complete: true, quotaApplicable: false,
      product: null, billing: null, windows: [], limits: [], warnings: [], metadata: null,
    }
    service.saveAccountObservation(observation)
    assert.deepEqual(service.listAccountObservations(), [observation])
    assert.throws(() => service.saveAccountObservation({ ...observation, id: 'bad', apiKey: 'secret' }), error => error.code === 'secret-rejected')
  } finally {
    service.dispose()
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
