import { homedir } from 'node:os'
import { join } from 'node:path'
import { createCapabilityEnvelope } from '../rpc-envelope.js'
import { SubscriptionAuthRuntime } from './auth-runtime.js'
import { CREDENTIAL_REFS } from './credential-refs.js'
import { createCredentialSynchronizer } from './credential-sync.js'
import { createUsageService } from './usage.js'

export const CHATGPT_GROK_CHANNEL = '/subscription-search'
export const CHATGPT_GROK_PROVIDERS = ['openai-codex', 'xai']

const grokModel = (id, name, overrides = {}) => ({
  id, name,
  contextWindow: 500000,
  maxTokens: 500000,
  input: ['text', 'image'],
  reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'high' },
  ...overrides,
})
const GROK_ROUTE_MODELS = [
  grokModel('grok-4.7', 'Grok 4.7'),
  grokModel('grok-4.6', 'Grok 4.6'),
]

const envelope = createCapabilityEnvelope({
  cancelledCodes: ['PI_AI_AUTH_ABORTED'],
  credentialCodes: ['PI_AI_AUTH_RESOLUTION_FAILED'],
})
export const chatGptGrokEnvelopeOutcome = envelope.outcome
const { success, failure, requireObject } = envelope

// The ChatGPT/Codex subscription cohort this candidate verified against
// (2026-09-23): gpt-5.3-codex-spark is delisted backend-side — Codex rejects
// it for ChatGPT accounts — and the 5.4/5.4-mini/5.5 generation is retired
// per the user's call. gpt-6-sol / gpt-6-luna shipped today and the installed
// pi-ai 0.85.1 catalog predates them, so they carry their full fields from
// the pi-ai 0.87.1 catalog; each entry defaults its unset fields from the
// installed catalog model of the same id.
const CHATGPT_ROUTE_MODEL_IDS = [
  'gpt-5.6-terra', 'gpt-6-astra',
  { id: 'gpt-6-sol', name: 'GPT-6 Sol', api: 'openai-codex-responses', reasoning: true, input: ['text', 'image'], contextWindow: 272000, maxTokens: 128000 },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', api: 'openai-codex-responses', reasoning: true, input: ['text', 'image'], contextWindow: 272000, maxTokens: 128000 },
]

export function openaiCodexRoutePatch(existing) {
  return {
    displayName: existing?.displayName ?? 'OpenAI Codex (ChatGPT subscription)',
    apiKeyEnv: CREDENTIAL_REFS['openai-codex'],
    models: existing?.models ?? CHATGPT_ROUTE_MODEL_IDS.map(id => ({ id })),
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
  for (const [provider, defaults] of [['openai-codex', openaiCodexRoutePatch()], ['grok-build', grokBuildRoutePatch()]]) {
    const snapshot = settings.read(provider)
    if (!snapshot) continue
    // Boot provisioning fills absent fields only; an existing route belongs to
    // the user, including a deliberately different credential reference.
    const patch = Object.fromEntries(Object.entries(defaults).filter(([key]) => snapshot.value?.[key] === undefined))
    await settings.mutate(snapshot, settings.fields(patch))
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
      if (endpoint === 'pending-login') {
        const { provider } = requireObject(payload)
        return success(auth.pendingLogin(provider))
      }
      if (endpoint === 'cancel-login') {
        const { loginId, provider } = requireObject(payload)
        if (loginId !== undefined) await auth.cancelLogin(loginId)
        else await auth.cancelProviderLogin(provider)
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
