/**
 * P1-B lifecycle ownership: account/model capabilities and codex-runtime/v1
 * belong to the account lifecycle; the analytics (usage store) lifecycle can
 * mount, fail, and be cleaned without taking them along. The Host dispose of
 * this bundle remains the only path that ends both. Also pins the read-only
 * `/account-usage` `connections` contract: pure local capability facts — no
 * usage-store dependency, no account writes, no provider network.
 *
 * Every scenario drives the real assembled host through apply() and the
 * loopback channels; no fixture pretends to be an integration that does not
 * exist. Where 5.1.2 has no analytics-only stop path (only the Host dispose
 * exists), the report records that instead of inventing one.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settingsFixture } from './settings-fixture.js'
import { ACCOUNT_USAGE_SERVICE, apply } from '../lib/index.js'

const T0 = Date.UTC(2026, 6, 10, 8, 0, 0)

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-token-usage-lifecycle-'))
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

async function settle(ms = 80) {
  await new Promise((resolvePromise) => { setTimeout(resolvePromise, ms) })
}

/** Poll until `condition()` turns true; gives async boot passes time to land. */
async function waitFor(condition, timeoutMs = 2000, step = 10) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (await condition()) return true
    await new Promise((resolvePromise) => { setTimeout(resolvePromise, step) })
  }
  return false
}

function fakeCtx({ credentialValues = {} } = {}) {
  const eventListeners = new Map()
  const channels = new Map()
  const provided = new Map()
  const session = {
    header: { version: 0, id: 's1', createdAt: T0, cwd: '/work/repo-a' },
    events: [
      { type: 'session/start', seq: 0, time: T0, data: {} },
      { type: 'request/header', seq: 1, time: T0 + 1, data: { config: { provider: 'deepseek', model: 'deepseek-chat' } } },
      { type: 'assistant/message', seq: 2, time: T0 + 2, data: { turn: 0, step: 0, message: { source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } }, usage: { inputTokens: 100, outputTokens: 50 } } },
      { type: 'step/end', seq: 3, time: T0 + 3, data: { turn: 0, step: 0 } },
    ],
  }
  const ctx = {
    logger: { error() {}, warn() {}, info() {} },
    on: (event, listener) => { eventListeners.set(event, listener) },
    interval: () => {},
    provide: (id, value) => { provided.set(id, value) },
    credentials: {
      describe: async ref => ({ configured: typeof credentialValues[ref] === 'string' && credentialValues[ref].length > 0 }),
      resolve: async ref => typeof credentialValues[ref] === 'string' ? { value: credentialValues[ref] } : undefined,
      set: async (ref, value) => { credentialValues[ref] = value },
    },
    settings: settingsFixture().forms,
    llm: settingsFixture().llm,
    connection: {
      rpc: {
        handle: (channel, handler, options) => { channels.set(channel, { handler, options }) },
      },
    },
    sessionPersistence: {
      listSnapshots: async () => [{ header: session.header, revision: 'rev-1' }],
      inspect: async () => ({ meta: session.header, events: session.events }),
    },
    // The host resolves runtime inject scopes against provided services; the
    // stub applies them synchronously against this same scope.
    inject: (names, callback) => { callback(ctx) },
  }
  return { ctx, eventListeners, channels, provided }
}

const OK_JSON = body => ({ ok: true, status: 200, json: async () => body })

/**
 * Live-owner probe: a disposed codex-runtime rejects every open with
 * CODEX_RUNTIME_DISPOSED before anything else runs; a live owner instead
 * fails further along the lease path (metadata gap or auth/config state).
 */
async function runtimeDisposeCode(runtime) {
  try {
    await runtime.open({ model: 'gpt-5.3-codex-spark' })
    return null
  } catch (error) {
    return error?.code ?? null
  }
}

const LIVE_RUNTIME_CODES = new Set(['CODEX_RUNTIME_NOT_CONFIGURED', 'CODEX_RUNTIME_MODEL_METADATA'])

async function teardown(eventListeners, env) {
  eventListeners.get('dispose')?.()
  delete process.env.DSH_HOME
  await settle(200)
  env.cleanup()
}

