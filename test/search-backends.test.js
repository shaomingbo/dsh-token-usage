import test from 'node:test'
import assert from 'node:assert/strict'
import { registerAccountSearchBackends, parseSseResponses } from '../lib/accounts/search-backends.js'

function sseResponse(events, { contentType = 'text/event-stream' } = {}) {
  const body = events.map(event => typeof event === 'string' ? event : `data: ${JSON.stringify(event)}\n\n`).join('')
  return { ok: true, status: 200, headers: new Headers({ 'content-type': contentType }), text: async () => body }
}

function jsonResponse(payload, { status = 200, contentType = 'application/json' } = {}) {
  return { ok: status < 400, status, headers: new Headers({ 'content-type': contentType }), text: async () => JSON.stringify(payload) }
}

/**
 * Synthetic fixture mirroring the live chatgpt.com codex SSE shape (redacted
 * ids): delta events carry text fragments, url_citation annotations arrive via
 * response.output_text.annotation.added, the terminal response.completed
 * echoes an EMPTY output array, and a message output_item.done repeats the
 * full text with the same annotation.
 */
const FIXTURE_EVENTS = [
  { type: 'response.created', response: { id: 'resp_fixture_redacted', object: 'response', status: 'in_progress', model: 'gpt-5.6-sol' } },
  { type: 'response.in_progress', response: { id: 'resp_fixture_redacted', status: 'in_progress' } },
  { type: 'response.output_item.added', output_index: 0, item: { id: 'ws_fixture_redacted', type: 'web_search_call', status: 'in_progress' } },
  { type: 'response.web_search_call.completed', output_index: 0, item: { id: 'ws_fixture_redacted', type: 'web_search_call', status: 'completed' } },
  { type: 'response.output_item.added', output_index: 1, item: { id: 'msg_fixture_redacted', type: 'message', role: 'assistant', status: 'in_progress' } },
  { type: 'response.content_part.added', item_id: 'msg_fixture_redacted', output_index: 1, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
  { type: 'response.output_text.delta', item_id: 'msg_fixture_redacted', output_index: 1, content_index: 0, delta: 'Answer one. ' },
  { type: 'response.output_text.annotation.added', item_id: 'msg_fixture_redacted', output_index: 1, content_index: 0, annotation_index: 0, annotation: { type: 'url_citation', start_index: 11, end_index: 18, title: 'Example A', url: 'https://example.com/a' } },
  { type: 'response.output_text.delta', item_id: 'msg_fixture_redacted', output_index: 1, content_index: 0, delta: 'Answer two.' },
  { type: 'response.output_text.done', item_id: 'msg_fixture_redacted', output_index: 1, content_index: 0, text: 'Answer one. Answer two.' },
  { type: 'response.content_part.done', item_id: 'msg_fixture_redacted', output_index: 1, content_index: 0, part: { type: 'output_text', text: 'Answer one. Answer two.', annotations: [{ type: 'url_citation', title: 'Example A', url: 'https://example.com/a' }] } },
  { type: 'response.output_item.done', output_index: 1, item: { id: 'msg_fixture_redacted', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Answer one. Answer two.', annotations: [{ type: 'url_citation', title: 'Example A', url: 'https://example.com/a' }] }] } },
  { type: 'response.completed', response: { id: 'resp_fixture_redacted', object: 'response', status: 'completed', model: 'gpt-5.6-sol', output: [] } },
]

function chainHarness(capabilities, fetchImpl) {
  const registered = []
  const searchChain = { register(backend) { registered.push(backend); return () => {} } }
  registerAccountSearchBackends(searchChain, capabilities, { fetchImpl })
  return registered
}

test('chatgpt codex leg sends the streaming shape and aggregates the SSE responses stream', async () => {
  const token = 'oauth-secret-value'
  const capabilities = { chatgptGrok: { auth: { resolveOAuth: async () => ({ apiKey: token, headers: { 'chatgpt-account-id': 'acct' } }) } } }
  const calls = []
  const registered = chainHarness(capabilities, async (url, init) => {
    calls.push({ url, init })
    return sseResponse(FIXTURE_EVENTS)
  })
  const result = await registered[0].search({ query: 'fixture' })

  const body = JSON.parse(calls[0].init.body)
  assert.equal(calls[0].url, 'https://chatgpt.com/backend-api/codex/responses')
  assert.equal(body.stream, true)
  assert.equal(body.store, false)
  assert.equal('max_output_tokens' in body, false)
  assert.deepEqual(body.tools, [{ type: 'web_search' }])
  assert.equal(body.tool_choice, 'auto')
  assert.equal(calls[0].init.headers.accept, 'text/event-stream, application/json')
  assert.equal(calls[0].init.headers['chatgpt-account-id'], 'acct')
  assert.equal(calls[0].init.headers.authorization, `Bearer ${token}`)
  assert.equal(calls[0].init.redirect, 'error')

  // Text comes from ordered delta aggregation, not the repeated item text.
  assert.equal(result.content, 'Answer one. Answer two.')
  assert.deepEqual(result.sources, [{ url: 'https://example.com/a', title: 'Example A' }])
  assert.equal(result.truncated, false)
  assert.equal(JSON.stringify(result).includes(token), false)
})

test('grok leg keeps the documented non-streaming xai shape and parses JSON', async () => {
  const token = 'oauth-secret-value'
  const capabilities = { chatgptGrok: { auth: { resolveOAuth: async () => ({ apiKey: token }) } } }
  const calls = []
  const registered = chainHarness(capabilities, async (url, init) => {
    calls.push({ url, init })
    return jsonResponse({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'grok answer', annotations: [{ type: 'url_citation', url: 'https://example.com/g', title: 'Example G' }] }] }],
    })
  })
  const result = await registered[1].search({ query: 'fixture' })

  const body = JSON.parse(calls[0].init.body)
  assert.equal(calls[0].url, 'https://api.x.ai/v1/responses')
  assert.equal(body.stream, undefined)
  assert.equal(body.max_output_tokens, 4096)
  assert.equal(calls[0].init.headers.accept, 'application/json')
  assert.equal(result.content, 'grok answer')
  assert.deepEqual(result.sources, [{ url: 'https://example.com/g', title: 'Example G' }])
})

