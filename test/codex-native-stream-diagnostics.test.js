import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodexRuntime } from '../lib/capabilities/codex-native/runtime.js';

const endpoint = 'https://chatgpt.com/backend-api/codex/responses';
const account = 'synthetic-stream-diagnostic-account';
const apiKey = 'test.' + Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url') + '.FAKE';
const hidden = 'synthetic-private-reader-text';
const context = { messages: [{ role: 'user', content: hidden, timestamp: 0 }] };
const usage = { input: 8, output: 3, cacheRead: 4, cacheWrite: 0, totalTokens: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const message = { role: 'assistant', content: [{ type: 'text', text: hidden }], usage, stopReason: 'stop' };
const bodyCounters = ['responseBytes', 'chunks', 'events', 'eventCounts', 'firstByteMs', 'lastByteMs', 'lastEventMs', 'lastEvent'];
function assertUnavailable(trace) {
  for (const key of bodyCounters) assert.equal(Object.hasOwn(trace, key), false, `${key} is SDK-owned, not an observed zero`);
  for (const secret of [account, apiKey, hidden]) assert.ok(!JSON.stringify(trace).includes(secret));
}
function fixture({ sdk, fetchImpl = async () => new Response('SDK-owned body'), ...options } = {}) {
  let bindings = 0, requests = 0;
  const runtime = createCodexRuntime({ timeoutMs: 1000, configured: () => true,
    resolveOAuth: async () => { bindings++; return { apiKey, headers: { 'chatgpt-account-id': account } }; },
    modelProvider: sdk && { id: 'openai-codex', streamSimple: sdk },
    fetchImpl: async (...args) => { requests++; return fetchImpl(...args); }, ...options });
  return { runtime, model: runtime.models()[0], bindings: () => bindings, requests: () => requests };
}
async function drain(stream, onEvent = () => {}) {
  for await (const event of stream) onEvent(event);
  return stream.result();
}
const wireUsage = { input_tokens: 12, output_tokens: 3, total_tokens: 15, input_tokens_details: { cached_tokens: 4 } };
const completed = { type: 'response.completed', response: { id: 'resp_synthetic', status: 'completed', usage: wireUsage } };
const readerRows = [
  { type: 'response.created', response: { id: 'resp_synthetic', status: 'in_progress' } },
  { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_synthetic', role: 'assistant', content: [], status: 'in_progress' } },
  { type: 'response.content_part.added', item_id: 'msg_synthetic', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
  { type: 'response.output_text.delta', item_id: 'msg_synthetic', output_index: 0, content_index: 0, delta: hidden },
  { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_synthetic', role: 'assistant', content: [{ type: 'output_text', text: hidden, annotations: [] }], status: 'completed' } },
];
const sse = rows => rows.map(row => `data: ${JSON.stringify(row)}\n\n`).join('');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function* successfulSdk(_model, _context, options) {
  await options.fetch(endpoint, { body: '{}' });
  yield { type: 'text_delta', contentIndex: 0, delta: hidden, partial: message };
  yield { type: 'done', reason: 'stop', message };
}

test('SDK reader-text success publishes terminal diagnostics before exposing done, without invented wire counters', async () => {
  const f = fixture({ sdk: successfulSdk });
  try {
    const op = await f.runtime.open({ model: f.model.id, purpose: 'compaction' });
    let terminal;
    const result = await drain(op.provider().streamSimple(f.model, context), event => {
      if (event.type === 'done') terminal = op.diagnostics();
    });
    assert.equal(result.content[0].text, hidden);
    assert.deepEqual(result.usage, usage);
    assert.equal(result.stopReason, 'stop');
    assert.equal(terminal.phase, 'completed');
    assert.equal(terminal.requests, 1);
    assert.equal(terminal.httpStatus, 200);
    assert.ok(terminal.completedMs >= terminal.headersMs);
    assertUnavailable(terminal);
    assert.deepEqual(op.compactionUsage(), { kind: 'unavailable' });
    assert.equal(f.bindings(), 1); assert.equal(f.requests(), 1);
    op.close(); op.close();
    assert.equal(op.diagnostics().phase, 'completed');
    assertUnavailable(op.diagnostics());
  } finally { f.runtime.dispose(); }
});

for (const failure of ['event', 'throw', 'eof', 'http', 'network']) {
  test(`SDK ${failure} failure publishes failed diagnostics without turning SDK output into wire counters`, async () => {
    const f = fixture({
      fetchImpl: async () => {
        if (failure === 'network') throw new Error(hidden);
        return new Response(hidden, { status: failure === 'http' ? 503 : 200 });
      },
      sdk: async function* (_model, _context, options) {
        await options.fetch(endpoint, { body: '{}' });
        if (failure === 'event') yield { type: 'error', error: { ...message, errorMessage: hidden, stopReason: 'error' } };
        if (failure === 'throw') throw new Error(hidden);
      },
    });
    try {
      const op = await f.runtime.open({ model: f.model.id });
      const result = await drain(op.provider().streamSimple(f.model, context), event => {
        if (event.type === 'error') assert.equal(op.diagnostics().phase, 'failed');
      });
      assert.equal(result.errorMessage, `CODEX_RUNTIME_${failure === 'network' ? 'NETWORK' : failure === 'http' ? 'HTTP_503' : 'RESPONSE_STREAM'}`);
      assert.equal(result.stopReason, 'error');
      const trace = op.diagnostics();
      assert.equal(trace.phase, 'failed'); assert.equal(trace.requests, 1);
      assert.equal(trace.httpStatus, failure === 'network' ? undefined : failure === 'http' ? 503 : 200);
      assert.equal(trace.completedMs, undefined);
      assertUnavailable(trace);
      op.close(); op.close();
      assert.equal(op.diagnostics().phase, 'failed');
      assert.equal(f.bindings(), 1); assert.equal(f.requests(), 1);
    } finally { f.runtime.dispose(); }
  });
}

for (const method of ['call-abort', 'lease-abort', 'close', 'dispose', 'deadline']) {
  test(`SDK ${method} after HTTP200 freezes an honest terminal diagnostic and preserves the stop identity`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const headers = deferred(), late = deferred(), finished = deferred();
    let wireSignal, aborts = 0;
    const f = fixture({ sdk: async function* (_model, _context, options) {
      try {
        await options.fetch(endpoint, { body: '{}' });
        headers.resolve();
        await late.promise;
        yield { type: 'done', reason: 'stop', message };
      } finally { finished.resolve(); }
    }, fetchImpl: async (_url, init) => {
      wireSignal = init.signal;
      wireSignal.addEventListener('abort', () => { aborts++; }, { once: true });
      return new Response(hidden);
    } });
    try {
      const lease = new AbortController(), call = new AbortController();
      const op = await f.runtime.open({ model: f.model.id, signal: lease.signal });
      const stream = op.provider().streamSimple(f.model, context, { signal: call.signal });
      await headers.promise;
      assert.throws(() => op.provider().streamSimple(f.model, context), { code: 'CODEX_RUNTIME_BUSY' });
      if (method === 'call-abort') call.abort(new Error(hidden));
      if (method === 'lease-abort') lease.abort(new Error(hidden));
      if (method === 'close') { op.close(); op.close(); }
      if (method === 'dispose') { f.runtime.dispose(); f.runtime.dispose(); }
      if (method === 'deadline') t.mock.timers.tick(1000);
      const result = await drain(stream);
      const code = `CODEX_RUNTIME_${method === 'deadline' ? 'TIMEOUT' : method === 'dispose' ? 'DISPOSED' : method === 'close' ? 'CLOSED' : 'CANCELLED'}`;
      assert.equal(result.errorMessage, code); assert.equal(result.stopReason, 'aborted');
      const trace = op.diagnostics();
      assert.equal(trace.phase, method === 'deadline' ? 'timed-out' : 'cancelled');
      assert.equal(trace.requests, 1); assert.equal(trace.httpStatus, 200);
      assert.equal(trace.completedMs, undefined); assertUnavailable(trace);
      if (method === 'deadline') { assert.equal(trace.timeoutKind, 'total'); assert.equal(trace.timeoutBudgetMs, 1000); }
      assert.equal(wireSignal.aborted, true); assert.equal(aborts, 1);
      assert.equal(f.bindings(), 1); assert.equal(f.requests(), 1);
      op.close(); f.runtime.dispose();
      assert.throws(() => op.provider(), { code });
      late.resolve(); await finished.promise;
      t.mock.timers.tick(2000);
      assert.deepEqual(op.diagnostics(), trace, 'late SDK completion and repeated close cannot change the receipt');
    } finally { late.resolve(); f.runtime.dispose(); }
  });
}

for (const outcome of ['completed', 'failed', 'cancelled']) {
  test(`pinned SDK over fake SSE reports ${outcome} at the public owner diagnostic seam`, async () => {
    const call = new AbortController();
    const f = fixture({ fetchImpl: async () => {
      const rows = outcome === 'failed' ? [{ type: 'error', error: { message: hidden } }]
        : outcome === 'completed' ? [...readerRows, completed] : readerRows.slice(0, 4);
      return new Response(outcome === 'cancelled'
        ? new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(sse(rows))); } })
        : sse(rows), { headers: { 'content-type': 'text/event-stream' } });
    } });
    try {
      const op = await f.runtime.open({ model: f.model.id, purpose: 'compaction' });
      const result = await drain(op.provider().streamSimple(f.model, context, { signal: call.signal }), event => {
        if (outcome === 'cancelled' && event.type === 'text_delta') call.abort(new Error(hidden));
      });
      if (outcome === 'completed') {
        assert.equal(result.content[0].text, hidden); assert.equal(result.stopReason, 'stop');
        assert.equal(result.usage.input, 8); assert.equal(result.usage.output, 3);
        assert.equal(result.usage.cacheRead, 4); assert.equal(result.usage.totalTokens, 15);
      } else assert.equal(result.errorMessage, `CODEX_RUNTIME_${outcome === 'cancelled' ? 'CANCELLED' : 'RESPONSE_STREAM'}`);
      op.close();
      const trace = op.diagnostics();
      assert.equal(trace.phase, outcome); assert.equal(trace.requests, 1); assert.equal(trace.httpStatus, 200);
      assert.equal(Number.isSafeInteger(trace.completedMs), outcome === 'completed');
      assertUnavailable(trace);
      assert.equal(f.bindings(), 1); assert.equal(f.requests(), 1);
    } finally { f.runtime.dispose(); }
  });
}

