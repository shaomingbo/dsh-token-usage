import { homedir } from 'node:os'
import { join } from 'node:path'
import { SubscriptionAuthRuntime } from './auth-runtime.js'
import { CREDENTIAL_REFS } from './credential-refs.js'
import { createCredentialSynchronizer } from './credential-sync.js'
import { createUsageService } from './usage.js'

export const CHATGPT_GROK_CHANNEL = '/subscription-search'
export const CHATGPT_GROK_PROVIDERS = ['openai-codex', 'xai']

const GROK_ROUTE_MODELS = [{
  id: 'grok-4.6',
  name: 'Grok 4.6',
  contextWindow: 500000,
  maxTokens: 500000,
  input: ['text', 'image'],
  reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'high' },
}]

const ENVELOPE_CODES = new Set(['cancelled', 'internal'])
const CANCELLED_CODES = new Set(['PI_AI_AUTH_ABORTED'])
const CREDENTIAL_CODES = new Set(['PI_AI_AUTH_RESOLUTION_FAILED'])

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function chatGptGrokEnvelopeOutcome(code, details) {
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
  const safe = chatGptGrokEnvelopeOutcome(code, details)
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

export function openaiCodexRoutePatch(existing) {
  return {
    displayName: existing?.displayName ?? 'OpenAI Codex (ChatGPT subscription)',
    apiKeyEnv: CREDENTIAL_REFS['openai-codex'],
  }
}

export function grokBuildRoutePatch() {
  return {
    displayName: 'Grok (X subscription)',
    apiKeyEnv: CREDENTIAL_REFS.xai,
    api: 'openai-responses',
    baseURL: 'https://api.x.ai/v1',
    reasoning: 'high',
    models: structuredClone(GROK_ROUTE_MODELS),
  }
}

export async function ensureChatGptGrokRoutes(settings) {
  const section = settings.get('llm-pi-ai')
  const openai = section?.providers?.['openai-codex']
  if (openai?.apiKeyEnv !== CREDENTIAL_REFS['openai-codex']) {
    await settings.update('llm-pi-ai', { providers: { 'openai-codex': openaiCodexRoutePatch(openai) } })
  }
  const grok = settings.get('llm-pi-ai')?.providers?.['grok-build']
  if (grok === undefined) {
    await settings.update('llm-pi-ai', { providers: { 'grok-build': grokBuildRoutePatch() } })
  }
}

/**
 * Construct the ChatGPT/Grok capability without registering hooks, RPC, routes,
 * or timers. A later host index owns wiring each returned operation exactly once.
 */
export function createChatGptGrokCapability({
  credentials,
  settings,
  logger = { info: () => {}, warn: () => {} },
  filename = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), '.oauth.json'),
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  let synchronizer
  const auth = new SubscriptionAuthRuntime({
    filename,
    logger,
    onChanged: provider => {
      if (CHATGPT_GROK_PROVIDERS.includes(provider)) synchronizer?.background(provider, 'store')
    },
  })
  synchronizer = createCredentialSynchronizer({ auth, credentials, logger })
  const usage = createUsageService({
    auth,
    sync: (provider, reason) => synchronizer.sync(provider, reason),
    fetchImpl,
    now,
  })
  let initialized = false
  let disposed = false

  async function init({ provisionRoutes = true } = {}) {
    if (disposed) throw new Error('ChatGPT/Grok capability is disposed')
    if (!initialized) {
      await auth.init()
      initialized = true
    }
    if (provisionRoutes && settings !== undefined) await ensureChatGptGrokRoutes(settings)
    return capability
  }

  async function beforeStream(options) {
    const provider = options?.provider
    if (provider !== 'openai-codex' && provider !== 'grok-build') return false
    await synchronizer.sync(provider === 'grok-build' ? 'xai' : 'openai-codex', 'request')
    return true
  }

  async function refreshCredentials(reason = 'timer') {
    await Promise.all(CHATGPT_GROK_PROVIDERS.map(provider => synchronizer.sync(provider, reason)))
  }

  async function handleRpc(endpoint, payload, signal) {
    try {
      await init({ provisionRoutes: false })
      if (endpoint === 'providers') return success({ providers: auth.providers() })
      if (endpoint === 'start-login') {
        const { provider } = requireObject(payload)
        return success({ challenge: await auth.startLogin(provider, signal) })
      }
      if (endpoint === 'login-status') {
        const { loginId } = requireObject(payload)
        return success({ status: auth.loginStatus(loginId) })
      }
      if (endpoint === 'cancel-login') {
        const { loginId } = requireObject(payload)
        await auth.cancelLogin(loginId)
        return success({})
      }
      if (endpoint === 'logout') {
        const { provider } = requireObject(payload)
        await auth.logout(provider)
        usage.clear(provider)
        return success({})
      }
      if (endpoint === 'usage') {
        const { refresh } = requireObject(payload)
        return success({ providers: await usage.fetchAll({ refresh: refresh === true, signal }) })
      }
      return failure(`unknown ChatGPT/Grok capability endpoint: ${endpoint}`)
    } catch (error) {
      return failure(error instanceof Error ? error.message : 'ChatGPT/Grok request failed', error?.code, error?.details)
    }
  }

  async function dispose() {
    if (disposed) return
    disposed = true
    usage.clear()
    await auth.dispose()
  }

  const capability = {
    kind: 'chatgpt-grok',
    channel: CHATGPT_GROK_CHANNEL,
    credentialRefs: CREDENTIAL_REFS,
    auth,
    usage,
    synchronizer,
    init,
    beforeStream,
    refreshCredentials,
    handleRpc,
    dispose,
  }
  return capability
}
