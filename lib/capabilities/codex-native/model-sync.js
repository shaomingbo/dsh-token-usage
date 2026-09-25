/** Explicit, revision-bound model synchronization for Codex routes.
 *
 * A persistent-repair entry point, not a boot-time migration: boot
 * provisioning keeps filling only absent fields and never restores a model a
 * user removed; this module performs one user-selected, preview-bound write
 * through the public Settings mutation seam.
 *
 * Contract (models.preview / models.apply on /account-usage):
 * - `preview({ provider, modelIds })` reads the current Settings snapshot,
 *   classifies each selected id against the owner's verified catalog, and
 *   returns the exact target list plus a digest binding catalog revision,
 *   Settings revision, selection, and diff.
 * - `apply({ provider, modelIds, catalogRevision, settingsRevision, digest })`
 *   re-derives the preview from live state. A matching digest performs one
 *   atomic `settings.mutate` at the previewed revision; drift rejects with
 *   `settings-conflict` and demands a fresh preview. A target that is already
 *   fully in place is an idempotent no-op success.
 *
 * Writes preserve order, user overrides, old ids, custom models, and any
 * deliberate removal of unselected models. Only per-model fields the catalog
 * verifies are ever set, and only on selected ids; nothing else in the route
 * (credentials, headers, endpoints) is touched, so redacted secrets elsewhere
 * in the namespace are never replayed.
 */
import { createHash } from 'node:crypto';
import { CODEX_CATALOG_REVISION, codexCatalogEntries, dshModelProfile, findCodexCatalogModel } from './catalog.js';

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const FIELD_KEYS = Object.freeze(['name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts']);
const SUPPORTED_PROVIDERS = Object.freeze(['openai-codex']);

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function isPlainEntry(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Selection validation: non-empty, well-formed, distinct, catalog-verified. */
function normalizeSelection(provider, modelIds) {
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw fail('unsupported-provider', `Model synchronization supports ${SUPPORTED_PROVIDERS.join(', ')} only, not ${JSON.stringify(provider)}.`);
  }
  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    throw fail('empty-selection', 'Select at least one model to synchronize.');
  }
  const seen = new Set();
  for (const id of modelIds) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      throw fail('malformed-model-id', `Model id ${JSON.stringify(id)} is malformed.`);
    }
    if (seen.has(id)) throw fail('duplicate-model-id', `Model ${id} was selected more than once.`);
    seen.add(id);
    if (!findCodexCatalogModel(id)) {
      throw fail('unknown-model', `Model ${id} is not in the owner's verified Codex catalog.`);
    }
  }
  return [...seen];
}

/** Fields of an existing entry the catalog would set but the entry leaves unset. */
function missingFields(entry, profile) {
  if (!isPlainEntry(entry) || typeof entry.id !== 'string') return null;
  if (entry.id !== profile.id) return null;
  const missing = {};
  for (const key of FIELD_KEYS) if (entry[key] === undefined) missing[key] = profile[key];
  return Object.keys(missing).length ? missing : undefined;
}

/** The whole resulting `models` list for a selection, or null when unchanged. */
function targetList(current, selection, profiles) {
  const next = current.map(entry => {
    const fill = isPlainEntry(entry) ? missingFields(entry, profiles[entry.id] ?? { id: undefined }) : undefined;
    return fill === undefined || fill === null ? entry : { ...entry, ...fill };
  });
  for (const id of selection) {
    if (next.some(entry => isPlainEntry(entry) && entry.id === id)) continue;
    next.push(profiles[id]);
  }
  if (next.length === current.length && next.every((entry, index) => entry === current[index])) return { list: null };
  return { list: next };
}

