/**
 * Observation freshness: per (connection, capability) due policy, consent,
 * backoff, and single-flight. Host I/O stays outside this module.
 *
 * Data status (fresh/stale/expired/unknown) is derived from ledger windows.
 * Refresh status (idle/running/backoff/auth-required) lives here.
 */

export const OBSERVATION_REFRESH_ACTIVE_MS = 2 * 60_000
export const OBSERVATION_REFRESH_LULL_MS = 5 * 60_000
export const CLIENT_POLL_STREAM_MS = 90_000
export const OBSERVATION_SHORT_POLL_MS = 1_500
export const OBSERVATION_BACKOFF_START_MS = 30_000
export const OBSERVATION_BACKOFF_MAX_MS = 15 * 60_000

export function observationKey(connectionId, capabilityId) {
  return `${connectionId}::${capabilityId}`
}

/**
 * Silent cadence after a quota success. `pollerActive` maps to the 2-minute
 * tier; an isolated call after a reopen lull uses 5 minutes.
 */
export function observationRefreshDue({ lastRefreshAt = 0, pollerActive = false, now = Date.now() } = {}) {
  const minIntervalMs = pollerActive ? OBSERVATION_REFRESH_ACTIVE_MS : OBSERVATION_REFRESH_LULL_MS
  return { pollerActive, minIntervalMs, due: now - lastRefreshAt >= minIntervalMs }
}

export function dataStatusFromWindow(window) {
  if (window == null) return 'unknown'
  if (window.expired === true) return 'expired'
  if (window.stale === true) return 'stale'
  if (window.percentUsed == null && window.usedPct == null) return 'unknown'
  return 'fresh'
}

export function quotaCapabilityFor(providerId) {
  if (providerId === 'ollama-local') return 'none'
  if (providerId === 'ollama-cloud') return 'official_ui'
  return 'official_usage_api'
}

/**
 * @param {object} recipe
 * @param {'unsupported' | 'reachability' | 'quota'} recipe.kind
 * @param {boolean} [recipe.credentialPresent]
 * @param {boolean} [recipe.authorized]  persisted auto-observe consent (quota)
 * @param {boolean} [recipe.windowExpired]
 * @param {object} cell
 * @param {{ trigger: string, pollerActive: boolean, now: number }} ctx
 */
export function isCapabilityDue(cell, recipe, { trigger, pollerActive = false, overlayActive = false, now = Date.now() } = {}) {
  if (recipe?.kind === 'unsupported') return false
  if (cell?.runStatus === 'running') return false
  if (Number(cell?.nextAttemptAt) > now) return false
  if (cell?.runStatus === 'auth-required') return false

  const credentialPresent = recipe?.credentialPresent === true
  const authorized = recipe?.authorized === true
  const manual = trigger === 'manual'

  if (recipe?.kind === 'quota' && recipe.capabilityId === 'official_ui') {
    if (!credentialPresent) return false
    if (!authorized && !manual) return false
    if (!manual && overlayActive !== true) return false
  } else if (recipe?.kind === 'quota') {
    if (!credentialPresent && !authorized) return false
  } else if (recipe?.kind === 'reachability') {
    if (!credentialPresent) return false
  }

  if (manual) return true
  if (recipe?.windowExpired === true && recipe.kind === 'quota') return true

  const watermark = recipe?.kind === 'quota' ? (cell?.lastQuotaSuccessAt ?? 0) : (cell?.lastAttemptAt ?? 0)
  if (recipe?.kind === 'quota' && watermark === 0) return true
  return observationRefreshDue({ lastRefreshAt: watermark, pollerActive, now }).due
}