test('a reused SDK provider cannot attribute its previous completion to a failed preparation or pre-aborted call', async () => {
  const f = fixture({ sdk: successfulSdk });
  try {
    const op = await f.runtime.open({ model: f.model.id });
    const provider = op.provider();
    assert.equal((await drain(provider.streamSimple(f.model, context))).stopReason, 'stop');
    assert.ok(Number.isSafeInteger(op.diagnostics().completedMs));
    const invalidContext = { ...context, uncloneable: () => {} };
    assert.equal((await drain(provider.streamSimple(f.model, invalidContext))).errorMessage, 'CODEX_RUNTIME_REQUEST_PREPARE');
    assert.equal(op.diagnostics().phase, 'failed');
    assert.equal(op.diagnostics().completedMs, undefined, 'not the preceding successful call');
    assertUnavailable(op.diagnostics());
    const call = new AbortController(); call.abort(new Error(hidden));
    assert.equal((await drain(provider.streamSimple(f.model, context, { signal: call.signal }))).errorMessage, 'CODEX_RUNTIME_CANCELLED');
    assert.equal(op.diagnostics().phase, 'cancelled'); assert.equal(op.diagnostics().completedMs, undefined);
    assertUnavailable(op.diagnostics());
    assert.equal(f.bindings(), 1); assert.equal(f.requests(), 1);
  } finally { f.runtime.dispose(); }
});

