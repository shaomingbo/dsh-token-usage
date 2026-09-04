import { localDate, localDayBounds, weekStart } from './days.js'
import { valueUsage } from './pricing.js'
import { transaction } from './db.js'
import { normalizeAnchor } from '../accounts/domain.js'
import {
  DEFAULT_OLLAMA_CACHE_ESTIMATE_BPS,
  estimateOllamaCloudCacheRead,
  normalizeOllamaCacheEstimateBps,
  OLLAMA_CACHE_ESTIMATION_METHOD,
} from './cache-estimate.js'

const globCache = new Map()
/** Case-sensitive glob (`*`, `?`) used by account attribution rules. */
export function globMatch(pattern, value) {
  let regex = globCache.get(pattern)
  if (regex === undefined) {
    regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.')}$`)
    globCache.set(pattern, regex)
  }
  return regex.test(value)
}

const FILTER_DIMENSIONS = new Set(['project', 'session', 'model', 'modelRaw', 'provider', 'status', 'price', 'pool'])
const DAY = 86_400_000
const HOUR = 3_600_000
const UNASSIGNED_POOL = 'unassigned'
// Cache identity quantizes only the clock. Dashboard pollers pass `now` on
// every call; bucketing it keeps their cache keys stable across a minute
// while the queried data windows themselves keep the exact timestamp.
const CLOCK_BUCKET_MS = 60_000
/**
 * Official windows older than this are flagged `stale` (still shown, but the
 * client labels the observation age); expired windows already past their
 * reset instant are nulled out entirely.
 */
export const OFFICIAL_OBSERVATION_STALE_MS = 30 * 60_000

/** Strict percent parse: finite numbers, or non-empty strings that parse exactly. */
function parsePercent(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function clampInt(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : null
}

/** Calendar bounds of one anchored fixed window with its reset facts. */
function fixedWindow(key, fromMs, toMs, now, timezone) {
  return {
    key,
    fromMs,
    toMs,
    daysLeft: Math.max(0, (toMs - now) / DAY),
    elapsedPct: Math.max(0, Math.min(100, ((now - fromMs) / (toMs - fromMs)) * 100)),
    resetLabel: localDate(toMs, timezone),
    resetsAt: toMs,
  }
}

/**
 * Resolve a declared quota limit into a measurable analytics window. Fixed
 * windows follow their calendar anchor: a daily or weekly duration maps to
 * the local day / local week boundary (weekday 1 = Monday, hour offset from
 * the anchor, timezone from the anchor or the query), any other duration is
 * back-derived from a known `resetsAt`. Without an anchor or reset instant a
 * fixed window is unknown (null) rather than silently degrading to rolling.
 */
function quotaWindow(limit, resetDay, now, timezone) {
  if (!limit) return null
  if (limit.windowKind === 'billing') {
    const cycle = billingCycle(now, resetDay ?? 1, timezone)
    return { key: `billing:${resetDay ?? 1}`, ...cycle, resetsAt: cycle.toMs }
  }
  const seconds = Number(limit.windowSeconds)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  if (limit.windowKind === 'fixed') {
    const anchor = limit.anchor ?? null
    const zone = typeof anchor?.timezone === 'string' && anchor.timezone !== '' ? anchor.timezone : timezone
    const hour = clampInt(anchor?.hour, 0, 23) ?? 0
    const today = localDate(now, zone)
    if (seconds === 86_400) {
      let start = localDayBounds(today, zone).start + hour * HOUR
      if (start > now) start = localDayBounds(shiftDay(today, -1), zone).start + hour * HOUR
      const end = localDayBounds(shiftDay(localDate(start, zone), 1), zone).start + hour * HOUR
      return fixedWindow(`fixed:${seconds}:${start}`, start, end, now, zone)
    }
    if (seconds === 604_800) {
      const weekday = clampInt(anchor?.weekday, 1, 7) ?? 1
      const monday = weekStart(today)
      let startDay = shiftDay(monday, weekday - 1)
      if (localDayBounds(startDay, zone).start + hour * HOUR > now) startDay = shiftDay(startDay, -7)
      const start = localDayBounds(startDay, zone).start + hour * HOUR
      const end = localDayBounds(shiftDay(startDay, 7), zone).start + hour * HOUR
      return fixedWindow(`fixed:${seconds}:${start}`, start, end, now, zone)
    }
    const resetsAt = Number(limit.resetsAt)
    if (!Number.isFinite(resetsAt) || resetsAt <= 0) return null
    let to = resetsAt
    while (to <= now) to += seconds * 1000
    return fixedWindow(`fixed:${seconds}:${to - seconds * 1000}`, to - seconds * 1000, to, now, zone)
  }
  if (limit.windowKind === 'rolling') {
    return {
      key: `roll:${seconds}`,
      fromMs: now - seconds * 1000,
      toMs: now,
      daysLeft: seconds / 86_400,
      elapsedPct: null,
      resetLabel: null,
      resetsAt: null,
    }
  }
  return null
}

function cloneFilter(filter = {}) {
  const result = { ...filter }
  for (const dimension of FILTER_DIMENSIONS) {
    if (Array.isArray(filter[dimension])) result[dimension] = [...new Set(filter[dimension].map(String))].sort()
  }
  if (filter.time !== undefined) result.time = { ...filter.time }
  return result
}

/** Pure cross-filter algebra shared by the analytics module and UI adapter. */
export function constrain(filter = {}, patch = {}) {
  if (patch.op === 'reset') return {}
  const next = cloneFilter(filter)
  if (patch.op === 'add') {
    if (!FILTER_DIMENSIONS.has(patch.dimension)) throw new TypeError(`unsupported filter dimension: ${String(patch.dimension)}`)
    next[patch.dimension] = [...new Set([...(next[patch.dimension] ?? []), String(patch.key)])].sort()
    return next
  }
  if (patch.op === 'remove') {
    if (!FILTER_DIMENSIONS.has(patch.dimension)) throw new TypeError(`unsupported filter dimension: ${String(patch.dimension)}`)
    const values = (next[patch.dimension] ?? []).filter((value) => value !== String(patch.key))
    if (values.length) next[patch.dimension] = values
    else delete next[patch.dimension]
    return next
  }
  if (patch.op === 'set-time') {
    next.time = { ...patch.time }
    return next
  }
  if (patch.op === 'clear-time') {
    delete next.time
    return next
  }
  throw new TypeError(`unsupported filter patch: ${String(patch.op)}`)
}

/** Ledger-computable quota units; percent/credits stay official-observed only. */
const COMPUTABLE_UNITS = new Set(['tokens', 'newCompute', 'usd', 'requests'])

function usedAmount(kpis, unit) {
  if (unit === 'usd') return (kpis.cost?.currentUsdNano ?? 0) / 1e9
  if (unit === 'requests') return kpis.requests ?? 0
  return kpis.newComputeTokens ?? 0
}

function billingCycle(now, resetDay, timezone) {
  const day = Math.min(Math.max(Number(resetDay) || 1, 1), 28)
  const pad = (value) => String(value).padStart(2, '0')
  const today = localDate(now, timezone)
  const [year, month, dayOfMonth] = today.split('-').map(Number)
  const startedThisMonth = dayOfMonth >= day
  const startYear = startedThisMonth ? year : month === 1 ? year - 1 : year
  const startMonth = startedThisMonth ? month : month === 1 ? 12 : month - 1
  let nextYear = startYear
  let nextMonth = startMonth + 1
  if (nextMonth > 12) { nextMonth = 1; nextYear += 1 }
  const startStr = `${startYear}-${pad(startMonth)}-${pad(day)}`
  const endStr = `${nextYear}-${pad(nextMonth)}-${pad(day)}`
  const fromMs = localDayBounds(startStr, timezone).start
  const toMs = localDayBounds(endStr, timezone).start
  return {
    fromMs,
    toMs,
    startLabel: startStr,
    resetLabel: endStr,
    daysLeft: Math.max(1, Math.ceil((toMs - now) / DAY)),
    elapsedPct: Math.max(0, Math.min(100, ((now - fromMs) / (toMs - fromMs)) * 100)),
  }
}

function monthBounds(month, timezone) {
  const [year, value] = String(month).split('-').map(Number)
  const nextYear = value === 12 ? year + 1 : year
  const nextMonth = value === 12 ? 1 : value + 1
  const from = `${String(year).padStart(4, '0')}-${String(value).padStart(2, '0')}-01`
  const to = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`
  return { fromMs: localDayBounds(from, timezone).start, toMs: localDayBounds(to, timezone).start, days: new Date(Date.UTC(year, value, 0)).getUTCDate() }
}

function bucketBounds(key, granularity, timezone) {
  if (granularity === 'month') {
    const bounds = monthBounds(key, timezone)
    return { fromMs: bounds.fromMs, toMs: bounds.toMs }
  }
  if (granularity === 'year') {
    return { fromMs: localDayBounds(`${key}-01-01`, timezone).start, toMs: localDayBounds(`${Number(key) + 1}-01-01`, timezone).start }
  }
  const start = localDayBounds(key, timezone).start
  if (granularity === 'week') {
    const date = new Date(`${key}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + 7)
    return { fromMs: start, toMs: localDayBounds(date.toISOString().slice(0, 10), timezone).start }
  }
  return { fromMs: start, toMs: localDayBounds(key, timezone).end }
}

function shiftDay(day, offset) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function resolveWindow(time, now, timezone) {
  if (time?.fromMs !== undefined && time?.toMs !== undefined) return { fromMs: Number(time.fromMs), toMs: Number(time.toMs) }
  const preset = time?.preset ?? '30d'
  if (preset === 'all') return { fromMs: null, toMs: null }
  const days = preset === 'today' ? 1 : preset === '7d' ? 7 : preset === '90d' ? 90 : preset === '12m' ? 365 : 30
  const today = localDate(now, timezone)
  return { fromMs: localDayBounds(shiftDay(today, -(days - 1)), timezone).start, toMs: now }
}

function placeholders(values) {
  return values.map(() => '?').join(', ')
}

function compileFilter(filter, window, { alias = 'r', projectAlias = alias } = {}) {
  const clauses = [`${alias}.owned = 1`, `COALESCE(${alias}.excluded, 0) = 0`]
  const params = []
  if (window.fromMs !== null) { clauses.push(`${alias}.time >= ?`); params.push(window.fromMs) }
  if (window.toMs !== null) { clauses.push(`${alias}.time < ?`); params.push(window.toMs) }
  const addList = (column, values) => {
    if (!Array.isArray(values) || values.length === 0) return
    clauses.push(`${column} IN (${placeholders(values)})`)
    params.push(...values)
  }
  addList(`${alias}.session_id`, filter.session)
  addList(`${alias}.model`, filter.model)
  addList(`${alias}.model_raw`, filter.modelRaw)
  addList(`${alias}.provider`, filter.provider)
  addList(`${alias}.status`, filter.status)
  addList(`${projectAlias}.project`, filter.project)
  const pools = Array.isArray(filter.pool) ? [...new Set(filter.pool.map(String))] : []
  if (pools.length > 0) {
    const named = pools.filter((value) => value !== UNASSIGNED_POOL)
    const wantsUnassigned = pools.includes(UNASSIGNED_POOL)
    if (named.length > 0 && wantsUnassigned) {
      clauses.push(`(${alias}.pool_id IN (${placeholders(named)}) OR ${alias}.pool_id = '${UNASSIGNED_POOL}')`)
      params.push(...named)
    } else if (named.length > 0) {
      clauses.push(`${alias}.pool_id IN (${placeholders(named)})`)
      params.push(...named)
    } else {
      clauses.push(`${alias}.pool_id = '${UNASSIGNED_POOL}'`)
    }
  }
  return { clauses, params }
}

const PROJECT_CTE = 'WITH dsh_anchor AS (SELECT 1)'