export function createObservationFreshness({ now = () => Date.now() } = {}) {
  const cells = new Map()
  let inFlight = null
  let inFlightKeys = new Set()

  function getCell(key) {
    let cell = cells.get(key)
    if (!cell) {
      cell = {
        lastAttemptAt: 0,
        lastQuotaSuccessAt: 0,
        nextAttemptAt: 0,
        backoffMs: 0,
        runStatus: 'idle',
        errorCode: null,
      }
      cells.set(key, cell)
    }
    return cell
  }

  function keyOf(recipe) {
    return observationKey(recipe.connectionId, recipe.capabilityId)
  }

  function snapshotFor(connectionId, capabilityId) {
    const cell = cells.get(observationKey(connectionId, capabilityId))
    if (!cell) return { refreshStatus: 'idle', errorCode: null, lastQuotaSuccessAt: 0 }
    return {
      refreshStatus: cell.runStatus,
      errorCode: cell.errorCode,
      lastQuotaSuccessAt: cell.lastQuotaSuccessAt,
    }
  }

  function anyRunning(keys) {
    for (const key of keys ?? cells.keys()) {
      if (cells.get(key)?.runStatus === 'running') return true
    }
    return false
  }

  function noteCredentialChange(connectionId, capabilityId) {
    const cell = getCell(observationKey(connectionId, capabilityId))
    if (cell.runStatus === 'auth-required' || cell.runStatus === 'backoff') cell.runStatus = 'idle'
    cell.nextAttemptAt = 0
    cell.backoffMs = 0
    cell.errorCode = null
  }

  function applyResults(results) {
    const nowMs = now()
    for (const item of results ?? []) {
      const cell = getCell(item.key)
      if (item.authRequired === true) {
        cell.runStatus = 'auth-required'
        cell.errorCode = item.errorCode ?? 'auth-required'
        cell.nextAttemptAt = Number.MAX_SAFE_INTEGER
        continue
      }
      if (item.errorCode) {
        const start = cell.backoffMs > 0 ? cell.backoffMs : OBSERVATION_BACKOFF_START_MS / 2
        cell.backoffMs = Math.min(OBSERVATION_BACKOFF_MAX_MS, Math.max(OBSERVATION_BACKOFF_START_MS, start * 2))
        if (Number(item.retryAfterMs) > 0) cell.backoffMs = Math.max(cell.backoffMs, Number(item.retryAfterMs))
        cell.nextAttemptAt = nowMs + cell.backoffMs
        cell.runStatus = 'backoff'
        cell.errorCode = item.errorCode
        continue
      }
      cell.backoffMs = 0
      cell.nextAttemptAt = 0
      cell.errorCode = null
      cell.runStatus = 'idle'
      if (item.quotaSuccess === true) cell.lastQuotaSuccessAt = nowMs
    }
  }

  function runRound(due, run, signal) {
    const keys = new Set(due.map(keyOf))
    const startedAt = now()
    for (const recipe of due) {
      const cell = getCell(keyOf(recipe))
      cell.runStatus = 'running'
      cell.lastAttemptAt = startedAt
    }
    inFlightKeys = keys
    const promise = Promise.resolve()
      .then(() => run(due, signal))
      .then((results) => {
        applyResults(results)
        return { results: results ?? [] }
      })
      .finally(() => {
        for (const key of keys) {
          const cell = cells.get(key)
          if (cell?.runStatus === 'running') cell.runStatus = 'idle'
        }
        if (inFlight === promise) {
          inFlight = null
          inFlightKeys = new Set()
        }
      })
    inFlight = promise
    return promise
  }

  function ensureFresh({ trigger, pollerActive = false, overlayActive = false, recipes = [], run, signal } = {}) {
    const nowMs = now()
    const due = recipes.filter((recipe) => isCapabilityDue(getCell(keyOf(recipe)), recipe, {
      trigger, pollerActive, overlayActive, now: nowMs,
    }))
    if (inFlight !== null) {
      const extra = due.filter((recipe) => !inFlightKeys.has(keyOf(recipe)))
      if (extra.length === 0) return inFlight
      return inFlight.then(() => ensureFresh({ trigger, pollerActive, overlayActive, recipes: extra, run, signal }))
    }
    if (due.length === 0) return Promise.resolve({ results: [] })
    return runRound(due, run, signal)
  }

  return {
    ensureFresh,
    snapshotFor,
    noteCredentialChange,
    anyRunning,
  }
}
