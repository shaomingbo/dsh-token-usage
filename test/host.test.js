import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { apply, resolveDataDir, name as pluginName, inject } from '../lib/index.js'

const T0 = Date.UTC(2026, 6, 10, 8, 0, 0)

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-token-usage-host-'))
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

function syntheticSession(id) {
  const header = { version: 0, id, createdAt: T0, cwd: '/work/repo-a' }
  const events = [
    { type: 'session/start', seq: 0, time: T0, data: {} },
    { type: 'request/header', seq: 1, time: T0 + 1, data: { config: { provider: 'deepseek', model: 'deepseek-chat' } } },
    { type: 'assistant/message', seq: 2, time: T0 + 2, data: { turn: 0, step: 0, message: { source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } }, usage: { inputTokens: 100, outputTokens: 50 } } },
    { type: 'step/end', seq: 3, time: T0 + 3, data: { turn: 0, step: 0 } },
  ]
  return { header, events }
}

function fakeCtx() {
  const eventListeners = new Map()
  const channels = new Map()
  const intervals = []
  const session = syntheticSession('s1')
  const ctx = {
    config: {},
    logger: { error() {}, warn() {}, info() {} },
    on: (event, listener) => { eventListeners.set(event, listener) },
    interval: (fn) => { intervals.push(fn) },
    connection: {
      rpc: {
        handle: (channel, handler, options) => { channels.set(channel, { handler, options }) },
      },
    },
    sessionPersistence: {
      listSnapshots: async () => [{ header: session.header, revision: 'rev-1' }],
      inspect: async () => ({ header: session.header, events: session.events }),
    },
  }
  return { ctx, eventListeners, channels, intervals }
}

async function settle(ms = 60) {
  await new Promise((resolvePromise) => { setTimeout(resolvePromise, ms) })
}

test('module contract: name and host injections', () => {
  assert.equal(pluginName, 'dsh-token-usage')
  assert.ok(inject.includes('connection'))
  assert.ok(inject.includes('sessionPersistence'))
})

test('data dir resolves inside the profile when installed conventionally', () => {
  const env = tempHome()
  try {
    const modulePath = join(env.home, 'profiles', 'web', 'node_modules', 'dsh-token-usage', 'lib', 'index.js')
    mkdirSync(join(modulePath, '..'), { recursive: true })
    writeFileSync(modulePath, '// marker\n')
    const dir = resolveDataDir({ moduleUrl: pathToFileURL(modulePath), home: env.home })
    assert.equal(dir, join(env.home, 'profiles', 'web', 'data', 'dsh-token-usage'))
  } finally {
    env.cleanup()
  }
})

test('data dir falls back to the home level for linked development sources', () => {
  const env = tempHome()
  try {
    const dir = resolveDataDir({ moduleUrl: import.meta.url, home: env.home })
    assert.equal(dir, join(env.home, 'dsh-token-usage'))
  } finally {
    env.cleanup()
  }
})

test('apply imports history, serves the loopback channel, and folds live events', async () => {
  process.env.DSH_HOME = tempHome().home
  const { cleanup } = { cleanup: () => rmSync(process.env.DSH_HOME, { recursive: true, force: true }) }
  try {
    const { ctx, eventListeners, channels } = fakeCtx()
    apply(ctx)
    await settle()

    // The channel is loopback-only.
    const channel = channels.get('/token-usage')
    assert.ok(channel, 'token-usage channel missing')
    assert.equal(channel.options.authority, 'loopback')

    // Historical import completed in the background.
    const status = await channel.handler('import-status', {})
    assert.equal(status.ok, true)
    assert.equal(status.value.total, 1)
    assert.equal(status.value.done, 1)
    assert.equal(status.value.running, false)

    // Overview reflects the imported session.
    const overview = await channel.handler('overview', {})
    assert.equal(overview.ok, true)
    assert.equal(overview.value.totals.calls, 1)
    assert.equal(overview.value.totals.processingTokens, 150)

    // Live event path folds into the same ledger.
    const liveSession = { id: 'live', createdAt: T0 + 1000, cwd: '/work/repo-b', seedLength: undefined }
    eventListeners.get('session/event')(liveSession, {
      type: 'assistant/message',
      seq: 2,
      time: T0 + 1002,
      data: { turn: 0, step: 0, message: { source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } }, usage: { inputTokens: 10, outputTokens: 5 } },
    })
    const after = await channel.handler('overview', {})
    assert.equal(after.ok, true)
    assert.equal(after.value.totals.calls, 2)
    assert.equal(after.value.totals.processingTokens, 165)

    // Requests endpoint serves paged rows.
    const requests = await channel.handler('requests', {})
    assert.equal(requests.ok, true)
    assert.equal(requests.value.rows.length, 2)

    // Unknown endpoints fail with a schema-legal envelope.
    const unknown = await channel.handler('bogus', {})
    assert.equal(unknown.ok, false)
  } finally {
    cleanup()
    delete process.env.DSH_HOME
  }
})
