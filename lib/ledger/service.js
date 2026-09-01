/**
 * The usage ledger service: the deep module at the seam. It folds durable
 * session events into request records (one record per session/turn/step),
 * imports history idempotently, accepts live post-commit events, values
 * usage against a price catalog, and answers the read queries the client
 * consumes. Storage details stay hidden behind this API.
 */

import { openDatabase, transaction, LedgerError, projectLegacyPlans } from './db.js'
import { serializePublic } from '../accounts/domain.js'
import { seedTemplateCatalog, listSeededTemplates } from '../accounts/templates.js'

export { LedgerError }
import { PriceCatalog, valueUsage } from './pricing.js'
import { eachLocalDay, localDayBounds, localDate, offsetAt } from './days.js'
import { constrain, createAnalytics } from './analytics.js'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'

const DEFAULT_TIMEZONE = 'UTC'

/** Sum a record into an accumulator with the canonical token categories. */
function addTokens(into, record) {
  into.inputTokens += record.input_tokens
  into.outputTokens += record.output_tokens
  into.cacheReadTokens += record.cache_read_tokens
  into.cacheWriteTokens += record.cache_write_tokens
  into.reasoningTokens += record.reasoning_tokens ?? 0
  into.processingTokens += record.input_tokens + record.output_tokens + record.cache_read_tokens + record.cache_write_tokens
  into.newComputeTokens += record.input_tokens + record.output_tokens
}

function emptyTotals() {
  return {
    requests: 0,
    calls: 0,
    failedRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    processingTokens: 0,
    newComputeTokens: 0,
  }
}

function isOwned(record) {
  return record.owned === 1
}

function hasUsage(record) {
  return record.status === 'ok' || record.status === 'estimated'
}

/**
 * Fold an ordered event list into per-(turn, step) request records.
 * Repeated usage samples for one step replace the previous sample entirely.
 */
export function foldEvents(header, events, { estimator } = {}) {
  const records = new Map() // "turn:step" -> record
  let pendingConfig
  let lastKey = { turn: 0, step: 0 }
  let stepStartIndex = -1
  const stepStarts = new Map()

  const keyOf = (turn, step) => `${turn}:${step}`
  const recordFor = (turn, step) => {
    const key = keyOf(turn, step)
    let record = records.get(key)
    if (record === undefined) {
      record = {
        turn, step, seq: -1, time: 0, provider: 'unknown', model_raw: 'unknown', connection_id: null,
        input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
        reasoning_tokens: null, status: 'unknown', estimated: 0, estimator: null,
        estimator_version: null, failed: false, duration_ms: null,
        end_reason: null, failure_type: null,
      }
      records.set(key, record)
    }
    return record
  }

  const applyUsage = (record, usage, event) => {
    // Replace semantics: a later sample for the same step wins in full.
    record.input_tokens = usage.inputTokens ?? 0
    record.output_tokens = usage.outputTokens ?? 0
    record.cache_read_tokens = usage.cacheReadTokens ?? 0
    record.cache_write_tokens = usage.cacheWriteTokens ?? 0
    record.reasoning_tokens = usage.reasoningTokens ?? null
    record.status = 'ok'
    record.seq = event.seq
    record.time = event.time
    if (event.data?.message?.source?.kind === 'model') {
      record.provider = event.data.message.source.provider ?? record.provider
      record.model_raw = event.data.message.source.model ?? record.model_raw
      record.connection_id = event.data.message.source.connectionId ?? record.connection_id
    }
  }

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    const data = event.data ?? {}
    switch (event.type) {
      case 'request/header': {
        pendingConfig = data.config ?? undefined
        if (stepStartIndex === -1) stepStartIndex = index
        break
      }
      case 'step/start': {
        lastKey = { turn: data.turn ?? lastKey.turn, step: data.step ?? lastKey.step }
        stepStarts.set(keyOf(lastKey.turn, lastKey.step), event.time)
        stepStartIndex = index
        break
      }
      case 'assistant/message': {
        const turn = data.turn ?? lastKey.turn
        const step = data.step ?? lastKey.step
        lastKey = { turn, step }
        const record = recordFor(turn, step)
        if (record.seq === -1) {
          record.seq = event.seq
          record.time = event.time
          if (data.message?.source?.kind === 'model') {
            record.provider = data.message.source.provider
            record.model_raw = data.message.source.model
            record.connection_id = data.message.source.connectionId ?? null
          } else if (pendingConfig !== undefined) {
            record.provider = pendingConfig.provider ?? record.provider
            record.model_raw = pendingConfig.model ?? record.model_raw
          }
        }
        if (data.usage !== undefined) applyUsage(record, data.usage, event)
        else if (data.interrupted === true && record.status !== 'ok') record.failed = true
        break
      }
      case 'step/end': {
        const turn = data.turn ?? lastKey.turn
        const step = data.step ?? lastKey.step
        lastKey = { turn, step: step + 1 }
        const record = recordFor(turn, step)
        const startedAt = stepStarts.get(keyOf(turn, step))
        if (Number.isFinite(startedAt) && Number.isFinite(event.time) && event.time >= startedAt) record.duration_ms = event.time - startedAt
        const reason = data.reason
        record.end_reason = typeof reason === 'string' ? reason : reason?.kind ?? reason?.code ?? reason?.name ?? null
        const failure = data.error
        record.failure_type = typeof failure === 'string' ? failure : failure?.kind ?? failure?.code ?? failure?.name ?? null
        if (record.time === 0) {
          record.seq = event.seq
          record.time = event.time
          if (pendingConfig !== undefined) {
            record.provider = pendingConfig.provider ?? record.provider
            record.model_raw = pendingConfig.model ?? record.model_raw
          }
        }
        const failed = data.error !== undefined && data.error !== null
        if (failed && !hasUsage({ status: record.status })) {
          record.status = 'failed'
          record.failed = true
        } else if (!hasUsage({ status: record.status }) && estimator !== undefined) {
          const slice = events.slice(Math.max(stepStartIndex, 0), index + 1)
          try {
            const estimate = estimator(slice)
            if (estimate !== null && estimate !== undefined) {
              record.input_tokens = estimate.inputTokens ?? 0
              record.output_tokens = estimate.outputTokens ?? 0
              record.cache_read_tokens = 0
              record.cache_write_tokens = 0
              record.status = 'estimated'
              record.estimated = 1
              record.estimator = estimate.estimator ?? 'estimator'
              record.estimator_version = estimate.estimatorVersion ?? null
              record.seq = event.seq
              record.time = event.time
            }
          } catch {
            // A broken estimator must never corrupt the ledger: leave unknown.
          }
        }
        stepStartIndex = -1
        break
      }
      default:
        // compaction/*, tool/*, user/message, session/*: never billable.
        break
    }
  }

  const seedLength = header.seedLength
  for (const record of records.values()) {
    record.owned = seedLength !== undefined && seedLength !== null && record.seq >= 0 && record.seq < seedLength ? 0 : 1
  }
  return records
}

