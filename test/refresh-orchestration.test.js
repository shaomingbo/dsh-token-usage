/**
 * Host refresh orchestration: shared single-flight between background and
 * manual observation refreshes, the absolute round deadline (a hung provider
 * fetch must never stall a round forever), concurrent adapter fan-out, and
 * the rule that stale capability observations are never persisted as fresh
 * rows. The harness mirrors test/host.test.js: a fake ctx, an injectable
 * fetchImpl, and the loopback-only account channel exercised end to end.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OBSERVATION_ROUND_TIMEOUT_MS,
  apply,
  persistCapabilityObservations,
} from '../lib/index.js'

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-token-usage-refresh-'))
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

async function settle(ms = 60) {
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
  const rawCtx = {
    logger: { error() {}, warn() {}, info() {} },
    on: (event, listener) => { eventListeners.set(event, listener) },
    interval: () => {},
    provide: () => {},
    credentials: {
      describe: async ref => ({ configured: typeof credentialValues[ref] === 'string' && credentialValues[ref].length > 0 }),
      resolve: async ref => typeof credentialValues[ref] === 'string' ? { value: credentialValues[ref] } : undefined,
      set: async (ref, value) => { credentialValues[ref] = value },
    },
    settings: {
      value: {},
      get(key) { return this.value[key] },
      async update(key, patch) {
        this.value[key] = { ...(this.value[key] ?? {}), ...patch, providers: { ...(this.value[key]?.providers ?? {}), ...(patch.providers ?? {}) } }
      },
    },
    connection: {
      rpc: {
        handle: (channel, handler, options) => { channels.set(channel, { handler, options }) },
      },
    },
    sessionPersistence: {
      listSnapshots: async () => [],
      inspect: async () => { throw new Error('no sessions in this fixture') },
    },
  }
  return { ctx: rawCtx, eventListeners, channels }
}

/** Trigger the plugin dispose hook so module-level single-flight state is released between tests. */
async function disposeAndClean(eventListeners, env) {
  eventListeners.get('dispose')?.()
  env.cleanup()
  delete process.env.DSH_HOME
  // Let any detached round drain against its (short, test-only) deadline.
  await settle(400)
}

const OK_JSON = body => ({ ok: true, status: 200, json: async () => body })

test('observation rounds carry a module-level absolute deadline default', () => {
  assert.equal(OBSERVATION_ROUND_TIMEOUT_MS, 45_000)
})

test('persistCapabilityObservations skips stale and empty payloads and keeps the payload fetch time', () => {
  const saved = []
  const ledger = { saveAccountObservation: row => saved.push(row) }
  const fetchedAt = 1_000_000_000_000
  persistCapabilityObservations(ledger, [
    // Fresh snapshot: persisted under its own fetch time, not the host clock.
    { provider: 'openai-codex', available: true, windows: [{ id: 'weekly', usedPercent: 10, remainingPercent: 90 }], fetchedAt },
    // Stale re-file of old windows: never becomes a row.
    { provider: 'xai', available: true, stale: true, checkedAt: fetchedAt + 5000, windows: [{ id: 'weekly', usedPercent: 50, remainingPercent: 50 }], fetchedAt: fetchedAt - 1000, error: { code: 'USAGE_UNAVAILABLE', message: 'down' } },
    // Plainly unavailable: nothing to file.
    { provider: 'xai', available: false, checkedAt: fetchedAt, error: { code: 'USAGE_UNAVAILABLE', message: 'down' } },
    // Claims availability but carries no fresh window: skipped.
    { provider: 'openai-codex', available: true, windows: [], fetchedAt, error: { code: 'USAGE_TIMEOUT', message: 'timed out' } },
  ], [
    { provider: 'antigravity', configured: true, accountId: 'account-a', models: [{ id: 'gemini-3-pro', remaining: 0.5 }] },
    { provider: 'antigravity', configured: true, accountId: 'account-b', error: 'usage fetch failed' },
  ])
  assert.equal(saved.length, 2)
  const codex = saved.find(row => row.providerId === 'openai-codex')
  assert.equal(codex.observedAt, fetchedAt)
  assert.equal(codex.windows[0].id, 'openai-codex:weekly')
  assert.equal(codex.limits[0].observedAt, fetchedAt)
  const antigravity = saved.find(row => row.providerId === 'antigravity')
  assert.equal(antigravity.connectionId, 'account-a')

  // A missing or bogus fetchedAt falls back to the host clock.
  const fallback = []
  persistCapabilityObservations({ saveAccountObservation: row => fallback.push(row) }, [
    { provider: 'openai-codex', available: true, windows: [{ id: 'weekly', usedPercent: 1, remainingPercent: 99 }] },
  ], [])
  assert.equal(fallback.length, 1)
  assert.ok(fallback[0].observedAt > 0)
})

