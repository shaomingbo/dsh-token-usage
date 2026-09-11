import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('token client prefers /api/token-usage/* then falls back to the generic channel', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(source, /const API_CHANNEL = '\/api'/)
  assert.match(source, /rpc\.call\(API_CHANNEL, `token-usage\/\$\{endpoint\}`/)
  assert.match(source, /rpc\.call\(CHANNEL, endpoint/)
  assert.match(source, /rpc\.call\(API_CHANNEL, `account-usage\/\$\{endpoint\}`/)
  assert.match(source, /rpc\.call\(ACCOUNT_CHANNEL, endpoint/)
})
