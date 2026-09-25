// MIT; adapted from the same owner's dsh-codex-compaction/src/native-transport.js.
import { createHash } from 'node:crypto';
import { setImmediate as yieldToTimers } from 'node:timers/promises';
import { encodeCheckpoint, hasUnsupportedWireMedia } from './checkpoint.js';
import { nativeEventCategory } from './diagnostics.js';
const ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
const MAX_BODY = 4 * 1024 * 1024;
const MAX_ITEMS = 1024;
const RETAIN_TOKENS = 64_000; // UTF-16/4 estimate, not provider usage.
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
function error(code) { const result = new Error(`Native compaction: ${code}`); result.code = code; return result; }
function requireValue(condition, code) { if (!condition) throw error(code); }
function binding(value) { return typeof value === 'string' && !!value.trim() && value.length <= 256; }
function snapshot(value, limit = MAX_BODY) {
  let nodes = 0, bytes = 0;
  const ancestors = new Set();
  function visit(node, depth) {
    requireValue(++nodes <= 50_000 && depth <= 32, 'JSON_LIMIT');
    if (node === null || typeof node === 'boolean') return;
    if (typeof node === 'string') { bytes += Buffer.byteLength(node); requireValue(bytes <= limit, 'BODY_SIZE'); return; }
    if (typeof node === 'number' && Number.isFinite(node) && !Object.is(node, -0)) return;
    requireValue(typeof node === 'object' && !ancestors.has(node), 'INVALID_JSON');
    const array = Array.isArray(node), proto = Object.getPrototypeOf(node);
    requireValue(array ? proto === Array.prototype : proto === Object.prototype || proto === null, 'INVALID_JSON');
    const keys = Reflect.ownKeys(node);
    requireValue(keys.length <= 50_000, 'JSON_LIMIT');
    ancestors.add(node);
    for (const key of keys) {
      if (array && key === 'length') continue;
      requireValue(typeof key === 'string' && !unsafe.has(key), 'UNSAFE_JSON_KEY');
      bytes += Buffer.byteLength(key);
      requireValue(bytes <= limit, 'BODY_SIZE');
      const descriptor = Object.getOwnPropertyDescriptor(node, key);
      requireValue(descriptor.enumerable && 'value' in descriptor, 'INVALID_JSON');
      if (array) requireValue(/^(0|[1-9]\d*)$/.test(key) && Number(key) < node.length, 'INVALID_JSON');
      visit(descriptor.value, depth + 1);
    }
    if (array) requireValue(keys.length === node.length + 1, 'INVALID_JSON');
    ancestors.delete(node);
  }
  visit(value, 0);
  const text = JSON.stringify(value);
  requireValue(Buffer.byteLength(text) <= limit, 'BODY_SIZE');
  return JSON.parse(text);
}
function checkModalities(input) {
  // The codec and transport must agree: only actual wire item/content types
  // are modality declarations. Do not recurse into opaque extensions, tool
  // arguments, annotations, or literal text such as a data URI.
  for (const item of input) requireValue(!hasUnsupportedWireMedia(item), 'UNSUPPORTED_MODALITY');
}
function itemText(item) {
  if (typeof item.content === 'string') return item.content;
  requireValue(Array.isArray(item.content) && item.content.every(part => part && part.type === 'input_text' && typeof part.text === 'string'), 'UNSUPPORTED_CLIENT_CONTENT');
  return item.content.map(part => part.text).join('');
}
function retainedInput(input) {
  const retained = []; let tokens = 0;
  const clients = input.filter(item => ['user', 'developer', 'system'].includes(item.role)).map(item => {
    const text = itemText(item);
    const cost = Math.ceil(text.length / 4);
    requireValue(cost <= RETAIN_TOKENS, 'RETENTION_SIZE');
    return { item, cost };
  });
  for (let i = clients.length - 1; i >= 0; i--) {
    const { item, cost } = clients[i];
    if (tokens + cost > RETAIN_TOKENS) break;
    tokens += cost; retained.push(item);
  }
  return retained.reverse();
}

