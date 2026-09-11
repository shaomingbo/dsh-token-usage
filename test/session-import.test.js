import test from 'node:test'
import assert from 'node:assert/strict'
import { headerFromInspection, listSessionSnapshots, readSessionInspection, sessionPersistenceProtocol } from '../lib/session-import.js'
import { createLedgerService } from '../lib/ledger/service.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('protocol detection requires the complete public capability set of one release', () => {
  // 0.1.5: snapshot listing plus read handles; extra legacy members stay
  // subordinate to the handle path.
  assert.equal(sessionPersistenceProtocol({ list() {}, open() {} }), 'current')
  assert.equal(sessionPersistenceProtocol({ list() {}, open() {}, listSnapshots() {}, inspect() {} }), 'current')
  // The real 0.1.2 host exposes BOTH list() and listSnapshots(); only the
  // absence of open() keeps the legacy path unambiguous.
  assert.equal(sessionPersistenceProtocol({ list() {}, listSnapshots() {}, inspect() {} }), 'legacy')
  // Mixed or incomplete shapes must never be guessed into a row shape.
  assert.equal(sessionPersistenceProtocol({ list() {} }), null)
  assert.equal(sessionPersistenceProtocol({ open() {} }), null)
  assert.equal(sessionPersistenceProtocol({ listSnapshots() {} }), null)
  assert.equal(sessionPersistenceProtocol({ inspect() {} }), null)
  assert.equal(sessionPersistenceProtocol({ open() {}, listSnapshots() {}, inspect() {} }), null)
  assert.equal(sessionPersistenceProtocol({}), null)
})

test('listSessionSnapshots selects one complete protocol and fails closed on mixed shapes', async () => {
  // 0.1.5 current set: list() returns {header, revision} snapshot rows.
  assert.deepEqual(
    await listSessionSnapshots({ async list() { return [{ header: { id: 'a' }, revision: 'r1' }] }, open() {} }),
    [{ header: { id: 'a' }, revision: 'r1' }],
  )
  // Real 0.1.2 shape: list() returns bare SessionHeader[] rows, so the
  // adapter must read the snapshot listing through listSnapshots() instead.
  assert.deepEqual(
    await listSessionSnapshots({
      async list() { return [{ id: 'bare-header-trap' }] },
      async listSnapshots() { return [{ header: { id: 'legacy' }, revision: 'r0' }] },
      async inspect() { return {} },
    }),
    [{ header: { id: 'legacy' }, revision: 'r0' }],
  )
  // The T-A-005 trap alone — a same-named list() without the complete
  // current or legacy capability set — fails closed instead of returning
  // SessionHeader[] rows that the import mapping cannot read.
  await assert.rejects(() => listSessionSnapshots({ async list() { return [{ id: 'bare' }] } }), /incomplete SessionPersistence protocol/)
  await assert.rejects(() => listSessionSnapshots({ async listSnapshots() { return [] } }), /incomplete SessionPersistence protocol/)
  await assert.rejects(() => listSessionSnapshots({}), /incomplete SessionPersistence protocol/)
})

test('readSessionInspection opens a read handle, lifts the top-level cut, and closes', async () => {
  const closed = []
  const persistence = {
    async list() { return [] },
    async open(id, access) {
      assert.equal(id, 'fork-1')
      assert.equal(access, 'read')
      return {
        header: { version: 3, id: 'fork-1', isSeeded: true, parentSession: 'parent' },
        inheritedEventCount: 8,
        async read() { return { events: [{ type: 'step/start', seq: 0 }], eventState: 'owned' } },
        async close() { closed.push(id) },
      }
    },
  }
  const inspection = await readSessionInspection(persistence, 'fork-1')
  assert.equal(inspection.inheritedEventCount, 8)
  assert.equal(inspection.meta.id, 'fork-1')
  assert.equal(inspection.events.length, 1)
  assert.deepEqual(closed, ['fork-1'])
})

