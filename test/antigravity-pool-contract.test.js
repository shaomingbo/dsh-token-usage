import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthStore } from '../lib/capabilities/antigravity/auth-store.js'
import { AntigravityAuth } from '../lib/capabilities/antigravity/oauth.js'

// Contract test for the settings master-detail account pool (B-form redesign).
// The Accounts & Models section reads exactly this shape through the
// `accounts` capability RPC — collectConnections passes `antigravity.accounts`
// straight through — so the pool UI relies on: secret-free rows carrying
// active/expired flags, the opt-in failover preference, and rotation on
// removal of the active account.

const NOW = 1_800_000_000_000
const HOUR = 3_600_000

function tempHome() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-token-usage-agy-pool-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function credential(expires, email, createdAt) {
  return { type: 'oauth', access: `access-${email}`, refresh: `refresh-${email}`, expires, email, createdAt }
}

async function makeAuth(doc) {
  const { dir, cleanup } = tempHome()
  const filename = join(dir, '.antigravity-auth.json')
  writeFileSync(filename, JSON.stringify(doc))
  const auth = new AntigravityAuth({ store: new AuthStore({ filename }), clock: () => NOW })
  await auth.init()
  return { auth, cleanup }
}

test('statuses expose the secret-free pool contract the settings UI reads', async () => {
  const { auth, cleanup } = await makeAuth({
    version: 2,
    accounts: {
      'email:pool-1': credential(NOW + 10 * HOUR, 'one@example.com', NOW - 9 * HOUR),
      'email:pool-2': credential(NOW + 10 * HOUR, 'two@example.com', NOW - 8 * HOUR),
      'email:pool-3': credential(NOW - HOUR, 'three@example.com', NOW - 7 * HOUR),
    },
    activeAccountId: 'email:pool-1',
    autoFailover: true,
  })
  try {
    const statuses = auth.statuses()
    assert.equal(statuses.length, 3)
    for (const row of statuses) {
      assert.equal(row.provider, 'antigravity')
      assert.equal(row.configured, true)
      assert.equal(typeof row.accountId, 'string')
      assert.equal(typeof row.active, 'boolean')
      assert.equal(typeof row.expired, 'boolean')
      // secret-free: the token triple never crosses the RPC seam
      assert.equal(row.access, undefined)
      assert.equal(row.refresh, undefined)
      assert.equal(row.type, undefined)
    }
    assert.equal(statuses.find(row => row.accountId === 'email:pool-1').active, true)
    assert.equal(statuses.find(row => row.accountId === 'email:pool-2').active, false)
    assert.equal(statuses.find(row => row.accountId === 'email:pool-3').expired, true)
    assert.equal(statuses.find(row => row.accountId === 'email:pool-2').expired, false)
    assert.equal(auth.activeAccountId(), 'email:pool-1')
    assert.equal(auth.autoFailoverEnabled(), true)
  } finally {
    cleanup()
  }
})

test('set-auto-failover toggles the opt-in preference', async () => {
  const { auth, cleanup } = await makeAuth({
    version: 2,
    accounts: { 'email:pool-1': credential(NOW + 10 * HOUR, 'one@example.com', NOW) },
    activeAccountId: 'email:pool-1',
    autoFailover: true,
  })
  try {
    await auth.setAutoFailover(false)
    assert.equal(auth.autoFailoverEnabled(), false)
    await auth.setAutoFailover(true)
    assert.equal(auth.autoFailoverEnabled(), true)
  } finally {
    cleanup()
  }
})

test('removing the active account rotates to the next pool member', async () => {
  const { auth, cleanup } = await makeAuth({
    version: 2,
    accounts: {
      'email:pool-1': credential(NOW + 10 * HOUR, 'one@example.com', NOW - 9 * HOUR),
      'email:pool-2': credential(NOW + 10 * HOUR, 'two@example.com', NOW - 8 * HOUR),
    },
    activeAccountId: 'email:pool-1',
    autoFailover: false,
  })
  try {
    const nextActive = await auth.removeAccount('email:pool-1')
    assert.equal(nextActive, 'email:pool-2')
    assert.equal(auth.activeAccountId(), 'email:pool-2')
    assert.equal(auth.statuses().length, 1)
    assert.equal(auth.statuses()[0].active, true)
  } finally {
    cleanup()
  }
})
test('pendingLogin exposes the active sign-in for client reattach', async () => {
  const { auth, cleanup } = await makeAuth({
    version: 2,
    accounts: { 'email:pool-1': credential(NOW + 10 * HOUR, 'one@example.com', NOW) },
    activeAccountId: 'email:pool-1',
    autoFailover: false,
  })
  try {
    assert.equal(auth.pendingLogin().active, false)
    const challenge = await auth.startLogin()
    const pending = auth.pendingLogin()
    assert.equal(pending.active, true)
    assert.equal(pending.login.loginId, challenge.loginId)
    assert.ok(pending.login.authUrl.includes('accounts.google.com'), 'the rebuilt authorization link targets the Google endpoint')
    await auth.cancelLogin(challenge.loginId)
    assert.equal(auth.pendingLogin().active, false, 'no pending sign-in survives the explicit cancel')
  } finally {
    cleanup()
  }
})
