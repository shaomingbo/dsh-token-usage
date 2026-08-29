import { localDate, localDayBounds } from './days.js'
import { valueUsage } from './pricing.js'

const FILTER_DIMENSIONS = new Set(['project', 'session', 'model', 'modelRaw', 'provider', 'status', 'price'])
const DAY = 86_400_000

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
      coverage: processingTokens > 0 ? pricedTokens / processingTokens : 1,
      pricedTokens,
      totalTokens: processingTokens,
    },
  }
}

function requestRow(row, catalog) {
  const current = (row.status === 'ok' || row.status === 'estimated') ? valueUsage(catalog, {
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
    model: row.model ?? row.model_raw,
    modelRaw: row.model_raw,
    status: row.status,
    estimated: row.estimated === 1,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    reasoningTokens: row.reasoning_tokens,
    processingTokens: row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_write_tokens,
    newComputeTokens: row.input_tokens + row.output_tokens,
    originalProcessingTokens: (row.original_input_tokens ?? row.input_tokens) + (row.original_output_tokens ?? row.output_tokens) + (row.original_cache_read_tokens ?? row.cache_read_tokens) + (row.original_cache_write_tokens ?? row.cache_write_tokens),
    originalUsdNano: row.original_usd_nano,
    currentUsdNano: current?.usdNano ?? null,
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
export function createAnalytics({ db, catalog, timezone: defaultTimezone = 'UTC', revision = () => 0 } = {}) {
  const queryCache = new Map()
  const effectiveSelect = `
    WITH RECURSIVE session_cwd(session_id, cwd, deleted) AS (
      SELECT session_id, cwd, deleted FROM sources WHERE cwd IS NOT NULL
      UNION
      SELECT s.session_id, p.cwd, s.deleted FROM sources s JOIN session_cwd p ON s.parent_session = p.session_id WHERE s.cwd IS NULL
    )
    SELECT r.session_id, r.turn, r.step, r.seq, r.time, r.provider, r.model_raw,
           COALESCE(a.canonical, r.model_raw) AS model,
           COALESCE(ps.project_id, CASE WHEN sc.cwd IS NOT NULL THEN 'cwd:' || sc.cwd END, 'unknown') AS project,
           COALESCE(p.display_name, sc.cwd, 'unknown') AS project_label,
           COALESCE(sc.deleted, 0) AS source_deleted,
           r.owned,
           COALESCE(c.input_tokens, r.input_tokens) AS input_tokens,
           COALESCE(c.output_tokens, r.output_tokens) AS output_tokens,
           COALESCE(c.cache_read_tokens, r.cache_read_tokens) AS cache_read_tokens,
           COALESCE(c.cache_write_tokens, r.cache_write_tokens) AS cache_write_tokens,
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
  }

  let effectiveRevision = null
  function ensureEffectiveRequests(currentRevision = revision()) {
    if (effectiveRevision === currentRevision) return
    db.exec('DROP TABLE IF EXISTS temp.dsh_effective_requests')
    db.exec(`CREATE TEMP TABLE dsh_effective_requests AS ${effectiveSelect}`)
    db.exec(`
      CREATE INDEX dsh_effective_time ON dsh_effective_requests(time, session_id, turn, step);
      CREATE INDEX dsh_effective_session ON dsh_effective_requests(session_id, time);
      CREATE INDEX dsh_effective_model ON dsh_effective_requests(model, provider, time);
      CREATE INDEX dsh_effective_project ON dsh_effective_requests(project, time);
    `)
    effectiveRevision = currentRevision
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

  function currentCost(compiled, includeEstimates) {
    const volume = includeEstimates ? '1' : 'r.estimated = 0'
    const rows = db.prepare(`${PROJECT_CTE}
      SELECT r.provider, r.model_raw,
             SUM(CASE WHEN ${volume} THEN r.input_tokens ELSE 0 END) AS inputTokens,
             SUM(CASE WHEN ${volume} THEN r.output_tokens ELSE 0 END) AS outputTokens,
             SUM(CASE WHEN ${volume} THEN r.cache_read_tokens ELSE 0 END) AS cacheReadTokens,
             SUM(CASE WHEN ${volume} THEN r.cache_write_tokens ELSE 0 END) AS cacheWriteTokens
      FROM dsh_effective_requests r
      WHERE ${compiled.clauses.join(' AND ')}
      GROUP BY r.provider, r.model_raw
    `).all(...compiled.params)
    let currentUsdNano = 0
    let pricedTokens = 0
    let totalTokens = 0
    for (const row of rows) {
      const processing = Number(row.inputTokens) + Number(row.outputTokens) + Number(row.cacheReadTokens) + Number(row.cacheWriteTokens)
      totalTokens += processing
      const valuation = valueUsage(catalog, {
        provider: row.provider,
        modelRaw: row.model_raw,
        usage: { input: row.inputTokens, output: row.outputTokens, cacheRead: row.cacheReadTokens, cacheWrite: row.cacheWriteTokens },
      })
      if (valuation !== null) {
        currentUsdNano += valuation.usdNano
        pricedTokens += processing
      }
    }
    return { currentUsdNano, pricedTokens, totalTokens, coverage: totalTokens > 0 ? pricedTokens / totalTokens : 1 }
  }

  function currentCostBy(compiled, includeEstimates, groupExpression, groupParams = []) {
    const volume = includeEstimates ? '1' : 'r.estimated = 0'
    const rows = db.prepare(`${PROJECT_CTE}
      SELECT ${groupExpression} AS groupKey, r.provider, r.model_raw,
             SUM(CASE WHEN ${volume} THEN r.input_tokens ELSE 0 END) AS inputTokens,
             SUM(CASE WHEN ${volume} THEN r.output_tokens ELSE 0 END) AS outputTokens,
             SUM(CASE WHEN ${volume} THEN r.cache_read_tokens ELSE 0 END) AS cacheReadTokens,
             SUM(CASE WHEN ${volume} THEN r.cache_write_tokens ELSE 0 END) AS cacheWriteTokens
      FROM dsh_effective_requests r
      WHERE ${compiled.clauses.join(' AND ')}
      GROUP BY groupKey, r.provider, r.model_raw
    `).all(...groupParams, ...compiled.params)
    const groups = new Map()
    for (const row of rows) {
      const key = String(row.groupKey ?? 'unknown')
      const group = groups.get(key) ?? { currentUsdNano: 0, pricedTokens: 0, totalTokens: 0, coverage: 1 }
      const processing = Number(row.inputTokens) + Number(row.outputTokens) + Number(row.cacheReadTokens) + Number(row.cacheWriteTokens)
      group.totalTokens += processing
      const valuation = valueUsage(catalog, {
        provider: row.provider,
        modelRaw: row.model_raw,
        usage: { input: row.inputTokens, output: row.outputTokens, cacheRead: row.cacheReadTokens, cacheWrite: row.cacheWriteTokens },
      })
      if (valuation !== null) { group.currentUsdNano += valuation.usdNano; group.pricedTokens += processing }
      group.coverage = group.totalTokens > 0 ? group.pricedTokens / group.totalTokens : 1
      groups.set(key, group)
    }
    return groups
  }

  function query(spec = {}) {
    const filter = cloneFilter(spec.filter ?? {})
    const now = spec.now ?? Date.now()
    const timezone = filter.timezone ?? defaultTimezone
    const window = resolveWindow(filter.time, now, timezone)
    const views = new Set(spec.views ?? [])
    if (views.size === 0) throw new TypeError('query requires at least one view')
    const revisionValue = revision()
    const cacheKey = JSON.stringify({ revision: revisionValue, clock: spec.now ?? Math.floor(now / 15_000), ...spec, filter })
    const cached = queryCache.get(cacheKey)
    if (cached !== undefined) return cached
    ensureEffectiveRequests(revisionValue)
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
      if (!dimensionFiltered) {
        for (const purged of purgedInWindow) {
          kpis.requests += Number(purged.requests)
          kpis.processingTokens += Number(purged.processingTokens)
        }
      }
      Object.assign(result, { kpis })
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
      const key = dimension === 'provider' ? 'r.provider' : dimension === 'model' ? 'r.model' : dimension === 'session' ? 'r.session_id' : 'r.project'
      const by = spec.ranking?.by ?? 'processingTokens'
      const allowed = new Set(['processingTokens', 'newComputeTokens', 'requests', 'originalUsdNano'])
      if (!allowed.has(by)) throw new TypeError(`unsupported ranking metric: ${by}`)
      const limit = Math.min(Math.max(Number(spec.ranking?.limit ?? 20), 1), 200)
      const label = dimension === 'project' ? 'MAX(r.project_label)' : key
      const rows = db.prepare(`${PROJECT_CTE}
        SELECT ${key} AS key, ${label} AS label, ${aggregateColumns(includeEstimates)}
        FROM dsh_effective_requests r
        WHERE ${compiled.clauses.join(' AND ')}
        GROUP BY ${key} ORDER BY ${by} DESC, key LIMIT ?
      `).all(...compiled.params, limit)
      const groupedCosts = currentCostBy(compiled, includeEstimates, key)
      const rankingRows = rows.map((row) => {
        const value = measures(row)
        const current = groupedCosts.get(String(row.key ?? 'unknown'))
        if (current) value.cost = { ...value.cost, ...current }
        return { key: row.key ?? 'unknown', label: row.label ?? row.key ?? 'unknown', ...value }
      })
      const total = rankingRows.reduce((sum, row) => sum + (row[by] ?? row.cost?.originalUsdNano ?? 0), 0)
      result.rankings = { dimension, by, rows: rankingRows.map((row) => ({ ...row, share: total > 0 ? (row[by] ?? row.cost?.originalUsdNano ?? 0) / total : 0 })) }
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
        if (cursor && (!Number.isFinite(cursor.time) || typeof cursor.id !== 'string')) throw new TypeError('invalid session page cursor')
        const cursorWhere = cursor ? 'WHERE (lastActivity < ? OR (lastActivity = ? AND id > ?))' : ''
        const cursorParams = cursor ? [cursor.time, cursor.time, cursor.id] : []
        const rows = db.prepare(`${PROJECT_CTE}, grouped AS (
          SELECT r.session_id AS id, MIN(r.time) AS startedAt, MAX(r.time) AS lastActivity,
                 MAX(r.project) AS project, MAX(r.project_label) AS projectLabel,
                 GROUP_CONCAT(DISTINCT r.model_raw) AS models,
                 COALESCE(SUM(r.duration_ms), MAX(r.time) - MIN(r.time)) AS durationMs,
                 ${aggregateColumns(includeEstimates)}
          FROM dsh_effective_requests r
          WHERE ${compiled.clauses.join(' AND ')}
          GROUP BY r.session_id
        )
        SELECT * FROM grouped ${cursorWhere}
        ORDER BY lastActivity DESC, id LIMIT ?
        `).all(...compiled.params, ...cursorParams, limit + 1)
        const labelFormat = new Intl.DateTimeFormat('en', { timeZone: timezone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        result.page = {
          entity,
          rows: rows.slice(0, limit).map((row) => ({
            id: row.id,
            label: `Session • ${labelFormat.format(new Date(row.startedAt))}`,
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
        result.kpis.compare = baseline.kpis
        result.kpis.delta = delta
      }
      if (result.rankings && baseline.rankings) {
        const byKey = new Map(baseline.rankings.rows.map((row) => [row.key, row]))
        result.rankings.rows = result.rankings.rows.map((row) => {
          const previous = byKey.get(row.key) ?? null
          const before = previous?.[result.rankings.by] ?? 0
          const current = row[result.rankings.by] ?? 0
          return { ...row, compare: previous, delta: before === 0 ? (current === 0 ? 0 : null) : (current - before) / before }
        })
      }
      if (result.series && baseline.series) {
        result.series.buckets = result.series.buckets.map((bucket, index) => ({ ...bucket, compare: baseline.series.buckets[index]?.measures ?? null }))
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

    queryCache.set(cacheKey, result)
    while (queryCache.size > 32) queryCache.delete(queryCache.keys().next().value)
    return result
  }

  function inspect(ref = {}) {
    ensureEffectiveRequests()
    const filter = cloneFilter(ref.filter ?? {})
    const now = ref.now ?? Date.now()
    const timezone = filter.timezone ?? defaultTimezone
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
    return {
      kind: 'session', id: String(ref.id), filter,
      asOf: { revision: revision(), generatedAtMs: now, timezone },
      identity: {
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
      page: { entity: 'request', rows: rows.map((row) => requestRow(row, catalog)), nextCursor: null },
    }
  }

  return { constrain, query, inspect }
}
