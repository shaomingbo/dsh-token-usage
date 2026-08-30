/**
 * SQLite storage for the usage ledger: capability-checked `node:sqlite`,
 * monotonic schema migrations with a pre-migration backup, and a transaction
 * helper. No third-party native dependency.
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export class LedgerError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'LedgerError'
    this.code = code
  }
}

export const SCHEMA_VERSION = 4

// Capability check happens once at module load: runtimes without built-in
// SQLite get a load-time diagnostic, matching the Node 22.13+/24 requirement.
let sqlite = null
try {
  sqlite = await import('node:sqlite')
} catch {
  sqlite = null
}

/** Whether this runtime provides the built-in SQLite module. */
export function sqliteAvailable() {
  return sqlite !== null && typeof sqlite.DatabaseSync === 'function'
}

const MIGRATIONS = new Map([
  [1, `
    CREATE TABLE IF NOT EXISTS sources (
      session_id TEXT PRIMARY KEY,
      revision TEXT,
      last_seq INTEGER NOT NULL DEFAULT -1,
      source TEXT NOT NULL DEFAULT 'profile',
      created_at INTEGER NOT NULL,
      cwd TEXT,
      parent_session TEXT,
      origin TEXT,
      seed_length INTEGER,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS providers (
      provider TEXT PRIMARY KEY,
      multiplier_bps INTEGER
    );
    CREATE TABLE IF NOT EXISTS aliases (
      model_raw TEXT PRIMARY KEY,
      canonical TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS price_overrides (
      model TEXT PRIMARY KEY,
      input_nano TEXT NOT NULL,
      output_nano TEXT NOT NULL,
      cache_read_nano TEXT,
      cache_write_nano TEXT,
      reasoning_nano TEXT
    );
    CREATE TABLE IF NOT EXISTS requests (
      session_id TEXT NOT NULL,
      turn INTEGER NOT NULL,
      step INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      time INTEGER NOT NULL,
      provider TEXT NOT NULL DEFAULT 'unknown',
      model_raw TEXT NOT NULL DEFAULT 'unknown',
      owned INTEGER NOT NULL DEFAULT 1,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER,
      status TEXT NOT NULL DEFAULT 'unknown',
      estimated INTEGER NOT NULL DEFAULT 0,
      estimator TEXT,
      estimator_version TEXT,
      original_usd_nano INTEGER,
      price_version TEXT,
      PRIMARY KEY (session_id, turn, step)
    );
    CREATE INDEX IF NOT EXISTS requests_time ON requests (time);
    CREATE INDEX IF NOT EXISTS requests_model ON requests (model_raw);
    CREATE INDEX IF NOT EXISTS requests_provider ON requests (provider);
    CREATE TABLE IF NOT EXISTS purged_daily (
      day TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      processing_tokens INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day)
    );
    INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '1');
  `],
  [2, `
    CREATE TABLE IF NOT EXISTS price_updates (
      model TEXT PRIMARY KEY,
      input_nano INTEGER NOT NULL,
      output_nano INTEGER NOT NULL,
      cache_read_nano INTEGER,
      cache_write_nano INTEGER,
      source TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '2');
  `],
  [3, (db) => {
    ensureColumn(db, 'requests', 'duration_ms', 'INTEGER')
    ensureColumn(db, 'requests', 'end_reason', 'TEXT')
    ensureColumn(db, 'requests', 'failure_type', 'TEXT')
    ensureColumn(db, 'sources', 'title', 'TEXT')
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        identity_kind TEXT NOT NULL,
        identity_value TEXT NOT NULL,
        display_name TEXT NOT NULL,
        color TEXT,
        hidden INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE(identity_kind, identity_value)
      );
      CREATE TABLE IF NOT EXISTS project_sources (
        cwd TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        git_root TEXT,
        git_remote TEXT,
        source TEXT NOT NULL DEFAULT 'cwd',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS project_sources_project ON project_sources(project_id);
      INSERT OR IGNORE INTO projects (id, identity_kind, identity_value, display_name, created_at)
        SELECT 'cwd:' || cwd, 'cwd', cwd, cwd, created_at FROM sources WHERE cwd IS NOT NULL;
      INSERT OR IGNORE INTO project_sources (cwd, project_id, source, created_at)
        SELECT cwd, 'cwd:' || cwd, 'cwd', created_at FROM sources WHERE cwd IS NOT NULL;
      CREATE TABLE IF NOT EXISTS request_corrections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        step INTEGER NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        reasoning_tokens INTEGER,
        excluded INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id, turn, step) REFERENCES requests(session_id, turn, step)
      );
      CREATE INDEX IF NOT EXISTS request_corrections_request ON request_corrections(session_id, turn, step, active);
      CREATE TABLE IF NOT EXISTS budgets (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        scope_id TEXT,
        unit TEXT NOT NULL,
        period_month TEXT NOT NULL,
        limit_value TEXT NOT NULL,
        effective_from INTEGER NOT NULL,
        archived_at INTEGER,
        created_at INTEGER NOT NULL,
        UNIQUE(scope, scope_id, unit, period_month)
      );
      CREATE INDEX IF NOT EXISTS budgets_period ON budgets(period_month, archived_at);
      CREATE INDEX IF NOT EXISTS requests_owned_time ON requests(owned, time DESC, session_id, turn, step);
      CREATE INDEX IF NOT EXISTS sources_parent ON sources(parent_session);
      INSERT OR IGNORE INTO meta (key, value) VALUES ('analytics_revision', '0');
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '3');
    `)
  }],
  [4, (db) => {
    // Billing pools (subscription plans and prepaid/relay credit balances) and
    // their attribution rules. Requests are never stamped with a pool; the
    // effective-requests view resolves attribution per analytics revision, so
    // rules can change without rewriting history.
    db.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('sub', 'credit')),
        name TEXT NOT NULL,
        color TEXT,
        price_usd_nano INTEGER,
        quota_unit TEXT CHECK (quota_unit IS NULL OR quota_unit IN ('newCompute', 'usd')),
        quota_value TEXT,
        reset_day INTEGER NOT NULL DEFAULT 1 CHECK (reset_day BETWEEN 1 AND 28),
        balance_usd_nano INTEGER,
        expiry_day TEXT,
        archived_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plan_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id TEXT NOT NULL REFERENCES plans(id),
        match_provider TEXT,
        match_model TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        CHECK (match_provider IS NOT NULL OR match_model IS NOT NULL)
      );
      CREATE INDEX IF NOT EXISTS plan_rules_priority ON plan_rules(priority, id);
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '4');
    `)
  }],
])

