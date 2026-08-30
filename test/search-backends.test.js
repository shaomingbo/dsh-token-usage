import test from 'node:test'
import assert from 'node:assert/strict'
import { registerAccountSearchBackends } from '../lib/accounts/search-backends.js'

test('optional searchChain receives callable ChatGPT/Grok backends without token exposure', async () => {
  const registered = []
  const searchChain = { register(backend) { registered.push(backend); return () => {} } }
  const token = 'oauth-secret-value'
  const capabilities = { chatgptGrok: { auth: { resolveOAuth: async provider => ({ apiKey: token, headers: provider === 'openai-codex' ? { 'chatgpt-account-id': 'acct' } : undefined }) } } }
  const calls = []
  const dispose = registerAccountSearchBackends(searchChain, capabilities, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return { ok: true, status: 200, async json() { return { output: [{ content: [{ type: 'output_text', text: 'answer', annotations: [{ type: 'url_citation', url: 'https://example.com', title: 'Example' }] }] }] } } }
    },
  })
  assert.deepEqual(registered.map(item => item.id), ['chatgpt', 'grok'])
  const result = await registered[0].search({ query: 'fixture' })
  assert.deepEqual(result.sources, [{ url: 'https://example.com', title: 'Example' }])
  assert.equal(JSON.stringify(result).includes(token), false)
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(calls[0].init.headers.authorization, `Bearer ${token}`)
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
