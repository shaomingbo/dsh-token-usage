import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { zstdDecompressSync } from 'node:zlib';
import { createModels, createAssistantMessageEventStream } from 'pi-ai-codex-native';
import { createCodexRuntime } from '../lib/capabilities/codex-native/runtime.js';

const ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
const ACCOUNT = 'fake-owner-account-ONLY-TEST';
const token = (account = ACCOUNT) => 'eyJhbGciOiJub25lIn0.' + Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url') + '.FAKE';
const KEY = token();
const UA = 'deepseek-harness/0.1.2-rc.1 (+https://github.com/deepseek-ai/deepseek-harness)';
const context = text => ({ messages: [{ role: 'user', content: text, timestamp: 1 }] });
const compactEvents = (usage) => [
  { type: 'response.output_item.done', item: { type: 'compaction', encrypted_content: 'fake-opaque-native', future: { intact: [1, 'x'] } } },
  { type: 'response.completed', response: { status: 'completed', ...(usage ? { usage } : {}) } },
];
const normalEvents = () => [
  { type: 'response.created', response: { id: 'resp_test', status: 'in_progress' } },
  { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_test', role: 'assistant', content: [], status: 'in_progress' } },
  { type: 'response.content_part.added', item_id: 'msg_test', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
  { type: 'response.output_text.delta', item_id: 'msg_test', output_index: 0, content_index: 0, delta: 'hello' },
  { type: 'response.output_text.done', item_id: 'msg_test', output_index: 0, content_index: 0, text: 'hello' },
  { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_test', role: 'assistant', content: [{ type: 'output_text', text: 'hello', annotations: [] }], status: 'completed' } },
  { type: 'response.completed', response: { id: 'resp_test', status: 'completed', usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15, input_tokens_details: { cached_tokens: 4 } } } },
];
function sse(events) { return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }); }
function fixture(options = {}) {
  const calls = []; let resolves = 0;
  const runtime = createCodexRuntime({ ready: () => true, configured: provider => provider === 'openai-codex',
    resolveOAuth: async provider => { assert.equal(provider, 'openai-codex'); resolves++; return { apiKey: KEY, headers: { 'chatgpt-account-id': ACCOUNT }, baseURL: 'https://evil.invalid' }; },
    fetchImpl: async (url, init) => {
      const body = JSON.parse(typeof init.body === 'string' ? init.body : zstdDecompressSync(init.body).toString());
      calls.push({ url, init, body });
      return sse(body.input.some(item => item.type === 'compaction_trigger') ? compactEvents() : normalEvents());
    }, ...options });
  return { runtime, calls, resolves: () => resolves, model: runtime.models()[0] };
}
async function collect(stream) { const events = []; for await (const event of stream) events.push(event); return { events, message: await stream.result() }; }
function secretFree(value) { const text = JSON.stringify(value); assert.ok(!text.includes(KEY)); assert.ok(!text.includes(ACCOUNT)); assert.ok(!/apiKey|accessToken|accountId|rawheaders|grant/.test(text)); }

