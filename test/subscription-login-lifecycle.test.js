import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createChatGptGrokCapability } from '../lib/capabilities/chatgpt-grok/capability.js'

async function fixture(t, { publish = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'subscription-lifecycle-'))
  const capability = createChatGptGrokCapability({ filename: join(root, '.oauth.json') })
  const operations = []
  capability.auth.models.login = async (provider, kind, interaction) => {
    const op = { provider, interaction }
    operations.push(op)
    if (publish) interaction.notify({ type: 'device_code', userCode: 'FIXTURE-CODE', verificationUri: provider === 'xai' ? 'https://auth.x.ai/activate' : 'https://auth.openai.com/activate', expiresInSeconds: 600 })
    await new Promise((resolve, reject) => {
      op.succeed = resolve
      interaction.signal.addEventListener('abort', () => reject(new Error('fixture aborted')), { once: true })
    })
  }
  await capability.init({ provisionRoutes: false })
  t.after(async () => { await capability.dispose(); await rm(root, { recursive: true, force: true }) })
  const rpc = (action, params) => capability.handleRpc(action, params)
  return { capability, operations, rpc }
}

test('real capability RPC returns the active challenge and cancels by its login id', async t => {
  const { rpc, operations } = await fixture(t)
  const started = await rpc('start-login', { provider: 'xai' })
  assert.equal(started.ok, true)
  const pending = await rpc('pending-login', { provider: 'xai' })
  assert.equal(pending.ok, true, pending.error?.message)
  assert.equal(pending.value.active, true)
  assert.deepEqual(pending.value.login, started.value.challenge)
  assert.equal(operations.length, 1, 'pending lookup never starts another login')
  const cancelled = await rpc('cancel-login', { loginId: pending.value.login.loginId })
  assert.equal(cancelled.ok, true)
  assert.equal((await rpc('login-status', { loginId: started.value.challenge.loginId })).value.status.kind, 'cancelled')
  assert.deepEqual((await rpc('pending-login', { provider: 'xai' })).value, { active: false, login: null })
  assert.equal((await rpc('start-login', { provider: 'xai' })).ok, true, 'a new attempt is possible after cancellation')
})

test('cancel by provider works before challenge publication and does not cancel another provider', async t => {
  const { rpc, operations } = await fixture(t, { publish: false })
  const grok = rpc('start-login', { provider: 'xai' })
  const openai = rpc('start-login', { provider: 'openai-codex' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(operations.length, 2)
  const pending = await rpc('pending-login', { provider: 'xai' })
  assert.equal(pending.ok, true, pending.error?.message)
  assert.equal(pending.value.active, true)
  assert.ok(pending.value.login.loginId)
  assert.equal(pending.value.login.userCode, undefined)
  const cancelled = await rpc('cancel-login', { provider: 'xai' })
  assert.equal(cancelled.ok, true, cancelled.error?.message)
  assert.equal((await grok).ok, false)
  assert.equal(operations.find(o => o.provider === 'xai').interaction.signal.aborted, true)
  assert.equal(operations.find(o => o.provider === 'openai-codex').interaction.signal.aborted, false)
  assert.equal((await rpc('cancel-login', { provider: 'xai' })).ok, true, 'repeat provider cancellation is harmless')
  await rpc('cancel-login', { provider: 'openai-codex' })
  await openai
})

test('a reattached starting login receives its later challenge through login status', async t => {
  const { rpc, operations } = await fixture(t, { publish: false })
  const starting = rpc('start-login', { provider: 'xai' })
  await new Promise(resolve => setImmediate(resolve))
  const pending = await rpc('pending-login', { provider: 'xai' })
  assert.equal(pending.ok, true, pending.error?.message)
  operations[0].interaction.notify({ type: 'device_code', userCode: 'FIXTURE-LATER', verificationUri: 'https://auth.x.ai/activate' })
  const started = await starting
  const status = await rpc('login-status', { loginId: pending.value.login.loginId })
  assert.deepEqual(status.value.status.challenge, started.value.challenge)
  assert.equal(operations.length, 1)
})

test('pending and provider cancellation reject unknown providers without starting auth', async t => {
  const { rpc, operations } = await fixture(t)
  assert.equal((await rpc('pending-login', { provider: 'unknown' })).ok, false)
  assert.equal((await rpc('cancel-login', { provider: 'unknown' })).ok, false)
  assert.equal((await rpc('cancel-login', {})).ok, false)
  assert.equal(operations.length, 0)
})
