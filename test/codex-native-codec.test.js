import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCheckpoint, decodeCheckpoint, validateCheckpoint, estimateCheckpoint } from '../lib/capabilities/codex-native/checkpoint.js';
import { NativeTransport } from '../lib/capabilities/codex-native/native-transport.js';
const binding = { provider: 'codex-native-lab', model: 'test-model', identity: 'nonsecret-fingerprint' };
const record = () => ({ version: 1, protocol: 'responses.compaction-trigger.v2', ...binding, items: [{ type: 'compaction', encrypted_content: 'opaque' }] });
const events = [
  { type: 'response.output_item.done', item: { type: 'compaction', encrypted_content: 'opaque', unknown: { future: true } } },
  { type: 'response.completed', response: { status: 'completed' } },
];
const response = rows => new Response(rows.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
function transport(fetch) { return new NativeTransport({ fetch, identity: binding.identity, auth: async () => ({ accessToken: 'fake-token', accountId: 'fake-account', identity: binding.identity }), timeoutMs: 50 }); }
const input = [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }];

test('strict JSON schema rejects pollution, non-JSON values, depth, size and invalid binding', () => {
  for (const bad of [undefined, NaN, Infinity, -0, new Date(), new Uint8Array(), [, 1], { toJSON() { return 'x'; } }, JSON.parse('{"__proto__": {}}')]) {
    const value = record(); value.items[0].extra = bad;
    assert.throws(() => validateCheckpoint(value));
  }
  let nested = {}; const deep = nested;
  for (let i = 0; i < 40; i++) { nested.next = {}; nested = nested.next; }
  assert.throws(() => validateCheckpoint({ ...record(), extra: deep }));
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => validateCheckpoint({ ...record(), extra: cycle }));
  assert.throws(() => validateCheckpoint({ ...record(), items: Array.from({ length: 1025 }, () => ({ type: 'message' })) }));
  for (const key of ['provider', 'model', 'identity']) assert.throws(() => validateCheckpoint(record(), { ...binding, [key]: 'wrong' }));
  assert.throws(() => validateCheckpoint({ ...record(), items: [{ type: 'compaction', encrypted_content: ' ' }] }));
  assert.throws(() => validateCheckpoint({ ...record(), items: [...record().items, ...record().items] }));
  assert.throws(() => encodeCheckpoint({ ...record(), version: 2 }));
  const withUnknown = { ...record(), future: { list: ['a', { intact: true }] } };
  assert.deepEqual(decodeCheckpoint(encodeCheckpoint(withUnknown)), withUnknown);
  assert.equal(estimateCheckpoint(record()).exact, false);
});

test('transport preserves native unknown fields and never invents usage', async () => {
  let call;
  const result = await transport(async (url, init) => { call = { url, init }; return response(events); }).compact({ ...binding, input });
  assert.equal(call.url, 'https://chatgpt.com/backend-api/codex/responses');
  assert.equal(call.init.redirect, 'error'); assert.equal(result.usage, undefined);
  assert.deepEqual(result.items, [...input, events[0].item]);
  assert.deepEqual(JSON.parse(call.init.body).input.at(-1), { type: 'compaction_trigger' });
});

test('R1-01: valid opaque metadata and literal text remain valid on recompaction', async () => {
  const opaque = { type: 'compaction', encrypted_content: 'opaque', future: { type: 'profile', image: 'metadata-label', file_id: 'opaque-reference' } };
  const value = { ...record(), items: [opaque] };
  assert.deepEqual(validateCheckpoint(value), value);
  for (const source of [[opaque], [{ role: 'user', content: [{ type: 'input_text', text: 'data:image/png;base64,THIS_IS_TEXT' }] }, opaque]]) {
    let body;
    await transport(async (_url, init) => { body = JSON.parse(init.body); return response(events); }).compact({ ...binding, input: source });
    assert.deepEqual(body.input, [...source, { type: 'compaction_trigger' }]);
  }
});

test('transport rejects incomplete/failed/duplicate terminal SSE and unsupported modalities', async () => {
  for (const rows of [events.slice(0, 1), events.slice(1), [...events, events[1]],
    [events[0], { type: 'response.failed', error: { message: 'SECRET' } }],
    [events[0], { type: 'response.completed', response: { status: 'incomplete' } }],
    [events[0], events[0], events[1]],
  ]) {
    await assert.rejects(transport(async () => response(rows)).compact({ ...binding, input }), error => !error.message.includes('SECRET'));
  }
  let fetched = false;
  await assert.rejects(transport(async () => { fetched = true; return response(events); }).compact({ ...binding, input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'https://example.invalid' }] }] }));
  assert.equal(fetched, false);
  await assert.rejects(transport(async () => new Response('SECRET', { status: 500 })).compact({ ...binding, input }), error => error.code === 'HTTP_ERROR' && !error.message.includes('SECRET'));
});
