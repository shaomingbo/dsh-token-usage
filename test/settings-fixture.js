import assert from 'node:assert/strict'
import { createProviderSettings } from '../lib/provider-settings.js'

/** 0.1.7 SettingsForms shape, deliberately no get/update compatibility shim. */
export function settingsFixture(value = {}, { ns = 'llm-pi-ai', providers = ['openai-codex', 'grok-build', 'antigravity', 'ollama-cloud'], base = {} } = {}) {
  const forms = {
    value: structuredClone(value), revision: 0, calls: [],
    describe(options) {
      assert.equal(options?.redactSecrets, true)
      return [{ ns, value: this.value[ns] ?? {}, revision: this.revision, applies: 'live', schema: {} }]
    },
    async mutate(namespace, ops, revision) {
      assert.equal(namespace, ns)
      if (revision !== this.revision) throw Object.assign(new Error('stale form'), { code: 'SETTINGS_CONFLICT' })
      this.calls.push({ namespace, ops: structuredClone(ops), revision })
      this.value[ns] ??= {}
      for (const op of ops) {
        let into = this.value[ns]
        for (const key of op.path.slice(0, -1)) into = (into[key] ??= {})
        const key = op.path.at(-1)
        if (op.op === 'set') into[key] = structuredClone(op.value)
        else if (Array.isArray(into)) into.splice(Number(key), 1)
        else {
          const inherited = op.path.reduce((node, part) => node?.[part], base)
          if (inherited === undefined) delete into[key]
          else into[key] = structuredClone(inherited)
        }
      }
      this.revision++
    },
  }
  const llm = { listConfigurableProviders: () => providers.map(provider => ({ provider, displayName: provider, settingsNs: ns, settingsPath: ['providers', provider] })) }
  const adapter = createProviderSettings({ settings: forms, llm })
  return Object.assign(adapter, { value: forms.value, forms, llm })
}
