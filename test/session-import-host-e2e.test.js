/**
 * End-to-end acceptance for the 0.1.5-rc.1 session-persistence adaptation.
 *
 * Everything below runs through real shipped entries only:
 * - the published `@deepseek-ai/dsh-session-persistence-jsonl@0.1.5-rc.1`
 *   backend (read-only from the Lab-controlled 0.1.5-rc.1 prefix), which owns
 *   the official build-static V0→V1→V2→V3 migration catalog;
 * - the plugin's real `apply()` (cordis inject/apply/provide), whose boot
 *   pass drives `runImport` → `importSnapshot` → `listSessionSnapshots` /
 *   `readSessionInspection` against that backend;
 * - the RPC handlers the real apply registered on the connection service
 *   (`/token-usage` `import-status` / `import-control` / `sessions` /
 *   `session-detail` / `requests` / `overview`).
 *
 * Fixtures are synthetic V0 artifacts written per the released v0 physical
 * contract (header line `type:"session",version:0` with `seedLength` as the
 * legacy cut, plus disposition-validated event rows) and one native V3 fork
 * created through the backend's own `create(header, {inheritedEventCount})`
 * + `append` + `flush` path; its copied rows carry the current-format
 * `surfaceOp: "append"` marker the V3 contract requires. Expected token
 * values are exact and derived from
 * the ledger contract (processing = uncached input + output + cacheRead +
 * cacheWrite; reasoning is a subset of output; inherited prefixes are
 * excluded from owned totals).
 *
 * No prompts, credentials, or production data are used anywhere: all model,
 * provider, path, and message values are synthetic.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'

// Lab-controlled published 0.1.5-rc.1 host prefix (see evidence
// tcf-015-closeout-e961/BASELINE.md). Overridable for other checkouts.
const DSH015_PREFIX = process.env.TCF_DSH015_PREFIX
  ?? '/Users/shaomingbo/.dsh/plugin-lab/isolated/dsh-015-rc.1/prefix'

/**
 * Public resolver anchor: the published `@deepseek-ai/dsh` package entry.
 * The anchor is realpathed first — through the top-level symlink the CJS
 * walk-up stops at the prefix's hoisted `node_modules` (which only carries
 * `@deepseek-ai/dsh`), while the real `.pnpm/<hash>/node_modules` layout
 * keeps every host dependency resolvable inside the controlled prefix. The
 * realpath also pins resolution away from ambient `NODE_PATH` store links,
 * so the test always loads the exact 0.1.5-rc.1 copies it accepts.
 */
function requireFromPrefix(specifier) {
  const publishedAnchor = join(DSH015_PREFIX, 'node_modules/@deepseek-ai/dsh/package.json')
  let anchor
  try {
    anchor = realpathSync(publishedAnchor)
  } catch {
    throw new Error(`controlled @deepseek-ai/dsh 0.1.5-rc.1 prefix is not available at ${DSH015_PREFIX}; the real-persistence acceptance cannot run`)
  }
  return createRequire(anchor)(specifier)
}

const { Context } = requireFromPrefix('@deepseek-ai/cordis')
const { default: JsonlSessionPersistence } = requireFromPrefix('@deepseek-ai/dsh-session-persistence-jsonl')
const pluginModule = await import('../lib/index.js')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const T0 = 1_757_000_000_000
const PROJECT_CWD = '/tcf-e961-token-synthetic/project-one'
const PROVIDER = 'synthetic-provider'

function modelMessage(id, text, model) {
  return {
    id, role: 'assistant',
    content: [{ type: 'text', text }],
    source: { kind: 'model', provider: PROVIDER, model },
  }
}

// Surface rows carry the released `surfaceOp: "append"` marker: the V0
// physical contract lists it among surface-event optional keys, and the
// published V0→V3 migration chain refuses surface events without it.
function assistantUsage(seq, time, turn, step, model, usage) {
  return {
    type: 'assistant/message', seq, time, surfaceOp: 'append',
    data: { turn, step, message: modelMessage(`m-${seq}`, `synthetic output ${seq}`, model), usage },
  }
}

// One turn, two steps, both usage-bearing: exactly 8 events so fork fixtures
// copy the whole log as their inherited prefix (cut = 8).
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

