/** MIT; adapted from the same owner's dsh-codex-compaction/src/checkpoint.js.
 * Pure wire codec, NOT a provenance check. The bridge authorizes compact sources.
 * Unknown JSON fields and array order survive; returned records are snapshots.
 */
const PREFIX = '<dsh-codex-compaction';
const OPEN = '<dsh-codex-compaction-v1>';
const CLOSE = '</dsh-codex-compaction-v1>';
const PROTOCOL = 'responses.compaction-trigger.v2';
const MAX_BYTES = 512 * 1024;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function fail(code) { const error = new Error(`Native checkpoint: ${code}`); error.code = code; throw error; }
function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) fail('INVALID_BINDING');
}
function jsonTree(value, depth = 0, seen = new Set(), budget = { nodes: 0, bytes: 0 }) {
  if (depth > 32) fail('CHECKPOINT_DEPTH');
  if (++budget.nodes > 50_000) fail('CHECKPOINT_SIZE');
  if (typeof value === 'string') {
    budget.bytes += Buffer.byteLength(value, 'utf8');
    if (budget.bytes > MAX_BYTES) fail('CHECKPOINT_SIZE');
    return;
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return;
  if (typeof value !== 'object' || seen.has(value)) fail('INVALID_JSON');
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('INVALID_JSON');
  seen.add(value);
  const keys = Reflect.ownKeys(value);
  if (keys.length > 50_000) fail('CHECKPOINT_SIZE');
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string' || forbidden.has(key)) fail('UNSAFE_JSON_KEY');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !('value' in descriptor)) fail('INVALID_JSON');
    if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) fail('INVALID_JSON');
    budget.bytes += Buffer.byteLength(key, 'utf8');
    if (budget.bytes > MAX_BYTES) fail('CHECKPOINT_SIZE');
    jsonTree(descriptor.value, depth + 1, seen, budget);
  }
  if (Array.isArray(value) && keys.length !== value.length + 1) fail('INVALID_JSON');
  seen.delete(value);
}
const MEDIA_TYPES = new Set(['input_image', 'image', 'input_audio', 'audio', 'input_file', 'video']);
/** Shared wire-position policy: opaque metadata and literal text are not media. */
export function hasUnsupportedWireMedia(item) {
  if (MEDIA_TYPES.has(item.type)) return true;
  const content = item.role ? item.content : item.type === 'function_call_output' ? item.output : undefined;
  return Array.isArray(content) && content.some(part => MEDIA_TYPES.has(part?.type));
}
export function validateCheckpoint(value, expected) {
  jsonTree(value);
  if (!value || Array.isArray(value) || value.version !== 1 || value.protocol !== PROTOCOL) fail('CHECKPOINT_SCHEMA');
  for (const key of ['provider', 'model', 'identity']) {
    label(value[key]);
    if (expected !== undefined) {
      label(expected?.[key]);
      if (value[key] !== expected[key]) fail('CHECKPOINT_IDENTITY');
    }
  }
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > 1024) fail('CHECKPOINT_ITEMS');
  let compactions = 0;
  for (const item of value.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('CHECKPOINT_ITEMS');
    if (item.type === 'compaction') {
      compactions++;
      if (typeof item.encrypted_content !== 'string' || !item.encrypted_content.trim()) fail('CHECKPOINT_COMPACTION');
    }
    if (item.type === 'compaction_trigger') fail('CHECKPOINT_ITEMS');
    if (hasUnsupportedWireMedia(item)) fail('CHECKPOINT_MODALITY');
  }
  if (compactions !== 1) fail('CHECKPOINT_COMPACTION');
  const text = JSON.stringify(value);
  if (Buffer.byteLength(OPEN + text + CLOSE) > MAX_BYTES) fail('CHECKPOINT_SIZE');
  return JSON.parse(text);
}
export function encodeCheckpoint(record) {
  // Reject accessors before spreading the caller's record.
  jsonTree(record);
  // Accept the original alpha's binding+items input as well as full v1 records.
  return OPEN + JSON.stringify(validateCheckpoint({ version: 1, protocol: PROTOCOL, ...record })) + CLOSE;
}
export function decodeCheckpoint(text, expected) {
  if (typeof text !== 'string' || !text.startsWith(PREFIX)) return undefined;
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) fail('CHECKPOINT_SIZE');
  if (!text.startsWith(OPEN) || !text.endsWith(CLOSE)) fail('CHECKPOINT_MARKER');
  let value;
  try { value = JSON.parse(text.slice(OPEN.length, -CLOSE.length)); }
  catch { fail('CHECKPOINT_JSON'); }
  return validateCheckpoint(value, expected);
}
export function estimateCheckpoint(record) {
  const value = validateCheckpoint(record);
  return { tokens: Math.ceil(JSON.stringify(value.items).length / 4), basis: 'native-replay-json-utf16/4', exact: false };
}
