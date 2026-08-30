import { AccountsError, normalizeRecord, serializePublic } from './domain.js'


/** Canonical persistence over the additive v6 tables; secrets have no write path. */
export class AccountsStore {
  constructor(db, { now = Date.now } = {}) {
    if (!db || typeof db.prepare !== 'function') throw new AccountsError('invalid-storage', 'database must provide prepare')
    this.db = db
    this.now = now
  }

  put(type, input) {
    if (type === 'window') throw new AccountsError('embedded-window', 'windows persist as part of limits and observations')
    const record = normalizeRecord(type, input)
    switch (type) {
      case 'connection':
        this.#run(`INSERT INTO account_connections
          (id, provider_id, account_key, display_name, status, auth_kind, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET provider_id=excluded.provider_id, account_key=excluded.account_key,
            display_name=excluded.display_name, status=excluded.status, auth_kind=excluded.auth_kind,
            updated_at=excluded.updated_at`,
        record.id, record.providerId, record.accountKey, record.label, record.status, record.authKind, record.createdAt, record.updatedAt)
        break
      case 'credential_metadata':
        this.#run(`INSERT INTO credential_metadata
          (id, connection_id, credential_ref, kind, expires_at, scopes_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET connection_id=excluded.connection_id,
            credential_ref=excluded.credential_ref, kind=excluded.kind, expires_at=excluded.expires_at,
            scopes_json=excluded.scopes_json, updated_at=excluded.updated_at`,
        record.id, record.connectionId, record.credentialRef, record.kind, record.expiresAt,
        JSON.stringify(record.scopes), record.updatedAt)
        break
      case 'product':
        this.#run(`INSERT INTO account_products
          (id, provider_id, external_id, name, source_kind, archived_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET provider_id=excluded.provider_id, external_id=excluded.external_id,
            name=excluded.name, source_kind=excluded.source_kind, archived_at=excluded.archived_at`,
        record.id, record.providerId, record.externalId, record.name, record.sourceKind, record.archivedAt, record.createdAt)
        break
      case 'billing':
        this.#run(`INSERT INTO account_billing
          (id, connection_id, product_id, kind, currency, amount_nano, cycle_anchor_day,
           balance_nano, expires_at, source_kind, observed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET connection_id=excluded.connection_id, product_id=excluded.product_id,
            kind=excluded.kind, currency=excluded.currency, amount_nano=excluded.amount_nano,
            cycle_anchor_day=excluded.cycle_anchor_day, balance_nano=excluded.balance_nano,
            expires_at=excluded.expires_at, source_kind=excluded.source_kind, observed_at=excluded.observed_at`,
        record.id, record.connectionId, record.productId, record.model, record.currency,
        record.amountNano ?? (record.amountMinor === null ? null : String(record.amountMinor)),
        record.cycleAnchorDay, record.balanceNano, record.expiresAt, record.sourceKind, record.observedAt)
        break
      case 'limit': {
        const window = record.window
        if (window === null) throw new AccountsError('window-required', 'persisted limit requires its canonical window record')
        this.#run(`INSERT INTO account_limits
          (id, connection_id, product_id, external_key, metric, unit, value_mode, exact_value,
           minimum_value, maximum_value, window_kind, window_seconds, window_json, reset_at, source_kind,
           confidence, note, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET connection_id=excluded.connection_id, product_id=excluded.product_id,
            external_key=excluded.external_key, metric=excluded.metric, unit=excluded.unit,
            value_mode=excluded.value_mode, exact_value=excluded.exact_value,
            minimum_value=excluded.minimum_value, maximum_value=excluded.maximum_value,
            window_kind=excluded.window_kind, window_seconds=excluded.window_seconds,
            window_json=excluded.window_json, reset_at=excluded.reset_at, source_kind=excluded.source_kind,
            confidence=excluded.confidence, note=excluded.note`,
        record.id, record.connectionId, record.productId, record.externalKey, record.metric, record.unit,
        record.mode, nullableText(record.value), nullableText(record.min), nullableText(record.max),
        window.kind, window.durationMs === null ? null : Math.trunc(window.durationMs / 1000),
        serializePublic(window), window.resetsAt, record.sourceKind, record.confidence, record.note, record.createdAt)
        break
      }
      case 'observation':
        this.#run(`INSERT INTO account_observations
          (id, connection_id, product_id, observed_at, source_kind, brittle, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET connection_id=excluded.connection_id, product_id=excluded.product_id,
            observed_at=excluded.observed_at, source_kind=excluded.source_kind,
            brittle=excluded.brittle, payload_json=excluded.payload_json`,
        record.id, record.connectionId, record.product?.id ?? null, record.observedAt,
        record.source, record.brittle ? 1 : 0, serializePublic(record))
        break
      case 'provider_template':
        this.#run(`INSERT INTO provider_templates
          (id, provider_id, name, product_json, limits_json, source_kind, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET provider_id=excluded.provider_id, name=excluded.name,
            product_json=excluded.product_json, limits_json=excluded.limits_json,
            source_kind=excluded.source_kind, updated_at=excluded.updated_at`,
        record.id, record.providerId, record.name, serializePublic(record.product),
        serializePublic(record.limits), record.sourceKind, record.updatedAt)
        break
      case 'provider_mapping':
        this.#run(`INSERT INTO provider_mappings
          (provider_id, external_key, template_id, created_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(provider_id, external_key) DO UPDATE SET
            template_id=excluded.template_id, created_at=excluded.created_at`,
        record.providerId, record.externalKey, record.templateId, record.createdAt)
        return decode('provider_mapping', this.db.prepare(
          'SELECT * FROM provider_mappings WHERE provider_id = ? AND external_key = ?',
        ).get(record.providerId, record.externalKey))
      default:
        throw new AccountsError('unknown-record-type', `unknown account record type: ${type}`)
    }
    return record
  }

  get(type, id) {
    if (type === 'window') throw new AccountsError('embedded-window', 'windows persist as part of limits and observations')
    const table = tableFor(type)
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(String(id))
    return row === undefined ? null : decode(type, row)
  }

  list(type, { providerId, connectionId, limit = 100 } = {}) {
    if (type === 'window') throw new AccountsError('embedded-window', 'windows persist as part of limits and observations')
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new AccountsError('invalid-storage-query', 'limit must be between 1 and 1000')
    const table = tableFor(type)
    const columns = new Set(this.db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => row.name))
    const clauses = []
    const params = []
    if (providerId !== undefined) {
      if (!columns.has('provider_id')) throw new AccountsError('invalid-storage-query', `${type} does not support providerId filtering`)
      clauses.push('provider_id = ?'); params.push(String(providerId))
    }
    if (connectionId !== undefined) {
      if (!columns.has('connection_id')) throw new AccountsError('invalid-storage-query', `${type} does not support connectionId filtering`)
      clauses.push('connection_id = ?'); params.push(String(connectionId))
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`
    const order = type === 'observation' ? ' ORDER BY observed_at DESC, id' : ' ORDER BY id'
    return this.db.prepare(`SELECT * FROM ${table}${where}${order} LIMIT ?`).all(...params, limit)
      .map((row) => decode(type, row))
  }

  remove(type, id) {
    if (type === 'window') throw new AccountsError('embedded-window', 'windows persist as part of limits and observations')
    return this.db.prepare(`DELETE FROM ${tableFor(type)} WHERE id = ?`).run(String(id)).changes > 0
  }

  #run(sql, ...params) {
    this.db.prepare(sql).run(...params)
  }
}

const TABLES = Object.freeze({
  connection: 'account_connections', credential_metadata: 'credential_metadata',
  product: 'account_products', billing: 'account_billing', limit: 'account_limits',
  observation: 'account_observations', provider_template: 'provider_templates',
  provider_mapping: 'provider_mappings',
})

function tableFor(type) {
  const table = TABLES[type]
  if (!table) throw new AccountsError('unknown-record-type', `unknown account record type: ${type}`)
  return table
}

function nullableText(value) {
  return value === null ? null : String(value)
}

function decode(type, row) {
  try {
    if (type === 'observation') return normalizeRecord(type, JSON.parse(row.payload_json))
    if (type === 'connection') return normalizeRecord(type, {
      id: row.id, providerId: row.provider_id, accountKey: row.account_key,
      displayName: row.display_name, status: row.status, authKind: row.auth_kind,
      createdAt: row.created_at, updatedAt: row.updated_at,
    })
    if (type === 'credential_metadata') return normalizeRecord(type, {
      id: row.id, connectionId: row.connection_id, credentialRef: row.credential_ref,
      kind: row.kind, scopes: JSON.parse(row.scopes_json ?? '[]'), expiresAt: row.expires_at,
      updatedAt: row.updated_at,
    })
    if (type === 'product') return normalizeRecord(type, {
      id: row.id, providerId: row.provider_id, externalId: row.external_id, name: row.name,
      sourceKind: row.source_kind, archivedAt: row.archived_at, createdAt: row.created_at,
    })
    if (type === 'billing') return normalizeRecord(type, {
      id: row.id, connectionId: row.connection_id, productId: row.product_id, model: row.kind,
      currency: row.currency, amountNano: row.amount_nano, cycleAnchorDay: row.cycle_anchor_day,
      balanceNano: row.balance_nano, expiresAt: row.expires_at, sourceKind: row.source_kind,
      observedAt: row.observed_at,
    })
    if (type === 'limit') {
      const durationMs = row.window_seconds === null ? null : row.window_seconds * 1000
      const window = row.window_json
        ? JSON.parse(row.window_json)
        : {
            id: `stored-window:${row.id}`, kind: row.window_kind, label: row.external_key ?? row.metric,
            durationMs, resetsAt: row.reset_at,
            ...(row.window_kind === 'fixed' && row.reset_at !== null
              ? { startsAt: row.created_at, endsAt: row.reset_at }
              : {}),
          }
      return normalizeRecord(type, {
        id: row.id, connectionId: row.connection_id, productId: row.product_id,
        externalKey: row.external_key, windowId: window.id, window, metric: row.metric, unit: row.unit,
        mode: row.value_mode, value: numberOrNull(row.exact_value), min: numberOrNull(row.minimum_value),
        max: numberOrNull(row.maximum_value), sourceKind: row.source_kind, confidence: row.confidence,
        note: row.note, createdAt: row.created_at,
      })
    }
    if (type === 'provider_template') return normalizeRecord(type, {
      id: row.id, providerId: row.provider_id, name: row.name,
      product: JSON.parse(row.product_json), limits: JSON.parse(row.limits_json),
      sourceKind: row.source_kind, updatedAt: row.updated_at,
    })
    if (type === 'provider_mapping') return normalizeRecord(type, {
      id: String(row.id), providerId: row.provider_id, externalKey: row.external_key,
      templateId: row.template_id, createdAt: row.created_at,
    })
  } catch (error) {
    if (error instanceof AccountsError) throw error
    throw new AccountsError('corrupt-account-record', `stored ${type} record is invalid`)
  }
  throw new AccountsError('unknown-record-type', `unknown account record type: ${type}`)
}

function numberOrNull(value) {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
