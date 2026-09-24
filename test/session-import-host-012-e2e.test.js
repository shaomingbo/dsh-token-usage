/**
 * End-to-end acceptance for the 0.1.2-rc.1 legacy session-persistence seam.
 *
 * Everything below runs through real shipped entries only:
 * - the published `@deepseek-ai/dsh-session-persistence-jsonl@0.1.2-rc.1`
 *   backend (read-only from the Lab-controlled 0.1.2 runtime), constructed
 *   exactly the way the host builds it: a real cordis Context with the
 *   SessionStore service and the backend's static `Config`. The real 0.1.2
 *   backend exposes BOTH `list()` (bare `SessionHeader[]` rows) and
 *   `listSnapshots()` ({header, revision} rows) and carries no `open()` — the
 *   exact mixed-presence shape T-A-005 — so this acceptance pins that the
 *   real apply imports through `listSnapshots()` + `inspect()`;
 * - the plugin's real `apply()` (cordis inject/apply/provide), whose boot
 *   pass drives `runImport` → `importSnapshot` → `listSessionSnapshots` /
 *   `readSessionInspection` against that backend;
 * - the RPC handlers the real apply registered on the connection service
 *   (`/token-usage` `import-status` / `import-control` / `sessions` /
 *   `session-detail` / `overview`).
 *
 * Fixtures are synthetic V0 sessions written through the backend's public
 * `create(meta, inheritedEventCount)` / `append(id, events)` path. Expected
 * token values are exact and derived from the ledger contract (processing =
 * uncached input + output + cacheRead + cacheWrite; reasoning is a subset of
 * output; inherited prefixes are excluded from owned totals).
 *
 * No prompts, credentials, or production data are used anywhere: all model,
 * provider, path, and message values are synthetic.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'

// Lab-controlled published 0.1.2-rc.1 runtime prefix (see evidence
// tcf-015-closeout-e961/BASELINE.md). Read-only. Overridable elsewhere.
const DSH012_RUNTIME = process.env.TCF_DSH012_RUNTIME
  ?? '/Users/shaomingbo/.dsh/plugin-lab/runtime'

/** Public resolver anchor, realpathed so resolution stays inside the runtime. */
function requireFromRuntime(specifier) {
  const publishedAnchor = join(DSH012_RUNTIME, 'node_modules/@deepseek-ai/dsh/package.json')
  let anchor
  try {
    anchor = realpathSync(publishedAnchor)
  } catch {
    throw new Error(`controlled @deepseek-ai/dsh 0.1.2-rc.1 runtime is not available at ${DSH012_RUNTIME}; the legacy-persistence acceptance cannot run`)
  }
  return createRequire(anchor)(specifier)
}

const { Context } = requireFromRuntime('@deepseek-ai/cordis')
const { SessionStore } = requireFromRuntime('@deepseek-ai/dsh-session')
const JsonlSessionPersistence = requireFromRuntime('@deepseek-ai/dsh-session-persistence-jsonl').default
const pluginModule = await import('../lib/index.js')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const T0 = 1_757_000_000_000
const PROJECT_CWD = '/tcf-e961-token-synthetic/legacy-project'
const PROVIDER = 'synthetic-provider'

function modelMessage(id, text, model) {
  return {
    id, role: 'assistant',
    content: [{ type: 'text', text }],
    source: { kind: 'model', provider: PROVIDER, model },
  }
}

// The released 0.1.2-era surface contract: append-origin assistant rows carry
// the surface marker; usage counts are disjoint (input excludes cached input).
function assistantUsage(seq, time, turn, step, model, usage) {
  return {
    type: 'assistant/message', seq, time, surfaceOp: 'append',
    data: { turn, step, message: modelMessage(`m-${seq}`, `synthetic output ${seq}`, model), usage },
  }
}

// One turn, two usage-bearing steps: exactly 8 events so the fork fixture
// copies the whole log as its inherited prefix (cut = 8).
const U_A1 = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 50, cacheWriteTokens: 30, reasoningTokens: 80 }
const U_A2 = { inputTokens: 400, outputTokens: 100, reasoningTokens: 20 }
const PARENT_EVENTS = [
  { type: 'turn/start', seq: 0, time: T0, data: { turn: 1 } },
  { type: 'step/start', seq: 1, time: T0 + 10, data: { turn: 1, step: 1 } },
  assistantUsage(2, T0 + 20, 1, 1, 'synthetic-model-a', U_A1),
  { type: 'step/end', seq: 3, time: T0 + 30, data: { turn: 1, step: 1 } },
  { type: 'step/start', seq: 4, time: T0 + 40, data: { turn: 1, step: 2 } },
  assistantUsage(5, T0 + 50, 1, 2, 'synthetic-model-a', U_A2),
  { type: 'step/end', seq: 6, time: T0 + 60, data: { turn: 1, step: 2 } },
  { type: 'turn/end', seq: 7, time: T0 + 70, data: { turn: 1, reason: { kind: 'completed' } } },
]
// processing: parent = (1000+200+50+30) + (400+100) = 1780
const PARENT_PROCESSING = 1780

