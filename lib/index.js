/**
 * Host half of dsh-token-usage: opens the profile-local ledger, folds live
 * session events, schedules read-only historical import and daily
 * reconciliation, and serves the client over the Connection-authenticated
 * /token-usage channel. Failures stay contained here: the ledger never
 * takes Harness down, and it never stops, restarts, or patches anything.
 */

import { homedir, userInfo } from 'node:os'
import { realpathSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve, sep, dirname, basename } from 'node:path'
import { createLedgerService, LedgerError } from './ledger/service.js'
import { headerFromInspection, listSessionSnapshots, readSessionInspection } from './session-import.js'
import { globMatch } from './ledger/analytics.js'
import { SettingsStore } from './settings.js'
import { createProviderSettings } from './provider-settings.js'
import { requestsToCsv, reportToJson } from './ledger/export.js'
import { createProviderCapabilities } from './capabilities/index.js'
import { registerAccountSearchBackends } from './accounts/search-backends.js'
import { createCodexRuntime } from './capabilities/codex-native/runtime.js'
import { createCodexModelFacts } from './capabilities/codex-native/model-facts.js'
import { createCodexModelSync } from './capabilities/codex-native/model-sync.js'
import { chatgptRouteModels } from './capabilities/chatgpt-grok/capability.js'
import { CREDENTIAL_REFS } from './capabilities/chatgpt-grok/credential-refs.js'
import { ProviderAdapterRegistry } from './accounts/registry.js'
import { GlmAdapter } from './accounts/adapters/glm.js'
import { glmMonitorEndpoints, selectGlmCredential } from './accounts/glm-credential.js'
import { allowedCookieHeader, OllamaCloudAdapter, OllamaLocalAdapter } from './accounts/adapters/ollama.js'
import { OllamaCloudModels } from './accounts/ollama-models.js'
import { resolveDataDir as resolveProfileDataDir, resolveDataIdentity, resolveHome } from './observations/data-dir.js'
import {
  CLIENT_POLL_STREAM_MS,
  OBSERVATION_REFRESH_ACTIVE_MS,
  OBSERVATION_REFRESH_LULL_MS,
  createObservationFreshness,
  dataStatusFromWindow,
  observationKey,
  observationRefreshDue,
  quotaCapabilityFor,
} from './observations/freshness.js'

import {
  LITELLM_PRICE_URL,
  PriceCatalog,
  nanoToUsdString,
  normalizeModelKey,
  parseLiteLlmPrices,
} from './ledger/pricing.js'

export {
  CLIENT_POLL_STREAM_MS,
  OBSERVATION_REFRESH_ACTIVE_MS,
  OBSERVATION_REFRESH_LULL_MS,
  observationRefreshDue,
}

export const name = 'dsh-token-usage'
// Explicit public service owners in the 0.1.7 composition.
export const inject = ['connection', 'credentials', 'llm', 'sessionPersistence', 'settings', 'timer', 'webServer']

const CHANNEL = '/token-usage'
const ACCOUNT_CHANNEL = '/account-usage'
const ANTIGRAVITY_CHANNEL = '/subscription-antigravity'
const TOKEN_USAGE_ENDPOINTS = Object.freeze([
  'constrain', 'query', 'inspect', 'projects', 'plans', 'save-plan', 'archive-plan', 'save-plan-rules',
  'entry-summary', 'assign-project', 'update-project', 'correct-request', 'revoke-correction',
  'set-budget', 'archive-budget', 'overview', 'daily', 'rankings', 'requests', 'sessions',
  'session-detail', 'import-status', 'import-control', 'settings', 'price-catalog',
  'price-refresh-preview', 'price-refresh-apply', 'set-setting', 'set-alias', 'set-override',
  'set-multiplier', 'export', 'backup', 'restore', 'purge',
])
const ACCOUNT_USAGE_ENDPOINTS = Object.freeze([
  'connections', 'summary', 'templates', 'accounts', 'suggest-accounts', 'save-account',
  'archive-account', 'sync-model-catalog', 'observe-provider', 'observations',
  'refresh-observations', 'connection-action', 'models.preview', 'models.apply',
])
const ANTIGRAVITY_ENDPOINTS = Object.freeze([
  'providers', 'accounts', 'start-login', 'paste-callback', 'login-status', 'pending-login',
  'cancel-login', 'activate-account', 'remove-account', 'set-auto-failover', 'logout',
  'usage', 'usage-all', 'models', 'diagnostics',
])
export const ACCOUNT_USAGE_SERVICE = 'accountUsage'
export const ACCOUNT_USAGE_PROTOCOL = 'account-usage/v1'
const DAY = 86_400_000

/**
 * Absolute deadline for one observation round. Every provider call inside a
 * round is bounded by it (merged into each fetch signal), so a single hung
 * provider fetch can never leave the round — and with it the shared
 * single-flight flag — pending forever.
 */
export const OBSERVATION_ROUND_TIMEOUT_MS = 45_000

/**
 * Resolve the profile-private data directory. Identity is the running DSH
 * profile, never the realpath of this module. A row config `dataDir` always wins.
 */