export function createCodexModelSync({ providerSettings, defaultRouteModels, logger = {} } = {}) {
  if (typeof providerSettings?.read !== 'function' || typeof providerSettings?.mutate !== 'function') {
    throw new Error('createCodexModelSync requires the public provider Settings adapter');
  }
  if (typeof defaultRouteModels !== 'function') {
    throw new Error('createCodexModelSync requires the normalized default route models');
  }

  function snapshot(provider) {
    const read = providerSettings.read(provider);
    if (!read) {
      throw fail('settings-unavailable', `Settings for ${provider} are unavailable in this host.`);
    }
    return read;
  }

  function classify(selection, snapshotValue, provider) {
    const profiles = Object.fromEntries(selection.map(id => [id, dshModelProfile(id)]));
    const raw = snapshotValue?.models;
    // An absent `models` list means the route serves the installed catalog.
    // Serving a verified id the installed catalog lacks requires an explicit
    // list, so the target materializes exactly the normalized defaults (what
    // boot provisioning would fill) plus the selection — shown in the preview.
    const basis = !Array.isArray(raw) ? 'absent' : raw.length === 0 ? 'empty' : 'existing';
    const current = Array.isArray(raw) ? raw : structuredClone(defaultRouteModels(provider));
    const { list } = targetList(current, selection, profiles);
    const models = selection.map(id => {
      const existing = current.find(entry => isPlainEntry(entry) && entry.id === id);
      const profile = profiles[id];
      if (existing === undefined) {
        return { id, name: profile.name, action: 'add', fields: profile,
          note: basis === 'absent' ? 'appended to the materialized default list' : 'appended to the existing list' };
      }
      const fill = missingFields(existing, profile);
      return fill === undefined
        ? { id, name: profile.name, action: 'none', fields: {} }
        : { id, name: profile.name, action: 'fill', fields: fill };
    });
    const changed = models.some(model => model.action !== 'none') || basis === 'absent';
    return { profiles, current, target: list, basis, models, changed };
  }

  function digest(provider, selection, revision, models, target, basis) {
    return createHash('sha256').update(JSON.stringify({
      v: 1, provider, catalogRevision: CODEX_CATALOG_REVISION,
      selection, revision, basis,
      models: models.map(model => ({ id: model.id, action: model.action, fields: model.fields })),
      target: target ?? null,
    })).digest('hex');
  }

  function preview({ provider, modelIds } = {}) {
    const selection = normalizeSelection(provider, modelIds);
    const read = snapshot(provider);
    const result = classify(selection, read.value, provider);
    const ids = list => (list ?? []).map(entry => (isPlainEntry(entry) && typeof entry.id === 'string' ? entry.id : undefined));
    return {
      provider,
      catalogRevision: CODEX_CATALOG_REVISION,
      settingsRevision: read.revision,
      basis: result.basis,
      changed: result.changed,
      // An absent list has no configured ids; the preview still shows the
      // materialized target so the apply is fully informed.
      currentIds: result.basis === 'absent' ? null : ids(result.current),
      targetIds: ids(result.target ?? result.current),
      models: result.models,
      digest: digest(provider, selection, read.revision, result.models, result.target, result.basis),
    };
  }

  async function apply({ provider, modelIds, catalogRevision, settingsRevision, digest: expectedDigest } = {}) {
    const selection = normalizeSelection(provider, modelIds);
    if (catalogRevision !== CODEX_CATALOG_REVISION) {
      throw fail('catalog-revision', `Catalog revision ${JSON.stringify(catalogRevision)} does not match ${CODEX_CATALOG_REVISION}; preview again.`);
    }
    const read = snapshot(provider);
    const result = classify(selection, read.value, provider);
    // Idempotent no-op: the target is already fully in place. Reported even
    // after a later revision bump, because an identical write changes nothing.
    if (!result.changed && result.target === null) {
      return { provider, applied: 0, settingsRevision: read.revision, unchanged: true };
    }
    if (expectedDigest !== digest(provider, selection, read.revision, result.models, result.target, result.basis)) {
      throw fail('preview-digest', 'The preview digest does not match the live route; preview again and reapply.');
    }
    if (settingsRevision !== read.revision) {
      throw fail('settings-conflict', `Settings revision changed (preview ${JSON.stringify(settingsRevision)}, live ${read.revision}); preview again.`);
    }
    const value = result.target ?? result.current;
    if (!Array.isArray(value)) throw fail('invalid-target', 'The synchronized model list is not a list.');
    const before = JSON.stringify(read.value?.models ?? null);
    const next = JSON.stringify(value);
    if (before === next) return { provider, applied: 0, settingsRevision: read.revision, unchanged: true };
    await providerSettings.mutate(read, [{ op: 'set', path: ['models'], value }]);
    const after = providerSettings.read(provider);
    logger.info?.('dsh-token-usage: synchronized %s models for %s (revision %s)', selection.join(','), provider, after?.revision ?? 'unknown');
    return { provider, applied: selection.length, settingsRevision: after?.revision ?? null, unchanged: false };
  }

  /** Catalog facts for settings surfaces; never a credentials or route value. */
  function catalogStatus(provider, configuredIds) {
    if (!SUPPORTED_PROVIDERS.includes(provider)) return undefined;
    const source = Array.isArray(configuredIds) ? configuredIds : [];
    const ids = source.map(entry => (isPlainEntry(entry) && typeof entry.id === 'string' ? entry.id : undefined)).filter(id => id !== undefined);
    const configured = new Set(ids);
    return {
      providerId: provider,
      catalogRevision: CODEX_CATALOG_REVISION,
      models: codexCatalogEntries().map(entry => ({
        id: entry.id,
        name: entry.name,
        contextWindow: entry.contextWindow,
        maxTokens: entry.maxTokens,
        configured: configured.has(entry.id),
      })),
    };
  }

  return { preview, apply, catalogStatus, CODEX_CATALOG_REVISION };
}