// Ordinary subagent child: parentSession set, never seeded, no cut.
const U_C1 = { inputTokens: 250, outputTokens: 75, reasoningTokens: 25 }
const U_C2 = { inputTokens: 90, outputTokens: 60, cacheReadTokens: 8 }
const SUBAGENT_EVENTS = [
  { type: 'turn/start', seq: 0, time: T0 + 100, data: { turn: 1 } },
  { type: 'step/start', seq: 1, time: T0 + 110, data: { turn: 1, step: 1 } },
  assistantUsage(2, T0 + 120, 1, 1, 'synthetic-model-c', U_C1),
  { type: 'step/end', seq: 3, time: T0 + 130, data: { turn: 1, step: 1 } },
  { type: 'step/start', seq: 4, time: T0 + 140, data: { turn: 1, step: 2 } },
  assistantUsage(5, T0 + 150, 1, 2, 'synthetic-model-c', U_C2),
  { type: 'step/end', seq: 6, time: T0 + 160, data: { turn: 1, step: 2 } },
  { type: 'turn/end', seq: 7, time: T0 + 170, data: { turn: 1, reason: { kind: 'completed' } } },
]
// processing: subagent = (250+75) + (90+60+8) = 483
const SUBAGENT_PROCESSING = 483

// Seeded fork written through the backend's own create(meta, cut) path; the
// copied parent log closes turn 1, so the fork's own flow reopens the turn.
const U_B = { inputTokens: 300, outputTokens: 120, cacheReadTokens: 10, cacheWriteTokens: 5, reasoningTokens: 40 }
const FORK_OWN_EVENTS = (from) => [
  { type: 'turn/start', seq: from, time: T0 + 3700, data: { turn: 2 } },
  { type: 'step/start', seq: from + 1, time: T0 + 3710, data: { turn: 2, step: 1 } },
  assistantUsage(from + 2, T0 + 3720, 2, 1, 'synthetic-model-b', U_B),
  { type: 'step/end', seq: from + 3, time: T0 + 3730, data: { turn: 2, step: 1 } },
  { type: 'turn/end', seq: from + 4, time: T0 + 3740, data: { turn: 2, reason: { kind: 'completed' } } },
]
// processing: fork own = 300+120+10+5 = 435, inherited = 1780
const FORK_OWN_PROCESSING = 435
const GLOBAL_OWN_PROCESSING = PARENT_PROCESSING + SUBAGENT_PROCESSING + FORK_OWN_PROCESSING

const state = {
  sessionRoot: mkdtempSync(join(tmpdir(), 'tcf-e961-legacy-sessions-')),
  ledgerDir: mkdtempSync(join(tmpdir(), 'tcf-e961-legacy-ledger-')),
  pluginFiber: null,
  rpcHandlers: new Map(),
  persistence: null,
  handler() {
    const entry = state.rpcHandlers.get('/token-usage')
    assert.notEqual(entry, undefined, '/token-usage RPC handler was not registered by the real apply')
    return entry.handler
  },
  async rpc(endpoint, payload = {}) {
    const response = await state.handler()(endpoint, payload, new AbortController().signal)
    assert.equal(response.ok, true, `RPC ${endpoint} failed: ${JSON.stringify(response.error ?? response)}`)
    return response.value
  },
  async waitImportSettled({ deadlineMs = 60_000 } = {}) {
    const deadline = Date.now() + deadlineMs
    for (;;) {
      const status = await state.rpc('import-status')
      if (status.startedAt !== null && status.finishedAt !== null && status.running === false) return status
      assert.ok(Date.now() < deadline, `import did not settle; last status ${JSON.stringify(status)}`)
      await delay(25)
    }
  },
}

function makeCredentialsStub() {
  return new Proxy({}, {
    get() {
      return async () => undefined
    },
  })
}

/**
 * Build the cordis root the way the 0.1.2 host does: SessionStore plus the
 * real JsonlSessionPersistence over its own static Config, and host-service
 * stand-ins for the plugin's remaining injections.
 */