test('streaming endpoints that answer JSON anyway fall back to the non-streaming reader', async () => {
  const capabilities = { chatgptGrok: { auth: { resolveOAuth: async () => ({ apiKey: 't' }) } } }
  const registered = chainHarness(capabilities, async () => jsonResponse({
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'json despite stream:true', annotations: [{ type: 'url_citation', url: 'https://example.com/j' }] }] }],
  }))
  const result = await registered[0].search({ query: 'fixture' })
  assert.equal(result.content, 'json despite stream:true')
  assert.deepEqual(result.sources, [{ url: 'https://example.com/j' }])
})

test('an SSE content-type carrying a JSON body still parses through the JSON fallback', async () => {
  const capabilities = { chatgptGrok: { auth: { resolveOAuth: async () => ({ apiKey: 't' }) } } }
  const registered = chainHarness(capabilities, async () => jsonResponse(
    { output: [{ content: [{ type: 'output_text', text: 'mislabeled json' }] }] },
    { contentType: 'text/event-stream' },
  ))
  const result = await registered[0].search({ query: 'fixture' })
  assert.equal(result.content, 'mislabeled json')
})

test('SSE aggregator skips [DONE] and joins multi-line data payloads', () => {
  const raw = [
    'data: {"type":"response.output_text.delta","delta":"part "}',
    '',
    'data: {',
    'data: "type":"response.output_text.delta","delta":"two"}',
    '',
    'data: [DONE]',
    '',
    'data: {"type":"response.completed","response":{"status":"completed","output":[]}}',
    '',
  ].join('\n')
  const result = parseSseResponses(raw)
  assert.equal(result.content, 'part two')
  assert.deepEqual(result.sources, [])
  assert.equal(result.truncated, false)
})