function ensureColumn(db, table, column, definition) {
  const columns = new Set(db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => row.name))
  if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

/** Open (creating or migrating) the ledger database at `databasePath`. */
export function openDatabase(databasePath) {
  if (!sqliteAvailable()) {
    throw new LedgerError('sqlite-unavailable', 'node:sqlite is unavailable in this runtime; dsh-token-usage requires Node 22.13+ or 24 with built-in SQLite')
  }
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true })
  }
  const db = new sqlite.DatabaseSync(databasePath)
  try {
    migrate(db, databasePath)
  } catch (error) {
    db.close()
    throw error
  }
  db.exec('PRAGMA journal_mode = WAL')
  return db
}

function migrate(db, databasePath) {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version')
  const current = row === undefined ? 0 : Number(row.value)
  if (current > SCHEMA_VERSION) {
    throw new LedgerError('database-newer', `ledger schema v${current} is newer than this plugin supports (v${SCHEMA_VERSION}); upgrade the plugin before opening this database`)
  }
  if (current === SCHEMA_VERSION) return
  // Any migration on an existing file takes an automatic pre-migration copy.
  if (databasePath !== ':memory:' && existsSync(databasePath)) {
    copyFileSync(databasePath, `${databasePath}.pre-migration`)
  }
  db.exec('BEGIN')
  try {
    for (let version = current + 1; version <= SCHEMA_VERSION; version += 1) {
      const migration = MIGRATIONS.get(version)
      if (typeof migration === 'function') migration(db)
      else db.exec(migration)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw new LedgerError('migration-failed', `ledger migration failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Run `fn` inside a transaction; rolls back on throw. */
export function transaction(db, fn) {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