test('secret-free metadata, detached pinned capacities, same bound connection via public Models', async () => {
  const f = fixture(); const { runtime, model } = f;
  try {
    assert.equal(runtime.protocol, 'codex-runtime/v1');
    assert.equal(runtime.describe().configured, true);
    assert.equal(f.resolves(), 0); assert.equal(f.calls.length, 0);
    assert.ok(model.contextWindow > 0); assert.ok(model.maxTokens > 0);
    model.baseUrl = 'https://evil.invalid'; model.cost.input = 1e20;
    assert.notEqual(runtime.models()[0].cost.input, 1e20);
    const handle = await runtime.open({ model });
    secretFree(handle); secretFree(runtime.describe()); secretFree(runtime.models());
    assert.ok(Object.isFrozen(handle.binding));
    assert.equal(handle.binding.identity, createHash('sha256').update('dsh-codex-compaction/identity/v1\0' + ACCOUNT).digest('hex'));
    const pi = createModels({ authContext: { env: async () => undefined, fileExists: async () => false }, credentials: { read: async () => undefined, list: async () => [], modify: async () => assert.fail('credential mutation'), delete: async () => assert.fail('credential deletion') } });
    const provider = handle.provider({ mode: 'stream' });
    assert.deepEqual(await provider.auth.apiKey.resolve({}), { auth: {} });
    pi.setProvider(provider);
    const nativeModel = provider.getModels()[0];
    const resolvedPublicAuth = await pi.getAuth(nativeModel);
    assert.deepEqual(resolvedPublicAuth.auth, {}); secretFree(resolvedPublicAuth);
    const normal = await collect(pi.streamSimple(nativeModel, context('hello'), { headers: { 'user-agent': UA } }));
    assert.equal(normal.message.stopReason, 'stop'); assert.equal(normal.message.content[0].text, 'hello');
    assert.equal(normal.message.responseId, 'resp_test');
    assert.equal(normal.message.usage.input, 8); assert.equal(normal.message.usage.cacheRead, 4);
    const compact = await collect(handle.provider({ mode: 'compact' }).streamSimple(nativeModel, context('hello'), { headers: { 'user-agent': UA } }));
    assert.equal(compact.message.stopReason, 'stop'); assert.equal(compact.message.usageAvailability, 'unavailable');
    const record = runtime.decodeCheckpoint(compact.message.content[0].text, handle.binding);
    assert.deepEqual(record.items.at(-1).future, { intact: [1, 'x'] });
    assert.equal(f.resolves(), 1); assert.equal(f.calls.length, 2);
    for (const call of f.calls) {
      assert.equal(call.url, ENDPOINT); assert.equal(call.init.redirect, 'error');
      assert.equal(call.init.headers.get('authorization'), `Bearer ${KEY}`);
      assert.equal(call.init.headers.get('chatgpt-account-id'), ACCOUNT);
      assert.equal(call.init.headers.get('user-agent'), UA);
      assert.equal(call.body.stream, true);
    }
    secretFree(normal.events); secretFree(compact.events);
  } finally { runtime.dispose(); }
});

test('malicious caller models/auth/fetch/hooks cannot access or redirect credentials', async () => {
  const f = fixture();
  try {
    const handle = await f.runtime.open({ model: { id: f.model.id, baseURL: 'https://evil.invalid', baseUrl: 'https://evil.invalid', headers: { authorization: 'caller' } }, fetch: () => assert.fail('open fetch') });
    for (const mode of ['stream', 'compact']) {
      const provider = handle.provider({ mode, fetch: () => assert.fail('provider fetch') });
      const result = await collect(provider.streamSimple({ id: 'evil', provider: 'evil', baseUrl: 'https://evil.invalid' }, context('test'), {
        apiKey: 'caller-secret', baseURL: 'https://evil.invalid', fetch: () => assert.fail('consumer fetch'),
        onResponse: () => assert.fail('consumer response'), onPayload: () => assert.fail('consumer payload'),
        headers: { authorization: 'caller', cookie: 'caller-cookie', 'chatgpt-account-id': 'caller', 'user-agent': 'evil-agent' }, transport: 'websocket', maxRetries: 4,
      }));
      assert.equal(result.message.stopReason, 'stop');
    }
    assert.equal(f.calls.length, 2);
    for (const call of f.calls) { assert.equal(call.body.model, f.model.id); assert.equal(call.init.headers.get('cookie'), null); assert.notEqual(call.init.headers.get('user-agent'), 'evil-agent'); }
    await assert.rejects(f.runtime.open({ model: 'unknown' }), { code: 'CODEX_RUNTIME_UNKNOWN_MODEL' });
    assert.equal(f.resolves(), 1);
  } finally { f.runtime.dispose(); }
});

test('account mismatch fails before I/O; auth failures never reflect secret causes', async () => {
  for (const resolver of [async () => ({ apiKey: KEY, headers: { 'CHATGPT-ACCOUNT-ID': 'other' } }), async () => { throw Object.assign(new Error(KEY), { cause: ACCOUNT, headers: { cookie: 'private-cookie' } }); }]) {
    const f = fixture({ resolveOAuth: resolver });
    try { await assert.rejects(f.runtime.open({ model: f.model.id }), error => { secretFree(error); assert.ok(!error.message.includes(KEY)); assert.equal(error.cause, undefined); return true; }); assert.equal(f.calls.length, 0); }
    finally { f.runtime.dispose(); }
  }
});