/** Create the ledger service over a SQLite database path. */
export function createLedgerService({
  databasePath,
  snapshot,
  updates,
  overrides,
  aliases,
  multipliers,
  estimator,
  timezone: defaultTimezone = DEFAULT_TIMEZONE,
} = {}) {
  const db = openDatabase(databasePath)
  // Pricing configuration is durable. Explicit constructor maps are test seams;
  // production reloads aliases, overrides, provider multipliers, and the last
  // explicitly applied upstream catalog from SQLite.
  const durableAliases = aliases ?? new Map(db.prepare('SELECT model_raw, canonical FROM aliases').all().map((row) => [row.model_raw, row.canonical]))
  const durableOverrides = overrides ?? new Map(db.prepare('SELECT * FROM price_overrides').all().map((row) => [row.model, {
    inputNano: Number(row.input_nano),
    outputNano: Number(row.output_nano),
    cacheReadNano: row.cache_read_nano === null ? null : Number(row.cache_read_nano),
    cacheWriteNano: row.cache_write_nano === null ? null : Number(row.cache_write_nano),
    reasoningNano: row.reasoning_nano === null ? null : Number(row.reasoning_nano),
  }]))
  const durableMultipliers = multipliers ?? new Map(db.prepare('SELECT provider, multiplier_bps FROM providers').all().map((row) => [row.provider, row.multiplier_bps]))
  const durableUpdates = updates ?? new Map(db.prepare('SELECT * FROM price_updates').all().map((row) => [row.model, {
    inputNano: row.input_nano,
    outputNano: row.output_nano,
    cacheReadNano: row.cache_read_nano,
    cacheWriteNano: row.cache_write_nano,
    source: row.source,
    version: `${row.source}-${row.updated_at}`,
    updatedAt: row.updated_at,
  }]))
  const catalog = new PriceCatalog({ snapshot, updates: durableUpdates, overrides: durableOverrides, aliases: durableAliases, multipliers: durableMultipliers })
  let analyticsRevision = Number(db.prepare("SELECT value FROM meta WHERE key = 'analytics_revision'").get()?.value ?? 0)
  function bumpAnalyticsRevision() {
    analyticsRevision += 1
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('analytics_revision', ?)").run(String(analyticsRevision))
    return analyticsRevision
  }
  // Bundled product templates are host-side catalog data: seed them so the
  // wizard, provider aliases and future catalog updates all live in SQLite.
  const templateSeed = seedTemplateCatalog(db)
  const analytics = createAnalytics({ db, catalog, timezone: defaultTimezone, revision: () => analyticsRevision })
  // Live-path in-memory state: per-session last header config and step
  // message buffer. Never persisted; dropped on dispose.
  const liveConfig = new Map()
  const liveBuffers = new Map()
  const liveStarts = new Map()

  const statements = {
    upsertSource: db.prepare(`
      INSERT INTO sources (session_id, revision, last_seq, source, created_at, cwd, title, parent_session, origin, seed_length, deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(session_id) DO UPDATE SET
        cwd = COALESCE(excluded.cwd, sources.cwd),
        title = COALESCE(excluded.title, sources.title),
        parent_session = COALESCE(excluded.parent_session, sources.parent_session),
        origin = COALESCE(excluded.origin, sources.origin),
        seed_length = COALESCE(excluded.seed_length, sources.seed_length),
        revision = COALESCE(excluded.revision, sources.revision),
        deleted = 0
    `),
    setLastSeq: db.prepare('UPDATE sources SET last_seq = MAX(last_seq, ?) WHERE session_id = ?'),
    upsertRequest: db.prepare(`
      INSERT INTO requests (session_id, turn, step, seq, time, provider, model_raw, connection_id, owned,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
        status, estimated, estimator, estimator_version, original_usd_nano, price_version,
        duration_ms, end_reason, failure_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, turn, step) DO UPDATE SET
        seq = excluded.seq,
        time = excluded.time,
        provider = excluded.provider,
        model_raw = excluded.model_raw,
        connection_id = excluded.connection_id,
        owned = excluded.owned,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        cache_write_tokens = excluded.cache_write_tokens,
        reasoning_tokens = excluded.reasoning_tokens,
        status = excluded.status,
        estimated = excluded.estimated,
        estimator = excluded.estimator,
        estimator_version = excluded.estimator_version,
        original_usd_nano = CASE
          WHEN requests.original_usd_nano IS NOT NULL
            AND requests.input_tokens = excluded.input_tokens
            AND requests.output_tokens = excluded.output_tokens
            AND requests.cache_read_tokens = excluded.cache_read_tokens
            AND requests.cache_write_tokens = excluded.cache_write_tokens
          THEN requests.original_usd_nano
          ELSE excluded.original_usd_nano
        END,
        price_version = excluded.price_version,
        duration_ms = COALESCE(excluded.duration_ms, requests.duration_ms),
        end_reason = COALESCE(excluded.end_reason, requests.end_reason),
        failure_type = COALESCE(excluded.failure_type, requests.failure_type)
    `),
    // A failure may only fill an empty slot: it must never overwrite a
    // provider-reported usage sample for the same step.
    insertFailureIfAbsent: db.prepare(`
      INSERT INTO requests (session_id, turn, step, seq, time, provider, model_raw, owned,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
        status, estimated, estimator, estimator_version, original_usd_nano, price_version)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, 'failed', 0, NULL, NULL, NULL, NULL
      WHERE NOT EXISTS (SELECT 1 FROM requests WHERE session_id = ? AND turn = ? AND step = ?)
    `),
    setRequestOutcome: db.prepare(`
      UPDATE requests SET
        duration_ms = COALESCE(?, duration_ms),
        end_reason = COALESCE(?, end_reason),
        failure_type = COALESCE(?, failure_type)
      WHERE session_id = ? AND turn = ? AND step = ?
    `),
    markDeleted: db.prepare('UPDATE sources SET deleted = 1 WHERE session_id = ?'),
  }

  function valueRecord(record) {
    if (!hasUsage(record)) return null
    return valueUsage(catalog, {
      provider: record.provider,
      modelRaw: record.model_raw,
      usage: {
        input: record.input_tokens,
        output: record.output_tokens,
        cacheRead: record.cache_read_tokens,
        cacheWrite: record.cache_write_tokens,
      },
    })
  }

  function persistRecords(sessionId, records) {
    transaction(db, () => {
      for (const record of records.values()) {
        if (record.seq < 0) continue
        const valuation = valueRecord(record)
        statements.upsertRequest.run(
          sessionId, record.turn, record.step, record.seq, record.time,
          record.provider, record.model_raw, record.connection_id, record.owned,
          record.input_tokens, record.output_tokens, record.cache_read_tokens,
          record.cache_write_tokens, record.reasoning_tokens,
          record.status, record.estimated, record.estimator, record.estimator_version,
          valuation?.usdNano ?? null, valuation?.version ?? null,
          record.duration_ms ?? null, record.end_reason ?? null, record.failure_type ?? null,
        )
      }
    })
  }

  function ensureDefaultProject(cwd, createdAt = Date.now()) {
    if (!cwd) return null
    const id = `cwd:${cwd}`
    db.prepare(`
      INSERT OR IGNORE INTO projects (id, identity_kind, identity_value, display_name, created_at)
      VALUES (?, 'cwd', ?, ?, ?)
    `).run(id, cwd, basename(cwd) || cwd, createdAt)
    db.prepare(`
      INSERT OR IGNORE INTO project_sources (cwd, project_id, source, created_at)
      VALUES (?, ?, 'cwd', ?)
    `).run(cwd, id, createdAt)
    return id
  }

  function latestSessionTitle(header, events) {
    if (Array.isArray(events)) {
      for (let i = events.length - 1; i >= 0; i--) {
        const title = events[i]?.type === 'session/title' ? events[i]?.data?.title : null
        if (typeof title === 'string' && title.trim()) return title.trim()
      }
    }
    if (typeof header?.title === 'string' && header.title.trim()) return header.title.trim()
    return null
  }

  function applySessionTitle(sessionId, title) {
    if (typeof title !== 'string' || !title.trim()) return false
    const next = title.trim()
    const current = db.prepare('SELECT title FROM sources WHERE session_id = ?').get(sessionId)?.title
    if (current === next) return false
    db.prepare('UPDATE sources SET title = ? WHERE session_id = ?').run(next, sessionId)
    return true
  }

  function ensureSource(header, source = 'profile') {
    statements.upsertSource.run(
      header.id, header.revision ?? null, -1, source, header.createdAt ?? 0,
      header.cwd ?? null, header.title ?? null, header.parentSession ?? null, header.origin ?? null,
      header.seedLength ?? null,
    )
    ensureDefaultProject(header.cwd, header.createdAt ?? Date.now())
  }

  return {
    constrain,
    query: analytics.query,
    inspect: analytics.inspect,
    entrySummary: analytics.entrySummary,

    listPlans() {
      const plans = db.prepare(`
        SELECT id, kind, name, color, price_usd_nano AS priceUsdNano,
               quota_unit AS quotaUnit, quota_value AS quotaValue, reset_day AS resetDay,
               window_kind AS windowKind, window2_kind AS window2Kind,
               window2_quota_value AS window2QuotaValue, window2_quota_unit AS window2QuotaUnit,
               balance_usd_nano AS balanceUsdNano, expiry_day AS expiryDay,
               archived_at AS archivedAt, created_at AS createdAt
        FROM plans ORDER BY archived_at IS NOT NULL, created_at, id
      `).all().map((row) => ({
        ...row,
        quotaValue: row.quotaValue == null ? null : Number(row.quotaValue),
        window2QuotaValue: row.window2QuotaValue == null ? null : Number(row.window2QuotaValue),
        archived: row.archivedAt != null,
      }))
      const rules = db.prepare(`
        SELECT id, plan_id AS planId, match_provider AS matchProvider, match_model AS matchModel, priority
        FROM plan_rules ORDER BY priority, id
      `).all()
      for (const plan of plans) plan.rules = rules.filter((rule) => rule.planId === plan.id)
      return plans
    },

    savePlan(plan = {}) {
      const kind = plan.kind
      if (!['sub', 'credit'].includes(kind)) throw new LedgerError('invalid-plan', `invalid plan kind: ${kind}`)
      const name = String(plan.name ?? '').trim()
      if (!name || name.length > 120) throw new LedgerError('invalid-plan', 'plan name is required (≤120 chars)')
      let priceUsdNano = null
      if (plan.priceUsd != null) {
        if (!Number.isFinite(Number(plan.priceUsd)) || Number(plan.priceUsd) < 0) throw new LedgerError('invalid-plan', 'priceUsd must be a non-negative number')
        priceUsdNano = Math.round(Number(plan.priceUsd) * 1e9)
      }
      const WINDOW_KINDS = ['none', '5h', '7d', 'month']
      let quotaUnit = null
      let quotaValue = null
      let resetDay = 1
      let windowKind = 'month'
      let window2Kind = null
      let window2QuotaValue = null
      let window2QuotaUnit = null
      if (kind === 'sub') {
        windowKind = plan.windowKind ?? 'month'
        if (!WINDOW_KINDS.includes(windowKind)) throw new LedgerError('invalid-plan', `invalid window kind: ${windowKind}`)
        if (windowKind !== 'none') {
          if (!['newCompute', 'usd'].includes(plan.quotaUnit ?? 'newCompute')) throw new LedgerError('invalid-plan', `invalid quota unit: ${plan.quotaUnit}`)
          quotaUnit = plan.quotaUnit ?? 'newCompute'
          if (!Number.isFinite(Number(plan.quotaValue)) || Number(plan.quotaValue) <= 0) throw new LedgerError('invalid-plan', 'quotaValue must be positive')
          quotaValue = String(plan.quotaValue)
        }
        if (windowKind === 'month') {
          const day = Number(plan.resetDay ?? 1)
          if (!Number.isInteger(day) || day < 1 || day > 28) throw new LedgerError('invalid-plan', 'resetDay must be an integer 1–28')
          resetDay = day
        }
        if (plan.window2Kind && plan.window2Kind !== 'none') {
          if (!WINDOW_KINDS.includes(plan.window2Kind)) throw new LedgerError('invalid-plan', `invalid window2 kind: ${plan.window2Kind}`)
          window2Kind = plan.window2Kind
          window2QuotaUnit = plan.window2QuotaUnit ?? quotaUnit ?? 'newCompute'
          if (!Number.isFinite(Number(plan.window2QuotaValue)) || Number(plan.window2QuotaValue) <= 0) throw new LedgerError('invalid-plan', 'window2QuotaValue must be positive')
          window2QuotaValue = String(plan.window2QuotaValue)
        }
      }
      let balanceUsdNano = null
      let expiryDay = null
      if (kind === 'credit') {
        if (plan.balanceUsd != null) {
          if (!Number.isFinite(Number(plan.balanceUsd)) || Number(plan.balanceUsd) < 0) throw new LedgerError('invalid-plan', 'balanceUsd must be a non-negative number')
          balanceUsdNano = Math.round(Number(plan.balanceUsd) * 1e9)
        }
        if (plan.expiryDay != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(plan.expiryDay))) throw new LedgerError('invalid-plan', 'expiryDay must be YYYY-MM-DD')
        expiryDay = plan.expiryDay ?? null
      }
      const id = plan.id != null
        ? String(plan.id)
        : `plan:${createHash('sha256').update(`${kind}:${name}`).digest('hex').slice(0, 16)}`
      db.prepare(`
        INSERT INTO plans (id, kind, name, color, price_usd_nano, quota_unit, quota_value, reset_day,
          window_kind, window2_kind, window2_quota_value, window2_quota_unit,
          balance_usd_nano, expiry_day, archived_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name, color = excluded.color,
          price_usd_nano = excluded.price_usd_nano, quota_unit = excluded.quota_unit,
          quota_value = excluded.quota_value, reset_day = excluded.reset_day,
          window_kind = excluded.window_kind, window2_kind = excluded.window2_kind,
          window2_quota_value = excluded.window2_quota_value, window2_quota_unit = excluded.window2_quota_unit,
          balance_usd_nano = excluded.balance_usd_nano, expiry_day = excluded.expiry_day,
          archived_at = NULL
      `).run(id, kind, name, plan.color ?? null, priceUsdNano, quotaUnit, quotaValue, resetDay,
        windowKind, window2Kind, window2QuotaValue, window2QuotaUnit,
        balanceUsdNano, expiryDay, Date.now())
      // Deprecated write path: keep the v5 → account projection in sync so
      // legacy plans keep working through the account-domain analytics.
      projectLegacyPlans(db)
      bumpAnalyticsRevision()
      return { id, deprecated: 'use save-account' }
    },

    archivePlan(id, { archived = true } = {}) {
      const result = archived
        ? db.prepare('UPDATE plans SET archived_at = ? WHERE id = ? AND archived_at IS NULL').run(Date.now(), String(id))
        : db.prepare('UPDATE plans SET archived_at = NULL WHERE id = ?').run(String(id))
      if (Number(result.changes) === 0) throw new LedgerError('plan-not-found', `plan not found: ${id}`)
      projectLegacyPlans(db)
      bumpAnalyticsRevision()
      return { id: String(id), archived }
    },

    savePlanRules(planId, rules = []) {
      const plan = db.prepare('SELECT id FROM plans WHERE id = ?').get(String(planId))
      if (plan === undefined) throw new LedgerError('plan-not-found', `plan not found: ${planId}`)
      if (!Array.isArray(rules) || rules.length > 64) throw new LedgerError('invalid-plan-rules', 'rules must be an array of at most 64 entries')
      const clean = rules.map((rule, index) => {
        const matchProvider = rule.matchProvider == null || rule.matchProvider === '' ? null : String(rule.matchProvider)
        const matchModel = rule.matchModel == null || rule.matchModel === '' ? null : String(rule.matchModel)
        if (matchProvider === null && matchModel === null) throw new LedgerError('invalid-plan-rules', `rule ${index}: matchProvider or matchModel is required`)
        const priority = Number.isInteger(rule.priority) ? rule.priority : 0
        return { matchProvider, matchModel, priority }
      })
      transaction(db, () => {
        db.prepare('DELETE FROM plan_rules WHERE plan_id = ?').run(String(planId))
        for (const rule of clean) {
          db.prepare('INSERT INTO plan_rules (plan_id, match_provider, match_model, priority) VALUES (?, ?, ?, ?)')
            .run(String(planId), rule.matchProvider, rule.matchModel, rule.priority)
        }
      })
      projectLegacyPlans(db)
      bumpAnalyticsRevision()
      return { planId: String(planId), count: clean.length, deprecated: 'use save-account' }
    },

    listProjects() {
      return db.prepare(`
        SELECT p.id, p.identity_kind AS identityKind, p.identity_value AS identityValue,
               p.display_name AS displayName, p.color, p.hidden,
               COUNT(ps.cwd) AS sourceCount, GROUP_CONCAT(ps.cwd, char(10)) AS sourceList
        FROM projects p LEFT JOIN project_sources ps ON ps.project_id = p.id
        GROUP BY p.id HAVING COUNT(ps.cwd) > 0 ORDER BY p.hidden, p.display_name
      `).all().map((row) => ({
        ...row,
        hidden: row.hidden === 1,
        sourceCount: Number(row.sourceCount),
        sources: row.sourceList ? String(row.sourceList).split('\n') : [],
        sourceList: undefined,
      }))
    },

    assignProject({ cwd, projectId, identityKind = 'cwd', identityValue = cwd, displayName, gitRoot = null, gitRemote = null } = {}) {
      cwd = String(cwd ?? '').trim()
      if (!cwd) throw new LedgerError('invalid-project', 'cwd is required')
      if (!['cwd', 'git', 'manual'].includes(identityKind)) throw new LedgerError('invalid-project', `invalid identity kind: ${identityKind}`)
      let id = projectId === undefined ? undefined : String(projectId).trim()
      if (id === '') throw new LedgerError('invalid-project', 'projectId must not be empty')
      if (id === undefined) {
        identityValue = String(identityValue ?? '').trim()
        displayName = String(displayName ?? (basename(cwd) || cwd)).trim()
        if (!identityValue || !displayName) throw new LedgerError('invalid-project', 'identityValue and displayName are required')
        if (identityValue.length > 1000 || displayName.length > 200) throw new LedgerError('invalid-project', 'project identity or display name is too long')
        const existing = db.prepare('SELECT id FROM projects WHERE identity_kind = ? AND identity_value = ?').get(identityKind, identityValue)
        id = existing?.id ?? `project:${createHash('sha256').update(`${identityKind}:${identityValue}`).digest('hex').slice(0, 16)}`
        db.prepare(`
          INSERT OR IGNORE INTO projects (id, identity_kind, identity_value, display_name, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, identityKind, identityValue, displayName ?? (basename(cwd) || cwd), Date.now())
      }
      const project = db.prepare('SELECT id, display_name AS displayName FROM projects WHERE id = ?').get(id)
      if (project === undefined) throw new LedgerError('project-not-found', `project not found: ${id}`)
      db.prepare(`
        INSERT INTO project_sources (cwd, project_id, git_root, git_remote, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(cwd) DO UPDATE SET project_id = excluded.project_id,
          git_root = COALESCE(excluded.git_root, project_sources.git_root),
          git_remote = COALESCE(excluded.git_remote, project_sources.git_remote),
          source = excluded.source
        WHERE project_sources.source != 'manual' OR excluded.source = 'manual'
      `).run(cwd, id, gitRoot, gitRemote, identityKind === 'git' ? 'git' : 'manual', Date.now())
      bumpAnalyticsRevision()
      return project
    },

    updateProject(id, patch = {}) {
      const fields = []
      const params = []
      for (const [key, column] of [['displayName', 'display_name'], ['color', 'color'], ['hidden', 'hidden']]) {
        if (patch[key] !== undefined) {
          fields.push(`${column} = ?`)
          params.push(key === 'hidden' ? (patch[key] ? 1 : 0) : patch[key])
        }
      }
      if (fields.length) db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...params, id)
      const row = db.prepare('SELECT id, display_name AS displayName, color, hidden FROM projects WHERE id = ?').get(id)
      if (row === undefined) throw new LedgerError('project-not-found', `project not found: ${id}`)
      bumpAnalyticsRevision()
      return { ...row, hidden: row.hidden === 1 }
    },

    setBudget({ scope, scopeId = null, unit, periodMonth, limitValue, effectiveFrom = Date.now() } = {}) {
      if (!['profile', 'project', 'provider', 'model'].includes(scope)) throw new LedgerError('invalid-budget', `invalid budget scope: ${scope}`)
      if (scope !== 'profile' && !scopeId) throw new LedgerError('invalid-budget', `scopeId is required for ${scope} budget`)
      if (!['usd', 'processingTokens', 'newComputeTokens'].includes(unit)) throw new LedgerError('invalid-budget', `invalid budget unit: ${unit}`)
      if (!/^\d{4}-\d{2}$/.test(String(periodMonth))) throw new LedgerError('invalid-budget', `invalid budget month: ${periodMonth}`)
      if (!Number.isFinite(Number(limitValue)) || Number(limitValue) <= 0) throw new LedgerError('invalid-budget', 'budget limit must be positive')
      const id = `budget:${createHash('sha256').update(`${scope}:${scopeId ?? ''}:${unit}:${periodMonth}`).digest('hex').slice(0, 16)}`
      db.prepare(`
        INSERT INTO budgets (id, scope, scope_id, unit, period_month, limit_value, effective_from, archived_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
        ON CONFLICT(id) DO UPDATE SET limit_value = excluded.limit_value,
          effective_from = excluded.effective_from, archived_at = NULL
      `).run(id, scope, scopeId, unit, periodMonth, String(limitValue), effectiveFrom, Date.now())
      bumpAnalyticsRevision()
      return { id, scope, scopeId, unit, periodMonth, limitValue: String(limitValue), archivedAt: null }
    },

    archiveBudget(id) {
      const result = db.prepare('UPDATE budgets SET archived_at = ? WHERE id = ? AND archived_at IS NULL').run(Date.now(), id)
      if (Number(result.changes) === 0) throw new LedgerError('budget-not-found', `active budget not found: ${id}`)
      bumpAnalyticsRevision()
      return { id, archived: true }
    },

    correctRequest(requestId, correction = {}) {
      const parts = String(requestId).split(':')
      if (parts.length < 3) throw new LedgerError('invalid-request', `invalid request id: ${requestId}`)
      const step = Number(parts.pop())
      const turn = Number(parts.pop())
      const sessionId = parts.join(':')
      if (!Number.isInteger(turn) || !Number.isInteger(step)) throw new LedgerError('invalid-request', `invalid request id: ${requestId}`)
      const exists = db.prepare('SELECT 1 FROM requests WHERE session_id = ? AND turn = ? AND step = ?').get(sessionId, turn, step)
      if (exists === undefined) throw new LedgerError('request-not-found', `request not found: ${requestId}`)
      for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
        const value = correction[key]
        if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new LedgerError('invalid-correction', `${key} must be a non-negative safe integer`)
      }
      if (correction.note !== undefined && correction.note !== null && String(correction.note).length > 2000) throw new LedgerError('invalid-correction', 'correction note is too long')
      const result = db.prepare(`
        INSERT INTO request_corrections
          (session_id, turn, step, input_tokens, output_tokens, cache_read_tokens,
           cache_write_tokens, reasoning_tokens, excluded, note, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        sessionId, turn, step,
        correction.inputTokens ?? null,
        correction.outputTokens ?? null,
        correction.cacheReadTokens ?? null,
        correction.cacheWriteTokens ?? null,
        correction.reasoningTokens ?? null,
        correction.excluded ? 1 : 0,
        correction.note ?? null,
        Date.now(),
      )
      bumpAnalyticsRevision()
      return { id: Number(result.lastInsertRowid), requestId }
    },

    revokeCorrection(id) {
      const correction = db.prepare('SELECT * FROM request_corrections WHERE id = ?').get(Number(id))
      if (correction === undefined) throw new LedgerError('correction-not-found', `correction not found: ${id}`)
      const latest = db.prepare('SELECT id FROM request_corrections WHERE session_id = ? AND turn = ? AND step = ? ORDER BY id DESC LIMIT 1').get(correction.session_id, correction.turn, correction.step)
      if (Number(latest.id) !== Number(id)) throw new LedgerError('correction-not-current', `correction is no longer current: ${id}`)
      const result = db.prepare(`
        INSERT INTO request_corrections (session_id, turn, step, excluded, note, active, created_at)
        VALUES (?, ?, ?, 0, ?, 1, ?)
      `).run(correction.session_id, correction.turn, correction.step, `reverted correction #${id}`, Date.now())
      bumpAnalyticsRevision()
      return { id: Number(id), undoId: Number(result.lastInsertRowid), revoked: true }
    },

    /** Import one session's durable events. Idempotent; safe to repeat. */
    importSession({ header, events }, options = {}) {
      ensureSource(header, options.source ?? 'profile')
      const titleChanged = applySessionTitle(header.id, latestSessionTitle(header, events))
      const estimatorFn = options.estimator ?? estimator
      const records = foldEvents(header, events, estimatorFn !== undefined ? { estimator: estimatorFn } : {})
      persistRecords(header.id, records)
      const lastSeq = events.reduce((max, event) => Math.max(max, event.seq ?? -1), -1)
      statements.setLastSeq.run(lastSeq, header.id)
      if (records.size > 0 || titleChanged) bumpAnalyticsRevision()
      return { imported: records.size, lastSeq }
    },

    /** Ingest one live post-commit event. Failures never throw into the feed. */
    ingestEvent(header, event) {
      try {
        ensureSource(header)
        const data = event.data ?? {}
        if (event.type === 'request/header') {
          liveConfig.set(header.id, data.config ?? undefined)
        } else if (event.type === 'session/title' && applySessionTitle(header.id, data.title)) {
          bumpAnalyticsRevision()
        } else if (event.type === 'step/start') {
          liveStarts.set(`${header.id}:${data.turn ?? 0}:${data.step ?? 0}`, event.time)
        } else if (event.type === 'assistant/message' && data.usage !== undefined) {
          const turn = data.turn ?? 0
          const step = data.step ?? 0
          const record = {
            turn, step, seq: event.seq, time: event.time,
            provider: data.message?.source?.kind === 'model' ? data.message.source.provider : liveConfig.get(header.id)?.provider ?? 'unknown',
            model_raw: data.message?.source?.kind === 'model' ? data.message.source.model : liveConfig.get(header.id)?.model ?? 'unknown',
            connection_id: data.message?.source?.kind === 'model' ? data.message.source.connectionId ?? null : null,
            input_tokens: data.usage.inputTokens ?? 0,
            output_tokens: data.usage.outputTokens ?? 0,
            cache_read_tokens: data.usage.cacheReadTokens ?? 0,
            cache_write_tokens: data.usage.cacheWriteTokens ?? 0,
            reasoning_tokens: data.usage.reasoningTokens ?? null,
            status: 'ok', estimated: 0, estimator: null, estimator_version: null,
            owned: header.seedLength !== undefined && header.seedLength !== null && event.seq < header.seedLength ? 0 : 1,
          }
          persistRecords(header.id, new Map([[`${turn}:${step}`, record]]))
        } else if (event.type === 'step/end') {
          const turn = data.turn ?? 0
          const step = data.step ?? 0
          liveBuffers.delete(`${header.id}:${turn}:${step}`)
          const failed = data.error !== undefined && data.error !== null
          if (failed) {
            const config = liveConfig.get(header.id)
            statements.insertFailureIfAbsent.run(
              header.id, turn, step, event.seq, event.time,
              config?.provider ?? 'unknown', config?.model ?? 'unknown',
              header.seedLength !== undefined && header.seedLength !== null && event.seq < header.seedLength ? 0 : 1,
              header.id, turn, step,
            )
          }
          const startKey = `${header.id}:${turn}:${step}`
          const startedAt = liveStarts.get(startKey)
          liveStarts.delete(startKey)
          const reason = data.reason
          const failure = data.error
          statements.setRequestOutcome.run(
            Number.isFinite(startedAt) && Number.isFinite(event.time) && event.time >= startedAt ? event.time - startedAt : null,
            typeof reason === 'string' ? reason : reason?.kind ?? reason?.code ?? reason?.name ?? null,
            typeof failure === 'string' ? failure : failure?.kind ?? failure?.code ?? failure?.name ?? null,
            header.id, turn, step,
          )
        } else if (event.type === 'assistant/message') {
          // Usage-less assistant message: buffer for a live estimator.
          const key = `${header.id}:${data.turn ?? 0}:${data.step ?? 0}`
          let buffer = liveBuffers.get(key)
          if (buffer === undefined) { buffer = []; liveBuffers.set(key, buffer) }
          buffer.push(event)
        }
        statements.setLastSeq.run(event.seq ?? -1, header.id)
        bumpAnalyticsRevision()
      } catch (error) {
        if (error instanceof LedgerError) throw error
        // Contained: live capture must never break the session event feed.
      }
    },

    /** Mark profile sources absent from `known` as deleted; history is retained. */
    reconcileSources(known) {
      const knownIds = new Set(known.map((entry) => entry.id))
      const deleted = []
      for (const row of db.prepare("SELECT session_id FROM sources WHERE deleted = 0 AND source = 'profile'").all()) {
        if (!knownIds.has(row.session_id)) {
          statements.markDeleted.run(row.session_id)
          deleted.push(row.session_id)
        }
      }
      if (deleted.length) bumpAnalyticsRevision()
      return { deleted }
    },

    getOverview(options = {}) {
      const totals = emptyTotals()
      const includingEstimates = emptyTotals()
      let estimatedTokens = 0
      let tokensWithPrice = 0
      let originalUsdNano = 0
      const rows = db.prepare('SELECT * FROM requests WHERE owned = 1').all()
      for (const row of rows) {
        const usage = hasUsage(row)
        // Request counts are exact observations and never vary with estimate
        // inclusion; only token volumes differ between the two views.
        totals.requests += 1
        includingEstimates.requests += 1
        if (row.status === 'failed') {
          totals.failedRequests += 1
          includingEstimates.failedRequests += 1
        }
        if (row.status === 'ok') {
          totals.calls += 1
          includingEstimates.calls += 1
        }
        addTokens(includingEstimates, row)
        if (usage && !row.estimated) {
          addTokens(totals, row)
        } else if (row.estimated) {
          estimatedTokens += row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_write_tokens
        }
        if (usage) {
          const valuation = valueUsage(catalog, {
            provider: row.provider,
            modelRaw: row.model_raw,
            usage: { input: row.input_tokens, output: row.output_tokens, cacheRead: row.cache_read_tokens, cacheWrite: row.cache_write_tokens },
          })
          if (valuation !== null) {
            tokensWithPrice += row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_write_tokens
            originalUsdNano += row.original_usd_nano ?? valuation.usdNano
          }
        }
      }
      const totalTokens = includingEstimates.processingTokens
      const currentUsd = this.valueCurrent({ rows })
      return {
        totals,
        totalsIncludingEstimates: includingEstimates,
        estimatedShare: totalTokens > 0 ? estimatedTokens / totalTokens : 0,
        cost: {
          usdNano: currentUsd.usdNano,
          originalUsdNano,
          coverage: totalTokens > 0 ? tokensWithPrice / totalTokens : 1,
          pricedTokens: tokensWithPrice,
          totalTokens,
        },
        streaks: this.getStreaks(options),
      }
    },

    /** Current-rule valuation of request rows (aliases/prices as of now). */
    valueCurrent({ rows }) {
      let usdNano = 0
      let priced = false
      for (const row of rows) {
        if (!hasUsage(row)) continue
        const valuation = valueUsage(catalog, {
          provider: row.provider,
          modelRaw: row.model_raw,
          usage: { input: row.input_tokens, output: row.output_tokens, cacheRead: row.cache_read_tokens, cacheWrite: row.cache_write_tokens },
        })
        if (valuation !== null) {
          usdNano += valuation.usdNano
          priced = true
        }
      }
      return { usdNano, priced }
    },

    getDailySeries({ from, to, timezone = defaultTimezone } = {}) {
      const days = []
      const countStmt = db.prepare(`
        SELECT COUNT(*) AS requests,
               SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS calls,
               SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
               SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) AS processing
        FROM requests WHERE owned = 1 AND time >= ? AND time < ?
      `)
      for (const [ymd, bounds] of eachLocalDay(Date.parse(`${from}T00:00:00Z`), localDayBounds(to, timezone).end, timezone)) {
        const row = countStmt.get(bounds.start, bounds.end)
        days.push({
          date: ymd,
          requests: row?.requests ?? 0,
          calls: row?.calls ?? 0,
          failed: row?.failed ?? 0,
          processingTokens: row?.processing ?? 0,
        })
      }
      return { days }
    },

    getStreaks(options = {}) {
      const timezone = options.timezone ?? defaultTimezone
      const bounds = db.prepare('SELECT MIN(time) AS minTime, MAX(time) AS maxTime FROM requests WHERE owned = 1').get()
      const nowMs = options.now ?? Date.now()
      if (bounds?.minTime === null || bounds?.minTime === undefined) return { current: 0, longest: 0 }
      const active = new Set()
      for (const [ymd, dayBounds] of eachLocalDay(bounds.minTime, Math.min(nowMs, bounds.maxTime + 1), timezone)) {
        const row = db.prepare('SELECT 1 FROM requests WHERE owned = 1 AND time >= ? AND time < ? LIMIT 1').get(dayBounds.start, dayBounds.end)
        if (row !== undefined) active.add(ymd)
      }
      let longest = 0
      let run = 0
      let previous = null
      for (const ymd of [...active].sort()) {
        run = previous !== null && Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`) === 86_400_000 ? run + 1 : 1
        longest = Math.max(longest, run)
        previous = ymd
      }
      // Current streak: consecutive active days ending today (or yesterday
      // when today has no activity yet).
      let current = 0
      const offsetNow = offsetAt(nowMs, timezone)
      let probe = Date.parse(`${localDate(nowMs, timezone)}T00:00:00Z`) + offsetNow * 60_000
      if (!active.has(localDate(probe, timezone))) probe -= 86_400_000
      while (active.has(localDate(probe, timezone))) {
        current += 1
        probe -= 86_400_000
      }
      return { current, longest }
    },

    getRankings({ dimension = 'model', timezone = defaultTimezone, fromMs, toMs } = {}) {
      const joins = []
      let groupKey
      if (dimension === 'project') {
        joins.push(`JOIN proj ON proj.session_id = r.session_id`)
        groupKey = 'proj.project'
      } else if (dimension === 'provider') {
        groupKey = 'r.provider'
      } else {
        groupKey = 'r.model_raw'
      }
      const timeFilter = []
      const params = []
      if (fromMs !== undefined) { timeFilter.push('r.time >= ?'); params.push(fromMs) }
      if (toMs !== undefined) { timeFilter.push('r.time < ?'); params.push(toMs) }
      const sql = `
        WITH RECURSIVE proj(session_id, project) AS (
          SELECT session_id, cwd FROM sources WHERE cwd IS NOT NULL
          UNION
          SELECT s.session_id, p.project FROM sources s JOIN proj p ON s.parent_session = p.session_id WHERE s.cwd IS NULL
        )
        SELECT ${groupKey} AS key,
               COUNT(*) AS requests,
               SUM(CASE WHEN r.status = 'ok' THEN 1 ELSE 0 END) AS calls,
               SUM(r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens) AS processingTokens,
               SUM(r.input_tokens + r.output_tokens) AS newComputeTokens
        FROM requests r ${joins.join(' ')}
        WHERE r.owned = 1${timeFilter.length ? ` AND ${timeFilter.join(' AND ')}` : ''}
        GROUP BY key ORDER BY processingTokens DESC
      `
      const rows = db.prepare(sql).all(...params)
      return {
        rows: rows.map((row) => ({
          key: row.key ?? 'unknown',
          requests: row.requests ?? 0,
          calls: row.calls ?? 0,
          processingTokens: row.processingTokens ?? 0,
          newComputeTokens: row.newComputeTokens ?? 0,
        })),
      }
    },

    listSessions({ timezone = defaultTimezone, limit = 200, offset = 0 } = {}) {
      const rows = db.prepare(`
        SELECT s.session_id AS id, s.created_at AS createdAt, s.cwd, s.parent_session AS parentSession,
               s.origin, s.seed_length AS seedLength, s.deleted AS sourceDeleted, s.last_seq AS lastSeq,
               COUNT(r.session_id) AS requests,
               SUM(CASE WHEN r.owned = 1 THEN r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens ELSE 0 END) AS processingTokens
        FROM sources s LEFT JOIN requests r ON r.session_id = s.session_id
        GROUP BY s.session_id ORDER BY s.created_at DESC LIMIT ? OFFSET ?
      `).all(limit, offset)
      return {
        rows: rows.map((row) => ({
          id: row.id,
          createdAt: row.createdAt,
          cwd: row.cwd,
          parentSession: row.parentSession,
          origin: row.origin,
          seedLength: row.seedLength,
          sourceDeleted: row.sourceDeleted === 1,
          lastSeq: row.lastSeq,
          requests: row.requests ?? 0,
          processingTokens: row.processingTokens ?? 0,
        })),
      }
    },

    getSessionDetail(sessionId, options = {}) {
      const source = db.prepare('SELECT * FROM sources WHERE session_id = ?').get(sessionId)
      if (source === undefined) return null
      const rows = db.prepare('SELECT * FROM requests WHERE session_id = ? ORDER BY time').all(sessionId)
      const own = emptyTotals()
      const inherited = emptyTotals()
      for (const row of rows) {
        addTokens(isOwned(row) ? own : inherited, row)
        if (row.status === 'failed') own.failedRequests += 1
        own.requests += 1
        if (row.status === 'ok') own.calls += 1
      }
      const children = db.prepare(`
        WITH RECURSIVE tree(id) AS (
          SELECT session_id FROM sources WHERE parent_session = ?
          UNION
          SELECT s.session_id FROM sources s JOIN tree t ON s.parent_session = t.id
        ) SELECT id FROM tree
      `).all(sessionId)
      const includingChildren = { ...own }
      for (const child of children) {
        // Lineage roll-up counts each child's OWN usage (owned = 1); an
        // inherited fork seed inside a child duplicates ancestor usage and
        // must never be added again here.
        for (const row of db.prepare('SELECT * FROM requests WHERE session_id = ? AND owned = 1').all(child.id)) {
          addTokens(includingChildren, row)
          includingChildren.requests += 1
          if (row.status === 'ok') includingChildren.calls += 1
        }
      }
      return {
        id: sessionId,
        createdAt: source.created_at,
        cwd: source.cwd,
        parentSession: source.parent_session,
        origin: source.origin,
        sourceDeleted: source.deleted === 1,
        direct: own,
        ownTotals: own,
        inheritedTotals: inherited,
        includingChildren,
        calls: rows.map((row) => ({
          turn: row.turn, step: row.step, time: row.time,
          provider: row.provider, model: row.model_raw,
          owned: row.owned === 1, status: row.status, estimated: row.estimated === 1,
          inputTokens: row.input_tokens, outputTokens: row.output_tokens,
          cacheReadTokens: row.cache_read_tokens, cacheWriteTokens: row.cache_write_tokens,
          reasoningTokens: row.reasoning_tokens,
          originalUsdNano: row.original_usd_nano,
        })),
      }
    },

    listRequests({ sessionId, model, provider, status, estimated, fromMs, toMs, limit = 50, offset = 0 } = {}) {
      const filters = ['r.owned = 1']
      const params = []
      if (sessionId !== undefined) { filters.push('r.session_id = ?'); params.push(sessionId) }
      if (model !== undefined) { filters.push('r.model_raw = ?'); params.push(model) }
      if (provider !== undefined) { filters.push('r.provider = ?'); params.push(provider) }
      if (status !== undefined) { filters.push('r.status = ?'); params.push(status) }
      if (estimated !== undefined) { filters.push('r.estimated = ?'); params.push(estimated ? 1 : 0) }
      if (fromMs !== undefined) { filters.push('r.time >= ?'); params.push(fromMs) }
      if (toMs !== undefined) { filters.push('r.time < ?'); params.push(toMs) }
      const rows = db.prepare(`
        SELECT r.*, s.cwd FROM requests r JOIN sources s ON s.session_id = r.session_id
        WHERE ${filters.join(' AND ')}
        ORDER BY r.time DESC LIMIT ? OFFSET ?
      `).all(...params, limit, offset)
      return {
        rows: rows.map((row) => {
          const current = hasUsage(row) ? valueUsage(catalog, {
            provider: row.provider,
            modelRaw: row.model_raw,
            usage: {
              input: row.input_tokens,
              output: row.output_tokens,
              cacheRead: row.cache_read_tokens,
              cacheWrite: row.cache_write_tokens,
            },
          }) : null
          return {
            sessionId: row.session_id, turn: row.turn, step: row.step, time: row.time,
            provider: row.provider, model: row.model_raw, cwd: row.cwd,
            status: row.status, estimated: row.estimated === 1,
            estimator: row.estimator, estimatorVersion: row.estimator_version,
            inputTokens: row.input_tokens, outputTokens: row.output_tokens,
            cacheReadTokens: row.cache_read_tokens, cacheWriteTokens: row.cache_write_tokens,
            reasoningTokens: row.reasoning_tokens,
            processingTokens: row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_write_tokens,
            originalUsdNano: row.original_usd_nano,
            currentUsdNano: current?.usdNano ?? null,
            matchedPriceModel: current?.matchedModel ?? null,
            priceVersion: row.price_version,
          }
        }),
      }
    },

    setAlias(modelRaw, canonical) {
      db.prepare('INSERT OR REPLACE INTO aliases (model_raw, canonical) VALUES (?, ?)').run(modelRaw, canonical)
      catalog.aliases.set(modelRaw, canonical)
      bumpAnalyticsRevision()
    },

    /** `{revision, lastSeq}` for a known source, or null. */
    getSourceMeta(sessionId) {
      const row = db.prepare('SELECT revision, last_seq AS lastSeq FROM sources WHERE session_id = ?').get(sessionId)
      return row === undefined ? null : { revision: row.revision, lastSeq: row.lastSeq }
    },

    /** Persist a secret-free connection and optional credential reference. */
    saveAccountConnection(connection) {
      if (!connection || typeof connection.providerId !== 'string') throw new LedgerError('bad-connection', 'account connection requires providerId')
      const now = Number(connection.updatedAt ?? Date.now())
      const id = String(connection.connectionId ?? `${connection.providerId}:default`)
      db.prepare(`INSERT INTO account_connections
        (id, provider_id, account_key, display_name, status, auth_kind, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name,
          status = excluded.status, auth_kind = excluded.auth_kind, updated_at = excluded.updated_at
      `).run(id, connection.providerId, connection.accountKey ?? null, connection.displayName ?? connection.providerId,
        connection.configured === true ? 'connected' : 'not_connected', connection.credentialKind ?? 'none', now, now)
      if (typeof connection.credentialRef === 'string' && connection.credentialRef) {
        db.prepare(`INSERT INTO credential_metadata
          (id, connection_id, credential_ref, kind, expires_at, scopes_json, updated_at)
          VALUES (?, ?, ?, ?, ?, '[]', ?)
          ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, expires_at = excluded.expires_at, updated_at = excluded.updated_at
        `).run(`${id}:credential`, id, connection.credentialRef, connection.credentialKind ?? 'unknown', connection.credentialExpiresAt ?? null, now)
      }
      return { id }
    },

    /** Persist one already-sanitized provider observation and its typed facts. */
    saveAccountObservation(observation) {
      if (!observation || typeof observation !== 'object' || typeof observation.id !== 'string') {
        throw new LedgerError('bad-observation', 'account observation requires an id')
      }
      const raw = JSON.stringify(observation)
      const serialized = serializePublic(observation)
      if (serialized !== raw) throw new LedgerError('secret-rejected', 'account observation contains a secret-bearing field')
      transaction(db, () => {
        const connectionId = observation.connectionId ?? `${observation.providerId ?? 'unknown'}:default`
        const providerId = observation.providerId ?? connectionId.split(':')[0]
        db.prepare(`INSERT INTO account_connections
          (id, provider_id, account_key, display_name, status, auth_kind, created_at, updated_at)
          VALUES (?, ?, NULL, ?, 'connected', 'external', ?, ?)
          ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
        `).run(connectionId, providerId, providerId, observation.observedAt, observation.observedAt)
        if (observation.product) {
          db.prepare(`INSERT INTO account_products
            (id, provider_id, external_id, name, source_kind, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, source_kind = excluded.source_kind
          `).run(observation.product.id, observation.providerId, observation.product.externalId ?? observation.product.code ?? null,
            observation.product.name, observation.source, observation.observedAt)
        }
        const windows = new Map((observation.windows ?? []).map(window => [window.id, window]))
        for (const limit of observation.limits ?? []) {
          const window = windows.get(limit.windowId) ?? limit.window ?? {}
          db.prepare(`INSERT INTO account_limits
            (id, connection_id, product_id, external_key, metric, unit, value_mode,
             exact_value, minimum_value, maximum_value, window_kind, window_seconds,
             window_json, reset_at, source_kind, confidence, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET exact_value = excluded.exact_value,
              minimum_value = excluded.minimum_value, maximum_value = excluded.maximum_value,
              window_json = excluded.window_json, reset_at = excluded.reset_at, source_kind = excluded.source_kind,
              note = excluded.note, created_at = excluded.created_at
          `).run(limit.id, connectionId, limit.productId ?? observation.product?.id ?? null,
            limit.externalKey ?? null, limit.metric, limit.unit, limit.mode,
            limit.value === null || limit.value === undefined ? null : String(limit.value),
            limit.min === null || limit.min === undefined ? null : String(limit.min),
            limit.max === null || limit.max === undefined ? null : String(limit.max),
            window.kind ?? 'fixed', window.durationMs ? Math.trunc(window.durationMs / 1000) : null,
            JSON.stringify(window), window.resetsAt ?? null, observation.source, limit.confidence ?? null,
            limit.note ?? (limit.percentUsed === null || limit.percentUsed === undefined ? null : `${limit.percentUsed}% used`),
            observation.observedAt)
        }
        db.prepare(`INSERT OR REPLACE INTO account_observations
          (id, connection_id, product_id, observed_at, source_kind, brittle, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(observation.id, connectionId, observation.product?.id ?? null, observation.observedAt,
          observation.source, observation.brittle ? 1 : 0, serialized)
      })
      return observation
    },

    listAccountObservations({ connectionId, limit = 50 } = {}) {
      const bounded = Math.max(1, Math.min(200, Number(limit) || 50))
      const rows = connectionId
        ? db.prepare('SELECT payload_json FROM account_observations WHERE connection_id = ? ORDER BY observed_at DESC LIMIT ?').all(connectionId, bounded)
        : db.prepare('SELECT payload_json FROM account_observations ORDER BY observed_at DESC LIMIT ?').all(bounded)
      return rows.map(row => JSON.parse(row.payload_json))
    },

    /** Seeded product templates for the account wizard (host-side catalog). */
    accountTemplates() {
      return listSeededTemplates(db)
    },

    /**
     * Idempotently ensure one product + default attribution rules for a
     * configured connection (zero-config accounts). Respects archives: an
     * archived auto product is never resurrected by later summaries.
     */
    ensureConnectionAccount(connection, { aliases = [], attribution = 'provider' } = {}) {
      if (!connection || typeof connection.providerId !== 'string') throw new LedgerError('bad-connection', 'account connection requires providerId')
      const rowId = String(connection.connectionId ?? `${connection.providerId}:default`)
      const productId = `connection:${rowId}`
      const existing = db.prepare('SELECT id, archived_at AS archivedAt FROM account_products WHERE id = ?').get(productId)
      if (existing !== undefined && existing.archivedAt != null) {
        return { id: productId, archived: true }
      }
      let changed = false
      if (existing === undefined) {
        db.prepare(`
          INSERT INTO account_products (id, provider_id, external_id, name, color, source_kind, connection_id, created_at)
          VALUES (?, ?, ?, ?, NULL, 'connection', ?, ?)
        `).run(productId, connection.providerId, rowId, connection.displayName ?? connection.providerId, rowId, Date.now())
        changed = true
      }
      if (!['provider', 'connection', 'none'].includes(attribution)) {
        throw new LedgerError('bad-attribution', `invalid connection attribution mode: ${String(attribution)}`)
      }
      // Connection-default rules are system-owned: always reconcile them,
      // including deleting stale rules when attribution becomes unavailable.
      const connectionId = attribution === 'connection' ? rowId : null
      const desired = attribution === 'none' ? [] : [...new Set((aliases.length > 0 ? aliases : [connection.providerId]).map((alias) => `${alias}*`))]
        .sort()
        .map(matchProvider => ({ connectionId, matchProvider }))
      const current = db.prepare(`
        SELECT connection_id AS connectionId, match_provider AS matchProvider
        FROM account_attribution_rules
        WHERE product_id = ? AND source_kind = 'connection_default'
        ORDER BY connection_id, match_provider
      `).all(productId)
      if (JSON.stringify(current) !== JSON.stringify(desired)) {
        db.prepare("DELETE FROM account_attribution_rules WHERE product_id = ? AND source_kind = 'connection_default'").run(productId)
        const insert = db.prepare(`
          INSERT INTO account_attribution_rules (connection_id, product_id, match_provider, match_model, priority, source_kind)
          VALUES (?, ?, ?, NULL, 100, 'connection_default')
        `)
        for (const rule of desired) insert.run(rule.connectionId, productId, rule.matchProvider)
        changed = true
      }
      if (changed) bumpAnalyticsRevision()
      return { id: productId, archived: false }
    },

    /** Accounts for the editor surface: products + billing + limits + rules. */
    listAccounts() {
      const products = db.prepare(`
        SELECT id, provider_id AS providerId, external_id AS externalId, name, color,
               source_kind AS sourceKind, connection_id AS connectionId,
               archived_at AS archivedAt, created_at AS createdAt
        FROM account_products
        ORDER BY archived_at IS NOT NULL, created_at, id
      `).all()
      const billing = db.prepare(`
        SELECT product_id AS productId, kind, currency, amount_nano AS amountNano,
               cycle_anchor_day AS cycleAnchorDay, balance_nano AS balanceNano,
               expires_at AS expiresAt, source_kind AS sourceKind, observed_at AS observedAt
        FROM account_billing
        WHERE observed_at = (SELECT MAX(b2.observed_at) FROM account_billing b2 WHERE b2.product_id = account_billing.product_id)
      `).all()
      const billingByProduct = new Map(billing.map(row => [row.productId, row]))
      const limits = db.prepare(`
        SELECT id, product_id AS productId, external_key AS externalKey, metric, unit,
               value_mode AS valueMode, exact_value AS exactValue, window_kind AS windowKind,
               window_seconds AS windowSeconds, source_kind AS sourceKind
        FROM account_limits WHERE metric = 'quota' ORDER BY created_at, id
      `).all()
      const limitsByProduct = new Map()
      for (const limit of limits) {
        if (limit.productId == null) continue
        const rows = limitsByProduct.get(limit.productId) ?? []
        rows.push({ ...limit, exactValue: limit.exactValue == null ? null : Number(limit.exactValue) })
        limitsByProduct.set(limit.productId, rows)
      }
      const rules = db.prepare(`
        SELECT id, connection_id AS connectionId, product_id AS productId, match_provider AS matchProvider,
               match_model AS matchModel, priority, source_kind AS sourceKind
        FROM account_attribution_rules ORDER BY priority, id
      `).all()
      const rulesByProduct = new Map()
      for (const rule of rules) {
        const rows = rulesByProduct.get(rule.productId) ?? []
        rows.push(rule)
        rulesByProduct.set(rule.productId, rows)
      }
      return products.map((product) => ({
        ...product,
        archived: product.archivedAt != null,
        billing: billingByProduct.get(product.id) ?? null,
        limits: limitsByProduct.get(product.id) ?? [],
        rules: rulesByProduct.get(product.id) ?? [],
      }))
    },

    /**
     * Create or update one account from the wizard / advanced editor. Writes
     * the account domain only (product + billing + quota limits + rules);
     * ledger facts are never touched. Legacy v5 products are read-only here.
     */
    saveAccount(account = {}) {
      const name = String(account.name ?? '').trim()
      if (!name || name.length > 120) throw new LedgerError('invalid-account', 'account name is required (≤120 chars)')
      const kind = account.kind ?? 'track_only'
      if (!['subscription', 'prepaid', 'track_only'].includes(kind)) throw new LedgerError('invalid-account', `invalid account kind: ${kind}`)
      const templateId = account.templateId == null || account.templateId === '' ? null : String(account.templateId)
      const tierId = account.tierId == null || account.tierId === '' ? null : String(account.tierId)
      const connectionId = account.connectionId == null || account.connectionId === '' ? null : String(account.connectionId)
      if (account.color != null && !/^#[0-9a-fA-F]{3,8}$/.test(String(account.color))) throw new LedgerError('invalid-account', 'color must be a hex value')
      const id = account.id != null && account.id !== ''
        ? String(account.id)
        : `account:${createHash('sha256').update([templateId ?? '', tierId ?? '', connectionId ?? '', name].join('\u0000')).digest('hex').slice(0, 16)}`
      const existing = db.prepare('SELECT id, provider_id AS providerId, source_kind AS sourceKind FROM account_products WHERE id = ?').get(id)
      if (existing !== undefined && existing.sourceKind === 'legacy_v5_manual') {
        throw new LedgerError('legacy-plan-readonly', 'legacy v5 plans are read-only in the account editor')
      }
      const sourceKind = existing?.sourceKind === 'connection' ? 'connection' : (templateId !== null ? 'template' : 'manual')
      const providerId = account.providerId != null && account.providerId !== '' ? String(account.providerId) : (existing?.providerId ?? (templateId ?? 'manual'))
      const now = Date.now()

      // Quota limits: replace the product's non-legacy declared limits.
      const limits = Array.isArray(account.limits) ? account.limits : []
      const LIMIT_MODES = new Set(['exact', 'range', 'dynamic', 'unpublished', 'manual'])
      const WINDOW_KINDS = new Set(['rolling', 'fixed', 'billing', 'rate'])
      const UNITS = new Set(['percent', 'credits', 'tokens', 'usd', 'requests', 'newCompute'])
      const cleanLimits = limits.map((limit, index) => {
        const externalKey = String(limit?.externalKey ?? `window${index + 1}`)
        const unit = String(limit?.unit ?? 'percent')
        const valueMode = String(limit?.valueMode ?? 'manual')
        const windowKind = String(limit?.windowKind ?? 'rolling')
        if (!UNITS.has(unit)) throw new LedgerError('invalid-account', `limit ${index}: invalid unit ${unit}`)
        if (!LIMIT_MODES.has(valueMode)) throw new LedgerError('invalid-account', `limit ${index}: invalid valueMode ${valueMode}`)
        if (!WINDOW_KINDS.has(windowKind)) throw new LedgerError('invalid-account', `limit ${index}: invalid windowKind ${windowKind}`)
        let value = null
        if (valueMode === 'exact' || valueMode === 'manual') {
          if (!Number.isFinite(Number(limit?.value)) || Number(limit?.value) <= 0) {
            throw new LedgerError('invalid-account', `limit ${index}: ${valueMode} limits require a positive value`)
          }
          value = Number(limit.value)
        }
        const windowSeconds = limit?.windowSeconds == null ? null : Number(limit.windowSeconds)
        if (windowSeconds !== null && (!Number.isFinite(windowSeconds) || windowSeconds <= 0)) {
          throw new LedgerError('invalid-account', `limit ${index}: windowSeconds must be positive`)
        }
        return { externalKey, unit, valueMode, value, windowKind, windowSeconds }
      })

      // Attribution rules: replace the product's non-legacy rules.
      const rules = Array.isArray(account.rules) ? account.rules : []
      if (rules.length > 64) throw new LedgerError('invalid-account-rules', 'rules must be an array of at most 64 entries')
      const cleanRules = rules.map((rule, index) => {
        const matchProvider = rule?.matchProvider == null || rule?.matchProvider === '' ? null : String(rule.matchProvider)
        const matchModel = rule?.matchModel == null || rule?.matchModel === '' ? null : String(rule.matchModel)
        if (matchProvider === null && matchModel === null) throw new LedgerError('invalid-account-rules', `rule ${index}: matchProvider or matchModel is required`)
        return { matchProvider, matchModel, priority: Number.isFinite(Number(rule?.priority)) ? Number(rule.priority) : index }
      })

      transaction(db, () => {
        if (existing === undefined) {
          db.prepare(`
            INSERT INTO account_products (id, provider_id, external_id, name, color, source_kind, connection_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(id, providerId, tierId, name, account.color ?? null, sourceKind, connectionId, now)
        } else {
          db.prepare(`
            UPDATE account_products SET name = ?, color = ?, connection_id = ?, archived_at = NULL WHERE id = ?
          `).run(name, account.color ?? null, connectionId, id)
        }

        const billing = account.billing ?? {}
        const amountNano = Number.isFinite(Number(billing.priceUsd)) && Number(billing.priceUsd) >= 0
          ? String(Math.round(Number(billing.priceUsd) * 1e9)) : null
        let resetDay = 1
        if (billing.resetDay != null) {
          const day = Number(billing.resetDay)
          if (!Number.isInteger(day) || day < 1 || day > 28) throw new LedgerError('invalid-account', 'resetDay must be an integer 1–28')
          resetDay = day
        }
        const balanceNano = Number.isFinite(Number(billing.balanceUsd)) && Number(billing.balanceUsd) >= 0
          ? String(Math.round(Number(billing.balanceUsd) * 1e9)) : null
        let expiresAt = null
        if (billing.expiryDay != null && billing.expiryDay !== '') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(billing.expiryDay))) throw new LedgerError('invalid-account', 'expiryDay must be YYYY-MM-DD')
          expiresAt = Date.parse(`${String(billing.expiryDay)}T00:00:00Z`)
        }
        db.prepare(`
          INSERT INTO account_billing (id, product_id, kind, currency, amount_nano, cycle_anchor_day, balance_nano, expires_at, source_kind, observed_at)
          VALUES (?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, amount_nano = excluded.amount_nano,
            cycle_anchor_day = excluded.cycle_anchor_day, balance_nano = excluded.balance_nano,
            expires_at = excluded.expires_at, source_kind = excluded.source_kind, observed_at = excluded.observed_at
        `).run(`account-billing:${id}`, id, kind, amountNano, resetDay, balanceNano, expiresAt, sourceKind, now)

        db.prepare(`DELETE FROM account_limits WHERE product_id = ? AND metric = 'quota' AND source_kind != 'legacy_v5_manual'`).run(id)
        const insertLimit = db.prepare(`
          INSERT INTO account_limits (id, product_id, external_key, metric, unit, value_mode, exact_value,
            window_kind, window_seconds, source_kind, confidence, note, created_at)
          VALUES (?, ?, ?, 'quota', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const limit of cleanLimits) {
          insertLimit.run(`account-limit:${id}:${limit.externalKey}`, id, limit.externalKey, limit.unit, limit.valueMode,
            limit.value == null ? null : String(limit.value), limit.windowKind, limit.windowSeconds, sourceKind,
            limit.valueMode === 'manual' ? 'manual_estimate' : null, null, now)
        }

        db.prepare(`DELETE FROM account_attribution_rules WHERE product_id = ? AND source_kind != 'legacy_v5_manual'`).run(id)
        const insertRule = db.prepare(`
          INSERT INTO account_attribution_rules (product_id, match_provider, match_model, priority, source_kind)
          VALUES (?, ?, ?, ?, ?)
        `)
        for (const rule of cleanRules) {
          insertRule.run(id, rule.matchProvider, rule.matchModel, rule.priority, sourceKind)
        }
      })
      bumpAnalyticsRevision()
      return { id, templateId, tierId }
    },

    /** Archive or restore an account product; legacy plans stay plan-owned. */
    archiveAccount(id, { archived = true } = {}) {
      const productId = String(id)
      if (productId.startsWith('legacy-plan:')) {
        const planId = productId.slice('legacy-plan:'.length)
        const result = archived
          ? db.prepare('UPDATE plans SET archived_at = ? WHERE id = ? AND archived_at IS NULL').run(Date.now(), planId)
          : db.prepare('UPDATE plans SET archived_at = NULL WHERE id = ?').run(planId)
        if (Number(result.changes) === 0) throw new LedgerError('account-not-found', `account not found: ${id}`)
        projectLegacyPlans(db)
        bumpAnalyticsRevision()
        return { id: productId, archived }
      }
      const result = archived
        ? db.prepare('UPDATE account_products SET archived_at = ? WHERE id = ? AND archived_at IS NULL').run(Date.now(), productId)
        : db.prepare('UPDATE account_products SET archived_at = NULL WHERE id = ?').run(productId)
      if (Number(result.changes) === 0) throw new LedgerError('account-not-found', `account not found: ${id}`)
      bumpAnalyticsRevision()
      return { id: productId, archived }
    },

    /** Raw table dump for the settings surface (small config tables only). */
    dumpTable(table) {
      const allowed = new Set(['aliases', 'price_overrides', 'price_updates', 'providers', 'purged_daily'])
      if (!allowed.has(table)) throw new LedgerError('bad-table', `table not readable: ${table}`)
      return db.prepare(`SELECT * FROM ${table}`).all()
    },

    /** Embedded snapshot and explicitly applied upstream catalog identity. */
    snapshotMeta() {
      const updateRows = db.prepare('SELECT model, source, updated_at FROM price_updates ORDER BY model').all()
      return {
        version: catalog.snapshot.version ?? null,
        source: catalog.snapshot.source ?? null,
        note: catalog.snapshot.note ?? null,
        models: Object.keys(catalog.snapshot.models ?? {}),
        updatedModels: updateRows.map((row) => row.model),
        updatedAt: updateRows.reduce((latest, row) => Math.max(latest, row.updated_at), 0) || null,
        updateSource: updateRows[0]?.source ?? null,
      }
    },

    /** Models observed in requests plus all selectable catalog targets. */
    priceCatalog() {
      return {
        observed: db.prepare(`
          SELECT model_raw AS model, provider, COUNT(*) AS requests
          FROM requests GROUP BY model_raw, provider ORDER BY requests DESC, model_raw
        `).all(),
        bundled: Object.keys(catalog.snapshot.models ?? {}).sort(),
        updated: [...catalog.updates.keys()].sort(),
      }
    },

    /** Atomically replace the explicitly refreshed upstream catalog. */
    setUpstreamPrices(prices, { source = 'litellm-upstream', updatedAt = Date.now() } = {}) {
      const entries = prices instanceof Map ? [...prices] : Object.entries(prices ?? {})
      transaction(db, () => {
        db.exec('DELETE FROM price_updates')
        const insert = db.prepare(`
          INSERT INTO price_updates
            (model, input_nano, output_nano, cache_read_nano, cache_write_nano, source, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        for (const [model, price] of entries) {
          insert.run(
            model,
            price.inputNano,
            price.outputNano,
            price.cacheReadNano ?? null,
            price.cacheWriteNano ?? null,
            source,
            updatedAt,
          )
        }
      })
      catalog.setUpdates(new Map(entries.map(([model, price]) => [model, {
        ...price,
        source,
        version: `${source}-${updatedAt}`,
        updatedAt,
      }])))
      bumpAnalyticsRevision()
      return { count: entries.length, source, updatedAt }
    },

    /**
     * Purge request details older than `cutoffMs`. Day-level anonymous
     * aggregates are folded into `purged_daily` first, so long-term trends
     * survive while per-request rows are gone for good.
     */
    purgeBefore(cutoffMs, { timezone: tz = DEFAULT_TIMEZONE } = {}) {
      const result = transaction(db, () => {
        const rows = db.prepare('SELECT time, input_tokens + output_tokens + cache_read_tokens + cache_write_tokens AS processing FROM requests WHERE time < ?').all(cutoffMs)
        const perDay = new Map()
        for (const row of rows) {
          const day = localDate(row.time, tz)
          perDay.set(day, {
            requests: (perDay.get(day)?.requests ?? 0) + 1,
            processing: (perDay.get(day)?.processing ?? 0) + row.processing,
          })
        }
        const upsert = db.prepare(`
          INSERT INTO purged_daily (day, requests, processing_tokens) VALUES (?, ?, ?)
          ON CONFLICT(day) DO UPDATE SET
            requests = requests + excluded.requests,
            processing_tokens = processing_tokens + excluded.processing_tokens
        `)
        for (const [day, totals] of perDay) upsert.run(day, totals.requests, totals.processing)
        const deleted = db.prepare('DELETE FROM requests WHERE time < ?').run(cutoffMs)
        return { deleted: Number(deleted?.changes ?? 0), days: perDay.size }
      })
      if (result.deleted > 0) bumpAnalyticsRevision()
      return result
    },
    setOverride(model, price) {
      db.prepare(`
        INSERT OR REPLACE INTO price_overrides (model, input_nano, output_nano, cache_read_nano, cache_write_nano, reasoning_nano)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(model, String(price.inputNano), String(price.outputNano), price.cacheReadNano !== undefined ? String(price.cacheReadNano) : null, price.cacheWriteNano !== undefined ? String(price.cacheWriteNano) : null, price.reasoningNano !== undefined ? String(price.reasoningNano) : null)
      catalog.overrides.set(model, price)
      bumpAnalyticsRevision()
    },
    setMultiplier(provider, bps) {
      db.prepare('INSERT OR REPLACE INTO providers (provider, multiplier_bps) VALUES (?, ?)').run(provider, bps)
      catalog.multipliers.set(provider, bps)
      bumpAnalyticsRevision()
    },

    /** Write a consistent snapshot of the whole ledger to `backupPath`. */
    backupTo(backupPath) {
      db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`)
    },

    /**
     * Restore a backup previously written by `backupTo`. `replace` wipes and
     * copies the backup verbatim; `merge` inserts only rows whose keys are
     * absent (idempotent, never overwrites local facts). Callers gate which
     * paths are restorable; the service itself stays path-agnostic.
     */
    restoreFrom(backupPath, { mode = 'merge' } = {}) {
      const quoted = String(backupPath).replaceAll("'", "''")
      db.exec(`ATTACH '${quoted}' AS restore_src`)
      try {
        transaction(db, () => {
          const tables = ['sources', 'requests', 'projects', 'project_sources', 'request_corrections', 'budgets', 'aliases', 'providers', 'price_overrides', 'price_updates', 'purged_daily']
          const available = new Set(db.prepare("SELECT name FROM restore_src.sqlite_master WHERE type = 'table'").all().map((row) => row.name))
          if (mode === 'replace') {
            for (const table of [...tables].reverse()) db.exec(`DELETE FROM main.${table}`)
          }
          // Older backups legitimately lack tables added by later schema
          // versions. Their missing tables stay empty after restore.
          for (const table of tables) {
            if (!available.has(table)) continue
            const conflict = mode === 'replace' ? '' : ' OR IGNORE'
            db.exec(`INSERT${conflict} INTO main.${table} SELECT * FROM restore_src.${table}`)
          }
        })
      } finally {
        db.exec('DETACH restore_src')
      }
      for (const row of db.prepare('SELECT DISTINCT cwd, created_at AS createdAt FROM sources WHERE cwd IS NOT NULL').all()) ensureDefaultProject(row.cwd, row.createdAt)
      bumpAnalyticsRevision()
    },

    dispose() {
      liveConfig.clear()
      liveBuffers.clear()
      liveStarts.clear()
      db.close()
    },
  }
}
