import { AccountsError } from '../domain.js'
import { assertResponseOrigin, boundedSignal, boundedText, confinedUrl, epoch, finite, jsonBody, officialOrigins, slug } from './http.js'

export const OLLAMA_OFFICIAL_ORIGINS = Object.freeze(['https://ollama.com'])
export const OLLAMA_SETTINGS_URL = 'https://ollama.com/settings'
export const OLLAMA_SESSION_COOKIE_NAMES = Object.freeze([
  '__Secure-better-auth.session_token',
  'better-auth.session_token',
  '__Secure-session',
  'session',
  'ollama_session',
  '__Host-ollama_session',
  'wos-session',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
])

export class OllamaLocalAdapter {
  id = 'ollama-local'
  credentialKinds = Object.freeze([])

  async observe({ connection = {}, now = Date.now } = {}) {
    const observedAt = now()
    return {
      id: `ollama-local:${connection.id ?? 'default'}:${observedAt}`,
      connectionId: connection.id ?? null,
      observedAt,
      source: 'local_ledger',
      brittle: false,
      complete: true,
      quotaApplicable: false,
      windows: [],
      limits: [],
      warnings: [],
      metadata: { reason: 'local-runtime' },
    }
  }
}

/** Ollama Cloud credential validation and explicitly opted-in settings parsing. */
export class OllamaCloudAdapter {
  id = 'ollama-cloud'
  credentialKinds = Object.freeze(['api_key', 'manual_cookie_header'])

  constructor({ fetch, apiKeyValidationEndpoint, apiKeyResponseValidator, allowedOrigins = OLLAMA_OFFICIAL_ORIGINS, enableManualCookieScraping = false } = {}) {
    if (typeof fetch !== 'function') throw new AccountsError('invalid-adapter-config', 'Ollama Cloud adapter requires fetch')
    this.fetch = fetch
    this.allowedOrigins = officialOrigins(allowedOrigins, OLLAMA_OFFICIAL_ORIGINS)
    this.apiKeyValidationEndpoint = apiKeyValidationEndpoint
      ? confinedUrl(apiKeyValidationEndpoint, this.allowedOrigins, 'API-key validation endpoint')
      : null
    if (apiKeyResponseValidator !== undefined && typeof apiKeyResponseValidator !== 'function') {
      throw new AccountsError('invalid-adapter-config', 'Ollama API-key response validator must be a function')
    }
    this.apiKeyResponseValidator = apiKeyResponseValidator ?? null
    this.settingsUrl = confinedUrl(OLLAMA_SETTINGS_URL, this.allowedOrigins, 'settings URL')
    this.enableManualCookieScraping = enableManualCookieScraping === true
  }

  async observe(request = {}) {
    const kind = request.credential?.kind ?? (request.credential?.cookieHeader ? 'manual_cookie_header' : 'api_key')
    if (kind === 'manual_cookie_header') return this.#observeSettings(request)
    if (kind === 'api_key') return this.#validateApiKey(request)
    throw new AccountsError('unsupported-credential', 'Ollama Cloud credential kind is not supported')
  }

