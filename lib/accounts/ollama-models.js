import { AccountsError } from './domain.js'
import { assertResponseOrigin, boundedSignal, confinedUrl, jsonBody, officialOrigins } from './adapters/http.js'
import { OLLAMA_OFFICIAL_ORIGINS } from './adapters/ollama.js'

export const OLLAMA_CLOUD_ROUTE_ID = 'ollama-cloud'
export const OLLAMA_CLOUD_CREDENTIAL_REF = 'OLLAMA_API_KEY'
export const OLLAMA_CLOUD_API_URL = 'https://ollama.com/api'
export const OLLAMA_CLOUD_OPENAI_URL = 'https://ollama.com/v1'

const REASONING_EFFORTS = Object.freeze({ off: 'none', low: 'low', medium: 'medium', high: 'high', max: 'max' })
const ROUTE_COMPAT = Object.freeze({
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  supportsUsageInStreaming: true,
  maxTokensField: 'max_tokens',
  supportsStrictMode: false,
  thinkingFormat: 'openai',
})

function positiveInteger(value) {
  const number = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}

function parameterValue(source, name) {
  if (typeof source !== 'string') return undefined
  for (const line of source.split(/\r?\n/)) {
    const match = line.trim().match(/^(\S+)\s+(.+)$/)
    if (match?.[1] === name) return match[2].trim()
  }
  return undefined
}

function contextWindow(show) {
  const configured = positiveInteger(parameterValue(show?.parameters, 'num_ctx'))
  if (configured !== undefined) return configured
  const info = show?.model_info
  if (!info || typeof info !== 'object' || Array.isArray(info)) return undefined
  const architecture = typeof info['general.architecture'] === 'string' ? info['general.architecture'] : ''
  const preferred = architecture ? positiveInteger(info[`${architecture}.context_length`]) : undefined
  if (preferred !== undefined) return preferred
  const values = Object.entries(info)
    .filter(([key]) => key.endsWith('.context_length'))
    .map(([, value]) => positiveInteger(value))
    .filter(value => value !== undefined)
  return values.length === 1 ? values[0] : undefined
}

