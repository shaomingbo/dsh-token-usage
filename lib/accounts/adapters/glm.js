import { AccountsError } from '../domain.js'
import { assertResponseOrigin, boundedSignal, confinedUrl, epoch, finite, jsonBody, officialOrigins, slug } from './http.js'

export const ZAI_OFFICIAL_ORIGINS = Object.freeze([
  'https://api.z.ai',
  'https://open.bigmodel.cn',
  'https://dev.bigmodel.cn',
])

/** GLM/Z.AI quota adapter. No endpoint default is asserted; callers inject one. */
export class GlmAdapter {
  id = 'glm'
  credentialKinds = Object.freeze(['raw_authorization'])

  constructor({ fetch, endpoint, modelUsageEndpoint, toolUsageEndpoint, allowedOrigins = ZAI_OFFICIAL_ORIGINS } = {}) {
    if (typeof fetch !== 'function') throw new AccountsError('invalid-adapter-config', 'GLM adapter requires fetch')
    if (!endpoint) throw new AccountsError('endpoint-required', 'GLM quota endpoint must be configured')
    this.fetch = fetch
    this.allowedOrigins = officialOrigins(allowedOrigins, ZAI_OFFICIAL_ORIGINS)
    this.endpoint = confinedUrl(endpoint, this.allowedOrigins)
    this.usageEndpoints = [
      modelUsageEndpoint ? { kind: 'model', url: confinedUrl(modelUsageEndpoint, this.allowedOrigins, 'model usage endpoint') } : null,
      toolUsageEndpoint ? { kind: 'tool', url: confinedUrl(toolUsageEndpoint, this.allowedOrigins, 'tool usage endpoint') } : null,
    ].filter(Boolean)
  }

  async observe({ connection = {}, credential = {}, now = Date.now, signal } = {}) {
    const authorization = credential.rawAuthorization ?? credential.secret
    if (typeof authorization !== 'string' || authorization.length === 0) throw new AccountsError('credential-required', 'GLM authorization is required')
    const envelope = await requestJson(this.fetch, this.endpoint, this.allowedOrigins, authorization, signal, 'quota')
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new AccountsError('invalid-provider-response', 'GLM returned an invalid JSON envelope')
    if (envelope.success === false || ('code' in envelope && Number(envelope.code) !== 200)) {
      throw new AccountsError('provider-envelope-error', 'GLM returned an unsuccessful JSON envelope')
    }

    const observedAt = now()
    const entries = quotaEntries(envelope.data)
    const parsed = entries.map((entry, index) => parseLimit(entry, index, connection.id, observedAt)).filter(Boolean)
    const warnings = []
    if (entries.length === 0) warnings.push('No quota entries were published')
    if (parsed.length < entries.length) warnings.push(`${entries.length - parsed.length} quota entries could not be interpreted`)
    const usage = {}
    const range = officialUsageRange(observedAt)
    for (const endpoint of this.usageEndpoints) {
      const url = new URL(endpoint.url)
      url.searchParams.set('startTime', range.startTime)
      url.searchParams.set('endTime', range.endTime)
      try {
        const usageEnvelope = await requestJson(this.fetch, url, this.allowedOrigins, authorization, signal, `${endpoint.kind} usage`)
        if (usageEnvelope?.success === false || ('code' in (usageEnvelope ?? {}) && Number(usageEnvelope.code) !== 200)) {
          throw new AccountsError('provider-envelope-error', 'GLM returned an unsuccessful JSON envelope')
        }
        usage[endpoint.kind] = summarizeUsage(usageEnvelope?.data ?? usageEnvelope)
      } catch (error) {
        warnings.push(`${endpoint.kind} usage was unavailable (${error?.code ?? 'provider-failed'})`)
      }
    }
    return {
      id: `glm:${connection.id ?? 'default'}:${observedAt}`,
      connectionId: connection.id ?? null,
      observedAt,
      source: 'official_plugin_internal_api',
      brittle: true,
      complete: entries.length > 0 && parsed.length === entries.length,
      quotaApplicable: true,
      windows: parsed.map((item) => item.window),
      limits: parsed.map((item) => item.limit),
      warnings,
      metadata: {
        envelopeCode: 'code' in envelope ? Number(envelope.code) : null,
        usageRange: this.usageEndpoints.length > 0 ? range : null,
        usage,
      },
    }
  }
}

