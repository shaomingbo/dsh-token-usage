/** DSH 0.1.7 provider directory -> redacted SettingsForms adapter.
 * Never infer an entry id or replay a redacted dictionary into configuration.
 * Reads are fresh so llm/adapters-updated needs no private cache invalidation.
 */
export function createProviderSettings({ settings, llm, logger = {} } = {}) {
  const warned = new Set()
  function unavailable(provider) {
    if (!warned.has(provider)) {
      warned.add(provider)
      logger.warn?.('dsh-token-usage: settings unavailable for provider %s (directory or volatile form missing/ambiguous)', provider)
    }
    return undefined
  }
  function read(provider) {
    if (typeof llm?.listConfigurableProviders !== 'function' || typeof settings?.describe !== 'function'
      || typeof settings?.mutate !== 'function') return unavailable(provider)
    const entries = llm.listConfigurableProviders().filter(row => row.provider === provider)
    if (entries.length !== 1) return unavailable(provider)
    const { settingsNs: ns, settingsPath: path } = entries[0]
    if (typeof ns !== 'string' || !Array.isArray(path) || path.some(key => typeof key !== 'string')) return unavailable(provider)
    const descriptor = settings.describe({ redactSecrets: true }).find(row => row.ns === ns)
    if (!descriptor || !Number.isSafeInteger(descriptor.revision)) return unavailable(provider)
    warned.delete(provider)
    return { provider, ns, path: [...path], revision: descriptor.revision,
      value: path.reduce((value, key) => value?.[key], descriptor.value) }
  }
  async function mutate(snapshot, ops) {
    if (!snapshot) throw Object.assign(new Error('provider settings unavailable'), { code: 'settings-unavailable' })
    if (ops.length === 0) return false
    await settings.mutate(snapshot.ns, ops.map(op => ({ ...op, path: [...snapshot.path, ...op.path] })), snapshot.revision)
    return true
  }
  // Object leaves only: preserve undisclosed secrets and unrelated nested fields.
  function fields(patch, prefix = []) {
    return Object.entries(patch).flatMap(([key, value]) => {
      const path = [...prefix, key]
      return value && typeof value === 'object' && !Array.isArray(value)
        ? fields(value, path) : [{ op: 'set', path, value }]
    })
  }
  return { read, mutate, fields }
}
