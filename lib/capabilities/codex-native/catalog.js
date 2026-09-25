/** Versioned owner-verified Codex model facts: one source, two projections.
 *
 * The pinned pi-ai-codex-native 0.84.4 catalog predates gpt-6-sol /
 * gpt-6-luna (released 2026-09-22; see the upstream verification record in
 * research/codex-model-catalog-20260924-upstream.md, whose tarball SHA1s are
 * bound to the npm registry metadata). Those two ids carry their full fields
 * from the upstream-verified 0.87.1 catalog — but only the facts below, never
 * the raw upstream object, and never the public API's 1,050,000 context.
 *
 * Projections:
 * - `dshModelProfile` emits a DSH configuration model profile (the public
 *   Settings/`PiAiModelProfile` shape: name, contextWindow, maxTokens, input,
 *   reasoningEfforts). Raw pi-ai catalog objects are never valid here.
 * - `nativeModelFacts` emits the whitelisted custom-model facts the native
 *   runtime merges onto its pinned protocol template to build an executable
 *   descriptor.
 *
 * No URLs, headers, credentials or fetch. Facts are frozen at module scope.
 */

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/** Effort projection verified for both new ids: off→none, minimal→low. */
const SOLUNA_REASONING_EFFORTS = Object.freeze({
  off: 'none', minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
});

function verifiedModel(id, name, reasoningEfforts) {
  return Object.freeze({
    id, name,
    api: 'openai-codex-responses',
    reasoning: true,
    input: Object.freeze(['text', 'image']),
    contextWindow: 272_000,
    maxTokens: 128_000,
    reasoningEfforts,
  });
}

/** Verified catalog entries beyond the pinned 0.84.4 set, in served order. */
const VERIFIED_ENTRIES = Object.freeze([
  verifiedModel('gpt-6-sol', 'GPT-6 Sol', SOLUNA_REASONING_EFFORTS),
  verifiedModel('gpt-6-luna', 'GPT-6 Luna', SOLUNA_REASONING_EFFORTS),
]);

/** Bumped whenever verified facts change; apply binds previews to it. */
export const CODEX_CATALOG_REVISION = 'codex-native-catalog/2026-09-24.1';

export function codexCatalogEntries() {
  return VERIFIED_ENTRIES.map(entry => structuredClone(entry));
}

export function findCodexCatalogModel(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return undefined;
  return VERIFIED_ENTRIES.find(entry => entry.id === id);
}

/** DSH configuration projection (Settings model profile shape). */
export function dshModelProfile(id) {
  const facts = findCodexCatalogModel(id);
  if (!facts) throw new Error(`codex catalog: ${JSON.stringify(id)} is not a verified entry`);
  return {
    id: facts.id,
    name: facts.name,
    contextWindow: facts.contextWindow,
    maxTokens: facts.maxTokens,
    input: [...facts.input],
    reasoningEfforts: { ...facts.reasoningEfforts },
  };
}

/** Whitelisted native custom-model facts for the pinned-template merge. */
export function nativeModelFacts(id) {
  const facts = findCodexCatalogModel(id);
  if (!facts) return undefined;
  return {
    id: facts.id,
    name: facts.name,
    contextWindow: facts.contextWindow,
    maxTokens: facts.maxTokens,
    input: [...facts.input],
    reasoningEfforts: { ...facts.reasoningEfforts },
  };
}