test('ready/configured gating never starts login; pending readiness honors deadline', async () => {
  for (const opts of [{ ready: false }, { configured: () => false }, { ready: () => new Promise(() => {}), timeoutMs: 10 }]) {
    const f = fixture(opts);
    try { await assert.rejects(f.runtime.open({ model: f.model.id })); assert.equal(f.resolves(), 0); assert.equal(f.calls.length, 0); }
    finally { f.runtime.dispose(); }
  }
  let ready = false; const f = fixture({ ready: () => ready });
  try { await assert.rejects(f.runtime.open({ model: f.model.id }), { code: 'CODEX_RUNTIME_NOT_READY' }); ready = true; (await f.runtime.open({ model: f.model.id })).close(); assert.equal(f.resolves(), 1); }
  finally { f.runtime.dispose(); }
});

test('close, dispose, caller abort and operation deadline cancel uncooperative I/O', async () => {
  for (const mode of ['stream', 'compact']) for (const method of ['close', 'dispose', 'abort', 'timeout']) {
    let started; const began = new Promise(resolve => { started = resolve; }); let wireSignal;
    const f = fixture({ timeoutMs: method === 'timeout' ? 20 : 1000,
      fetchImpl: async (_url, init) => { wireSignal = init.signal; started(); return new Promise(() => {}); } });
    try {
      const controller = new AbortController();
      const handle = await f.runtime.open({ model: f.model.id });
      const stream = handle.provider({ mode }).streamSimple(f.model, context('hello'), { signal: controller.signal });
      await began;
      if (method === 'close') { handle.close(); handle.close(); }
      if (method === 'dispose') { f.runtime.dispose(); f.runtime.dispose(); }
      if (method === 'abort') controller.abort(new Error(KEY));
      const result = await collect(stream);
      assert.equal(result.message.stopReason, 'aborted'); assert.equal(wireSignal.aborted, true); secretFree(result.events);
      const code = `CODEX_RUNTIME_${method === 'timeout' ? 'TIMEOUT' : method === 'dispose' ? 'DISPOSED' : method === 'close' ? 'CLOSED' : 'CANCELLED'}`;
      assert.equal(result.message.errorMessage, code);
      assert.throws(() => handle.provider({ mode }), { code });
      if (method === 'dispose') await assert.rejects(f.runtime.open({ model: f.model.id }), { code: 'CODEX_RUNTIME_DISPOSED' });
    } finally { f.runtime.dispose(); }
  }
});

test('closed handles cannot mint or execute providers and dispose blocks later opens', async () => {
  const f = fixture();
  try {
    const handle = await f.runtime.open({ model: f.model.id });
    const provider = handle.provider(); handle.close(); handle.close();
    assert.throws(() => handle.provider(), { code: 'CODEX_RUNTIME_CLOSED' });
    await assert.rejects(provider.auth.apiKey.resolve(), { code: 'CODEX_RUNTIME_CLOSED' });
    const result = await collect(provider.streamSimple(f.model, context('hello')));
    assert.equal(result.message.stopReason, 'aborted'); assert.equal(f.calls.length, 0);
    f.runtime.dispose(); assert.equal(f.runtime.describe().configured, false);
    await assert.rejects(f.runtime.open({ model: f.model.id }), { code: 'CODEX_RUNTIME_DISPOSED' });
  } finally { f.runtime.dispose(); }
});

test('handle stop reason survives provider/auth reuse and cannot be revived', async () => {
  for (const method of ['timeout', 'abort', 'close', 'dispose', 'call-abort']) {
    const f = fixture({ timeoutMs: method === 'timeout' ? 20 : 1000 });
    const controller = new AbortController();
    try {
      const handle = await f.runtime.open({ model: f.model.id, signal: controller.signal });
      const provider = handle.provider({ mode: 'compact' });
      if (method === 'timeout') await new Promise(resolve => setTimeout(resolve, 40));
      if (method === 'abort') controller.abort(new Error(KEY));
      if (method === 'close') handle.close();
      if (method === 'dispose') f.runtime.dispose();
      if (method === 'call-abort') {
        const call = new AbortController(); call.abort(new Error(KEY));
        assert.equal((await collect(provider.streamSimple(f.model, context('hello'), { signal: call.signal }))).message.errorMessage, 'CODEX_RUNTIME_CANCELLED');
      }
      const code = `CODEX_RUNTIME_${method === 'timeout' ? 'TIMEOUT' : method === 'dispose' ? 'DISPOSED' : method === 'close' ? 'CLOSED' : 'CANCELLED'}`;
      assert.throws(() => handle.provider(), { code });
      await assert.rejects(provider.auth.apiKey.resolve(), { code });
      assert.equal((await collect(provider.streamSimple(f.model, context('hello')))).message.errorMessage, code);
      handle.close(); f.runtime.dispose();
      assert.throws(() => handle.provider(), { code }, 'first stop reason is stable');
      assert.equal(f.calls.length, 0); assert.equal(f.resolves(), 1);
    } finally { f.runtime.dispose(); }
  }
});

