const USER_AGENT = 'dsh-token-usage/4.2.0'

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
  // chatgpt.com/backend-api/codex is an evolving internal endpoint: live probes
  // (2026-09, redacted curl experiments) showed it rejects `stream: false`
  // ("Stream must be set to true") and `max_output_tokens`
  // ("Unsupported parameter") while a stream:true body without the token cap
  // answers 200 with an SSE responses stream. api.x.ai is a documented public
  // API where both `stream: false` and `max_output_tokens` remain supported
  // (endpoint behavior unverified here — no Grok login in the test
  // environment), so only the ChatGPT leg adopts the streaming shape; both
  // legs share the content-type-adaptive response reader, so an xai stream
  // would still aggregate if the endpoint ever switches on its own.
  const streaming = provider === 'openai-codex'
  return {
    id,
    label,
    /**
     * Secret-free configuration probe for the chain's `list()`: 'available'
     * when the OAuth store holds this provider, else 'unavailable'. Hosts
     * without `auth.configured` get no claim, which the chain reads as
     * 'unknown' rather than a guess.
     */
    status() {
      if (typeof auth.configured !== 'function') return undefined
      return { availability: auth.configured(provider) ? 'available' : 'unavailable' }
    },
    /** Search-leg gate: skip the request round-trip when not connected. */
    available() {
      return typeof auth.configured === 'function' ? auth.configured(provider) : true
    },
    async search(request, signal) {
      if (typeof request?.query !== 'string' || request.query.trim() === '') {
        throw new AccountSearchError('SEARCH_INVALID_REQUEST', 'search query is required')
      }
      const oauth = await auth.resolveOAuth(provider, signal)
      if (oauth === undefined) throw new AccountSearchError('SEARCH_CREDENTIAL_MISSING', `${label} is not connected`)
      const body = streaming
        ? {
            model, store: false, stream: true,
            instructions: 'Search the web for the user query. Answer concisely and preserve URL citations.',
            input: [{ role: 'user', content: [{ type: 'input_text', text: request.query }] }],
            tools: [{ type: 'web_search' }], tool_choice: 'auto',
          }
        : { model, input: request.query, tools: [{ type: 'web_search' }], tool_choice: 'auto', max_output_tokens: 4096 }
      let response
      try {
        response = await fetchImpl(`${baseUrl}/responses`, {
          method: 'POST', redirect: 'error', signal,
          headers: {
            authorization: `Bearer ${oauth.apiKey}`,
            'content-type': 'application/json',
            accept: streaming ? 'text/event-stream, application/json' : 'application/json',
            'user-agent': USER_AGENT,
            ...(oauth.headers ?? {}),
          },
          body: JSON.stringify(body),
        })
      } catch {
        if (signal?.aborted) throw signal.reason
        throw new AccountSearchError('SEARCH_BACKEND_REQUEST_FAILED', `${label} search request failed`)
      }
      if (!response.ok) throw new AccountSearchError('SEARCH_BACKEND_HTTP_ERROR', `${label} search failed (HTTP ${response.status})`)
      return readResponsesPayload(response, label, signal)
    },
  }
}

/**
 * Content-type-adaptive reader for the /responses legs. The ChatGPT codex
 * endpoint answers SSE (`text/event-stream`) since it forces `stream: true`;
 * a JSON body (the xai shape, or any endpoint that ignores the stream flag)
 * still parses through the original non-streaming result reader. Anything
 * else fails loudly with a sanitized content-type/body-head diagnostic —
 * never a fabricated success.
 */
async function readResponsesPayload(response, label, signal) {
  let raw
  try { raw = await response.text() } catch (error) {
    if (signal?.aborted) throw signal.reason
    throw new AccountSearchError('SEARCH_BACKEND_INVALID_RESPONSE', `${label} response could not be read (${error?.message ?? 'read failed'})`)
  }
  const contentType = String(response.headers?.get?.('content-type') ?? '')
  if (looksLikeSse(contentType, raw)) {
    try {
      return parseSseResponses(raw, label)
    } catch (error) {
      if (error instanceof AccountSearchError && error.code !== 'SEARCH_BACKEND_SSE_MALFORMED') throw error
      if (looksLikeJsonBody(raw)) {
        return parseJsonPayload(raw, label, contentType, `SSE parse failed (${error instanceof Error ? error.message : 'unknown'}), JSON fallback applied`)
      }
      throw new AccountSearchError('SEARCH_BACKEND_INVALID_RESPONSE', `${label} returned an unparseable stream (content-type ${contentType || 'none'}): ${sanitizeFragment(raw)}; ${error instanceof Error ? error.message : 'SSE parse failed'}`)
    }
  }
  return parseJsonPayload(raw, label, contentType)
}