test('SSE aggregator handles CRLF framing and annotation dedup', () => {
  const raw = [
    'data: {"type":"response.output_text.delta","delta":"text"}\r',
    'data: {"type":"response.output_text.annotation.added","annotation":{"type":"url_citation","url":"https://example.com/x","title":"X"}}\r',
    'data: {"type":"response.output_text.annotation.added","annotation":{"type":"url_citation","url":"https://example.com/x","title":"X again"}}\r',
    'data: {"type":"response.completed","response":{"status":"completed","output":[]}}\r',
    '',
  ].join('\r\n')
  const result = parseSseResponses(raw)
  assert.equal(result.content, 'text')
  assert.deepEqual(result.sources, [{ url: 'https://example.com/x', title: 'X' }])
})

test('response.completed output_item annotations are collected without double-counting text', () => {
  const raw = [
    'data: {"type":"response.output_text.delta","delta":"only deltas"}',
    '',
    'data: {"type":"response.output_item.done","item":{"type":"message","content":[{"type":"output_text","text":"only deltas","annotations":[{"type":"url_citation","url":"https://example.com/d"}]}]}}',
    '',
    'data: {"type":"response.completed","response":{"status":"completed","output":[]}}',
    '',
  ].join('\n')
  const result = parseSseResponses(raw)
  assert.equal(result.content, 'only deltas')
  assert.deepEqual(result.sources, [{ url: 'https://example.com/d' }])
})

test('a response.incomplete stream resolves honestly as truncated', () => {
  const raw = [
    'data: {"type":"response.output_text.delta","delta":"cut short"}',
    '',
    'data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}',
    '',
  ].join('\n')
  const result = parseSseResponses(raw)
  assert.equal(result.content, 'cut short')
  assert.equal(result.truncated, true)
})

test('a stream cut without a terminal event fails loudly with the observed event mix', async () => {
  const capabilities = { chatgptGrok: { auth: { resolveOAuth: async () => ({ apiKey: 't' }) } } }
  const registered = chainHarness(capabilities, async () => sseResponse([
    { type: 'response.created', response: { status: 'in_progress' } },
    { type: 'response.output_text.delta', delta: 'half an' },
  ]))
  await assert.rejects(registered[0].search({ query: 'fixture' }), error => {
    assert.equal(error.code, 'SEARCH_BACKEND_INVALID_RESPONSE')
    assert.match(error.message, /without a terminal response event/)
    assert.match(error.message, /response\.output_text\.delta×1/)
    return true
  })
})

test('response.failed surfaces the upstream failure instead of an empty success', async () => {
  const capabilities = { chatgptGrok: { auth: { resolveOAuth: async () => ({ apiKey: 't' }) } } }
  const registered = chainHarness(capabilities, async () => sseResponse([
    { type: 'response.failed', response: { status: 'failed', error: { code: 'server_error', message: 'upstream boom' } } },
  ]))
  await assert.rejects(registered[0].search({ query: 'fixture' }), error => {
    assert.equal(error.code, 'SEARCH_BACKEND_INVALID_RESPONSE')
    assert.match(error.message, /reported failure/)
    return true
  })
})

test('a non-JSON, non-SSE body fails loudly with content-type and a sanitized body head', async () => {
  const capabilities = { chatgptGrok: { auth: { resolveOAuth: async () => ({ apiKey: 't' }) } } }
  const registered = chainHarness(capabilities, async () => sseResponse(['<html>gateway exploded</html>'], { contentType: 'text/html' }))
  await assert.rejects(registered[0].search({ query: 'fixture' }), error => {
    assert.equal(error.code, 'SEARCH_BACKEND_INVALID_RESPONSE')
    assert.match(error.message, /content-type text\/html/)
    assert.match(error.message, /gateway exploded/)
    return true
  })
})

