/**
 * Price catalog for the usage ledger: an embedded versioned snapshot (derived
 * from LiteLLM's public model prices), an explicitly refreshed upstream layer,
 * user aliases/overrides, and integer-exact valuation. Money is integer
 * nano-USD (1 USD = 1e9); never a float in the ledger.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SNAPSHOT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'prices', 'snapshot.json')

export const PRICE_VERSION = 'snapshot-v1'
export const LITELLM_PRICE_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

/** USD per million tokens → nano-USD per token (×1000). */
export function usdPerMillionToNano(usdPerMillion) {
  return Math.round(usdPerMillion * 1000)
}

/** USD per token → nano-USD per token. */
export function usdPerTokenToNano(usdPerToken) {
  return Math.round(Number(usdPerToken) * 1e9)
}

/**
 * Conservative model identity for catalog matching: provider prefixes and
 * release-date suffixes do not change a model's pricing family. Other suffixes
 * (for example `:27b-mlx` or `-flash`) are retained rather than guessed away.
 */
export function normalizeModelKey(value) {
  let key = String(value ?? '').trim().toLowerCase()
  const slash = key.lastIndexOf('/')
  if (slash !== -1) key = key.slice(slash + 1)
  key = key.replaceAll('@', '-')
  key = key.replace(/[-_.](?:20\d{2}-?\d{2}-?\d{2}|20\d{6})$/, '')
  return key
}

