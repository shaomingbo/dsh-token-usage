// Temporary secret-free phase probe. No inputs, ids, URLs, headers or payloads
// enter this object; only owner-selected enums and finite nonnegative numbers.
const eventKinds = new Map([
  ['response.created', 'created'], ['response.in_progress', 'in-progress'], ['response.queued', 'queued'],
  ['response.completed', 'completed'], ['response.done', 'completed'],
  ...['error', 'response.failed', 'response.incomplete', 'response.cancelled'].map(type => [type, 'failed']),
  ['response.content_part.added', 'content-added'], ['response.content_part.done', 'content-done'],
  ['response.output_text.delta', 'output-text-delta'], ['response.output_text.done', 'output-text-done'],
  ['response.reasoning_text.delta', 'reasoning-delta'], ['response.reasoning_text.done', 'reasoning-done-text'],
  ['response.reasoning_summary_part.added', 'reasoning-summary-added'], ['response.reasoning_summary_part.done', 'reasoning-summary-done'],
  ['response.reasoning_summary_text.delta', 'reasoning-summary-delta'], ['response.reasoning_summary_text.done', 'reasoning-summary-text-done'],
]);
export const DIAGNOSTIC_EVENTS = Object.freeze([...new Set([...eventKinds.values(),
  'compaction-added', 'compaction-item', 'reasoning-added', 'reasoning-done', 'message-added', 'message-done', 'item-added-other', 'item-done-other', 'other'])]);
export function nativeEventCategory(event) {
  if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
    const done = event.type === 'response.output_item.done';
    if (event.item?.type === 'compaction') return done ? 'compaction-item' : 'compaction-added';
    if (event.item?.type === 'reasoning') return done ? 'reasoning-done' : 'reasoning-added';
    if (event.item?.type === 'message') return done ? 'message-done' : 'message-added';
    return done ? 'item-done-other' : 'item-added-other';
  }
  return eventKinds.get(event.type) ?? 'other';
}
export function operationDiagnostics(now = () => performance.now()) {
  const started = now();
  let stopped;
  const data = { version: 1, phase: 'model-metadata', requests: 0, responseBytes: 0, chunks: 0, events: 0, eventCounts: {} };
  const elapsed = () => Math.max(0, Math.round(now() - started));
  const validNumber = value => Number.isSafeInteger(value) && value >= 0;
  function observe(kind, value) {
    if (stopped !== undefined) return;
    const ms = elapsed();
    switch (kind) {
      case 'budget': if (validNumber(value)) { data.budgetMs = value; data.totalBudgetMs = value; } break;
      case 'setup-budget': if (validNumber(value)) data.setupBudgetMs = value; break;
      case 'timeout':
        if (value === 'setup' || value === 'total') {
          data.timeoutKind = value;
          data.timeoutBudgetMs = value === 'setup' ? data.setupBudgetMs : data.totalBudgetMs;
        }
        break;
      case 'metadata': data.metadataMs = ms; data.phase = 'account-binding'; break;
      case 'bound': data.boundMs = ms; data.phase = 'bound'; break;
      case 'prepare': data.phase = 'request-prepare'; break;
      case 'request':
        data.phase = 'waiting-headers'; data.requests++; data.requestMs = ms;
        for (const key of ['requestBytes', 'headersMs', 'httpStatus', 'firstByteMs', 'lastByteMs', 'lastEventMs', 'lastEvent', 'itemMs', 'completedMs']) delete data[key];
        data.responseBytes = 0; data.chunks = 0; data.events = 0; data.eventCounts = {};
        if (validNumber(value)) data.requestBytes = value;
        break;
      case 'headers':
        data.phase = 'waiting-body'; data.headersMs = ms;
        if (validNumber(value) && value >= 100 && value <= 599) data.httpStatus = value;
        break;
      case 'bytes':
        if (!validNumber(value)) break;
        data.phase = 'reading-sse'; data.firstByteMs ??= ms; data.lastByteMs = ms;
        data.responseBytes += value; data.chunks++;
        break;
      case 'event':
        data.events++; data.lastEventMs = ms;
        data.lastEvent = DIAGNOSTIC_EVENTS.includes(value) ? value : 'other';
        data.eventCounts[data.lastEvent] = (data.eventCounts[data.lastEvent] ?? 0) + 1;
        break;
      case 'item': data.itemMs = ms; break;
      case 'completed': data.completedMs = ms; data.phase = 'completed'; break;
    }
  }
  return Object.freeze({ observe, stop: () => { stopped ??= elapsed(); }, snapshot: () => ({ ...data, eventCounts: { ...data.eventCounts }, elapsedMs: stopped ?? elapsed() }) });
}
