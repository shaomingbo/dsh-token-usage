import { homedir } from 'node:os'
import { join } from 'node:path'
import { AuthStore, PROVIDER_ID } from './auth-store.js'
import { AntigravityAuth } from './oauth.js'
import { createAntigravityClient } from './antigravity-api.js'
import { createAccountRouter } from './account-router.js'
import { createCredentialSynchronizer, CREDENTIAL_REF } from './credential-sync.js'
import { createProxy } from './proxy.js'
import { ROUTE_MODELS } from './model-catalog.js'
import { createUsageService } from './usage.js'

export const ANTIGRAVITY_CHANNEL = '/subscription-antigravity'
export const ANTIGRAVITY_ROUTE_ID = PROVIDER_ID
export const DEFAULT_ANTIGRAVITY_PROXY_PORT = 51122

const ENVELOPE_CODES = new Set(['cancelled', 'internal'])
const CANCELLED_CODES = new Set(['ANTIGRAVITY_LOGIN_ABORTED'])
const CREDENTIAL_CODES = new Set(['ANTIGRAVITY_AUTH_EXPIRED', 'ANTIGRAVITY_AUTH_NOT_CONFIGURED'])

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function antigravityEnvelopeOutcome(code, details) {
  if (typeof code === 'string') {
    if (ENVELOPE_CODES.has(code)) return { code, details: {} }
    if (CREDENTIAL_CODES.has(code) && isRecord(details) && typeof details.ref === 'string') {
      return { code: 'credential-rejected', details: { ref: details.ref } }
    }
    if (CANCELLED_CODES.has(code)) return { code: 'cancelled', details: {} }
  }
  return { code: 'internal', details: {} }
}

function failure(message, code = 'internal', details) {
  const safe = antigravityEnvelopeOutcome(code, details)
  const tag = typeof code === 'string' && code !== safe.code ? `[${code}] ` : ''
  return { ok: false, error: { code: safe.code, message: `${tag}${message}`, details: safe.details } }
}

function success(value) {
  return { ok: true, value }
}

function requireObject(payload) {
  if (!isRecord(payload)) throw new Error('request payload must be an object')
  return payload
}

export function antigravityRoutePatch(existing, proxyUrl) {
  const models = Array.isArray(existing?.models) && existing.models.length > 0
    ? existing.models
    : structuredClone(ROUTE_MODELS)
  return {
    ...(typeof existing?.displayName === 'string' && existing.displayName.length > 0
      ? { displayName: existing.displayName }
      : { displayName: 'Antigravity (Google AI subscription)' }),
    apiKeyEnv: CREDENTIAL_REF,
    api: 'openai-completions',
    baseURL: proxyUrl,
    compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
    models,
  }
}

export function antigravityRouteNeedsProvisioning(existing, proxyUrl) {
  return !(existing?.apiKeyEnv === CREDENTIAL_REF
    && existing?.baseURL === proxyUrl
    && existing?.api === 'openai-completions'
    && !Object.hasOwn(existing ?? {}, 'connectionIdHeader')
    && Array.isArray(existing?.models)
    && existing.models.length > 0)
}

export async function ensureAntigravityRoute(settings, proxyUrl, logger = { info: () => {} }) {
  const existing = settings.get('llm-pi-ai')?.providers?.[ANTIGRAVITY_ROUTE_ID]
  if (!antigravityRouteNeedsProvisioning(existing, proxyUrl)) return false
  if (typeof settings.mutate === 'function') {
    await settings.mutate('llm-pi-ai', [{
      op: 'unset',
      path: ['providers', ANTIGRAVITY_ROUTE_ID, 'connectionIdHeader'],
    }])
  }
  await settings.update('llm-pi-ai', {
    providers: { [ANTIGRAVITY_ROUTE_ID]: antigravityRoutePatch(existing, proxyUrl) },
  })
  logger.info('provider-capability: provisioned the antigravity model route at %s', proxyUrl)
  return true
}

/**
 * Construct Antigravity auth, account routing, failover, usage, translation
 * proxy, and credential sync without registering host hooks or RPC ownership.
 */