test('abort before open and while auth resolves does not create a bound operation', async () => {
  const controller = new AbortController(); controller.abort(); const f = fixture();
  try { await assert.rejects(f.runtime.open({ model: f.model.id, signal: controller.signal })); assert.equal(f.resolves(), 0); }
  finally { f.runtime.dispose(); }
  const pending = fixture({ resolveOAuth: () => new Promise(() => {}), timeoutMs: 10 });
  try { await assert.rejects(pending.runtime.open({ model: pending.model.id }), { code: 'CODEX_RUNTIME_TIMEOUT' }); }
  finally { pending.runtime.dispose(); }
});

test('native replay exact placeholders, text codec, binding and estimate are owner-pure', async () => {
  const f = fixture();
  try {
    const handle = await f.runtime.open({ model: f.model.id });
    const record = { version: 1, protocol: 'responses.compaction-trigger.v2', ...handle.binding,
      items: [{ type: 'compaction', encrypted_content: 'prior-opaque', unknown: ['preserved'] }] };
    const text = f.runtime.encodeCheckpoint(record);
    assert.deepEqual(f.runtime.decodeCheckpoint(text), record);
    const detached = f.runtime.validateCheckpoint(record, handle.binding); detached.items[0].encrypted_content = 'changed';
    assert.equal(record.items[0].encrypted_content, 'prior-opaque');
    assert.deepEqual(f.runtime.estimateCheckpoint(record), { tokens: Math.ceil(JSON.stringify(record.items).length / 4), basis: 'native-replay-json-utf16/4', exact: false });
    for (const mode of ['stream', 'compact']) {
      const p = handle.provider({ mode, replay: [{ placeholder: 'DSH_NATIVE_REPLAY_fake_nonce', checkpoint: text }] });
      const result = await collect(p.streamSimple(f.model, context('DSH_NATIVE_REPLAY_fake_nonce')));
      assert.equal(result.message.stopReason, 'stop');
      assert.deepEqual(f.calls.at(-1).body.input[0], record.items[0]);
      const lost = await collect(p.streamSimple(f.model, context('ordinary'))); assert.equal(lost.message.stopReason, 'error');
      const duplicate = await collect(p.streamSimple(f.model, { messages: [...context('DSH_NATIVE_REPLAY_fake_nonce').messages, ...context('DSH_NATIVE_REPLAY_fake_nonce').messages] }));
      assert.equal(duplicate.message.stopReason, 'error');
    }
    assert.throws(() => handle.provider({ replay: [{ placeholder: 'x', checkpoint: { ...record, identity: 'other' } }] }));
    assert.throws(() => handle.provider({ replay: [{ placeholder: 'x', checkpoint: record }, { placeholder: 'x', checkpoint: record }] }));
    const ordinary = await collect(handle.provider().streamSimple(f.model, context(text)));
    assert.equal(ordinary.message.stopReason, 'stop');
    assert.ok(f.calls.at(-1).body.input.some(item => item.content?.some(part => part.text === text)));
    assert.equal(f.runtime.decodeCheckpoint('ordinary'), undefined);
    assert.throws(() => f.runtime.decodeCheckpoint('<dsh-codex-compaction-v2>bad'));
    assert.throws(() => f.runtime.validateCheckpoint({ ...record, version: 2 }));
    assert.throws(() => f.runtime.validateCheckpoint({ ...record, items: [{ type: 'compaction', encrypted_content: 'x', bad: undefined }] }));
    assert.throws(() => f.runtime.validateCheckpoint({ ...record, items: [{ type: 'compaction', encrypted_content: 'x'.repeat(512 * 1024) }] }));
    let getterRan = false;
    assert.throws(() => f.runtime.encodeCheckpoint({ get items() { getterRan = true; return record.items; } }));
    assert.equal(getterRan, false);
  } finally { f.runtime.dispose(); }
});

