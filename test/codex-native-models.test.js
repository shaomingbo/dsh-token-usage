import test from 'node:test';
import assert from 'node:assert/strict';
import { zstdDecompressSync } from 'node:zlib';
import { createCodexRuntime } from '../lib/capabilities/codex-native/runtime.js';

const ACCOUNT = 'fake-owner-account-ONLY-TEST';
const token = () => 'eyJhbGciOiJub25lIn0.' + Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: ACCOUNT } })).toString('base64url') + '.FAKE';
const KEY = token();
const ASTRA_FACTS = { id: 'gpt-6-astra', contextWindow: 872000, maxTokens: 128000, input: ['text', 'image'],
  reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } };
const compactEvents = () => [
  { type: 'response.output_item.done', item: { type: 'compaction', encrypted_content: 'fake-opaque-native' } },
  { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 9, output_tokens: 2, total_tokens: 11 } } },
];
const normalEvents = () => [
  { type: 'response.created', response: { id: 'resp_test', status: 'in_progress' } },
  { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_test', role: 'assistant', content: [], status: 'in_progress' } },
  { type: 'response.content_part.added', item_id: 'msg_test', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
  { type: 'response.output_text.delta', item_id: 'msg_test', output_index: 0, content_index: 0, delta: 'hello' },
  { type: 'response.output_text.done', item_id: 'msg_test', output_index: 0, content_index: 0, text: 'hello' },
  { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_test', role: 'assistant', content: [{ type: 'output_text', text: 'hello', annotations: [] }], status: 'completed' } },
  { type: 'response.completed', response: { id: 'resp_test', status: 'completed' } },
];
const sse = events => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
const context = text => ({ messages: [{ role: 'user', content: text, timestamp: 1 }] });
async function collect(stream) { const events = []; for await (const event of stream) events.push(event); return { events, message: await stream.result() }; }

function fixture({ facts = async id => (id === 'gpt-6-astra' ? structuredClone(ASTRA_FACTS) : undefined), routeStatus, timeoutMs = 30_000 } = {}) {
  const calls = []; let resolves = 0;
  const runtime = createCodexRuntime({
    ready: () => true,
    configured: provider => provider === 'openai-codex',
    resolveOAuth: async () => { resolves++; return { apiKey: KEY, headers: { 'chatgpt-account-id': ACCOUNT } }; },
    fetchImpl: async (url, init) => {
      const body = JSON.parse(typeof init.body === 'string' ? init.body : zstdDecompressSync(init.body).toString());
      calls.push({ url, init, body });
      return sse(body.input.some(item => item.type === 'compaction_trigger') ? compactEvents() : normalEvents());
    },
    timeoutMs,
    resolveModelFacts: facts,
    ...(routeStatus === undefined ? {} : { routeStatus }),
  });
  return { runtime, calls, resolves: () => resolves };
}

test('trusted resolver materializes a custom model bound to the official endpoint', async () => {
  const f = fixture();
  try {
    const handle = await f.runtime.open({ model: 'gpt-6-astra' });
    assert.equal(handle.binding.model, 'gpt-6-astra');
    const provider = handle.provider({ mode: 'stream' });
    const bound = provider.getModels();
    assert.equal(bound.length, 1);
    assert.equal(bound[0].id, 'gpt-6-astra');
    assert.equal(bound[0].contextWindow, 872000);
    assert.equal(bound[0].maxTokens, 128000);
    assert.deepEqual(bound[0].input, ['text', 'image']);
    assert.equal(bound[0].baseUrl, 'https://chatgpt.com/backend-api');
    assert.equal(bound[0].api, 'openai-codex-responses', 'wire protocol comes from the pinned template');
    assert.equal('headers' in bound[0], false);
    const normal = await collect(provider.streamSimple(bound[0], context('hello'), { reasoning: 'max' }));
    assert.equal(normal.message.content[0].text, 'hello');
    assert.equal(f.calls[0].url, 'https://chatgpt.com/backend-api/codex/responses');
    const compact = await collect(handle.provider({ mode: 'compact' }).streamSimple(bound[0], context('hello'), {}));
    const record = f.runtime.decodeCheckpoint(compact.message.content[0].text, handle.binding);
    assert.equal(record.model, 'gpt-6-astra');
    assert.deepEqual(handle.compactionUsage().usage, { inputTokens: 9, outputTokens: 2, totalTokens: 11 });
  } finally { f.runtime.dispose(); }
});

test('explicit profile facts merge over a pinned catalog entry without losing pinned fields', async () => {
  const f = fixture({ facts: async id => (id === 'gpt-5.6-sol'
    ? { id, maxTokens: 64000, reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } }
    : undefined) });
  try {
    const handle = await f.runtime.open({ model: 'gpt-5.6-sol' });
    const bound = handle.provider({ mode: 'stream' }).getModels()[0];
    assert.equal(bound.contextWindow, 272000, 'unset facts keep the pinned capacity');
    assert.equal(bound.maxTokens, 64000, 'explicit profile output wins');
    assert.deepEqual(bound.input, ['text', 'image'], 'pinned modalities survive the merge');
    assert.deepEqual(Object.keys(bound.thinkingLevelMap), ['low', 'medium', 'high']);
    assert.equal(bound.api, 'openai-codex-responses');
  } finally { f.runtime.dispose(); }
});

test('missing custom-model facts report the concrete gap and never invent values', async () => {
  for (const [facts, field] of [
    [async () => ({ id: 'gpt-6-astra', maxTokens: 128000 }), 'contextWindow'],
    [async () => ({ id: 'gpt-6-astra', contextWindow: 872000 }), 'maxTokens'],
  ]) {
    const f = fixture({ facts });
    try {
      await assert.rejects(f.runtime.open({ model: 'gpt-6-astra' }), error => error.code === 'CODEX_RUNTIME_MODEL_METADATA' && error.message.includes(field));
    } finally { f.runtime.dispose(); }
  }
});

test('mapped gap vocabulary surfaces verbatim; unmapped gaps and resolver crashes stay generic', async () => {
  const conflict = fixture({ facts: async () => ({ gap: 'METADATA_CONFLICT' }) });
  await assert.rejects(conflict.runtime.open({ model: 'gpt-6-astra' }), error => error.message.includes('METADATA_CONFLICT'));
  conflict.runtime.dispose();
  const unmapped = fixture({ facts: async () => ({ gap: 'SECRET_INTERNAL_DETAIL' }) });
  await assert.rejects(unmapped.runtime.open({ model: 'gpt-6-astra' }), error => error.code === 'CODEX_RUNTIME_MODEL_METADATA' && !error.message.includes('SECRET_INTERNAL_DETAIL'));
  unmapped.runtime.dispose();
  const crashed = fixture({ facts: async () => { throw new Error('boomed with PRIVATE-TOKEN-XYZ'); } });
  await assert.rejects(crashed.runtime.open({ model: 'gpt-6-astra' }), error => error.code === 'CODEX_RUNTIME_MODEL_METADATA' && !error.message.includes('PRIVATE-TOKEN-XYZ'));
  crashed.runtime.dispose();
});

test('model resolution runs under the operation deadline and caller cancellation', async () => {
  const hanging = fixture({ facts: () => new Promise(() => {}), timeoutMs: 40 });
  const started = Date.now();
  await assert.rejects(hanging.runtime.open({ model: 'gpt-6-astra' }), error => error.code === 'CODEX_RUNTIME_TIMEOUT');
  assert.ok(Date.now() - started < 5_000, 'deadline bounds the metadata lookup');
  hanging.runtime.dispose();
  const cancelled = fixture();
  try {
    await assert.rejects(cancelled.runtime.open({ model: 'gpt-6-astra', signal: AbortSignal.abort() }),
      error => error.code === 'CODEX_RUNTIME_MODEL_METADATA' || error.code === 'CODEX_RUNTIME_CANCELLED');
  } finally { cancelled.runtime.dispose(); }
});

test('applicability answers without authentication and reports fixed route reasons', async () => {
  const f = fixture({ routeStatus: () => ({ ok: true }) });
  try {
    assert.deepEqual((await f.runtime.applicability({ provider: 'other', model: 'gpt-6-astra' })).reason, 'PROVIDER');
    const ready = await f.runtime.applicability({ provider: 'openai-codex', model: 'gpt-6-astra' });
    assert.equal(ready.applicable, true);
    assert.deepEqual(ready.model, { id: 'gpt-6-astra', contextWindow: 872000, maxTokens: 128000, input: ['text', 'image'] });
    assert.equal(f.resolves(), 0, 'no authentication resolved for the verdict');
    assert.equal(f.calls.length, 0, 'no network performed for the verdict');
    assert.equal((await f.runtime.applicability({ provider: 'openai-codex', model: 'gpt-nope' })).reason, 'UNKNOWN_MODEL');
    const conflicted = fixture({ facts: async () => ({ gap: 'METADATA_CONFLICT' }), routeStatus: () => ({ ok: true }) });
    assert.equal((await conflicted.runtime.applicability({ provider: 'openai-codex', model: 'gpt-6-astra' })).reason, 'MODEL_METADATA');
    conflicted.runtime.dispose();
    for (const reason of ['ROUTE_AUTH', 'ROUTE_ENDPOINT', 'ROUTE_PROTOCOL', 'ROUTE_MISSING']) {
      const routed = fixture({ routeStatus: () => ({ ok: false, reason }) });
      assert.equal((await routed.runtime.applicability({ provider: 'openai-codex', model: 'gpt-5.6-sol' })).reason, reason);
      routed.runtime.dispose();
    }
    const offline = fixture({ routeStatus: () => ({ ok: true }) });
    offline.runtime.dispose();
    const dead = fixture({ routeStatus: () => ({ ok: true }) });
    try {
      dead.runtime.dispose();
      assert.equal((await dead.runtime.applicability({ provider: 'openai-codex', model: 'gpt-5.6-sol' })).reason, 'NOT_CONFIGURED');
    } finally { dead.runtime.dispose(); }
  } finally { f.runtime.dispose(); }
});

test('reasoning level max is accepted on the native stream path', async () => {
  const f = fixture();
  try {
    const handle = await f.runtime.open({ model: 'gpt-6-astra' });
    const provider = handle.provider({ mode: 'stream' });
    const bound = provider.getModels()[0];
    const result = await collect(provider.streamSimple(bound, context('hello'), { reasoning: 'max' }));
    assert.equal(result.message.stopReason, 'stop');
    const body = f.calls[0].body;
    assert.equal(body.reasoning?.effort === 'max' || body.reasoning === 'max' || JSON.stringify(body).includes('max'), true, 'effort reaches the wire');
  } finally { f.runtime.dispose(); }
});

test('a hanging metadata resolver cannot stall applicability past abort, deadline or dispose', async () => {
  // R0-3 regression: the metadata-only applicability scope must be bounded by
  // caller cancellation, the runtime deadline and dispose — and must never
  // resolve authentication or touch the network.
  let auth = 0;
  const hanging = () => createCodexRuntime({ timeoutMs: 10, configured: () => true,
    resolveOAuth: () => { auth++; throw Error('must not resolve auth'); },
    resolveModelFacts: () => new Promise(() => {}), routeStatus: () => ({ ok: true }) });

  const cancelled = hanging();
  const cancellation = new AbortController();
  const call = cancelled.applicability({ provider: 'openai-codex', model: 'gpt-6-astra', signal: cancellation.signal })
    .then(() => 'settled', () => 'rejected');
  cancellation.abort();
  const raced = await Promise.race([call, new Promise(resolve => setTimeout(() => resolve('still-pending-after-cancel'), 50))]);
  cancelled.dispose();
  assert.notEqual(raced, 'still-pending-after-cancel', 'caller abort must interrupt a hanging metadata lookup');
  assert.equal(auth, 0);

  const slow = hanging();
  const timed = await Promise.race([
    slow.applicability({ provider: 'openai-codex', model: 'gpt-6-astra' }),
    new Promise(resolve => setTimeout(() => resolve('still-pending-after-deadline'), 50)),
  ]);
  slow.dispose();
  assert.deepEqual(timed, { applicable: false, reason: 'MODEL_METADATA' }, 'the runtime deadline bounds the metadata lookup');
  assert.equal(auth, 0);

  const disposable = hanging();
  const pending = disposable.applicability({ provider: 'openai-codex', model: 'gpt-6-astra' })
    .then(() => 'settled', () => 'rejected');
  disposable.dispose();
  assert.notEqual(
    await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('still-pending-after-dispose'), 50))]),
    'still-pending-after-dispose', 'dispose must interrupt a pending metadata scope',
  );
  assert.equal(auth, 0);
});