export function createAntigravityCapability({
  credentials,
  settings,
  logger = { info: () => {}, warn: () => {} },
  filename = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), '.antigravity-auth.json'),
  fetchImpl = globalThis.fetch,
  clock = Date.now,
  baseUrl,
  proxyPort,
  callbackPort,
} = {}) {
  const configuredPort = proxyPort ?? Number.parseInt(process.env.DSH_ANTIGRAVITY_PROXY_PORT ?? '', 10)
  const preferredPort = Number.isInteger(configuredPort) && configuredPort > 0
    ? configuredPort
    : DEFAULT_ANTIGRAVITY_PROXY_PORT
  const client = createAntigravityClient({ fetchImpl, clock, baseUrl })
  const store = new AuthStore({
    filename,
    onError: error => logger.warn('provider-capability: antigravity auth store: %s', error instanceof Error ? error.message : String(error)),
  })
  const auth = new AntigravityAuth({
    store,
    logger,
    fetchImpl,
    clock,
    discoverProject: token => client.loadCodeAssist(token),
    ...(callbackPort === undefined ? {} : { callbackPort }),
  })
  const synchronizer = createCredentialSynchronizer({ auth, credentials, logger })
  const usage = createUsageService({ auth, client })
  const accountRouter = createAccountRouter({
    auth,
    usage,
    logger,
    onActivated: (_accountId, reason) => synchronizer.sync(reason),
  })
  let activeProxy = createProxy({ auth, accountRouter, client, logger, port: preferredPort })
  let proxyUrl = `http://127.0.0.1:${preferredPort}/v1`
  let initPromise
  let disposed = false

  async function init({ provisionRoute = true, startProxy = true } = {}) {
    if (disposed) throw new Error('Antigravity capability is disposed')
    if (initPromise === undefined) initPromise = auth.init()
    await initPromise
    if (startProxy) {
      try {
        await activeProxy.start()
        proxyUrl = activeProxy.url
      } catch (error) {
        logger.warn('provider-capability: antigravity proxy start failed on port %d (%s); retrying on an ephemeral port',
          activeProxy.port, error instanceof Error ? error.message : String(error))
        await activeProxy.stop().catch(() => {})
        activeProxy = createProxy({ auth, accountRouter, client, logger, port: 0 })
        await activeProxy.start()
        proxyUrl = activeProxy.url
      }
    }
    if (provisionRoute && settings !== undefined) await ensureAntigravityRoute(settings, proxyUrl, logger)
    return capability
  }

  async function beforeStream(options) {
    if (options?.provider !== ANTIGRAVITY_ROUTE_ID) return false
    await init({ provisionRoute: false, startProxy: false })
    await synchronizer.sync('request')
    return true
  }

  async function refreshCredentials(reason = 'timer') {
    await init({ provisionRoute: false, startProxy: false })
    await synchronizer.sync(reason)
  }

  async function handleRpc(endpoint, payload, signal) {
    try {
      await init({ provisionRoute: false, startProxy: false })
      if (endpoint === 'providers') return success({ providers: [auth.status()] })
      if (endpoint === 'accounts') return success({ accounts: auth.statuses(), activeAccountId: auth.activeAccountId(), autoFailover: auth.autoFailoverEnabled() })
      if (endpoint === 'start-login') {
        requireObject(payload)
        return success(await auth.startLogin(signal))
      }
      if (endpoint === 'paste-callback') {
        const { loginId, url } = requireObject(payload)
        if (typeof loginId !== 'string' || typeof url !== 'string') throw new Error('paste-callback requires loginId and url strings')
        await auth.completeWithPaste(loginId, url)
        const status = auth.loginStatus(loginId)
        if (status.kind === 'succeeded') {
          usage.clear(status.accountId)
          await synchronizer.sync('login')
        }
        return success({ status })
      }
      if (endpoint === 'login-status') {
        const { loginId } = requireObject(payload)
        const status = auth.loginStatus(loginId)
        if (status.kind === 'succeeded') synchronizer.background('login')
        return success({ status })
      }
      if (endpoint === 'cancel-login') {
        const { loginId } = requireObject(payload)
        await auth.cancelLogin(loginId)
        return success({})
      }
      if (endpoint === 'activate-account') {
        const { accountId } = requireObject(payload)
        if (typeof accountId !== 'string') throw new Error('activate-account requires accountId')
        await auth.activateAccount(accountId)
        await synchronizer.sync('manual-switch')
        return success({ activeAccountId: accountId })
      }
      if (endpoint === 'remove-account') {
        const { accountId } = requireObject(payload)
        if (typeof accountId !== 'string') throw new Error('remove-account requires accountId')
        const activeAccountId = await auth.removeAccount(accountId)
        usage.clear(accountId)
        await synchronizer.sync('remove-account')
        return success({ activeAccountId })
      }
      if (endpoint === 'set-auto-failover') {
        const { enabled } = requireObject(payload)
        if (typeof enabled !== 'boolean') throw new Error('set-auto-failover requires enabled boolean')
        await auth.setAutoFailover(enabled)
        return success({ enabled })
      }
      if (endpoint === 'logout') {
        requireObject(payload)
        const removed = auth.activeAccountId()
        await auth.logout()
        usage.clear(removed)
        await synchronizer.sync('logout')
        return success({})
      }
      if (endpoint === 'usage') {
        const body = requireObject(payload)
        return success({ usage: await usage.fetchUsage({
          accountId: typeof body.accountId === 'string' ? body.accountId : auth.activeAccountId(),
          refresh: body.refresh === true,
          signal,
        }) })
      }
      if (endpoint === 'usage-all') {
        const body = requireObject(payload)
        return success({ usages: await usage.fetchAllUsage({ refresh: body.refresh === true, signal }) })
      }
      if (endpoint === 'models') return success({ models: ROUTE_MODELS.map(model => ({ id: model.id, name: model.name, input: model.input, reasoning: model.reasoning === true, reasoningEfforts: model.reasoningEfforts })) })
      if (endpoint === 'diagnostics') return success({
        provider: ANTIGRAVITY_ROUTE_ID,
        configured: auth.status().configured === true,
        accountCount: auth.statuses().length,
        activeAccountId: auth.activeAccountId(),
        autoFailover: auth.autoFailoverEnabled(),
        proxyUrl,
        routeConfigured: settings?.get('llm-pi-ai')?.providers?.[ANTIGRAVITY_ROUTE_ID] !== undefined,
      })
      return failure(`unknown Antigravity capability endpoint: ${endpoint}`)
    } catch (error) {
      return failure(error instanceof Error ? error.message : 'Antigravity request failed', error?.code, error?.details)
    }
  }

  async function dispose() {
    if (disposed) return
    disposed = true
    usage.clear()
    await activeProxy.stop()
    await auth.dispose()
  }

  const capability = {
    kind: 'antigravity',
    channel: ANTIGRAVITY_CHANNEL,
    credentialRef: CREDENTIAL_REF,
    auth,
    store,
    client,
    usage,
    accountRouter,
    synchronizer,
    get proxy() { return activeProxy },
    get proxyUrl() { return proxyUrl },
    init,
    beforeStream,
    refreshCredentials,
    handleRpc,
    dispose,
  }
  return capability
}