  async #validateApiKey({ connection = {}, credential = {}, now = Date.now, signal } = {}) {
    if (!this.apiKeyValidationEndpoint) throw new AccountsError('endpoint-required', 'Ollama API-key validation endpoint must be configured')
    if (!this.apiKeyResponseValidator) throw new AccountsError('validator-required', 'Ollama API-key response validator must be configured')
    const secret = credential.secret ?? credential.apiKey
    if (typeof secret !== 'string' || secret.length === 0) throw new AccountsError('credential-required', 'Ollama API key is required')
    let response
    try {
      response = await this.fetch(this.apiKeyValidationEndpoint, {
        method: 'GET',
        redirect: 'error',
        signal: boundedSignal(signal),
        headers: { accept: 'application/json', Authorization: `Bearer ${secret}` },
      })
    } catch {
      throw new AccountsError('provider-network-failed', 'Ollama API-key validation failed')
    }
    assertResponseOrigin(response, this.apiKeyValidationEndpoint, this.allowedOrigins)
    if (response.status !== 200) throw new AccountsError('credential-invalid', `Ollama API-key validation returned HTTP ${Number(response.status) || 0}`)
    const body = await jsonBody(response)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AccountsError('invalid-provider-response', 'Ollama API-key validation returned invalid JSON')
    let valid = false
    try { valid = this.apiKeyResponseValidator(body) === true } catch { valid = false }
    if (!valid) throw new AccountsError('credential-invalid', 'Ollama API key was not accepted')
    const observedAt = now()
    const plan = publicPlan(body)
    return {
      id: `ollama-cloud:${connection.id ?? 'default'}:${observedAt}`,
      connectionId: connection.id ?? null,
      observedAt,
      source: 'official_response',
      brittle: false,
      complete: false,
      quotaApplicable: true,
      product: plan ? product(plan, 'official_response') : null,
      windows: [],
      limits: [],
      warnings: ['The documented endpoint is reachable, but Ollama publishes no dedicated key-validation endpoint; credential status remains unverified', 'Quota limits were not published by this response'],
      metadata: { cloudEndpointReachable: true, credentialStatus: 'unverified' },
    }
  }

  async #observeSettings({ connection = {}, credential = {}, manualCookieOptIn = false, now = Date.now, signal } = {}) {
    if (!this.enableManualCookieScraping || manualCookieOptIn !== true) {
      throw new AccountsError('manual-opt-in-required', 'manual Cookie Header scraping requires explicit opt-in')
    }
    const cookie = allowedCookieHeader(credential.cookieHeader, credential.allowedCookieNames)
    let response
    try {
      response = await this.fetch(this.settingsUrl, {
        method: 'GET',
        // manual instead of 'error': a 303 to /signin is a diagnosable
        // "the pasted session cookie is invalid or expired", not a network
        // failure. The redirect is never followed, so the credential stays put.
        redirect: 'manual',
        signal: boundedSignal(signal),
        headers: { accept: 'text/html', Cookie: cookie },
      })
    } catch {
      throw new AccountsError('provider-network-failed', 'Ollama settings request failed')
    }
    assertResponseOrigin(response, this.settingsUrl, this.allowedOrigins)
    if (response.status >= 300 && response.status < 400) {
      throw new AccountsError('session-invalid-or-expired', 'The Ollama settings page redirected (likely to /signin): the pasted session cookie is invalid or expired')
    }
    if (response.status !== 200) throw new AccountsError('provider-http-error', `Ollama settings request returned HTTP ${Number(response.status) || 0}`)
    let html
    try { html = await boundedText(response) } catch (error) {
      if (error instanceof AccountsError) throw error
      throw new AccountsError('invalid-provider-response', 'Ollama settings response could not be read')
    }
    const observedAt = now()
    const parsed = parseOllamaSettings(html, { connectionId: connection.id, observedAt })
    return {
      id: `ollama-cloud-ui:${connection.id ?? 'default'}:${observedAt}`,
      connectionId: connection.id ?? null,
      observedAt,
      source: 'official_ui',
      brittle: true,
      complete: parsed.plan !== null && parsed.limits.length === 2,
      quotaApplicable: true,
      product: parsed.plan ? product(parsed.plan, 'official_ui') : null,
      windows: parsed.windows,
      limits: parsed.limits,
      warnings: parsed.warnings,
      metadata: { parsedFields: parsed.parsedFields, accountHint: parsed.email },
    }
  }
}

export function allowedCookieHeader(header, allowedNames = OLLAMA_SESSION_COOKIE_NAMES) {
  if (typeof header !== 'string' || header.trim().length === 0) throw new AccountsError('credential-required', 'manual Cookie Header is required')
  if (/[\r\n]/.test(header)) throw new AccountsError('invalid-cookie-header', 'Cookie Header must be one line')
  const allowlist = new Set(allowedNames)
  if ([...allowlist].some((name) => !OLLAMA_SESSION_COOKIE_NAMES.includes(name))) {
    throw new AccountsError('invalid-cookie-allowlist', 'only recognized Ollama session cookies may be allowed')
  }
  const selected = []
  const seen = new Set()
  for (const segment of header.split(';')) {
    const separator = segment.indexOf('=')
    if (separator < 1) continue
    const name = segment.slice(0, separator).trim()
    const value = segment.slice(separator + 1).trim()
    if (!allowlist.has(name) || seen.has(name) || value.length === 0) continue
    if (/[,;\s]/.test(value)) throw new AccountsError('invalid-cookie-header', 'session cookie value contains invalid characters')
    selected.push(`${name}=${value}`)
    seen.add(name)
  }
  if (selected.length === 0) throw new AccountsError('credential-required', 'Cookie Header contains no allowlisted Ollama session cookie')
  return selected.join('; ')
}

