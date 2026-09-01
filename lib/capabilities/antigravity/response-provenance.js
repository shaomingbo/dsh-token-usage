import { randomUUID } from 'node:crypto'

const RESPONSE_ID_PREFIX = 'chatcmpl-dsh-antigravity-v1.'
const MAX_CONNECTION_ID_LENGTH = 200
const ENCODED_CONNECTION = /^[A-Za-z0-9_-]+$/
const NONCE = /^[A-Za-z0-9_-]{1,128}$/

function validConnectionId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_CONNECTION_ID_LENGTH
}

/** Create the standard OpenAI response id that carries plugin-owned connection provenance. */
export function attributedResponseId(connectionId, nonce = randomUUID()) {
  if (!validConnectionId(connectionId)) throw new TypeError('connectionId must be a non-empty string of at most 200 characters')
  if (typeof nonce !== 'string' || !NONCE.test(nonce)) throw new TypeError('response id nonce must be 1-128 URL-safe characters')
  return `${RESPONSE_ID_PREFIX}${Buffer.from(connectionId, 'utf8').toString('base64url')}.${nonce}`
}

/** Recover connection provenance from a durable assistant model source. */
export function connectionIdFromAssistantSource(source) {
  if (source?.kind !== 'model') return undefined
  if (validConnectionId(source.connectionId)) return source.connectionId
  if (source.provider !== 'antigravity') return undefined

  const response = source.replayState?.response
  if (response?.kind !== 'pi-ai'
    || response.version !== 2
    || response.api !== 'openai-completions'
    || response.provider !== 'antigravity'
    || typeof response.responseId !== 'string'
    || !response.responseId.startsWith(RESPONSE_ID_PREFIX)) return undefined

  const parts = response.responseId.slice(RESPONSE_ID_PREFIX.length).split('.')
  if (parts.length !== 2 || !ENCODED_CONNECTION.test(parts[0]) || !NONCE.test(parts[1])) return undefined
  try {
    const connectionId = Buffer.from(parts[0], 'base64url').toString('utf8')
    if (!validConnectionId(connectionId)) return undefined
    if (Buffer.from(connectionId, 'utf8').toString('base64url') !== parts[0]) return undefined
    return connectionId
  } catch {
    // Malformed durable replay metadata remains unassigned.
    return undefined
  }
}