// Legacy seeded fork: V0 header carries seedLength = 8 (the copied prefix).
// The copied parent log closes turn 1, so the fork's own flow reopens the
// turn first; the V1→V2 migration chain synthesizes the required
// `session/end-seed` inherited marker at the cut boundary itself.
const U_B = { inputTokens: 300, outputTokens: 120, cacheReadTokens: 10, cacheWriteTokens: 5, reasoningTokens: 40 }
const FORK_OWN_EVENTS = (from) => [
  { type: 'turn/start', seq: from, time: T0 + 3700, data: { turn: 2 } },
  { type: 'step/start', seq: from + 1, time: T0 + 3710, data: { turn: 2, step: 1 } },
  assistantUsage(from + 2, T0 + 3720, 2, 1, 'synthetic-model-b', U_B),
  { type: 'step/end', seq: from + 3, time: T0 + 3730, data: { turn: 2, step: 1 } },
  { type: 'turn/end', seq: from + 4, time: T0 + 3740, data: { turn: 2, reason: { kind: 'completed' } } },
]
// processing: legacy fork own = 300+120+10+5 = 435, inherited = 1780
const FORK_OWN_PROCESSING = 435

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

// Compaction/checkpoint noise must never bill: the compaction summary carries
// a usage payload that must stay out of every total, and a usage-less
// interrupted step must stay a zero-token health record. Persisted ≤V3 logs
// express the interrupted step through `data.interrupted` on the
// assistant/message row — `step/end` carries only `turn`/`step` in the
// released dispositions, so no `error` member exists on stored rows. The
// compaction shadows the exact current surface span of the V0
// assistant/message row (seq 2), which the V1→V2 chain rewrites into a
// synthesized system/message + assistant/message pair.
const U_E = { inputTokens: 70, outputTokens: 30 }
const CHECKPOINT_EVENTS = [
  { type: 'turn/start', seq: 0, time: T0 + 200, data: { turn: 1 } },
  { type: 'step/start', seq: 1, time: T0 + 210, data: { turn: 1, step: 1 } },
  assistantUsage(2, T0 + 220, 1, 1, 'synthetic-model-a', U_E),
  { type: 'step/end', seq: 3, time: T0 + 230, data: { turn: 1, step: 1 } },
  { type: 'compaction/start', seq: 4, time: T0 + 240, data: { compactionId: 'c-1', turn: 1 } },
  {
    type: 'compaction/summary', seq: 5, time: T0 + 250,
    data: {
      compactionId: 'c-1',
      summary: [{ type: 'text', text: 'synthetic compaction summary' }],
      shadowedRange: { start: 2, end: 2 },
      shadowedSeqs: [2],
      shadowedTokenCount: 42,
      provider: PROVIDER,
      model: 'synthetic-model-a',
      usage: { inputTokens: 9999, outputTokens: 9999 },
    },
  },
  {
    type: 'compaction/prune', seq: 6, time: T0 + 260,
    data: { shadowedRange: { start: 2, end: 2 }, shadowedSeqs: [2], shadowedTokenCount: 42 },
  },
  { type: 'compaction/end', seq: 7, time: T0 + 265, data: { compactionId: 'c-1', turn: 1 } },
  { type: 'turn/end', seq: 8, time: T0 + 270, data: { turn: 1, reason: { kind: 'completed' } } },
  { type: 'turn/start', seq: 9, time: T0 + 280, data: { turn: 2 } },
  { type: 'step/start', seq: 10, time: T0 + 290, data: { turn: 2, step: 1 } },
  {
    type: 'assistant/message', seq: 11, time: T0 + 300, surfaceOp: 'append',
    data: { turn: 2, step: 1, message: modelMessage('m-11', 'synthetic output 11', 'synthetic-model-a'), interrupted: true },
  },
  { type: 'step/end', seq: 12, time: T0 + 310, data: { turn: 2, step: 1 } },
  { type: 'turn/end', seq: 13, time: T0 + 320, data: { turn: 2, reason: { kind: 'max-tokens' } } },
]
// processing: checkpoint session = 70+30 = 100 (compaction usage excluded)
const CHECKPOINT_PROCESSING = 100

