import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  ACCOUNT_USAGE_PROTOCOL,
  ACCOUNT_USAGE_SERVICE,
  apply,
  resolveDataDir,
  detectGitProject,
  secretSafeLogger,
  name as pluginName,
  inject,
} from '../lib/index.js'

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

function fakeCtx({ credentialValues = {}, settingsValue = {} } = {}) {
  const eventListeners = new Map()
  const channels = new Map()
  const intervals = []
  const provided = new Map()
  const session = syntheticSession('s1')
  const rawCtx = {
    logger: { error() {}, warn() {}, info() {} },
    on: (event, listener) => { eventListeners.set(event, listener) },
    interval: (fn) => { intervals.push(fn) },
    provide: (id, value) => { provided.set(id, value) },
    credentials: {
      describe: async ref => ({ configured: typeof credentialValues[ref] === 'string' && credentialValues[ref].length > 0 }),
      resolve: async ref => typeof credentialValues[ref] === 'string' ? { value: credentialValues[ref] } : undefined,
      set: async (ref, value) => { credentialValues[ref] = value },
    },
    settings: {
      value: structuredClone(settingsValue),
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
  return { ctx, eventListeners, channels, intervals, provided }
}

async function settle(ms = 60) {
  await new Promise((resolvePromise) => { setTimeout(resolvePromise, ms) })
}

test('module contract: name and host injections', () => {
  assert.equal(pluginName, 'dsh-token-usage')
  assert.ok(inject.includes('connection'))
  assert.ok(inject.includes('credentials'))
  assert.ok(inject.includes('sessionPersistence'))
  assert.ok(inject.includes('settings'))
  assert.ok(inject.includes('timer'))
})

test('an existing Ollama Cloud credential provisions its missing selectable model route at startup', async () => {
  const originalFetch = globalThis.fetch
  const env = tempHome()
  process.env.DSH_HOME = env.home
  try {
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).endsWith('/api/tags')) {
        return new Response(JSON.stringify({ models: [{ name: 'cloud-model', model: 'cloud-model' }] }), { status: 200 })
      }
      assert.equal(JSON.parse(init.body).model, 'cloud-model')
      return new Response(JSON.stringify({
        capabilities: ['completion', 'thinking'],
        model_info: { 'general.architecture': 'cloud', 'cloud.context_length': 131072 },
      }), { status: 200 })
    }
    const { ctx } = fakeCtx({ credentialValues: { OLLAMA_API_KEY: 'test-secret' } })
    apply(ctx, { providerProxy: false })
    await settle(120)
    assert.deepEqual(ctx.settings.value['llm-pi-ai'].providers['ollama-cloud'].models, [{
      id: 'cloud-model', name: 'cloud-model', contextWindow: 131072, input: ['text'],
      reasoningEfforts: { off: 'none', low: 'low', medium: 'medium', high: 'high', max: 'max' },
    }])
  } finally {
    globalThis.fetch = originalFetch
    env.cleanup()
  }
})

test('account RPC explicitly synchronizes the Ollama Cloud model catalog without returning credentials', async () => {
  const env = tempHome()
  process.env.DSH_HOME = env.home
  try {
    const fetchImpl = async (url, init = {}) => String(url).endsWith('/api/tags')
      ? new Response(JSON.stringify({ models: [{ name: 'rpc-model', model: 'rpc-model' }] }), { status: 200 })
      : new Response(JSON.stringify({
        capabilities: ['completion'],
        model_info: { 'general.architecture': 'rpc', 'rpc.context_length': 65536 },
      }), { status: 200 })
    const { ctx, channels } = fakeCtx({ credentialValues: { OLLAMA_API_KEY: 'test-secret' } })
    apply(ctx, { providerProxy: false, fetchImpl })
    await settle(80)
    const accountChannel = channels.get('/account-usage')
    assert.equal((await accountChannel.handler('sync-model-catalog', { providerId: 'ollama-cloud' })).error.code, 'explicit-refresh-required')
    const synced = await accountChannel.handler('sync-model-catalog', { providerId: 'ollama-cloud', refresh: true })
    assert.equal(synced.ok, true)
    assert.equal(synced.value.modelCount, 1)
    assert.equal(JSON.stringify(synced).includes('test-secret'), false)
    const summary = await accountChannel.handler('summary', {})
    assert.deepEqual(summary.value.modelCatalogs, [{
      providerId: 'ollama-cloud', routeId: 'ollama-cloud', configured: true, modelCount: 1, credentialConfigured: true,
    }])
  } finally {
    env.cleanup()
  }
})