function aggregateColumns(includeEstimates) {
  const volume = includeEstimates ? '1' : 'r.estimated = 0'
  const sum = (column) => `COALESCE(SUM(CASE WHEN ${volume} THEN ${column} ELSE 0 END), 0)`
  return `
    COUNT(*) AS requests,
    COALESCE(SUM(CASE WHEN r.status = 'ok' THEN 1 ELSE 0 END), 0) AS calls,
    COALESCE(SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END), 0) AS failedRequests,
    ${sum('r.input_tokens')} AS inputTokens,
    ${sum('r.output_tokens')} AS outputTokens,
    ${sum('r.cache_read_tokens')} AS cacheReadTokens,
    ${sum('r.cache_write_tokens')} AS cacheWriteTokens,
    ${sum('COALESCE(r.reasoning_tokens, 0)')} AS reasoningTokens,
    ${sum('r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens')} AS processingTokens,
    ${sum('r.input_tokens + r.output_tokens')} AS newComputeTokens,
    COALESCE(SUM(CASE WHEN r.estimated = 1 THEN r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens ELSE 0 END), 0) AS estimatedProcessingTokens,
    COALESCE(SUM(CASE WHEN ${volume} THEN COALESCE(r.original_usd_nano, 0) ELSE 0 END), 0) AS originalUsdNano,
    COALESCE(SUM(CASE WHEN ${volume} AND r.original_usd_nano IS NOT NULL THEN r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens ELSE 0 END), 0) AS pricedTokens,
    COALESCE(MAX(r.source_deleted), 0) AS sourceDeleted
  `
}

function measures(row = {}) {
  const processingTokens = Number(row.processingTokens ?? 0)
  const pricedTokens = Number(row.pricedTokens ?? 0)
  return {
    requests: Number(row.requests ?? 0),
    calls: Number(row.calls ?? 0),
    failedRequests: Number(row.failedRequests ?? 0),
    inputTokens: Number(row.inputTokens ?? 0),
    outputTokens: Number(row.outputTokens ?? 0),
    cacheReadTokens: Number(row.cacheReadTokens ?? 0),
    cacheWriteTokens: Number(row.cacheWriteTokens ?? 0),
    reasoningTokens: Number(row.reasoningTokens ?? 0),
    processingTokens,
    newComputeTokens: Number(row.newComputeTokens ?? 0),
    estimatedProcessingTokens: Number(row.estimatedProcessingTokens ?? 0),
    cost: {
      originalUsdNano: Number(row.originalUsdNano ?? 0),
      currentUsdNano: Number(row.currentUsdNano ?? row.originalUsdNano ?? 0),
      reportedUsageUsdNano: Number(row.reportedUsageUsdNano ?? row.currentUsdNano ?? row.originalUsdNano ?? 0),
      estimatedCacheReadTokens: Number(row.estimatedCacheReadTokens ?? 0),
      cacheEstimationMethod: row.cacheEstimationMethod ?? null,
      cacheEstimateRateBps: row.cacheEstimateRateBps == null ? null : Number(row.cacheEstimateRateBps),
      coverage: processingTokens > 0 ? pricedTokens / processingTokens : 1,
      pricedTokens,
      totalTokens: processingTokens,
    },
  }
}

function requestRow(row, catalog) {
  const billable = row.status === 'ok' || row.status === 'estimated'
  const current = billable ? valueUsage(catalog, {
    provider: row.provider,
    modelRaw: row.model_raw,
    usage: {
      input: row.cost_input_tokens ?? row.input_tokens,
      output: row.output_tokens,
      cacheRead: row.cost_cache_read_tokens ?? row.cache_read_tokens,
      cacheWrite: row.cache_write_tokens,
    },
  }) : null
  const reported = billable ? valueUsage(catalog, {
    provider: row.provider,
    modelRaw: row.model_raw,
    usage: { input: row.input_tokens, output: row.output_tokens, cacheRead: row.cache_read_tokens, cacheWrite: row.cache_write_tokens },
  }) : null
  return {
    id: `${row.session_id}:${row.turn}:${row.step}`,
    sessionId: row.session_id,
    turn: row.turn,
    step: row.step,
    time: row.time,
    project: row.project ?? 'unknown',
    projectLabel: row.project_label ?? row.project ?? 'unknown',
    provider: row.provider,
    connectionId: row.connection_id ?? null,
    model: row.model ?? row.model_raw,
    modelRaw: row.model_raw,
    status: row.status,
    estimated: row.estimated === 1,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    cacheReadState: row.cache_read_state ?? 'unknown',
    cacheWriteState: row.cache_write_state ?? 'unknown',
    reasoningTokens: row.reasoning_tokens,
    processingTokens: row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_write_tokens,
    newComputeTokens: row.input_tokens + row.output_tokens,
    originalProcessingTokens: (row.original_input_tokens ?? row.input_tokens) + (row.original_output_tokens ?? row.output_tokens) + (row.original_cache_read_tokens ?? row.cache_read_tokens) + (row.original_cache_write_tokens ?? row.cache_write_tokens),
    originalUsdNano: row.original_usd_nano,
    currentUsdNano: current?.usdNano ?? null,
    reportedUsageUsdNano: reported?.usdNano ?? null,
    estimatedCacheReadTokens: Number(row.estimated_cache_read_tokens ?? 0),
    cacheEstimationMethod: Number(row.estimated_cache_read_tokens ?? 0) > 0 ? OLLAMA_CACHE_ESTIMATION_METHOD : null,
    cacheEstimateRateBps: row.cache_estimate_rate_bps == null ? null : Number(row.cache_estimate_rate_bps),
    matchedPriceModel: current?.matchedModel ?? null,
    priceVersion: row.price_version,
    durationMs: row.duration_ms ?? null,
    endReason: row.end_reason ?? null,
    failureType: row.failure_type ?? null,
    excluded: row.excluded === 1,
    sourceDeleted: row.source_deleted === 1,
    correction: row.correction_id === null || row.correction_id === undefined ? null : {
      id: Number(row.correction_id),
      note: row.correction_note ?? null,
      createdAt: row.correction_created_at,
      isReset: row.correction_is_reset === 1,
    },
  }
}

