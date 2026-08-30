const RECORD_TYPES = new Set([
  'connection', 'credential_metadata', 'product', 'billing',
  'limit', 'window', 'observation', 'provider_template', 'provider_mapping',
])

export const LIMIT_MODES = Object.freeze(['exact', 'range', 'dynamic', 'unpublished', 'manual'])
export const WINDOW_KINDS = Object.freeze(['rolling', 'fixed', 'billing', 'rate'])
export const OBSERVATION_SOURCES = Object.freeze([
  'official_usage_api',
  'official_plugin_internal_api',
  'official_ui',
  'official_response',
  'local_ledger',
  'manual',
])

const SECRET_KEYS = new Set([
  'secret', 'token', 'accesstoken', 'refreshtoken', 'apikey', 'password',
  'cookie', 'cookieheader', 'authorization', 'rawauthorization', 'session',
  'sessioncookie', 'sessiontoken',
])

function secretKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '')
}

export class AccountsError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'AccountsError'
    this.code = code
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message }
  }
}

function fail(code, message) {
  throw new AccountsError(code, message)
}

function text(value, field, { optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return null
    fail('invalid-record', `${field} is required`)
  }
  const result = String(value).trim()
  if (result.length === 0) fail('invalid-record', `${field} must not be empty`)
  return result
}

function number(value, field, { optional = false, integer = false, min = 0 } = {}) {
  if (value === undefined || value === null) {
    if (optional) return null
    fail('invalid-record', `${field} is required`)
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || (integer && !Number.isInteger(value))) {
    fail('invalid-record', `${field} must be a ${integer ? 'whole ' : ''}number >= ${min}`)
  }
  return value
}

function timestamp(value, field, { optional = false } = {}) {
  return number(value, field, { optional, integer: true, min: 0 })
}

function enumValue(value, values, field) {
  if (!values.includes(value)) fail('invalid-record', `${field} must be one of: ${values.join(', ')}`)
  return value
}

function optionalObject(value, field) {
  if (value === undefined || value === null) return null
  if (!isPlainObject(value)) fail('invalid-record', `${field} must be an object`)
  return toPublicValue(value)
}

function base(type, input) {
  if (!isPlainObject(input)) fail('invalid-record', `${type} must be an object`)
  return { recordType: type, id: text(input.id, 'id') }
}

function normalizeConnection(input) {
  const result = {
    ...base('connection', input),
    providerId: text(input.providerId, 'providerId'),
    label: text(input.label ?? input.displayName ?? input.id, 'label'),
    accountKey: text(input.accountKey, 'accountKey', { optional: true }),
    status: text(input.status ?? 'unknown', 'status'),
    authKind: text(input.authKind ?? 'none', 'authKind'),
    endpoint: null,
    enabled: input.enabled !== false,
    createdAt: timestamp(input.createdAt ?? 0, 'createdAt'),
    updatedAt: timestamp(input.updatedAt ?? input.createdAt ?? 0, 'updatedAt'),
    metadata: optionalObject(input.metadata, 'metadata'),
  }
  if (input.endpoint !== undefined && input.endpoint !== null) {
    let url
    try { url = new URL(String(input.endpoint)) } catch { fail('invalid-record', 'endpoint must be an absolute URL') }
    if (url.username || url.password || url.search || url.hash) fail('invalid-record', 'endpoint must not contain credentials, query, or fragment')
    result.endpoint = url.href
  }
  return result
}

function normalizeCredentialMetadata(input) {
  for (const key of Object.keys(input ?? {})) {
    if (SECRET_KEYS.has(secretKey(key))) fail('secret-in-public-record', `credential metadata must not contain ${key}`)
  }
  return {
    ...base('credential_metadata', input),
    connectionId: text(input.connectionId, 'connectionId'),
    credentialRef: text(input.credentialRef ?? input.id, 'credentialRef'),
    kind: text(input.kind, 'kind'),
    label: text(input.label ?? input.kind, 'label'),
    fingerprint: text(input.fingerprint, 'fingerprint', { optional: true }),
    hint: text(input.hint, 'hint', { optional: true }),
    scopes: Object.freeze((input.scopes ?? []).map((scope) => text(scope, 'scope'))),
    createdAt: timestamp(input.createdAt ?? 0, 'createdAt'),
    updatedAt: timestamp(input.updatedAt ?? input.createdAt ?? 0, 'updatedAt'),
    expiresAt: timestamp(input.expiresAt, 'expiresAt', { optional: true }),
    lastValidatedAt: timestamp(input.lastValidatedAt, 'lastValidatedAt', { optional: true }),
  }
}

