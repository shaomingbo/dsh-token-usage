/**
 * Shared RPC safety envelope for capability channels.
 *
 * Every capability answer is either { ok: true, value } or a failure whose
 * code degrades to "internal" unless it is an explicitly declared cancelled or
 * credential code. Credential failures keep only the non-secret `ref` detail,
 * and no provider detail object or extra field ever crosses the envelope.
 */

export function createCapabilityEnvelope({ cancelledCodes = [], credentialCodes = [] } = {}) {
  const passthroughCodes = new Set(['cancelled', 'internal'])
  const cancelled = new Set(cancelledCodes)
  const credential = new Set(credentialCodes)

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  /** Map a raw error code and detail object onto the safe wire outcome. */
  function outcome(code, details) {
    if (typeof code === 'string') {
      if (passthroughCodes.has(code)) return { code, details: {} }
      if (credential.has(code) && isRecord(details) && typeof details.ref === 'string') {
        return { code: 'credential-rejected', details: { ref: details.ref } }
      }
      if (cancelled.has(code)) return { code: 'cancelled', details: {} }
    }
    return { code: 'internal', details: {} }
  }

  function failure(message, code = 'internal', details) {
    const safe = outcome(code, details)
    const tag = typeof code === 'string' && code !== safe.code ? `[${code}] ` : ''
    return { ok: false, error: { code: safe.code, message: `${tag}${message}`, details: safe.details } }
  }

  function success(value) {
    return { ok: true, value }
  }

  function requireObject(payload) {
    if (!isRecord(payload)) throw new Error('request payload must be an object')
    return payload
  }

  return { success, failure, outcome, isRecord, requireObject }
}
