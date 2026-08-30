import { AccountsError } from '../domain.js'

export function officialOrigins(configured, official) {
  const values = configured === undefined ? [...official] : [...configured]
  if (values.length === 0 || values.some((origin) => !official.includes(origin))) {
    throw new AccountsError('origin-not-allowed', 'provider origin allowlist may contain only official origins')
  }
  return values
}

export function confinedUrl(value, allowedOrigins, label = 'endpoint') {
  let url
  try { url = new URL(String(value)) } catch { throw new AccountsError('invalid-endpoint', `${label} must be an absolute URL`) }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new AccountsError('invalid-endpoint', `${label} must be a credential-free HTTPS URL without query or fragment`)
  }
  if (!allowedOrigins.includes(url.origin)) throw new AccountsError('origin-not-allowed', `${label} origin is not allowed`)
  return url
}

export function assertResponseOrigin(response, requestUrl, allowedOrigins) {
  if (!response?.url) return
  let responseUrl
  try { responseUrl = new URL(String(response.url)) } catch { throw new AccountsError('invalid-endpoint', 'response URL must be absolute') }
  if (responseUrl.protocol !== 'https:' || responseUrl.username || responseUrl.password || responseUrl.hash
    || !allowedOrigins.includes(responseUrl.origin) || responseUrl.origin !== requestUrl.origin) {
    throw new AccountsError('origin-not-allowed', 'response escaped the requested origin')
  }
}

export function boundedSignal(signal, timeoutMs = 10_000) {
  const deadline = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, deadline]) : deadline
}

export async function boundedText(response, maxBytes = 1_048_576) {
  const declared = Number(response?.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new AccountsError('provider-response-too-large', 'provider response exceeded the size limit')
  if (response?.body?.getReader) {
    const reader = response.body.getReader()
    const chunks = []
    let length = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > maxBytes) throw new AccountsError('provider-response-too-large', 'provider response exceeded the size limit')
        chunks.push(value)
      }
    } finally {
      reader.releaseLock?.()
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder().decode(bytes)
  }
  const text = await response.text()
  if (typeof text !== 'string' || Buffer.byteLength(text) > maxBytes) throw new AccountsError('provider-response-too-large', 'provider response exceeded the size limit')
  return text
}

export async function jsonBody(response, maxBytes) {
  try {
    if (response?.body?.getReader || response?.headers?.get) return JSON.parse(await boundedText(response, maxBytes))
    return await response.json()
  } catch (error) {
    if (error instanceof AccountsError) throw error
    throw new AccountsError('invalid-provider-response', 'provider returned invalid JSON')
  }
}

export function finite(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : null
}

export function epoch(value) {
  if (value === undefined || value === null || value === '') return null
  const numeric = finite(value)
  if (numeric !== null) return numeric < 10_000_000_000 ? Math.trunc(numeric * 1000) : Math.trunc(numeric)
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function slug(value, fallback = 'quota') {
  const result = String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return result || fallback
}
