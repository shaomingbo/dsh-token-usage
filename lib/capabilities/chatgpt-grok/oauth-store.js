/**
 * Owner-only JSON persistence for pi-ai OAuth credentials.
 *
 * Standalone port of the DSH pi-ai auth store with no workspace-only
 * dependencies: schema parsing and the pi-ai per-provider credential contract
 * over the shared owner-file kernel, which retains atomic writes, 0600 file /
 * 0700 directory modes, a process-local operation queue, and last-good
 * snapshot survival when an external edit is invalid.
 */

import { OwnerFileStore } from '../owner-file-store.js'

const FORMAT_VERSION = 1
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertProviderId(providerId) {
  if (!PROVIDER_ID_PATTERN.test(providerId)) {
    throw new Error('subscription-search: document contains an invalid provider id')
  }
}

function oauthCredential(providerId, value) {
  if (!isRecord(value) || value.type !== 'oauth') {
    throw new Error(`subscription-search: credential for "${providerId}" must have type "oauth"`)
  }
  if (typeof value.access !== 'string' || value.access.length === 0) {
    throw new Error(`subscription-search: credential for "${providerId}" has no access token`)
  }
  if (typeof value.refresh !== 'string' || value.refresh.length === 0) {
    throw new Error(`subscription-search: credential for "${providerId}" has no refresh token`)
  }
  if (typeof value.expires !== 'number' || !Number.isFinite(value.expires) || value.expires <= 0) {
    throw new Error(`subscription-search: credential for "${providerId}" has an invalid expiry`)
  }
  return value
}

export function parseOAuthDocument(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    const position = error instanceof SyntaxError ? error.message.match(/position \d+/)?.[0] : undefined
    throw new Error(`subscription-search: the OAuth document is not valid JSON${position === undefined ? '' : ` (${position})`}`)
  }
  if (!isRecord(parsed) || parsed.version !== FORMAT_VERSION) {
    throw new Error(`subscription-search: the OAuth document has an unsupported version`)
  }
  if (!isRecord(parsed.credentials)) {
    throw new Error('subscription-search: the OAuth document has no credentials object')
  }
  const credentials = new Map()
  for (const [providerId, value] of Object.entries(parsed.credentials)) {
    assertProviderId(providerId)
    credentials.set(providerId, oauthCredential(providerId, value))
  }
  return credentials
}

export class OAuthCredentialFileStore {
  constructor(options) {
    this.options = options
    this.credentials = new Map()
    this.closed = false
    this.files = new OwnerFileStore({
      path: options.filename,
      parse: parseOAuthDocument,
      onInvalid: error => options.onError(error),
    })
  }

  async init() {
    try {
      await this.reload()
    } catch (error) {
      this.options.onError(error)
    }
  }

  has(providerId) {
    return this.credentials.has(providerId)
  }

  get(providerId) {
    return this.credentials.get(providerId)
  }

  async read(providerId) {
    return this.credentials.get(providerId)
  }

  async list() {
    return [...this.credentials].map(([providerId, credential]) => ({ providerId, type: credential.type }))
  }

  /** Implement pi-ai's serialized per-provider CredentialStore mutation contract. */
  modify(providerId, mutator) {
    assertProviderId(providerId)
    if (this.closed) return Promise.resolve(this.credentials.get(providerId))
    return this.files.enqueue(async () => {
      const current = this.credentials.get(providerId)
      if (this.closed) return current
      const returned = await mutator(current)
      if (returned === undefined) return current
      const credential = oauthCredential(providerId, returned)
      if (credentialEquals(current, credential)) return current
      const next = new Map(this.credentials)
      next.set(providerId, credential)
      await this.writeCredentials(next)
      this.credentials = next
      this.options.onChanged(providerId)
      return credential
    })
  }

  /** Remove one credential, serialized against refresh and login writes. */
  delete(providerId) {
    assertProviderId(providerId)
    if (this.closed) return Promise.resolve()
    return this.files.enqueue(async () => {
      if (this.closed || !this.credentials.has(providerId)) return
      const next = new Map(this.credentials)
      next.delete(providerId)
      await this.writeCredentials(next)
      this.credentials = next
      this.options.onChanged(providerId)
    })
  }

  /** Replace the document from a fresh read; keeps the last good snapshot on failure. */
  async reload() {
    if (this.closed) return
    const parsed = await this.files.load()
    if (parsed === undefined) return
    this.credentials = parsed ?? new Map()
  }

  async writeCredentials(credentials) {
    await this.files.commit({
      version: FORMAT_VERSION,
      credentials: Object.fromEntries(
        [...credentials.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => [id, value]),
      ),
    })
  }

  async dispose() {
    this.closed = true
    await this.files.close()
  }
}

function credentialEquals(left, right) {
  if (left === right) return true
  if (left === undefined || right === undefined) return false
  return JSON.stringify(left) === JSON.stringify(right)
}
