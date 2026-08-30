const USER_AGENT = 'dsh-token-usage/4.1.0'

class AccountSearchError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AccountSearchError'
    this.code = code
  }
}

/**
 * Register callable ChatGPT and Grok search backends into a host-owned chain.
 * This module supplies legs only: ordering, fallback, deadlines, and diagnostics
 * remain entirely owned by searchChain. OAuth values never leave each call.
 */
export function registerAccountSearchBackends(searchChain, capabilities, { fetchImpl = globalThis.fetch } = {}) {
  if (!searchChain || typeof searchChain.register !== 'function') return []
  const auth = capabilities.chatgptGrok.auth
  return [
    searchChain.register(createResponsesBackend({
      id: 'chatgpt', label: 'ChatGPT subscription', provider: 'openai-codex',
      baseUrl: 'https://chatgpt.com/backend-api/codex', model: 'gpt-5.6-sol', auth, fetchImpl,
    })),
    searchChain.register(createResponsesBackend({
      id: 'grok', label: 'Grok subscription', provider: 'xai',
      baseUrl: 'https://api.x.ai/v1', model: 'grok-4.5', auth, fetchImpl,
    })),
  ]
}

function createResponsesBackend({ id, label, provider, baseUrl, model, auth, fetchImpl }) {
  return {
    id,
    label,
    async search(request, signal) {
      if (typeof request?.query !== 'string' || request.query.trim() === '') {
        throw new AccountSearchError('SEARCH_INVALID_REQUEST', 'search query is required')
      }
      const oauth = await auth.resolveOAuth(provider, signal)
      if (oauth === undefined) throw new AccountSearchError('SEARCH_CREDENTIAL_MISSING', `${label} is not connected`)
      const body = provider === 'openai-codex'
        ? {
            model, store: false, stream: false,
            instructions: 'Search the web for the user query. Answer concisely and preserve URL citations.',
            input: [{ role: 'user', content: [{ type: 'input_text', text: request.query }] }],
            tools: [{ type: 'web_search' }], tool_choice: 'auto', max_output_tokens: 4096,
          }
        : { model, input: request.query, tools: [{ type: 'web_search' }], tool_choice: 'auto', max_output_tokens: 4096 }
      let response
      try {
        response = await fetchImpl(`${baseUrl}/responses`, {
          method: 'POST', redirect: 'error', signal,
          headers: {
            authorization: `Bearer ${oauth.apiKey}`,
            'content-type': 'application/json', accept: 'application/json', 'user-agent': USER_AGENT,
            ...(oauth.headers ?? {}),
          },
          body: JSON.stringify(body),
        })
      } catch {
        if (signal?.aborted) throw signal.reason
        throw new AccountSearchError('SEARCH_BACKEND_REQUEST_FAILED', `${label} search request failed`)
      }
      if (!response.ok) throw new AccountSearchError('SEARCH_BACKEND_HTTP_ERROR', `${label} search failed (HTTP ${response.status})`)
      let payload
      try { payload = await response.json() } catch { throw new AccountSearchError('SEARCH_BACKEND_INVALID_RESPONSE', `${label} returned invalid JSON`) }
      return parseResponsesResult(payload)
    },
  }
}

export function parseResponsesResult(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AccountSearchError('SEARCH_BACKEND_INVALID_RESPONSE', 'provider returned an invalid response')
  }
  const text = []
  const sources = new Map()
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    collectSources(item?.action?.sources, sources)
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') text.push(part.text)
      collectSources(part?.annotations, sources)
    }
  }
  collectSources(payload.citations, sources)
  const content = text.join('\n').trim()
  return { ...(content ? { content } : {}), sources: [...sources.values()], truncated: false }
}

function collectSources(values, target) {
  if (!Array.isArray(values)) return
  for (const value of values) {
    const candidate = typeof value === 'string' ? { url: value } : value
    if (!candidate || typeof candidate.url !== 'string' || !URL.canParse(candidate.url) || target.has(candidate.url)) continue
    target.set(candidate.url, { url: candidate.url, ...(typeof candidate.title === 'string' && candidate.title ? { title: candidate.title } : {}) })
  }
}
