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

test('transport completes at a valid terminal without EOF and ignores every trailing byte', async () => {
  const openBody = new ReadableStream({ start(controller) {
    controller.enqueue(Buffer.from(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')));
  } });
  await transport(async () => new Response(openBody)).compact({ ...binding, input });
  assert.equal(openBody.locked, false);
  for (const type of ['response.completed', 'response.done']) {
    const prefix = Buffer.from([events[0], { type, response: { status: 'completed', usage: { total_tokens: 7 } } }]
      .map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''));
    const suffix = Buffer.concat([Buffer.from('data: {broken}\n\ndata: [DONE]\n\n'), Buffer.from([0xff]), Buffer.alloc(4 * 1024 * 1024, 120)]);
    const payload = Buffer.concat([prefix, suffix]);
    // All terminal framing boundaries, plus a single oversized/invalid-UTF8 chunk.
    for (const split of [0, prefix.length - 4, prefix.length - 3, prefix.length - 2, prefix.length - 1, prefix.length]) {
      let cancelled = false;
      const body = new ReadableStream({ start(controller) {
        if (split) controller.enqueue(payload.subarray(0, split));
        controller.enqueue(payload.subarray(split));
        // Intentionally never close: completion must release the open reader.
      }, cancel() { cancelled = true; } });
      const result = await transport(async () => new Response(body)).compact({ ...binding, input });
      assert.deepEqual(result.items, [...input, events[0].item]);
      assert.deepEqual(result.usage, { total_tokens: 7 });
      assert.equal(cancelled, true); assert.equal(body.locked, false);
    }
  }
  assert.deepEqual((await transport(async () => response([...events, events[1]])).compact({ ...binding, input })).items, [...input, events[0].item]);
});

test('completion is invariant at every byte split including UTF-8 and SSE framing', async () => {
  const item = { type: 'compaction', encrypted_content: 'opaque-原样' };
  const bytes = Buffer.from([{ type: 'response.output_item.done', item }, events[1]]
    .map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('') + 'data: {broken}\n\n');
  for (let split = 1; split < bytes.length; split++) {
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(bytes.subarray(0, split)); controller.enqueue(bytes.subarray(split));
    } });
    assert.deepEqual((await transport(async () => new Response(body)).compact({ ...binding, input })).items, [...input, item]);
    assert.equal(body.locked, false);
  }
});

test('transport distinguishes clean EOF before completion from protocol rejection', async () => {
  for (const rows of [[], events.slice(0, 1)]) {
    await assert.rejects(transport(async () => response(rows)).compact({ ...binding, input }), { code: 'SSE_INCOMPLETE' });
  }
  const prefix = `data: ${JSON.stringify(events[0])}\n\n`;
  for (const tail of ['data: {"type":"response.compl', `data: ${JSON.stringify(events[1])}\n`]) {
    await assert.rejects(transport(async () => new Response(prefix + tail)).compact({ ...binding, input }), { code: 'SSE_INCOMPLETE' });
  }
  for (const [body, code] of [
    ['data: {bad}\n\n', 'SSE_JSON'],
    ['data: [DONE]\n\n', 'SSE_TERMINAL'],
    ['event: wrong\ndata: {"type":"response.completed","response":{}}\n\n', 'SSE_EVENT'],
    [': ' + 'x'.repeat(4 * 1024 * 1024) + '\n\n', 'SSE_SIZE'],
    ['data: {"type":"tick"}\n\n'.repeat(8193), 'SSE_LIMIT'],
  ]) {
    await assert.rejects(transport(async () => new Response(body)).compact({ ...binding, input }), { code });
  }
});

test('transport rejects incomplete/failed/duplicate compaction SSE and unsupported modalities', async () => {
  for (const rows of [events.slice(0, 1), events.slice(1),
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
