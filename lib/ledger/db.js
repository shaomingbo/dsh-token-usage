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

export const SCHEMA_VERSION = 8

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
  [5, (db) => {
    // Quota windows: month = billing-cycle reset day; 5h/7d = rolling.
    // window2 is the Codex-style secondary cap (weekly under a 5h primary).
    ensureColumn(db, 'plans', 'window_kind', "TEXT NOT NULL DEFAULT 'month'")
    ensureColumn(db, 'plans', 'window2_kind', 'TEXT')
    ensureColumn(db, 'plans', 'window2_quota_value', 'TEXT')
    ensureColumn(db, 'plans', 'window2_quota_unit', 'TEXT')
    db.exec(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '5')`)
  }],
  [6, (db) => {
    // Accounts & Usage is additive: the local usage ledger and every legacy
    // billing-pool table remain authoritative and readable. Account secrets
    // deliberately have no column in this schema.
    db.exec(`
      CREATE TABLE IF NOT EXISTS account_connections (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        account_key TEXT,
        display_name TEXT,
        status TEXT NOT NULL DEFAULT 'unknown',
        auth_kind TEXT NOT NULL DEFAULT 'none',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(provider_id, account_key)
      );
      CREATE TABLE IF NOT EXISTS credential_metadata (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES account_connections(id),
        credential_ref TEXT NOT NULL,
        kind TEXT NOT NULL,
        expires_at INTEGER,
        scopes_json TEXT,
        updated_at INTEGER NOT NULL,
        UNIQUE(connection_id, credential_ref)
      );
      CREATE TABLE IF NOT EXISTS account_products (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        external_id TEXT,
        name TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        archived_at INTEGER,
        created_at INTEGER NOT NULL,
        UNIQUE(provider_id, external_id)
      );
      CREATE TABLE IF NOT EXISTS account_billing (
        id TEXT PRIMARY KEY,
        connection_id TEXT REFERENCES account_connections(id),
        product_id TEXT NOT NULL REFERENCES account_products(id),
        kind TEXT NOT NULL,
        currency TEXT,
        amount_nano TEXT,
        cycle_anchor_day INTEGER,
        balance_nano TEXT,
        expires_at INTEGER,
        source_kind TEXT NOT NULL,
        observed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS account_limits (
        id TEXT PRIMARY KEY,
        connection_id TEXT REFERENCES account_connections(id),
        product_id TEXT REFERENCES account_products(id),
        external_key TEXT,
        metric TEXT NOT NULL,
        unit TEXT NOT NULL,
        value_mode TEXT NOT NULL CHECK(value_mode IN ('exact','range','dynamic','unpublished','manual')),
        exact_value TEXT,
        minimum_value TEXT,
        maximum_value TEXT,
        window_kind TEXT NOT NULL CHECK(window_kind IN ('rolling','fixed','billing','rate')),
        window_seconds INTEGER,
        window_json TEXT,
        reset_at INTEGER,
        source_kind TEXT NOT NULL,
        confidence TEXT,
        note TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS account_limits_connection ON account_limits(connection_id, product_id);
      CREATE TABLE IF NOT EXISTS account_observations (
        id TEXT PRIMARY KEY,
        connection_id TEXT REFERENCES account_connections(id),
        product_id TEXT REFERENCES account_products(id),
        observed_at INTEGER NOT NULL,
        source_kind TEXT NOT NULL,
        brittle INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS account_observations_connection_time ON account_observations(connection_id, observed_at DESC);
      CREATE TABLE IF NOT EXISTS provider_templates (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        name TEXT NOT NULL,
        product_json TEXT NOT NULL,
        limits_json TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(provider_id, name)
      );
      CREATE TABLE IF NOT EXISTS provider_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id TEXT NOT NULL,
        external_key TEXT NOT NULL,
        template_id TEXT NOT NULL REFERENCES provider_templates(id),
        created_at INTEGER NOT NULL,
        UNIQUE(provider_id, external_key)
      );
      CREATE TABLE IF NOT EXISTS account_attribution_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        connection_id TEXT REFERENCES account_connections(id),
        product_id TEXT NOT NULL REFERENCES account_products(id),
        match_provider TEXT,
        match_model TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        source_kind TEXT NOT NULL,
        CHECK(match_provider IS NOT NULL OR match_model IS NOT NULL)
      );
    `)

    // Lossless compatibility projection: each v5 plan becomes one manual
    // product, billing observation and up to two manual-estimate limits. The
    // old plans/plan_rules rows are retained and never rewritten.
    const migratedAt = Date.now()
    projectLegacyPlans(db, migratedAt)
    db.exec(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '6')`)
  }],
  [7, (db) => {
    // v5 → account flip: products gain a display color and an explicit
    // connection link (auto accounts and template accounts bound to a live
    // connection). Additive only; ledger facts stay untouched.
    ensureColumn(db, 'account_products', 'color', 'TEXT')
    ensureColumn(db, 'account_products', 'connection_id', 'TEXT')
    db.exec(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '7')`)
  }],
  [8, (db) => {
    // Provider connection provenance is an observed request fact. Historical
    // rows stay NULL and remain eligible only for provider/model attribution.
    ensureColumn(db, 'requests', 'connection_id', 'TEXT')
    db.exec(`
      CREATE INDEX IF NOT EXISTS requests_connection_time ON requests(connection_id, time);
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '8');
    `)
  }],
])

/**
 * Lossless v5 plans → account-domain projection. Runs at migration time and
 * again after any legacy write (the deprecated save-plan family) so
 * plan-authored rows stay authoritative for their projected copies.
 * Idempotent; never deletes; never touches non-legacy rows.
 */
export function projectLegacyPlans(db, migratedAt = Date.now()) {
  db.prepare(`
    INSERT INTO account_products
      (id, provider_id, external_id, name, source_kind, archived_at, created_at)
    SELECT 'legacy-plan:' || id, 'manual', id, name, 'legacy_v5_manual', archived_at, created_at
    FROM plans
    WHERE true
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, archived_at = excluded.archived_at
  `).run()
  db.prepare(`
    INSERT INTO account_billing
      (id, product_id, kind, currency, amount_nano, cycle_anchor_day, balance_nano, expires_at, source_kind, observed_at)
    SELECT 'legacy-billing:' || id, 'legacy-plan:' || id,
           CASE kind WHEN 'sub' THEN 'subscription' WHEN 'credit' THEN 'prepaid' ELSE 'unpublished' END,
           'USD', CAST(price_usd_nano AS TEXT), reset_day, CAST(balance_usd_nano AS TEXT),
           CASE WHEN expiry_day IS NULL THEN NULL ELSE unixepoch(expiry_day) * 1000 END,
           'legacy_v5_manual', ?
    FROM plans
    WHERE true
    ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, amount_nano = excluded.amount_nano,
      cycle_anchor_day = excluded.cycle_anchor_day, balance_nano = excluded.balance_nano,
      expires_at = excluded.expires_at, observed_at = excluded.observed_at
  `).run(migratedAt)
  db.prepare(`
    INSERT INTO account_limits
      (id, product_id, external_key, metric, unit, value_mode, exact_value,
       window_kind, window_seconds, source_kind, confidence, note, created_at)
    SELECT 'legacy-limit:' || id || ':1', 'legacy-plan:' || id, 'primary',
           'quota', COALESCE(quota_unit, 'unknown'), 'manual', quota_value,
           CASE window_kind WHEN '5h' THEN 'rolling' WHEN '7d' THEN 'rolling'
                            WHEN 'month' THEN 'billing' ELSE 'fixed' END,
           CASE window_kind WHEN '5h' THEN 18000 WHEN '7d' THEN 604800 ELSE NULL END,
           'legacy_v5_manual', 'manual_estimate', 'Migrated losslessly from the v5 primary window', ?
    FROM plans WHERE quota_value IS NOT NULL
    ON CONFLICT(id) DO UPDATE SET unit = excluded.unit, exact_value = excluded.exact_value,
      window_kind = excluded.window_kind, window_seconds = excluded.window_seconds
  `).run(migratedAt)
  db.prepare(`
    INSERT INTO account_limits
      (id, product_id, external_key, metric, unit, value_mode, exact_value,
       window_kind, window_seconds, source_kind, confidence, note, created_at)
    SELECT 'legacy-limit:' || id || ':2', 'legacy-plan:' || id, 'secondary',
           'quota', COALESCE(window2_quota_unit, 'unknown'), 'manual', window2_quota_value,
           CASE window2_kind WHEN '5h' THEN 'rolling' WHEN '7d' THEN 'rolling'
                             WHEN 'month' THEN 'billing' ELSE 'fixed' END,
           CASE window2_kind WHEN '5h' THEN 18000 WHEN '7d' THEN 604800 ELSE NULL END,
           'legacy_v5_manual', 'manual_estimate', 'Migrated losslessly from the v5 secondary window', ?
    FROM plans WHERE window2_quota_value IS NOT NULL
    ON CONFLICT(id) DO UPDATE SET unit = excluded.unit, exact_value = excluded.exact_value,
      window_kind = excluded.window_kind, window_seconds = excluded.window_seconds
  `).run(migratedAt)
  db.prepare(`
    INSERT INTO account_attribution_rules
      (id, product_id, match_provider, match_model, priority, source_kind)
    SELECT id, 'legacy-plan:' || plan_id, match_provider, match_model, priority, 'legacy_v5_manual'
    FROM plan_rules
    WHERE true
    ON CONFLICT(id) DO UPDATE SET match_provider = excluded.match_provider,
      match_model = excluded.match_model, priority = excluded.priority
  `).run()
}

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

/**
 * Open an existing ledger for downgrade diagnostics without ever enabling a
 * write path. This is intentionally separate from openDatabase: normal host
 * operation still refuses a newer schema, while an older plugin can inspect
 * metadata and legacy tables without damaging a database written by v6+.
 */
export function openDatabaseReadOnly(databasePath) {
  if (!sqliteAvailable()) {
    throw new LedgerError('sqlite-unavailable', 'node:sqlite is unavailable in this runtime')
  }
  if (databasePath === ':memory:' || !existsSync(databasePath)) {
    throw new LedgerError('database-missing', 'read-only ledger diagnostics require an existing database file')
  }
  const db = new sqlite.DatabaseSync(databasePath, { readOnly: true })
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()
    return { db, schemaVersion: row === undefined ? 0 : Number(row.value), readOnly: true }
  } catch (error) {
    db.close()
    throw new LedgerError('database-read-failed', `could not inspect ledger read-only: ${error instanceof Error ? error.message : String(error)}`)
  }
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
    // Ensure committed WAL pages reach the main file before the byte-for-byte
    // pre-migration copy; copying only the main file without this checkpoint
    // can silently omit recent committed rows.
    try { db.exec('PRAGMA wal_checkpoint(FULL)') } catch { /* non-WAL databases need no checkpoint */ }
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