function normalizeProduct(input) {
  return {
    ...base('product', input),
    providerId: text(input.providerId, 'providerId'),
    code: text(input.code ?? input.externalId ?? input.id, 'code'),
    externalId: text(input.externalId ?? input.code, 'externalId', { optional: true }),
    name: text(input.name ?? input.code ?? input.id, 'name'),
    kind: text(input.kind ?? 'unknown', 'kind'),
    sourceKind: text(input.sourceKind ?? 'manual', 'sourceKind'),
    published: input.published !== false,
    archivedAt: timestamp(input.archivedAt, 'archivedAt', { optional: true }),
    createdAt: timestamp(input.createdAt ?? 0, 'createdAt'),
    metadata: optionalObject(input.metadata, 'metadata'),
  }
}

function normalizeBilling(input) {
  return {
    ...base('billing', input),
    connectionId: text(input.connectionId, 'connectionId', { optional: true }),
    productId: text(input.productId, 'productId'),
    model: enumValue(input.model ?? 'unpublished', ['subscription', 'prepaid', 'metered', 'free', 'unpublished'], 'model'),
    currency: text(input.currency, 'currency', { optional: true }),
    amountMinor: number(input.amountMinor, 'amountMinor', { optional: true, integer: true }),
    amountNano: text(input.amountNano, 'amountNano', { optional: true }),
    balanceNano: text(input.balanceNano, 'balanceNano', { optional: true }),
    interval: text(input.interval, 'interval', { optional: true }),
    cycleAnchorDay: number(input.cycleAnchorDay, 'cycleAnchorDay', { optional: true, integer: true, min: 1 }),
    expiresAt: timestamp(input.expiresAt, 'expiresAt', { optional: true }),
    sourceKind: text(input.sourceKind ?? 'manual', 'sourceKind'),
    observedAt: timestamp(input.observedAt ?? input.effectiveAt ?? 0, 'observedAt'),
    effectiveAt: timestamp(input.effectiveAt, 'effectiveAt', { optional: true }),
    metadata: optionalObject(input.metadata, 'metadata'),
  }
}

export function normalizeWindow(input) {
  const result = {
    ...base('window', input),
    kind: enumValue(input.kind, WINDOW_KINDS, 'kind'),
    label: text(input.label ?? input.kind, 'label'),
    durationMs: number(input.durationMs, 'durationMs', { optional: true, integer: true, min: 1 }),
    startsAt: timestamp(input.startsAt, 'startsAt', { optional: true }),
    endsAt: timestamp(input.endsAt, 'endsAt', { optional: true }),
    resetsAt: timestamp(input.resetsAt, 'resetsAt', { optional: true }),
    anchorDay: number(input.anchorDay, 'anchorDay', { optional: true, integer: true, min: 1 }),
    timezone: text(input.timezone, 'timezone', { optional: true }),
  }
  if ((result.kind === 'rolling' || result.kind === 'rate') && result.durationMs === null) fail('invalid-record', `${result.kind} window requires durationMs`)
  if (result.kind === 'fixed') {
    const oneEndpoint = (result.startsAt === null) !== (result.endsAt === null)
    if (oneEndpoint || (result.startsAt !== null && result.endsAt <= result.startsAt)) {
      fail('invalid-record', 'fixed window endpoints must be absent or have endsAt after startsAt')
    }
  }
  if (result.kind === 'billing' && result.anchorDay !== null && result.anchorDay > 28) fail('invalid-record', 'billing anchorDay must be between 1 and 28')
  return result
}

export function normalizeLimit(input) {
  const result = {
    ...base('limit', input),
    connectionId: text(input.connectionId, 'connectionId', { optional: true }),
    productId: text(input.productId, 'productId', { optional: true }),
    windowId: text(input.windowId ?? input.id, 'windowId'),
    externalKey: text(input.externalKey, 'externalKey', { optional: true }),
    window: input.window === undefined || input.window === null ? null : normalizeWindow(input.window),
    metric: text(input.metric, 'metric'),
    unit: text(input.unit, 'unit'),
    mode: enumValue(input.mode, LIMIT_MODES, 'mode'),
    value: number(input.value, 'value', { optional: true }),
    min: number(input.min, 'min', { optional: true }),
    max: number(input.max, 'max', { optional: true }),
    used: number(input.used, 'used', { optional: true }),
    remaining: number(input.remaining, 'remaining', { optional: true }),
    percentUsed: number(input.percentUsed, 'percentUsed', { optional: true }),
    observedAt: timestamp(input.observedAt, 'observedAt', { optional: true }),
    sourceKind: text(input.sourceKind ?? 'manual', 'sourceKind'),
    confidence: text(input.confidence, 'confidence', { optional: true }),
    note: text(input.note, 'note', { optional: true }),
    createdAt: timestamp(input.createdAt ?? input.observedAt ?? 0, 'createdAt'),
    metadata: optionalObject(input.metadata, 'metadata'),
  }
  if ((result.mode === 'exact' || result.mode === 'manual') && result.value === null) fail('invalid-record', `${result.mode} limit requires value`)
  if (result.mode === 'range' && (result.min === null || result.max === null || result.max < result.min)) fail('invalid-record', 'range limit requires max >= min')
  if (result.percentUsed !== null && result.percentUsed > 100) fail('invalid-record', 'percentUsed must be <= 100')
  return result
}