test('a hung provider fetch cannot stall the observation round past its deadline', async () => {
  const env = tempHome()
  process.env.DSH_HOME = env.home
  let hangCalls = 0
  // The fake fetch never resolves and ignores abort signals — the shape that
  // used to wedge the single-flight flag forever. The very first ollama.com
  // call is the boot model-catalog sync (which must fail fast so it cannot
  // park `ollamaModelsReady` and with it every summary RPC); every later call
  // is a round's adapter lane and hangs.
  const fetchImpl = async (url) => {
    if (String(url).startsWith('https://ollama.com')) {
      hangCalls += 1
      if (hangCalls === 1) return { ok: true, status: 200, json: async () => ({ models: [] }) }
      return new Promise(() => {})
    }
    throw new Error(`unexpected fetch ${String(url)}`)
  }
  const { ctx, channels, eventListeners } = fakeCtx({ credentialValues: { OLLAMA_API_KEY: 'test-secret' } })
  try {
    apply(ctx, { providerProxy: false, fetchImpl, observationRoundTimeoutMs: 250 })
    await settle(80)
    const accountChannel = channels.get('/account-usage')

    const startedAt = Date.now()
    const refreshed = await accountChannel.handler('refresh-observations', { refresh: true })
    const elapsed = Date.now() - startedAt
    assert.equal(refreshed.ok, true)
    assert.ok(elapsed < 5000, `round settled within the deadline (took ${elapsed}ms)`)
    // The hung provider is reported as a missing observation, not dropped.
    const cloud = refreshed.value.adapters.find(entry => entry.providerId === 'ollama-cloud')
    assert.equal(cloud.error.code, 'timeout')
    assert.equal(cloud.error.message, 'provider observation failed')
    // Unrelated lanes still persisted their observations.
    const stored = await accountChannel.handler('observations', {})
    assert.equal(stored.ok, true)
    assert.ok(stored.value.observations.some(row => row.providerId === 'ollama-local'))

    // The single-flight flag was released and the cadence watermark moved:
    // an immediate summary starts no second round…
    const callsBefore = hangCalls
    const summary = await accountChannel.handler('summary', {})
    assert.equal(summary.ok, true)
    await settle(80)
    assert.equal(hangCalls, callsBefore)
    // …while the next due cadence window starts a brand-new round.
    const realNow = Date.now
    Date.now = () => realNow() + 10 * 60_000
    try {
      await accountChannel.handler('summary', {})
      assert.ok(await waitFor(() => hangCalls > callsBefore, 1500), 'a new round started after the deadline released the flag')
    } finally {
      Date.now = realNow
    }
  } finally {
    await disposeAndClean(eventListeners, env)
  }
})

test('a manual refresh joins the in-flight round and providers are fetched once', async () => {
  const env = tempHome()
  process.env.DSH_HOME = env.home
  let fetchCalls = 0
  const fetchImpl = async (url) => {
    if (!String(url).startsWith('https://ollama.com')) throw new Error(`unexpected fetch ${String(url)}`)
    fetchCalls += 1
    await new Promise((resolvePromise) => { setTimeout(resolvePromise, 250) })
    return OK_JSON({ models: [] })
  }
  const { ctx, channels, eventListeners } = fakeCtx({ credentialValues: { OLLAMA_API_KEY: 'test-secret' } })
  try {
    apply(ctx, { providerProxy: false, fetchImpl, observationRoundTimeoutMs: 5000 })
    const accountChannel = channels.get('/account-usage')

    // The boot pass starts a round (model-catalog sync fetch + round fetch).
    assert.ok(await waitFor(() => fetchCalls >= 2), 'background round is in flight')
    const joined = accountChannel.handler('refresh-observations', { refresh: true })
    await settle(60)
    // The manual refresh joined the running round: no extra provider fetches.
    assert.equal(fetchCalls, 2)
    const result = await joined
    assert.equal(result.ok, true)
    assert.equal(fetchCalls, 2)
    assert.ok(result.value.adapters.some(entry => entry.providerId === 'ollama-cloud' && entry.observation))
    assert.equal(Array.isArray(result.value.chatgptGrok), true)

    // The joined manual round refreshed the cadence watermark: an immediate
    // summary must not start another round.
    await accountChannel.handler('summary', {})
    await settle(60)
    assert.equal(fetchCalls, 2)
    // After the watermark ages past the active tier, a new round starts.
    const realNow = Date.now
    Date.now = () => realNow() + 10 * 60_000
    try {
      await accountChannel.handler('summary', {})
      assert.ok(await waitFor(() => fetchCalls >= 3, 1500), 'next due round started after the watermark aged out')
    } finally {
      Date.now = realNow
    }
  } finally {
    await disposeAndClean(eventListeners, env)
  }
})