test('provider capability logs redact common credential forms', () => {
  const lines = []
  const logger = secretSafeLogger({ info: (...args) => lines.push(args.join(' ')), warn: (...args) => lines.push(args.join(' ')), error: (...args) => lines.push(args.join(' ')) })
  logger.warn('failed Authorization: Bearer %s api_key=%s', 'eyJabcdefghijk.abcdefghijkl', 'sk-secretvalue')
  const output = lines.join('\n')
  assert.doesNotMatch(output, /eyJabcdefghijk|sk-secretvalue/)
  assert.match(output, /REDACTED/)
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

test('git project identity follows the repository root and strips remote credentials', () => {
  const env = tempHome()
  try {
    const root = join(env.home, 'repo')
    const nested = join(root, 'packages', 'web')
    mkdirSync(join(root, '.git'), { recursive: true })
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, '.git', 'config'), '[remote "origin"]\n  url = https://token@example.com/acme/repo.git\n')
    assert.deepEqual(detectGitProject(nested), {
      gitRoot: realpathSync(root),
      gitRemote: 'example.com/acme/repo',
      identityKind: 'git',
      identityValue: 'example.com/acme/repo',
      displayName: 'repo',
    })
    const worktree = join(env.home, 'worktree')
    const gitdir = join(root, '.git', 'worktrees', 'worktree')
    mkdirSync(gitdir, { recursive: true })
    mkdirSync(worktree, { recursive: true })
    writeFileSync(join(worktree, '.git'), `gitdir: ${gitdir}\n`)
    writeFileSync(join(gitdir, 'commondir'), '../..\n')
    assert.equal(detectGitProject(worktree).gitRemote, 'example.com/acme/repo')
  } finally {
    env.cleanup()
  }
})

test('apply imports history, serves the loopback channel, and folds live events', async () => {
  process.env.DSH_HOME = tempHome().home
  const { cleanup } = { cleanup: () => rmSync(process.env.DSH_HOME, { recursive: true, force: true }) }
  try {
    const { ctx, eventListeners, channels, provided } = fakeCtx()
    apply(ctx, { providerProxy: false })
    await settle()

    // The channel is loopback-only.
    const channel = channels.get('/token-usage')
    assert.ok(channel, 'token-usage channel missing')
    assert.equal(channel.options.authority, 'loopback')
    assert.equal(channels.has('/subscription-search'), false, 'SearchChain retains exclusive ownership')
    assert.equal(channels.get('/subscription-antigravity')?.options.authority, 'loopback')
    const accountChannel = channels.get('/account-usage')
    assert.equal(accountChannel?.options.authority, 'loopback')
    const accountUsage = provided.get(ACCOUNT_USAGE_SERVICE)
    assert.equal(accountUsage?.protocol, ACCOUNT_USAGE_PROTOCOL)
    assert.equal((await accountUsage.list()).privacy.secretsInRpc, false)
    const accountSummary = await accountChannel.handler('summary', {})
    assert.equal(accountSummary.ok, true)
    assert.equal(accountSummary.value.product.name, 'DSH Accounts & Usage')
    assert.equal(accountSummary.value.privacy.secretsInRpc, false)
    assert.ok(accountSummary.value.connections.some(connection => connection.providerId === 'ollama-local' && connection.quotaApplicable === false))
    assert.equal((await accountChannel.handler('refresh-observations', {})).error.code, 'explicit-refresh-required')
    const localObservation = await accountChannel.handler('observe-provider', { providerId: 'ollama-local', refresh: true })
    assert.equal(localObservation.value.observation.quotaApplicable, false)
    const storedObservations = await accountChannel.handler('observations', {})
    assert.equal(storedObservations.value.observations[0].providerId, 'ollama-local')

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

    // V2 exposes the deep analytics seams through one loopback RPC channel.
    const analysis = await channel.handler('query', {
      filter: { timezone: 'UTC', time: { preset: 'all' } },
      views: ['kpis', 'rankings'],
      ranking: { dimension: 'project' },
    })
    assert.equal(analysis.ok, true)
    assert.equal(analysis.value.kpis.processingTokens, 165)
    assert.equal(analysis.value.rankings.rows[0].key.startsWith('cwd:'), true)
    const narrowed = await channel.handler('constrain', { filter: {}, patch: { op: 'add', dimension: 'model', key: 'deepseek-chat' } })
    assert.deepEqual(narrowed.value.model, ['deepseek-chat'])
    const inspected = await channel.handler('inspect', { kind: 'session', id: 's1', filter: { timezone: 'UTC' } })
    assert.equal(inspected.value.direct.processingTokens, 150)
    const correction = await channel.handler('correct-request', { id: 's1:0:0', correction: { inputTokens: 8, outputTokens: 2, note: 'fixture' } })
    assert.equal(correction.ok, true)
    assert.equal((await channel.handler('inspect', { kind: 'request', id: 's1:0:0' })).value.direct.processingTokens, 10)
    assert.equal((await channel.handler('revoke-correction', { id: correction.value.id })).ok, true)
    const budget = await channel.handler('set-budget', { scope: 'profile', unit: 'processingTokens', periodMonth: '2026-07', limitValue: '1000' })
    assert.equal(budget.ok, true)

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