// ---- Optional source-aware retention (source-aware-v1) ----
// Hints carry ONLY message-source categories and verification digests — never
// message text. The full request is still sent; this policy may only remove,
// from the retained checkpoint copy, host-generated wrappers and duplicate
// non-authoritative text copies it can PROVE are duplicates. Real user
// content, constraints, unknown-category items and non-duplicate notices are
// never dropped. Any ambiguity falls back to the original retention policy.
const RETENTION_CATEGORIES = new Set(['user-instruction', 'system-constraint', 'host-notice', 'checkpoint-wrapper', 'unknown']);
const RETENTION_DROPPABLE = new Set(['host-notice', 'checkpoint-wrapper']);
function parseRetentionHints(hints) {
  if (hints === undefined) return { policy: null };
  if (!hints || typeof hints !== 'object' || Array.isArray(hints) || hints.version !== 1
      || hints.algorithm !== 'source-aware-v1' || !Array.isArray(hints.items) || hints.items.length > 4096) {
    return { policy: null, fallback: 'hints-malformed' };
  }
  const byDigest = new Map();
  for (const hint of hints.items) {
    if (!hint || typeof hint !== 'object' || Array.isArray(hint)
        || !RETENTION_CATEGORIES.has(hint.category)
        || typeof hint.digest !== 'string' || !/^[0-9a-f]{64}$/.test(hint.digest)) {
      return { policy: null, fallback: 'hints-malformed' };
    }
    if (byDigest.has(hint.digest)) {
      // The same digest claimed twice with different categories is ambiguous.
      if (byDigest.get(hint.digest) !== hint.category) return { policy: null, fallback: 'hints-ambiguous' };
      continue;
    }
    byDigest.set(hint.digest, hint.category);
  }
  return { policy: byDigest };
}
/** Digest each candidate's canonical text; ambiguous or unmatched digests
 * simply classify as unknown (kept), which is the conservative outcome. */