test('native measured counters and usage survive stream/native mode reuse of one owner lease', async () => {
  const nativeSse = sse([
    { type: 'response.output_item.done', item: { type: 'compaction', encrypted_content: hidden } }, completed,
  ]);
  const f = fixture({ sdk: successfulSdk, fetchImpl: async () => new Response(nativeSse) });
  try {
    const op = await f.runtime.open({ model: f.model.id, purpose: 'compaction' });
    const binding = op.binding;
    for (const [index, mode] of ['compact', 'stream', 'compact'].entries()) {
      const result = await drain(op.provider({ mode }).streamSimple(f.model, context));
      assert.equal(result.stopReason, 'stop'); assert.equal(op.binding, binding);
      const trace = op.diagnostics();
      assert.equal(trace.phase, 'completed'); assert.equal(trace.requests, index + 1);
      if (mode === 'stream') { assertUnavailable(trace); assert.deepEqual(op.compactionUsage(), { kind: 'unavailable' }); }
      else {
        assert.equal(trace.responseBytes, Buffer.byteLength(nativeSse)); assert.equal(trace.chunks, 1);
        assert.equal(trace.events, 2); assert.equal(trace.lastEvent, 'completed');
        assert.deepEqual(trace.eventCounts, { 'compaction-item': 1, completed: 1 });
        assert.ok(trace.itemMs <= trace.completedMs);
        assert.deepEqual(op.compactionUsage(), { kind: 'observed', usage: { inputTokens: 8, outputTokens: 3, totalTokens: 15, cacheReadTokens: 4 } });
        trace.eventCounts.completed = 999; assert.equal(op.diagnostics().eventCounts.completed, 1);
      }
    }
    assert.equal(f.bindings(), 1); assert.equal(f.requests(), 3);
    op.close(); op.close();
    assert.equal(op.diagnostics().phase, 'completed'); assert.equal(op.diagnostics().events, 2);
  } finally { f.runtime.dispose(); }
});
