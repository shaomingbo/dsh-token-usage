import test from 'node:test';
import assert from 'node:assert/strict';
import { CODEX_CATALOG_REVISION, codexCatalogEntries, dshModelProfile, findCodexCatalogModel, nativeModelFacts } from '../lib/capabilities/codex-native/catalog.js';
import { createCodexModelSync } from '../lib/capabilities/codex-native/model-sync.js';
import { chatgptRouteModels, openaiCodexRoutePatch } from '../lib/capabilities/chatgpt-grok/capability.js';
import { createCodexRuntime } from '../lib/capabilities/codex-native/runtime.js';
import { settingsFixture } from './settings-fixture.js';

const PROJECTION_KEYS = ['id', 'name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts'];

function syncFixture(value = {}) {
  const settings = settingsFixture({ 'llm-pi-ai': { providers: { 'openai-codex': value } } });
  const sync = createCodexModelSync({ providerSettings: settings, defaultRouteModels: chatgptRouteModels });
  return { settings, sync };
}

test('verified catalog facts: one source, two projections, verified values', () => {
  const entries = codexCatalogEntries();
  assert.deepEqual(entries.map(entry => entry.id), ['gpt-6-sol', 'gpt-6-luna']);
  for (const entry of entries) {
    assert.equal(entry.contextWindow, 272_000, 'Codex catalog context, never the public API 1,050,000');
    assert.equal(entry.maxTokens, 128_000);
    assert.deepEqual(entry.input, ['text', 'image']);
    assert.equal(entry.api, 'openai-codex-responses');
    assert.deepEqual(entry.reasoningEfforts, { off: 'none', minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' });
    // The DSH projection carries only configuration schema fields.
    const profile = dshModelProfile(entry.id);
    assert.deepEqual(Object.keys(profile).sort(), [...PROJECTION_KEYS].sort());
    assert.equal(profile.api, undefined);
    assert.equal(profile.reasoning, undefined);
    // The native facts projection is the whitelisted custom-model shape.
    const facts = nativeModelFacts(entry.id);
    assert.deepEqual(Object.keys(facts).sort(), [...PROJECTION_KEYS].sort());
    // Neither projection aliases the frozen source.
    profile.name = 'mutated';
    assert.equal(codexCatalogEntries().find(candidate => candidate.id === entry.id).name, entry.name);
  }
  assert.equal(findCodexCatalogModel('gpt-6-sol').name, 'GPT-6 Sol');
  assert.equal(findCodexCatalogModel('GPT-6-SOL'), undefined, 'catalog lookup is exact, not normalized');
  assert.equal(findCodexCatalogModel('../evil'), undefined);
});

test('route defaults: normalized ids with DSH profiles, no nested id objects', () => {
  const models = chatgptRouteModels();
  assert.deepEqual(models.map(model => model.id), ['gpt-5.6-terra', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']);
  for (const model of models) {
    assert.equal(typeof model.id, 'string', 'the historical string/object mix must not return');
  }
  const patch = openaiCodexRoutePatch();
  assert.deepEqual(patch.models, models);
  // Boot provisioning keeps existing values, including a user's own list.
  const mine = [{ id: 'mine' }];
  assert.equal(openaiCodexRoutePatch({ models: mine }).models, mine);
});

test('native catalog serves the verified ids alongside the pinned set', async () => {
  const runtime = createCodexRuntime({ resolveOAuth: async () => ({}), configured: () => true });
  const ids = runtime.models().map(model => model.id);
  assert.deepEqual(ids, ['gpt-5.3-codex-spark', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-sol', 'gpt-6-luna'],
    'pinned entries stay; the verified ids join; no full-directory swap');
  const sol = runtime.models().find(model => model.id === 'gpt-6-sol');
  assert.equal(sol.baseUrl, 'https://chatgpt.com/backend-api');
  assert.equal(sol.reasoning, true);
  assert.deepEqual(sol.thinkingLevelMap.off, 'none');
  const verdict = await runtime.applicability({ provider: 'openai-codex', model: 'gpt-6-luna' });
  assert.deepEqual(verdict, { applicable: true, model: { id: 'gpt-6-luna', contextWindow: 272_000, maxTokens: 128_000, input: ['text', 'image'] } });
  const missing = await runtime.applicability({ provider: 'openai-codex', model: 'gpt-6-unknown' });
  assert.equal(missing.applicable, false);
  assert.equal(missing.reason, 'UNKNOWN_MODEL');
  runtime.dispose();
});

test('models.preview: append to an existing list preserving order and removals', () => {
  const { sync } = syncFixture({ models: [{ id: 'gpt-5.6-terra' }, { id: 'gpt-6-astra' }, { id: 'my-custom' }] });
  const preview = sync.preview({ provider: 'openai-codex', modelIds: ['gpt-6-sol', 'gpt-6-luna'] });
  assert.equal(preview.catalogRevision, CODEX_CATALOG_REVISION);
  assert.equal(preview.settingsRevision, 0);
  assert.equal(preview.basis, 'existing');
  assert.equal(preview.changed, true);
  assert.deepEqual(preview.currentIds, ['gpt-5.6-terra', 'gpt-6-astra', 'my-custom']);
  assert.deepEqual(preview.targetIds, ['gpt-5.6-terra', 'gpt-6-astra', 'my-custom', 'gpt-6-sol', 'gpt-6-luna'],
    'order, custom models, and the deliberate removal of gpt-5.6-* stay untouched');
  assert.deepEqual(preview.models.map(model => [model.id, model.action]), [['gpt-6-sol', 'add'], ['gpt-6-luna', 'add']]);
  assert.equal(preview.models[0].fields.reasoningEfforts.off, 'none');
});

test('models.preview: fill only unset fields of an existing same-id entry', () => {
  const { sync } = syncFixture({ models: [{ id: 'gpt-6-sol', name: 'My Sol' }, { id: 'gpt-6-luna', name: 'L', contextWindow: 272_000, maxTokens: 128_000, input: ['text'], reasoningEfforts: { low: 'low' } }] });
  const preview = sync.preview({ provider: 'openai-codex', modelIds: ['gpt-6-sol', 'gpt-6-luna'] });
  const sol = preview.models.find(model => model.id === 'gpt-6-sol');
  assert.equal(sol.action, 'fill');
  assert.deepEqual(Object.keys(sol.fields).sort(), ['contextWindow', 'input', 'maxTokens', 'reasoningEfforts'],
    'the user name override survives; only unset fields fill');
  const luna = preview.models.find(model => model.id === 'gpt-6-luna');
  assert.equal(luna.action, 'none', 'a fully specified entry is untouched');
  assert.equal(preview.changed, true);
});

test('models.preview: explicit empty list and absent list semantics', () => {
  const empty = syncFixture({ models: [] }).sync.preview({ provider: 'openai-codex', modelIds: ['gpt-6-sol'] });
  assert.equal(empty.basis, 'empty');
  assert.deepEqual(empty.targetIds, ['gpt-6-sol'], 'an explicit empty list gains only the selection');
  const absent = syncFixture({}).sync.preview({ provider: 'openai-codex', modelIds: ['gpt-6-sol'] });
  assert.equal(absent.basis, 'absent');
  assert.equal(absent.currentIds, null);
  assert.deepEqual(absent.targetIds, ['gpt-5.6-terra', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'],
    'an absent list materializes exactly the normalized defaults plus the selection');
  assert.equal(absent.models.find(model => model.id === 'gpt-6-sol').action, 'none',
    'the normalized defaults already describe the selection completely');
});

test('models.preview rejects malformed selections and unknown providers', () => {
  const { sync } = syncFixture({ models: [] });
  assert.throws(() => sync.preview({ provider: 'grok-build', modelIds: ['gpt-6-sol'] }), /supports openai-codex only/);
  assert.throws(() => sync.preview({ provider: 'openai-codex', modelIds: [] }), /at least one model/);
  assert.throws(() => sync.preview({ provider: 'openai-codex', modelIds: ['../evil'] }), /malformed/);
  assert.throws(() => sync.preview({ provider: 'openai-codex', modelIds: ['gpt-6-sol', 'gpt-6-sol'] }), /more than once/);
  assert.throws(() => sync.preview({ provider: 'openai-codex', modelIds: ['gpt-5.6-terra'] }), /verified Codex catalog/);
});

test('models.apply: one atomic field write, idempotent retry, no half list', async () => {
  const { settings, sync } = syncFixture({ models: [{ id: 'gpt-6-astra' }] });
  const preview = sync.preview({ provider: 'openai-codex', modelIds: ['gpt-6-sol'] });
  const result = await sync.apply({ provider: 'openai-codex', modelIds: ['gpt-6-sol'],
    catalogRevision: preview.catalogRevision, settingsRevision: preview.settingsRevision, digest: preview.digest });
  assert.equal(result.applied, 1);
  assert.equal(result.settingsRevision, 1);
  const written = settings.value['llm-pi-ai'].providers['openai-codex'].models;
  assert.deepEqual(written.map(model => model.id), ['gpt-6-astra', 'gpt-6-sol']);
  // A single set op on the models field only — through the public adapter,
  // so the op carries the full Settings path, never a whole-route write-back.
  assert.equal(settings.forms.calls.length, 1);
  const ops = settings.forms.calls[0].ops;
  assert.equal(ops.length, 1);
  assert.deepEqual(ops[0], { op: 'set', path: ['providers', 'openai-codex', 'models'], value: written });
  // Retrying the same apply after success is a no-op, not a conflict.
  const retry = await sync.apply({ provider: 'openai-codex', modelIds: ['gpt-6-sol'],
    catalogRevision: preview.catalogRevision, settingsRevision: preview.settingsRevision, digest: preview.digest });
  assert.deepEqual([retry.applied, retry.unchanged], [0, true]);
  assert.equal(settings.forms.calls.length, 1);
});

test('models.apply rejects digest and revision drift with fresh-preview guidance', async () => {
  const first = syncFixture({ models: [{ id: 'gpt-6-astra' }] });
  const preview = first.sync.preview({ provider: 'openai-codex', modelIds: ['gpt-6-sol'] });
  await assert.rejects(first.sync.apply({ provider: 'openai-codex', modelIds: ['gpt-6-sol'],
    catalogRevision: preview.catalogRevision, settingsRevision: preview.settingsRevision, digest: 'deadbeef' }),
    { code: 'preview-digest' });
  // Someone else writes between preview and apply: the digest embeds the
  // Settings revision, so drift rejects as a stale preview demanding a fresh
  // one (the revision check stays as defense-in-depth inside apply).
  await first.settings.forms.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'openai-codex', 'displayName'], value: 'X' }], 0);
  const stale = first.sync.preview({ provider: 'openai-codex', modelIds: ['gpt-6-sol'] });
  assert.equal(stale.settingsRevision, 1);
  const forged = { provider: 'openai-codex', modelIds: ['gpt-6-sol'],
    catalogRevision: stale.catalogRevision, settingsRevision: 0, digest: stale.digest };
  await first.settings.forms.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'openai-codex', 'displayName'], value: 'Y' }], 1);
  await assert.rejects(first.sync.apply(forged), { code: 'preview-digest' });
  await assert.rejects(first.sync.apply({ provider: 'openai-codex', modelIds: ['gpt-6-sol'],
    catalogRevision: 'codex-native-catalog/older', settingsRevision: 2, digest: 'x' }), { code: 'catalog-revision' });
});

