import { lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm/assistant-stream'
import { connectionIdFromAssistantSource } from '../capabilities/antigravity/response-provenance.js'

export const isAttemptSettlement = (event, header) => event.type === 'assistant/attempt'
  || (event.type === 'assistant/message' && Array.isArray(event.data?.stream)
    && !(Number.isInteger(header?.version) && header.version < 4))

/** V4 immutable settlements: seq+1 is a restart-safe attempt key; 0 is legacy.
 * Read only usage/finish chunks. No stream text, prompt or error message persists.
 */
export function foldAttempts(header, events, { estimator } = {}) {
  const records = new Map()
  const starts = new Map()
  let config
  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    const data = event.data ?? {}
    const key = `${data.turn}:${data.step}`
    if (event.type === 'request/header') config = data.header?.config ?? data.config
    if (event.type === 'step/start' || event.type === 'llm/retry-started') starts.set(key, { time: event.time, index })
    if (!isAttemptSettlement(event, header)) continue
    if (!Number.isSafeInteger(event.seq) || event.seq < 0) throw new TypeError('attempt settlement requires durable seq')
    const stream = Array.isArray(data.stream) ? data.stream : []
    const usage = data.usage ?? lastAssistantStreamChunk(stream, 'usage')?.usage
    const finish = lastAssistantStreamChunk(stream, 'finish')
    const rawReason = typeof finish?.reason === 'string' ? finish.reason : finish?.reason?.kind
    const reason = ['stop', 'tool-calls', 'max-tokens', 'error', 'aborted'].includes(rawReason) ? rawReason : undefined
    const failed = event.type === 'assistant/attempt' || data.interrupted === true || ['error', 'cancelled', 'aborted'].includes(reason)
    const source = data.message?.source
    const started = starts.get(key)
    const record = {
      turn: data.turn, step: data.step, attempt: event.seq + 1, seq: event.seq, time: event.time,
      provider: source?.provider ?? config?.provider ?? 'unknown', model_raw: source?.model ?? config?.model ?? 'unknown',
      connection_id: connectionIdFromAssistantSource(source) ?? null,
      input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
      cache_read_state: 'unknown', cache_write_state: 'unknown', reasoning_tokens: null,
      status: failed ? 'failed' : 'unknown', failed, estimated: 0, estimator: null, estimator_version: null,
      duration_ms: started && event.time >= started.time ? event.time - started.time : null,
      end_reason: data.interrupted === true ? 'cancelled' : reason ?? null,
      failure_type: failed ? (data.interrupted === true ? 'cancelled' : reason ?? 'attempt-without-message') : null,
    }
    if (usage !== undefined) {
      // An absent bucket is not a reported zero; retain presence independently.
      const valid = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
        .every(field => usage[field] === undefined || (Number.isSafeInteger(usage[field]) && usage[field] >= 0))
      if (valid && Number.isSafeInteger(usage.inputTokens) && Number.isSafeInteger(usage.outputTokens)) {
        Object.assign(record, {
          input_tokens: usage.inputTokens, output_tokens: usage.outputTokens,
          cache_read_tokens: usage.cacheReadTokens ?? 0, cache_write_tokens: usage.cacheWriteTokens ?? 0,
          reasoning_tokens: usage.reasoningTokens ?? null,
          cache_read_state: usage.cacheReadTokens === undefined ? 'absent' : 'reported',
          cache_write_state: usage.cacheWriteTokens === undefined ? 'absent' : 'reported', status: 'ok',
        })
      }
    } else if (estimator) {
      try {
        const estimate = estimator(events.slice(started?.index ?? index, index + 1))
        if (estimate != null) Object.assign(record, {
          input_tokens: estimate.inputTokens ?? 0, output_tokens: estimate.outputTokens ?? 0,
          status: 'estimated', estimated: 1, estimator: estimate.estimator ?? 'estimator', estimator_version: estimate.estimatorVersion ?? null,
        })
      } catch { /* unknown remains unknown; failed remains failed */ }
    }
    records.set(`${key}:${record.attempt}`, record)
  }
  return records
}

/** Keep legacy IDs stable, add an unambiguous suffix only for V4 attempts. */
export const requestId = row => `${row.session_id}:${row.turn}:${row.step}${row.attempt ? `:a${row.attempt}` : ''}`
export function parseRequestId(id) {
  const parts = String(id).split(':')
  const attempt = /^a\d+$/.test(parts.at(-1)) ? Number(parts.pop().slice(1)) : 0
  const step = Number(parts.pop())
  const turn = Number(parts.pop())
  const sessionId = parts.join(':')
  if (!sessionId || ![attempt, step, turn].every(n => Number.isSafeInteger(n) && n >= 0)) throw new TypeError('invalid request id')
  return { sessionId, turn, step, attempt }
}