function normalizeObservation(input) {
  const source = enumValue(input.source, OBSERVATION_SOURCES, 'source')
  return {
    ...base('observation', input),
    providerId: text(input.providerId, 'providerId'),
    connectionId: text(input.connectionId, 'connectionId', { optional: true }),
    observedAt: timestamp(input.observedAt, 'observedAt'),
    source,
    brittle: source === 'official_ui' ? true : input.brittle === true,
    complete: input.complete === true,
    quotaApplicable: input.quotaApplicable !== false,
    product: input.product === undefined || input.product === null ? null : normalizeRecord('product', input.product),
    billing: input.billing === undefined || input.billing === null ? null : normalizeRecord('billing', input.billing),
    windows: (input.windows ?? []).map(normalizeWindow),
    limits: (input.limits ?? []).map(normalizeLimit),
    warnings: (input.warnings ?? []).map((warning) => text(warning, 'warning')),
    metadata: optionalObject(input.metadata, 'metadata'),
  }
}

function normalizeProviderTemplate(input) {
  return {
    ...base('provider_template', input),
    providerId: text(input.providerId, 'providerId'),
    name: text(input.name, 'name'),
    credentialKinds: Object.freeze((input.credentialKinds ?? []).map((kind) => text(kind, 'credentialKind'))),
    endpoint: publicEndpoint(input.endpoint),
    product: input.product === undefined || input.product === null ? null : normalizeRecord('product', input.product),
    limits: Object.freeze((input.limits ?? []).map(normalizeLimit)),
    sourceKind: text(input.sourceKind ?? 'manual', 'sourceKind'),
    updatedAt: timestamp(input.updatedAt ?? 0, 'updatedAt'),
    metadata: optionalObject(input.metadata, 'metadata'),
  }
}

function normalizeProviderMapping(input) {
  return {
    ...base('provider_mapping', input),
    providerId: text(input.providerId, 'providerId'),
    externalKey: text(input.externalKey, 'externalKey'),
    templateId: text(input.templateId ?? input.targetId, 'templateId'),
    targetType: input.targetType === undefined ? 'template' : enumValue(input.targetType, ['product', 'limit', 'window', 'template'], 'targetType'),
    targetId: text(input.targetId ?? input.templateId, 'targetId'),
    createdAt: timestamp(input.createdAt ?? 0, 'createdAt'),
    metadata: optionalObject(input.metadata, 'metadata'),
  }
}

export function normalizeRecord(type, input) {
  if (!RECORD_TYPES.has(type)) fail('unknown-record-type', `unknown account record type: ${type}`)
  const result = type === 'connection' ? normalizeConnection(input)
    : type === 'credential_metadata' ? normalizeCredentialMetadata(input)
      : type === 'product' ? normalizeProduct(input)
        : type === 'billing' ? normalizeBilling(input)
          : type === 'limit' ? normalizeLimit(input)
            : type === 'window' ? normalizeWindow(input)
              : type === 'observation' ? normalizeObservation(input)
                : type === 'provider_template' ? normalizeProviderTemplate(input)
                  : normalizeProviderMapping(input)
  return deepFreeze(result)
}

function publicEndpoint(value) {
  if (value === undefined || value === null) return null
  let url
  try { url = new URL(String(value)) } catch { fail('invalid-record', 'endpoint must be an absolute URL') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    fail('invalid-record', 'endpoint must be a credential-free HTTPS URL without query or fragment')
  }
  return url.href
}

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Clone a value for a public result, dropping secret-bearing keys and values. */
export function toPublicValue(value, { secrets = [] } = {}) {
  const secretValues = secrets.filter((secret) => typeof secret === 'string' && secret.length > 0)
  const visit = (current, seen) => {
    if (typeof current === 'string') {
      if (secretValues.some((secret) => current.includes(secret))) return '[REDACTED]'
      return current
    }
    if (current === null || ['number', 'boolean'].includes(typeof current)) return current
    if (typeof current === 'bigint') return current.toString()
    if (Array.isArray(current)) return current.map((entry) => visit(entry, seen))
    if (!isPlainObject(current)) {
      const rendered = String(current)
      return secretValues.some((secret) => rendered.includes(secret)) ? '[REDACTED]' : rendered
    }
    if (seen.has(current)) fail('not-serializable', 'public value must not contain cycles')
    seen.add(current)
    const output = {}
    for (const [key, entry] of Object.entries(current)) {
      if (SECRET_KEYS.has(secretKey(key))) continue
      output[key] = visit(entry, seen)
    }
    seen.delete(current)
    return output
  }
  return visit(value, new Set())
}

export function serializePublic(value, options) {
  return JSON.stringify(toPublicValue(value, options))
}

export function safeAdapterError(error, fallbackCode = 'provider-failed') {
  const code = error instanceof AccountsError ? error.code : fallbackCode
  return new AccountsError(code, 'provider observation failed')
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value
}