test('a stale chatgpt snapshot never becomes a fresh observation row', async () => {
  const env = tempHome()
  process.env.DSH_HOME = env.home
  // Seed a configured openai-codex OAuth account for the capability store.
  writeFileSync(join(env.home, '.oauth.json'), JSON.stringify({
    version: 1,
    credentials: {
      'openai-codex': {
        type: 'oauth',
        access: 'access-fixture',
        refresh: 'refresh-fixture',
        expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
        accountId: 'fixture-account',
      },
    },
  }))
  let codexMode = 'ok'
  const codexPayload = () => ({
    rate_limit: {
      primary_window: { used_percent: 40, limit_window_seconds: 5 * 60 * 60, reset_after_seconds: 1800 },
      secondary_window: { used_percent: 12, limit_window_seconds: 7 * 24 * 60 * 60, reset_after_seconds: 3 * 24 * 60 * 60 },
    },
  })
  const fetchImpl = async (url) => {
    const target = String(url)
    if (target.startsWith('https://chatgpt.com')) {
      return codexMode === 'ok' ? OK_JSON(codexPayload()) : { ok: false, status: 500, json: async () => ({}) }
    }
    if (target.startsWith('https://ollama.com')) return OK_JSON({ models: [] })
    throw new Error(`unexpected fetch ${target}`)
  }
  const { ctx, channels, eventListeners } = fakeCtx({ credentialValues: { OLLAMA_API_KEY: 'test-secret' } })
  const codexRows = async (channel) => {
    const stored = await channel.handler('observations', {})
    assert.equal(stored.ok, true)
    return stored.value.observations.filter(row => row.providerId === 'openai-codex')
  }
  try {
    apply(ctx, { providerProxy: false, fetchImpl, observationRoundTimeoutMs: 5000 })
    await settle(80)
    const accountChannel = channels.get('/account-usage')

    // Baseline may already include a boot-round row; measure relatively.
    const baseline = (await codexRows(accountChannel)).length
    const first = await accountChannel.handler('refresh-observations', { refresh: true })
    assert.equal(first.ok, true)
    const fresh = first.value.chatgptGrok.find(entry => entry.provider === 'openai-codex')
    assert.equal(fresh.available, true)
    assert.equal(fresh.stale, undefined)
    const afterFirst = await codexRows(accountChannel)
    assert.equal(afterFirst.length, baseline + 1, 'fresh usage persisted exactly one new row')

    // Provider outage: the capability reports the previous windows as stale
    // with their original fetch time.
    codexMode = 'failing'
    const second = await accountChannel.handler('refresh-observations', { refresh: true })
    assert.equal(second.ok, true)
    const stale = second.value.chatgptGrok.find(entry => entry.provider === 'openai-codex')
    assert.equal(stale.stale, true)
    assert.equal(stale.fetchedAt, afterFirst[0].observedAt, 'stale windows keep the data age of the previous snapshot')
    assert.ok(stale.checkedAt >= stale.fetchedAt)
    assert.equal(stale.error.code, 'USAGE_UNAVAILABLE')

    // (c) The stale round added no observation row and re-dated nothing.
    const afterSecond = await codexRows(accountChannel)
    assert.equal(afterSecond.length, afterFirst.length)
    assert.equal(afterSecond[0].observedAt, afterFirst[0].observedAt)
  } finally {
    await disposeAndClean(eventListeners, env)
  }
})

