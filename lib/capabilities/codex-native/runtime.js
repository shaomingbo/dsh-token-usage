import { createHash } from 'node:crypto';
import { createAssistantMessageEventStream } from 'pi-ai-codex-native';
import { openaiCodexProvider } from 'pi-ai-codex-native/providers/openai-codex';
import { convertResponsesMessages, convertResponsesTools } from 'pi-ai-codex-native/api/openai-responses-shared';
import { encodeCheckpoint, decodeCheckpoint, validateCheckpoint, estimateCheckpoint } from './checkpoint.js';
import { NativeTransport } from './native-transport.js';
import { operationDiagnostics } from './diagnostics.js';

const PROTOCOL = 'codex-runtime/v1';
const ROUTE = 'codex-native-lab';
const PROVIDER = 'openai-codex';
export const OFFICIAL_BASE_URL = 'https://chatgpt.com/backend-api';
const ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
const BASE = OFFICIAL_BASE_URL;
const MODEL_TEMPLATE_ID = 'gpt-5.3-codex-spark';
const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
function failure(code, detail) {
  const base = code === 'NOT_CONFIGURED' ? 'Sign in to ChatGPT in Accounts & Usage before using Codex Native Lab.' : `Codex runtime: ${code}`;
  return Object.assign(new Error(detail === undefined ? base : `${base} (${detail})`), { code: `CODEX_RUNTIME_${code}` });
}
function requireValue(value, code, detail) { if (!value) throw failure(code, detail); }
function race(signal, action) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(failure('CANCELLED'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { requireValue(!signal.aborted, 'CANCELLED'); return action(); })
      .then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function attributionHeaders(value) {
  const result = {};
  try {
    const ua = new Headers(value).get('user-agent');
    if (ua && ua.length <= 256 && /^deepseek-harness\/[a-zA-Z0-9.+_-]+ \(\+https:\/\/github\.com\/deepseek-ai\/deepseek-harness\)$/.test(ua)) result['user-agent'] = ua;
  } catch { /* Invalid/untrusted attribution is omitted, never reflected. */ }
  return result;
}
function accountFrom(auth) {
  requireValue(typeof auth?.apiKey === 'string' && auth.apiKey.length <= 32_768 && !/[\r\n]/.test(auth.apiKey), 'AUTH_INVALID');
  let accountId;
  try { accountId = JSON.parse(Buffer.from(auth.apiKey.split('.')[1], 'base64url').toString('utf8'))['https://api.openai.com/auth']?.chatgpt_account_id; }
  catch { throw failure('AUTH_INVALID'); }
  requireValue(typeof accountId === 'string' && !!accountId.trim() && accountId.length <= 256 && !/[\r\n]/.test(accountId), 'AUTH_INVALID');
  let header;
  try { header = new Headers(auth.headers).get('chatgpt-account-id'); } catch { throw failure('AUTH_INVALID'); }
  requireValue(header === null || header === accountId, 'ACCOUNT_MISMATCH');
  return { accessToken: auth.apiKey, accountId,
    identity: createHash('sha256').update(`dsh-codex-compaction/identity/v1\0${accountId}`).digest('hex') };
}

// Whitelisted custom-model facts (no URLs, headers, credentials or fetch).
// Only the fields below may cross the owner seam; anything else is refused.
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const MODALITIES = new Set(['text', 'image']);
function customModel(facts, id, template, { pinned = false } = {}) {
  const where = `custom model ${JSON.stringify(id)}`;
  requireValue(facts && typeof facts === 'object' && !Array.isArray(facts) && facts.id === id && ID_PATTERN.test(id), 'MODEL_METADATA', `${where}: id mismatch or malformed`);
  const positive = (value, field) => {
    requireValue(Number.isInteger(value) && value > 0 && value <= 100_000_000, 'MODEL_METADATA', `${where}: ${field} must be a positive integer`);
    return value;
  };
  const model = { ...structuredClone(template), id,
    name: typeof facts.name === 'string' && facts.name.trim() && facts.name.length <= 256 ? facts.name : id,
    contextWindow: positive(facts.contextWindow, 'contextWindow'),
    maxTokens: positive(facts.maxTokens, 'maxTokens'),
    baseUrl: BASE };
  if (facts.input !== undefined) {
    requireValue(Array.isArray(facts.input) && facts.input.length > 0 && facts.input.every(m => MODALITIES.has(m)), 'MODEL_METADATA', `${where}: input modalities must be a nonempty subset of text/image`);
    model.input = [...facts.input];
  } else model.input = ['text'];
  // Profile reasoningEfforts maps onto pi's Model fields: a nonempty dict is
  // thinkingLevelMap plus reasoning=true; `false` (and, for hand-declared
  // custom models, absence) declares a non-reasoning model. A pinned catalog
  // entry's own capability survives only when the profile sets nothing.
  if (facts.reasoningEfforts === undefined && pinned) {
    // Keep the pinned entry's reasoning capability.
  } else if (facts.reasoningEfforts === undefined || facts.reasoningEfforts === false) {
    model.reasoning = false;
    delete model.thinkingLevelMap;
  } else {
    requireValue(facts.reasoningEfforts && typeof facts.reasoningEfforts === 'object' && !Array.isArray(facts.reasoningEfforts)
      && Object.keys(facts.reasoningEfforts).length > 0, 'MODEL_METADATA', `${where}: reasoningEfforts must be false or a nonempty mapping`);
    const efforts = {};
    for (const [level, wire] of Object.entries(facts.reasoningEfforts)) {
      requireValue(typeof level === 'string' && level.length > 0 && level.length <= 32
        && (wire === null || (typeof wire === 'string' && wire.length > 0 && wire.length <= 64)), 'MODEL_METADATA', `${where}: invalid reasoningEfforts entry`);
      efforts[level] = wire;
    }
    model.reasoning = true;
    model.thinkingLevelMap = efforts;
  }
  return model;
}
function prepareReplay(replay, binding) {
  requireValue(Array.isArray(replay) && replay.length <= 1024, 'REPLAY_INVALID');
  const replacements = new Map();
  for (const entry of replay) {
    requireValue(typeof entry?.placeholder === 'string' && entry.placeholder.length > 0 && entry.placeholder.length <= 256 && !replacements.has(entry.placeholder), 'REPLAY_INVALID');
    const record = typeof entry.checkpoint === 'string' ? decodeCheckpoint(entry.checkpoint, binding) : validateCheckpoint(entry.checkpoint, binding);
    requireValue(record, 'REPLAY_INVALID');
    replacements.set(entry.placeholder, record.items);
  }
  return replacements;
}
function expandReplay(input, replacements) {
  requireValue(Array.isArray(input), 'REPLAY_INVALID');
  const seen = new Set();
  const output = input.flatMap(item => {
    if (item?.role !== 'user' || !Array.isArray(item.content)) return [item];
    const matches = item.content.filter(part => part.type === 'input_text' && replacements.has(part.text));
    if (!matches.length) return [item];
    requireValue(matches.length === 1 && item.content.length === 1 && !seen.has(matches[0].text), 'REPLAY_INVALID');
    seen.add(matches[0].text);
    return structuredClone(replacements.get(matches[0].text));
  });
  requireValue(seen.size === replacements.size, 'REPLAY_INVALID');
  return output;
}
function mapNativeUsage(usage) {
  const result = emptyUsage();
  const numeric = value => Number.isFinite(value) && value >= 0 ? value : 0;
  result.cacheRead = numeric(usage?.input_tokens_details?.cached_tokens);
  result.input = Math.max(0, numeric(usage?.input_tokens) - result.cacheRead);
  result.output = numeric(usage?.output_tokens);
  result.totalTokens = numeric(usage?.total_tokens);
  return result;
}
function newMessage(model) {
  return { role: 'assistant', content: [], api: model.api, provider: PROVIDER, model: model.id,
    usage: emptyUsage(), stopReason: 'stop', timestamp: Date.now() };
}
// Snapshot SDK events before exposing them: SDK partials mutate; diagnostics may
// contain upstream error bodies. Only normal pi event/message fields cross out.
function safeEvent(event, model, secrets) {
  const scrubText = value => {
    if (typeof value !== 'string') return value;
    for (const secret of secrets) if (secret) value = value.split(secret).join('[redacted]');
    return value;
  };
  const protect = value => {
    const check = node => {
      if (typeof node === 'string') requireValue(!secrets.some(secret => secret && node.includes(secret)), 'UPSTREAM_FAILED');
      else if (node && typeof node === 'object') for (const [key, item] of Object.entries(node)) { check(key); check(item); }
    };
    check(value);
    return structuredClone(value);
  };
  const block = value => {
    // Business JSON keys (including headers/cookies/error) and opaque replay
    // signatures are not diagnostics. Preserve them byte-for-byte or fail;
    // never "sanitize" a tool invocation into a different executable request.
    const copy = structuredClone(value);
    const textKey = copy.type === 'text' ? 'text' : copy.type === 'thinking' ? 'thinking' : undefined;
    if (!textKey) return protect(copy);
    const text = copy[textKey]; delete copy[textKey];
    protect(copy);
    copy[textKey] = scrubText(text);
    return copy;
  };
  const message = value => {
    const result = newMessage(model);
    if (value?.content) result.content = value.content.map(block);
    for (const key of ['usage', 'stopReason', 'timestamp', 'responseId']) if (value?.[key] !== undefined) result[key] = protect(value[key]);
    return result;
  };
  const result = { type: event.type };
  for (const key of ['contentIndex', 'toolCall', 'reason']) if (event[key] !== undefined) result[key] = protect(event[key]);
  for (const key of ['delta', 'content']) if (event[key] !== undefined) {
    result[key] = /^(text|thinking)_/.test(event.type) ? scrubText(event[key]) : protect(event[key]);
  }
  if (event.partial) result.partial = message(event.partial);
  if (event.message) result.message = message(event.message);
  return result;
}
/** Owner-local dependencies only. No DSH import, grant store, ambient OAuth or
 * consumer fetch seam. Models/describe/codec never resolve auth or use network.
 * ready: boolean, promise, or callback; false fails closed, promises await the
 * operation deadline. modelProvider is an owner test seam, not an open option.
 * resolveModelFacts/routeStatus are owner-internal seams supplying whitelisted
 * custom-model facts (e.g. host-configured Astra/Sol profiles) and the official
 * standard-route verdict; consumers still pass bare model ids and never see
 * endpoints, headers or credentials.
 */
export function createCodexRuntime({ resolveOAuth, configured, ready = true, fetchImpl = globalThis.fetch,
  timeoutMs = 30_000, setupTimeoutMs = Math.min(timeoutMs, 120_000),
  compactionTimeoutMs = Math.min(timeoutMs, 300_000), modelProvider, attribution, resolveModelFacts, routeStatus } = {}) {
  requireValue(typeof resolveOAuth === 'function' && typeof configured === 'function' && typeof fetchImpl === 'function', 'CONFIG');
  requireValue(resolveModelFacts === undefined || typeof resolveModelFacts === 'function', 'CONFIG');
  requireValue(routeStatus === undefined || typeof routeStatus === 'function', 'CONFIG');
  requireValue(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 1_800_000, 'CONFIG');
  requireValue(Number.isInteger(setupTimeoutMs) && setupTimeoutMs > 0 && setupTimeoutMs <= 120_000, 'CONFIG');
  requireValue(Number.isInteger(compactionTimeoutMs) && compactionTimeoutMs > 0 && compactionTimeoutMs <= 300_000, 'CONFIG');
  const pinned = openaiCodexProvider();
  const base = modelProvider ?? pinned;
  requireValue(base.id === PROVIDER && typeof base.streamSimple === 'function', 'CONFIG');
  // Executable descriptors always come from pinned pi, never consumer objects.
  const catalog = pinned.getModels().map(model => ({ ...structuredClone(model), baseUrl: BASE }));
  const template = catalog.find(model => model.id === MODEL_TEMPLATE_ID) ?? catalog[0];
  const staticAttribution = attributionHeaders(attribution);
  const operations = new Set(); let disposed = false;
  const models = () => catalog.map(model => {
    const { headers, ...safe } = structuredClone(model);
    return safe;
  });
  // Fixed metadata-gap vocabulary; resolver exceptions never leak their text.
  const METADATA_GAPS = new Set(['CONTEXT_WINDOW', 'MAX_TOKENS', 'PROFILE_INVALID', 'METADATA_CONFLICT', 'PROVIDER_MISMATCH', 'ROUTE_MISSING', 'ROUTE_AUTH', 'ROUTE_PROTOCOL', 'ROUTE_ENDPOINT']);
  // Catalog ids serve as pinned templates; explicitly configured profile
  // facts still override a pinned entry's whitelisted fields (e.g. Sol's
  // configured reasoning efforts), with conflicts reported as concrete gaps.
  async function resolveModel(id, signal) {
    const pinnedModel = catalog.find(item => item.id === id);
    if (resolveModelFacts === undefined) {
      if (pinnedModel) return pinnedModel;
      throw failure('UNKNOWN_MODEL', `model ${JSON.stringify(id)} is not in the pinned native catalog`);
    }
    let facts;
    try { facts = await resolveModelFacts(id, signal); }
    catch { throw failure('MODEL_METADATA', `model ${JSON.stringify(id)} metadata could not be resolved`); }
    if (facts === false || facts === undefined || facts === null) {
      if (pinnedModel) return pinnedModel;
      throw failure('UNKNOWN_MODEL', `model ${JSON.stringify(id)} is not in the pinned native catalog or the configured model profiles`);
    }
    if (facts.gap !== undefined) {
      if (!METADATA_GAPS.has(facts.gap)) throw failure('MODEL_METADATA', `model ${JSON.stringify(id)} reported an unmapped metadata gap`);
      throw failure('MODEL_METADATA', `model ${JSON.stringify(id)} configured facts incomplete: ${facts.gap}`);
    }
    if (pinnedModel) {
      // Explicit profile facts win per field; unset fields keep the pinned
      // entry's values (api/compat/template come from the pinned entry).
      const merged = {
        id,
        name: facts.name ?? pinnedModel.name,
        contextWindow: facts.contextWindow ?? pinnedModel.contextWindow,
        maxTokens: facts.maxTokens ?? pinnedModel.maxTokens,
        input: facts.input ?? pinnedModel.input,
        ...(facts.reasoningEfforts !== undefined ? { reasoningEfforts: facts.reasoningEfforts } : {}),
      };
      return customModel(merged, id, pinnedModel, { pinned: true });
    }
    return customModel(facts, id, template);
  }
  async function open({ model, signal, purpose = 'request' } = {}) {
    requireValue(!disposed, 'DISPOSED');
    requireValue(purpose === 'request' || purpose === 'compaction', 'PURPOSE');
    const leaseTimeoutMs = purpose === 'compaction' ? compactionTimeoutMs : timeoutMs;
    const id = typeof model === 'string' ? model : model?.id;
    requireValue(typeof id === 'string' && ID_PATTERN.test(id), 'UNKNOWN_MODEL');
    const controller = new AbortController();
    const diagnostics = operationDiagnostics();
    diagnostics.observe('budget', leaseTimeoutMs);
    const setupBudgetMs = purpose === 'request' ? Math.min(setupTimeoutMs, leaseTimeoutMs) : undefined;
    if (setupBudgetMs !== undefined) diagnostics.observe('setup-budget', setupBudgetMs);
    const diagnosedFailure = code => Object.assign(failure(code), { diagnostics: diagnostics.snapshot() });
    let credentials, closed = false, stopReason, active, setupTimer;
    let compactUsage = { kind: 'unavailable' };
    const externalAbort = () => stop('CANCELLED');
    // Absolute lifetime: neither output nor retries/provider reuse renew it.
    const timer = setTimeout(() => stop('TIMEOUT', 'total'), leaseTimeoutMs);
    if (setupBudgetMs !== undefined && setupBudgetMs < leaseTimeoutMs) {
      setupTimer = setTimeout(() => stop('TIMEOUT', 'setup'), setupBudgetMs);
    }
    function stop(reason, timeoutKind) {
      if (closed) return;
      if (timeoutKind) diagnostics.observe('timeout', timeoutKind);
      diagnostics.stop();
      closed = true; stopReason = reason; credentials = undefined; compactUsage = { kind: 'unavailable' };
      clearTimeout(timer); clearTimeout(setupTimer);
      controller.abort(); signal?.removeEventListener('abort', externalAbort); operations.delete(close);
    }
    function close() { stop(disposed ? 'DISPOSED' : 'CLOSED'); }
    function requireOpen() { requireValue(!closed && !disposed, stopReason ?? (disposed ? 'DISPOSED' : 'CLOSED')); }
    operations.add(close);
    signal?.addEventListener('abort', externalAbort, { once: true });
    if (signal?.aborted) externalAbort();
    // Model facts resolution is metadata-only, but it still runs under the
    // operation's cancellation and deadline so it can neither hang an open
    // nor outlive the lease.
    let boundModel;
    try {
      boundModel = await race(controller.signal, () => resolveModel(id, controller.signal));
      requireValue(!closed && !disposed, 'CANCELLED');
    } catch (cause) {
      if (closed) throw diagnosedFailure(stopReason);
      close();
      // The cause is one of our own fixed-code failures; keep its concrete
      // detail instead of re-wrapping it away.
      if (['CODEX_RUNTIME_UNKNOWN_MODEL', 'CODEX_RUNTIME_MODEL_METADATA', 'CODEX_RUNTIME_CANCELLED'].includes(cause?.code)) throw cause;
      throw diagnosedFailure('MODEL_METADATA');
    }
    diagnostics.observe('metadata');
    try {
      credentials = await race(controller.signal, async () => {
        const readiness = await (typeof ready === 'function' ? ready() : ready);
        requireValue(readiness !== false, 'NOT_READY');
        requireValue(!controller.signal.aborted, 'CANCELLED');
        requireValue(await configured(PROVIDER), 'NOT_CONFIGURED');
        requireValue(!controller.signal.aborted, 'CANCELLED');
        const auth = await resolveOAuth(PROVIDER, controller.signal);
        requireValue(!controller.signal.aborted, 'CANCELLED');
        return accountFrom(auth);
      });
      requireValue(!closed && !disposed, 'CANCELLED');
    } catch (cause) {
      if (closed) throw diagnosedFailure(stopReason);
      close();
      const allowed = ['NOT_READY', 'NOT_CONFIGURED', 'AUTH_INVALID', 'ACCOUNT_MISMATCH', 'CANCELLED'];
      const code = allowed.find(code => cause?.code === `CODEX_RUNTIME_${code}`);
      throw diagnosedFailure(code ?? 'AUTH_FAILED');
    }
    clearTimeout(setupTimer); setupTimer = undefined;
    diagnostics.observe('bound');
    const binding = Object.freeze({ provider: ROUTE, model: id, identity: credentials.identity });
    function provider({ mode = 'stream', replay = [] } = {}) {
      requireOpen();
      requireValue(mode === 'stream' || mode === 'compact', 'MODE');
      if (mode === 'compact') compactUsage = { kind: 'unavailable' };
      const replacements = prepareReplay(replay, binding);
      function streamSimple(_callerModel, context, options = {}) {
        const output = createAssistantMessageEventStream();
        const callSignal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
        // One operation handle is a single-flight connection. Acquire before
        // scheduling work so concurrent calls cannot misattribute native usage.
        requireValue(!active, 'BUSY');
        const flight = {}; active = flight;
        compactUsage = { kind: 'unavailable' };
        const release = () => { if (active === flight) active = undefined; };
        const auth = credentials;
        const message = newMessage(boundModel);
        // Operation-local categories survive SDK error wrapping without retaining
        // raw exceptions, response bodies, headers or credential-derived text.
        let failureCategory = 'REQUEST_PREPARE';
        const run = async () => {
          requireOpen();
          requireValue(auth, 'CLOSED');
          diagnostics.observe('prepare');
          // Snapshot public input before SDK work. No caller hook gets owner data.
          const inputContext = structuredClone(context);
          const headers = { ...staticAttribution, ...attributionHeaders(options.headers) };
          const ownFetch = async (url, init = {}) => {
            requireValue(String(url) === ENDPOINT, 'ENDPOINT');
            requireValue(!callSignal.aborted, 'CANCELLED');
            const requestHeaders = new Headers(init.headers);
            requestHeaders.set('Authorization', `Bearer ${auth.accessToken}`);
            requestHeaders.set('ChatGPT-Account-ID', auth.accountId);
            requestHeaders.set('Accept', 'text/event-stream');
            for (const [name, value] of Object.entries(headers)) requestHeaders.set(name, value);
            failureCategory = 'NETWORK';
            diagnostics.observe('request', typeof init.body === 'string' ? Buffer.byteLength(init.body) : undefined);
            const response = await fetchImpl(ENDPOINT, { ...init, headers: requestHeaders, redirect: 'error',
              signal: init.signal ? AbortSignal.any([callSignal, init.signal]) : callSignal });
            diagnostics.observe('headers', response.status);
            failureCategory = !response.ok
              ? (Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? `HTTP_${response.status}` : 'HTTP_ERROR')
              : 'RESPONSE_STREAM';
            // Match the pinned SDK/upstream transports: successful HTTP bodies
            // must pass SSE parsing; a MIME label alone is not protocol proof.
            if (callSignal.aborted || !response.ok) {
              Promise.resolve(response.body?.cancel()).catch(() => {});
              throw failure(callSignal.aborted ? 'CANCELLED' : failureCategory);
            }
            failureCategory = 'RESPONSE_STREAM';
            return response;
          };
          if (mode === 'compact') {
            // Public pi conversion deliberately leaves absent generated fields
            // undefined. Normalize only generated wire JSON, not checkpoints.
            const wire = JSON.parse(JSON.stringify(convertResponsesMessages(boundModel, inputContext, new Set(['openai', PROVIDER, 'opencode']), { includeSystemPrompt: false })));
            const input = expandReplay(wire, replacements);
            const tools = inputContext.tools?.length ? JSON.parse(JSON.stringify(convertResponsesTools(inputContext.tools,
              { strict: null, supportsStrictMode: boundModel.compat?.supportsStrictMode ?? true, supportsOpenAIGrammarTools: false }))) : [];
            const transport = new NativeTransport({ fetch: ownFetch, auth: async () => auth, identity: binding.identity, timeoutMs: Math.min(leaseTimeoutMs, compactionTimeoutMs), observe: diagnostics.observe });
            let result;
            try {
              result = await transport.compact({ ...binding, input, tools, instructions: inputContext.systemPrompt ?? '', signal: callSignal });
            } catch (cause) {
              // Premature EOF or a failed socket read can be retried; malformed
              // JSON, terminal/compaction rejection and limits cannot.
              if (failureCategory === 'RESPONSE_STREAM' && !['SSE_INCOMPLETE', 'SSE_DISCONNECTED'].includes(cause?.code)) failureCategory = 'RESPONSE_PROTOCOL';
              throw cause;
            }
            requireValue(!callSignal.aborted, 'CANCELLED');
            // Opaque native state must never be rewritten. If an upstream echo
            // contains this connection's credentials, fail instead of persisting.
            const nativeJson = JSON.stringify(result.items);
            requireValue(!nativeJson.includes(auth.accessToken) && !nativeJson.includes(auth.accountId), 'UPSTREAM_FAILED');
            const text = encodeCheckpoint({ ...binding, items: result.items });
            output.push({ type: 'start', partial: structuredClone(message) });
            message.content = [{ type: 'text', text: '' }];
            output.push({ type: 'text_start', contentIndex: 0, partial: structuredClone(message) });
            message.content[0].text = text;
            output.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: structuredClone(message) });
            output.push({ type: 'text_end', contentIndex: 0, content: text, partial: structuredClone(message) });
            const observed = ['input_tokens', 'output_tokens', 'total_tokens'].every(key => Number.isFinite(result.usage?.[key]) && result.usage[key] >= 0);
            message.usage = observed ? mapNativeUsage(result.usage) : emptyUsage();
            // Pi requires numeric usage; this explicit marker discloses whether
            // it was actually supplied. Consumers must not label absent as observed.
            message.usageAvailability = observed ? 'observed' : 'unavailable';
            if (observed) compactUsage = { kind: 'observed', usage: {
              inputTokens: message.usage.input, outputTokens: message.usage.output,
              totalTokens: message.usage.totalTokens,
              ...(Number.isFinite(result.usage.input_tokens_details?.cached_tokens) && result.usage.input_tokens_details.cached_tokens >= 0
                ? { cacheReadTokens: message.usage.cacheRead } : {}),
            } };
            release();
            output.push({ type: 'done', reason: 'stop', message });
          } else {
            const safeOptions = {};
            for (const key of ['temperature', 'maxTokens']) if (Number.isFinite(options[key]) && options[key] >= 0) safeOptions[key] = options[key];
            // pi 0.84.4's accepted thinking levels, including 'max'.
            if (['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(options.reasoning)) safeOptions.reasoning = options.reasoning;
            if (typeof options.sessionId === 'string' && options.sessionId.length <= 256) safeOptions.sessionId = options.sessionId;
            if (['none', 'short', 'long'].includes(options.cacheRetention)) safeOptions.cacheRetention = options.cacheRetention;
            const upstream = base.streamSimple(structuredClone(boundModel), inputContext, { ...safeOptions,
              signal: callSignal, apiKey: auth.accessToken, transport: 'sse', maxRetries: 0, fetch: ownFetch,
              onPayload: payload => ({ ...payload, input: expandReplay(payload.input, replacements) }) });
            let terminal = false;
            for await (const event of upstream) {
              requireValue(!callSignal.aborted, 'CANCELLED');
              requireValue(event.type !== 'error' && !event.error && !event.message?.errorMessage && !event.partial?.errorMessage &&
                !['error', 'aborted'].includes(event.message?.stopReason), 'UPSTREAM_FAILED');
              const safe = safeEvent(event, boundModel, [auth.accessToken, auth.accountId]);
              if (event.type === 'done') { terminal = true; release(); }
              output.push(safe);
              if (terminal) break;
            }
            requireValue(terminal, 'UPSTREAM_FAILED');
          }
        };
        // A consumer cancellation ends this operation, not just one attempt.
        // Detach on settlement so a later abort cannot cancel a completed call.
        const callAbort = () => stop('CANCELLED');
        options.signal?.addEventListener('abort', callAbort, { once: true });
        if (options.signal?.aborted) callAbort();
        void race(callSignal, run).catch(() => {
          if (active === flight) compactUsage = { kind: 'unavailable' };
          release();
          const failed = newMessage(boundModel);
          failed.stopReason = callSignal.aborted ? 'aborted' : 'error';
          failed.errorMessage = `CODEX_RUNTIME_${stopReason ?? (callSignal.aborted ? 'CANCELLED' : failureCategory)}`;
          output.push({ type: 'error', reason: failed.stopReason, error: failed });
        }).finally(() => { options.signal?.removeEventListener('abort', callAbort); release(); output.end(); });
        return output;
      }
      return Object.freeze({ id: PROVIDER, name: 'Owner-bound Codex Native', baseUrl: BASE,
        auth: Object.freeze({ apiKey: Object.freeze({ name: 'Owner-bound connection', resolve: async () => {
          requireOpen(); return { auth: {} };
        } }) }),
        // The bound model itself — including resolver-materialized custom
        // models — rather than a filtered global catalog view.
        getModels: () => {
          const { headers, ...safe } = structuredClone(boundModel);
          return [safe];
        }, stream: streamSimple, streamSimple });
    }
    return Object.freeze({ binding, provider, close, diagnostics: diagnostics.snapshot,
      // Numeric-only detached receipt; never a raw provider usage object.
      // inputTokens excludes cacheReadTokens, matching normal pi/DSH usage.
      compactionUsage: () => structuredClone(active || closed ? { kind: 'unavailable' } : compactUsage),
    });
  }
  const isConfigured = () => { try { return !disposed && configured(PROVIDER) === true; } catch { return false; } };
  // Standard-route takeover verdict for consumers: metadata-only, never
  // resolves authentication or performs network I/O, and reports fixed
  // reason codes instead of any configured value. The metadata lookup runs
  // inside the same bounded cancellation machinery as an open() operation —
  // the runtime deadline, caller abort and dispose all interrupt a hanging
  // resolver; no authentication or network is ever introduced here.
  async function applicability({ provider, model, signal } = {}) {
    if (provider !== PROVIDER) return { applicable: false, reason: 'PROVIDER' };
    if (routeStatus !== undefined) {
      const route = routeStatus();
      if (route?.ok !== true) return { applicable: false, reason: typeof route?.reason === 'string' && METADATA_GAPS.has(route.reason) ? route.reason : 'ROUTE_AUTH' };
    }
    if (!isConfigured()) return { applicable: false, reason: 'NOT_CONFIGURED' };
    const controller = new AbortController();
    const stop = () => controller.abort();
    const timer = setTimeout(stop, Math.min(setupTimeoutMs, timeoutMs));
    if (signal?.aborted) { clearTimeout(timer); throw failure('CANCELLED'); }
    signal?.addEventListener('abort', stop, { once: true });
    // dispose() interrupts a pending metadata scope exactly like an operation.
    operations.add(stop);
    try {
      const bound = await race(controller.signal, () => resolveModel(model, controller.signal));
      return { applicable: true, model: { id: bound.id, contextWindow: bound.contextWindow, maxTokens: bound.maxTokens, input: [...bound.input] } };
    } catch (cause) {
      // A caller cancellation propagates as itself; the bounded scope turns
      // deadline/dispose aborts into the fixed metadata failure category.
      signal?.throwIfAborted();
      const code = cause?.code === 'CODEX_RUNTIME_UNKNOWN_MODEL' ? 'UNKNOWN_MODEL' : 'MODEL_METADATA';
      return { applicable: false, reason: code };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      operations.delete(stop);
    }
  }
  return Object.freeze({ protocol: PROTOCOL, describe: () => ({ protocol: PROTOCOL, route: ROUTE,
    configured: isConfigured(), authOwner: 'dsh-token-usage',
    nativeCompaction: true, nativeReplay: true, usage: { normal: 'sdk', compact: 'upstream-if-present', estimate: 'native-replay-json-utf16/4' } }),
    models, open, applicability, encodeCheckpoint, decodeCheckpoint, validateCheckpoint, estimateCheckpoint,
    dispose() { if (disposed) return; disposed = true; for (const close of [...operations]) close(); } });
}