test('diagnostics scrub bearer-style secrets from body fragments', async () => {
  const capabilities = { chatgptGrok: { auth: { resolveOAuth: async () => ({ apiKey: 't' }) } } }
  const registered = chainHarness(capabilities, async () => sseResponse([
    { type: 'response.failed', response: { status: 'failed', error: { code: 'server_error', message: 'Bearer abcdef1234567890 leaked sk-abcdefgh12345678' } } },
  ]))
  await assert.rejects(registered[0].search({ query: 'fixture' }), error => {
    assert.equal(error.code, 'SEARCH_BACKEND_INVALID_RESPONSE')
    assert.match(error.message, /reported failure/)
    assert.match(error.message, /Bearer \[redacted\]/)
    assert.match(error.message, /sk-\[redacted\]/)
    assert.doesNotMatch(error.message, /abcdef1234567890/)
    return true
  })
})

test('malformed SSE data lines fall back to JSON when the body is actually JSON', async () => {
  const capabilities = { chatgptGrok: { auth: { resolveOAuth: async () => ({ apiKey: 't' }) } } }
  const registered = chainHarness(capabilities, async () => jsonResponse(
    { output: [{ content: [{ type: 'output_text', text: 'actually json' }] }] },
    { contentType: 'text/event-stream' },
  ))
  const result = await registered[0].search({ query: 'fixture' })
  assert.equal(result.content, 'actually json')
})

test('HTTP error responses keep their dedicated error code', async () => {
  const capabilities = { chatgptGrok: { auth: { resolveOAuth: async () => ({ apiKey: 't' }) } } }
  const registered = chainHarness(capabilities, async () => jsonResponse({ detail: 'Stream must be set to true' }, { status: 400 }))
  await assert.rejects(registered[0].search({ query: 'fixture' }), error => {
    assert.equal(error.code, 'SEARCH_BACKEND_HTTP_ERROR')
    assert.match(error.message, /HTTP 400/)
    return true
  })
})

test('optional searchChain receives callable ChatGPT/Grok backends without token exposure', async () => {
  const registered = []
  const searchChain = { register(backend) { registered.push(backend); return () => {} } }
  const token = 'oauth-secret-value'
  const capabilities = { chatgptGrok: { auth: { resolveOAuth: async provider => ({ apiKey: token, headers: provider === 'openai-codex' ? { 'chatgpt-account-id': 'acct' } : undefined }) } } }
  const calls = []
  const dispose = registerAccountSearchBackends(searchChain, capabilities, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return sseResponse(FIXTURE_EVENTS)
    },
  })
  assert.deepEqual(registered.map(item => item.id), ['chatgpt', 'grok'])
  const result = await registered[0].search({ query: 'fixture' })
  assert.deepEqual(result.sources, [{ url: 'https://example.com/a', title: 'Example A' }])
  assert.equal(JSON.stringify(result).includes(token), false)
  assert.equal(dispose.length, 2)
})

test('account backends report connection state without touching OAuth values', async () => {
  const registered = []
  const searchChain = { register(backend) { registered.push(backend); return () => {} } }
  const configured = new Set(['openai-codex'])
  const capabilities = { chatgptGrok: { auth: {
    configured: provider => configured.has(provider),
    resolveOAuth: async () => { throw new Error('status probes must not resolve OAuth') },
  } } }
  registerAccountSearchBackends(searchChain, capabilities, { fetchImpl: async () => { throw new Error('no search here') } })

  assert.deepEqual(await registered[0].status(), { availability: 'available' })
  assert.equal(await registered[0].available(), true)
  assert.deepEqual(await registered[1].status(), { availability: 'unavailable' })
  assert.equal(await registered[1].available(), false)
  assert.equal(JSON.stringify(await registered[0].status()).includes('oauth'), false)
})

test('account backends claim nothing when the host exposes no configured probe', async () => {
  const registered = []
  const searchChain = { register(backend) { registered.push(backend); return () => {} } }
  const capabilities = { chatgptGrok: { auth: { resolveOAuth: async () => undefined } } }
  registerAccountSearchBackends(searchChain, capabilities, { fetchImpl: async () => { throw new Error('no search here') } })
  for (const backend of registered) {
    assert.equal(backend.status(), undefined)
    assert.equal(await backend.available(), true)
  }
})