test('analytics storage failure cannot take down account capability facts or the codex-runtime owner', async () => {
  const env = tempHome()
  process.env.DSH_HOME = env.home
  const offlaneFetches = []
  // Only ollama.com is reachable in this fixture; any other provider host
  // failing to load proves no hidden network dependency appeared.
  const fetchImpl = async (url) => {
    if (String(url).startsWith('https://ollama.com')) return OK_JSON({ models: [] })
    offlaneFetches.push(String(url))
    throw new Error(`unexpected provider fetch ${String(url)}`)
  }
  const { ctx, channels, provided, eventListeners } = fakeCtx({ credentialValues: { OLLAMA_API_KEY: 'test-secret' } })
  try {
    // A corrupt usage store: analytics initialization fails and stays failed.
    const dataDir = join(env.home, 'data')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'usage.sqlite'), 'this is not a sqlite database')
    apply(ctx, { providerProxy: false, dataDir, fetchImpl, observationRoundTimeoutMs: 250 })
    await settle(150)

    // Account ownership survived: the codex-runtime service is provided and
    // its failure mode is a lease/auth gap, never a disposal.
    const codexRuntime = provided.get('codexRuntime')
    assert.equal(codexRuntime?.protocol, 'codex-runtime/v1')
    assert.ok(LIVE_RUNTIME_CODES.has(await runtimeDisposeCode(codexRuntime)), 'codex-runtime owner must stay alive')

    // The read-only connections contract answers from capability facts alone.
    const connections = await channels.get('/account-usage').handler('connections', {})
    assert.equal(connections.ok, true)
    assert.ok(connections.value.connections.some(entry => entry.providerId === 'ollama-local' && entry.configured === true))
    assert.ok(connections.value.connections.some(entry => entry.providerId === 'ollama-cloud' && entry.configured === true))
    assert.ok(connections.value.connections.some(entry => entry.providerId === 'glm'))
    assert.equal(connections.value.modelCatalogs[0].providerId, 'ollama-cloud')
    assert.equal(connections.value.modelCatalogs[0].credentialConfigured, true)
    assert.equal(connections.value.privacy.secretsInRpc, false)
    assert.ok(Array.isArray(connections.value.adapters) && connections.value.adapters.length >= 3)

    // Ledger-backed endpoints degrade honestly instead of faking success.
    const summary = await channels.get('/account-usage').handler('summary', {})
    assert.equal(summary.ok, false)
    assert.equal(summary.error.code, 'ledger-unavailable')
    const accounts = await channels.get('/account-usage').handler('accounts', {})
    assert.equal(accounts.ok, false)

    // A storage failure must not reject the observation round either: the
    // round returns its capability results while persistence degrades to a
    // per-lane error entry.
    const refreshed = await channels.get('/account-usage').handler('refresh-observations', { refresh: true })
    assert.equal(refreshed.ok, true)
    assert.equal(Array.isArray(refreshed.value.chatgptGrok), true)
    const cloudLane = refreshed.value.adapters.find(entry => entry.providerId === 'ollama-cloud')
    assert.ok(cloudLane, 'round payload keeps the attempted lane')
    assert.equal(cloudLane.error.code, 'ledger-unavailable')

    // And the capability surface keeps answering afterwards.
    const again = await channels.get('/account-usage').handler('connections', {})
    assert.equal(again.ok, true)
    assert.equal(offlaneFetches.length, 0, 'no provider network beyond the allowlisted fixture host')
  } finally {
    await teardown(eventListeners, env)
  }
})

