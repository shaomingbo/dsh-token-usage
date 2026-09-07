import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodexModelFacts } from '../lib/capabilities/codex-native/model-facts.js';
import { createCodexRuntime } from '../lib/capabilities/codex-native/runtime.js';

const REF = 'OPENAI_CODEX_ACCESS_TOKEN';
const astraProfile = { id: 'gpt-6-astra', contextWindow: 872000, maxTokens: 128000, input: ['text', 'image'],
  reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } };
const settings = route => () => ({ providers: { 'openai-codex': route } });

test('official route verdicts are fixed-vocabulary and credential-ref bound', () => {
  const facts = createCodexModelFacts({ getSettings: settings({ apiKeyEnv: REF }), credentialRef: REF });
  assert.deepEqual(facts.routeStatus(), { ok: true, route: { apiKeyEnv: REF } });
  assert.equal(facts.routeStatus().route.baseURL, undefined);
  for (const [route, reason] of [
    [{ apiKeyEnv: 'OTHER_REF' }, 'ROUTE_AUTH'],
    [{ apiKeyEnv: REF, api: 'openai-responses' }, 'ROUTE_PROTOCOL'],
    [{ apiKeyEnv: REF, baseURL: 'https://evil.invalid/v1' }, 'ROUTE_ENDPOINT'],
  ]) {
    assert.equal(createCodexModelFacts({ getSettings: settings(route), credentialRef: REF }).routeStatus().reason, reason);
  }
  assert.equal(createCodexModelFacts({ getSettings: () => undefined, credentialRef: REF }).routeStatus().reason, 'ROUTE_MISSING');
  const base = createCodexModelFacts({ getSettings: settings({ apiKeyEnv: REF, baseURL: facts.OFFICIAL_CODEX_BASE }), credentialRef: REF });
  assert.equal(base.routeStatus().ok, true, 'the explicit official base is accepted');
});

test('profile facts are whitelisted; unknown fields never cross the seam', async () => {
  const facts = createCodexModelFacts({
    getSettings: settings({ apiKeyEnv: REF, models: [{ ...astraProfile, headers: { authorization: 'Bearer SECRET' }, baseURL: 'https://evil.invalid', compat: { strict: true }, extraJunk: true }] }),
    credentialRef: REF,
  });
  const resolved = await facts.resolveModelFacts('gpt-6-astra');
  assert.deepEqual(resolved, {
    id: 'gpt-6-astra',
    contextWindow: 872000, maxTokens: 128000, input: ['text', 'image'],
    reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  });
  const text = JSON.stringify(resolved);
  assert.ok(!text.includes('SECRET') && !text.includes('evil.invalid') && !text.includes('compat') && !text.includes('extraJunk'));
});

test('host-resolved info cross-checks instead of trusting either side blindly', async () => {
  const agree = createCodexModelFacts({
    getSettings: settings({ apiKeyEnv: REF, models: [{ id: 'gpt-6-astra', maxTokens: 128000 }] }),
    resolveModelInfo: async () => ({ context: { contextWindow: 872000 }, defaultMaxTokens: 128000, inputModalities: ['text', 'image'] }),
    credentialRef: REF,
  });
  assert.deepEqual(await agree.resolveModelFacts('gpt-6-astra'), { id: 'gpt-6-astra', contextWindow: 872000, maxTokens: 128000, input: ['text', 'image'] });
  const conflict = createCodexModelFacts({
    getSettings: settings({ apiKeyEnv: REF, models: [{ id: 'gpt-6-astra', contextWindow: 872000 }] }),
    resolveModelInfo: async () => ({ context: { contextWindow: 272000 } }),
    credentialRef: REF,
  });
  assert.deepEqual(await conflict.resolveModelFacts('gpt-6-astra'), { gap: 'METADATA_CONFLICT' });
  const failing = createCodexModelFacts({
    getSettings: settings({ apiKeyEnv: REF, models: [astraProfile] }),
    resolveModelInfo: async () => { throw new Error('SECRET-RESOLVE-FAILURE'); },
    credentialRef: REF,
  });
  assert.deepEqual(await failing.resolveModelFacts('gpt-6-astra'), { id: 'gpt-6-astra', contextWindow: 872000, maxTokens: 128000, input: ['text', 'image'],
    reasoningEfforts: astraProfile.reasoningEfforts }, 'a failed host lookup degrades to profile-only facts');
});