export function parseOllamaSettings(html, { connectionId = null, observedAt = 0 } = {}) {
  const source = String(html ?? '')
  const cloudUsage = source.match(/Cloud Usage[\s\S]{0,1200}/i)?.[0] ?? source
  const plan = firstMatch(cloudUsage, [
    /["']plan(?:Name)?["']\s*:\s*["']([^"'<>{}]{1,80})["']/i,
    /\bplan\b\s*[:\-]\s*<[^>]*>\s*([^<]{1,80})</i,
    /\bplan\b\s*[:\-]\s*([A-Za-z][A-Za-z0-9 +._-]{0,79})/i,
    /Cloud Usage[\s\S]{0,500}?\b(Free|Pro|Max)\b/i,
  ])
  const email = firstMatch(source, [
    /id=["']header-email["'][^>]*>\s*([^<]{3,254})\s*</i,
    /["']email["']\s*:\s*["']([^"'<>]{3,254})["']/i,
  ])
  const specs = [
    { key: 'session-hourly', keys: ['session', 'hourly'], label: 'Session / hourly', kind: 'rate' },
    { key: 'weekly', keys: ['weekly'], label: 'Weekly', kind: 'rolling', durationMs: 7 * 86_400_000 },
  ]
  const windows = []
  const limits = []
  const warnings = []
  for (const spec of specs) {
    const matchedKey = spec.keys.find(key => percentageNear(source, key) !== null || resetNear(source, key) !== null)
    const percent = matchedKey ? percentageNear(source, matchedKey) : null
    const reset = matchedKey ? resetNear(source, matchedKey) : null
    if (percent === null && reset === null) {
      warnings.push(`${spec.label} quota was not found`)
      continue
    }
    const durationMs = spec.durationMs ?? (matchedKey === 'session' ? 5 * 3_600_000 : 3_600_000)
    const windowId = `ollama-cloud-window:${spec.key}`
    windows.push({ id: windowId, kind: spec.kind, label: spec.label, durationMs, resetsAt: reset })
    if (percent === null) {
      warnings.push(`${spec.label} usage percentage was not found`)
      continue
    }
    limits.push({
      id: `ollama-cloud-limit:${spec.key}`,
      connectionId,
      windowId,
      metric: 'cloud_usage',
      unit: 'percent',
      mode: 'dynamic',
      percentUsed: percent,
      observedAt,
    })
  }
  return {
    plan,
    email,
    windows,
    limits,
    warnings,
    parsedFields: [plan ? 'plan' : null, email ? 'email' : null, ...limits.map((item) => item.id.endsWith('hourly') ? 'hourly' : 'weekly')].filter(Boolean),
  }
}

function publicPlan(body) {
  const value = body.plan?.name ?? body.planName ?? (typeof body.plan === 'string' ? body.plan : null)
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : null
}

function product(plan, sourceKind) {
  const code = slug(plan, 'cloud-plan')
  return {
    id: `ollama-cloud-product:${code}`, providerId: 'ollama-cloud', code, name: plan,
    kind: 'cloud_plan', sourceKind, published: true,
  }
}

function firstMatch(source, patterns) {
  for (const pattern of patterns) {
    const match = source.match(pattern)
    if (match?.[1]) return decodeText(match[1]).trim()
  }
  return null
}

function percentageNear(source, key) {
  const patterns = [
    new RegExp(`["']${key}(?:Percent|Percentage|Usage)?["']\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i'),
    new RegExp(`${key}[\\s\\S]{0,240}?(?:width\\s*:\\s*|width=["'])([0-9]+(?:\\.[0-9]+)?)%`, 'i'),
    new RegExp(`${key}[\\s\\S]{0,240}?([0-9]+(?:\\.[0-9]+)?)\\s*%\\s*used`, 'i'),
    new RegExp(`${key}[\\s\\S]{0,160}?([0-9]+(?:\\.[0-9]+)?)\\s*%`, 'i'),
  ]
  const match = firstMatch(source, patterns)
  const value = finite(match)
  return value !== null && value <= 100 ? value : null
}

function resetNear(source, key) {
  const escaped = `${key}(?:Reset|ResetsAt|ResetAt|NextReset)`
  const value = firstMatch(source, [
    new RegExp(`["']${escaped}["']\\s*:\\s*["']([^"']+)["']`, 'i'),
    new RegExp(`${key}[\\s\\S]{0,260}?data-time=["']([^"']+)["']`, 'i'),
    new RegExp(`${key}[\\s\\S]{0,180}?reset(?:s| at| in)?\\s*[:\\-]?\\s*([^<\\n]{1,80})`, 'i'),
  ])
  return epoch(value)
}

function decodeText(value) {
  return String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}