test('connections stays read-only: no provider refresh and no account writes; summary keeps its overlay duties', async () => {
  const env = tempHome()
  process.env.DSH_HOME = env.home
  let fetches = 0
  const fetchImpl = async (url) => {
    if (!String(url).startsWith('https://ollama.com')) throw new Error(`unexpected fetch ${String(url)}`)
    fetches += 1
    return OK_JSON({ models: [] })
  }
  const { ctx, channels, eventListeners } = fakeCtx({ credentialValues: { OLLAMA_API_KEY: 'test-secret' } })
  try {
    apply(ctx, { providerProxy: false, fetchImpl, observationRoundTimeoutMs: 2000 })
    const accountChannel = channels.get('/account-usage')

    // Boot: model-catalog sync + first reachability round.
    assert.ok(await waitFor(() => fetches >= 2), 'boot round used the provider')
    const accountsAfterBoot = (await accountChannel.handler('accounts', {})).value.accounts.length
    assert.ok(accountsAfterBoot >= 2, 'zero-config auto accounts exist after boot')

    // connections: identical connection facts, zero extra network, zero writes.
    const readOnly = await accountChannel.handler('connections', {})
    assert.equal(readOnly.ok, true)
    assert.equal(JSON.stringify(readOnly.value).includes('test-secret'), false, 'no credential material in the payload')
    const fetchesAfterConnections = fetches
    const accountsAfterConnections = (await accountChannel.handler('accounts', {})).value.accounts.length
    assert.equal(accountsAfterConnections, accountsAfterBoot, 'connections created or modified no account rows')

    const summary = await accountChannel.handler('summary', {})
    assert.equal(summary.ok, true)
    assert.deepEqual(summary.value.connections, readOnly.value.connections, 'summary carries the same connection facts')
    assert.equal(fetches, fetchesAfterConnections, 'a fresh-watermark summary does not refetch either')

    // The duty split shows only when a refresh is actually due: summary
    // (overlay-open anchor) starts the round, connections never does.
    const realNow = Date.now
    Date.now = () => realNow() + 10 * 60_000
    try {
      await accountChannel.handler('connections', {})
      await settle(120)
      assert.equal(fetches, fetchesAfterConnections, 'connections never triggers a quota refresh, even when due')
      await accountChannel.handler('summary', {})
      assert.ok(await waitFor(() => fetches > fetchesAfterConnections, 1500), 'summary still anchors the observation cadence')
    } finally {
      Date.now = realNow
    }
  } finally {
    await teardown(eventListeners, env)
  }
})

// AC-001: the fact producer must mark a stored raw GLM key as configured but
// unverified — a stored key is never a verified model call. The connection
// facts stay pure derivations: no credential store, mirror or probe, and no
// secret material in the payload.
test('fact producer marks a stored raw GLM key as unverified (AC-001)', async () => {
  const env = tempHome()
  process.env.DSH_HOME = env.home
  const fetchImpl = async (url) => {
    if (String(url).startsWith('https://ollama.com')) return OK_JSON({ models: [] })
    throw new Error(`unexpected provider fetch ${String(url)}`)
  }
  const { ctx, channels, eventListeners } = fakeCtx({ credentialValues: { ZAI_CODING_CN_API_KEY: 'test-glm-key' } })
  try {
    apply(ctx, { providerProxy: false, fetchImpl, observationRoundTimeoutMs: 2000 })
    const connections = await channels.get('/account-usage').handler('connections', {})
    assert.equal(connections.ok, true)
    const glm = connections.value.connections.find(entry => entry.providerId === 'glm')
    assert.ok(glm, 'glm connection fact present')
    assert.equal(glm.configured, true)
    assert.equal(glm.credentialKind, 'raw_authorization')
    assert.equal(glm.credentialStatus, 'unverified', 'a stored raw key is configured, never verified')
    assert.equal(JSON.stringify(connections.value).includes('test-glm-key'), false, 'no credential material in the payload')

    // The summary surface carries the same facts (the insight renders from it).
    const summary = await channels.get('/account-usage').handler('summary', {})
    assert.equal(summary.ok, true)
    assert.equal(summary.value.connections.find(entry => entry.providerId === 'glm')?.credentialStatus, 'unverified')
  } finally {
    await teardown(eventListeners, env)
  }
})