export function loadSnapshot(path = SNAPSHOT_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function priceMap(value) {
  if (value instanceof Map) return value
  return new Map(Object.entries(value ?? {}))
}

function normalizedIndex(models) {
  const index = new Map()
  for (const [name, price] of priceMap(models)) {
    const key = normalizeModelKey(name)
    if (!key) continue
    const candidates = index.get(key) ?? []
    candidates.push({ name, price })
    index.set(key, candidates)
  }
  return index
}

function providerKey(value) {
  return String(value ?? '').toLowerCase()
    .replace(/[-_.](?:coding)?(?:-?cn|-?us)$/, '')
    .replace(/[-_.]coding$/, '')
    .replace(/[^a-z0-9]/g, '')
}

function candidateProvider(name) {
  const prefix = String(name).split('/')[0].split('.')[0]
  return providerKey(prefix)
}

function resolveLayer(models, index, model, provider) {
  const map = priceMap(models)
  const direct = map.get(model)
  if (direct !== undefined) return { name: model, price: direct }
  const candidates = index.get(normalizeModelKey(model)) ?? []
  if (candidates.length === 0) return null
  const expectedProvider = providerKey(provider)
  if (expectedProvider) {
    const compatible = candidates.filter((candidate) => {
      const sourceProvider = candidateProvider(candidate.name)
      return sourceProvider === '' || sourceProvider === expectedProvider
        || sourceProvider.includes(expectedProvider) || expectedProvider.includes(sourceProvider)
    })
    if (compatible.length === 1) return compatible[0]
    if (compatible.length > 1) return null // ambiguous provider-specific prices
  }
  // Prefix-free bundled names are safe when unique; prefixed cross-provider
  // prices require an explicit alias selected by the user.
  const prefixFree = candidates.filter((candidate) => !String(candidate.name).includes('/'))
  if (prefixFree.length === 1) return prefixFree[0]
  return null
}

/**
 * Convert LiteLLM's public price JSON to the ledger catalog shape. Entries
 * without both input and output prices are skipped instead of partially
 * guessed. Returns a Map keyed by the source model id.
 */
export function parseLiteLlmPrices(data, { source = 'litellm-upstream', updatedAt = Date.now() } = {}) {
  const result = new Map()
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return result
  for (const [model, entry] of Object.entries(data)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const input = Number(entry.input_cost_per_token)
    const output = Number(entry.output_cost_per_token)
    if (!Number.isFinite(input) || !Number.isFinite(output)) continue
    result.set(model, {
      inputNano: usdPerTokenToNano(input),
      outputNano: usdPerTokenToNano(output),
      cacheReadNano: Number.isFinite(Number(entry.cache_read_input_token_cost))
        ? usdPerTokenToNano(entry.cache_read_input_token_cost)
        : null,
      cacheWriteNano: Number.isFinite(Number(entry.cache_creation_input_token_cost))
        ? usdPerTokenToNano(entry.cache_creation_input_token_cost)
        : null,
      source,
      version: `${source}-${updatedAt}`,
      updatedAt,
    })
  }
  return result
}

/**
 * Price resolver precedence: explicit raw override → alias-target override →
 * alias-target refreshed/snapshot price → refreshed raw/normalized price →
 * bundled raw/normalized snapshot → unknown.
 */
export class PriceCatalog {
  constructor({ snapshot = loadSnapshot(), updates = new Map(), overrides = new Map(), aliases = new Map(), multipliers = new Map() } = {}) {
    this.snapshot = snapshot
    this.overrides = overrides
    this.aliases = aliases
    this.multipliers = multipliers
    this.setUpdates(updates)
    this.snapshotIndex = normalizedIndex(snapshot.models)
  }

  setUpdates(updates) {
    this.updates = priceMap(updates)
    this.updatesIndex = normalizedIndex(this.updates)
  }

  /** The canonical model a raw model name resolves to (alias chain, depth 1). */
  canonical(modelRaw) {
    return this.aliases.get(modelRaw) ?? modelRaw
  }

  resolveCatalogPrice(model, provider) {
    const update = resolveLayer(this.updates, this.updatesIndex, model, provider)
    if (update !== null) return { ...update.price, source: update.price.source ?? 'litellm-upstream', matchedModel: update.name }
    const snapshot = resolveLayer(this.snapshot.models, this.snapshotIndex, model, provider)
    if (snapshot !== null) return { ...snapshot.price, source: this.snapshot.source ?? 'snapshot', matchedModel: snapshot.name }
    return null
  }

  /** Price entry (nano per token per category) for a raw model name, or null. */
  priceFor(modelRaw, provider) {
    const override = this.overrides.get(modelRaw)
    if (override !== undefined) return { ...override, source: 'override', matchedModel: modelRaw }
    const canonical = this.canonical(modelRaw)
    if (canonical !== modelRaw) {
      const aliasOverride = this.overrides.get(canonical)
      if (aliasOverride !== undefined) return { ...aliasOverride, source: 'override', matchedModel: canonical }
      // A user-selected full catalog id is an explicit cross-provider choice.
      const exactUpdate = this.updates.get(canonical)
      if (exactUpdate !== undefined) return { ...exactUpdate, source: exactUpdate.source ?? 'litellm-upstream', matchedModel: canonical }
      const exactSnapshot = this.snapshot.models[canonical]
      if (exactSnapshot !== undefined) return { ...exactSnapshot, source: this.snapshot.source ?? 'snapshot', matchedModel: canonical }
      return this.resolveCatalogPrice(canonical, provider)
    }
    return this.resolveCatalogPrice(modelRaw, provider)
  }

  multiplierBps(provider) {
    return this.multipliers.get(provider) ?? 10_000
  }
}

const CATEGORIES = ['input', 'output', 'cacheRead', 'cacheWrite'] // reasoning rides inside output

/**
 * Value one usage observation in integer nano-USD. Returns
 * `{ usdNano, version, source, matchedModel }`, or `null` when no price
 * matches. Unknown prices never guess.
 */
export function valueUsage(catalog, { provider, modelRaw, usage }) {
  const price = catalog.priceFor(modelRaw, provider)
  if (price === null) return null
  // Input and output prices are essential; refusing to guess a half-known
  // model. Null cache prices mean "not separately billed": they contribute
  // zero instead of invalidating the row.
  if ((usage.input > 0 && typeof price.inputNano !== 'number')
    || (usage.output > 0 && typeof price.outputNano !== 'number')) return null
  let total = 0
  for (const category of CATEGORIES) {
    const tokens = usage[category]
    if (!tokens) continue
    const nano = price[`${category}Nano`]
    if (typeof nano === 'number') total += tokens * nano
  }
  const bps = catalog.multiplierBps(provider)
  const scaled = Math.round((total * bps) / 10_000)
  return {
    usdNano: scaled,
    version: String(price.version ?? catalog.snapshot.version ?? PRICE_VERSION),
    source: price.source,
    matchedModel: price.matchedModel,
  }
}

/** Format integer nano-USD as a plain decimal USD string, no float rounding. */
export function nanoToUsdString(nano) {
  const negative = nano < 0
  const abs = Math.abs(nano)
  const whole = String(Math.floor(abs / 1e9))
  const fraction = String(abs % 1e9).padStart(9, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}
