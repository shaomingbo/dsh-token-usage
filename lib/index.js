/**
 * Host half of dsh-token-usage: opens the profile-local ledger, folds live
 * session events, schedules read-only historical import and daily
 * reconciliation, and serves the client over the loopback-only
 * /token-usage channel. Failures stay contained here: the ledger never
 * takes Harness down, and it never stops, restarts, or patches anything.
 */

import { homedir, userInfo } from 'node:os'
import { realpathSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve, sep, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLedgerService, LedgerError } from './ledger/service.js'
import { globMatch } from './ledger/analytics.js'
import { SettingsStore } from './settings.js'
import { requestsToCsv, reportToJson } from './ledger/export.js'
import { createProviderCapabilities } from './capabilities/index.js'
import { registerAccountSearchBackends } from './accounts/search-backends.js'
import { ProviderAdapterRegistry } from './accounts/registry.js'
import { GlmAdapter } from './accounts/adapters/glm.js'
import { allowedCookieHeader, OllamaCloudAdapter, OllamaLocalAdapter } from './accounts/adapters/ollama.js'
import { OllamaCloudModels } from './accounts/ollama-models.js'
import {
  LITELLM_PRICE_URL,
  PriceCatalog,
  nanoToUsdString,
  normalizeModelKey,
  parseLiteLlmPrices,
} from './ledger/pricing.js'

export const name = 'dsh-token-usage'
export const inject = ['connection', 'credentials', 'sessionPersistence', 'settings', 'timer']

const CHANNEL = '/token-usage'
const ACCOUNT_CHANNEL = '/account-usage'
export const ACCOUNT_USAGE_SERVICE = 'accountUsage'
export const ACCOUNT_USAGE_PROTOCOL = 'account-usage/v1'
const DAY = 86_400_000

/**
 * Resolve the profile-private data directory. Conventionally installed
 * copies live under `<home>/profiles/<name>/node_modules/…`, so the real
 * path of this module reveals the profile name; `link:` development falls
 * back to a home-level directory. A row config `dataDir` always wins.
 */
export function resolveDataDir({ moduleUrl = import.meta.url, env = process.env, home } = {}) {
  const dshHome = resolve(home ?? env.DSH_HOME ?? join(homedir(), '.dsh'))
  try {
    const real = realpathSync(fileURLToPath(moduleUrl))
    const marker = `${sep}profiles${sep}`
    const markerIndex = real.lastIndexOf(marker)
    if (markerIndex !== -1) {
      const rest = real.slice(markerIndex + marker.length)
      const profile = rest.split(sep)[0]
      if (profile) return join(dshHome, 'profiles', profile, 'data', 'dsh-token-usage')
    }
  } catch {
    // Fall through to the home-level directory.
  }
  return join(dshHome, 'dsh-token-usage')
}

function defaultIdentity() {
  let name = null
  try {
    name = userInfo().username ?? null
  } catch {
    name = null
  }
  return { displayName: name, accountName: name }
}

function normalizeGitRemote(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  let identity
  const scp = raw.match(/^(?:[^@]+@)?([^:]+):(.+)$/)
  if (scp && !raw.includes('://')) identity = `${scp[1]}/${scp[2]}`
  else {
    try {
      const url = new URL(raw)
      identity = `${url.hostname}${url.pathname}`
    } catch {
      identity = raw.replace(/^[^@]+@/, '')
    }
  }
  return identity.replace(/\.git\/?$/, '').replace(/^\/+|\/+$/g, '') || null
}

