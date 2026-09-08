import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers/promises';
import { createCodexRuntime } from '../lib/capabilities/codex-native/runtime.js';
const account = 'synthetic-budget-account';
const apiKey = 'test.' + Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url') + '.FAKE';
const options = { configured: () => true, ready: true, resolveOAuth: async () => ({ apiKey, headers: { 'chatgpt-account-id': account } }), fetchImpl: async () => new Promise(() => {}), timeoutMs: 120000, compactionTimeoutMs: 300000 };
const context = { messages: [{ role: 'user', content: 'synthetic-budget-input', timestamp: 0 }] };
const drain = async stream => { for await (const event of stream) {} return stream.result(); };

test('ordinary leases remain 120s while explicit compaction leases get 300s', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const runtime = createCodexRuntime(options);
  try {
    const model = runtime.models()[0].id;
    const normal = await runtime.open({ model });
    const compact = await runtime.open({ model, purpose: 'compaction' });
    assert.equal(normal.diagnostics().budgetMs, 120000);
    assert.equal(compact.diagnostics().budgetMs, 300000);
    t.mock.timers.tick(120000);
    assert.throws(() => normal.provider(), { code: 'CODEX_RUNTIME_TIMEOUT' });
    assert.doesNotThrow(() => compact.provider({ mode: 'compact' }));
    t.mock.timers.tick(180000);
    assert.throws(() => compact.provider(), { code: 'CODEX_RUNTIME_TIMEOUT' });
  } finally { runtime.dispose(); }
});

test('starting another native request does not renew the original compaction deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requests = 0;
  const runtime = createCodexRuntime({ ...options, fetchImpl: async () => { if (++requests === 1) throw new TypeError('synthetic network failure'); return new Promise(() => {}); } });
  try {
    const model = runtime.models()[0], op = await runtime.open({ model: model.id, purpose: 'compaction' });
    assert.equal((await drain(op.provider({ mode: 'compact' }).streamSimple(model, context))).errorMessage, 'CODEX_RUNTIME_NETWORK');
    t.mock.timers.tick(290000);
    let result;
    const completion = drain(op.provider({ mode: 'compact' }).streamSimple(model, context)).then(value => { result = value; });
    await immediate(); assert.equal(requests, 2); assert.equal(result, undefined);
    t.mock.timers.tick(10000); await completion;
    assert.equal(result.errorMessage, 'CODEX_RUNTIME_TIMEOUT');
    assert.equal(op.diagnostics().requests, 2); assert.equal(op.diagnostics().budgetMs, 300000);
  } finally { runtime.dispose(); }
});

test('native budget is bounded and caller cannot choose arbitrary lease purpose', async () => {
  for (const compactionTimeoutMs of [0, -1, NaN, Infinity, 300001]) assert.throws(() => createCodexRuntime({ ...options, compactionTimeoutMs }), { code: 'CODEX_RUNTIME_CONFIG' });
  assert.throws(() => createCodexRuntime({ ...options, timeoutMs: 120001 }), { code: 'CODEX_RUNTIME_CONFIG' });
  const runtime = createCodexRuntime(options);
  try { await assert.rejects(runtime.open({ model: runtime.models()[0].id, purpose: 'unbounded' }), { code: 'CODEX_RUNTIME_PURPOSE' }); }
  finally { runtime.dispose(); }
});