test('adapter observation lanes run concurrently and keep a fixed result order', async () => {
  const env = tempHome()
  process.env.DSH_HOME = env.home
  const spans = []
  const fetchImpl = async (url) => {
    const target = String(url)
    if (target.startsWith('https://ollama.com')) {
      const start = Date.now()
      await new Promise((resolvePromise) => { setTimeout(resolvePromise, 120) })
      spans.push({ lane: 'ollama-cloud', start, end: Date.now() })
      return OK_JSON({ models: [] })
    }
    if (target.startsWith('https://open.bigmodel.cn')) {
      const start = Date.now()
      await new Promise((resolvePromise) => { setTimeout(resolvePromise, 120) })
      spans.push({ lane: 'glm', start, end: Date.now() })
      return OK_JSON({ success: true, code: 200, data: { limits: [{ type: 'TOKENS_LIMIT', total: 1000, used: 250, unitName: 'tokens' }] } })
    }
    throw new Error(`unexpected fetch ${target}`)
  }
  const { ctx, channels, eventListeners } = fakeCtx({
    credentialValues: { ZAI_CODING_CN_API_KEY: 'zk-fixture', OLLAMA_API_KEY: 'key-fixture' },
  })
  try {
    apply(ctx, { providerProxy: false, fetchImpl, observationRoundTimeoutMs: 5000 })
    await settle(80)
    const accountChannel = channels.get('/account-usage')

    const refreshed = await accountChannel.handler('refresh-observations', { refresh: true })
    assert.equal(refreshed.ok, true)
    // All lanes settle before the payload is built, in fixed order.
    assert.deepEqual(refreshed.value.adapters.map(entry => entry.providerId), ['ollama-local', 'glm', 'ollama-cloud'])

    const glmSpans = spans.filter(span => span.lane === 'glm')
    const cloudSpans = spans.filter(span => span.lane === 'ollama-cloud')
    assert.ok(glmSpans.length > 0 && cloudSpans.length > 0)
    const glmStart = Math.min(...glmSpans.map(span => span.start))
    const glmEnd = Math.max(...glmSpans.map(span => span.end))
    const cloudStart = Math.min(...cloudSpans.map(span => span.start))
    const cloudEnd = Math.max(...cloudSpans.map(span => span.end))
    // Overlapping start/end windows prove the lanes ran concurrently; serial
    // execution would place one provider's whole span before the other's start.
    assert.ok(glmStart < cloudEnd && cloudStart < glmEnd, 'glm and ollama-cloud lanes overlapped in time')
  } finally {
    await disposeAndClean(eventListeners, env)
  }
})

test('summary answers the Ollama key question once through connection collection', async () => {
  const env = tempHome()
  process.env.DSH_HOME = env.home
  const describeCalls = []
  const { ctx, channels, eventListeners } = fakeCtx({ credentialValues: { OLLAMA_API_KEY: 'test-secret' } })
  const originalDescribe = ctx.credentials.describe
  ctx.credentials.describe = async (ref) => {
    describeCalls.push(ref)
    return originalDescribe(ref)
  }
  try {
    apply(ctx, { providerProxy: false })
    // Wait for the boot connection pass to finish so it stops interleaving.
    await accountReady(channels)
    const before = describeCalls.filter(ref => ref === 'OLLAMA_API_KEY').length
    const summary = await channels.get('/account-usage').handler('summary', {})
    assert.equal(summary.ok, true)
    const after = describeCalls.filter(ref => ref === 'OLLAMA_API_KEY').length
    assert.equal(after - before, 1, 'collectConnections answers the credential question exactly once')
    const cloud = summary.value.connections.find(connection => connection.providerId === 'ollama-cloud')
    assert.equal(cloud.configured, true)
    assert.deepEqual(summary.value.modelCatalogs[0].credentialConfigured, true)
  } finally {
    await disposeAndClean(eventListeners, env)
  }
})

/** Poll the accounts endpoint until the boot pass has created its auto account. */
async function accountReady(channels) {
  const accountChannel = channels.get('/account-usage')
  await waitFor(async () => {
    const accounts = await accountChannel.handler('accounts', {})
    return accounts.ok === true && accounts.value.accounts.some(account => account.id === 'connection:ollama-local:default')
  })
  await settle(30)
}