function sourceAwareRetained(input, hints, observe) {
  const { policy, fallback } = parseRetentionHints(hints);
  const clients = input.filter(item => ['user', 'developer', 'system'].includes(item.role)).map(item => {
    const text = itemText(item);
    const cost = Math.ceil(text.length / 4);
    requireValue(cost <= RETAIN_TOKENS, 'RETENTION_SIZE');
    return { item, cost, text };
  });
  if (!policy) {
    if (fallback) observe('retention', { version: 1, algorithm: 'source-aware-v1', fallback });
    return { retained: trailing(clients), dropped: 0 };
  }
  const digestOf = text => createHash('sha256').update(text).digest('hex');
  // Digest occurrences among ALL client candidates (not only retained ones):
  // a wrapper copy duplicate of an authoritative text must be countable even
  // when only one of them fits the trailing budget.
  const byDigest = new Map();
  const classified = clients.map(candidate => {
    const digest = digestOf(candidate.text);
    const category = policy.get(digest) ?? 'unknown';
    const record = byDigest.get(digest) ?? { droppable: 0, authoritative: 0, hinted: 0 };
    if (category !== 'unknown') {
      if (RETENTION_DROPPABLE.has(category)) record.droppable += 1; else record.authoritative += 1;
      record.hinted += 1;
    }
    byDigest.set(digest, record);
    return { ...candidate, digest, category };
  });
  // Walk newest → oldest within the trailing budget. A droppable-category
  // candidate may be skipped only when a newer copy is already kept, or when
  // the same text also exists as an authoritative (non-droppable) copy — i.e.
  // it is a provably non-authoritative duplicate. The newest representative
  // of every text always survives; real user content, constraints, unknown
  // items and non-duplicate notices are never dropped.
  const kept = [];
  const keptDigests = new Set();
  let tokens = 0, dropped = 0;
  for (let i = classified.length - 1; i >= 0; i--) {
    const candidate = classified[i];
    if (tokens + candidate.cost > RETAIN_TOKENS) break;
    const record = byDigest.get(candidate.digest);
    let drop = false;
    // Defensive second branch: a hint policy that ever gains per-item
    // granularity could see an authoritative copy under the same digest; a
    // droppable candidate must then lose to it. Digest-keyed v1 categories
    // cannot reach it (conflicts already fell back), so it never over-drops.
    if (record && RETENTION_DROPPABLE.has(candidate.category)
        && (keptDigests.has(candidate.digest) || record.authoritative > 0)) drop = true;
    if (drop) { dropped += 1; continue; }
    tokens += candidate.cost;
    kept.push(candidate);
    keptDigests.add(candidate.digest);
  }
  const categories = {};
  for (const candidate of classified) if (candidate.category !== 'unknown') categories[candidate.category] = (categories[candidate.category] ?? 0) + 1;
  observe('retention', { version: 1, algorithm: 'source-aware-v1', dropped, retained: kept.length,
    estimatedRetainedTokens: tokens, ...(Object.keys(categories).length ? { categories } : {}) });
  return { retained: kept.map(candidate => candidate.item).reverse(), dropped };
}
function trailing(clients) {
  const retained = []; let tokens = 0;
  for (let i = clients.length - 1; i >= 0; i--) {
    const { item, cost } = clients[i];
    if (tokens + cost > RETAIN_TOKENS) break;
    tokens += cost; retained.push(item);
  }
  return retained.reverse();
}
async function parseSSE(response, signal, observe) {
  requireValue(response.body && typeof response.body.getReader === 'function', 'SSE_BODY');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, chunks = 0, lineParts = [], skipLF = false, data = [], eventName = '', terminal = false, item, usage;
  let eventCount = 0, doneMarker = false;
  const cancel = () => { Promise.resolve(reader.cancel()).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  function dispatch() {
    if (!data.length) { eventName = ''; return; }
    requireValue(++eventCount <= 8192, 'SSE_LIMIT');
    const payload = data.join('\n'); data = [];
    if (payload === '[DONE]') { requireValue(terminal && !doneMarker, 'SSE_TERMINAL'); doneMarker = true; eventName = ''; return; }
    requireValue(!doneMarker, 'SSE_TERMINAL');
    let event;
    try { event = snapshot(JSON.parse(payload)); } catch { throw error('SSE_JSON'); }
    requireValue(event && typeof event === 'object' && !Array.isArray(event), 'SSE_JSON');
    requireValue(!eventName || eventName === event.type, 'SSE_EVENT'); eventName = '';
    observe('event', nativeEventCategory(event));
    requireValue(!['error', 'response.failed', 'response.incomplete', 'response.cancelled'].includes(event.type) && !event.error, 'SSE_FAILED');
    if (event.type === 'response.completed' || event.type === 'response.done') {
      requireValue(!terminal && event.response && typeof event.response === 'object' && !Array.isArray(event.response) && (!event.response.status || event.response.status === 'completed') && !event.response.error, 'SSE_TERMINAL');
      requireValue(item, 'SSE_COMPACTION');
      terminal = true; observe('completed');
      if (event.response.usage !== undefined) usage = event.response.usage;
    } else {
      requireValue(!terminal, 'SSE_TERMINAL');
      if (event.type === 'response.output_item.done' && event.item?.type === 'compaction') {
        requireValue(!item && typeof event.item.encrypted_content === 'string' && !!event.item.encrypted_content.trim(), 'SSE_COMPACTION'); item = event.item;
        observe('item');
      }
    }
  }
  function line(value) {
    if (value === '') return dispatch();
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':'), field = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? '' : value.slice(colon + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'data') data.push(content);
    if (field === 'event') eventName = content;
  }
  function consume(chunk) {
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (skipLF) { skipLF = false; if (chunk[i] === '\n') { start = i + 1; continue; } }
      if (chunk[i] !== '\r' && chunk[i] !== '\n') continue;
      lineParts.push(chunk.slice(start, i)); line(lineParts.join('')); lineParts = [];
      skipLF = chunk[i] === '\r'; start = i + 1;
    }
    if (start < chunk.length) lineParts.push(chunk.slice(start));
  }
  try {
    while (true) {
      requireValue(!signal.aborted, 'CANCELLED');
      let read;
      try { read = await reader.read(); } catch { throw error('SSE_DISCONNECTED'); }
      const { value, done } = read; if (done) break;
      observe('bytes', value.byteLength);
      requireValue(++chunks <= 65_536, 'SSE_LIMIT');
      // Decode and account only through each wire line boundary. Decoding an
      // entire read first would interpret invalid UTF-8 / oversized tails after
      // completion, making the result depend on network chunk boundaries.
      let start = 0;
      for (let i = 0; i < value.byteLength && !terminal; i++) {
        if (value[i] !== 10 && value[i] !== 13 && i !== value.byteLength - 1) continue;
        const part = value.subarray(start, i + 1); start = i + 1;
        bytes += part.byteLength; requireValue(bytes <= MAX_BODY, 'SSE_SIZE');
        consume(decoder.decode(part, { stream: true }));
      }
      if (terminal) break;
      if (chunks % 256 === 0) await yieldToTimers();
    }
    requireValue(!signal.aborted, 'CANCELLED');
    // EOF may cut a frame (or UTF-8 sequence) anywhere. Without a dispatched
    // completion this is an incomplete response, not evidence of bad protocol.
    requireValue(terminal, 'SSE_INCOMPLETE');
    consume(decoder.decode());
    requireValue(!lineParts.length && !data.length && !eventName, 'SSE_TERMINAL');
    return { item, ...(usage !== undefined ? { usage } : {}) };
  } finally { signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
}
/** Internal owner transport. Never export an instance through the capability. */
export class NativeTransport {
  #fetch; #auth; #identity; #timeout; #observe;
  constructor({ fetch, auth, identity, timeoutMs = 30_000, observe = () => {} }) {
    requireValue(typeof fetch === 'function' && typeof auth === 'function' && binding(identity), 'CONFIG');
    requireValue(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300_000, 'CONFIG');
    this.#fetch = fetch; this.#auth = auth; this.#identity = identity; this.#timeout = timeoutMs;
    this.#observe = observe;
  }
  async compact({ provider, model, input, instructions = '', tools = [], signal, retentionHints } = {}) {
    requireValue(binding(provider) && binding(model), 'INVALID_BINDING');
    requireValue(Array.isArray(input) && input.length > 0 && input.length <= MAX_ITEMS && Array.isArray(tools) && tools.length <= MAX_ITEMS && typeof instructions === 'string', 'INVALID_INPUT');
    requireValue(retentionHints === undefined || (retentionHints && typeof retentionHints === 'object' && !Array.isArray(retentionHints)), 'INVALID_INPUT');
    requireValue(!signal?.aborted, 'CANCELLED');
    const source = snapshot(input);
    requireValue(source.every(item => item && typeof item === 'object' && !Array.isArray(item) && item.type !== 'compaction_trigger'), 'INVALID_INPUT');
    checkModalities(source);
    // Optional source-aware policy: only provable duplicates may leave the
    // retained copy; the full request body is sent either way.
    const retained = retentionHints === undefined ? retainedInput(source)
      : sourceAwareRetained(source, retentionHints, this.#observe).retained;
    const body = JSON.stringify(snapshot({ model, instructions, tools, input: [...source, { type: 'compaction_trigger' }], store: false, stream: true, include: ['reasoning.encrypted_content'] }));
    const controller = new AbortController(); let timeout = false;
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timeout = true; abort(); }, this.#timeout);
    let onAbort;
    const stopped = new Promise((_, reject) => {
      onAbort = () => reject(error(timeout ? 'TIMEOUT' : 'CANCELLED'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    const run = async () => {
      const auth = await this.#auth({ provider, model, signal: controller.signal });
      requireValue(!controller.signal.aborted, 'CANCELLED');
      requireValue(auth && binding(auth.identity) && auth.identity === this.#identity, 'IDENTITY_MISMATCH');
      requireValue(typeof auth.accessToken === 'string' && !!auth.accessToken && typeof auth.accountId === 'string' && !!auth.accountId && !/[\r\n]/.test(auth.accessToken + auth.accountId), 'AUTH_INVALID');
      const response = await this.#fetch(ENDPOINT, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${auth.accessToken}`, 'ChatGPT-Account-ID': auth.accountId, 'Content-Type': 'application/json', Accept: 'text/event-stream', 'OpenAI-Beta': 'responses=experimental', originator: 'dsh-codex-compaction' }, body,
      });
      // MIME is advisory. parseSSE still requires the completed event and one
      // valid opaque item, within the existing byte/event/depth limits.
      if (controller.signal.aborted || !response.ok) {
        Promise.resolve(response.body?.cancel()).catch(() => {});
        throw error(controller.signal.aborted ? 'CANCELLED' : 'HTTP_ERROR');
      }
      const result = await parseSSE(response, controller.signal, this.#observe);
      requireValue(!controller.signal.aborted, 'CANCELLED');
      const items = [...retained, result.item];
      encodeCheckpoint({ provider, model, identity: this.#identity, items });
      return { items, identity: this.#identity, ...(result.usage !== undefined ? { usage: result.usage } : {}) };
    };
    try { return await Promise.race([run(), stopped]); }
    catch (cause) {
      const allowed = new Set(['CANCELLED', 'TIMEOUT', 'IDENTITY_MISMATCH', 'AUTH_INVALID', 'HTTP_ERROR', 'SSE_BODY', 'SSE_LIMIT', 'SSE_JSON', 'SSE_EVENT', 'SSE_FAILED', 'SSE_TERMINAL', 'SSE_INCOMPLETE', 'SSE_DISCONNECTED', 'SSE_COMPACTION', 'SSE_SIZE', 'SSE_CONTENT_TYPE', 'CHECKPOINT_SIZE', 'CHECKPOINT_DEPTH', 'CHECKPOINT_ITEMS', 'CHECKPOINT_COMPACTION']);
      throw error(controller.signal.aborted ? (timeout ? 'TIMEOUT' : 'CANCELLED') : allowed.has(cause?.code) ? cause.code : 'TRANSPORT_ERROR');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', onAbort); }
  }
}
