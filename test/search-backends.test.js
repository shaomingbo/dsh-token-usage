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
