import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers/promises';
import { createCodexRuntime } from '../lib/capabilities/codex-native/runtime.js';

const account = 'deadline-fixture-account';
const apiKey = 'fixture.' + Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url') + '.FAKE';
const options = { configured: () => true, resolveOAuth: async () => ({ apiKey }),
  timeoutMs: 1800000, setupTimeoutMs: 120000, compactionTimeoutMs: 300000,
  fetchImpl: async () => new Promise(() => {}) };
const context = { messages: [{ role: 'user', content: 'synthetic', timestamp: 0 }] };
const drain = async stream => { for await (const event of stream) {} return stream.result(); };

function streamFixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let controller, signal, cancelled = 0;
  const runtime = createCodexRuntime({ ...options, fetchImpl: async (_url, init) => {
    signal = init.signal;
    return new Response(new ReadableStream({ start(c) { controller = c; }, cancel() { cancelled++; } }),
      { headers: { 'content-type': 'text/event-stream' } });
  } });
  t.after(() => runtime.dispose());
  return { runtime, send(event) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)); },
    get signal() { return signal; }, get cancelled() { return cancelled; } };
}
const start = send => {
  send({ type: 'response.created', response: { id: 'resp_fixture', status: 'in_progress' } });
  send({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_fixture', role: 'assistant', content: [], status: 'in_progress' } });
  send({ type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
};
const delta = text => ({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text });
const finish = send => {
  send({ type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_fixture', role: 'assistant', content: [{ type: 'output_text', text: 'ab', annotations: [] }], status: 'completed' } });
  send({ type: 'response.completed', response: { id: 'resp_fixture', status: 'completed', usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } });
};

test('production-sized owner budget lets pinned SDK output complete after 120 seconds', async t => {
  const f = streamFixture(t), model = f.runtime.models()[0];
  const op = await f.runtime.open({ model: model.id });
  const completion = drain(op.provider().streamSimple(model, context));
  await immediate(); start(f.send); f.send(delta('a')); await immediate();
  t.mock.timers.tick(120001); await immediate();
  assert.equal(f.signal.aborted, false, 'ongoing output must not hit the former 120s total cap');
  f.send(delta('b')); finish(f.send);
  const result = await completion;
  assert.equal(result.stopReason, 'stop');
  assert.equal(result.content[0].text, 'ab');
  assert.equal(op.diagnostics().budgetMs, 1800000);
  op.close(); await immediate();
  assert.equal(f.cancelled, 1);
});

test('ordinary total deadline remains absolute despite output and binds timeout diagnostics', async t => {
  const f = streamFixture(t), model = f.runtime.models()[0];
  const op = await f.runtime.open({ model: model.id });
  const completion = drain(op.provider().streamSimple(model, context));
  await immediate(); start(f.send);
  for (let i = 0; i < 5; i++) { f.send(delta('x')); await immediate(); t.mock.timers.tick(300000); await immediate(); }
  assert.equal(f.signal.aborted, false);
  t.mock.timers.tick(300000);
  const result = await completion;
  assert.equal(result.errorMessage, 'CODEX_RUNTIME_TIMEOUT');
  assert.equal(op.diagnostics().timeoutKind, 'total');
  assert.equal(op.diagnostics().timeoutBudgetMs, 1800000);
  assert.equal(f.signal.aborted, true);
  op.close(); f.runtime.dispose();
  assert.throws(() => op.provider(), { code: 'CODEX_RUNTIME_TIMEOUT' });
});

for (const phase of ['model', 'ready', 'configured', 'auth']) {
  test(`ordinary ${phase} preparation cannot consume the larger generation budget`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const never = () => new Promise(() => {});
    const override = phase === 'model' ? { resolveModelFacts: never } : phase === 'ready' ? { ready: never }
      : phase === 'configured' ? { configured: never } : { resolveOAuth: never };
    const runtime = createCodexRuntime({ ...options, ...override });
    t.after(() => runtime.dispose());
    const pending = assert.rejects(runtime.open({ model: runtime.models()[0].id }), error => {
      assert.equal(error.code, 'CODEX_RUNTIME_TIMEOUT');
      assert.equal(error.diagnostics.timeoutKind, 'setup');
      assert.equal(error.diagnostics.setupBudgetMs, 120000);
      assert.equal(error.diagnostics.totalBudgetMs, 1800000);
      return true;
    });
    await immediate(); t.mock.timers.tick(120000); await pending;
  });
}

test('setup budget ends after binding, but setup time is not refunded to total deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release;
  const runtime = createCodexRuntime({ ...options, resolveOAuth: () => new Promise(resolve => { release = resolve; }) });
  t.after(() => runtime.dispose());
  const pending = runtime.open({ model: runtime.models()[0].id });
  await immediate(); t.mock.timers.tick(100000); release({ apiKey });
  const op = await pending;
  t.mock.timers.tick(20001); assert.doesNotThrow(() => op.provider());
  t.mock.timers.tick(1679999); assert.throws(() => op.provider(), { code: 'CODEX_RUNTIME_TIMEOUT' });
  assert.equal(op.diagnostics().timeoutKind, 'total');
});

test('compaction purpose keeps its existing total budget even when binding exceeds ordinary setup budget', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release;
  const runtime = createCodexRuntime({ ...options, resolveOAuth: () => new Promise(resolve => { release = resolve; }) });
  t.after(() => runtime.dispose());
  const pending = runtime.open({ model: runtime.models()[0].id, purpose: 'compaction' });
  await immediate(); t.mock.timers.tick(120001); release({ apiKey });
  const op = await pending;
  assert.equal(op.diagnostics().budgetMs, 300000);
  assert.equal(op.diagnostics().setupBudgetMs, undefined);
  t.mock.timers.tick(179999);
  assert.throws(() => op.provider(), { code: 'CODEX_RUNTIME_TIMEOUT' });
});

test('larger generation budget does not implicitly enlarge compact defaults; limits remain finite', () => {
  const { compactionTimeoutMs, ...ordinary } = options;
  const runtime = createCodexRuntime(ordinary); runtime.dispose();
  for (const timeoutMs of [0, -1, NaN, Infinity, 1800001])
    assert.throws(() => createCodexRuntime({ ...options, timeoutMs }), { code: 'CODEX_RUNTIME_CONFIG' });
  for (const setupTimeoutMs of [0, -1, NaN, Infinity, 120001])
    assert.throws(() => createCodexRuntime({ ...options, setupTimeoutMs }), { code: 'CODEX_RUNTIME_CONFIG' });
});
