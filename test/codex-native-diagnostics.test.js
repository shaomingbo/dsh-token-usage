import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodexRuntime } from '../lib/capabilities/codex-native/runtime.js';
import { operationDiagnostics } from '../lib/capabilities/codex-native/diagnostics.js';
const account = 'fake-diagnostic-account';
const key = 'test.' + Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url') + '.FAKE';
const auth = () => ({ apiKey: key, headers: { 'chatgpt-account-id': account } });
const hidden = 'secret-prompt-or-event-type';
const context = { messages: [{ role: 'user', content: hidden, timestamp: 0 }] };
const read = async stream => { for await (const event of stream) {} return stream.result(); };
const secretFree = value => { const text = JSON.stringify(value); for (const secret of [key, account, hidden, 'fake-opaque-item']) assert.ok(!text.includes(secret)); };

test('diagnostics separate metadata, binding, headers, empty body and idle SSE timeouts', async () => {
  for (const phase of ['model-metadata', 'account-binding', 'waiting-headers', 'waiting-body', 'reading-sse']) {
    const runtime = createCodexRuntime({ timeoutMs: 30, ready: true, configured: () => true,
      resolveModelFacts: phase === 'model-metadata' ? () => new Promise(() => {}) : undefined,
      resolveOAuth: async () => phase === 'account-binding' ? new Promise(() => {}) : auth(),
      fetchImpl: async () => phase === 'waiting-headers' ? new Promise(() => {})
        : new Response(new ReadableStream({ start(c) { if (phase !== 'waiting-body') c.enqueue(new TextEncoder().encode(': heartbeat\n\n')); } })),
    });
    try {
      const model = runtime.models()[0]; let trace;
      try {
        const op = await runtime.open({ model: model.id });
        const result = await read(op.provider({ mode: 'compact' }).streamSimple(model, context));
        assert.equal(result.errorMessage, 'CODEX_RUNTIME_TIMEOUT'); trace = op.diagnostics();
      } catch (error) { assert.equal(error.code, 'CODEX_RUNTIME_TIMEOUT'); trace = error.diagnostics; }
      assert.equal(trace?.phase, phase); secretFree(trace);
      assert.equal(trace.requests, ['model-metadata', 'account-binding'].includes(phase) ? 0 : 1);
      if (phase === 'reading-sse') { assert.equal(trace.httpStatus, 200); assert.ok(trace.responseBytes > 0); assert.equal(trace.events, 0); }
    } finally { runtime.dispose(); }
  }
});

test('native completion diagnostics contain only safe timing/count metadata', async () => {
  const rows = [{ type: hidden },
    { type: 'response.output_item.added', item: { type: 'reasoning', id: hidden } },
    { type: 'response.reasoning_summary_text.delta', delta: hidden },
    { type: 'response.output_item.done', item: { type: 'reasoning', encrypted_content: 'fake-opaque-item' } },
    { type: 'response.output_item.added', item: { type: 'compaction' } },
    { type: 'response.output_item.done', item: { type: 'compaction', encrypted_content: 'fake-opaque-item' } },
    { type: 'response.completed', response: { status: 'completed' } }];
  const runtime = createCodexRuntime({ timeoutMs: 1000, ready: true, configured: () => true, resolveOAuth: async () => auth(),
    fetchImpl: async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(rows.map(row => `data: ${JSON.stringify(row)}\n\n`).join(''))); } })),
  });
  try {
    const model = runtime.models()[0], op = await runtime.open({ model: model.id });
    assert.equal((await read(op.provider({ mode: 'compact' }).streamSimple(model, context))).stopReason, 'stop');
    op.close();
    const trace = op.diagnostics();
    assert.equal(trace.phase, 'completed'); assert.equal(trace.requests, 1);
    assert.equal(trace.httpStatus, 200); assert.equal(trace.events, 7); assert.ok(trace.requestBytes > 0);
    assert.deepEqual(trace.eventCounts, { other: 1, 'reasoning-added': 1, 'reasoning-summary-delta': 1, 'reasoning-done': 1, 'compaction-added': 1, 'compaction-item': 1, completed: 1 });
    trace.eventCounts.other = 999; assert.equal(op.diagnostics().eventCounts.other, 1);
    assert.ok(trace.boundMs <= trace.requestMs && trace.requestMs <= trace.headersMs && trace.itemMs <= trace.completedMs);
    secretFree(trace); trace.phase = hidden; assert.equal(op.diagnostics().phase, 'completed');
  } finally { runtime.dispose(); }
});

test('diagnostic enums are fixed and stop freezes late events and elapsed time', () => {
  let ms = 0; const trace = operationDiagnostics(() => ms);
  trace.observe('event', hidden); assert.equal(trace.snapshot().lastEvent, 'other');
  trace.observe(hidden, hidden); secretFree(trace.snapshot());
  ms = 10; trace.stop(); const before = trace.snapshot();
  ms = 1000; trace.observe('completed'); assert.deepEqual(trace.snapshot(), before);
});