test('normal and compact upstream error bodies/events stay secret-free', async () => {
  for (const mode of ['stream', 'compact']) for (const reply of [
    () => new Response(JSON.stringify({ error: { message: KEY, cookie: 'private-cookie' } }), { status: 401 }),
    () => sse([{ type: 'error', error: { message: KEY, headers: { cookie: 'private-cookie' } } }]),
    () => { throw Object.assign(new Error(KEY), { cause: { cookie: 'private-cookie' } }); },
  ]) {
    const f = fixture({ fetchImpl: reply });
    try {
      const handle = await f.runtime.open({ model: f.model.id });
      const result = await collect(handle.provider({ mode }).streamSimple(f.model, context('hello')));
      assert.equal(result.message.stopReason, 'error'); secretFree(result.events);
      assert.ok(!JSON.stringify(result.events).includes('private-cookie'));
    } finally { f.runtime.dispose(); }
  }
});

test('valid SSE is accepted by content even with a generic response MIME label', async () => {
  for (const mode of ['stream', 'compact']) for (const mime of ['text/plain', 'application/json', undefined]) {
    const events = mode === 'compact' ? compactEvents() : normalEvents();
    const f = fixture({ fetchImpl: async () => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: mime ? { 'content-type': mime } : {} }) });
    try {
      const handle = await f.runtime.open({ model: 'gpt-5.6-sol' });
      const result = await collect(handle.provider({ mode }).streamSimple(f.model, context('synthetic')));
      assert.equal(result.message.stopReason, 'stop', `${mode}/${mime}: ${result.message.errorMessage}`);
      if (mode === 'stream') assert.equal(result.message.content[0].text, 'hello');
      else assert.equal(f.runtime.decodeCheckpoint(result.message.content[0].text, handle.binding).items.at(-1).type, 'compaction');
      secretFree(result.events);
      handle.close();
    } finally { f.runtime.dispose(); }
  }
});

test('generic MIME cannot turn HTML, JSON errors or incomplete SSE into success', async () => {
  for (const mode of ['stream', 'compact']) for (const body of [
    '<html>gateway error</html>',
    JSON.stringify({ error: { message: KEY } }),
    `data: ${JSON.stringify({ type: 'response.output_item.done', item: { type: 'compaction', encrypted_content: 'incomplete' } })}\n\n`,
  ]) {
    const f = fixture({ fetchImpl: async () => new Response(body, { headers: { 'content-type': 'text/plain' } }) });
    try {
      const handle = await f.runtime.open({ model: 'gpt-5.6-sol' });
      const result = await collect(handle.provider({ mode }).streamSimple(f.model, context('synthetic')));
      assert.equal(result.message.stopReason, 'error');
      secretFree(result.events);
      handle.close();
    } finally { f.runtime.dispose(); }
  }
});

test('failure categories retain numeric HTTP status or phase without raw details', async () => {
  const cases = [
    ...[400, 401, 403, 429, 500].map(status => ({ code: `HTTP_${status}`, fetch: () => new Response(KEY + ' private-cookie', { status }) })),
    { code: 'NETWORK', fetch: () => { throw new TypeError(KEY + ' private-network-detail'); } },
    { code: 'RESPONSE_STREAM', fetch: () => new Response(KEY, { headers: { 'content-type': 'application/json' } }) },
    { code: 'RESPONSE_STREAM', compactCode: 'RESPONSE_PROTOCOL', fetch: () => sse([{ type: 'error', error: { message: KEY } }]) },
  ];
  for (const mode of ['stream', 'compact']) for (const entry of cases) {
    let calls = 0;
    const f = fixture({ fetchImpl: async () => { calls++; return entry.fetch(); } });
    try {
      const handle = await f.runtime.open({ model: f.model.id });
      const result = await collect(handle.provider({ mode }).streamSimple(f.model, context('test')));
      assert.equal(result.message.stopReason, 'error');
      assert.equal(result.message.errorMessage, `CODEX_RUNTIME_${mode === 'compact' ? entry.compactCode ?? entry.code : entry.code}`);
      assert.equal(calls, 1, 'diagnosis must not add retries');
      secretFree(result.events);
      assert.doesNotMatch(JSON.stringify(result.events), /private-cookie|private-network-detail/);
      handle.close();
    } finally { f.runtime.dispose(); }
  }
  const f = fixture();
  try {
    const handle = await f.runtime.open({ model: f.model.id });
    const result = await collect(handle.provider().streamSimple(f.model, { ...context('test'), uncloneable() {} }));
    assert.equal(result.message.errorMessage, 'CODEX_RUNTIME_REQUEST_PREPARE');
    assert.equal(f.calls.length, 0);
    secretFree(result.events);
  } finally { f.runtime.dispose(); }
});

