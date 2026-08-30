/**
 * Bundled product-template catalog for account creation.
 *
 * The catalog is host-side versioned data (templates.json), never client
 * code: prices, windows and provider aliases change with vendor policy and
 * must stay updatable without a client release. Seeding is idempotent: rows
 * live in provider_templates/provider_mappings so later catalog updates (or
 * a user-managed catalog) can supersede the bundled snapshot.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const CATALOG_VERSION = 1
const LIMIT_MODES = new Set(['exact', 'range', 'dynamic', 'unpublished', 'manual'])
const WINDOW_KINDS = new Set(['rolling', 'fixed', 'billing', 'rate'])
const UNITS = new Set(['percent', 'credits', 'tokens', 'usd', 'requests'])
const PRODUCT_KINDS = new Set(['subscription', 'prepaid', 'track_only'])

function fail(message) {
  throw Object.assign(new Error(message), { code: 'invalid-template-catalog' })
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function positiveIntegerOrNull(value, field, index) {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    fail(`templates[${index}].${field} must be a positive integer or null`)
  }
  return value
}

/** Validate an untrusted catalog object; returns the same object when sound. */
export function validateTemplateCatalog(catalog) {
  if (!isPlainObject(catalog)) fail('catalog must be an object')
  if (!Array.isArray(catalog.templates)) fail('catalog.templates must be an array')
  const seenIds = new Set()
  const seenAliases = new Map()
  catalog.templates.forEach((template, index) => {
    const at = `templates[${index}]`
    if (!isPlainObject(template)) fail(`${at} must be an object`)
    for (const field of ['id', 'providerId', 'name', 'kind']) {
      if (typeof template[field] !== 'string' || template[field].trim().length === 0) fail(`${at}.${field} is required`)
    }
    if (!PRODUCT_KINDS.has(template.kind)) fail(`${at}.kind must be one of ${[...PRODUCT_KINDS].join(', ')}`)
    if (seenIds.has(template.id)) fail(`${at}.id duplicates an earlier template`)
    seenIds.add(template.id)
    if (template.color !== null && template.color !== undefined && !/^#[0-9a-fA-F]{3,8}$/.test(String(template.color))) {
      fail(`${at}.color must be a hex color or null`)
    }
    const aliases = template.providerAliases ?? []
    if (!Array.isArray(aliases) || aliases.some((alias) => typeof alias !== 'string' || !alias.trim())) {
      fail(`${at}.providerAliases must be an array of non-empty strings`)
    }
    for (const alias of [template.providerId, ...aliases]) {
      const key = String(alias).toLowerCase()
      const previous = seenAliases.get(key)
      if (previous !== undefined && previous !== template.id) {
        fail(`${at} reuses provider alias "${alias}" already owned by ${previous}`)
      }
      seenAliases.set(key, template.id)
    }
    const tiers = template.tiers ?? []
    if (!Array.isArray(tiers)) fail(`${at}.tiers must be an array`)
    const tierIds = new Set()
    tiers.forEach((tier, tierIndex) => {
      const tierAt = `${at}.tiers[${tierIndex}]`
      if (!isPlainObject(tier)) fail(`${tierAt} must be an object`)
      if (typeof tier.id !== 'string' || !tier.id.trim()) fail(`${tierAt}.id is required`)
      if (typeof tier.name !== 'string' || !tier.name.trim()) fail(`${tierAt}.name is required`)
      if (tierIds.has(tier.id)) fail(`${tierAt}.id duplicates an earlier tier`)
      tierIds.add(tier.id)
      positiveIntegerOrNull(tier.priceUsd, `${tierAt}.priceUsd`, index)
      const limitValues = tier.limitValues ?? {}
      if (!isPlainObject(limitValues)) fail(`${tierAt}.limitValues must be an object`)
      for (const [key, value] of Object.entries(limitValues)) {
        if (!Number.isFinite(value) || value <= 0) fail(`${tierAt}.limitValues.${key} must be a positive number`)
      }
    })
    const limits = template.limits ?? []
    if (!Array.isArray(limits)) fail(`${at}.limits must be an array`)
    const limitKeys = new Set()
    limits.forEach((limit, limitIndex) => {
      const limitAt = `${at}.limits[${limitIndex}]`
      if (!isPlainObject(limit)) fail(`${limitAt} must be an object`)
      if (typeof limit.externalKey !== 'string' || !limit.externalKey.trim()) fail(`${limitAt}.externalKey is required`)
      if (limitKeys.has(limit.externalKey)) fail(`${limitAt}.externalKey duplicates an earlier limit`)
      limitKeys.add(limit.externalKey)
      if (!UNITS.has(limit.unit)) fail(`${limitAt}.unit must be one of ${[...UNITS].join(', ')}`)
      if (!LIMIT_MODES.has(limit.valueMode)) fail(`${limitAt}.valueMode must be one of ${[...LIMIT_MODES].join(', ')}`)
      if (!WINDOW_KINDS.has(limit.windowKind)) fail(`${limitAt}.windowKind must be one of ${[...WINDOW_KINDS].join(', ')}`)
      positiveIntegerOrNull(limit.windowSeconds, `${limitAt}.windowSeconds`, index)
    })
    for (const tier of tiers) {
      for (const key of Object.keys(tier.limitValues ?? {})) {
        if (!limitKeys.has(key)) fail(`${at}: tier ${tier.id} sets limitValues.${key} but no limit declares externalKey "${key}"`)
      }
    }
    if (typeof template.notes !== 'string' && template.notes !== undefined) fail(`${at}.notes must be a string`)
  })
  return catalog
}