/** Deep read module over the ledger database. */
export function createAnalytics({
  db,
  catalog,
  timezone: defaultTimezone = 'UTC',
  revision = () => 0,
  projectionRevision = () => 0,
  observationRevision = () => 0,
  ollamaCacheEstimateBps = DEFAULT_OLLAMA_CACHE_ESTIMATE_BPS,
} = {}) {
  let cacheEstimateBps = normalizeOllamaCacheEstimateBps(ollamaCacheEstimateBps)
  const queryCache = new Map()
  const baseCache = new Map()
  const seriesByCache = new Map()
  const poolsCache = new Map()
  const effectiveSelect = `
    WITH RECURSIVE session_cwd(session_id, cwd, title, deleted) AS (
      SELECT session_id, cwd, title, deleted FROM sources WHERE cwd IS NOT NULL
      UNION
      SELECT s.session_id, p.cwd, s.title, s.deleted FROM sources s JOIN session_cwd p ON s.parent_session = p.session_id WHERE s.cwd IS NULL
    )
    SELECT r.session_id, r.turn, r.step, r.seq, r.time, r.provider, r.model_raw, r.connection_id,
           sc.title AS session_title,
           COALESCE(a.canonical, r.model_raw) AS model,
           COALESCE(pool_rule.product_id, '${UNASSIGNED_POOL}') AS pool_id,
           pool_product.name AS pool_name,
           pool_product.color AS pool_color,
           COALESCE(ps.project_id, CASE WHEN sc.cwd IS NOT NULL THEN 'cwd:' || sc.cwd END, 'unknown') AS project,
           COALESCE(p.display_name, sc.cwd, 'unknown') AS project_label,
           COALESCE(sc.deleted, 0) AS source_deleted,
           r.owned,
           COALESCE(c.input_tokens, r.input_tokens) AS input_tokens,
           COALESCE(c.output_tokens, r.output_tokens) AS output_tokens,
           COALESCE(c.cache_read_tokens, r.cache_read_tokens) AS cache_read_tokens,
           COALESCE(c.cache_write_tokens, r.cache_write_tokens) AS cache_write_tokens,
           CASE WHEN c.cache_read_tokens IS NOT NULL THEN 'reported' ELSE r.cache_read_state END AS cache_read_state,
           CASE WHEN c.cache_write_tokens IS NOT NULL THEN 'reported' ELSE r.cache_write_state END AS cache_write_state,
           COALESCE(c.reasoning_tokens, r.reasoning_tokens) AS reasoning_tokens,
           r.status, r.estimated, r.estimator, r.estimator_version,
           r.original_usd_nano, r.price_version, r.duration_ms, r.end_reason, r.failure_type,
           r.input_tokens AS original_input_tokens,
           r.output_tokens AS original_output_tokens,
           r.cache_read_tokens AS original_cache_read_tokens,
           r.cache_write_tokens AS original_cache_write_tokens,
           r.reasoning_tokens AS original_reasoning_tokens,
           c.id AS correction_id, COALESCE(c.excluded, 0) AS excluded,
           c.note AS correction_note, c.created_at AS correction_created_at,
           CASE WHEN c.id IS NOT NULL AND c.input_tokens IS NULL AND c.output_tokens IS NULL
             AND c.cache_read_tokens IS NULL AND c.cache_write_tokens IS NULL
             AND c.reasoning_tokens IS NULL AND c.excluded = 0 THEN 1 ELSE 0 END AS correction_is_reset
    FROM main.requests r
    LEFT JOIN session_cwd sc ON sc.session_id = r.session_id
    LEFT JOIN main.project_sources ps ON ps.cwd = sc.cwd
    LEFT JOIN main.projects p ON p.id = ps.project_id
    LEFT JOIN main.aliases a ON a.model_raw = r.model_raw
    LEFT JOIN temp.dsh_pool_rules pool_rule ON pool_rule.connection_key = COALESCE(r.connection_id, '')
      AND pool_rule.provider = r.provider AND pool_rule.model = COALESCE(a.canonical, r.model_raw)
    LEFT JOIN main.account_products pool_product ON pool_product.id = pool_rule.product_id
    LEFT JOIN main.request_corrections c ON c.id = (
      SELECT rc.id FROM main.request_corrections rc
      WHERE rc.session_id = r.session_id AND rc.turn = r.turn AND rc.step = r.step AND rc.active = 1
      ORDER BY rc.id DESC LIMIT 1
    )
  `
  if (typeof db.function === 'function') {
    const hourFormats = new Map()
    db.function('dsh_local_day', { deterministic: true }, (time, timezone) => localDate(Number(time), String(timezone)))
    db.function('dsh_local_weekday', { deterministic: true }, (time, timezone) => new Date(`${localDate(Number(time), String(timezone))}T00:00:00Z`).getUTCDay())
    db.function('dsh_local_hour', { deterministic: true }, (time, timezone) => {
      const zone = String(timezone)
      let format = hourFormats.get(zone)
      if (format === undefined) {
        format = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' })
        hourFormats.set(zone, format)
      }
      return Number(format.format(new Date(Number(time))))
    })
    db.function('dsh_ollama_cache_read', { deterministic: true }, (
      provider, status, cacheReadState, inputTokens, cacheReadTokens, cacheWriteTokens, rateBps,
    ) => estimateOllamaCloudCacheRead({
      provider, status, cacheReadState, inputTokens: Number(inputTokens),
      cacheReadTokens: Number(cacheReadTokens), cacheWriteTokens: Number(cacheWriteTokens),
    }, { rateBps: Number(rateBps) }))
  }

  // The effective projection is rebuilt only when the *projection* revision
  // moves — i.e. when a write changed the rows this table joins together
  // (request facts, source/project/alias mapping, attribution products and
  // rules, the cache-estimate rate). Read-side facts such as observations,
  // budgets, prices and multipliers bump the combined revision (invalidating
  // result caches) without paying for a rebuild.
  let effectiveProjection = null
  let effectiveRebuilds = 0
  let baseViewComputations = 0
  function ensureEffectiveRequests() {
    const currentProjection = projectionRevision()
    if (effectiveProjection === currentProjection) return
    // Attribution rules are few; resolve them once per distinct connection,
    // provider and model tuple in JS and join through a tiny temp table instead
    // of running a correlated glob subquery per request row.
    db.exec('DROP TABLE IF EXISTS temp.dsh_pool_rules')
    db.exec('CREATE TEMP TABLE dsh_pool_rules (connection_key TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, product_id TEXT NOT NULL)')
    // Exact connection rules precede provider/model fallbacks. Historical rows
    // without provenance can only use unscoped rules.
    const rules = db.prepare(`
      SELECT ar.connection_id AS connectionId, ar.match_provider AS matchProvider,
             ar.match_model AS matchModel, ar.product_id AS productId
      FROM account_attribution_rules ar
      JOIN account_products ap ON ap.id = ar.product_id AND ap.archived_at IS NULL
      ORDER BY ar.priority, ar.id
    `).all()
    if (rules.length > 0) {
      const canonicalOf = new Map(db.prepare('SELECT model_raw, canonical FROM aliases').all().map((row) => [row.model_raw, row.canonical]))
      const pairs = db.prepare("SELECT DISTINCT COALESCE(connection_id, '') AS connectionKey, provider, model_raw FROM requests").all()
      const insert = db.prepare('INSERT INTO dsh_pool_rules (connection_key, provider, model, product_id) VALUES (?, ?, ?, ?)')
      transaction(db, () => {
        for (const pair of pairs) {
          const model = canonicalOf.get(pair.model_raw) ?? pair.model_raw
          const exact = pair.connectionKey === '' ? [] : rules.filter((rule) => rule.connectionId === pair.connectionKey)
          const candidates = [...exact, ...rules.filter((rule) => rule.connectionId == null)]
          for (const rule of candidates) {
            const providerOk = rule.matchProvider == null || rule.matchProvider === '' || globMatch(rule.matchProvider, pair.provider ?? '')
            const modelOk = rule.matchModel == null || rule.matchModel === '' || globMatch(rule.matchModel, model ?? '')
            if (providerOk && modelOk) { insert.run(pair.connectionKey, pair.provider ?? '', model ?? '', rule.productId); break }
          }
        }
      })
    }
    db.exec('DROP TABLE IF EXISTS temp.dsh_effective_requests')
    db.exec('DROP TABLE IF EXISTS temp.dsh_effective_requests_base')
    db.exec(`CREATE TEMP TABLE dsh_effective_requests_base AS ${effectiveSelect}`)
    db.exec(`
      CREATE TEMP TABLE dsh_effective_requests AS
      WITH estimated AS (
        SELECT b.*,
          dsh_ollama_cache_read(
            provider, status, cache_read_state, input_tokens, cache_read_tokens, cache_write_tokens, ${cacheEstimateBps}
          ) AS estimated_cache_read_tokens
        FROM dsh_effective_requests_base b
      )
      SELECT estimated.*,
        input_tokens - estimated_cache_read_tokens AS cost_input_tokens,
        cache_read_tokens + estimated_cache_read_tokens AS cost_cache_read_tokens,
        CASE WHEN estimated_cache_read_tokens > 0 THEN ${cacheEstimateBps} ELSE NULL END AS cache_estimate_rate_bps
      FROM estimated;
      DROP TABLE dsh_effective_requests_base;
      CREATE INDEX dsh_effective_time ON dsh_effective_requests(time, session_id, turn, step);
      CREATE INDEX dsh_effective_session ON dsh_effective_requests(session_id, time);
      CREATE INDEX dsh_effective_model ON dsh_effective_requests(model, provider, time);
      CREATE INDEX dsh_effective_project ON dsh_effective_requests(project, time);
      CREATE INDEX dsh_effective_pool ON dsh_effective_requests(pool_id, time);
    `)
    effectiveProjection = currentProjection
    effectiveRebuilds += 1
  }

  /** Rebuild counters for tests and benchmarks; never part of the wire API. */
  function diagnostics() {
    return { effectiveRebuilds, baseViewComputations }
  }

  function applyPriceFilter(compiled, filter) {
    const values = filter.price ?? []
    if (values.length === 0 || (values.includes('known') && values.includes('unknown'))) return
    const wantKnown = values.includes('known')
    const wantUnknown = values.includes('unknown')
    const pairs = db.prepare('SELECT DISTINCT provider, model_raw FROM requests').all().filter((row) => {
      const known = catalog.priceFor(row.model_raw, row.provider) !== null
      return (known && wantKnown) || (!known && wantUnknown)
    })
    if (pairs.length === 0) { compiled.clauses.push('1 = 0'); return }
    compiled.clauses.push(`(${pairs.map(() => '(r.provider = ? AND r.model_raw = ?)').join(' OR ')})`)
    for (const pair of pairs) compiled.params.push(pair.provider, pair.model_raw)
  }

  function costRows(compiled, includeEstimates, groupExpression = null, groupParams = []) {
    const volume = includeEstimates ? '1' : 'r.estimated = 0'
    const grouped = groupExpression === null ? '' : `${groupExpression} AS groupKey,`
    const groupBy = groupExpression === null ? '' : 'groupKey,'
    return db.prepare(`${PROJECT_CTE}
      SELECT ${grouped} r.provider, r.model_raw,
             SUM(CASE WHEN ${volume} THEN r.input_tokens ELSE 0 END) AS reportedInputTokens,
             SUM(CASE WHEN ${volume} THEN r.cost_input_tokens ELSE 0 END) AS costInputTokens,
             SUM(CASE WHEN ${volume} THEN r.output_tokens ELSE 0 END) AS outputTokens,
             SUM(CASE WHEN ${volume} THEN r.cache_read_tokens ELSE 0 END) AS reportedCacheReadTokens,
             SUM(CASE WHEN ${volume} THEN r.cost_cache_read_tokens ELSE 0 END) AS costCacheReadTokens,
             SUM(CASE WHEN ${volume} THEN r.cache_write_tokens ELSE 0 END) AS cacheWriteTokens,
             SUM(CASE WHEN ${volume} THEN r.estimated_cache_read_tokens ELSE 0 END) AS estimatedCacheReadTokens
      FROM dsh_effective_requests r
      WHERE ${compiled.clauses.join(' AND ')}
      GROUP BY ${groupBy} r.provider, r.model_raw
    `).all(...groupParams, ...compiled.params)
  }

  function addCost(group, row) {
    const processing = Number(row.reportedInputTokens) + Number(row.outputTokens) + Number(row.reportedCacheReadTokens) + Number(row.cacheWriteTokens)
    group.totalTokens += processing
    group.estimatedCacheReadTokens += Number(row.estimatedCacheReadTokens)
    const valuation = valueUsage(catalog, {
      provider: row.provider,
      modelRaw: row.model_raw,
      usage: { input: row.costInputTokens, output: row.outputTokens, cacheRead: row.costCacheReadTokens, cacheWrite: row.cacheWriteTokens },
    })
    const reported = valueUsage(catalog, {
      provider: row.provider,
      modelRaw: row.model_raw,
      usage: { input: row.reportedInputTokens, output: row.outputTokens, cacheRead: row.reportedCacheReadTokens, cacheWrite: row.cacheWriteTokens },
    })
    if (valuation !== null) {
      group.currentUsdNano += valuation.usdNano
      group.pricedTokens += processing
    }
    if (reported !== null) group.reportedUsageUsdNano += reported.usdNano
    group.coverage = group.totalTokens > 0 ? group.pricedTokens / group.totalTokens : 1
    group.cacheEstimationMethod = group.estimatedCacheReadTokens > 0 ? OLLAMA_CACHE_ESTIMATION_METHOD : null
    group.cacheEstimateRateBps = group.estimatedCacheReadTokens > 0 ? cacheEstimateBps : null
    return group
  }

  function emptyCost() {
    return {
      currentUsdNano: 0,
      reportedUsageUsdNano: 0,
      estimatedCacheReadTokens: 0,
      cacheEstimationMethod: null,
      cacheEstimateRateBps: null,
      pricedTokens: 0,
      totalTokens: 0,
      coverage: 1,
    }
  }

  function currentCost(compiled, includeEstimates) {
    const result = emptyCost()
    for (const row of costRows(compiled, includeEstimates)) addCost(result, row)
    return result
  }

  function currentCostBy(compiled, includeEstimates, groupExpression, groupParams = []) {
    const groups = new Map()
    for (const row of costRows(compiled, includeEstimates, groupExpression, groupParams)) {
      const key = String(row.groupKey ?? 'unknown')
      groups.set(key, addCost(groups.get(key) ?? emptyCost(), row))
    }
    return groups
  }

  /**
   * The single account list: account_products with their latest billing row,
   * declared quota limits and connection link. Legacy v5 plans arrive through
   * the lossless projection as source_kind 'legacy_v5_manual' products.
   */
  function listAccountProducts() {
    const products = db.prepare(`
      SELECT ap.id, ap.provider_id AS providerId, ap.external_id AS externalId,
             ap.name, ap.color, ap.source_kind AS sourceKind,
             ap.connection_id AS connectionId, ap.archived_at AS archivedAt, ap.created_at AS createdAt
      FROM account_products ap
      WHERE ap.archived_at IS NULL
      ORDER BY ap.created_at, ap.id
    `).all()
    const billing = db.prepare(`
      SELECT product_id AS productId, kind, currency, amount_nano AS amountNano,
             cycle_anchor_day AS cycleAnchorDay, balance_nano AS balanceNano,
             expires_at AS expiresAt, source_kind AS sourceKind, observed_at AS observedAt
      FROM account_billing
      WHERE observed_at = (SELECT MAX(b2.observed_at) FROM account_billing b2 WHERE b2.product_id = account_billing.product_id)
    `).all()
    const billingByProduct = new Map(billing.map((row) => [row.productId, row]))
    const limits = db.prepare(`
      SELECT product_id AS productId, external_key AS externalKey, metric, unit,
             value_mode AS valueMode, exact_value AS exactValue, minimum_value AS minimumValue,
             maximum_value AS maximumValue, window_kind AS windowKind, window_seconds AS windowSeconds,
             window_json AS windowJson, reset_at AS resetAt, source_kind AS sourceKind, confidence, created_at AS createdAt
      FROM account_limits
      WHERE metric = 'quota'
      ORDER BY created_at, id
    `).all()
    const limitsByProduct = new Map()
    for (const limit of limits) {
      if (limit.productId == null) continue
      // The optional calendar anchor rides the existing window_json column.
      let anchor = null
      if (limit.windowJson != null) {
        try {
          const parsed = JSON.parse(limit.windowJson)
          anchor = normalizeAnchor(parsed?.anchor ?? parsed)
        } catch {
          anchor = null
        }
      }
      const rows = limitsByProduct.get(limit.productId) ?? []
      const { windowJson, ...cleanLimit } = limit
      // Optional anchor: only declared anchors appear on the row.
      rows.push({
        ...cleanLimit,
        ...(anchor !== null ? { anchor } : {}),
        exactValue: limit.exactValue == null ? null : Number(limit.exactValue),
        resetsAt: limit.resetAt == null ? null : Number(limit.resetAt),
      })
      limitsByProduct.set(limit.productId, rows)
    }
    return products.map((product) => {
      const billingRow = billingByProduct.get(product.id) ?? null
      const kind = billingRow?.kind === 'subscription' || billingRow?.kind === 'prepaid'
        ? billingRow.kind
        : 'track_only'
      return {
        ...product,
        kind,
        billing: billingRow === null ? null : {
          kind: billingRow.kind,
          currency: billingRow.currency ?? 'USD',
          priceUsd: billingRow.amountNano == null ? null : Number(billingRow.amountNano) / 1e9,
          resetDay: billingRow.cycleAnchorDay,
          balanceUsd: billingRow.balanceNano == null ? null : Number(billingRow.balanceNano) / 1e9,
          expiryMs: billingRow.expiresAt,
          sourceKind: billingRow.sourceKind,
        },
        limits: limitsByProduct.get(product.id) ?? [],
      }
    })
  }

  /**
   * Latest official observation per connection, parsed from the secret-free
   * payload. Percent-based windows only: the ledger never converts official
   * percentages into token guesses. A provider-reported null percent means
   * unknown (never 0) and the window stays visible with a null value.
   */
  function latestObservationsByConnection() {
    // The `usable` column (materialized at write and migration time) marks
    // payloads that carry at least one limit, so the join picks only the
    // newest such row per connection — an API-key reachability probe cannot
    // hide a previous settings-page scrape. Same-millisecond ties: the
    // lowest id wins, later tie rows are skipped in the loop below.
    const rows = db.prepare(`
      SELECT o.connection_id AS connectionId, o.payload_json AS payload
      FROM account_observations o
      JOIN (
        SELECT connection_id, MAX(observed_at) AS latest
        FROM account_observations
        WHERE connection_id IS NOT NULL AND usable = 1
        GROUP BY connection_id
      ) m ON m.connection_id = o.connection_id AND m.latest = o.observed_at
      WHERE o.usable = 1
      ORDER BY o.connection_id, o.id
    `).all()
    const byConnection = new Map()
    for (const row of rows) {
      const connectionId = String(row.connectionId)
      if (byConnection.has(connectionId)) continue
      try {
        const payload = JSON.parse(row.payload)
        const windowsById = new Map((payload.windows ?? []).map((window) => [window.id, window]))
        const windows = (payload.limits ?? []).map((limit) => {
          const window = windowsById.get(limit.windowId) ?? limit.window ?? {}
          const percentUsed = parsePercent(limit.percentUsed)
          return {
            id: limit.id ?? limit.windowId ?? window.id ?? null,
            label: window.label ?? limit.metric ?? null,
            externalKey: limit.externalKey ?? null,
            percentUsed: percentUsed === null ? null : Math.max(0, Math.min(100, percentUsed)),
            resetsAt: window.resetsAt ?? limit.resetsAt ?? null,
            durationMs: window.durationMs ?? null,
            observedAt: limit.observedAt ?? payload.observedAt ?? null,
          }
        })
        if (windows.length === 0) continue
        byConnection.set(connectionId, {
          observedAt: payload.observedAt ?? null,
          sourceKind: payload.source ?? payload.sourceKind ?? 'official',
          brittle: payload.brittle === true,
          windows,
        })
      } catch {
        // A malformed stored payload must never break pool summaries.
      }
    }
    return byConnection
  }

  function observationForConnection(observations, connectionId) {
    if (connectionId == null) return null
    const id = String(connectionId)
    return observations.get(id)
      ?? (id.endsWith(':default') ? observations.get(id.slice(0, -':default'.length)) : observations.get(`${id}:default`))
      ?? null
  }

  /**
   * Stamp every official window with its observation age and reset state.
   * A window whose reset instant has passed without a fresh observation is
   * expired: the old percentage must not keep showing (and must not fake 0),
   * so its percent becomes null. Merely old observations stay `stale` with
   * their value intact — the client labels the age.
   */
  function decorateOfficialWindows(official, now) {
    if (official === null) return null
    const windows = (official.windows ?? []).map((window) => {
      const observedAt = window.observedAt == null ? null : Number(window.observedAt)
      const resetsAt = window.resetsAt == null ? null : Number(window.resetsAt)
      const ageMs = observedAt === null ? null : Math.max(0, now - observedAt)
      const expired = resetsAt !== null && resetsAt <= now
      return {
        ...window,
        observedAt,
        ageMs,
        stale: ageMs !== null && ageMs > OFFICIAL_OBSERVATION_STALE_MS,
        expired,
        expiredSince: expired ? resetsAt : null,
        percentUsed: expired ? null : window.percentUsed,
      }
    })
    return { ...official, windows }
  }

  /** KPIs per pool_id over a window: one grouped scan, not one query per pool. */
  function poolMeasuresByPool(window, includeEstimates) {
    const compiled = compileFilter({}, window)
    const rows = db.prepare(`${PROJECT_CTE}
      SELECT r.pool_id AS pool, ${aggregateColumns(includeEstimates)}
      FROM dsh_effective_requests r
      WHERE ${compiled.clauses.join(' AND ')}
      GROUP BY r.pool_id
    `).all(...compiled.params)
    return new Map(rows.map((row) => [String(row.pool), measures(row)]))
  }

  /** Current-cost valuation per pool_id over a window: same seam as all other totals. */
  function poolCostByPool(window, includeEstimates) {
    return currentCostBy(compileFilter({}, window), includeEstimates, 'r.pool_id')
  }

  /**
   * Objective billing-pool summaries for the current cycle: per-pool usage
   * against its quota, rolling-rate extrapolation (pure arithmetic, clearly
   * labeled as such by callers), credit runway to expiry, the unassigned
   * bucket, and the tightest subscription pool. No thresholds, no advice.
   * Pool summaries ignore dimension filters by design (they describe whole
   * billing pools), so they are cached by revision and a coarse clock.
   */
  function computePools(now, timezone, includeEstimates) {
    const cacheKey = JSON.stringify({ revision: revision(), clock: Math.floor(now / CLOCK_BUCKET_MS), timezone, includeEstimates })
    const hit = poolsCache.get(cacheKey)
    if (hit !== undefined) return hit
    const value = computePoolsUncached(now, timezone, includeEstimates)
    if (poolsCache.size > 64) poolsCache.clear()
    poolsCache.set(cacheKey, value)
    return value
  }

  function computePoolsUncached(now, timezone, includeEstimates) {
    const products = listAccountProducts()
    // Two coexisting cycle notions: the calendar month (also exposed under
    // the legacy `month` name) and the trailing rolling 30 days. Per-pool
    // billing cycles additionally follow each product's own reset day.
    const month = billingCycle(now, 1, timezone)
    const last30 = { fromMs: now - 30 * DAY, toMs: now }
    const last7 = { fromMs: now - 7 * DAY, toMs: now }
    const scans = new Map()
    const scan = (key, window) => {
      if (scans.has(key)) return
      scans.set(key, {
        measures: poolMeasuresByPool(window, includeEstimates),
        costs: poolCostByPool(window, includeEstimates),
        window,
      })
    }
    scan('30d', last30)
    const pack = (scanKey, productId) => {
      const bucket = scans.get(scanKey)
      if (!bucket) return { ...measures({}), cost: measures({}).cost }
      return { ...(bucket.measures.get(productId) ?? measures({})), cost: { ...measures({}).cost, ...(bucket.costs.get(productId) ?? {}) } }
    }
    // The unassigned bucket exists whenever unattributed traffic exists, even
    // with zero accounts — it is the onboarding evidence, not a pool extra.
    const unassignedPacked = pack('30d', UNASSIGNED_POOL)
    const unassigned = unassignedPacked.requests > 0 ? unassignedPacked : null
    if (products.length === 0) {
      return {
        configured: false,
        month,
        calendarMonth: month,
        rolling30d: { fromMs: last30.fromMs, toMs: last30.toMs },
        pools: [],
        unassigned,
        tightestPoolId: null,
      }
    }
    scan('7d', last7)
    for (const product of products) {
      for (const limit of product.limits) {
        const window = quotaWindow(limit, product.billing?.resetDay, now, timezone)
        if (window) scan(window.key, window)
      }
    }
    const observations = latestObservationsByConnection()
    const pools = products.map((product) => {
      const official = decorateOfficialWindows(observationForConnection(observations, product.connectionId), now)
      const cycle = billingCycle(now, product.billing?.resetDay ?? 1, timezone)
      const quotaWindows = []
      let primaryPace = null
      for (const limit of product.limits) {
        const window = quotaWindow(limit, product.billing?.resetDay, now, timezone)
        const computable = COMPUTABLE_UNITS.has(String(limit.unit)) && Number.isFinite(limit.exactValue) && limit.exactValue > 0
          && (limit.valueMode === 'exact' || limit.valueMode === 'manual')
        if (!window || !computable) {
          quotaWindows.push({
            externalKey: limit.externalKey,
            unit: limit.unit,
            valueMode: limit.valueMode,
            value: limit.exactValue,
            windowKind: limit.windowKind,
            windowSeconds: limit.windowSeconds,
            usedPct: null,
          })
          continue
        }
        const kpis = pack(window.key, product.id)
        const used = usedAmount(kpis, limit.unit)
        const rate = usedAmount(pack('7d', product.id), limit.unit) / 7
        const usedPct = (used / limit.exactValue) * 100
        const remaining = Math.max(0, limit.exactValue - used)
        const daysToCap = rate > 0 && window.daysLeft != null && remaining / rate < window.daysLeft ? remaining / rate : null
        const leftoverAtReset = window.key.startsWith('billing:') && window.daysLeft != null
          ? Math.max(0, limit.exactValue - (used + rate * window.daysLeft))
          : null
        const pace = { unit: limit.unit, ratePerDay: rate, daysToCap, leftoverAtReset, windowKind: limit.windowKind }
        if (primaryPace === null) primaryPace = pace
        quotaWindows.push({
          externalKey: limit.externalKey,
          unit: limit.unit,
          valueMode: limit.valueMode,
          value: limit.exactValue,
          windowKind: limit.windowKind,
          windowSeconds: limit.windowSeconds,
          used,
          usedPct,
          daysToCap,
          leftoverAtReset,
        })
      }
      const localPct = quotaWindows.reduce((best, entry) => (entry.usedPct == null ? best : Math.max(best ?? 0, entry.usedPct)), null)
      // Unknown (null) official percentages never contribute to the merge —
      // they must not drag a measured pool down to a fake 0%.
      const officialPct = official === null
        ? null
        : official.windows.reduce((best, window) => (window.percentUsed == null ? best : Math.max(best ?? 0, window.percentUsed)), null)
      const mergedPct = localPct === null && officialPct === null ? null : Math.max(localPct ?? 0, officialPct ?? 0)
      const kpis30 = pack('30d', product.id)
      if (product.kind === 'prepaid') {
        const burnUsd = kpis30.cost.currentUsdNano / 1e9
        const burnPerDay = burnUsd / 30
        const expiryMs = product.billing?.expiryMs ?? null
        const daysLeft = expiryMs === null ? null : Math.max(0, Math.ceil((expiryMs - now) / DAY))
        const balanceUsd = product.billing?.balanceUsd ?? null
        const burnToExpiry = daysLeft === null || balanceUsd === null ? null : burnPerDay * daysLeft
        return {
          ...product,
          cycle: last30,
          cycleKind: 'rolling30d',
          billingCycle: cycle,
          kpis: kpis30,
          burnUsd,
          burnPerDayUsd: burnPerDay,
          daysLeft,
          balanceUsd,
          burnToExpiryUsd: burnToExpiry,
          pctBurnToExpiry: burnToExpiry !== null && balanceUsd > 0 ? Math.min(100, (burnToExpiry / balanceUsd) * 100) : null,
          leftoverAtExpiryUsd: burnToExpiry === null || balanceUsd === null ? null : Math.max(0, balanceUsd - burnToExpiry),
          quotaWindows,
          official,
          usedPct: mergedPct,
          localUsedPct: localPct,
          officialUsedPct: officialPct,
          pace: null,
        }
      }
      const primaryWindow = quotaWindows.find((entry) => entry.usedPct != null) ?? null
      return {
        ...product,
        cycle: last30,
        cycleKind: 'rolling30d',
        billingCycle: cycle,
        kpis: kpis30,
        quotaWindows,
        official,
        usedPct: mergedPct,
        localUsedPct: localPct,
        officialUsedPct: officialPct,
        pace: primaryPace,
        primaryExternalKey: primaryWindow?.externalKey ?? null,
      }
    })
    const measurable = pools.filter((pool) => pool.usedPct !== null)
    const tightest = measurable.reduce((best, pool) => (best === null || pool.usedPct > best.usedPct ? pool : best), null)
    return {
      configured: true,
      month,
      calendarMonth: month,
      rolling30d: { fromMs: last30.fromMs, toMs: last30.toMs },
      pools,
      unassigned,
      tightestPoolId: tightest === null ? null : tightest.id,
    }
  }

  /** The quota window a sidebar meter renders for one pool: the fullest
   * official window when it leads, else the top local quota window. The
   * same selection the tightest account uses, so every account reads the
   * same way. Returns null when nothing is measurable. */
  function poolWindow(pool) {
    if (pool == null) return null
    const windows = pool.official == null ? [] : (pool.official.windows ?? [])
    // Prefer the fullest measurable window; fall back to any official window
    // (e.g. when the only one is expired) so the client can still label its
    // observation state instead of losing the row entirely.
    const measurable = windows.filter((window) => window.percentUsed != null)
    const officialWindow = measurable.length > 0
      ? measurable.reduce((best, window) => (window.percentUsed > best.percentUsed ? window : best))
      : (windows[0] ?? null)
    const leads = officialWindow !== null
      && (officialWindow.percentUsed == null
        ? pool.localUsedPct == null
        : (pool.localUsedPct == null || officialWindow.percentUsed >= pool.localUsedPct))
    if (leads) {
      return {
        label: officialWindow.label ?? officialWindow.externalKey ?? null,
        resetsAt: officialWindow.resetsAt ?? null,
        usedPct: pool.usedPct,
        sourceKind: pool.official.sourceKind,
        observedAt: officialWindow.observedAt ?? null,
        ageMs: officialWindow.ageMs ?? null,
        brittle: pool.official.brittle === true,
        stale: officialWindow.stale === true,
        expired: officialWindow.expired === true,
      }
    }
    const localWindow = (pool.quotaWindows ?? []).find((entry) => entry.usedPct != null && entry.usedPct === pool.localUsedPct) ?? null
    if (localWindow == null) return null
    return {
      label: localWindow.externalKey ?? null,
      resetsAt: null,
      usedPct: pool.usedPct,
      sourceKind: 'local_ledger',
      observedAt: null,
      ageMs: null,
      brittle: false,
      stale: false,
      expired: false,
    }
  }

  /** Sidebar-entry micro summary: watched-or-tightest window plus month
   * progress, minimal payload. Pools carry their own primary window so
   * the entry can render any pinned account, not just the tightest. */
  function entrySummary({ now = Date.now(), timezone = defaultTimezone } = {}) {
    ensureEffectiveRequests()
    const pools = computePools(now, timezone, false)
    const tightest = pools.pools.find((pool) => pool.id === pools.tightestPoolId) ?? null
    const tightestWindow = poolWindow(tightest)
    return {
      configured: pools.configured,
      month: { elapsedPct: Math.round(pools.month.elapsedPct * 10) / 10, daysLeft: pools.month.daysLeft, resetLabel: pools.month.resetLabel },
      monthKind: 'calendar',
      tightest: tightest === null ? null : {
        id: tightest.id,
        name: tightest.name,
        color: tightest.color,
        usedPct: Math.round(tightest.usedPct * 10) / 10,
        sourceKind: tightestWindow?.sourceKind ?? 'local_ledger',
        windowLabel: tightestWindow?.label ?? null,
        resetsAt: tightestWindow?.resetsAt ?? null,
        observedAt: tightestWindow?.observedAt ?? null,
        ageMs: tightestWindow?.ageMs ?? null,
        brittle: tightestWindow?.brittle ?? false,
        stale: tightestWindow?.stale ?? false,
        expired: tightestWindow?.expired ?? false,
      },
      pools: pools.pools.map((pool) => {
        const window = poolWindow(pool)
        return {
          id: pool.id,
          name: pool.name,
          color: pool.color,
          kind: pool.kind,
          usedPct: pool.usedPct == null ? null : Math.round(pool.usedPct * 10) / 10,
          window: window == null ? null : {
            label: window.label,
            resetsAt: window.resetsAt,
            usedPct: window.usedPct == null ? null : Math.round(window.usedPct * 10) / 10,
            sourceKind: window.sourceKind,
            observedAt: window.observedAt,
            ageMs: window.ageMs,
            brittle: window.brittle,
            stale: window.stale,
            expired: window.expired,
          },
        }
      }),
    }
  }

  /**
   * Every view that never reads provider observations: kpis, series,
   * seriesBy, rankings, activity, page, insights, budgets (pools is handled
   * separately by the caller). Cached by the combined revision minus its
   * observation component, a coarse clock, the spec and the filter — saving
   * an observation moves both counters equally, so the difference (and the
   * cached base) is untouched while pools recompute.
   */
  function computeBaseViews(spec, views, filter, window, now, timezone, revisionValue) {
    baseViewComputations += 1
    const includeEstimates = filter.honesty === 'includingEstimates' || filter.honesty === 'all'
    const compiled = compileFilter(filter, window)
    applyPriceFilter(compiled, filter)
    const result = {
      filter,
      asOf: { revision: revisionValue, generatedAtMs: now, timezone },
      window,
      partial: { purgedDays: false, unknownPrices: false, sourceDeleted: false, estimatesIncluded: includeEstimates },
      degraded: {},
    }
    const purgedInWindow = db.prepare('SELECT day, requests, processing_tokens AS processingTokens FROM purged_daily ORDER BY day').all().filter((row) => {
      const bounds = localDayBounds(row.day, timezone)
      return (window.fromMs === null || bounds.end > window.fromMs) && (window.toMs === null || bounds.start < window.toMs)
    })
    const dimensionFiltered = ['project', 'session', 'model', 'modelRaw', 'provider', 'status', 'price'].some((dimension) => (filter[dimension]?.length ?? 0) > 0)
    if (purgedInWindow.length) {
      result.partial.purgedDays = true
      result.partial.dimensionBreakdown = true
      result.partial.tokenComposition = true
      result.partial.cost = true
    }

    if (views.has('kpis')) {
      const row = db.prepare(`${PROJECT_CTE}
        SELECT ${aggregateColumns(includeEstimates)}
        FROM dsh_effective_requests r
        WHERE ${compiled.clauses.join(' AND ')}
      `).get(...compiled.params)
      result.partial.sourceDeleted = Number(row.sourceDeleted ?? 0) === 1
      const kpis = measures(row)
      kpis.cost = { ...kpis.cost, ...currentCost(compiled, includeEstimates) }
      result.partial.unknownPrices = kpis.cost.coverage < 1
      if (!dimensionFiltered) {
        for (const purged of purgedInWindow) {
          kpis.requests += Number(purged.requests)
          kpis.processingTokens += Number(purged.processingTokens)
        }
      }
      Object.assign(result, { kpis })
    } else {
      // Without the kpis view, a cheap existence probe answers the same
      // question: is there a non-estimated row the price catalog never valued?
      const volumeClause = includeEstimates ? '' : ' AND r.estimated = 0'
      result.partial.unknownPrices = db.prepare(`
        SELECT 1 FROM dsh_effective_requests r
        WHERE ${compiled.clauses.join(' AND ')}${volumeClause} AND r.original_usd_nano IS NULL
        LIMIT 1
      `).get(...compiled.params) !== undefined
    }

    if (views.has('series')) {
      const requested = spec.series?.granularity ?? 'auto'
      const days = window.fromMs === null || window.toMs === null ? 365 : Math.ceil((window.toMs - window.fromMs) / DAY)
      let granularity = requested === 'auto' ? (days > 90 ? 'month' : days > 45 ? 'week' : 'day') : requested
      if (!['day', 'week', 'month'].includes(granularity)) throw new TypeError(`unsupported series granularity: ${granularity}`)
      const rows = db.prepare(`${PROJECT_CTE}
        SELECT dsh_local_day(r.time, ?) AS bucket, ${aggregateColumns(includeEstimates)}
        FROM dsh_effective_requests r
        WHERE ${compiled.clauses.join(' AND ')}
        GROUP BY bucket ORDER BY bucket
      `).all(timezone, ...compiled.params)
      if (!dimensionFiltered) {
        for (const purged of purgedInWindow) rows.push({ bucket: purged.day, requests: Number(purged.requests), processingTokens: Number(purged.processingTokens) })
        rows.sort((left, right) => String(left.bucket).localeCompare(String(right.bucket)))
      }
      if (requested === 'auto' && granularity === 'month' && new Set(rows.map((row) => String(row.bucket).slice(0, 7))).size > 48) granularity = 'year'
      const dailyCosts = currentCostBy(compiled, includeEstimates, 'dsh_local_day(r.time, ?)', [timezone])
      for (const row of rows) {
        const cost = dailyCosts.get(String(row.bucket))
        row.currentUsdNano = cost?.currentUsdNano ?? 0
        row.currentPricedTokens = cost?.pricedTokens ?? 0
        row.currentTotalTokens = cost?.totalTokens ?? 0
      }
      const keyFor = (day) => {
        if (granularity === 'year') return day.slice(0, 4)
        if (granularity === 'month') return day.slice(0, 7)
        if (granularity === 'week') {
          const date = new Date(`${day}T00:00:00Z`)
          const weekday = (date.getUTCDay() + 6) % 7
          date.setUTCDate(date.getUTCDate() - weekday)
          return date.toISOString().slice(0, 10)
        }
        return day
      }
      const collapsed = new Map()
      for (const row of rows) {
        const key = keyFor(row.bucket)
        let aggregate = collapsed.get(key)
        if (aggregate === undefined) { aggregate = { bucket: key }; collapsed.set(key, aggregate) }
        for (const field of ['requests', 'calls', 'failedRequests', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'processingTokens', 'newComputeTokens', 'estimatedProcessingTokens', 'originalUsdNano', 'pricedTokens', 'currentUsdNano', 'currentPricedTokens', 'currentTotalTokens']) {
          aggregate[field] = Number(aggregate[field] ?? 0) + Number(row[field] ?? 0)
        }
      }
      result.series = {
        granularity,
        buckets: [...collapsed.values()].map((row) => {
          const value = measures(row)
          value.cost = { ...value.cost, currentUsdNano: row.currentUsdNano, pricedTokens: row.currentPricedTokens, totalTokens: row.currentTotalTokens, coverage: row.currentTotalTokens > 0 ? row.currentPricedTokens / row.currentTotalTokens : 1 }
          return { key: row.bucket, ...bucketBounds(row.bucket, granularity, timezone), measures: value }
        }),
      }
    }

    if (views.has('rankings')) {
      const dimension = spec.ranking?.dimension ?? 'project'
      if (!['project', 'model', 'provider', 'session', 'pool'].includes(dimension)) throw new TypeError(`unsupported ranking dimension: ${dimension}`)
      const key = dimension === 'provider' ? 'r.provider' : dimension === 'model' ? 'r.model' : dimension === 'session' ? 'r.session_id' : dimension === 'pool' ? `COALESCE(r.pool_id, '${UNASSIGNED_POOL}')` : 'r.project'
      const by = spec.ranking?.by ?? 'processingTokens'
      const allowed = new Set(['processingTokens', 'newComputeTokens', 'requests', 'originalUsdNano', 'currentUsdNano'])
      if (!allowed.has(by)) throw new TypeError(`unsupported ranking metric: ${by}`)
      // Valuation is computed per group outside SQL. Sessions are unbounded
      // groups, so cost ranking refuses that dimension instead of guessing;
      // every other dimension has a naturally bounded group count and is
      // valued in full — candidate pruning by token volume would drop
      // low-traffic, high-price models from the cost leaderboard.
      if (by === 'currentUsdNano' && dimension === 'session') throw new TypeError('currentUsdNano ranking is not supported for the session dimension')
      const limit = Math.min(Math.max(Number(spec.ranking?.limit ?? 20), 1), 200)
      const label = dimension === 'project' ? 'MAX(r.project_label)' : dimension === 'pool' ? `COALESCE(MAX(r.pool_name), MAX(r.pool_id))` : key
      const sqlOrder = by === 'currentUsdNano' ? 'processingTokens DESC, key' : `${by} DESC, key`
      const costRanking = by === 'currentUsdNano'
      const rowsSql = `${PROJECT_CTE}
        SELECT ${key} AS key, ${label} AS label, ${aggregateColumns(includeEstimates)}
        FROM dsh_effective_requests r
        WHERE ${compiled.clauses.join(' AND ')}
        GROUP BY ${key} ORDER BY ${sqlOrder}${costRanking ? '' : ' LIMIT ?'}
      `
      const rows = costRanking
        ? db.prepare(rowsSql).all(...compiled.params)
        : db.prepare(rowsSql).all(...compiled.params, limit)
      const groupedCosts = currentCostBy(compiled, includeEstimates, key)
      let rankingRows = rows.map((row) => {
        const value = measures(row)
        const current = groupedCosts.get(String(row.key ?? 'unknown'))
        if (current) value.cost = { ...value.cost, ...current }
        return { key: row.key ?? 'unknown', label: row.label ?? row.key ?? 'unknown', ...value }
      })
      if (costRanking) {
        rankingRows.sort((left, right) => right.cost.currentUsdNano - left.cost.currentUsdNano || String(left.key).localeCompare(String(right.key)))
        rankingRows = rankingRows.slice(0, limit)
      }
      if (dimension === 'model') {
        const poolDominance = db.prepare(`${PROJECT_CTE}
          SELECT r.model AS model, COALESCE(r.pool_id, '${UNASSIGNED_POOL}') AS pool_id,
                 SUM(r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens) AS processing
          FROM dsh_effective_requests r
          WHERE ${compiled.clauses.join(' AND ')}
          GROUP BY r.model, pool_id
        `).all(...compiled.params)
        const dominant = new Map()
        for (const row of poolDominance) {
          const model = String(row.model ?? 'unknown')
          const current = dominant.get(model)
          if (current === undefined || Number(row.processing) > current.processing) {
            dominant.set(model, { poolId: String(row.pool_id), processing: Number(row.processing) })
          }
        }
        for (const row of rankingRows) {
          const info = dominant.get(String(row.key))
          row.poolId = info === undefined ? UNASSIGNED_POOL : info.poolId
        }
      }
      const metricOf = (row) => (by === 'currentUsdNano' ? row.cost.currentUsdNano : (row[by] ?? row.cost?.originalUsdNano ?? 0))
      // The share denominator is the whole filtered set, not the truncated
      // page: use the same ungrouped aggregation the kpis view runs.
      const total = by === 'currentUsdNano'
        ? currentCost(compiled, includeEstimates).currentUsdNano
        : Number(db.prepare(`${PROJECT_CTE}
            SELECT ${aggregateColumns(includeEstimates)}
            FROM dsh_effective_requests r
            WHERE ${compiled.clauses.join(' AND ')}
          `).get(...compiled.params)[by] ?? 0)
      result.rankings = { dimension, by, total, rows: rankingRows.map((row) => ({ ...row, share: total > 0 ? metricOf(row) / total : 0 })) }
    }

    if (views.has('activity')) {
      const activityWindow = { fromMs: localDayBounds(shiftDay(localDate(now, timezone), -364), timezone).start, toMs: now }
      const activityCompiled = compileFilter(filter, activityWindow)
      applyPriceFilter(activityCompiled, filter)
      const calendar = db.prepare(`${PROJECT_CTE}
        SELECT dsh_local_day(r.time, ?) AS day, COUNT(*) AS requests,
               SUM(r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens) AS processingTokens
        FROM dsh_effective_requests r
        WHERE ${activityCompiled.clauses.join(' AND ')}
        GROUP BY day ORDER BY day
      `).all(timezone, ...activityCompiled.params).map((row) => ({ day: row.day, ...bucketBounds(row.day, 'day', timezone), requests: Number(row.requests), processingTokens: Number(row.processingTokens ?? 0) }))
      const matrix = db.prepare(`${PROJECT_CTE}
        SELECT dsh_local_weekday(r.time, ?) AS weekday, dsh_local_hour(r.time, ?) AS hour,
               COUNT(*) AS requests,
               SUM(r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens) AS processingTokens
        FROM dsh_effective_requests r
        WHERE ${compiled.clauses.join(' AND ')}
        GROUP BY weekday, hour ORDER BY weekday, hour
      `).all(timezone, timezone, ...compiled.params).map((row) => ({ weekday: Number(row.weekday), hour: Number(row.hour), requests: Number(row.requests), processingTokens: Number(row.processingTokens ?? 0) }))
      const durations = db.prepare(`${PROJECT_CTE}
        SELECT r.session_id, MIN(r.time) AS startedAt, MAX(r.time + COALESCE(r.duration_ms, 0)) AS endedAt
        FROM dsh_effective_requests r
        WHERE ${compiled.clauses.join(' AND ')}
        GROUP BY r.session_id
      `).all(...compiled.params).map((row) => Math.max(0, Number(row.endedAt) - Number(row.startedAt)))
      const durationBounds = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 60 * 60_000]
      const durationDistribution = [...durationBounds, Infinity].map((upper, index) => ({
        fromMs: index === 0 ? 0 : durationBounds[index - 1],
        toMs: Number.isFinite(upper) ? upper : null,
        sessions: durations.filter((duration) => duration >= (index === 0 ? 0 : durationBounds[index - 1]) && duration < upper).length,
      }))
      result.activity = { calendar, matrix, durationDistribution }
    }

    if (views.has('budgets')) {
      const budgets = db.prepare(`
        SELECT id, scope, scope_id AS scopeId, unit, period_month AS periodMonth,
               limit_value AS limitValue, effective_from AS effectiveFrom
        FROM budgets WHERE archived_at IS NULL ORDER BY period_month DESC, scope, scope_id, unit
      `).all()
      result.budgets = { rows: budgets.map((budget) => {
        const bounds = monthBounds(budget.periodMonth, timezone)
        const scoped = { timezone, honesty: filter.honesty, time: { fromMs: bounds.fromMs, toMs: bounds.toMs } }
        if (budget.scope !== 'profile') scoped[budget.scope] = [budget.scopeId]
        const usage = query({ filter: scoped, views: ['kpis', 'series'], series: { granularity: 'day' }, now })
        const spent = budget.unit === 'usd'
          ? usage.kpis.cost.currentUsdNano / 1e9
          : budget.unit === 'newComputeTokens' ? usage.kpis.newComputeTokens : usage.kpis.processingTokens
        const limit = Number(budget.limitValue)
        const activeDays = usage.series.buckets.filter((bucket) => bucket.measures.requests > 0).length
        const localNow = localDate(now, timezone)
        const elapsedDays = localNow.startsWith(`${budget.periodMonth}-`)
          ? Number(localNow.slice(-2))
          : now >= bounds.toMs ? bounds.days : 0
        let forecast = null
        let forecastReason = null
        if (activeDays < 3 && usage.kpis.requests < 20) forecastReason = 'insufficient-sample'
        else if (budget.unit === 'usd' && usage.kpis.cost.coverage < 0.95) forecastReason = 'insufficient-price-coverage'
        else if (elapsedDays > 0) forecast = spent / elapsedDays * bounds.days
        else forecastReason = 'period-not-started'
        return {
          ...budget,
          limit,
          spent,
          progress: limit > 0 ? spent / limit : 0,
          activeDays,
          requestCount: usage.kpis.requests,
          coverage: usage.kpis.cost.coverage,
          forecast,
          forecastReason,
          risk: forecast !== null && forecast > limit,
        }
      }) }
    }

    if (views.has('seriesBy')) {
      const groupBy = spec.seriesBy?.groupBy === 'model' ? 'model' : 'pool'
      const keyExpr = groupBy === 'pool' ? `COALESCE(r.pool_id, '${UNASSIGNED_POOL}')` : 'r.model'
      const spanDays = window.fromMs === null || window.toMs === null ? 366 : Math.ceil((window.toMs - window.fromMs) / DAY)
      if (spanDays > 92) throw new TypeError('seriesBy requires a window of at most 92 days')
      // The dashboard stacks whole pools and never narrows by dimensions, so
      // cache dimension-free series by the observation-independent revision, a
      // coarse clock, and the *description* of filter.time (preset or explicit
      // bounds) — never the resolved window, whose rolling `toMs` would drift
      // with every poll. A filtered exploration recomputes (inherently narrower).
      const seriesCacheKey = dimensionFiltered ? null
        : JSON.stringify({ revision: revisionValue - observationRevision(), clock: Math.floor(now / CLOCK_BUCKET_MS), timezone, groupBy, time: filter.time ?? null, includeEstimates })
      if (seriesCacheKey !== null && seriesByCache.has(seriesCacheKey)) {
        result.seriesBy = seriesByCache.get(seriesCacheKey)
      } else {
        const volume = includeEstimates ? '1' : 'r.estimated = 0'
        // Single combined scan: per (day, group, provider, model) rows carry
        // both the measure sums and the valuation inputs. Current valuation
        // reads the effective cost columns — the exact same seam the kpis,
        // ranking and pool aggregates use — so the stacked chart and the KPI
        // total can never disagree under the Ollama cache scenario.
        const rows = db.prepare(`${PROJECT_CTE}
          SELECT dsh_local_day(r.time, ?) AS day, ${keyExpr} AS g, r.provider, r.model_raw,
                 COUNT(*) AS requests,
                 SUM(CASE WHEN ${volume} THEN r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens ELSE 0 END) AS processingTokens,
                 SUM(CASE WHEN ${volume} THEN r.input_tokens + r.output_tokens ELSE 0 END) AS newComputeTokens,
                 SUM(CASE WHEN ${volume} THEN r.input_tokens ELSE 0 END) AS reportedInputTokens,
                 SUM(CASE WHEN ${volume} THEN r.cost_input_tokens ELSE 0 END) AS costInputTokens,
                 SUM(CASE WHEN ${volume} THEN r.output_tokens ELSE 0 END) AS outputTokens,
                 SUM(CASE WHEN ${volume} THEN r.cache_read_tokens ELSE 0 END) AS reportedCacheReadTokens,
                 SUM(CASE WHEN ${volume} THEN r.cost_cache_read_tokens ELSE 0 END) AS costCacheReadTokens,
                 SUM(CASE WHEN ${volume} THEN r.cache_write_tokens ELSE 0 END) AS cacheWriteTokens,
                 SUM(CASE WHEN ${volume} THEN r.estimated_cache_read_tokens ELSE 0 END) AS estimatedCacheReadTokens
          FROM dsh_effective_requests r
          WHERE ${compiled.clauses.join(' AND ')}
          GROUP BY day, g, r.provider, r.model_raw
        `).all(timezone, ...compiled.params)
        const totalsByGroup = new Map()
        const fold = new Map()
        for (const row of rows) {
          const groupKey = String(row.g ?? 'unknown')
          const dayKey = String(row.day)
          let day = fold.get(dayKey)
          if (day === undefined) { day = new Map(); fold.set(dayKey, day) }
          let slot = day.get(groupKey)
          if (slot === undefined) { slot = { requests: 0, processingTokens: 0, newComputeTokens: 0, currentUsdNano: 0, estimatedCacheReadTokens: 0 }; day.set(groupKey, slot) }
          slot.requests += Number(row.requests)
          slot.processingTokens += Number(row.processingTokens)
          slot.newComputeTokens += Number(row.newComputeTokens)
          slot.estimatedCacheReadTokens += Number(row.estimatedCacheReadTokens)
          let total = totalsByGroup.get(groupKey)
          if (total === undefined) { total = 0; totalsByGroup.set(groupKey, total) }
          total += Number(row.processingTokens)
          totalsByGroup.set(groupKey, total)
          const valuation = valueUsage(catalog, {
            provider: row.provider,
            modelRaw: row.model_raw,
            usage: { input: row.costInputTokens, output: row.outputTokens, cacheRead: row.costCacheReadTokens, cacheWrite: row.cacheWriteTokens },
          })
          if (valuation !== null) slot.currentUsdNano += valuation.usdNano
        }
        const keep = new Set([...totalsByGroup.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8).map(([id]) => id))
        const remap = (id) => (keep.has(id) ? id : 'other')
        const collapsed = new Map()
        for (const [dayKey, groups] of fold) {
          let day = collapsed.get(dayKey)
          if (day === undefined) { day = new Map(); collapsed.set(dayKey, day) }
          for (const [groupKey, slot] of groups) {
            const target = remap(groupKey)
            const current = day.get(target) ?? { requests: 0, processingTokens: 0, newComputeTokens: 0, currentUsdNano: 0, estimatedCacheReadTokens: 0 }
            for (const field of ['requests', 'processingTokens', 'newComputeTokens', 'currentUsdNano', 'estimatedCacheReadTokens']) current[field] += slot[field]
            day.set(target, current)
          }
        }
        const poolLabels = new Map()
        if (groupBy === 'pool') {
          for (const row of db.prepare('SELECT DISTINCT pool_id, pool_name FROM dsh_effective_requests').all()) {
            if (row.pool_id != null) poolLabels.set(String(row.pool_id), row.pool_name ?? String(row.pool_id))
          }
          poolLabels.set(UNASSIGNED_POOL, UNASSIGNED_POOL)
        }
        const groupIds = [...keep]
        if ([...totalsByGroup.keys()].some((id) => !keep.has(id))) groupIds.push('other')
        result.seriesBy = {
          groupBy,
          groups: groupIds.map((id) => ({ id, label: groupBy === 'pool' ? (poolLabels.get(id) ?? id) : id })),
          days: [...collapsed.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([key, groups]) => ({
            key,
            groups: Object.fromEntries([...groups.entries()].map(([id, cell]) => [id, {
              ...cell,
              cacheEstimationMethod: cell.estimatedCacheReadTokens > 0 ? OLLAMA_CACHE_ESTIMATION_METHOD : null,
              cacheEstimateRateBps: cell.estimatedCacheReadTokens > 0 ? cacheEstimateBps : null,
            }])),
          })),
        }
        if (seriesCacheKey !== null) {
          if (seriesByCache.size > 64) seriesByCache.clear()
          seriesByCache.set(seriesCacheKey, result.seriesBy)
        }
      }
    }

    if (views.has('page')) {
      const entity = spec.page?.entity ?? 'request'
      if (!['request', 'session'].includes(entity)) throw new TypeError(`unsupported page entity: ${entity}`)
      const limit = Math.min(Math.max(Number(spec.page?.limit ?? 50), 1), 200)
      let cursor = null
      if (spec.page?.cursor) {
        try {
          cursor = JSON.parse(Buffer.from(String(spec.page.cursor), 'base64url').toString('utf8'))
        } catch {
          throw new TypeError('invalid page cursor')
        }
      }
      if (entity === 'session') {
        const sessionOrder = {
          lastActivity: 'lastActivity DESC, id',
          processingTokens: 'processingTokens DESC, lastActivity DESC, id',
          newComputeTokens: 'newComputeTokens DESC, lastActivity DESC, id',
          requests: 'requests DESC, lastActivity DESC, id',
          originalUsdNano: 'originalUsdNano DESC, lastActivity DESC, id',
        }
        const orderBy = spec.page?.orderBy ?? 'lastActivity'
        if (!Object.hasOwn(sessionOrder, orderBy)) throw new TypeError(`unsupported session page order: ${orderBy}`)
        if (cursor && orderBy !== 'lastActivity') throw new TypeError('session page cursor requires lastActivity order')
        if (cursor && (!Number.isFinite(cursor.time) || typeof cursor.id !== 'string')) throw new TypeError('invalid session page cursor')
        const cursorWhere = cursor ? 'WHERE (lastActivity < ? OR (lastActivity = ? AND id > ?))' : ''
        const cursorParams = cursor ? [cursor.time, cursor.time, cursor.id] : []
        const rows = db.prepare(`${PROJECT_CTE}, grouped AS (
          SELECT r.session_id AS id, MIN(r.time) AS startedAt, MAX(r.time) AS lastActivity,
                 MAX(r.session_title) AS sessionTitle,
                 MAX(r.project) AS project, MAX(r.project_label) AS projectLabel,
                 GROUP_CONCAT(DISTINCT r.model_raw) AS models,
                 COALESCE(SUM(r.duration_ms), MAX(r.time) - MIN(r.time)) AS durationMs,
                 ${aggregateColumns(includeEstimates)}
          FROM dsh_effective_requests r
          WHERE ${compiled.clauses.join(' AND ')}
          GROUP BY r.session_id
        )
        SELECT * FROM grouped ${cursorWhere}
        ORDER BY ${sessionOrder[orderBy]} LIMIT ?
        `).all(...compiled.params, ...cursorParams, limit + 1)
        const labelFormat = new Intl.DateTimeFormat('en', { timeZone: timezone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        result.page = {
          entity,
          rows: rows.slice(0, limit).map((row) => ({
            id: row.id,
            sessionTitle: row.sessionTitle ?? null,
            label: row.sessionTitle || `Session • ${labelFormat.format(new Date(row.startedAt))}`,
            startedAt: Number(row.startedAt),
            lastActivity: Number(row.lastActivity),
            durationMs: Number(row.durationMs ?? 0),
            project: row.project ?? 'unknown',
            projectLabel: row.projectLabel ?? 'unknown',
            models: row.models ? String(row.models).split(',') : [],
            ...measures(row),
          })),
          nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ revision: revision(), time: rows[limit - 1].lastActivity, id: rows[limit - 1].id })).toString('base64url') : null,
        }
      } else {
        const pageCompiled = { clauses: [...compiled.clauses], params: [...compiled.params] }
        if (cursor) {
          if (!Number.isFinite(cursor.time) || typeof cursor.id !== 'string' || !Number.isInteger(cursor.turn) || !Number.isInteger(cursor.step)) throw new TypeError('invalid request page cursor')
          pageCompiled.clauses.push(`(r.time < ? OR (r.time = ? AND (r.session_id > ? OR (r.session_id = ? AND (r.turn > ? OR (r.turn = ? AND r.step > ?))))))`)
          pageCompiled.params.push(cursor.time, cursor.time, cursor.id, cursor.id, cursor.turn, cursor.turn, cursor.step)
        }
        const rows = db.prepare(`${PROJECT_CTE}
          SELECT r.*, r.project, r.project_label AS project_label
          FROM dsh_effective_requests r
          WHERE ${pageCompiled.clauses.join(' AND ')}
          ORDER BY r.time DESC, r.session_id, r.turn, r.step LIMIT ?
        `).all(...pageCompiled.params, limit + 1)
        result.page = {
          entity,
          rows: rows.slice(0, limit).map((row) => requestRow(row, catalog)),
          nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ revision: revision(), time: rows[limit - 1].time, id: rows[limit - 1].session_id, turn: rows[limit - 1].turn, step: rows[limit - 1].step })).toString('base64url') : null,
        }
      }
    }

    if (spec.compare?.kind === 'previous-period' && window.fromMs !== null && window.toMs !== null) {
      const duration = window.toMs - window.fromMs
      const baselineFilter = { ...filter, time: { fromMs: window.fromMs - duration, toMs: window.fromMs } }
      const comparableViews = [...views].filter((view) => !['insights', 'budgets', 'page'].includes(view))
      const baseline = query({
        ...spec,
        filter: baselineFilter,
        views: comparableViews.length ? comparableViews : ['kpis'],
        compare: undefined,
        now,
      })
      result.compare = {
        kind: 'previous-period',
        primary: window,
        baseline: baseline.window,
      }
      if (result.kpis && baseline.kpis) {
        const delta = {}
        for (const key of ['requests', 'calls', 'failedRequests', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'processingTokens', 'newComputeTokens']) {
          const before = baseline.kpis[key]
          delta[key] = before === 0 ? (result.kpis[key] === 0 ? 0 : null) : (result.kpis[key] - before) / before
        }
        // Replace, never mutate in place: the base views object is cached and
        // shared across calls, so compare envelopes must be fresh objects.
        result.kpis = { ...result.kpis, compare: baseline.kpis, delta }
      }
      if (result.rankings && baseline.rankings) {
        const byKey = new Map(baseline.rankings.rows.map((row) => [row.key, row]))
        result.rankings = {
          ...result.rankings,
          rows: result.rankings.rows.map((row) => {
            const previous = byKey.get(row.key) ?? null
            const before = previous?.[result.rankings.by] ?? 0
            const current = row[result.rankings.by] ?? 0
            return { ...row, compare: previous, delta: before === 0 ? (current === 0 ? 0 : null) : (current - before) / before }
          }),
        }
      }
      if (result.series && baseline.series) {
        result.series = { ...result.series, buckets: result.series.buckets.map((bucket, index) => ({ ...bucket, compare: baseline.series.buckets[index]?.measures ?? null })) }
      }
    }

    if (views.has('insights')) {
      const insights = []
      if (result.kpis && result.kpis.cost.coverage < 0.95) {
        insights.push({
          id: 'price-coverage', severity: 'trust',
          params: { coverage: result.kpis.cost.coverage, unpricedTokens: result.kpis.processingTokens - result.kpis.cost.pricedTokens },
          action: { op: 'add', dimension: 'price', key: 'unknown' },
        })
      }
      if (result.kpis && result.kpis.processingTokens > 0 && result.kpis.estimatedProcessingTokens / result.kpis.processingTokens >= 0.05) {
        insights.push({
          id: 'estimated-share', severity: 'trust',
          params: { share: result.kpis.estimatedProcessingTokens / result.kpis.processingTokens },
          action: { op: 'add', dimension: 'status', key: 'estimated' },
        })
      }
      const top = result.rankings?.rows?.[0]
      if (top && top.share >= 0.5) {
        insights.push({
          id: 'concentration', severity: 'structure',
          params: { dimension: result.rankings.dimension, key: top.key, label: top.label, share: top.share },
          action: { op: 'add', dimension: result.rankings.dimension, key: top.key },
        })
      }
      const mover = result.rankings?.rows?.find((row) => row.delta !== null && Math.abs(row.delta ?? 0) >= 0.5)
      if (mover) {
        insights.push({
          id: 'top-mover', severity: 'change',
          params: { dimension: result.rankings.dimension, key: mover.key, label: mover.label, delta: mover.delta },
          action: { op: 'add', dimension: result.rankings.dimension, key: mover.key },
        })
      }
      result.insights = insights.slice(0, 3)
    }

    return result
  }

  /**
   * The public read query. Observation-independent views come from the
   * base cache (keyed on the combined revision minus its observation
   * component); only `pools` pays for observation changes. The outer cache
   * still serves repeat polls the identical result object.
   */
  function query(spec = {}) {
    const filter = cloneFilter(spec.filter ?? {})
    const now = spec.now ?? Date.now()
    const timezone = filter.timezone ?? defaultTimezone
    const window = resolveWindow(filter.time, now, timezone)
    const views = new Set(spec.views ?? [])
    if (views.size === 0) throw new TypeError('query requires at least one view')
    const revisionValue = revision()
    // `now` is excluded from the cache key: clients pass a fresh Date.now()
    // on every poll and must still hit. The clock bucket keeps results
    // shared within a minute; the queried window below keeps the exact
    // `now`, and any new request bumps the revision and forces a miss, so a
    // bucket of staleness can never hide freshly written rows.
    const { now: _ignoredNow, views: _specViews, ...keySpec } = spec
    const cacheKey = JSON.stringify({ revision: revisionValue, clock: Math.floor(now / CLOCK_BUCKET_MS), ...keySpec, views: [...views], filter })
    const cached = queryCache.get(cacheKey)
    if (cached !== undefined) return cached
    ensureEffectiveRequests()
    const wantsPools = views.has('pools')
    const baseViews = new Set(views)
    baseViews.delete('pools')
    const baseKey = JSON.stringify({
      revision: revisionValue - observationRevision(),
      clock: Math.floor(now / CLOCK_BUCKET_MS),
      ...keySpec,
      views: [...baseViews],
      filter,
    })
    let base = baseCache.get(baseKey)
    if (base === undefined) {
      base = computeBaseViews(spec, baseViews, filter, window, now, timezone, revisionValue)
      if (baseCache.size > 32) baseCache.delete(baseCache.keys().next().value)
      baseCache.set(baseKey, base)
    }
    const result = { ...base }
    // `asOf` always carries the live combined revision, even when the base
    // views were served from a cache an observation save did not invalidate.
    result.asOf = { revision: revisionValue, generatedAtMs: now, timezone }
    if (wantsPools) {
      const includeEstimates = filter.honesty === 'includingEstimates' || filter.honesty === 'all'
      result.pools = computePools(now, timezone, includeEstimates)
    }
    queryCache.set(cacheKey, result)
    while (queryCache.size > 32) queryCache.delete(queryCache.keys().next().value)
    return result
  }

  function inspect(ref = {}) {
    ensureEffectiveRequests()
    const filter = cloneFilter(ref.filter ?? {})
    const now = ref.now ?? Date.now()
    const timezone = filter.timezone ?? defaultTimezone
    if (ref.kind === 'pool') {
      // One account, all sources: identity + declared limits + official
      // windows + local ledger views. Official history stays on the
      // account-usage channel; this is the local half.
      const product = listAccountProducts().find((entry) => entry.id === String(ref.id))
      if (product === undefined) return null
      const rules = db.prepare(`
        SELECT id, match_provider AS matchProvider, match_model AS matchModel, priority, source_kind AS sourceKind
        FROM account_attribution_rules WHERE product_id = ? ORDER BY priority, id
      `).all(String(ref.id))
      const poolSummary = computePools(now, timezone, true).pools.find((pool) => pool.id === product.id)
      const narrowed = constrain(filter, { op: 'add', dimension: 'pool', key: String(ref.id) })
      const report = query({
        filter: narrowed,
        views: ['kpis', 'series', 'rankings'],
        series: { granularity: 'auto' },
        ranking: { dimension: 'model', by: 'processingTokens', limit: 20 },
        now,
      })
      const requests = db.prepare(`${PROJECT_CTE}
        SELECT r.* FROM dsh_effective_requests r
        WHERE r.pool_id = ?
        ORDER BY r.time DESC, r.turn DESC, r.step DESC LIMIT 20
      `).all(String(ref.id))
      return {
        kind: 'pool', id: String(ref.id), filter,
        asOf: { revision: revision(), generatedAtMs: now, timezone },
        identity: {
          name: product.name,
          color: product.color,
          kind: product.kind,
          providerId: product.providerId,
          connectionId: product.connectionId,
          sourceKind: product.sourceKind,
          externalId: product.externalId,
          createdAt: product.createdAt,
          billing: product.billing,
          declaredLimits: product.limits,
          rules,
        },
        account: poolSummary ?? null,
        direct: report.kpis,
        trend: report.series,
        breakdown: report.rankings,
        page: { entity: 'request', rows: requests.map((row) => requestRow(row, catalog)), nextCursor: null },
      }
    }
    if (ref.kind === 'model' || ref.kind === 'provider') {
      const narrowed = constrain(filter, { op: 'add', dimension: ref.kind, key: String(ref.id) })
      const report = query({
        filter: narrowed,
        views: ['kpis', 'series', 'rankings', 'page'],
        series: { granularity: 'auto' },
        ranking: { dimension: 'project', by: 'processingTokens', limit: 10 },
        page: { entity: 'session', limit: 20 },
        now,
      })
      if (report.kpis.requests === 0) return null
      const price = ref.kind === 'model' ? catalog.priceFor(String(ref.id)) : null
      return {
        kind: ref.kind,
        id: String(ref.id),
        filter,
        asOf: report.asOf,
        identity: ref.kind === 'model'
          ? { model: String(ref.id), priceKnown: price !== null, matchedPriceModel: price?.matchedModel ?? null, priceSource: price?.source ?? null }
          : { provider: String(ref.id) },
        direct: report.kpis,
        trend: report.series,
        breakdown: report.rankings,
        page: report.page,
      }
    }
    if (ref.kind === 'request') {
      const parts = String(ref.id).split(':')
      if (parts.length < 3) return null
      const step = Number(parts.pop())
      const turn = Number(parts.pop())
      const sessionId = parts.join(':')
      const row = db.prepare(`${PROJECT_CTE}
        SELECT r.*, r.project, r.project_label AS project_label FROM dsh_effective_requests r
        WHERE r.session_id = ? AND r.turn = ? AND r.step = ?
      `).get(sessionId, turn, step)
      if (row === undefined) return null
      const item = requestRow(row, catalog)
      return {
        kind: 'request', id: String(ref.id), filter,
        asOf: { revision: revision(), generatedAtMs: now, timezone },
        identity: { sessionId, turn, step, project: item.project, model: item.model, provider: item.provider, status: item.status },
        direct: {
          requests: 1,
          calls: item.status === 'ok' ? 1 : 0,
          failedRequests: item.status === 'failed' ? 1 : 0,
          inputTokens: item.inputTokens,
          outputTokens: item.outputTokens,
          cacheReadTokens: item.cacheReadTokens,
          cacheWriteTokens: item.cacheWriteTokens,
          reasoningTokens: item.reasoningTokens ?? 0,
          processingTokens: item.processingTokens,
          newComputeTokens: item.newComputeTokens,
          estimatedProcessingTokens: item.estimated ? item.processingTokens : 0,
          cost: {
            originalUsdNano: item.originalUsdNano ?? 0,
            currentUsdNano: item.currentUsdNano ?? 0,
            reportedUsageUsdNano: item.reportedUsageUsdNano ?? 0,
            estimatedCacheReadTokens: item.estimatedCacheReadTokens,
            cacheEstimationMethod: item.cacheEstimationMethod,
            cacheEstimateRateBps: item.cacheEstimateRateBps,
            coverage: item.currentUsdNano === null && item.processingTokens > 0 ? 0 : 1,
            pricedTokens: item.currentUsdNano === null ? 0 : item.processingTokens,
            totalTokens: item.processingTokens,
          },
        },
        request: item,
        corrections: db.prepare(`
          SELECT id, input_tokens AS inputTokens, output_tokens AS outputTokens,
                 cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens,
                 reasoning_tokens AS reasoningTokens, excluded, note, active, created_at AS createdAt
          FROM request_corrections WHERE session_id = ? AND turn = ? AND step = ? ORDER BY id DESC
        `).all(sessionId, turn, step).map((correction) => ({ ...correction, excluded: correction.excluded === 1, active: correction.active === 1 })),
      }
    }

    if (ref.kind === 'project') {
      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(String(ref.id))
      if (project === undefined) return null
      const row = db.prepare(`${PROJECT_CTE}
        SELECT ${aggregateColumns(true)} FROM dsh_effective_requests r
       
        WHERE r.owned = 1 AND COALESCE(r.excluded, 0) = 0 AND r.project = ?
      `).get(String(ref.id))
      const sessions = db.prepare(`${PROJECT_CTE}
        SELECT r.session_id AS id, MIN(r.time) AS startedAt, COUNT(*) AS requests,
               SUM(r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens) AS processingTokens
        FROM dsh_effective_requests r
        WHERE r.owned = 1 AND COALESCE(r.excluded, 0) = 0 AND r.project = ?
        GROUP BY r.session_id ORDER BY processingTokens DESC LIMIT 20
      `).all(String(ref.id))
      return {
        kind: 'project', id: String(ref.id), filter,
        asOf: { revision: revision(), generatedAtMs: now, timezone },
        identity: {
          displayName: project.display_name,
          identityKind: project.identity_kind,
          identityValue: project.identity_value,
          color: project.color,
          hidden: project.hidden === 1,
          sources: db.prepare('SELECT cwd, git_root AS gitRoot, git_remote AS gitRemote FROM project_sources WHERE project_id = ? ORDER BY cwd').all(String(ref.id)),
        },
        direct: measures(row),
        page: { entity: 'session', rows: sessions, nextCursor: null },
      }
    }

    if (ref.kind !== 'session') return null
    const source = db.prepare('SELECT * FROM sources WHERE session_id = ?').get(String(ref.id))
    if (source === undefined) return null
    const aggregateFor = (where, params) => measures(db.prepare(`SELECT ${aggregateColumns(true)} FROM dsh_effective_requests r WHERE COALESCE(r.excluded, 0) = 0 AND ${where}`).get(...params))
    const direct = aggregateFor('r.session_id = ? AND r.owned = 1', [String(ref.id)])
    const inherited = aggregateFor('r.session_id = ? AND r.owned = 0', [String(ref.id)])
    const includingChildren = measures(db.prepare(`
      WITH RECURSIVE tree(id) AS (
        SELECT ?
        UNION ALL
        SELECT s.session_id FROM sources s JOIN tree t ON s.parent_session = t.id
      )
      SELECT ${aggregateColumns(true)} FROM dsh_effective_requests r JOIN tree t ON t.id = r.session_id WHERE r.owned = 1 AND COALESCE(r.excluded, 0) = 0
    `).get(String(ref.id)))
    const children = db.prepare('SELECT session_id AS id FROM sources WHERE parent_session = ? ORDER BY created_at, session_id').all(String(ref.id)).map((child) => ({
      id: child.id,
      measures: aggregateFor('r.session_id = ? AND r.owned = 1', [child.id]),
    }))
    const rows = db.prepare(`${PROJECT_CTE}
      SELECT r.*, r.project, r.project_label AS project_label FROM dsh_effective_requests r
      WHERE r.session_id = ? ORDER BY r.time, r.turn, r.step LIMIT 200
    `).all(String(ref.id))

    // Group rows by turn to compute turn-by-turn context inflation & flow
    const turnsMap = new Map()
    for (const rawRow of rows) {
      const turnNum = rawRow.turn
      if (!turnsMap.has(turnNum)) {
        turnsMap.set(turnNum, {
          turn: turnNum,
          promptTokens: 0,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
          outputContent: 0,
          toolCalls: 0,
          durationMs: 0,
          model: rawRow.model_raw ?? rawRow.model ?? 'unknown',
          steps: 0,
        })
      }
      const tData = turnsMap.get(turnNum)
      tData.promptTokens += Number(rawRow.input_tokens ?? 0)
      tData.cacheRead += Number(rawRow.cache_read_tokens ?? 0)
      tData.cacheWrite += Number(rawRow.cache_write_tokens ?? 0)
      const rTokens = Number(rawRow.reasoning_tokens ?? 0)
      tData.reasoning += rTokens
      const outTokens = Number(rawRow.output_tokens ?? 0)
      tData.outputContent += Math.max(0, outTokens - rTokens)
      tData.durationMs += Number(rawRow.duration_ms ?? 0)
      tData.steps += 1
    }
    const turns = Array.from(turnsMap.values()).sort((a, b) => a.turn - b.turn)

    return {
      kind: 'session', id: String(ref.id), filter,
      asOf: { revision: revision(), generatedAtMs: now, timezone },
      identity: {
        title: source.title ?? null,
        createdAt: source.created_at,
        project: source.cwd,
        cwd: source.cwd,
        parentSession: source.parent_session,
        origin: source.origin,
        sourceDeleted: source.deleted === 1,
      },
      direct,
      inherited,
      includingChildren,
      children,
      turns,
      page: { entity: 'request', rows: rows.map((row) => requestRow(row, catalog)), nextCursor: null },
    }
  }

  function setOllamaCacheEstimateBps(value) {
    const next = normalizeOllamaCacheEstimateBps(value)
    if (next === cacheEstimateBps) return next
    cacheEstimateBps = next
    effectiveProjection = null
    queryCache.clear()
    baseCache.clear()
    seriesByCache.clear()
    poolsCache.clear()
    return next
  }

  return { constrain, query, inspect, entrySummary, setOllamaCacheEstimateBps, diagnostics }
}