test('native distinguishes premature EOF and read disconnect from protocol rejection', async () => {
  const rows = compactEvents();
  for (const [reply, code] of [
    [() => sse(rows.slice(0, 1)), 'RESPONSE_STREAM'],
    [() => sse([]), 'RESPONSE_STREAM'],
    [() => new Response(`data: ${JSON.stringify(rows[0])}\n\ndata: {"type":"response.compl`), 'RESPONSE_STREAM'],
    [() => new Response(`data: ${JSON.stringify(rows[0])}\n\ndata: ${JSON.stringify(rows[1])}\n`), 'RESPONSE_STREAM'],
    [() => new Response(new ReadableStream({ start(controller) { controller.error(new Error('synthetic socket reset')); } })), 'RESPONSE_STREAM'],
    [() => new Response('data: {bad}\n\n'), 'RESPONSE_PROTOCOL'],
    [() => sse(rows.slice(1)), 'RESPONSE_PROTOCOL'],
    [() => sse([rows[0], rows[0], rows[1]]), 'RESPONSE_PROTOCOL'],
    [() => sse([rows[0], { type: 'response.completed', response: { status: 'incomplete' } }]), 'RESPONSE_PROTOCOL'],
  ]) {
    let calls = 0;
    const f = fixture({ fetchImpl: async () => { calls++; return reply(); } });
    try {
      const handle = await f.runtime.open({ model: f.model.id });
      const result = await collect(handle.provider({ mode: 'compact' }).streamSimple(f.model, context('hello')));
      assert.equal(result.message.errorMessage, `CODEX_RUNTIME_${code}`);
      assert.equal(calls, 1); secretFree(result.events);
    } finally { f.runtime.dispose(); }
  }
});

test('native credential echoes fail rather than corrupting opaque checkpoints', async () => {
  for (const echoed of [KEY, ACCOUNT]) {
    const rows = compactEvents(); rows[0].item.encrypted_content = echoed;
    const f = fixture({ fetchImpl: async () => sse(rows) });
    try {
      const handle = await f.runtime.open({ model: f.model.id });
      const result = await collect(handle.provider({ mode: 'compact' }).streamSimple(f.model, context('hello')));
      assert.equal(result.message.stopReason, 'error'); secretFree(result.events);
    } finally { f.runtime.dispose(); }
  }
});

test('next operation may change account but existing handle remains pinned', async () => {
  let current = ACCOUNT;
  const f = fixture({ resolveOAuth: async () => ({ apiKey: token(current), headers: { 'chatgpt-account-id': current } }) });
  try {
    const first = await f.runtime.open({ model: f.model.id });
    current = 'fake-second-account';
    const second = await f.runtime.open({ model: f.model.id });
    assert.notEqual(first.binding.identity, second.binding.identity);
    await collect(first.provider().streamSimple(f.model, context('hello')));
    assert.equal(f.calls.at(-1).init.headers.get('chatgpt-account-id'), ACCOUNT);
    await collect(second.provider({ mode: 'compact' }).streamSimple(f.model, context('hello')));
    assert.equal(f.calls.at(-1).init.headers.get('chatgpt-account-id'), current);
    assert.equal(f.calls.at(-1).init.headers.get('authorization'), `Bearer ${token(current)}`);
  } finally { f.runtime.dispose(); }
});