test('models.apply failure leaves the previous list intact', async () => {
  const { settings, sync } = syncFixture({ models: [{ id: 'gpt-6-astra' }] });
  settings.forms.mutate = async () => { throw new Error('boom'); };
  const preview = sync.preview({ provider: 'openai-codex', modelIds: ['gpt-6-sol'] });
  await assert.rejects(sync.apply({ provider: 'openai-codex', modelIds: ['gpt-6-sol'],
    catalogRevision: preview.catalogRevision, settingsRevision: preview.settingsRevision, digest: preview.digest }), /boom/);
  assert.deepEqual(settings.value['llm-pi-ai'].providers['openai-codex'].models, [{ id: 'gpt-6-astra' }]);
});

test('catalogStatus reports configuration state without route values', () => {
  const { sync } = syncFixture({ models: [{ id: 'gpt-6-sol', name: 'My Sol' }] });
  const status = sync.catalogStatus('openai-codex', [{ id: 'gpt-6-sol' }]);
  assert.equal(status.providerId, 'openai-codex');
  assert.equal(status.catalogRevision, CODEX_CATALOG_REVISION);
  assert.deepEqual(status.models.map(model => [model.id, model.configured]), [['gpt-6-sol', true], ['gpt-6-luna', false]]);
  assert.deepEqual(Object.keys(status.models[0]).sort(), ['configured', 'contextWindow', 'id', 'maxTokens', 'name']);
  assert.equal(sync.catalogStatus('grok-build'), undefined);
});

test('duplicate ids inside the existing list are reported, not silently merged', () => {
  const { sync } = syncFixture({ models: [{ id: 'gpt-6-sol' }, { id: 'gpt-6-sol' }] });
  const preview = sync.preview({ provider: 'openai-codex', modelIds: ['gpt-6-sol'] });
  // The first entry fills; the duplicate stays visible in the target so the
  // host's own duplicate validation remains the authority.
  assert.equal(preview.models[0].action, 'fill');
  assert.deepEqual(preview.targetIds, ['gpt-6-sol', 'gpt-6-sol']);
});
