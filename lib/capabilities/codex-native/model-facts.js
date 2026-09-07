/** Owner-internal trusted model-facts seam for the codex-native runtime.
 * Reads ONLY public configured profile fields (PiAiModelProfile shape) and,
 * when available, host-resolved LlmResolvedModelInfo as a cross-check.
 * Whitelisted output: id/name/contextWindow/maxTokens/input/reasoningEfforts.
 * No URLs beyond the fixed official base comparison, no headers, no
 * credentials, no fetch — and conflicts or invalid values become explicit
 * fixed-vocabulary gaps instead of invented values.
 */
const OFFICIAL_CODEX_BASE = 'https://chatgpt.com/backend-api';

const positiveCapacity = value => Number.isInteger(value) && value > 0 && value <= 100_000_000;

export function createCodexModelFacts({ getSettings, resolveModelInfo, credentialRef }) {
  if (typeof getSettings !== 'function' || typeof credentialRef !== 'string' || !credentialRef) {
    throw new Error('createCodexModelFacts requires getSettings() and the openai-codex credential ref');
  }
  const routeStatus = () => {
    let section;
    try { section = getSettings('llm-pi-ai'); } catch { return { ok: false, reason: 'ROUTE_MISSING' }; }
    const route = section && typeof section === 'object' && section.providers && typeof section.providers === 'object'
      ? section.providers['openai-codex']
      : undefined;
    if (!route || typeof route !== 'object' || Array.isArray(route)) return { ok: false, reason: 'ROUTE_MISSING' };
    if (route.apiKeyEnv !== credentialRef) return { ok: false, reason: 'ROUTE_AUTH' };
    if (route.api !== undefined) return { ok: false, reason: 'ROUTE_PROTOCOL' };
    if (route.baseURL !== undefined && route.baseURL !== OFFICIAL_CODEX_BASE) return { ok: false, reason: 'ROUTE_ENDPOINT' };
    return { ok: true, route };
  };
  const resolveModelFacts = async (id, signal) => {
    const { ok, reason, route } = routeStatus();
    if (!ok) return { gap: reason };
    const entry = Array.isArray(route.models)
      ? route.models.find(item => item && typeof item === 'object' && !Array.isArray(item) && item.id === id)
      : undefined;
    let resolved;
    if (typeof resolveModelInfo === 'function') {
      try { resolved = await resolveModelInfo('openai-codex', id, signal); } catch { resolved = undefined; }
    }
    // Neither a configured profile entry nor a host-resolved model: this id
    // is simply not a configured model, so the runtime reports UNKNOWN_MODEL
    // rather than a metadata gap.
    if (entry === undefined && resolved === undefined) return undefined;
    const facts = { id };
    if (entry?.name !== undefined) {
      if (typeof entry.name !== 'string' || !entry.name || entry.name.length > 256) return { gap: 'PROFILE_INVALID' };
      facts.name = entry.name;
    }
    const windows = [entry?.contextWindow, resolved?.context?.contextWindow].filter(value => value !== undefined);
    if (windows.some(value => !positiveCapacity(value))) return { gap: 'PROFILE_INVALID' };
    if (new Set(windows).size > 1) return { gap: 'METADATA_CONFLICT' };
    if (windows.length) facts.contextWindow = windows[0];
    const outputs = [entry?.maxTokens, resolved?.defaultMaxTokens].filter(value => value !== undefined);
    if (outputs.some(value => !positiveCapacity(value))) return { gap: 'PROFILE_INVALID' };
    if (new Set(outputs).size > 1) return { gap: 'METADATA_CONFLICT' };
    if (outputs.length) facts.maxTokens = outputs[0];
    // The public PiAiModelProfile contract treats an input field that is absent
    // OR an empty array as "not declared" (the host schema materializes an
    // omitted list entry to []); both inherit the catalog/host default. Only
    // a nonempty declaration is an explicit override.
    const declaredInput = Array.isArray(entry?.input) ? (entry.input.length > 0 ? entry.input : undefined) : entry?.input;
    if (declaredInput !== undefined) facts.input = declaredInput;
    else if (Array.isArray(resolved?.inputModalities)) facts.input = [...resolved.inputModalities];
    if (entry?.reasoningEfforts !== undefined) facts.reasoningEfforts = entry.reasoningEfforts;
    return facts;
  };
  return { resolveModelFacts, routeStatus, OFFICIAL_CODEX_BASE };
}