test('native usage is observed only when numeric upstream totals exist', async () => {
  for (const usage of [{ input_tokens: 12, output_tokens: 3, total_tokens: 15, input_tokens_details: { cached_tokens: 4 } }, {}, { input_tokens: '12' }]) {
    const f = fixture({ fetchImpl: async () => sse(compactEvents(usage)) });
    try {
      const handle = await f.runtime.open({ model: f.model.id });
      const result = await collect(handle.provider({ mode: 'compact' }).streamSimple(f.model, context('hello')));
      assert.equal(result.message.stopReason, 'stop');
      const observed = usage.total_tokens === 15;
      assert.equal(result.message.usageAvailability, observed ? 'observed' : 'unavailable');
      assert.equal(result.message.usage.input, observed ? 8 : 0);
      assert.equal(result.message.usage.cacheRead, observed ? 4 : 0);
      assert.deepEqual(handle.compactionUsage(), observed ? { kind: 'observed', usage: { inputTokens: 8, outputTokens: 3, totalTokens: 15, cacheReadTokens: 4 } } : { kind: 'unavailable' });
      secretFree(handle.compactionUsage());
    } finally { f.runtime.dispose(); }
  }
});

test('usage receipt is detached, clears on attempt/failure/close, and rejects concurrent calls', async () => {
  let fail = false, pending, block = false, started;
  const began = new Promise(resolve => { started = resolve; });
  const usage = { input_tokens: 12, output_tokens: 3, total_tokens: 15, input_tokens_details: { cached_tokens: 4 } };
  const f = fixture({ fetchImpl: async () => {
    if (block) await new Promise(resolve => { pending = resolve; started(); });
    return fail ? new Response('failed', { status: 500 }) : sse(compactEvents(usage));
  } });
  try {
    const handle = await f.runtime.open({ model: f.model.id });
    const compact = handle.provider({ mode: 'compact' });
    assert.deepEqual(handle.compactionUsage(), { kind: 'unavailable' });
    await collect(compact.streamSimple(f.model, context('hello')));
    const receipt = handle.compactionUsage(); receipt.usage.inputTokens = 999;
    assert.equal(handle.compactionUsage().usage.inputTokens, 8);
    fail = true;
    const failing = compact.streamSimple(f.model, context('hello'));
    assert.deepEqual(handle.compactionUsage(), { kind: 'unavailable' });
    assert.equal((await collect(failing)).message.stopReason, 'error');
    assert.deepEqual(handle.compactionUsage(), { kind: 'unavailable' });
    fail = false; block = true;
    const active = compact.streamSimple(f.model, context('hello'));
    assert.throws(() => compact.streamSimple(f.model, context('hello')), { code: 'CODEX_RUNTIME_BUSY' });
    assert.throws(() => handle.provider().streamSimple(f.model, context('hello')), { code: 'CODEX_RUNTIME_BUSY' });
    assert.deepEqual(handle.compactionUsage(), { kind: 'unavailable' });
    await began;
    pending();
    assert.equal((await collect(active)).message.stopReason, 'stop');
    assert.equal(handle.compactionUsage().kind, 'observed');
    handle.close();
    assert.deepEqual(handle.compactionUsage(), { kind: 'unavailable' });
  } finally { f.runtime.dispose(); }
});