// Native V3 seeded fork written through the backend's own write path.
const U_D = { inputTokens: 500, outputTokens: 150, cacheWriteTokens: 12, reasoningTokens: 60 }
// processing: native fork own = 500+150+12 = 662, inherited = 1780
const NATIVE_FORK_OWN_PROCESSING = 662
// Global owned totals exclude every inherited prefix and every compaction
// usage payload: 1780 + 435 + 483 + 662 + 100 = 3460.
const GLOBAL_OWN_PROCESSING = 3460

function v0HeaderLine({ id, createdAt, parentSession, seedLength, origin, delegationDepth = 0 }) {
  return {
    type: 'session', version: 0, id, createdAt, delegationDepth,
    cwd: PROJECT_CWD,
    ...(parentSession === undefined ? {} : { parentSession }),
    ...(seedLength === undefined ? {} : { seedLength }),
    ...(origin === undefined ? {} : { origin }),
  }
}

/** Write one legacy V0 artifact where the real backend resolves it. */
function writeV0Artifact(persistence, { header, events }) {
  // The header line names PROJECT_CWD, so the artifact must be located under
  // the same cwd: the backend refuses a stored header whose id+cwd identity
  // does not match the directory it was resolved from.
  const located = persistence.locate({ id: header.id, cwd: header.cwd ?? PROJECT_CWD })
  assert.equal(located.kind, 'jsonl')
  const dir = dirname(located.path)
  mkdirSync(dir, { recursive: true })
  const lines = [JSON.stringify(v0HeaderLine(header)), ...events.map((event) => JSON.stringify(event))]
  const path = join(dir, 'session.jsonl')
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

// ---- shared harness state -------------------------------------------------
const state = {
  sessionRoot: mkdtempSync(join(tmpdir(), 'tcf-e961-sessions-')),
  ledgerDir: mkdtempSync(join(tmpdir(), 'tcf-e961-ledger-')),
  root: null,
  pluginFiber: null,
  rpcHandlers: new Map(),
  persistence: null,
  v0Sources: new Map(),
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

/** Build the cordis root with host-service stand-ins and the real backend. */
function startRuntime() {
  const root = new Context()
  state.rpcHandlers.clear()
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
  // Host settings service contract the plugin consumes (accounts require both
  // `get` and `update` on the injected settings).
  root.provide('settings', {
    get() { return null },
    async update(_key, patch) { return patch },
    toJSON() { return {} },
  })
  root.provide('timer', { interval(_fn, _ms) { return () => {} } })
  root.mixin('timer', ['interval'])
  root.provide('webServer', {})
  state.persistence = new JsonlSessionPersistence(root, { root: state.sessionRoot, compression: 'none' })
  state.root = root
  return root
}

/** Apply the real plugin module and wait for its RPC registration. */
async function applyPlugin(root) {
  const fiber = root.plugin(pluginModule, { dataDir: state.ledgerDir, providerProxy: false })
  const deadline = Date.now() + 30_000
  while (!state.rpcHandlers.has('/token-usage')) {
    assert.ok(Date.now() < deadline, 'plugin apply did not register /token-usage in time')
    await delay(10)
  }
  state.pluginFiber = fiber
}

test('synthetic fixtures materialize, the native fork is written, and the real boot import settles', async () => {
  const root = startRuntime()
  const parentPath = writeV0Artifact(state.persistence, { header: { id: 'tcf-e961-a-parent-v0', createdAt: T0 }, events: PARENT_EVENTS })
  const forkPath = writeV0Artifact(state.persistence, {
    header: { id: 'tcf-e961-b-fork-legacy', createdAt: T0 + 3600_000, parentSession: 'tcf-e961-a-parent-v0', seedLength: 8 },
    events: [...PARENT_EVENTS.map((event) => ({ ...event })), ...FORK_OWN_EVENTS(8)],
  })
  const subagentPath = writeV0Artifact(state.persistence, {
    header: { id: 'tcf-e961-c-subagent-v0', createdAt: T0 + 1800_000, parentSession: 'tcf-e961-a-parent-v0', origin: 'subagent', delegationDepth: 1 },
    events: SUBAGENT_EVENTS,
  })
  const checkpointPath = writeV0Artifact(state.persistence, {
    header: { id: 'tcf-e961-e-checkpoint-v0', createdAt: T0 + 2400_000 },
    events: CHECKPOINT_EVENTS,
  })
  state.v0Sources.set('tcf-e961-a-parent-v0', { path: parentPath, digest: sha256(parentPath) })
  state.v0Sources.set('tcf-e961-b-fork-legacy', { path: forkPath, digest: sha256(forkPath) })
  state.v0Sources.set('tcf-e961-c-subagent-v0', { path: subagentPath, digest: sha256(subagentPath) })
  state.v0Sources.set('tcf-e961-e-checkpoint-v0', { path: checkpointPath, digest: sha256(checkpointPath) })

  // Native V3 seeded fork through the backend's own create/append/flush path.
  // The backend validates every appended row against the current V3 contract,
  // so surface events (assistant/message) must carry the V3 `surfaceOp: "append"`
  // marker even when their payloads are copied from the V0-era fixtures.
  const forkHeader = {
    version: 3, id: 'tcf-e961-d-fork-native', createdAt: T0 + 7200_000,
    cwd: PROJECT_CWD, parentSession: 'tcf-e961-a-parent-v0', isSeeded: true,
  }
  const handle = await state.persistence.create(forkHeader, { inheritedEventCount: 8 })
  try {
    await handle.append([
      ...PARENT_EVENTS.map((event) => ({ ...event })),
      // A directly written V3 fork must carry the inherited end-seed marker
      // itself: only the V0→V3 migration chain synthesizes it.
      { type: 'session/end-seed', seq: 8, time: T0 + 7200_000, data: { inherited: true } },
      ...FORK_OWN_EVENTS(9).map((event) => ({
        ...event,
        time: T0 + 7300 + (event.seq - 9) * 10,
        data: event.type === 'assistant/message'
          ? { ...event.data, message: modelMessage(`m-d-${event.seq}`, `synthetic output ${event.seq}`, 'synthetic-model-d'), usage: U_D }
          : event.data,
      })),
    ])
    await handle.flush()
  } finally {
    await handle.close()
  }

  await applyPlugin(root)
  const status = await state.waitImportSettled()
  assert.equal(status.errors, 0, `boot import errors: ${status.lastError}`)
  assert.equal(status.lastError, null)
  assert.equal(status.total, 5)
  assert.equal(status.done, 5)
})

test('official V0→V3 chain serves current generations through reads and left sources immutable', async () => {
  for (const [id, source] of state.v0Sources) {
    assert.equal(sha256(source.path), source.digest, `immutable v0 source ${id} was modified during migration`)
    // The read-only import path decodes and migrates without publishing a
    // successor artifact (the backend publishes on its write path only), so
    // the exact guarantee here is the served current-format interpretation.
    const handle = await state.persistence.open(id, 'read')
    try {
      assert.equal(handle.header.version, 3, `official chain did not serve the v3 interpretation for ${id}`)
    } finally {
      await handle.close()
    }
  }
})

test('RPC reports exact owned/inherited totals and attribution after boot import', async () => {
  const sessions = await state.rpc('sessions', {})
  const byId = new Map(sessions.rows.map((row) => [row.id, row]))
  assert.deepEqual([...byId.keys()].sort(), [
    'tcf-e961-a-parent-v0', 'tcf-e961-b-fork-legacy', 'tcf-e961-c-subagent-v0',
    'tcf-e961-d-fork-native', 'tcf-e961-e-checkpoint-v0',
  ])
  assert.equal(byId.get('tcf-e961-a-parent-v0').processingTokens, PARENT_PROCESSING)
  assert.equal(byId.get('tcf-e961-b-fork-legacy').processingTokens, FORK_OWN_PROCESSING)
  // The legacy fork's published cut grew to 9: the official V1→V2 stage
  // synthesizes the inherited end-seed marker after the companion
  // system/message row it derives from the first V0 assistant/message.
  assert.equal(byId.get('tcf-e961-b-fork-legacy').seedLength, 9)
  assert.equal(byId.get('tcf-e961-c-subagent-v0').processingTokens, SUBAGENT_PROCESSING)
  assert.equal(byId.get('tcf-e961-d-fork-native').processingTokens, NATIVE_FORK_OWN_PROCESSING)
  assert.equal(byId.get('tcf-e961-d-fork-native').seedLength, 8)
  assert.equal(byId.get('tcf-e961-e-checkpoint-v0').processingTokens, CHECKPOINT_PROCESSING)

  const parent = await state.rpc('session-detail', { id: 'tcf-e961-a-parent-v0' })
  assert.equal(parent.ownTotals.processingTokens, PARENT_PROCESSING)
  assert.equal(parent.ownTotals.cacheReadTokens, 50)
  assert.equal(parent.ownTotals.cacheWriteTokens, 30)
  assert.equal(parent.ownTotals.reasoningTokens, 100)
  assert.equal(parent.inheritedTotals.processingTokens, 0)

  const legacyFork = await state.rpc('session-detail', { id: 'tcf-e961-b-fork-legacy' })
  assert.equal(legacyFork.ownTotals.processingTokens, FORK_OWN_PROCESSING)
  assert.equal(legacyFork.inheritedTotals.processingTokens, PARENT_PROCESSING)
  assert.equal(legacyFork.calls.filter((call) => call.owned).length, 1)
  assert.equal(legacyFork.calls.filter((call) => !call.owned).length, 2)

  const nativeFork = await state.rpc('session-detail', { id: 'tcf-e961-d-fork-native' })
  assert.equal(nativeFork.ownTotals.processingTokens, NATIVE_FORK_OWN_PROCESSING)
  assert.equal(nativeFork.ownTotals.cacheWriteTokens, 12)
  assert.equal(nativeFork.inheritedTotals.processingTokens, PARENT_PROCESSING)
  assert.equal(nativeFork.calls.filter((call) => call.owned).length, 1)
  assert.equal(nativeFork.calls.filter((call) => !call.owned).length, 2)

  const subagent = await state.rpc('session-detail', { id: 'tcf-e961-c-subagent-v0' })
  assert.equal(subagent.ownTotals.processingTokens, SUBAGENT_PROCESSING)
  assert.equal(subagent.inheritedTotals.processingTokens, 0)
  assert.equal(subagent.parentSession, 'tcf-e961-a-parent-v0')

  const checkpoint = await state.rpc('session-detail', { id: 'tcf-e961-e-checkpoint-v0' })
  assert.equal(checkpoint.ownTotals.processingTokens, CHECKPOINT_PROCESSING)
  // Stored ≤V3 logs express the usage-less interrupted step through
  // `data.interrupted`, so it stays a zero-token health record with no failed
  // billing and no estimate; the compaction usage payload leaked nowhere.
  const interruptedStep = checkpoint.calls.find((call) => call.turn === 2 && call.step === 1)
  assert.notEqual(interruptedStep, undefined)
  assert.equal(interruptedStep.status, 'unknown')
  assert.equal(interruptedStep.estimated, false)
  assert.equal(interruptedStep.inputTokens + interruptedStep.outputTokens
    + interruptedStep.cacheReadTokens + interruptedStep.cacheWriteTokens, 0)
  assert.equal(checkpoint.ownTotals.failedRequests, 0)
  assert.equal(checkpoint.calls.filter((call) => call.status === 'failed').length, 0)

  const overview = await state.rpc('overview', {})
  assert.equal(overview.totals.processingTokens, GLOBAL_OWN_PROCESSING)
  assert.equal(overview.totals.newComputeTokens, 3345)

  // Attribution comes from the migrated assistant/message model source.
  const requests = await state.rpc('requests', { sessionId: 'tcf-e961-a-parent-v0' })
  assert.equal(requests.rows.length, 2)
  for (const row of requests.rows) {
    assert.equal(row.provider, PROVIDER)
    assert.equal(row.model, 'synthetic-model-a')
  }
})

test('manual full rescan through import-control is idempotent', async () => {
  const before = await state.rpc('overview', {})
  await state.rpc('import-control', { action: 'scan', full: true })
  const status = await state.waitImportSettled()
  assert.equal(status.errors, 0)
  assert.equal(status.done, 5)
  const after = await state.rpc('overview', {})
  assert.equal(after.totals.processingTokens, before.totals.processingTokens)
  assert.equal(after.totals.processingTokens, GLOBAL_OWN_PROCESSING)
})

test('pause then cancel through import-control settles without leaking the pass', async () => {
  await state.rpc('import-control', { action: 'scan', full: true })
  await state.rpc('import-control', { action: 'pause' })
  const deadline = Date.now() + 30_000
  for (;;) {
    const status = await state.rpc('import-status')
    if (status.running === true && status.paused === true) break
    assert.ok(Date.now() < deadline, 'import never reached the paused state')
    await delay(20)
  }
  await state.rpc('import-control', { action: 'cancel' })
  const status = await state.waitImportSettled()
  assert.equal(status.errors, 0)
  // A released pass leaves no partial ownership behind: an immediate full scan
  // runs to completion and reproduces the exact totals.
  await state.rpc('import-control', { action: 'scan', full: true })
  const settled = await state.waitImportSettled()
  assert.equal(settled.done, 5)
  assert.equal(settled.errors, 0)
  const overview = await state.rpc('overview', {})
  assert.equal(overview.totals.processingTokens, GLOBAL_OWN_PROCESSING)
})

test('ledger reopen on the same store reproduces exact totals from migrated sources', async () => {
  await state.pluginFiber?.dispose?.()
  state.pluginFiber = null
  const root = startRuntime()
  await applyPlugin(root)
  const status = await state.waitImportSettled()
  assert.equal(status.errors, 0)
  assert.equal(status.total, 5)
  const sessions = await state.rpc('sessions', {})
  const byId = new Map(sessions.rows.map((row) => [row.id, row]))
  assert.equal(byId.get('tcf-e961-a-parent-v0').processingTokens, PARENT_PROCESSING)
  assert.equal(byId.get('tcf-e961-b-fork-legacy').processingTokens, FORK_OWN_PROCESSING)
  assert.equal(byId.get('tcf-e961-b-fork-legacy').seedLength, 9)
  assert.equal(byId.get('tcf-e961-d-fork-native').processingTokens, NATIVE_FORK_OWN_PROCESSING)
  const legacyFork = await state.rpc('session-detail', { id: 'tcf-e961-b-fork-legacy' })
  assert.equal(legacyFork.ownTotals.processingTokens, FORK_OWN_PROCESSING)
  assert.equal(legacyFork.inheritedTotals.processingTokens, PARENT_PROCESSING)
  const overview = await state.rpc('overview', {})
  assert.equal(overview.totals.processingTokens, GLOBAL_OWN_PROCESSING)
})

test('unreaddable source fails the pass closed without touching any artifact', async () => {
  const corruptPath = writeV0Artifact(state.persistence, {
    header: { id: 'tcf-e961-x-corrupt', createdAt: T0 + 9000_000 },
    events: [{ type: 'turn/start', seq: 0, time: T0, data: { turn: 1 } }],
  })
  // Break the stored identity: the header must name a different session than
  // the directory it was resolved from, so the body read refuses fail-closed.
  const broken = readFileSync(corruptPath, 'utf8').replace('"id":"tcf-e961-x-corrupt"', '"id":"tcf-e961-x-elsewhere"')
  assert.notEqual(broken, readFileSync(corruptPath, 'utf8'))
  writeFileSync(corruptPath, broken)
  const digest = sha256(corruptPath)

  await state.rpc('import-control', { action: 'scan', full: true })
  const status = await state.waitImportSettled()
  assert.ok(status.errors >= 1, `expected a closed failure, got ${JSON.stringify(status)}`)
  assert.equal(sha256(corruptPath), digest, 'the failed read modified the source artifact')
  // Containment: every healthy session keeps its exact ledger state and the
  // ledger stays open for subsequent RPC traffic.
  const sessions = await state.rpc('sessions', {})
  const byId = new Map(sessions.rows.map((row) => [row.id, row]))
  assert.equal(byId.get('tcf-e961-a-parent-v0').processingTokens, PARENT_PROCESSING)
  assert.equal(byId.get('tcf-e961-b-fork-legacy').processingTokens, FORK_OWN_PROCESSING)
  const overview = await state.rpc('overview', {})
  assert.equal(overview.totals.processingTokens, GLOBAL_OWN_PROCESSING)
})

test('teardown stops the plugin fiber and removes harness state', async () => {
  await state.pluginFiber?.dispose?.()
  state.pluginFiber = null
  await state.root?.fiber?.dispose?.()
  state.root = null
  rmSync(state.sessionRoot, { recursive: true, force: true })
  rmSync(state.ledgerDir, { recursive: true, force: true })
  assert.ok(true)
})
