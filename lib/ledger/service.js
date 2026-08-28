/**
 * The usage ledger service: the deep module at the seam. It folds durable
 * session events into request records (one record per session/turn/step),
 * imports history idempotently, accepts live post-commit events, values
 * usage against a price catalog, and answers the read queries the client
 * consumes. Storage details stay hidden behind this API.
 */

import { openDatabase, transaction, LedgerError } from './db.js'

export { LedgerError }
import { PriceCatalog, valueUsage } from './pricing.js'
import { eachLocalDay, localDayBounds, localDate, offsetAt } from './days.js'

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

  const keyOf = (turn, step) => `${turn}:${step}`
  const recordFor = (turn, step) => {
    const key = keyOf(turn, step)
    let record = records.get(key)
    if (record === undefined) {
      record = {
        turn, step, seq: -1, time: 0, provider: 'unknown', model_raw: 'unknown',
        input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
        reasoning_tokens: null, status: 'unknown', estimated: 0, estimator: null,
        estimator_version: null, failed: false,
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
  overrides,
  aliases,
  multipliers,
  estimator,
  timezone: defaultTimezone = DEFAULT_TIMEZONE,
} = {}) {
  const db = openDatabase(databasePath)
  const catalog = new PriceCatalog({ snapshot, overrides, aliases, multipliers })
  // Live-path in-memory state: per-session last header config and step
  // message buffer. Never persisted; dropped on dispose.
  const liveConfig = new Map()
  const liveBuffers = new Map()

  const statements = {
    upsertSource: db.prepare(`
      INSERT INTO sources (session_id, revision, last_seq, source, created_at, cwd, parent_session, origin, seed_length, deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(session_id) DO UPDATE SET
        cwd = COALESCE(excluded.cwd, sources.cwd),
        parent_session = COALESCE(excluded.parent_session, sources.parent_session),
        origin = COALESCE(excluded.origin, sources.origin),
        seed_length = COALESCE(excluded.seed_length, sources.seed_length),
        revision = COALESCE(excluded.revision, sources.revision),
        deleted = 0
    `),
    setLastSeq: db.prepare('UPDATE sources SET last_seq = MAX(last_seq, ?) WHERE session_id = ?'),
    upsertRequest: db.prepare(`
      INSERT INTO requests (session_id, turn, step, seq, time, provider, model_raw, owned,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
        status, estimated, estimator, estimator_version, original_usd_nano, price_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, turn, step) DO UPDATE SET
        seq = excluded.seq,
        time = excluded.time,
        provider = excluded.provider,
        model_raw = excluded.model_raw,
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
        price_version = excluded.price_version
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
          record.provider, record.model_raw, record.owned,
          record.input_tokens, record.output_tokens, record.cache_read_tokens,
          record.cache_write_tokens, record.reasoning_tokens,
          record.status, record.estimated, record.estimator, record.estimator_version,
          valuation?.usdNano ?? null, valuation?.version ?? null,
        )
      }
    })
  }

  function ensureSource(header, source = 'profile') {
    statements.upsertSource.run(
      header.id, header.revision ?? null, -1, source, header.createdAt ?? 0,
      header.cwd ?? null, header.parentSession ?? null, header.origin ?? null,
      header.seedLength ?? null,
    )
  }

  return {
    /** Import one session's durable events. Idempotent; safe to repeat. */
    importSession({ header, events }, options = {}) {
      ensureSource(header, options.source ?? 'profile')
      const estimatorFn = options.estimator ?? estimator
      const records = foldEvents(header, events, estimatorFn !== undefined ? { estimator: estimatorFn } : {})
      persistRecords(header.id, records)
      const lastSeq = events.reduce((max, event) => Math.max(max, event.seq ?? -1), -1)
      statements.setLastSeq.run(lastSeq, header.id)
      return { imported: records.size, lastSeq }
    },

    /** Ingest one live post-commit event. Failures never throw into the feed. */
    ingestEvent(header, event) {
      try {
        ensureSource(header)
        const data = event.data ?? {}
        if (event.type === 'request/header') {
          liveConfig.set(header.id, data.config ?? undefined)
        } else if (event.type === 'assistant/message' && data.usage !== undefined) {
          const turn = data.turn ?? 0
          const step = data.step ?? 0
          const record = {
            turn, step, seq: event.seq, time: event.time,
            provider: data.message?.source?.kind === 'model' ? data.message.source.provider : liveConfig.get(header.id)?.provider ?? 'unknown',
            model_raw: data.message?.source?.kind === 'model' ? data.message.source.model : liveConfig.get(header.id)?.model ?? 'unknown',
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
        } else if (event.type === 'assistant/message') {
          // Usage-less assistant message: buffer for a live estimator.
          const key = `${header.id}:${data.turn ?? 0}:${data.step ?? 0}`
          let buffer = liveBuffers.get(key)
          if (buffer === undefined) { buffer = []; liveBuffers.set(key, buffer) }
          buffer.push(event)
        }
        statements.setLastSeq.run(event.seq ?? -1, header.id)
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
        if (row.status === 'failed') totals.failedRequests += 1
        totals.requests += 1
        if (row.status === 'ok') totals.calls += 1
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
        rows: rows.map((row) => ({
          sessionId: row.session_id, turn: row.turn, step: row.step, time: row.time,
          provider: row.provider, model: row.model_raw, cwd: row.cwd,
          status: row.status, estimated: row.estimated === 1,
          estimator: row.estimator, estimatorVersion: row.estimator_version,
          inputTokens: row.input_tokens, outputTokens: row.output_tokens,
          cacheReadTokens: row.cache_read_tokens, cacheWriteTokens: row.cache_write_tokens,
          reasoningTokens: row.reasoning_tokens,
          processingTokens: row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_write_tokens,
          originalUsdNano: row.original_usd_nano, priceVersion: row.price_version,
        })),
      }
    },

    setAlias(modelRaw, canonical) {
      db.prepare('INSERT OR REPLACE INTO aliases (model_raw, canonical) VALUES (?, ?)').run(modelRaw, canonical)
      catalog.aliases.set(modelRaw, canonical)
    },

    /** `{revision, lastSeq}` for a known source, or null. */
    getSourceMeta(sessionId) {
      const row = db.prepare('SELECT revision, last_seq AS lastSeq FROM sources WHERE session_id = ?').get(sessionId)
      return row === undefined ? null : { revision: row.revision, lastSeq: row.lastSeq }
    },

    /** Raw table dump for the settings surface (small config tables only). */
    dumpTable(table) {
      const allowed = new Set(['aliases', 'price_overrides', 'providers', 'purged_daily'])
      if (!allowed.has(table)) throw new LedgerError('bad-table', `table not readable: ${table}`)
      return db.prepare(`SELECT * FROM ${table}`).all()
    },

    /** Embedded snapshot identity for the pricing view. */
    snapshotMeta() {
      return {
        version: catalog.snapshot.version ?? null,
        source: catalog.snapshot.source ?? null,
        note: catalog.snapshot.note ?? null,
        models: Object.keys(catalog.snapshot.models ?? {}),
      }
    },

    /**
     * Purge request details older than `cutoffMs`. Day-level anonymous
     * aggregates are folded into `purged_daily` first, so long-term trends
     * survive while per-request rows are gone for good.
     */
    purgeBefore(cutoffMs, { timezone: tz = DEFAULT_TIMEZONE } = {}) {
      return transaction(db, () => {
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
    },
    setOverride(model, price) {
      db.prepare(`
        INSERT OR REPLACE INTO price_overrides (model, input_nano, output_nano, cache_read_nano, cache_write_nano, reasoning_nano)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(model, String(price.inputNano), String(price.outputNano), price.cacheReadNano !== undefined ? String(price.cacheReadNano) : null, price.cacheWriteNano !== undefined ? String(price.cacheWriteNano) : null, price.reasoningNano !== undefined ? String(price.reasoningNano) : null)
      catalog.overrides.set(model, price)
    },
    setMultiplier(provider, bps) {
      db.prepare('INSERT OR REPLACE INTO providers (provider, multiplier_bps) VALUES (?, ?)').run(provider, bps)
      catalog.multipliers.set(provider, bps)
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
          const tables = ['sources', 'requests', 'aliases', 'providers', 'price_overrides']
          if (mode === 'replace') {
            for (const table of tables) db.exec(`DELETE FROM main.${table}`)
          }
          for (const table of tables) {
            const conflict = mode === 'replace' ? '' : ' OR IGNORE'
            db.exec(`INSERT${conflict} INTO main.${table} SELECT * FROM restore_src.${table}`)
          }
        })
      } finally {
        db.exec('DETACH restore_src')
      }
    },

    dispose() {
      liveConfig.clear()
      liveBuffers.clear()
      db.close()
    },
  }
}