test('response identity, opaque signatures and tool business JSON survive stream and native replay', async () => {
  const reasoning = { type: 'reasoning', id: 'rs_test', encrypted_content: 'opaque-reasoning', summary: [{ type: 'summary_text', text: 'plan' }] };
  const args = { headers: { accept: 'application/json' }, cookies: ['cookie-from-model-task-data'], error: { cause: 'business-data', partialJson: 'keep' }, nested: { diagnostics: 'also-business' } };
  const toolCall = { type: 'toolCall', id: 'call_test|fc_test', name: 'http_tool', arguments: args };
  const f = fixture({ modelProvider: { id: 'openai-codex', streamSimple(model) {
    const stream = createAssistantMessageEventStream();
    const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      content: [{ type: 'thinking', thinking: 'plan', thinkingSignature: JSON.stringify(reasoning) }, { type: 'text', text: 'answer', textSignature: 'msg_original' }, toolCall],
      responseId: 'resp_keep', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} }, stopReason: 'toolUse', timestamp: 1,
      headers: { authorization: KEY }, diagnostics: [{ error: { message: KEY } }], cause: KEY };
    stream.push({ type: 'toolcall_end', contentIndex: 2, toolCall, partial: message, headers: { cookie: KEY } });
    stream.push({ type: 'done', reason: 'toolUse', message }); stream.end(); return stream;
  } } });
  try {
    const handle = await f.runtime.open({ model: f.model.id });
    const result = await collect(handle.provider().streamSimple(f.model, context('hello')));
    assert.equal(result.message.responseId, 'resp_keep');
    assert.equal(result.message.content[0].thinkingSignature, JSON.stringify(reasoning));
    assert.equal(result.message.content[1].textSignature, 'msg_original');
    assert.deepEqual(result.message.content[2].arguments, args);
    assert.deepEqual(result.events[0].toolCall.arguments, args);
    assert.equal(result.message.headers, undefined); assert.equal(result.message.diagnostics, undefined); assert.equal(result.message.cause, undefined);
    const compact = await collect(handle.provider({ mode: 'compact' }).streamSimple(f.model, { messages: [...context('hello').messages, result.message] }));
    assert.equal(compact.message.stopReason, 'stop');
    assert.deepEqual(f.calls.at(-1).body.input.find(item => item.type === 'reasoning'), reasoning);
    assert.equal(f.calls.at(-1).body.input.find(item => item.role === 'assistant').id, 'msg_original');
    assert.deepEqual(JSON.parse(f.calls.at(-1).body.input.find(item => item.type === 'function_call').arguments), args);
  } finally { f.runtime.dispose(); }
});

test('known credential in a signature or structured tool argument fails without rewriting it', async () => {
  for (const block of [{ type: 'thinking', thinking: 'plan', thinkingSignature: KEY }, { type: 'text', text: 'text', textSignature: KEY }, { type: 'toolCall', id: 'c', name: 'http', arguments: { headers: { authorization: KEY } } }]) {
    const f = fixture({ modelProvider: { id: 'openai-codex', streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: 'stop', message: { role: 'assistant', api: model.api, provider: model.provider, model: model.id, content: [block], stopReason: 'stop', timestamp: 1 } });
      stream.end(); return stream;
    } } });
    try {
      const handle = await f.runtime.open({ model: f.model.id });
      const result = await collect(handle.provider().streamSimple(f.model, context('hello')));
      assert.equal(result.message.stopReason, 'error'); secretFree(result.events);
      assert.equal(JSON.stringify(block).includes(KEY), true);
    } finally { f.runtime.dispose(); }
  }
});

test('native usage receipt distinguishes missing cached usage from explicitly observed zero', async () => {
  for (const details of [undefined, { cached_tokens: 0 }]) {
    const f = fixture({ fetchImpl: async () => sse(compactEvents({ input_tokens: 12, output_tokens: 3, total_tokens: 15, ...(details ? { input_tokens_details: details } : {}) })) });
    try {
      const handle = await f.runtime.open({ model: f.model.id });
      await collect(handle.provider({ mode: 'compact' }).streamSimple(f.model, context('hello')));
      assert.deepEqual(handle.compactionUsage(), { kind: 'observed', usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15, ...(details ? { cacheReadTokens: 0 } : {}) } });
      assert.throws(() => handle.provider({ mode: 'compact', replay: [{ placeholder: 'x', checkpoint: {} }] }));
      assert.deepEqual(handle.compactionUsage(), { kind: 'unavailable' });
    } finally { f.runtime.dispose(); }
  }
});

test('owner endpoint guard also blocks an errant native SDK implementation', async () => {
  let blocked;
  const f = fixture({ modelProvider: { id: 'openai-codex', streamSimple(model, ctx, options) {
    const result = createAssistantMessageEventStream();
    void options.fetch('https://evil.invalid/responses', { headers: { authorization: `Bearer ${KEY}` } })
      .catch(error => { blocked = error.code; result.push({ type: 'error', reason: 'error', error: { ...model, errorMessage: KEY } }); result.end(); });
    return result;
  } } });
  try {
    const handle = await f.runtime.open({ model: f.model.id });
    const result = await collect(handle.provider().streamSimple(f.model, context('hello')));
    assert.equal(result.message.stopReason, 'error'); assert.equal(blocked, 'CODEX_RUNTIME_ENDPOINT'); assert.equal(f.calls.length, 0); secretFree(result.events);
  } finally { f.runtime.dispose(); }
});
