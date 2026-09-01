/**
 * Auditable cache-cost scenario for Ollama Cloud, whose current Chat
 * Completions usage does not expose whether a zero cache count is reported or
 * merely unavailable. The result is derived valuation input only; reported
 * ledger token facts are never rewritten.
 */

export const DEFAULT_OLLAMA_CACHE_ESTIMATE_BPS = 9_500
export const OLLAMA_CACHE_ESTIMATION_METHOD = 'ollama-cloud-assumed-rate-v1'

export function normalizeOllamaCacheEstimateBps(value) {
  const bps = Number(value)
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new TypeError('Ollama Cloud cache estimate must be an integer from 0 to 10000 basis points')
  }
  return bps
}

/**
 * Split a cache-unreported Ollama Cloud input using the configured scenario.
 *
 * A reported cache state always wins, including an explicit zero. Legacy rows
 * whose old schema collapsed presence to zero remain `unknown` and use the
 * scenario. New runtimes can move cleanly to reported-zero semantics as soon as
 * the public DSH usage event preserves that provider distinction.
 */
export function estimateOllamaCloudCacheRead(current, {
  rateBps = DEFAULT_OLLAMA_CACHE_ESTIMATE_BPS,
} = {}) {
  const normalizedRate = normalizeOllamaCacheEstimateBps(rateBps)
  if (current?.provider !== 'ollama-cloud' || current.status !== 'ok') return 0
  if (current.cacheReadState === 'reported') return 0

  const input = Number(current.inputTokens ?? 0)
  const reportedRead = Number(current.cacheReadTokens ?? 0)
  const reportedWrite = Number(current.cacheWriteTokens ?? 0)
  if (!Number.isSafeInteger(input) || input <= 0 || reportedRead > 0 || reportedWrite > 0) return 0
  return Math.min(input, Math.round((input * normalizedRate) / 10_000))
}