test('import entry maps handle cut onto ledger header so seeded forks split usage exactly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-token-import-'))
  const service = createLedgerService({ databasePath: join(dir, 'usage.sqlite') })
  try {
    // Inherited prefix carries 120 in + 30 out = 150 processing tokens; the
    // fork-owned step adds 40 in + 10 out = 50. Expected values follow the
    // ledger contract: processing = uncached input + output + cacheRead +
    // cacheWrite, reasoning is a displayed subset of output.
    const parentEvents = [
      {
        type: 'assistant/message', seq: 0, time: 1,
        data: {
          turn: 1, step: 1,
          message: { id: 'm0', role: 'assistant', content: [{ type: 'text', text: 'seed' }], source: { kind: 'model', provider: 'synthetic-provider', model: 'synthetic-model' } },
          usage: { inputTokens: 120, outputTokens: 30 },
        },
      },
    ]
    service.importSession({
      header: { version: 3, id: 'parent', createdAt: 1, isSeeded: false },
      events: parentEvents,
    })
    const forkOwnEvent = {
      type: 'assistant/message', seq: 1, time: 2,
      data: {
        turn: 2, step: 1,
        message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'own' }], source: { kind: 'model', provider: 'synthetic-provider', model: 'synthetic-model' } },
        usage: { inputTokens: 40, outputTokens: 10 },
      },
    }
    const persistence = {
      async list() {
        return [{ header: { id: 'fork-1' }, revision: 'rev-1' }]
      },
      async open(id, access) {
        assert.equal(access, 'read')
        return {
          header: { version: 3, id, createdAt: 2, isSeeded: true, parentSession: 'parent' },
          inheritedEventCount: 1,
          async read() {
            return { events: [...parentEvents, forkOwnEvent], eventState: 'owned' }
          },
          async close() {},
        }
      },
    }
    const snapshots = await listSessionSnapshots(persistence)
    const inspection = await readSessionInspection(persistence, snapshots[0].header.id)
    const header = headerFromInspection(inspection, snapshots[0].revision)
    assert.equal(header.inheritedEventCount, 1)
    const result = service.importSession({ header, events: inspection.events }, { source: 'profile' })
    // `imported` is the ledger's folded request-record count for the session:
    // the inherited prefix row (turn 1, owned = 0) and the fork-owned row
    // (turn 2, owned = 1) are both persisted for the fork, and idempotent
    // re-imports reproduce the same count. Ownership keeps the totals exact:
    // own totals only ever count owned rows, inherited rows feed
    // inheritedTotals, and neither is double-counted globally.
    assert.equal(result.imported, 2)
    const detail = service.getSessionDetail('fork-1', { timezone: 'UTC' })
    assert.equal(detail.ownTotals.processingTokens, 50)
    assert.equal(detail.ownTotals.inputTokens, 40)
    assert.equal(detail.ownTotals.outputTokens, 10)
    assert.equal(detail.inheritedTotals.processingTokens, 150)
    assert.equal(detail.inheritedTotals.inputTokens, 120)
    assert.equal(detail.inheritedTotals.outputTokens, 30)
  } finally {
    service.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readSessionInspection falls back to legacy inspect and lifts the top-level inherited cut', async () => {
  const persistence = {
    // The real 0.1.2 shape: listSnapshots()+inspect carry the protocol; the
    // same-named bare list() must stay ignored.
    list() { throw new Error('bare list() must not be consulted on the legacy path') },
    async listSnapshots() { return [] },
    async inspect(id) {
      assert.equal(id, 'legacy-1')
      return {
        meta: { version: 3, id: 'legacy-1', createdAt: 3, isSeeded: true, parentSession: 'parent' },
        // The 0.1.2 inspection carries the exact cut at the top level
        // (SessionInspection extends SessionStorageMetadata).
        inheritedEventCount: 4,
        events: [{ type: 'step/start', seq: 0, time: 1, data: { turn: 1, step: 1 } }],
      }
    },
  }
  const inspection = await readSessionInspection(persistence, 'legacy-1')
  const header = headerFromInspection(inspection, 'rev-legacy')
  assert.equal(header.inheritedEventCount, 4)
  assert.equal(header.revision, 'rev-legacy')
})

test('readSessionInspection closes the handle when the body read fails', async () => {
  const closed = []
  const persistence = {
    async list() { return [] },
    async open() {
      return {
        header: { version: 3, id: 'broken-1', createdAt: 1, isSeeded: false },
        inheritedEventCount: 0,
        async read() { throw new Error('synthetic body read failure') },
        async close() { closed.push('broken-1') },
      }
    },
  }
  await assert.rejects(() => readSessionInspection(persistence, 'broken-1'), /synthetic body read failure/)
  assert.deepEqual(closed, ['broken-1'])
})