async function requestJson(fetchImpl, url, allowedOrigins, authorization, signal, label) {
  let response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: boundedSignal(signal),
      headers: {
        accept: 'application/json',
        'accept-language': 'en-US,en',
        'content-type': 'application/json',
        Authorization: authorization,
      },
    })
  } catch {
    throw new AccountsError('provider-network-failed', `GLM ${label} request failed`)
  }
  assertResponseOrigin(response, url, allowedOrigins)
  if (response.status !== 200) throw new AccountsError('provider-http-error', `GLM ${label} request returned HTTP ${Number(response.status) || 0}`)
  return jsonBody(response)
}

function officialUsageRange(now) {
  const end = new Date(now)
  end.setMinutes(59, 59, 0)
  const start = new Date(end)
  start.setDate(start.getDate() - 1)
  start.setMinutes(0, 0, 0)
  return { startTime: localDateTime(start), endTime: localDateTime(end) }
}

function localDateTime(date) {
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function summarizeUsage(value) {
  if (Array.isArray(value)) return { records: value.length }
  if (!value || typeof value !== 'object') return { records: value === null || value === undefined ? 0 : 1 }
  const arrays = Object.entries(value).filter(([, entry]) => Array.isArray(entry))
  return {
    records: arrays.reduce((total, [, entry]) => total + entry.length, 0),
    collections: arrays.map(([key]) => key).slice(0, 16),
  }
}

function quotaEntries(data) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []
  for (const candidate of [data.limits, data.quotas, data.usage?.limits, data.data?.limits]) {
    if (Array.isArray(candidate)) return candidate
  }
  return []
}

function parseLimit(entry, index, connectionId, observedAt) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const discriminator = entry.name ?? entry.type ?? entry.metric ?? entry.limitType
  const hasMeasurement = [entry.total, entry.limit, entry.value, entry.quota, entry.max, entry.used,
    entry.usage, entry.currentValue, entry.consumed, entry.remaining, entry.percentUsed,
    entry.percentage, entry.nextResetTime, entry.nextResetAt, entry.resetAt].some((value) => value !== undefined && value !== null)
  if (discriminator === undefined && !hasMeasurement) return null
  const label = String(discriminator ?? `quota-${index + 1}`)
  const key = slug(label, `quota-${index + 1}`)
  const total = firstFinite(entry.total, entry.limit, entry.value, entry.quota, entry.max)
  const used = firstFinite(entry.used, entry.usage, entry.currentValue, entry.consumed)
  const remaining = firstFinite(entry.remaining, total !== null && used !== null ? Math.max(0, total - used) : null)
  const percent = firstFinite(entry.percentUsed, entry.percentage, entry.usedPercent, total > 0 && used !== null ? used / total * 100 : null)
  const reset = epoch(entry.resetsAt ?? entry.resetAt ?? entry.nextResetTime ?? entry.nextResetAt)
  const durationMs = inferDuration(entry, label)
  const windowId = `glm-window:${key}`
  let window
  if (durationMs !== null) {
    window = { id: windowId, kind: 'rolling', label, durationMs, resetsAt: reset }
  } else {
    window = { id: windowId, kind: 'billing', label, resetsAt: reset }
  }
  return {
    window,
    limit: {
      id: `glm-limit:${key}`,
      connectionId: connectionId ?? null,
      windowId,
      metric: String(entry.metric ?? entry.type ?? 'requests'),
      unit: String(entry.unitName ?? entry.quotaUnit ?? 'count'),
      mode: total === null ? 'dynamic' : 'exact',
      value: total,
      used,
      remaining,
      percentUsed: percent !== null && percent <= 100 ? percent : null,
      observedAt,
      metadata: { providerType: entry.type ?? null },
    },
  }
}

function firstFinite(...values) {
  for (const value of values) {
    const parsed = finite(value)
    if (parsed !== null) return parsed
  }
  return null
}

function inferDuration(entry, label) {
  const direct = firstFinite(entry.durationMs, entry.windowMs)
  if (direct !== null && direct > 0) return Math.trunc(direct)
  const hours = firstFinite(entry.hours, entry.windowHours)
  if (hours !== null && hours > 0) return Math.trunc(hours * 3_600_000)
  const normalized = label.toLowerCase()
  if (String(entry.type ?? '').toUpperCase() === 'TOKENS_LIMIT') return 5 * 3_600_000
  const hourMatch = normalized.match(/(\d+)\s*h(?:our)?s?\b/)
  if (hourMatch) return Number(hourMatch[1]) * 3_600_000
  if (/hourly/.test(normalized)) return 3_600_000
  if (/weekly|7\s*d(?:ay)?s?\b/.test(normalized)) return 7 * 86_400_000
  return null
}