function startRuntime() {
  const root = new Context()
  state.rpcHandlers.clear()
  new SessionStore(root)
  const persistence = new JsonlSessionPersistence(root, JsonlSessionPersistence.Config({ root: state.sessionRoot }))
  // T-A-005 mixed-presence shape, asserted against the real backend: both
  // list() and listSnapshots() exist, and there is no open() handle API.
  assert.equal(typeof persistence.list, 'function', 'the real 0.1.2 backend must expose list()')
  assert.equal(typeof persistence.listSnapshots, 'function', 'the real 0.1.2 backend must expose listSnapshots()')
  assert.equal(typeof persistence.inspect, 'function', 'the real 0.1.2 backend must expose inspect()')
  assert.equal(persistence.open, undefined, 'the 0.1.2 backend carries no open() handle API')
  state.persistence = persistence
  root.provide('connection', {
    rpc: {
      handle(channel, handler, options) {
        // The host owns channel ownership semantics; the harness records the
        // latest registration so re-applies keep serving the newest closure.
        state.rpcHandlers.set(channel, { handler, options })
      },
    },
  })
  root.provide('credentials', makeCredentialsStub())
  root.provide('llm', { listConfigurableProviders: () => [] })
  root.provide('settings', {
    get() { return null },
    async update(_key, patch) { return patch },
    toJSON() { return {} },
  })
  root.provide('timer', { interval(_fn, _ms) { return () => {} } })
  root.mixin('timer', ['interval'])
  root.provide('webServer', {})
  // Keep the owner so the real SessionStore/Persistence coordinator is also
  // disposed, not merely the plugin fiber nested inside it.
  state.root = root
  return root
}

/** Apply the real plugin module and wait for its RPC registration. */
async function applyPlugin(root) {
  // This fixture owns persistence/import only. Like the 015 fixture, it must
  // not start the unrelated account-provider proxy and its background work.
  const fiber = root.plugin(pluginModule, { dataDir: state.ledgerDir, providerProxy: false })
  const deadline = Date.now() + 30_000
  while (!state.rpcHandlers.has('/token-usage')) {
    assert.ok(Date.now() < deadline, 'plugin apply did not register /token-usage in time')
    await delay(10)
  }
  state.pluginFiber = fiber
}

test('synthetic V0 fixtures materialize through the public 0.1.2 write path and the real boot import settles', async () => {
  // The 0.1.2 backend writes V0 through create(meta, cut) + append(id, events).
  const root = startRuntime()
  const parentHeader = { version: 0, id: 'tcf-e961-legacy-parent', createdAt: T0, cwd: PROJECT_CWD, delegationDepth: 0, isSeeded: false }
  await state.persistence.create(parentHeader)
  await state.persistence.append(parentHeader.id, PARENT_EVENTS)
  const childHeader = {
    version: 0, id: 'tcf-e961-legacy-subagent', createdAt: T0 + 1800_000, cwd: PROJECT_CWD,
    parentSession: parentHeader.id, delegationDepth: 1, isSeeded: false, origin: 'subagent',
  }
  await state.persistence.create(childHeader)
  await state.persistence.append(childHeader.id, SUBAGENT_EVENTS)
  const forkHeader = {
    version: 0, id: 'tcf-e961-legacy-fork', createdAt: T0 + 3600_000, cwd: PROJECT_CWD,
    parentSession: parentHeader.id, delegationDepth: 0, isSeeded: true,
  }
  await state.persistence.create(forkHeader, 8)
  await state.persistence.append(forkHeader.id, [...PARENT_EVENTS.map((event) => ({ ...event })), ...FORK_OWN_EVENTS(8)])

  // The legacy listing shape, observed on the real backend: list() rows carry
  // bare SessionHeader[] entries while listSnapshots() carries {header, revision}.
  const bareHeaders = await state.persistence.list()
  const bare = bareHeaders.find((header) => header.id === 'tcf-e961-legacy-parent')
  assert.notEqual(bare, undefined)
  assert.equal(bare.header, undefined)
  const snapshots = await state.persistence.listSnapshots()
  assert.deepEqual(snapshots.map((row) => row.header.id).sort(), [
    'tcf-e961-legacy-fork', 'tcf-e961-legacy-parent', 'tcf-e961-legacy-subagent',
  ])
  const forkInspection = await state.persistence.inspect('tcf-e961-legacy-fork')
  assert.equal(forkInspection.inheritedEventCount, 8)

  await applyPlugin(root)
  const status = await state.waitImportSettled()
  assert.equal(status.errors, 0, `boot import errors: ${status.lastError}`)
  assert.equal(status.lastError, null)
  assert.equal(status.total, 3)
  assert.equal(status.done, 3)
})