/** Resolve a cwd to a credential-free Git project identity without spawning git. */
export function detectGitProject(cwd) {
  if (!cwd) return null
  let current
  try { current = realpathSync(String(cwd)) } catch { return null }
  while (true) {
    const marker = join(current, '.git')
    if (existsSync(marker)) {
      let gitDir = marker
      let configPath = join(gitDir, 'config')
      if (!existsSync(configPath)) {
        try {
          const pointer = readFileSync(marker, 'utf8').match(/^gitdir:\s*(.+)$/m)?.[1]
          if (pointer) gitDir = resolve(current, pointer)
          configPath = join(gitDir, 'config')
          if (!existsSync(configPath)) {
            const common = readFileSync(join(gitDir, 'commondir'), 'utf8').trim()
            configPath = join(resolve(gitDir, common), 'config')
          }
        } catch {
          configPath = ''
        }
      }
      let remote = null
      try {
        const config = readFileSync(configPath, 'utf8')
        const origin = config.match(/\[remote\s+"origin"\]([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1]
        remote = normalizeGitRemote(origin?.match(/^\s*url\s*=\s*(.+)$/m)?.[1])
      } catch {
        remote = null
      }
      const identityValue = remote ?? current
      return { gitRoot: current, gitRemote: remote, identityKind: 'git', identityValue, displayName: basename(current) || identityValue }
    }
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export function apply(ctx, config = {}) {
  const dataDir = config.dataDir !== undefined
    ? resolve(String(config.dataDir))
    : resolveDataDir()
  const settings = new SettingsStore(join(dataDir, 'settings.json'))
  if (settings.get('displayName') === null || settings.get('accountName') === null) {
    const identity = defaultIdentity()
    if (settings.get('displayName') === null) settings.set('displayName', identity.displayName)
    if (settings.get('accountName') === null) settings.set('accountName', identity.accountName)
  }

  // Degraded mode: the ledger opens lazily so a corrupt or unsupported store
  // never blocks this plugin, Harness boot, or any other plugin.
  let service = null
  let lastError = null
  function openLedger() {
    if (service !== null) return service
    try {
      service = createLedgerService({ databasePath: join(dataDir, 'usage.sqlite') })
      lastError = null
    } catch (error) {
      lastError = error instanceof LedgerError
        ? error
        : new LedgerError('ledger-open-failed', error instanceof Error ? error.message : String(error))
      ctx.logger.error('dsh-token-usage: ledger unavailable: %s', lastError.message)
    }
    return service
  }
  openLedger()

  // Provider capabilities are constructed exactly once here. Their owner-only
  // stores retain the historical DSH_HOME paths; only this bundle registers
  // hooks and compatibility RPC channels, preventing an adapter from owning
  // the same proxy, route, timer, or credential refresh twice.
  const capabilityLogger = secretSafeLogger(ctx.logger)
  const capabilities = createProviderCapabilities({
    chatgptGrok: { credentials: ctx.credentials, settings: ctx.settings, logger: capabilityLogger },
    antigravity: { credentials: ctx.credentials, settings: ctx.settings, logger: capabilityLogger },
  })
  const fetchImpl = config.fetchImpl ?? globalThis.fetch
  const providerAdapters = new ProviderAdapterRegistry([
    new GlmAdapter({
      fetch: fetchImpl,
      endpoint: 'https://api.z.ai/api/monitor/usage/quota/limit',
      modelUsageEndpoint: 'https://api.z.ai/api/monitor/usage/model-usage',
      toolUsageEndpoint: 'https://api.z.ai/api/monitor/usage/tool-usage',
    }),
    new OllamaLocalAdapter(),
    new OllamaCloudAdapter({
      fetch: fetchImpl,
      apiKeyValidationEndpoint: 'https://ollama.com/api/tags',
      apiKeyResponseValidator: body => Array.isArray(body.models),
      enableManualCookieScraping: true,
    }),
  ])
  const ollamaModels = new OllamaCloudModels({ fetch: fetchImpl, settings: ctx.settings })
  const ollamaModelsReady = (async () => {
    if (ollamaModels.status().configured) return
    const resolved = await ctx.credentials.resolve('OLLAMA_API_KEY').catch(() => undefined)
    if (typeof resolved?.value !== 'string' || resolved.value.length === 0) return
    await ollamaModels.sync({ apiKey: resolved.value })
  })().catch((error) => {
    capabilityLogger.warn('provider-capability: Ollama Cloud model provisioning failed: %s', error instanceof Error ? error.message : String(error))
  })
  const capabilitiesReady = Promise.all([
    capabilities.chatgptGrok.init(),
    capabilities.antigravity.init({ startProxy: config.providerProxy !== false }),
  ]).catch((error) => {
    ctx.logger.warn('dsh-token-usage: provider capability initialization failed: %s', error instanceof Error ? error.message : String(error))
  })

  ctx.on('llm/stream', (options, next) => (async function* providerCapabilityStream() {
    await capabilities.chatgptGrok.beforeStream(options)
    await capabilities.antigravity.beforeStream(options)
    yield* next()
  })())
  ctx.interval(() => {
    void capabilities.chatgptGrok.refreshCredentials('timer').catch(error => ctx.logger.warn('dsh-token-usage: ChatGPT/Grok credential refresh failed: %s', error instanceof Error ? error.message : String(error)))
    void capabilities.antigravity.refreshCredentials('timer').catch(error => ctx.logger.warn('dsh-token-usage: Antigravity credential refresh failed: %s', error instanceof Error ? error.message : String(error)))
  }, 10 * 60_000)

  // Optional scalar registration: account capability backends can be offered
  // to a host-owned chain without this package taking over orchestration.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['searchChain'], (searchCtx) => {
      const disposers = registerAccountSearchBackends(searchCtx.searchChain, capabilities)
      return () => { for (const dispose of disposers) dispose?.() }
    })
  }

  const gitProjects = new Map()
  function attributeProject(header, led) {
    const cwd = header?.cwd
    if (!cwd) return
    let identity = gitProjects.get(cwd)
    if (identity === undefined) {
      identity = detectGitProject(cwd)
      gitProjects.set(cwd, identity)
    }
    if (identity) led.assignProject({ cwd, ...identity })
  }

  const importState = {
    running: false, paused: false, canceled: false,
    total: 0, done: 0, calls: 0, errors: 0,
    startedAt: null, finishedAt: null, lastError: null,
  }
  let pendingPricePreview = null

  async function fetchPricePreview(led) {
    const response = await fetch(LITELLM_PRICE_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw Object.assign(new Error(`LiteLLM price fetch failed with HTTP ${response.status}`), { code: 'price-source-failed' })
    const updatedAt = Date.now()
    const prices = parseLiteLlmPrices(await response.json(), { updatedAt })
    if (prices.size === 0) throw Object.assign(new Error('LiteLLM returned no complete model prices'), { code: 'price-source-empty' })
    const catalog = led.priceCatalog()
    const previewCatalog = new PriceCatalog({ snapshot: { version: 'preview', source: 'preview', models: {} }, updates: prices })
    const candidateIndex = new Map()
    for (const model of prices.keys()) {
      const key = normalizeModelKey(model)
      const candidates = candidateIndex.get(key) ?? []
      candidates.push(model)
      candidateIndex.set(key, candidates)
    }
    const mappings = catalog.observed.map((row) => ({
      model: row.model,
      provider: row.provider,
      requests: row.requests,
      matched: previewCatalog.priceFor(row.model, row.provider)?.matchedModel ?? null,
      candidates: (candidateIndex.get(normalizeModelKey(row.model)) ?? []).slice(0, 5),
    }))
    pendingPricePreview = {
      prices,
      source: 'litellm-upstream',
      updatedAt,
      expiresAt: updatedAt + 10 * 60_000,
    }
    return {
      fetched: prices.size,
      matchedObserved: mappings.filter((row) => row.matched !== null).length,
      observed: mappings.length,
      mappings: mappings.slice(0, 50),
      updatedAt,
      source: 'LiteLLM',
    }
  }

  async function importSnapshot(snap) {
    // SessionInspection is { meta: SessionHeader, events } — the header lives
    // on `meta`, never on `header`.
    const inspection = await ctx.sessionPersistence.inspect(snap.header.id)
    const header = { ...inspection.meta, revision: snap.revision }
    const result = service.importSession({ header, events: inspection.events }, { source: 'profile' })
    attributeProject(header, service)
    importState.calls += result.imported
  }

  async function runImport({ full = false } = {}) {
    if (service === null || importState.running) return { started: false, reason: importState.running ? 'already-running' : 'unavailable' }
    importState.running = true
    importState.paused = false
    importState.canceled = false
    importState.errors = 0
    importState.lastError = null
    importState.startedAt = Date.now()
    importState.finishedAt = null
    try {
      const snapshots = await ctx.sessionPersistence.listSnapshots()
      service.reconcileSources(snapshots.map((snap) => ({ id: snap.header.id, revision: snap.revision })))
      importState.total = snapshots.length
      importState.done = 0
      for (const snap of snapshots) {
        while (importState.paused && !importState.canceled) await delay(250)
        if (importState.canceled) break
        try {
          attributeProject(snap.header, service)
          const known = service.getSourceMeta(snap.header.id)
          if (!full && known !== null && known.revision === snap.revision) {
            importState.done += 1
            continue
          }
          await importSnapshot(snap)
        } catch (error) {
          importState.errors += 1
          importState.lastError = error instanceof Error ? error.message : String(error)
          ctx.logger.warn('dsh-token-usage: import failed for %s: %s', snap.header.id, importState.lastError)
        }
        importState.done += 1
      }
    } catch (error) {
      importState.errors += 1
      importState.lastError = error instanceof Error ? error.message : String(error)
      ctx.logger.warn('dsh-token-usage: import pass failed: %s', importState.lastError)
    } finally {
      importState.running = false
      importState.finishedAt = Date.now()
    }
    return { started: true }
  }

  // Live capture: post-commit events only. Constructor seeds do not emit;
  // historical import owns everything before the watermark. Creation
  // metadata (cwd, lineage) lives on the durable header, not the session.
  try {
    ctx.on('session/event', (session, event) => {
      if (service === null) return
      try {
        const header = session.header ?? {}
        const usageHeader = {
          id: session.id ?? header.id,
          createdAt: header.createdAt,
          cwd: header.cwd,
          parentSession: header.parentSession,
          seedLength: header.seedLength,
          origin: header.origin,
        }
        service.ingestEvent(usageHeader, event)
        attributeProject(usageHeader, service)
      } catch {
        // Contained: a live-capture failure must never break the feed.
      }
    })
  } catch (error) {
    ctx.logger.warn('dsh-token-usage: live capture unavailable: %s', error instanceof Error ? error.message : String(error))
  }

  // Startup import (background), then a daily reconciliation pass.
  void Promise.resolve().then(() => runImport({ full: false }))
  ctx.interval(() => { void runImport({ full: false }) }, DAY)

  const envelopeFailure = (message, code = 'internal') => ({ ok: false, error: { code, message } })
  const envelopeSuccess = (value) => ({ ok: true, value })

  function requireLedger() {
    if (service === null) openLedger()
    if (service === null) throw Object.assign(new Error(lastError?.message ?? 'ledger unavailable'), { code: 'ledger-unavailable' })
    return service
  }

  function timezone() {
    return settings.get('timezone') ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  }

  function overviewPayload() {
    const tz = timezone()
    const overview = service.getOverview({ timezone: tz })
    const today = service.getDailySeries({ from: isoDate(Date.now(), tz), to: isoDate(Date.now() + DAY, tz), timezone: tz })
    return {
      totals: overview.totals,
      totalsIncludingEstimates: overview.totalsIncludingEstimates,
      estimatedShare: overview.estimatedShare,
      cost: overview.cost,
      streaks: overview.streaks,
      costCnyRate: settings.get('cnyRate'),
      today: today.days[0] ?? null,
    }
  }

  function isoDate(ms, tz) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
  }

  async function credentialConfigured(ref) {
    if (typeof ctx.credentials.describe === 'function') {
      try { return (await ctx.credentials.describe(ref))?.configured === true } catch { return false }
    }
    try {
      const resolved = await ctx.credentials.resolve(ref)
      return typeof resolved?.value === 'string' && resolved.value.length > 0
    } catch {
      return false
    }
  }

  // Antigravity compatibility is an alias to the same capability instance.
  // /subscription-search remains exclusively owned by an installed SearchChain
  // plugin; claiming it here would create duplicate RPC ownership.
  ctx.connection.rpc.handle('/subscription-antigravity', (endpoint, payload, signal) => (
    capabilities.antigravity.handleRpc(endpoint, payload, signal)
  ), { authority: 'loopback' })

  // Official-observation refresh: explicit on the RPC, throttled in the
  // background so the sidebar/dock always carry fresh percentages without
  // hammering providers. Read-only GETs against origin-allowlisted endpoints.
  const OBSERVATION_REFRESH_MIN_INTERVAL = 15 * 60_000
  let lastObservationRefreshAt = 0
  let observationRefreshInFlight = false

  async function refreshAllObservations(body = {}, signal) {
    const [subscriptions, antigravity, glmCredential, ollamaKey] = await Promise.all([
      capabilities.chatgptGrok.handleRpc('usage', { refresh: true }, signal),
      capabilities.antigravity.handleRpc('usage-all', { refresh: true }, signal),
      ctx.credentials.resolve('ANTHROPIC_AUTH_TOKEN').catch(() => undefined),
      ctx.credentials.resolve('OLLAMA_API_KEY').catch(() => undefined),
    ])
    persistCapabilityObservations(requireLedger(),
      subscriptions.ok ? subscriptions.value.providers : [],
      antigravity.ok ? antigravity.value.usages : [])
    const adapterObservations = []
    const observe = async (providerId, credential = {}, extra = {}) => {
      try {
        const observation = await providerAdapters.observe(providerId, { connection: { id: providerId }, credential, signal, ...extra })
        requireLedger().saveAccountObservation(observation)
        adapterObservations.push({ providerId, observation })
      } catch (error) {
        adapterObservations.push({ providerId, error: { code: error?.code ?? 'provider-failed', message: 'provider observation failed' } })
      }
    }
    await observe('ollama-local')
    if (typeof glmCredential?.value === 'string' && glmCredential.value) await observe('glm', { rawAuthorization: glmCredential.value })
    if (typeof ollamaKey?.value === 'string' && ollamaKey.value) await observe('ollama-cloud', { kind: 'api_key', apiKey: ollamaKey.value })
    if (body.ollamaManualCookie === true) {
      const resolved = await ctx.credentials.resolve('OLLAMA_SESSION_COOKIE').catch(() => undefined)
      if (typeof resolved?.value === 'string' && resolved.value.length > 0) {
        const cookieHeader = allowedCookieHeader(resolved.value)
        if (cookieHeader !== resolved.value) await ctx.credentials.set('OLLAMA_SESSION_COOKIE', cookieHeader)
        await observe('ollama-cloud', { kind: 'manual_cookie_header', cookieHeader }, { manualCookieOptIn: true })
      } else {
        adapterObservations.push({ providerId: 'ollama-cloud', error: { code: 'credential-required', message: 'provider observation failed' } })
      }
    }
    return {
      observedAt: Date.now(), sourceKind: 'provider',
      chatgptGrok: subscriptions.ok ? subscriptions.value.providers : [],
      antigravity: antigravity.ok ? antigravity.value.usages : [],
      adapters: adapterObservations,
      localLedgerIncluded: false,
    }
  }

  /** Fire-and-forget, at most once per interval; failures stay silent. */
  function maybeRefreshObservations() {
    if (observationRefreshInFlight) return
    if (Date.now() - lastObservationRefreshAt < OBSERVATION_REFRESH_MIN_INTERVAL) return
    observationRefreshInFlight = true
    void refreshAllObservations({}).catch(() => {}).finally(() => {
      lastObservationRefreshAt = Date.now()
      observationRefreshInFlight = false
    })
  }

  /**
   * Account-creation suggestions: observed ledger traffic joined against the
   * seeded templates and existing accounts. Objective evidence only —
   * provider/model/request counts, never guesses.
   */
  function suggestAccounts(led) {
    const templates = led.accountTemplates()
    const accounts = led.listAccounts()
    const observed = led.priceCatalog().observed
    const providerTotals = new Map()
    for (const row of observed) {
      const provider = String(row.provider ?? 'unknown')
      const entry = providerTotals.get(provider) ?? { provider, requests: 0, models: new Set() }
      entry.requests += Number(row.requests ?? 0)
      entry.models.add(String(row.model ?? ''))
      providerTotals.set(provider, entry)
    }
    const ruleMatches = (provider) => accounts.some((account) => !account.archived && (account.rules ?? []).some((rule) => {
      const pattern = rule.matchProvider
      if (pattern == null || pattern === '') return false
      return globMatch(pattern, provider)
    }))
    const suggestions = []
    for (const template of templates) {
      if (template.id === 'custom') continue
      const aliases = [template.providerId, ...(template.product?.providerAliases ?? [])]
      const matched = [...providerTotals.values()].filter((entry) => aliases.some((alias) => entry.provider === alias || globMatch(`${alias}*`, entry.provider)))
      if (matched.length === 0) continue
      const requests = matched.reduce((sum, entry) => sum + entry.requests, 0)
      const covered = matched.every((entry) => ruleMatches(entry.provider))
      suggestions.push({
        kind: 'template',
        templateId: template.id,
        name: template.name,
        providerId: template.providerId,
        kindOfProduct: template.product?.kind ?? 'track_only',
        tiers: (template.product?.tiers ?? []).map((tier) => ({ id: tier.id, name: tier.name, priceUsd: tier.priceUsd ?? null })),
        suggestedRules: matched.map((entry) => ({ matchProvider: `${entry.provider}*` })),
        evidence: { providers: matched.map((entry) => ({ provider: entry.provider, requests: entry.requests })), requests },
        alreadyCovered: covered,
      })
    }
    const unmatched = [...providerTotals.values()].filter((entry) => !ruleMatches(entry.provider)
      && !suggestions.some((suggestion) => suggestion.evidence.providers.some((provider) => provider.provider === entry.provider)))
    if (unmatched.length > 0) {
      suggestions.push({
        kind: 'custom',
        templateId: 'custom',
        name: '自定义',
        suggestedRules: unmatched.map((entry) => ({ matchProvider: `${entry.provider}*` })),
        evidence: { providers: unmatched.map((entry) => ({ provider: entry.provider, requests: entry.requests })), requests: unmatched.reduce((sum, entry) => sum + entry.requests, 0) },
        alreadyCovered: false,
      })
    }
    suggestions.sort((a, b) => b.evidence.requests - a.evidence.requests)
    return { suggestions }
  }

  async function handleAccountRequest(endpoint, payload, signal) {
    try {
      await Promise.all([capabilitiesReady, ollamaModelsReady])
      const body = payload ?? {}
      if (endpoint === 'summary' || endpoint === 'connections') {
        const [subscriptions, antigravity, glmConfigured, ollamaKeyConfigured, ollamaCookieConfigured] = await Promise.all([
          capabilities.chatgptGrok.handleRpc('providers', {}, signal),
          capabilities.antigravity.handleRpc('accounts', {}, signal),
          credentialConfigured('ANTHROPIC_AUTH_TOKEN'),
          credentialConfigured('OLLAMA_API_KEY'),
          credentialConfigured('OLLAMA_SESSION_COOKIE'),
        ])
        const connections = [
          ...(subscriptions.ok ? subscriptions.value.providers.map(item => ({
            providerId: item.provider, displayName: item.displayName, configured: item.configured === true,
            credentialKind: 'oauth', credentialRef: capabilities.chatgptGrok.credentialRefs[item.provider], observationSource: 'official_usage_api',
          })) : []),
          ...(antigravity.ok ? antigravity.value.accounts.map(item => ({
            providerId: 'antigravity', connectionId: item.accountId, displayName: item.email ?? item.accountId,
            configured: true, active: item.accountId === antigravity.value.activeAccountId,
            credentialKind: 'oauth', credentialRef: capabilities.antigravity.credentialRef, observationSource: 'official_usage_api',
          })) : []),
          { providerId: 'glm', displayName: 'GLM / Z.AI', configured: glmConfigured, credentialKind: 'raw_authorization', credentialRef: 'ANTHROPIC_AUTH_TOKEN', observationSource: 'official_plugin_internal_api' },
          { providerId: 'ollama-local', displayName: 'Ollama Local', configured: true, credentialKind: 'none', quotaApplicable: false, observationSource: 'local_ledger' },
          { providerId: 'ollama-cloud', displayName: 'Ollama Cloud', configured: ollamaKeyConfigured || ollamaCookieConfigured, credentialKind: 'api_key_or_manual_cookie', credentialStatus: ollamaCookieConfigured ? 'manual-cookie' : 'unverified', credentialRef: ollamaCookieConfigured ? 'OLLAMA_SESSION_COOKIE' : 'OLLAMA_API_KEY', observationSource: ollamaCookieConfigured ? 'official_ui' : 'official_response' },
        ]
        const led = requireLedger()
        for (const connection of connections) led.saveAccountConnection(connection)
        // Zero-config accounts: every configured connection becomes one
        // product with default attribution rules, so the dashboard works the
        // moment a provider is signed in. Archived auto accounts stay archived.
        const templates = led.accountTemplates()
        const aliasesByProvider = new Map()
        for (const template of templates) {
          for (const alias of [template.providerId, ...(template.product?.providerAliases ?? [])]) {
            aliasesByProvider.set(alias, [template.providerId, ...(template.product?.providerAliases ?? [])])
          }
        }
        const activeAntigravity = antigravity.ok ? antigravity.value.activeAccountId : null
        for (const connection of connections) {
          if (connection.configured !== true) continue
          // Only the active Antigravity account routes local traffic; other
          // accounts still show their official observations.
          const attributable = connection.providerId !== 'antigravity' || connection.connectionId === activeAntigravity
          led.ensureConnectionAccount(connection, {
            aliases: aliasesByProvider.get(connection.providerId) ?? [connection.providerId],
            attributable,
          })
        }
        maybeRefreshObservations()
        return envelopeSuccess({
          product: { name: 'DSH Accounts & Usage', version: '5.0.0' },
          adapters: providerAdapters.list(),
          connections,
          modelCatalogs: [{ ...ollamaModels.status(), credentialConfigured: ollamaKeyConfigured }],
          antigravity: antigravity.ok ? {
            activeAccountId: antigravity.value.activeAccountId,
            autoFailover: antigravity.value.autoFailover,
          } : null,
          privacy: { secretsInRpc: false, secretsInSqlite: false, localLedgerSeparate: true },
        })
      }
      if (endpoint === 'templates') {
        return envelopeSuccess({ templates: requireLedger().accountTemplates() })
      }
      if (endpoint === 'accounts') {
        return envelopeSuccess({ accounts: requireLedger().listAccounts() })
      }
      if (endpoint === 'suggest-accounts') {
        return envelopeSuccess(suggestAccounts(requireLedger()))
      }
      if (endpoint === 'save-account') {
        const account = body.account ?? {}
        // The wizard may carry suggested rules; credentials or secrets are
        // never accepted on this channel.
        const result = requireLedger().saveAccount(account)
        return envelopeSuccess(result)
      }
      if (endpoint === 'archive-account') {
        const result = requireLedger().archiveAccount(String(body.id), { archived: body.archived !== false })
        return envelopeSuccess(result)
      }
      if (endpoint === 'sync-model-catalog') {
        if (body.refresh !== true) throw Object.assign(new Error('model catalog synchronization requires explicit refresh=true'), { code: 'explicit-refresh-required' })
        if (body.providerId !== 'ollama-cloud') throw Object.assign(new Error('only the Ollama Cloud model catalog can be synchronized'), { code: 'unsupported-provider' })
        const resolved = await ctx.credentials.resolve('OLLAMA_API_KEY')
        const result = await ollamaModels.sync({ apiKey: resolved?.value, signal })
        return envelopeSuccess({ ...result, syncedAt: Date.now() })
      }
      if (endpoint === 'observe-provider') {
        if (body.refresh !== true) throw Object.assign(new Error('provider observation refresh requires explicit refresh=true'), { code: 'explicit-refresh-required' })
        const providerId = String(body.providerId ?? '')
        const connection = { id: typeof body.connectionId === 'string' ? body.connectionId : providerId }
        let credential = {}
        if (providerId === 'glm') {
          const resolved = await ctx.credentials.resolve('ANTHROPIC_AUTH_TOKEN')
          credential = { rawAuthorization: resolved?.value }
        } else if (providerId === 'ollama-cloud') {
          const manual = body.mode === 'manual-cookie'
          const ref = manual ? 'OLLAMA_SESSION_COOKIE' : 'OLLAMA_API_KEY'
          const resolved = await ctx.credentials.resolve(ref)
          if (manual) {
            const cookieHeader = allowedCookieHeader(resolved?.value)
            if (cookieHeader !== resolved?.value) await ctx.credentials.set(ref, cookieHeader)
            credential = { kind: 'manual_cookie_header', cookieHeader }
          } else {
            credential = { kind: 'api_key', apiKey: resolved?.value }
          }
        }
        const observation = await providerAdapters.observe(providerId, {
          connection, credential, signal,
          ...(providerId === 'ollama-cloud' && body.mode === 'manual-cookie' ? { manualCookieOptIn: true } : {}),
        })
        requireLedger().saveAccountObservation(observation)
        return envelopeSuccess({ observation })
      }
      if (endpoint === 'observations') {
        return envelopeSuccess({ observations: requireLedger().listAccountObservations({ connectionId: body.connectionId, limit: body.limit }) })
      }
      if (endpoint === 'refresh-observations') {
        if (body.refresh !== true) throw Object.assign(new Error('provider observation refresh requires explicit refresh=true'), { code: 'explicit-refresh-required' })
        return envelopeSuccess(await refreshAllObservations(body, signal))
      }
      if (endpoint === 'connection-action') {
        const provider = String(body.provider ?? '')
        const action = String(body.action ?? '')
        // Callback URLs and raw credential material stay off the unified RPC.
        if (action === 'paste-callback' || /token|key|cookie|authorization/i.test(JSON.stringify(body))) {
          throw Object.assign(new Error('credential material is not accepted by /account-usage'), { code: 'secret-rejected' })
        }
        const capability = provider === 'antigravity' ? capabilities.antigravity : capabilities.chatgptGrok
        return await capability.handleRpc(action, body.params ?? {}, signal)
      }
      return envelopeFailure(`unknown account-usage endpoint: ${endpoint}`)
    } catch (error) {
      return envelopeFailure(error instanceof Error ? error.message : 'account-usage request failed', error?.code)
    }
  }

  async function accountUsageValue(endpoint, payload, signal) {
    const result = await handleAccountRequest(endpoint, payload, signal)
    if (result.ok) return result.value
    throw Object.assign(new Error(result.error?.message ?? 'account usage request failed'), { code: result.error?.code ?? 'internal' })
  }
  const accountUsage = Object.freeze({
    protocol: ACCOUNT_USAGE_PROTOCOL,
    list: signal => accountUsageValue('summary', {}, signal),
    observe: (request, signal) => accountUsageValue('observe-provider', { ...request, refresh: true }, signal),
    observations: (request = {}, signal) => accountUsageValue('observations', request, signal),
  })
  ctx.provide(ACCOUNT_USAGE_SERVICE, accountUsage)
  ctx.connection.rpc.handle(ACCOUNT_CHANNEL, handleAccountRequest, { authority: 'loopback' })

  ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload, signal) => {
    try {
      const led = requireLedger()
      const body = payload ?? {}
      switch (endpoint) {
        case 'constrain':
          return envelopeSuccess(led.constrain(body.filter ?? {}, body.patch ?? {}))
        case 'query':
          return envelopeSuccess(led.query({
            ...body,
            filter: { ...(body.filter ?? {}), timezone: body.filter?.timezone ?? timezone() },
          }))
        case 'inspect':
          return envelopeSuccess(led.inspect({
            ...body,
            filter: { ...(body.filter ?? {}), timezone: body.filter?.timezone ?? timezone() },
          }))
        case 'projects':
          return envelopeSuccess(led.listProjects())
        case 'plans':
          return envelopeSuccess(led.listPlans())
        case 'save-plan':
          return envelopeSuccess(led.savePlan(body.plan ?? {}))
        case 'archive-plan':
          return envelopeSuccess(led.archivePlan(String(body.id), { archived: body.archived !== false }))
        case 'save-plan-rules':
          return envelopeSuccess(led.savePlanRules(String(body.planId), body.rules ?? []))
        case 'entry-summary':
          // The sidebar entry polls frequently; piggy-back a throttled official
          // observation refresh so entry meters stay fresh without a timer.
          maybeRefreshObservations()
          return envelopeSuccess(led.entrySummary({ timezone: timezone() }))
        case 'assign-project':
          return envelopeSuccess(led.assignProject(body))
        case 'update-project':
          return envelopeSuccess(led.updateProject(String(body.id), body.patch ?? {}))
        case 'correct-request':
          return envelopeSuccess(led.correctRequest(String(body.id), body.correction ?? {}))
        case 'revoke-correction':
          return envelopeSuccess(led.revokeCorrection(Number(body.id)))
        case 'set-budget':
          return envelopeSuccess(led.setBudget(body))
        case 'archive-budget':
          return envelopeSuccess(led.archiveBudget(String(body.id)))
        case 'overview':
          return envelopeSuccess({ ...overviewPayload(), identity: publicIdentity(settings), profile: profileLabel() })
        case 'daily': {
          const tz = body.timezone ?? timezone()
          const to = body.to ?? isoDate(Date.now() + DAY, tz)
          const from = body.from ?? isoDate(Date.now() - 364 * DAY, tz)
          return envelopeSuccess(led.getDailySeries({ from, to, timezone: tz }))
        }
        case 'rankings': {
          const days = Number.isFinite(body.days) ? Number(body.days) : 30
          const toMs = Date.now()
          return envelopeSuccess(led.getRankings({ dimension: body.dimension ?? 'model', timezone: timezone(), fromMs: toMs - days * DAY, toMs }))
        }
        case 'requests':
          return envelopeSuccess(led.listRequests({
            sessionId: body.sessionId, model: body.model, provider: body.provider,
            status: body.status, estimated: body.estimated,
            fromMs: body.fromMs, toMs: body.toMs,
            limit: body.limit ?? 50, offset: body.offset ?? 0,
          }))
        case 'sessions':
          return envelopeSuccess(led.listSessions({ timezone: timezone(), limit: body.limit ?? 100, offset: body.offset ?? 0 }))
        case 'session-detail':
          return envelopeSuccess(led.getSessionDetail(String(body.id), { timezone: timezone() }))
        case 'import-status':
          return envelopeSuccess({ ...importState })
        case 'import-control': {
          const action = body.action
          if (action === 'pause') importState.paused = true
          else if (action === 'resume') importState.paused = false
          else if (action === 'cancel') importState.canceled = true
          else if (action === 'scan') void runImport({ full: body.full === true })
          else throw new Error(`unknown import action: ${String(action)}`)
          return envelopeSuccess({ ...importState })
        }
        case 'settings':
          return envelopeSuccess({
            settings: settings.toJSON(),
            aliases: ledDump(led, 'aliases'),
            overrides: ledDump(led, 'price_overrides'),
            updates: ledDump(led, 'price_updates'),
            multipliers: ledDump(led, 'providers'),
            priceSnapshot: led.snapshotMeta(),
          })
        case 'price-catalog':
          return envelopeSuccess(led.priceCatalog())
        case 'price-refresh-preview':
          return envelopeSuccess(await fetchPricePreview(led))
        case 'price-refresh-apply': {
          if (pendingPricePreview === null || pendingPricePreview.expiresAt < Date.now()) {
            await fetchPricePreview(led)
          }
          const pending = pendingPricePreview
          const result = led.setUpstreamPrices(pending.prices, {
            source: pending.source,
            updatedAt: pending.updatedAt,
          })
          pendingPricePreview = null
          return envelopeSuccess(result)
        }
        case 'set-setting': {
          const value = settings.set(String(body.key), body.value)
          return envelopeSuccess({ key: body.key, value })
        }
        case 'set-alias':
          led.setAlias(String(body.model), String(body.canonical))
          return envelopeSuccess({})
        case 'set-override':
          led.setOverride(String(body.model), {
            inputNano: Number(body.inputNano), outputNano: Number(body.outputNano),
            cacheReadNano: body.cacheReadNano !== undefined ? Number(body.cacheReadNano) : undefined,
            cacheWriteNano: body.cacheWriteNano !== undefined ? Number(body.cacheWriteNano) : undefined,
          })
          return envelopeSuccess({})
        case 'set-multiplier':
          led.setMultiplier(String(body.provider), Number(body.bps))
          return envelopeSuccess({})
        case 'export': {
          const content = exportContent(led, body)
          return envelopeSuccess(content)
        }
        case 'backup': {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-')
          const path = join(dataDir, 'backups', `usage-${stamp}.sqlite`)
          led.backupTo(path)
          return envelopeSuccess({ path })
        }
        case 'restore': {
          // Restorable files live in the plugin's own backups directory.
          const backupsDir = join(dataDir, 'backups')
          const resolvedPath = resolve(String(body.path))
          if (resolvedPath !== backupsDir && !resolvedPath.startsWith(backupsDir + sep)) {
            throw Object.assign(new Error('restore path must be inside the plugin backups directory'), { code: 'bad-backup-path' })
          }
          led.restoreFrom(resolvedPath, { mode: body.mode === 'replace' ? 'replace' : 'merge' })
          return envelopeSuccess({})
        }
        case 'purge': {
          const days = Number(body.days)
          if (!Number.isFinite(days) || days <= 0) throw new Error('purge requires a positive day count')
          const cutoff = Date.now() - days * DAY
          const result = led.purgeBefore(cutoff, { timezone: timezone() })
          return envelopeSuccess({ cutoff, ...result })
        }
        default:
          return envelopeFailure(`unknown token-usage endpoint: ${endpoint}`)
      }
    } catch (error) {
      return envelopeFailure(
        error instanceof Error ? error.message : 'token-usage request failed',
        error?.code,
      )
    }
  }, { authority: 'loopback' })

  function ledDump(led, table) {
    return led.dumpTable(table)
  }

  function publicIdentity(store) {
    const displayName = store.get('displayName') ?? 'local user'
    const accountName = store.get('accountName') ?? displayName
    const avatarDataUrl = store.get('avatarDataUrl')
    const initials = String(displayName).slice(0, 2).toUpperCase()
    return { displayName, accountName, avatarDataUrl, initials }
  }

  function profileLabel() {
    return config.profileLabel ?? null
  }

  function exportContent(led, body) {
    const kind = body.kind ?? 'requests-csv'
    if (kind === 'requests-csv') {
      const rows = []
      let cursor = null
      do {
        const page = led.query({
          filter: { ...(body.filter ?? { time: { preset: 'all' } }), timezone: body.filter?.timezone ?? timezone() },
          views: ['page'],
          page: { entity: 'request', limit: 200, cursor },
        }).page
        rows.push(...page.rows)
        cursor = page.nextCursor
      } while (cursor !== null && rows.length < 100_000)
      return {
        filename: `token-usage-requests-${new Date().toISOString().slice(0, 10)}.csv`,
        mime: 'text/csv',
        content: requestsToCsv(rows, { anonymize: body.anonymize !== false, nanoToUsd: nanoToUsdString }),
      }
    }
    if (kind === 'report-json') {
      const tz = timezone()
      const filter = { ...(body.filter ?? { time: { preset: 'all' } }), timezone: body.filter?.timezone ?? tz }
      const report = {
        generatedAt: new Date().toISOString(),
        timezone: tz,
        filter,
        analysis: led.query({
          filter,
          views: ['kpis', 'series', 'rankings', 'insights', 'activity', 'budgets'],
          series: { granularity: 'auto' },
          ranking: { dimension: 'project', by: 'processingTokens', limit: 20 },
          compare: { kind: 'previous-period' },
        }),
      }
      return {
        filename: `token-usage-report-${new Date().toISOString().slice(0, 10)}.json`,
        mime: 'application/json',
        content: JSON.stringify(reportToJson(report, { anonymize: body.anonymize !== false }), null, 2),
      }
    }
    throw new Error(`unknown export kind: ${String(kind)}`)
  }

  ctx.on('dispose', () => {
    service?.dispose()
    service = null
    void capabilities.dispose()
  })
}

