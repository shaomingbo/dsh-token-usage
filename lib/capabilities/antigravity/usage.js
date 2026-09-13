/**
 * Best-effort quota usage, isolated per saved Antigravity account.
 *
 * Quota reads answer from the daily generation surface, merged with the
 * fallback surfaces for fields daily omits (verified 2026-09-13: some
 * consumer accounts get no gemini remainingFraction from daily while prod
 * still reports the real fractions). A full-quota row whose reset instant
 * sits at read-time+5h is the upstream placeholder echo — recomputed on
 * every request on every surface — and is recorded as an honest unknown
 * instead of a permanent all-0% display with a never-converging countdown.
 * Cache and failures are account-scoped: one unavailable account never hides
 * the others.
 */

import { defaultProjectId } from './antigravity-api.js'

const BOUNDED_SUMMARY_BYTES = 4096
const USABLE_RUNTIME = /^(gemini-|claude-|gpt-oss-)/i
const ECHO_WINDOW_MS = 5 * 60 * 60 * 1000
const ECHO_TOLERANCE_MS = 2 * 60 * 1000

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The placeholder echo signature: remainingFraction is exactly 1 and the
 * reset instant sits within tolerance of read-time+5h. Real windows keep a
 * fixed wall-clock reset (like the gemini rows); this one regenerates per
 * request, so persisting it as a fact produced a permanent 0% beside a ~5h
 * countdown that never converged (verified 2026-09-13 on the
 * claude-* and gpt-oss rows of every quota surface).
 */
function isPlaceholderEcho(quota, readMs) {
  if (quota.remainingFraction !== 1) return false
  const resetMs = Date.parse(quota.resetTime)
  return Number.isFinite(resetMs) && Math.abs(resetMs - (readMs + ECHO_WINDOW_MS)) <= ECHO_TOLERANCE_MS
}

function perModelQuota(models, readMs) {
  const out = []
  for (const [id, info] of Object.entries(models ?? {})) {
    if (!USABLE_RUNTIME.test(id) || !isRecord(info)) continue
    const quota = isRecord(info.quotaInfo) ? info.quotaInfo : info
    const entry = { id }
    const echo = isPlaceholderEcho(quota, readMs)
    const remaining = quota.remainingFraction ?? quota.remaining ?? quota.quotaRemaining
    if (!echo && typeof remaining === 'number' && Number.isFinite(remaining)) entry.remaining = remaining
    if (!echo && typeof quota.resetTime === 'string' && quota.resetTime.length > 0) entry.resetsAt = quota.resetTime
    out.push(entry)
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

function bound(value, limit = BOUNDED_SUMMARY_BYTES) {
  let text
  try {
    text = JSON.stringify(value)
  } catch {
    return undefined
  }
  if (text === undefined || text.length <= limit) return value
  return { truncated: `${text.slice(0, limit - 1)}…` }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

export function createUsageService({ auth, client, clock = Date.now }) {
  const cache = new Map()

  function clear(accountId) {
    if (accountId === undefined) cache.clear()
    else cache.delete(accountId)
  }

  async function fetchUsage({ accountId = auth.activeAccountId?.(), refresh = false, signal } = {}) {
    if (typeof accountId !== 'string') return { provider: 'antigravity', configured: false }
    if (!refresh && cache.has(accountId)) return cache.get(accountId)
    const readMs = clock()
    const status = auth.status(accountId)
    if (status.configured !== true) {
      const missing = { provider: 'antigravity', configured: false, accountId }
      cache.set(accountId, missing)
      return missing
    }
    const result = {
      provider: 'antigravity',
      configured: true,
      accountId,
      email: status.email,
      fetchedAt: readMs,
      ...(status.expired === true ? { expired: true } : {}),
    }
    try {
      const context = await auth.getAccountContext(accountId, signal)
      const discoveredProjectId = typeof context.projectId === 'string' && context.projectId.length > 0
        ? context.projectId
        : await client.loadCodeAssist(context.token).catch(() => undefined)
      // New consumer accounts may have usable model quota even when
      // loadCodeAssist returns no project. Match the generation path's stable
      // local fallback instead of suppressing quota discovery entirely.
      const projectId = typeof discoveredProjectId === 'string' && discoveredProjectId.length > 0
        ? discoveredProjectId
        : defaultProjectId(context.email ?? accountId)
      const summary = await client.retrieveUserQuotaSummary(context.token).catch(error => ({
        unavailable: error instanceof Error ? error.message.slice(0, 200) : 'unavailable',
      }))
      if (isRecord(summary) && summary.unavailable === undefined) result.summary = bound(summary)
      else if (isRecord(summary)) result.summaryUnavailable = summary.unavailable
      if (typeof projectId === 'string') {
        // The echo comparison must sit at the models read itself: auth,
        // discovery, and the summary call (which sets no timeout of its own)
        // run first, and a slow prefix must not push a real echo outside the
        // tolerance window. fetchedAt keeps the snapshot-start semantics.
        const modelsReadMs = clock()
        const models = await client.fetchAvailableModels(context.token, projectId).catch(() => undefined)
        if (models !== undefined) result.models = perModelQuota(models, modelsReadMs)
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message.slice(0, 200) : 'usage fetch failed'
    }
    cache.set(accountId, result)
    return result
  }

  async function fetchAllUsage({ refresh = false, signal, concurrency = 2 } = {}) {
    const accounts = auth.statuses()
    return mapLimit(accounts, Math.max(1, concurrency), account => fetchUsage({
      accountId: account.accountId,
      refresh,
      signal,
    }))
  }

  function remainingFor(accountId, runtimeModel) {
    const usage = cache.get(accountId)
    const model = usage?.models?.find(entry => entry.id === runtimeModel)
    return typeof model?.remaining === 'number' ? model.remaining : undefined
  }

  return { fetchUsage, fetchAllUsage, remainingFor, clear }
}