test('RPC reports exact owned/inherited totals and attribution after the legacy boot import', async () => {
  const sessions = await state.rpc('sessions', {})
  const byId = new Map(sessions.rows.map((row) => [row.id, row]))
  assert.deepEqual([...byId.keys()].sort(), [
    'tcf-e961-legacy-fork', 'tcf-e961-legacy-parent', 'tcf-e961-legacy-subagent',
  ])
  assert.equal(byId.get('tcf-e961-legacy-parent').processingTokens, PARENT_PROCESSING)
  assert.equal(byId.get('tcf-e961-legacy-subagent').processingTokens, SUBAGENT_PROCESSING)
  assert.equal(byId.get('tcf-e961-legacy-fork').processingTokens, FORK_OWN_PROCESSING)
  assert.equal(byId.get('tcf-e961-legacy-fork').seedLength, 8)

  const parent = await state.rpc('session-detail', { id: 'tcf-e961-legacy-parent' })
  assert.equal(parent.ownTotals.processingTokens, PARENT_PROCESSING)
  assert.equal(parent.inheritedTotals.processingTokens, 0)

  const subagent = await state.rpc('session-detail', { id: 'tcf-e961-legacy-subagent' })
  assert.equal(subagent.ownTotals.processingTokens, SUBAGENT_PROCESSING)
  assert.equal(subagent.inheritedTotals.processingTokens, 0)
  assert.equal(subagent.parentSession, 'tcf-e961-legacy-parent')
  assert.equal(subagent.origin, 'subagent')

  const fork = await state.rpc('session-detail', { id: 'tcf-e961-legacy-fork' })
  assert.equal(fork.ownTotals.processingTokens, FORK_OWN_PROCESSING)
  assert.equal(fork.inheritedTotals.processingTokens, PARENT_PROCESSING)
  assert.equal(fork.calls.filter((call) => call.owned).length, 1)
  assert.equal(fork.calls.filter((call) => !call.owned).length, 2)

  const overview = await state.rpc('overview', {})
  assert.equal(overview.totals.processingTokens, GLOBAL_OWN_PROCESSING)
  assert.equal(overview.totals.newComputeTokens, 1700 + 475 + 420)
})

test('manual full rescan through import-control is idempotent', async () => {
  const before = await state.rpc('overview', {})
  await state.rpc('import-control', { action: 'scan', full: true })
  const status = await state.waitImportSettled()
  assert.equal(status.errors, 0, `rescan errors: ${status.lastError}`)
  assert.equal(status.done, 3)
  const after = await state.rpc('overview', {})
  assert.equal(after.totals.processingTokens, before.totals.processingTokens)
  assert.equal(after.totals.processingTokens, GLOBAL_OWN_PROCESSING)
})

test('ledger reopen on the same store reproduces exact totals from legacy sources', { timeout: 10_000 }, async () => {
  await state.pluginFiber.dispose()
  state.pluginFiber = null
  await state.root.fiber.dispose()
  state.root = null
  const root = startRuntime()
  await applyPlugin(root)
  const status = await state.waitImportSettled()
  assert.equal(status.errors, 0, `reopen errors: ${status.lastError}`)
  assert.equal(status.total, 3)
  const sessions = await state.rpc('sessions', {})
  const byId = new Map(sessions.rows.map((row) => [row.id, row]))
  assert.equal(byId.get('tcf-e961-legacy-parent').processingTokens, PARENT_PROCESSING)
  assert.equal(byId.get('tcf-e961-legacy-fork').processingTokens, FORK_OWN_PROCESSING)
  assert.equal(byId.get('tcf-e961-legacy-fork').seedLength, 8)
  const overview = await state.rpc('overview', {})
  assert.equal(overview.totals.processingTokens, GLOBAL_OWN_PROCESSING)
})

test('teardown stops the plugin fiber and removes legacy harness state', { timeout: 10_000 }, async () => {
  assert.notEqual(state.root, null, 'the real host-service owner must be tracked')
  await state.pluginFiber.dispose()
  state.pluginFiber = null
  const root = state.root
  await root.fiber.dispose()
  assert.equal(root.fiber.getEffects().length, 0, 'root disposal must release host-service effects')
  state.root = null
  rmSync(state.sessionRoot, { recursive: true, force: true })
  rmSync(state.ledgerDir, { recursive: true, force: true })
})