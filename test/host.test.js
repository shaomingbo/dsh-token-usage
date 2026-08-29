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
  const rawCtx = {
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
      // The real contract: SessionInspection is { meta, events } — asserting
      // the wrong key here once let every import fail with a SQLite bind
      // error while the tests stayed green.
      inspect: async () => ({ meta: session.header, events: session.events }),
    },
  }
  // Cordis only exposes declared services through ctx. Plugin row config is
  // passed separately as apply(ctx, config), so reading ctx.config must fail.
  const ctx = new Proxy(rawCtx, {
    get(target, property, receiver) {
      if (property === 'config') throw new Error('cannot get property "config" without inject')
      return Reflect.get(target, property, receiver)
    },
  })
  return { ctx, eventListeners, channels, intervals }
}

async function settle(ms = 60) {
  await new Promise((resolvePromise) => { setTimeout(resolvePromise, ms) })
}

test('module contract: name and host injections', () => {
  assert.equal(pluginName, 'dsh-token-usage')
  assert.ok(inject.includes('connection'))
  assert.ok(inject.includes('sessionPersistence'))
  assert.ok(inject.includes('timer'))
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

    // Overview and project attribution reflect the imported {meta, events}
    // inspection contract.
    const overview = await channel.handler('overview', {})
    assert.equal(overview.ok, true)
    assert.equal(overview.value.totals.calls, 1)
    assert.equal(overview.value.totals.processingTokens, 150)
    const projects = await channel.handler('rankings', { dimension: 'project', days: 365 })
    assert.equal(projects.ok, true)
    assert.equal(projects.value.rows[0].key, '/work/repo-a')

    // Live event path folds creation metadata from session.header.
    const liveSession = {
      id: 'live',
      header: { id: 'live', version: 0, createdAt: T0 + 1000, cwd: '/work/repo-b' },
    }
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

    // A failure arriving after a reported usage sample must never wipe it.
    eventListeners.get('session/event')(liveSession, {
      type: 'step/end',
      seq: 3,
      time: T0 + 1003,
      data: { turn: 0, step: 0, error: 'LlmFailure' },
    })
    const guarded = await channel.handler('overview', {})
    assert.equal(guarded.value.totals.calls, 2)
    assert.equal(guarded.value.totals.processingTokens, 165)

    // Requests endpoint serves paged rows.
    const requests = await channel.handler('requests', {})
    assert.equal(requests.ok, true)
    assert.equal(requests.value.rows.length, 2)

    // Price refresh is explicit: preview fetches and reports mappings, then
    // apply persists that exact in-memory preview without another network call.
    const originalFetch = globalThis.fetch
    let fetches = 0
    globalThis.fetch = async () => {
      fetches += 1
      return {
        ok: true,
        json: async () => ({
          'deepseek/deepseek-chat': {
            input_cost_per_token: 0.000001,
            output_cost_per_token: 0.000002,
          },
        }),
      }
    }
    try {
      const preview = await channel.handler('price-refresh-preview', {})
      assert.equal(preview.ok, true)
      assert.equal(preview.value.fetched, 1)
      assert.equal(preview.value.matchedObserved, 1)
      const applied = await channel.handler('price-refresh-apply', {})
      assert.equal(applied.ok, true)
      assert.equal(applied.value.count, 1)
      assert.equal(fetches, 1)
      const catalog = await channel.handler('price-catalog', {})
      assert.deepEqual(catalog.value.updated, ['deepseek/deepseek-chat'])
    } finally {
      globalThis.fetch = originalFetch
    }

    // Unknown endpoints fail with a schema-legal envelope.
    const unknown = await channel.handler('bogus', {})
    assert.equal(unknown.ok, false)
  } finally {
    cleanup()
    delete process.env.DSH_HOME
  }
})