function modelFrom(tag, show) {
  const id = typeof tag?.model === 'string' && tag.model.trim()
    ? tag.model.trim()
    : typeof tag?.name === 'string' ? tag.name.trim() : ''
  if (!id) return null
  const capabilities = new Set(Array.isArray(show?.capabilities)
    ? show.capabilities.filter(value => typeof value === 'string')
    : [])
  if (!capabilities.has('completion')) return null
  const context = contextWindow(show)
  const maxTokens = positiveInteger(parameterValue(show?.parameters, 'num_predict'))
  const name = typeof tag?.name === 'string' && tag.name.trim() ? tag.name.trim() : id
  return {
    id,
    name,
    ...(context === undefined ? {} : { contextWindow: context }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    input: capabilities.has('vision') ? ['text', 'image'] : ['text'],
    reasoningEfforts: capabilities.has('thinking') ? { ...REASONING_EFFORTS } : false,
  }
}

function route(existing, models) {
  return {
    ...(existing ?? {}),
    displayName: 'Ollama Cloud',
    apiKeyEnv: OLLAMA_CLOUD_CREDENTIAL_REF,
    api: 'openai-completions',
    baseURL: OLLAMA_CLOUD_OPENAI_URL,
    compat: { ...(existing?.compat ?? {}), ...ROUTE_COMPAT },
    models,
  }
}

export class OllamaCloudModels {
  constructor({ fetch, settings, allowedOrigins = OLLAMA_OFFICIAL_ORIGINS } = {}) {
    if (typeof fetch !== 'function') throw new AccountsError('invalid-model-catalog-config', 'Ollama Cloud model catalog requires fetch')
    if (!settings || typeof settings.get !== 'function' || typeof settings.update !== 'function') {
      throw new AccountsError('invalid-model-catalog-config', 'Ollama Cloud model catalog requires settings')
    }
    this.fetch = fetch
    this.settings = settings
    this.allowedOrigins = officialOrigins(allowedOrigins, OLLAMA_OFFICIAL_ORIGINS)
    this.tagsUrl = confinedUrl(`${OLLAMA_CLOUD_API_URL}/tags`, this.allowedOrigins, 'Ollama model-list endpoint')
    this.showUrl = confinedUrl(`${OLLAMA_CLOUD_API_URL}/show`, this.allowedOrigins, 'Ollama model-details endpoint')
  }

  status() {
    const configured = this.settings.get('llm-pi-ai')?.providers?.[OLLAMA_CLOUD_ROUTE_ID]
    return {
      providerId: OLLAMA_CLOUD_ROUTE_ID,
      routeId: OLLAMA_CLOUD_ROUTE_ID,
      configured: configured !== undefined,
      modelCount: Array.isArray(configured?.models) ? configured.models.length : 0,
    }
  }

  async #request(url, init, signal) {
    let response
    try {
      response = await this.fetch(url, { ...init, redirect: 'error', signal: boundedSignal(signal) })
    } catch (error) {
      if (signal?.aborted) throw new AccountsError('cancelled', 'Ollama Cloud model catalog synchronization was cancelled', { cause: error })
      throw new AccountsError('provider-network-failed', 'Ollama Cloud model catalog request failed', { cause: error })
    }
    assertResponseOrigin(response, url, this.allowedOrigins)
    if (response.status !== 200) {
      throw new AccountsError(response.status === 401 || response.status === 403 ? 'credential-invalid' : 'provider-http-error',
        `Ollama Cloud model catalog returned HTTP ${Number(response.status) || 0}`)
    }
    return jsonBody(response)
  }

  async sync({ apiKey, signal } = {}) {
    if (typeof apiKey !== 'string' || apiKey.length === 0 || /[\r\n]/.test(apiKey)) {
      throw new AccountsError('credential-required', 'Ollama Cloud API key is required')
    }
    const currentRoute = this.settings.get('llm-pi-ai')?.providers?.[OLLAMA_CLOUD_ROUTE_ID]
    if (currentRoute !== undefined && !(currentRoute?.apiKeyEnv === OLLAMA_CLOUD_CREDENTIAL_REF
      && currentRoute?.api === 'openai-completions'
      && currentRoute?.baseURL === OLLAMA_CLOUD_OPENAI_URL)) {
      throw new AccountsError('route-conflict', 'ollama-cloud is already configured as a different model route')
    }
    const headers = { accept: 'application/json', Authorization: `Bearer ${apiKey}` }
    const listing = await this.#request(this.tagsUrl, { method: 'GET', headers }, signal)
    if (!Array.isArray(listing?.models) || listing.models.length === 0) {
      throw new AccountsError('empty-model-catalog', 'Ollama Cloud returned no selectable models')
    }
    const tags = [...new Map(listing.models.map(tag => {
      const id = typeof tag?.model === 'string' && tag.model.trim() ? tag.model.trim()
        : typeof tag?.name === 'string' ? tag.name.trim() : ''
      return [id, tag]
    }).filter(([id]) => id)).values()].sort((left, right) => {
      const leftId = left.model ?? left.name
      const rightId = right.model ?? right.name
      return String(leftId).localeCompare(String(rightId))
    })
    const resolved = []
    let failedDetails = 0
    for (let offset = 0; offset < tags.length; offset += 4) {
      const batch = tags.slice(offset, offset + 4)
      const shown = await Promise.all(batch.map(async tag => {
        const id = tag.model ?? tag.name
        try {
          const body = await this.#request(this.showUrl, {
            method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify({ model: id }),
          }, signal)
          return { tag, show: body, enriched: true }
        } catch (error) {
          if (signal?.aborted) throw error
          failedDetails += 1
          return { tag, show: { capabilities: ['completion'] }, enriched: false }
        }
      }))
      resolved.push(...shown)
    }
    const discovered = resolved
      .map(entry => ({ ...entry, model: modelFrom(entry.tag, entry.show) }))
      .filter(entry => entry.model !== null)
    if (discovered.length === 0) throw new AccountsError('empty-model-catalog', 'Ollama Cloud returned no selectable completion models')
    const existingModels = new Map(Array.isArray(currentRoute?.models)
      ? currentRoute.models.filter(model => typeof model?.id === 'string').map(model => [model.id, model])
      : [])
    const models = discovered.map(({ model, enriched }) => {
      const existing = existingModels.get(model.id)
      if (!enriched && existing !== undefined) return { ...existing }
      const customName = typeof existing?.name === 'string' && existing.name.trim() && existing.name !== existing.id
        ? existing.name
        : undefined
      return { ...(existing ?? {}), ...model, ...(customName === undefined ? {} : { name: customName }) }
    })
    await this.settings.update('llm-pi-ai', { providers: { [OLLAMA_CLOUD_ROUTE_ID]: route(currentRoute, models) } })
    return {
      providerId: OLLAMA_CLOUD_ROUTE_ID,
      routeId: OLLAMA_CLOUD_ROUTE_ID,
      modelCount: models.length,
      enrichedCount: resolved.filter(entry => entry.enriched && modelFrom(entry.tag, entry.show) !== null).length,
      failedDetails,
    }
  }
}
