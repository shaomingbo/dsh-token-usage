import { AccountsError, normalizeRecord, safeAdapterError, toPublicValue } from './domain.js'

/**
 * Registry seam for provider-specific account observation.
 * An adapter has `{ id, observe({ connection, credential, now }) }` and returns
 * one canonical observation. Credential secrets exist only for that call.
 */
export class ProviderAdapterRegistry {
  #adapters = new Map()

  constructor(adapters = []) {
    for (const adapter of adapters) this.register(adapter)
  }

  register(adapter) {
    if (!adapter || typeof adapter.id !== 'string' || adapter.id.length === 0 || typeof adapter.observe !== 'function') {
      throw new AccountsError('invalid-adapter', 'provider adapter requires a non-empty id and observe function')
    }
    if (this.#adapters.has(adapter.id)) throw new AccountsError('duplicate-adapter', `provider adapter already registered: ${adapter.id}`)
    this.#adapters.set(adapter.id, adapter)
    return this
  }

  list() {
    return [...this.#adapters.values()].map((adapter) => Object.freeze({
      id: adapter.id,
      credentialKinds: Object.freeze([...(adapter.credentialKinds ?? [])]),
    }))
  }

  get(providerId) {
    return this.#adapters.get(providerId) ?? null
  }

  async observe(providerId, request = {}) {
    const adapter = this.#adapters.get(providerId)
    if (!adapter) throw new AccountsError('provider-not-registered', `provider adapter is not registered: ${providerId}`)
    const secrets = collectSecrets(request.credential)
    try {
      const raw = await adapter.observe(request)
      const publicValue = toPublicValue(raw, { secrets })
      return normalizeRecord('observation', { ...publicValue, providerId })
    } catch (error) {
      throw safeAdapterError(error)
    }
  }
}

function collectSecrets(credential) {
  if (!credential || typeof credential !== 'object') return []
  return Object.entries(credential)
    .filter(([key, value]) => /secret|token|key|cookie|authorization|password/i.test(key) && typeof value === 'string')
    .map(([, value]) => value)
}