export function resolveDataDir(options = {}) {
  return resolveProfileDataDir({ moduleUrl: import.meta.url, env: process.env, ...options })
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
  const dshHome = resolveHome()
  const dataIdentity = config.dataDir !== undefined
    ? {
        path: resolve(String(config.dataDir)),
        useDir: resolve(String(config.dataDir)),
        unresolved: false,
        migrationPending: false,
        ledgerUnavailable: false,
      }
    : resolveDataIdentity({ home: dshHome, profile: config.profile, env: process.env })
  const dataDir = dataIdentity.useDir ?? dataIdentity.path
  if (dataIdentity.unresolved === true) {
    ctx.logger.warn('dsh-token-usage: profile identity is ambiguous (%s); not guessing among candidates', (dataIdentity.candidates ?? []).join(','))
  }
  if (dataIdentity.migrationPending === true) {
    ctx.logger.warn(
      'dsh-token-usage: profile dataDir %s has no ledger; keeping home-level %s until an explicit migrate',
      dataIdentity.path, dataIdentity.orphanHomeDir,
    )
  }
  if (!dataDir || dataIdentity.ledgerUnavailable === true) {
    ctx.logger.warn('dsh-token-usage: ledger identity unresolved and no existing home-level store')
  }
  const settings = new SettingsStore(join(dataDir ?? join(dshHome, 'dsh-token-usage'), 'settings.json'))
  if (settings.get('displayName') === null || settings.get('accountName') === null) {
    const identity = defaultIdentity()
    if (settings.get('displayName') === null) settings.set('displayName', identity.displayName)
    if (settings.get('accountName') === null) settings.set('accountName', identity.accountName)
  }

  const ollamaCacheEstimateBps = () => {
    const pct = Number(settings.get('ollamaCloudCacheEstimatePct'))
    return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? Math.round(pct * 100) : 9_500
  }

  // Degraded mode: the ledger opens lazily so a corrupt or unsupported store
  // never blocks this plugin, Harness boot, or any other plugin.
  let service = null
  let lastError = null
  // Analytics lifecycle scope: owns only the usage-store handle and the
  // analytics RPC/import surface built on it. Stopping it closes the store
  // and forbids a silent reopen behind a stopped scope; it never disposes
  // provider capabilities, unregisters account connections, or cancels
  // in-flight codex-runtime/v1 leases — those belong to account ownership,
  // released only by the Host dispose of this bundle.
  let analyticsStopped = false
  function stopAnalyticsLifecycle() {
    analyticsStopped = true
    service?.dispose()
    service = null
  }
  function openLedger() {
    if (service !== null) return service
    if (analyticsStopped) {
      lastError = new LedgerError('analytics-stopped', 'usage analytics lifecycle has been stopped')
      return null
    }
    if (!dataDir || dataIdentity.ledgerUnavailable === true) {
      lastError = new LedgerError('identity-unresolved', 'account ledger identity is unresolved')
      return null
    }
    try {
      service = createLedgerService({
        databasePath: join(dataDir, 'usage.sqlite'),
        ollamaCacheEstimateBps: ollamaCacheEstimateBps(),
      })
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
  const fetchImpl = config.fetchImpl ?? globalThis.fetch
  const providerSettings = createProviderSettings({ settings: ctx.settings, llm: ctx.llm, logger: capabilityLogger })
  const capabilities = createProviderCapabilities({
    chatgptGrok: { credentials: ctx.credentials, settings: providerSettings, logger: capabilityLogger, fetchImpl },
    antigravity: { credentials: ctx.credentials, settings: providerSettings, logger: capabilityLogger, fetchImpl },
  })
  const glmAdapterFor = (origin) => new GlmAdapter({ fetch: fetchImpl, ...glmMonitorEndpoints(origin) })
  const providerAdapters = new ProviderAdapterRegistry([
    glmAdapterFor('https://api.z.ai'),
    new OllamaLocalAdapter(),
    new OllamaCloudAdapter({
      fetch: fetchImpl,
      apiKeyValidationEndpoint: 'https://ollama.com/api/tags',
      apiKeyResponseValidator: body => Array.isArray(body.models),
      enableManualCookieScraping: true,
    }),
  ])
  const ollamaModels = new OllamaCloudModels({ fetch: fetchImpl, settings: providerSettings })
  const ollamaModelsReady = (async () => {
    if (ollamaModels.status().configured) return
    const resolved = await ctx.credentials.resolve('OLLAMA_API_KEY').catch(() => undefined)
    if (typeof resolved?.value !== 'string' || resolved.value.length === 0) return
    await ollamaModels.sync({ apiKey: resolved.value })
  })().catch((error) => {
    capabilityLogger.warn('provider-capability: Ollama Cloud model provisioning failed: %s', error instanceof Error ? error.message : String(error))
  })
  const chatgptGrokReady = capabilities.chatgptGrok.init()
  const capabilitiesReady = Promise.all([
    chatgptGrokReady,
    capabilities.antigravity.init({ startProxy: config.providerProxy !== false }),
  ]).catch((error) => {
    ctx.logger.warn('dsh-token-usage: provider capability initialization failed: %s', error instanceof Error ? error.message : String(error))
  })

  // Expose execution, not credentials. The existing ChatGPT capability remains
  // the sole login/refresh owner; consumers cannot obtain its OAuth values.
  let llmModelInfo
  if (typeof ctx.inject === 'function') {
    ctx.inject(['llm'], (llmCtx) => {
      llmModelInfo = llmCtx.llm
      return () => { llmModelInfo = undefined }
    })
  }
  const codexModelFacts = createCodexModelFacts({
    getRoute: provider => providerSettings.read(provider)?.value,
    resolveModelInfo: (provider, id, signal) => llmModelInfo.resolveModelInfo(provider, id, signal),
    credentialRef: CREDENTIAL_REFS['openai-codex'],
  })
  // Explicit, preview-bound model synchronization for the Codex route. Boot
  // provisioning keeps filling absent fields only; this is the durable repair
  // entry, and its writes go through the public Settings mutation seam.
  const codexModelSync = createCodexModelSync({
    providerSettings,
    defaultRouteModels: chatgptRouteModels,
    logger: capabilityLogger,
  })
  const codexRuntime = createCodexRuntime({
    ready: () => chatgptGrokReady,
    configured: provider => capabilities.chatgptGrok.auth.configured(provider),
    resolveOAuth: (provider, signal) => capabilities.chatgptGrok.auth.resolveOAuth(provider, signal),
    fetchImpl,
    // Ordinary generation may stream beyond two minutes, but never indefinitely.
    timeoutMs: 1_800_000,
    setupTimeoutMs: 120_000,
    // Native compaction/recovery retains its independent, non-renewable lease.
    compactionTimeoutMs: 300_000,
    resolveModelFacts: codexModelFacts.resolveModelFacts,
    routeStatus: codexModelFacts.routeStatus,
  })
  ctx.provide('codexRuntime', codexRuntime)

  // Most recent Antigravity account state observed by collectConnections.
  let lastAntigravityState = null

  // Boot pass: create zero-config accounts and prime the first official
  // observation as soon as capabilities settle, so the sidebar entry and dock
  // are useful immediately after restart without waiting for any RPC.
  void capabilitiesReady.then(() => collectConnections()).then((collected) => {
    try {
      ensureConnectionAccounts(collected.connections)
    } catch (error) {
      ctx.logger.warn('dsh-token-usage: boot account pass failed: %s', error instanceof Error ? error.message : String(error))
      return
    }
    kickObservations('boot')
  }).catch((error) => {
    ctx.logger.warn('dsh-token-usage: boot connection collection failed: %s', error instanceof Error ? error.message : String(error))
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
    const inspection = await readSessionInspection(ctx.sessionPersistence, snap.header.id)
    const header = headerFromInspection(inspection, snap.revision)
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
      const snapshots = await listSessionSnapshots(ctx.sessionPersistence)
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
          isSeeded: header.isSeeded,
          inheritedEventCount: session.inheritedEventCount ?? header.inheritedEventCount,
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

  // Connection owns transport trust/admission. No plugin-local loopback claim.
  function registerRpc(channel, handler) {
    try {
      ctx.connection.rpc.handle(channel, (endpoint, payload, signal, _peer) => handler(endpoint, payload, signal))
    } catch (error) {
      // Keep the Connection-owned /api Fetch routes when the webServer mount
      // is unavailable. Never replace transport admission with a local server.
      if (!String(error?.message ?? error).includes('webServer')) throw error
    }
  }

  function registerApiFetch(channel, handler, endpoints) {
    if (typeof ctx.connection.fetch?.register !== 'function') return
    const name = channel.replace(/^\//, '')
    for (const endpoint of endpoints) {
      ctx.connection.fetch.register({
        path: `/api/${name}/${endpoint}`,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
            return new Response('content type must be application/json', { status: 415 })
          }
          let body
          try { body = await request.json() } catch { return new Response('body is not JSON', { status: 400 }) }
          const expectedMethod = `${name}/${endpoint}`
          if (body?.type !== 'client-request' || typeof body.rpcId !== 'string' || (body.method !== endpoint && body.method !== expectedMethod)) {
            return Response.json({ type: 'server-response', rpcId: body?.rpcId ?? 'invalid-request', result: { ok: false, error: { code: 'gateway/bad-request', message: 'invalid client-request message', details: { issues: [] } } } })
          }
          const result = await handler(endpoint, body.payload, request.signal)
          return Response.json({ type: 'server-response', rpcId: body.rpcId, result })
        },
      })
    }
  }

  // Antigravity compatibility is an alias to the same capability instance.
  // /subscription-search remains exclusively owned by an installed SearchChain
  // plugin; claiming it here would create duplicate RPC ownership.
  const antigravityRpc = (endpoint, payload, signal) => capabilities.antigravity.handleRpc(endpoint, payload, signal)
  registerRpc(ANTIGRAVITY_CHANNEL, antigravityRpc)
  registerApiFetch(ANTIGRAVITY_CHANNEL, antigravityRpc, ANTIGRAVITY_ENDPOINTS)

  // Official-observation freshness: per-capability due policy, consent, backoff
  // and single-flight. Read-only GETs against origin-allowlisted endpoints.
  const freshness = createObservationFreshness()
  let lastClientPollAt = 0
  let lastOverlayPollAt = 0
  let lastRoundPayload = {
    observedAt: 0, sourceKind: 'provider', chatgptGrok: [], antigravity: [], adapters: [], localLedgerIncluded: false,
  }

  /** Track poll cadence; a previous poll within the stream window = active GUI. */
  function noteClientPoll() {
    const now = Date.now()
    const pollerActive = now - lastClientPollAt <= CLIENT_POLL_STREAM_MS
    lastClientPollAt = now
    return pollerActive
  }

  async function resolveGlmCredential() {
    const [cn, token] = await Promise.all([
      ctx.credentials.resolve('ZAI_CODING_CN_API_KEY').catch(() => undefined),
      ctx.credentials.resolve('ANTHROPIC_AUTH_TOKEN').catch(() => undefined),
    ])
    return selectGlmCredential({
      ZAI_CODING_CN_API_KEY: cn?.value,
      ANTHROPIC_AUTH_TOKEN: token?.value,
    })
  }

  /** Config seam for tests: shrink the absolute round deadline. */
  function observationRoundTimeoutMs() {
    const override = Number(config.observationRoundTimeoutMs)
    return Number.isFinite(override) && override > 0 ? override : OBSERVATION_ROUND_TIMEOUT_MS
  }

  /** One bounded adapter observation; never rejects — failures become error entries. */
  async function observeAdapter(providerId, signal, credential = {}, extra = {}) {
    try {
      const { connection: extraConnection, ...rest } = extra
      const observation = await providerAdapters.observe(providerId, {
        connection: { id: extraConnection?.id ?? `${providerId}:default` },
        credential, signal, ...rest,
      })
      requireLedger().saveAccountObservation(observation)
      return { providerId, observation }
    } catch (error) {
      const timedOut = error?.name === 'AbortError' || error?.name === 'TimeoutError' || signal?.aborted === true
      return { providerId, error: { code: timedOut ? 'timeout' : error?.code ?? 'provider-failed', message: 'provider observation failed' } }
    }
  }

  /** Manual-cookie Ollama Cloud observation; never rejects. */
  async function observeManualCookie(signal) {
    try {
      const resolved = await ctx.credentials.resolve('OLLAMA_SESSION_COOKIE').catch(() => undefined)
      if (typeof resolved?.value !== 'string' || resolved.value.length === 0) {
        return { providerId: 'ollama-cloud', error: { code: 'credential-required', message: 'provider observation failed' } }
      }
      const cookieHeader = allowedCookieHeader(resolved.value)
      if (cookieHeader !== resolved.value) await ctx.credentials.set('OLLAMA_SESSION_COOKIE', cookieHeader)
      return await observeAdapter('ollama-cloud', signal, { kind: 'manual_cookie_header', cookieHeader }, { manualCookieOptIn: true })
    } catch (error) {
      return { providerId: 'ollama-cloud', error: { code: error?.code ?? 'provider-failed', message: 'provider observation failed' } }
    }
  }

  function quotaWindowExpired(connectionId) {
    try {
      const rows = requireLedger().listAccountObservations({ connectionId, limit: 40 })
      const usable = rows.find((row) => Array.isArray(row.limits) && row.limits.length > 0)
      if (!usable) return false
      const nowMs = Date.now()
      return (usable.windows ?? []).some((window) => Number(window.resetsAt) > 0 && window.resetsAt <= nowMs)
    } catch {
      return false
    }
  }

  async function loadRecipes(hints = {}) {
    const [glmPresent, ollamaKey, ollamaCookie] = await Promise.all([
      hints.glm != null ? Promise.resolve(hints.glm === true) : resolveGlmCredential().then((value) => value != null),
      hints.ollamaKey != null ? Promise.resolve(hints.ollamaKey) : credentialConfigured('OLLAMA_API_KEY'),
      hints.ollamaCookie != null ? Promise.resolve(hints.ollamaCookie) : credentialConfigured('OLLAMA_SESSION_COOKIE'),
    ])
    const autoObserve = settings.get('ollamaCloudAutoObserve') === true
    const recipes = [
      { connectionId: 'ollama-local:default', capabilityId: 'none', kind: 'unsupported', providerId: 'ollama-local' },
    ]
    const seen = new Set()
    const pushQuota = (connectionId, providerId, present) => {
      const key = observationKey(connectionId, 'official_usage_api')
      if (seen.has(key)) return
      seen.add(key)
      recipes.push({
        connectionId, capabilityId: 'official_usage_api', kind: 'quota', providerId,
        credentialPresent: present === true, authorized: present === true,
        windowExpired: quotaWindowExpired(connectionId),
      })
    }
    try {
      const accounts = requireLedger().listAccounts().filter((account) => !account.archived)
      for (const account of accounts) {
        const providerId = account.providerId
        const connectionId = account.connectionId ?? `${providerId}:default`
        if (providerId === 'ollama-local') continue
        if (providerId === 'ollama-cloud') continue
        if (providerId === 'glm') pushQuota('glm:default', 'glm', glmPresent)
        else pushQuota(connectionId, providerId, true)
      }
    } catch {
      // Ledger may still be opening; fall through to the well-known connections.
    }
    pushQuota('glm:default', 'glm', glmPresent)
    pushQuota('openai-codex:default', 'openai-codex', capabilities.chatgptGrok.auth.configured('openai-codex') === true)
    pushQuota('xai:default', 'xai', capabilities.chatgptGrok.auth.configured('xai') === true)
    recipes.push({
      connectionId: 'ollama-cloud:default', capabilityId: 'reachability', kind: 'reachability', providerId: 'ollama-cloud',
      credentialPresent: ollamaKey, authorized: ollamaKey,
    })
    recipes.push({
      connectionId: 'ollama-cloud:default', capabilityId: 'official_ui', kind: 'quota', providerId: 'ollama-cloud',
      credentialPresent: ollamaCookie, authorized: ollamaCookie && autoObserve,
      windowExpired: quotaWindowExpired('ollama-cloud:default'),
    })
    return recipes
  }

  function resultFor(recipe, { error, observation, usage, timeout } = {}) {
    const key = observationKey(recipe.connectionId, recipe.capabilityId)
    if (timeout) return { key, errorCode: 'timeout' }
    const code = error?.code
    if (code === 'session-invalid-or-expired' || code === 'USAGE_UNAUTHORIZED') {
      return { key, errorCode: code, authRequired: true }
    }
    if (error) return { key, errorCode: code ?? 'provider-failed', retryAfterMs: error.retryAfterMs, observation }
    const quotaSuccess = recipe.kind === 'quota' && (
      (Array.isArray(observation?.limits) && observation.limits.length > 0)
      || (usage?.available === true && usage.stale !== true && Array.isArray(usage.windows) && usage.windows.length > 0)
    )
    return { key, quotaSuccess, observation, retryAfterMs: usage?.retryAfterMs }
  }

  async function runDueRecipes(due, signal) {
    const deadline = AbortSignal.timeout(observationRoundTimeoutMs())
    const roundSignal = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
    /**
     * Race every job against the round deadline. A provider whose fetch hangs
     * without honoring abort signals must not hold the round — and with it
     * the shared single-flight flag — open forever: past the deadline the job
     * resolves to `timeoutValue` and the round settles with partial results,
     * so `finally` cleanup always runs.
     */
    const bounded = (promise, timeoutValue = undefined) => new Promise((resolvePromise) => {
      let done = false
      const finish = value => { if (!done) { done = true; resolvePromise(value) } }
      deadline.addEventListener('abort', () => finish(timeoutValue), { once: true })
      promise.then(finish, () => finish(timeoutValue))
    })
    const timeoutEntry = providerId => ({ providerId, error: { code: 'timeout', message: 'provider observation failed' } })
    const dueOf = (connectionId, capabilityId) => due.find((recipe) => recipe.connectionId === connectionId && recipe.capabilityId === capabilityId)
    const wantChatgpt = due.some((recipe) => recipe.providerId === 'openai-codex' || recipe.providerId === 'xai')
    const wantAntigravity = due.some((recipe) => recipe.providerId === 'antigravity')
    const wantGlm = dueOf('glm:default', 'official_usage_api')
    const wantReachability = dueOf('ollama-cloud:default', 'reachability')
    const wantOfficialUi = dueOf('ollama-cloud:default', 'official_ui')

    const [subscriptions, antigravity, glmCredential, ollamaKey] = await Promise.all([
      wantChatgpt ? bounded(capabilities.chatgptGrok.handleRpc('usage', { refresh: true }, roundSignal)) : { ok: true, value: { providers: [] } },
      wantAntigravity ? bounded(capabilities.antigravity.handleRpc('usage-all', { refresh: true }, roundSignal)) : { ok: true, value: { usages: [] } },
      wantGlm ? bounded(resolveGlmCredential(), null) : null,
      wantReachability ? bounded(ctx.credentials.resolve('OLLAMA_API_KEY').catch(() => undefined), undefined) : undefined,
    ])
    try {
      persistCapabilityObservations(requireLedger(),
        subscriptions?.ok ? subscriptions.value.providers : [],
        antigravity?.ok ? antigravity.value.usages : [])
    } catch (error) {
      // An unavailable analytics store must not reject the account
      // observation round: capability results stay in the returned payload
      // and persistence retries on a later round instead of re-dating or
      // overwriting anything already stored.
      ctx.logger.warn('dsh-token-usage: observation persistence unavailable: %s', error instanceof Error ? error.message : String(error))
    }

    const glmLane = wantGlm && glmCredential != null ? (async () => {
      try {
        const observation = await glmAdapterFor(glmCredential.origin).observe({
          connection: { id: 'glm:default' },
          credential: { rawAuthorization: glmCredential.value },
          signal: roundSignal,
        })
        requireLedger().saveAccountObservation({ ...observation, providerId: 'glm' })
        return { providerId: 'glm', observation }
      } catch (error) {
        return { providerId: 'glm', error: { code: error?.code ?? 'provider-failed', message: 'provider observation failed' } }
      }
    })() : null
    const lanes = [
      bounded(observeAdapter('ollama-local', roundSignal), timeoutEntry('ollama-local')),
      glmLane === null ? null : bounded(glmLane, timeoutEntry('glm')),
      wantReachability && typeof ollamaKey?.value === 'string' && ollamaKey.value
        ? bounded(observeAdapter('ollama-cloud', roundSignal, { kind: 'api_key', apiKey: ollamaKey.value }), timeoutEntry('ollama-cloud'))
        : null,
      wantOfficialUi ? bounded(observeManualCookie(roundSignal), timeoutEntry('ollama-cloud')) : null,
    ]
    const adapterObservations = (await Promise.all(lanes.map(lane => lane ?? null))).filter(entry => entry !== null)
    const missing = []
    if (wantChatgpt && subscriptions === undefined) missing.push(timeoutEntry('chatgpt-grok'))
    if (wantAntigravity && antigravity === undefined) missing.push(timeoutEntry('antigravity'))
    lastRoundPayload = {
      observedAt: Date.now(), sourceKind: 'provider',
      chatgptGrok: subscriptions?.ok ? subscriptions.value.providers : [],
      antigravity: antigravity?.ok ? antigravity.value.usages : [],
      adapters: [...adapterObservations, ...missing],
      localLedgerIncluded: false,
    }

    const results = []
    for (const recipe of due) {
      if (recipe.providerId === 'openai-codex' || recipe.providerId === 'xai') {
        if (wantChatgpt && subscriptions === undefined) {
          results.push(resultFor(recipe, { timeout: true }))
          continue
        }
        const usage = (subscriptions?.ok ? subscriptions.value.providers : []).find((item) => item.provider === recipe.providerId)
        results.push(resultFor(recipe, {
          usage,
          error: usage?.stale === true || usage?.available !== true
            ? (usage?.error ?? { code: 'USAGE_UNAVAILABLE', retryAfterMs: usage?.retryAfterMs })
            : undefined,
        }))
        continue
      }
      if (recipe.providerId === 'antigravity') {
        if (wantAntigravity && antigravity === undefined) {
          results.push(resultFor(recipe, { timeout: true }))
          continue
        }
        const usage = (antigravity?.ok ? antigravity.value.usages : []).find((item) => item.accountId === recipe.connectionId)
        const failed = usage == null || usage.configured !== true || usage.error
        results.push(resultFor(recipe, {
          usage: failed ? undefined : { available: true, stale: false, windows: usage.models },
          error: failed ? { code: 'provider-failed' } : undefined,
        }))
        continue
      }
      const adapter = adapterObservations.find((entry) => entry.providerId === recipe.providerId
        && (recipe.capabilityId !== 'official_ui' || entry.observation?.source === 'official_ui' || entry.error)
        && (recipe.capabilityId !== 'reachability' || entry.observation?.source !== 'official_ui' || entry.error))
      const timedOut = adapter?.error?.code === 'timeout'
      results.push(resultFor(recipe, {
        timeout: timedOut,
        observation: adapter?.observation,
        error: adapter?.error,
      }))
    }
    return results
  }

  async function beginObservations(trigger, signal, hints) {
    if (trigger === 'overlay-open') lastOverlayPollAt = Date.now()
    const overlayActive = Date.now() - lastOverlayPollAt <= CLIENT_POLL_STREAM_MS
    const pollerActive = trigger === 'sidebar-poll' || trigger === 'overlay-open' ? noteClientPoll() : false
    const recipes = await loadRecipes(hints)
    const done = freshness.ensureFresh({
      trigger,
      pollerActive: trigger === 'manual' ? true : pollerActive,
      overlayActive: trigger === 'manual' ? true : overlayActive,
      recipes,
      run: due => runDueRecipes(due, signal),
      signal,
    })
    return { done }
  }

  function kickObservations(trigger, signal, hints) {
    void beginObservations(trigger, signal, hints).then((started) => started.done).catch(() => {})
  }

  async function refreshObservations(trigger, signal) {
    const { done } = await beginObservations(trigger, signal)
    await done
    return lastRoundPayload
  }

  function decorateEntrySummary(summary) {
    const decoratePool = (pool) => {
      if (pool == null) return pool
      const connectionId = pool.connectionId
        ?? (typeof pool.id === 'string' && pool.id.startsWith('connection:') ? pool.id.slice('connection:'.length) : null)
      const capabilityId = quotaCapabilityFor(pool.providerId)
      const snap = connectionId ? freshness.snapshotFor(connectionId, capabilityId) : { refreshStatus: 'idle', errorCode: null }
      const windowStatus = dataStatusFromWindow(pool.window ?? pool.official?.windows?.[0])
      const dataStatus = pool.window?.expired === true || pool.official?.windows?.every((window) => window.expired === true)
        ? 'expired'
        : windowStatus
      return {
        ...pool,
        dataStatus,
        refreshStatus: snap.refreshStatus,
        refreshError: snap.errorCode,
        window: pool.window == null ? null : {
          ...pool.window,
          dataStatus: dataStatusFromWindow(pool.window),
          refreshStatus: snap.refreshStatus,
        },
      }
    }
    const pools = (summary.pools ?? []).map(decoratePool)
    const tightest = decoratePool(summary.tightest)
    const refreshing = pools.some((pool) => pool.refreshStatus === 'running') || tightest?.refreshStatus === 'running'
    return {
      ...summary,
      pools,
      tightest,
      refreshing,
      observationRevision: requireLedger().observationRevision?.() ?? 0,
    }
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

  /**
   * Collect the current provider-connection set from all capabilities. The
   * Ollama API-key configured flag rides along so the summary endpoint does
   * not have to resolve the same credential a second time.
   */
  async function collectConnections(signal) {
    const [subscriptions, antigravity, glmCredential, ollamaKeyConfigured, ollamaCookieConfigured] = await Promise.all([
      capabilities.chatgptGrok.handleRpc('providers', {}, signal),
      capabilities.antigravity.handleRpc('accounts', {}, signal),
      resolveGlmCredential(),
      credentialConfigured('OLLAMA_API_KEY'),
      credentialConfigured('OLLAMA_SESSION_COOKIE'),
    ])
    const glmConfigured = glmCredential != null
    lastAntigravityState = antigravity.ok ? {
      activeAccountId: antigravity.value.activeAccountId,
      autoFailover: antigravity.value.autoFailover,
      // Secret-free pool snapshot for the settings master-detail UI: rows
      // carry accountId/email/active/expires/expired only (statuses()).
      accounts: antigravity.value.accounts,
    } : null
    return {
      connections: [
      ...(subscriptions.ok ? subscriptions.value.providers.map(item => ({
        providerId: item.provider, displayName: item.displayName, configured: item.configured === true,
        credentialKind: 'oauth', credentialRef: capabilities.chatgptGrok.credentialRefs[item.provider], observationSource: 'official_usage_api',
      })) : []),
      ...(antigravity.ok ? antigravity.value.accounts.map(item => ({
        providerId: 'antigravity', connectionId: item.accountId, displayName: item.email ?? item.accountId,
        configured: true, active: item.accountId === antigravity.value.activeAccountId,
        credentialKind: 'oauth', credentialRef: capabilities.antigravity.credentialRef, observationSource: 'official_usage_api',
      })) : []),
      // A stored raw API key is a configured credential, never a verified
      // model call (AC-001): the fact producer marks it unverified so every
      // consumer sees the honest state. Pure fact derivation from the
      // credential kind — no credential store, mirror or probe is added.
      { providerId: 'glm', displayName: 'GLM / Z.AI', configured: glmConfigured, credentialKind: 'raw_authorization', credentialStatus: 'unverified', credentialRef: glmCredential?.ref ?? 'ZAI_CODING_CN_API_KEY', observationSource: 'official_plugin_internal_api' },
      { providerId: 'ollama-local', displayName: 'Ollama Local', configured: true, credentialKind: 'none', quotaApplicable: false, observationSource: 'local_ledger' },
      { providerId: 'ollama-cloud', displayName: 'Ollama Cloud', configured: ollamaKeyConfigured || ollamaCookieConfigured, credentialKind: 'api_key_or_manual_cookie', credentialStatus: ollamaCookieConfigured ? 'manual-cookie' : 'unverified', credentialRef: ollamaCookieConfigured ? 'OLLAMA_SESSION_COOKIE' : 'OLLAMA_API_KEY', observationSource: ollamaCookieConfigured ? 'official_ui' : 'official_response' },
      ],
      ollamaKeyConfigured,
    }
  }

  /**
   * Zero-config accounts: every configured connection becomes one product
   * with default attribution rules, so the dashboard works the moment a
   * provider is signed in — without waiting for a summary RPC. Archived auto
   * accounts stay archived. Antigravity accounts use immutable connection
   * provenance because routing and failover happen behind one provider route.
   */
  function ensureConnectionAccounts(connections) {
    const led = requireLedger()
    for (const connection of connections) led.saveAccountConnection(connection)
    const aliasesByProvider = new Map()
    for (const template of led.accountTemplates()) {
      const allAliases = [...new Set([template.providerId, ...(template.product?.providerAliases ?? [])])]
      for (const alias of allAliases) {
        aliasesByProvider.set(alias, allAliases)
      }
    }
    for (const connection of connections) {
      if (connection.configured !== true) continue
      // GLM keeps one user-curated account: when a template/manual GLM
      // account already exists, claim it for the connection instead of
      // creating a duplicate. The link is what carries connection-keyed
      // official observations into the account the user already has.
      if (connection.providerId === 'glm' && led.listAccounts().some((account) => !account.archived && account.providerId === 'glm')) {
        led.linkAccountConnection({ providerId: connection.providerId, connectionId: String(connection.connectionId ?? `${connection.providerId}:default`) })
        continue
      }
      led.ensureConnectionAccount(connection, {
        aliases: aliasesByProvider.get(connection.providerId) ?? [connection.providerId],
        attribution: connection.providerId === 'antigravity' ? 'connection' : 'provider',
      })
    }
  }

  async function handleAccountRequest(endpoint, payload, signal) {
    try {
      await Promise.all([capabilitiesReady, ollamaModelsReady])
      const body = payload ?? {}
      if (endpoint === 'connections') {
        // Read-only account capability facts for settings surfaces: local
        // connection status, cached model catalogs, adapter and proxy state.
        // It never touches the usage store, never creates accounts, and
        // never starts an observation round, so analytics availability
        // cannot hide account facts and a settings page cannot trigger a
        // quota network refresh. `summary` keeps the overlay duties.
        const collected = await collectConnections(signal)
        return envelopeSuccess({
          adapters: providerAdapters.list(),
          connections: collected.connections,
          modelCatalogs: [
            { ...ollamaModels.status(), credentialConfigured: collected.ollamaKeyConfigured },
            codexModelSync.catalogStatus('openai-codex', providerSettings.read('openai-codex')?.value?.models),
          ].filter(Boolean),
          antigravity: lastAntigravityState,
          privacy: { secretsInRpc: false, secretsInSqlite: false, localLedgerSeparate: true },
        })
      }
      if (endpoint === 'summary') {
        const collected = await collectConnections(signal)
        ensureConnectionAccounts(collected.connections)
        await beginObservations('overlay-open', signal, {
          ollamaKey: collected.ollamaKeyConfigured,
          ollamaCookie: collected.connections.some((connection) => connection.providerId === 'ollama-cloud' && connection.credentialStatus === 'manual-cookie'),
          glm: collected.connections.some((connection) => connection.providerId === 'glm' && connection.configured === true),
        })
        return envelopeSuccess({
          product: { name: 'DSH Accounts & Usage', version: '5.0.22' },
          adapters: providerAdapters.list(),
          connections: collected.connections,
          modelCatalogs: [{ ...ollamaModels.status(), credentialConfigured: collected.ollamaKeyConfigured }],
          antigravity: lastAntigravityState,
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
      if (endpoint === 'models.preview') {
        // Pure read: classify the selected ids against the verified catalog
        // and bind the outcome to catalog + Settings revisions and a digest.
        // No credential, route or network value is returned.
        return envelopeSuccess(codexModelSync.preview({ provider: body.provider, modelIds: body.modelIds }))
      }
      if (endpoint === 'models.apply') {
        // One revision-bound Settings mutation; drift rejects and demands a
        // fresh preview. Never a full redacted-Settings write-back.
        const result = await codexModelSync.apply({
          provider: body.provider,
          modelIds: body.modelIds,
          catalogRevision: body.catalogRevision,
          settingsRevision: body.settingsRevision,
          digest: body.digest,
        })
        return envelopeSuccess(result)
      }
      if (endpoint === 'observe-provider') {
        if (body.refresh !== true) throw Object.assign(new Error('provider observation refresh requires explicit refresh=true'), { code: 'explicit-refresh-required' })
        const providerId = String(body.providerId ?? '')
        const connectionId = typeof body.connectionId === 'string' ? body.connectionId : `${providerId}:default`
        if (providerId === 'ollama-local') {
          const entry = await observeAdapter('ollama-local', signal, {}, { connection: { id: connectionId } })
          if (entry.observation) return envelopeSuccess({ observation: entry.observation })
          throw Object.assign(new Error('provider observation failed'), { code: entry.error?.code ?? 'provider-failed' })
        }
        const capabilityId = providerId === 'ollama-cloud' && body.mode === 'manual-cookie'
          ? 'official_ui'
          : providerId === 'ollama-cloud' ? 'reachability' : providerId === 'ollama-local' ? 'none' : 'official_usage_api'
        if (capabilityId === 'official_ui') freshness.noteCredentialChange(connectionId, 'official_ui')
        const recipes = (await loadRecipes()).filter((recipe) => recipe.connectionId === connectionId && recipe.capabilityId === capabilityId)
        const scoped = recipes.length > 0 ? recipes : [{
          connectionId, capabilityId, kind: capabilityId === 'none' ? 'unsupported' : capabilityId === 'reachability' ? 'reachability' : 'quota',
          providerId, credentialPresent: true, authorized: true,
        }]
        const { results } = await freshness.ensureFresh({
          trigger: 'manual', pollerActive: true, overlayActive: true, recipes: scoped,
          run: due => runDueRecipes(due, signal), signal,
        })
        const hit = (results ?? []).find((item) => item.key === observationKey(connectionId, capabilityId))
        if (hit?.observation) return envelopeSuccess({ observation: hit.observation })
        if (hit?.errorCode) throw Object.assign(new Error('provider observation failed'), { code: hit.errorCode })
        const fallback = lastRoundPayload.adapters.find((entry) => entry.providerId === providerId && entry.observation)
        if (fallback?.observation) return envelopeSuccess({ observation: fallback.observation })
        throw Object.assign(new Error('provider observation failed'), { code: hit?.errorCode ?? 'provider-failed' })
      }
      if (endpoint === 'observations') {
        return envelopeSuccess({ observations: requireLedger().listAccountObservations({ connectionId: body.connectionId, limit: body.limit }) })
      }
      if (endpoint === 'refresh-observations') {
        if (body.refresh !== true) throw Object.assign(new Error('provider observation refresh requires explicit refresh=true'), { code: 'explicit-refresh-required' })
        return envelopeSuccess(await refreshObservations('manual', signal))
      }
      if (endpoint === 'connection-action') {
        const provider = String(body.provider ?? '')
        const action = String(body.action ?? '')
        // Callback URLs and raw credential material stay off the unified RPC.
        if (action === 'paste-callback' || /token|key|cookie|authorization/i.test(JSON.stringify(body))) {
          throw Object.assign(new Error('credential material is not accepted by /account-usage'), { code: 'secret-rejected' })
        }
        const capability = provider === 'antigravity' ? capabilities.antigravity : capabilities.chatgptGrok
        const result = await capability.handleRpc(action, body.params ?? {}, signal)
        const status = result?.value?.status ?? result?.value ?? result
        if (result?.ok !== false && (action === 'login-status' || action === 'activate-account') && status?.kind === 'succeeded') {
          const connectionId = provider === 'antigravity'
            ? (body.params?.accountId ?? `${provider}:default`)
            : `${provider}:default`
          freshness.noteCredentialChange(connectionId, 'official_usage_api')
        }
        return result
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
  registerRpc(ACCOUNT_CHANNEL, handleAccountRequest)
  registerApiFetch(ACCOUNT_CHANNEL, handleAccountRequest, ACCOUNT_USAGE_ENDPOINTS)

  async function handleTokenRequest(endpoint, payload, signal) {
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
          await beginObservations('sidebar-poll', signal)
          return envelopeSuccess(decorateEntrySummary(led.entrySummary({ timezone: timezone() })))
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
          return envelopeSuccess({ ...overviewPayload(), identity: publicIdentity(settings), profile: profileLabel(), dataIdentity })
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
            dataIdentity,
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
          const key = String(body.key)
          let requested = body.value
          if (key === 'ollamaCloudCacheEstimatePct') {
            requested = Number(requested)
            if (!Number.isFinite(requested) || requested < 0 || requested > 100) {
              throw Object.assign(new Error('Ollama Cloud cache estimate must be between 0 and 100 percent'), { code: 'invalid-setting' })
            }
          }
          if (key === 'ollamaCloudAutoObserve') requested = requested === true
          const value = settings.set(key, requested)
          if (key === 'ollamaCloudCacheEstimatePct') led.setOllamaCacheEstimateBps(Math.round(value * 100))
          if (key === 'ollamaCloudAutoObserve' && value === true) {
            freshness.noteCredentialChange('ollama-cloud:default', 'official_ui')
            void beginObservations('overlay-open', signal).catch(() => {})
          }
          return envelopeSuccess({ key, value })
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
  }
  registerRpc(CHANNEL, handleTokenRequest)
  registerApiFetch(CHANNEL, handleTokenRequest, TOKEN_USAGE_ENDPOINTS)

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

  // Host dispose ends both owned lifecycles in one fixed order: cancel
  // in-flight codex-runtime/v1 leases, close the analytics store, then
  // release provider capability owners. Ownership is one-directional — no
  // analytics path may release account owners, and no account path may stop
  // analytics on its behalf; only the Host dispose of this bundle runs the
  // full sequence. Unmounting the analytics UI ends neither lifecycle.
  ctx.on('dispose', () => {
    codexRuntime.dispose()
    stopAnalyticsLifecycle()
    void capabilities.dispose()
  })
}

/**
 * Prefer a usage payload's own fetch time when it is a usable epoch, else now.
 * Storing the payload time keeps a re-read snapshot from looking fresher than
 * it is; `Number.isFinite` alone would accept bogus epochs like 0.
 */
function observationTimestamp(value, now = Date.now) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : now()
}

/**
 * Fold capability usage payloads into account observations. Exported for
 * tests; the ledger seam is the caller's.
 *
 * Stale and failed payloads never become rows: re-saving an old percentage
 * under a fresh timestamp would launder stale provider state into "latest"
 * data on every provider outage. A payload qualifies only when it is
 * available (chatgpt/grok), not marked stale, and carries at least one window
 * — an error with no fresh windows has nothing worth filing.
 */
export function persistCapabilityObservations(ledger, subscriptions, antigravity) {
  for (const usage of subscriptions) {
    if (usage?.available !== true || usage.stale === true) continue
    const windows = (usage.windows ?? []).map(window => ({
      id: `${usage.provider}:${window.id}`, kind: 'rolling', label: window.id,
      durationMs: Math.max(1, Number(window.windowSeconds ?? 1)) * 1000,
      resetsAt: window.resetsAt ?? null,
    }))
    if (windows.length === 0) continue
    const observedAt = observationTimestamp(usage.fetchedAt)
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
    if (usage?.configured !== true || !Array.isArray(usage.models) || usage.models.length === 0) continue
    const observedAt = observationTimestamp(usage.fetchedAt)
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