function persistCapabilityObservations(ledger, subscriptions, antigravity) {
  const observedAt = Date.now()
  for (const usage of subscriptions) {
    if (usage?.available !== true) continue
    const windows = (usage.windows ?? []).map(window => ({
      id: `${usage.provider}:${window.id}`, kind: 'rolling', label: window.id,
      durationMs: Math.max(1, Number(window.windowSeconds ?? 1)) * 1000,
      resetsAt: window.resetsAt ?? null,
    }))
    const limits = (usage.windows ?? []).map(window => ({
      id: `${usage.provider}:${window.id}:limit`, windowId: `${usage.provider}:${window.id}`,
      metric: 'subscription_usage', unit: 'percent', mode: 'dynamic', percentUsed: window.usedPercent,
      observedAt,
    }))
    ledger.saveAccountObservation({
      id: `${usage.provider}:usage:${observedAt}`, providerId: usage.provider,
      connectionId: `${usage.provider}:default`, observedAt, source: 'official_usage_api', brittle: false,
      complete: true, quotaApplicable: true, windows, limits, warnings: [], metadata: null,
    })
  }
  for (const usage of antigravity) {
    if (usage?.configured !== true || !Array.isArray(usage.models)) continue
    const windows = usage.models.map(model => ({
      id: `antigravity:${usage.accountId}:${model.id}:window`, kind: 'fixed', label: model.id,
      resetsAt: model.resetsAt && Number.isFinite(Date.parse(model.resetsAt)) ? Date.parse(model.resetsAt) : null,
    }))
    const limits = usage.models.map(model => ({
      id: `antigravity:${usage.accountId}:${model.id}:limit`,
      windowId: `antigravity:${usage.accountId}:${model.id}:window`,
      metric: model.id, unit: 'percent', mode: 'dynamic',
      percentUsed: typeof model.remaining === 'number' ? Math.max(0, Math.min(100, (1 - model.remaining) * 100)) : null,
      observedAt,
    }))
    ledger.saveAccountObservation({
      id: `antigravity:${usage.accountId}:usage:${observedAt}`, providerId: 'antigravity',
      connectionId: usage.accountId, observedAt, source: 'official_usage_api', brittle: false,
      complete: true, quotaApplicable: true, windows, limits, warnings: [], metadata: null,
    })
  }
}

export function secretSafeLogger(logger) {
  const clean = value => {
    if (typeof value !== 'string') return value
    return value.slice(0, 500)
      .replace(/(authorization|cookie|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
      .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?\b/g, '[REDACTED]')
  }
  return {
    info(format, ...args) { logger.info(clean(format), ...args.map(clean)) },
    warn(format, ...args) { logger.warn(clean(format), ...args.map(clean)) },
    error(format, ...args) { logger.error(clean(format), ...args.map(clean)) },
  }
}

function delay(ms) {
  return new Promise((resolvePromise) => { setTimeout(resolvePromise, ms) })
}