test('host dispose cleans both lifecycles by ownership and forbids silent store reopen', async () => {
  const env = tempHome()
  process.env.DSH_HOME = env.home
  const { ctx, channels, provided, eventListeners } = fakeCtx()
  try {
    apply(ctx, { providerProxy: false })
    await settle()
    const tokenChannel = channels.get('/token-usage')
    assert.equal((await tokenChannel.handler('overview', {})).ok, true)

    eventListeners.get('dispose')()

    // Account ownership released: codex-runtime leases end…
    assert.equal(await runtimeDisposeCode(provided.get('codexRuntime')), 'CODEX_RUNTIME_DISPOSED')
    // …and capability owners refuse new work.
    const antigravity = await channels.get('/subscription-antigravity').handler('accounts', {})
    assert.equal(antigravity.ok, false)
    assert.match(antigravity.error.message, /disposed/i)

    // Analytics store closed; late RPCs fail cleanly instead of silently
    // reopening a store whose owner is gone.
    const overview = await tokenChannel.handler('overview', {})
    assert.equal(overview.ok, false)
    assert.equal(overview.error.code, 'ledger-unavailable')
    const overviewAgain = await tokenChannel.handler('overview', {})
    assert.equal(overviewAgain.error.code, 'ledger-unavailable')

    // Capability facts still answer without crashing after dispose.
    const connections = await channels.get('/account-usage').handler('connections', {})
    assert.equal(connections.ok, true)

    // Dispose is idempotent.
    eventListeners.get('dispose')()
    assert.equal((await tokenChannel.handler('overview', {})).error.code, 'ledger-unavailable')
  } finally {
    // The dispose hook already ran; just drop the env.
    env.cleanup()
    delete process.env.DSH_HOME
    await settle(100)
  }
})

test('a fresh instance over the same profile reopens analytics and account facts survive full teardown', async () => {
  const env = tempHome()
  process.env.DSH_HOME = env.home
  try {
    const first = fakeCtx()
    apply(first.ctx, { providerProxy: false })
    await settle()
    // Persist one account-owned observation while analytics is healthy.
    const observed = await first.channels.get('/account-usage').handler('observe-provider', { providerId: 'ollama-local', refresh: true })
    assert.equal(observed.ok, true)
    first.eventListeners.get('dispose')()

    // Second instance over the same profile data.
    const second = fakeCtx()
    apply(second.ctx, { providerProxy: false })
    await settle()
    const tokenChannel = second.channels.get('/token-usage')
    const accountChannel = second.channels.get('/account-usage')

    // Analytics reopened; the imported session total is durable, not re-seeded.
    const overview = await tokenChannel.handler('overview', {})
    assert.equal(overview.ok, true)
    assert.equal(overview.value.totals.calls, 1)

    // Account-owned observations survived the full teardown of instance one.
    const stored = await accountChannel.handler('observations', {})
    assert.equal(stored.ok, true)
    assert.ok(stored.value.observations.some(row => row.providerId === 'ollama-local'))

    // The new instance's codex-runtime owner is alive again; the old
    // instance's owner stayed disposed: no cross-instance leakage.
    assert.ok(LIVE_RUNTIME_CODES.has(await runtimeDisposeCode(second.provided.get('codexRuntime'))))
    assert.equal(await runtimeDisposeCode(first.provided.get('codexRuntime')), 'CODEX_RUNTIME_DISPOSED')

    second.eventListeners.get('dispose')()
  } finally {
    env.cleanup()
    delete process.env.DSH_HOME
    await settle(100)
  }
})

test('the provided accountUsage service exposes no dispose or stop lever', async () => {
  const env = tempHome()
  process.env.DSH_HOME = env.home
  const { ctx, provided, eventListeners } = fakeCtx()
  try {
    apply(ctx, { providerProxy: false })
    await settle()
    const accountUsage = provided.get(ACCOUNT_USAGE_SERVICE)
    assert.ok(accountUsage)
    // The UI-facing service surface is query-only by contract: protocol,
    // list, observe, observations. No lifecycle lever may exist on it.
    assert.deepEqual(Object.keys(accountUsage).sort(), ['list', 'observations', 'observe', 'protocol'])
    assert.equal(typeof accountUsage.dispose, 'undefined')
    assert.equal(typeof accountUsage.stop, 'undefined')
  } finally {
    await teardown(eventListeners, env)
  }
})
