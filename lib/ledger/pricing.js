/**
 * Price catalog for the usage ledger: an embedded versioned snapshot (derived
 * from LiteLLM's public model prices, converted to integer nano-USD per
 * token), a resolution precedence (override → alias → snapshot), and
 * integer-exact valuation. Money is integer nano-USD (1 USD = 1e9); never a
 * float in the ledger.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SNAPSHOT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'prices', 'snapshot.json')

export const PRICE_VERSION = 'snapshot-v1'

/** USD per million tokens → nano-USD per token (×1000). */
export function usdPerMillionToNano(usdPerMillion) {
  return Math.round(usdPerMillion * 1000)
}

export function loadSnapshot(path = SNAPSHOT_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * A price resolver over the snapshot plus user overrides/aliases. All prices
 * are integer nano-USD per token; `null` fields mean "same category unknown".
 */
export class PriceCatalog {
  constructor({ snapshot = loadSnapshot(), overrides = new Map(), aliases = new Map(), multipliers = new Map() } = {}) {
    this.snapshot = snapshot
    this.overrides = overrides
    this.aliases = aliases
    this.multipliers = multipliers
  }

  /** The canonical model a raw model name resolves to (alias chain, depth 1). */
  canonical(modelRaw) {
    return this.aliases.get(modelRaw) ?? modelRaw
  }

  /** Price entry (nano per token per category) for a raw model name, or null. */
  priceFor(modelRaw) {
    const override = this.overrides.get(modelRaw)
    if (override !== undefined) return { ...override, source: 'override' }
    const canonical = this.canonical(modelRaw)
    if (canonical !== modelRaw) {
      const aliasOverride = this.overrides.get(canonical)
      if (aliasOverride !== undefined) return { ...aliasOverride, source: 'override' }
      // An explicit alias reroutes pricing to the canonical model even when
      // the raw model has its own snapshot entry.
      const viaAlias = this.snapshot.models[canonical]
      if (viaAlias !== undefined) return { ...viaAlias, source: this.snapshot.source ?? 'snapshot' }
    }
    const direct = this.snapshot.models[modelRaw]
    if (direct !== undefined) return { ...direct, source: this.snapshot.source ?? 'snapshot' }
    return null
  }

  multiplierBps(provider) {
    return this.multipliers.get(provider) ?? 10_000
  }
}

const CATEGORIES = ['input', 'output', 'cacheRead', 'cacheWrite'] // reasoning rides inside output

/**
 * Value one usage observation in integer nano-USD. Returns
 * `{ usdNano, version, source }`, or `null` when no price matches. Unknown
 * prices never guess.
 */
export function valueUsage(catalog, { provider, modelRaw, usage }) {
  const price = catalog.priceFor(modelRaw)
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
  return { usdNano: scaled, version: String(catalog.snapshot.version ?? PRICE_VERSION), source: price.source }
}

/** Format integer nano-USD as a plain decimal USD string, no float rounding. */
export function nanoToUsdString(nano) {
  const negative = nano < 0
  const abs = Math.abs(nano)
  const whole = String(Math.floor(abs / 1e9))
  const fraction = String(abs % 1e9).padStart(9, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}
