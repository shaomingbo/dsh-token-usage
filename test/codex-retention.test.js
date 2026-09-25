import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NativeTransport } from '../lib/capabilities/codex-native/native-transport.js';
import { createCodexRuntime } from '../lib/capabilities/codex-native/runtime.js';

const ACCOUNT = 'fake-owner-account-ONLY-TEST';
const token = () => 'eyJhbGciOiJub25lIn0.' + Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: ACCOUNT } })).toString('base64url') + '.FAKE';
const KEY = token();
const digest = text => createHash('sha256').update(text).digest('hex');
const item = (role, text) => ({ role, content: [{ type: 'input_text', text }] });
const sse = () => new Response([
  { type: 'response.output_item.done', item: { type: 'compaction', encrypted_content: 'opaque-item' } },
  { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 9, output_tokens: 2, total_tokens: 11 } } },
].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });

async function compactFixture(input, retentionHints, observations = []) {
  let body;
  const transport = new NativeTransport({
    fetch: async (_url, init) => { body = JSON.parse(init.body); return sse(); },
    auth: async () => ({ accessToken: KEY, accountId: ACCOUNT, identity: 'id1' }),
    identity: 'id1',
    observe: (kind, value) => observations.push([kind, value]),
  });
  const result = await transport.compact({ provider: 'codex-native-lab', model: 'gpt-5.4', input, retentionHints,
    signal: new AbortController().signal });
  return { result, body, observations };
}
const hints = pairs => ({ version: 1, algorithm: 'source-aware-v1', items: pairs.map(([category, text]) => ({ category, digest: digest(text) })) });

test('source-aware-v1 drops only provable duplicates; the full request is still sent', async () => {
  const input = [
    item('user', 'real instruction'),          // user-instruction
    item('user', 'wrapper copy'),              // host-notice duplicate of the instruction? no — see hints below
    item('user', 'authoritative text'),
    item('user', 'authoritative text'),        // real duplicate user content
    item('user', 'one-off notice'),
    item('user', 'repeated notice'),
    item('user', 'repeated notice'),
  ];
  const hint = hints([
    ['user-instruction', 'real instruction'],
    ['host-notice', 'wrapper copy'],
    ['user-instruction', 'authoritative text'],
    ['host-notice', 'one-off notice'],
    ['host-notice', 'repeated notice'],
  ]);
  const observations = [];
  const { result, body, observations: obs } = await compactFixture(input, hint, observations);
  // The wire request keeps every input item plus the trigger — retention only
  // shapes the retained checkpoint copy.
  assert.equal(body.input.length, input.length + 1);
  const texts = result.items.map(entry => entry.content?.[0]?.text ?? entry.type);
  // 'wrapper copy' is a host-notice with NO duplicate → kept (no invented drops).
  assert.ok(texts.includes('wrapper copy'));
  // Real duplicated user content is never dropped.
  assert.equal(texts.filter(text => text === 'authoritative text').length, 2);
  // A one-off notice is kept.
  assert.ok(texts.includes('one-off notice'));
  // Repeated notices keep exactly one copy (the newest).
  assert.equal(texts.filter(text => text === 'repeated notice').length, 1);
  assert.ok(result.items.some(entry => entry.type === 'compaction' && entry.encrypted_content === 'opaque-item'));
  const retention = obs.find(([kind]) => kind === 'retention');
  assert.equal(retention[1].dropped, 1);
  assert.equal(retention[1].algorithm, 'source-aware-v1');
  assert.deepEqual(retention[1].categories, { 'user-instruction': 3, 'host-notice': 4 });
});

test('duplicated host-notice text keeps exactly the newest copy; user text never deduplicates', async () => {
  const input = [item('user', 'shared notice'), item('user', 'shared notice'), item('user', 'shared user'), item('user', 'shared user'), item('user', 'tail')];
  const hint = hints([['host-notice', 'shared notice'], ['user-instruction', 'shared user'], ['user-instruction', 'tail']]);
  const { result } = await compactFixture(input, hint, []);
  const texts = result.items.map(entry => entry.content?.[0]?.text ?? entry.type);
  assert.equal(texts.filter(text => text === 'shared notice').length, 1, 'the newest notice copy survives alone');
  assert.equal(texts.filter(text => text === 'shared user').length, 2, 'real duplicated user content is never dropped');
  assert.ok(texts.includes('tail'));
});

test('malformed or ambiguous hints fall back to the original retention policy', async () => {
  const input = [item('user', 'dup'), item('user', 'dup'), item('user', 'tail')];
  const ambiguous = { version: 1, algorithm: 'source-aware-v1', items: [
    { category: 'host-notice', digest: digest('dup') }, { category: 'user-instruction', digest: digest('dup') }] };
  const observations = [];
  const { result } = await compactFixture(input, ambiguous, observations);
  const texts = result.items.map(entry => entry.content?.[0]?.text ?? entry.type);
  assert.equal(texts.filter(text => text === 'dup').length, 2, 'fallback keeps every copy');
  const retention = observations.find(([kind]) => kind === 'retention');
  assert.equal(retention[1].fallback, 'hints-ambiguous');
  const malformed = { version: 2, algorithm: 'source-aware-v1', items: [] };
  const second = [];
  await compactFixture(input, malformed, second);
  assert.equal(second.find(([kind]) => kind === 'retention')[1].fallback, 'hints-malformed');
});

test('runtime advertises the capability, validates the envelope, and keeps stream mode hint-free', async () => {
  const runtime = createCodexRuntime({ resolveOAuth: async () => ({ apiKey: KEY, headers: {} }), configured: () => true });
  const description = runtime.describe();
  assert.deepEqual(description.retentionHints, { supported: true, algorithm: 'source-aware-v1', version: 1 });
  const handle = await runtime.open({ model: 'gpt-5.4' });
  const good = { version: 1, algorithm: 'source-aware-v1', items: [{ category: 'host-notice', digest: digest('x') }] };
  assert.doesNotThrow(() => handle.provider({ mode: 'compact', retentionHints: good }));
  assert.throws(() => handle.provider({ mode: 'stream', retentionHints: good }), /RETENTION_HINTS/);
  assert.throws(() => handle.provider({ mode: 'compact', retentionHints: { ...good, algorithm: 'other' } }), /RETENTION_HINTS/);
  assert.throws(() => handle.provider({ mode: 'compact', retentionHints: { ...good, items: [{ category: 'evil', digest: digest('x') }] } }), /RETENTION_HINTS/);
  assert.throws(() => handle.provider({ mode: 'compact', retentionHints: { ...good, items: [{ category: 'host-notice', digest: 'nothex' }] } }), /RETENTION_HINTS/);
  handle.close();
  runtime.dispose();
});

test('hint digests matching nothing change nothing (conservative unknown)', async () => {
  const input = [item('user', 'unmatched'), item('user', 'tail')];
  const hint = hints([['host-notice', 'different text entirely']]);
  const { result } = await compactFixture(input, hint, []);
  const texts = result.items.map(entry => entry.content?.[0]?.text ?? entry.type);
  assert.ok(texts.includes('unmatched'));
  assert.ok(texts.includes('tail'));
});