test('invalid profile values are concrete gaps, never coerced or invented', async () => {
  for (const [entry, gap] of [
    [{ id: 'gpt-6-astra', contextWindow: '872000', maxTokens: 1 }, 'PROFILE_INVALID'],
    [{ id: 'gpt-6-astra', contextWindow: -1, maxTokens: 1 }, 'PROFILE_INVALID'],
    [{ id: 'gpt-6-astra', contextWindow: 1, maxTokens: Number.NaN }, 'PROFILE_INVALID'],
    [{ id: 'gpt-6-astra', name: 'x'.repeat(300), contextWindow: 1, maxTokens: 1 }, 'PROFILE_INVALID'],
  ]) {
    const facts = createCodexModelFacts({ getSettings: settings({ apiKeyEnv: REF, models: [entry] }), credentialRef: REF });
    assert.deepEqual(await facts.resolveModelFacts('gpt-6-astra'), { gap });
  }
  const none = createCodexModelFacts({ getSettings: settings({ apiKeyEnv: REF, models: [] }), credentialRef: REF });
  assert.equal(await none.resolveModelFacts('gpt-6-astra'), undefined, 'an unconfigured id is unknown, not a metadata gap');
});

test('gap passthrough carries the route verdict for inapplicable routes', async () => {
  const facts = createCodexModelFacts({ getSettings: settings({ apiKeyEnv: 'OTHER_REF', models: [astraProfile] }), credentialRef: REF });
  assert.deepEqual(await facts.resolveModelFacts('gpt-6-astra'), { gap: 'ROUTE_AUTH' });
});

test('a schema-materialized empty input array inherits the host default; only nonempty overrides', async () => {
  // The host settings schema materializes an omitted model-profile input list
  // to [] (verified end-to-end against the real public Config in the paired
  // cross-plugin suite). The public PiAiModelProfile contract says absent OR
  // empty both inherit the catalog/host default.
  const inherited = createCodexModelFacts({
    getSettings: settings({ apiKeyEnv: REF, models: [{ id: 'gpt-5.6-sol', reasoningEfforts: { low: 'low' }, input: [] }] }),
    resolveModelInfo: async () => ({ context: { contextWindow: 272000 }, inputModalities: ['text', 'image'] }),
    credentialRef: REF,
  });
  assert.deepEqual(await inherited.resolveModelFacts('gpt-5.6-sol'),
    { id: 'gpt-5.6-sol', contextWindow: 272000, input: ['text', 'image'], reasoningEfforts: { low: 'low' } },
    'an empty materialized input array falls back to the host-resolved modalities');

  const withoutHost = createCodexModelFacts({
    getSettings: settings({ apiKeyEnv: REF, models: [{ id: 'gpt-5.6-sol', contextWindow: 272000, maxTokens: 128000, input: [] }] }),
    credentialRef: REF,
  });
  assert.deepEqual(await withoutHost.resolveModelFacts('gpt-5.6-sol'),
    { id: 'gpt-5.6-sol', contextWindow: 272000, maxTokens: 128000 },
    'with no host resolution the runtime keeps the pinned catalog modalities');

  // Nonempty illegal modalities stay fail-closed: they are passed to the
  // runtime, whose customModel validation rejects them.
  const illegal = createCodexModelFacts({
    getSettings: settings({ apiKeyEnv: REF, models: [{ id: 'gpt-5.6-sol', input: ['video'] }] }),
    resolveModelInfo: async () => ({ context: { contextWindow: 272000 }, inputModalities: ['text', 'image'] }),
    credentialRef: REF,
  });
  const illegalFacts = await illegal.resolveModelFacts('gpt-5.6-sol');
  assert.deepEqual(illegalFacts.input, ['video'], 'illegal nonempty modalities are never silently replaced');
  const runtime = createCodexRuntime({ timeoutMs: 30000, configured: () => true,
    resolveOAuth: () => { throw new Error('must not resolve auth'); },
    fetchImpl: async () => { throw new Error('must not fetch'); },
    resolveModelFacts: async () => illegalFacts, routeStatus: () => ({ ok: true }) });
  await assert.rejects(runtime.open({ model: 'gpt-5.6-sol' }), error => error.code === 'CODEX_RUNTIME_MODEL_METADATA');
  runtime.dispose();
});