function looksLikeSse(contentType, raw) {
  if (contentType.includes('text/event-stream')) return true
  if (contentType.includes('application/json')) return false
  const head = raw.slice(0, 64).trimStart()
  return head.startsWith('event:') || head.startsWith('data:')
}

function looksLikeJsonBody(raw) {
  return raw.trimStart().startsWith('{')
}

function parseJsonPayload(raw, label, contentType, note) {
  let payload
  try { payload = JSON.parse(raw) } catch {
    throw new AccountSearchError('SEARCH_BACKEND_INVALID_RESPONSE', `${label} returned invalid JSON (content-type ${contentType || 'none'}${note ? `; ${note}` : ''}): ${sanitizeFragment(raw)}`)
  }
  return parseResponsesResult(payload)
}

/**
 * Minimal SSE aggregator for the OpenAI responses stream shape: `data:` lines
 * carry one JSON event each (`event:` lines are redundant — the type lives in
 * the payload), `[DONE]` is skipped, and the final text is the ordered join of
 * `response.output_text.delta` payloads. `url_citation` annotations arrive via
 * `response.output_text.annotation.added`. The terminal event decides
 * success: `response.completed`/`response.incomplete` resolve (the latter as
 * `truncated: true`), anything else — a stream cut without a terminal event,
 * or `response.failed` — throws with the observed event mix instead of
 * pretending the search answered. Note `response.completed` carries an empty
 * `output` array on this endpoint, so deltas are the only text source.
 */
export function parseSseResponses(raw, label = 'provider') {
  const text = []
  const sources = new Map()
  const seenEvents = new Map()
  let terminal
  let dataLines = []
  const dispatch = line => {
    const data = line.join('\n')
    dataLines = []
    if (data === '' || data === '[DONE]') return
    let event
    try { event = JSON.parse(data) } catch { throw new AccountSearchError('SEARCH_BACKEND_SSE_MALFORMED', 'SSE data line is not JSON') }
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
      throw new AccountSearchError('SEARCH_BACKEND_SSE_MALFORMED', 'SSE event is missing a string type')
    }
    seenEvents.set(event.type, (seenEvents.get(event.type) ?? 0) + 1)
    if (event.type === 'response.output_text.delta') {
      if (typeof event.delta === 'string') text.push(event.delta)
      return
    }
    if (event.type === 'response.output_text.annotation.added') {
      collectSources([event.annotation], sources)
      return
    }
    if (event.type === 'response.output_item.done') {
      // Message items repeat the full text; collecting it would double-count
      // against the deltas, so only their annotations are harvested here.
      for (const part of Array.isArray(event.item?.content) ? event.item.content : []) {
        collectSources(part?.annotations, sources)
      }
      return
    }
    if (event.type === 'response.completed' || event.type === 'response.incomplete') {
      terminal = { status: event.response?.status ?? (event.type === 'response.incomplete' ? 'incomplete' : 'completed') }
      return
    }
    if (event.type === 'response.failed') {
      terminal = { status: 'failed', error: event.response?.error ?? event.error }
      return
    }
  }
  for (const line of raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
      continue
    }
    if (line.trim() === '') {
      if (dataLines.length > 0) dispatch(dataLines)
      continue
    }
    // `event:`, `id:`, `retry:`, and `:`-comment lines carry nothing the
    // payload JSON does not already provide.
  }
  if (dataLines.length > 0) dispatch(dataLines)
  if (terminal === undefined) {
    const mix = [...seenEvents].map(([type, count]) => `${type}×${count}`).join(', ') || 'no events'
    // Structural failure: eligible for the JSON fallback when the body turns
    // out to be JSON after all, else surfaced with full diagnostics below.
    throw new AccountSearchError('SEARCH_BACKEND_SSE_MALFORMED', `${label} stream ended without a terminal response event (observed: ${mix}): ${sanitizeFragment(raw)}`)
  }
  if (terminal.status === 'failed') {
    throw new AccountSearchError('SEARCH_BACKEND_INVALID_RESPONSE', `${label} stream reported failure${terminal.error ? `: ${sanitizeFragment(JSON.stringify(terminal.error))}` : ''}`)
  }
  const content = text.join('').trim()
  return { ...(content ? { content } : {}), sources: [...sources.values()], truncated: terminal.status === 'incomplete' }
}

/** Body-head diagnostics are truncated and scrubbed of bearer-style secrets. */
function sanitizeFragment(text) {
  const fragment = String(text).slice(0, 200)
  return fragment
    .replace(/Bearer\s+[\w.~+/=-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\bsk-[\w-]{8,}/g, 'sk-[redacted]')
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