/** The bundled catalog shipped with this package. */
export function bundledTemplateCatalog() {
  const path = fileURLToPath(new URL('./templates.json', import.meta.url))
  return validateTemplateCatalog(JSON.parse(readFileSync(path, 'utf8')))
}

/**
 * Idempotently seed a validated catalog into the ledger so templates and
 * provider aliases survive restarts and remain queryable like any other
 * account-domain record. Only bundled rows are touched by re-seeding.
 */
export function seedTemplateCatalog(db, { catalog = bundledTemplateCatalog(), source = 'bundled_catalog', now = Date.now() } = {}) {
  const templates = validateTemplateCatalog(catalog).templates ?? []
  const upsertTemplate = db.prepare(`
    INSERT INTO provider_templates (id, provider_id, name, product_json, limits_json, source_kind, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET provider_id = excluded.provider_id, name = excluded.name,
      product_json = excluded.product_json, limits_json = excluded.limits_json,
      source_kind = excluded.source_kind, updated_at = excluded.updated_at
    WHERE provider_templates.source_kind = 'bundled_catalog'
  `)
  const upsertMapping = db.prepare(`
    INSERT INTO provider_mappings (provider_id, external_key, template_id, created_at)
    VALUES (?, 'default', ?, ?)
    ON CONFLICT(provider_id, external_key) DO UPDATE SET template_id = excluded.template_id
  `)
  for (const template of templates) {
    const productJson = JSON.stringify({
      kind: template.kind,
      color: template.color ?? null,
      providerAliases: [...new Set([template.providerId, ...(template.providerAliases ?? [])])],
      tiers: template.tiers ?? [],
      notes: template.notes ?? null,
      catalogVersion: CATALOG_VERSION,
    })
    upsertTemplate.run(template.id, template.providerId, template.name, productJson, JSON.stringify(template.limits ?? []), source, now)
    for (const alias of new Set([template.providerId, ...(template.providerAliases ?? [])])) {
      upsertMapping.run(String(alias).toLowerCase(), template.id, now)
    }
  }
  return { templates: templates.length, version: CATALOG_VERSION }
}

/** Read the seeded templates back for the RPC surface. */
export function listSeededTemplates(db) {
  return db.prepare('SELECT id, provider_id, name, product_json, limits_json, updated_at FROM provider_templates ORDER BY name, id').all().map((row) => ({
    id: row.id,
    providerId: row.provider_id,
    name: row.name,
    product: JSON.parse(row.product_json),
    limits: JSON.parse(row.limits_json),
    updatedAt: row.updated_at,
    aliases: db.prepare('SELECT provider_id FROM provider_mappings WHERE template_id = ?').all(row.id).map((mapping) => mapping.provider_id),
  }))
}