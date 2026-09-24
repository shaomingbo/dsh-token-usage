import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import { createLedgerService, foldEvents } from '../lib/ledger/service.js'

const usage = (n = 10) => ({ inputTokens: n, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0 })
const stream = (sample, reason = 'error') => [
  ...(sample ? [{ type: 'chunk', time: 1000, chunk: { type: 'usage', usage: sample } }] : []),
  { type: 'chunk', time: 1001, chunk: { type: 'finish', reason: { kind: reason } } },
]
function fixture({ retry = true, missing = false, cancelled = false } = {}) {
  const rows = [
    ['turn/start', { turn: 0 }],
    ['request/header', { config: { provider: 'fixture', model: 'm' } }],
    ['step/start', { turn: 0, step: 0 }],
    ['assistant/attempt', { turn: 0, step: 0, stream: stream(missing ? undefined : usage()) }],
    ...(retry ? [
      ['llm/retry', { turn: 0, step: 0 }],
      ['llm/retry-started', { turn: 0, step: 0 }],
      ['assistant/message', { turn: 0, step: 0, stream: stream(usage(20), cancelled ? 'aborted' : 'stop'),
        message: { source: { kind: 'model', provider: 'fixture', model: 'm' } }, ...(cancelled ? { interrupted: true } : {}) }],
    ] : []),
    ['step/end', { turn: 0, step: 0 }],
    ['turn/end', { turn: 0, reason: cancelled ? 'cancelled' : 'completed' }],
  ]
  return { header: { id: 'fixture', version: 4, createdAt: 1000 }, events: rows.map(([type, data], seq) => ({ type, data, seq, time: 1000 + seq })) }
}

test('V4 retry keeps two attempt records, matches official complete-turn aggregate, and replays idempotently', () => {
  const session = fixture()
  const ledger = createLedgerService({ databasePath: ':memory:' })
  try {
    const expected = deriveTurnTokenUsage(session.events)
    assert.equal(expected.uncachedInputTokens, 30)
    ledger.importSession(session)
    ledger.importSession(session)
    for (const event of session.events) ledger.ingestEvent(session.header, event)
    const totals = ledger.getOverview().totals
    assert.equal(totals.requests, 2)
    assert.equal(totals.failedRequests, 1)
    assert.equal(ledger.getSessionDetail('fixture').ownTotals.failedRequests, 1)
    assert.equal(totals.inputTokens, expected.uncachedInputTokens)
    assert.equal(totals.processingTokens, expected.totalTokens)
    const records = ledger.query({ filter: { time: { preset: 'all' } }, views: ['page'], page: { entity: 'request' } }).page.rows
    assert.deepEqual(records.map(row => row.attempt).sort(), [4, 7])
    assert.equal(records.find(row => row.attempt === 4).failureType, 'error')
    assert.equal(records.find(row => row.attempt === 7).failureType, null)
  } finally { ledger.dispose() }
})

test('durable usage uses the last stream sample, or authoritative message usage, never both', () => {
  const session = fixture()
  session.events[3].data.stream.unshift({ type: 'chunk', time: 999, chunk: { type: 'usage', usage: usage(99) } })
  session.events[6].data.usage = usage(21)
  const records = [...foldEvents(session.header, session.events).values()]
  assert.deepEqual(records.map(row => row.input_tokens), [10, 21])
  assert.equal(deriveTurnTokenUsage(session.events).uncachedInputTokens, 31)
})

test('failure/cancellation/unknown usage are retained; estimates remain distinct', () => {
  for (const options of [{ retry: false }, { cancelled: true }, { missing: true }]) {
    const session = fixture(options)
    const records = [...foldEvents(session.header, session.events).values()]
    assert.equal(records.length, options.retry === false ? 1 : 2)
    if (options.missing) {
      assert.equal(deriveTurnTokenUsage(session.events), undefined)
      assert.equal(records[0].status, 'failed')
      assert.equal(records[0].cache_read_state, 'unknown')
    }
    if (options.cancelled) assert.equal(records[1].failure_type, 'cancelled')
  }
  const session = fixture({ missing: true, retry: false })
  const estimated = [...foldEvents(session.header, session.events, { estimator: () => ({ inputTokens: 8, outputTokens: 1 }) }).values()][0]
  assert.equal(estimated.status, 'estimated')
  assert.equal(estimated.estimated, 1)
})

test('fork cut can divide attempts in the same step without inherited double billing', () => {
  const session = fixture()
  session.header = { ...session.header, isSeeded: true, inheritedEventCount: 5 }
  const ledger = createLedgerService({ databasePath: ':memory:' })
  try {
    for (const event of session.events) ledger.ingestEvent(session.header, event)
    ledger.importSession(session)
    const records = [...foldEvents(session.header, session.events).values()]
    assert.deepEqual(records.map(row => [row.attempt, row.owned]).sort(), [[4, 0], [7, 1]])
    assert.equal(ledger.getOverview().totals.inputTokens, 20)
  } finally { ledger.dispose() }
})

test('attempts sharing timestamp paginate and correct independently', () => {
  const session = fixture()
  session.events = session.events.map(event => ({ ...event, time: 1000 }))
  const ledger = createLedgerService({ databasePath: ':memory:' })
  try {
    ledger.importSession(session)
    const spec = { filter: { time: { preset: 'all' } }, views: ['page'], page: { entity: 'request', limit: 1 } }
    const first = ledger.query(spec).page
    const second = ledger.query({ ...spec, page: { ...spec.page, cursor: first.nextCursor } }).page
    assert.notEqual(first.rows[0].id, second.rows[0].id)
    const corrected = ledger.correctRequest(first.rows[0].id, { inputTokens: 99 })
    const inspected = ledger.inspect({ kind: 'request', id: first.rows[0].id, filter: { time: { preset: 'all' } } })
    assert.equal(inspected.request.inputTokens, 99)
    assert.equal(ledger.inspect({ kind: 'request', id: second.rows[0].id, filter: { time: { preset: 'all' } } }).request.inputTokens, 20)
    ledger.revokeCorrection(corrected.id)
  } finally { ledger.dispose() }
})

test('legacy step samples still replace; overlapping old V4 step requires explicit migration', () => {
  const ledger = createLedgerService({ databasePath: ':memory:' })
  try {
    const legacy = { header: { id: 'legacy' }, events: [{ type: 'assistant/message', seq: 1, time: 1000, data: { turn: 0, step: 0, usage: usage() } }] }
    ledger.importSession(legacy)
    ledger.importSession(legacy)
    assert.equal(ledger.listRequests().rows[0].attempt, 0)
    const next = fixture(); next.header.id = 'legacy'
    assert.throws(() => ledger.importSession(next), { code: 'attempt-migration-required' })
    assert.equal(ledger.listRequests().rows.length, 1)
  } finally { ledger.dispose() }
})
