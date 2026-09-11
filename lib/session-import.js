/**
 * Versioned SessionPersistence read adapter. 0.1.5 exposes list() over
 * {header, revision} snapshot rows plus open(id, 'read') handles carrying the
 * top-level inheritedEventCount; 0.1.2 exposes listSnapshots() over the same
 * row shape plus inspect(id), while its same-named list() returns bare
 * SessionHeader[] rows (no `.header`) and must never be mistaken for the
 * snapshot listing. Protocol selection therefore requires the host's
 * complete capability set; incomplete or mixed shapes fail closed instead of
 * guessing a row shape. Mapping always lifts the exact inherited cut onto the
 * ledger header DTO.
 */

/** Public protocol of one SessionPersistence instance, or null when incomplete. */
export function sessionPersistenceProtocol(persistence) {
  const hasOpen = typeof persistence?.open === 'function'
  const hasList = typeof persistence?.list === 'function'
  const hasListSnapshots = typeof persistence?.listSnapshots === 'function'
  const hasInspect = typeof persistence?.inspect === 'function'
  // 0.1.5 hosts: snapshot listing plus read handles. Handles win whenever
  // present because they carry the top-level inheritedEventCount cut.
  if (hasOpen && hasList) return 'current'
  // 0.1.2 hosts expose listSnapshots()+inspect next to their bare SessionHeader
  // list(); the handle-less shape is what keeps the legacy path unambiguous.
  if (!hasOpen && hasListSnapshots && hasInspect) return 'legacy'
  return null
}

const INCOMPLETE_PROTOCOL_ERROR = 'sessionPersistence exposes an incomplete SessionPersistence protocol: 0.1.5 requires list()+open read handles, 0.1.2 requires listSnapshots()+inspect; a same-named list() returning SessionHeader[] rows is not the snapshot listing'

export async function listSessionSnapshots(persistence) {
  if (sessionPersistenceProtocol(persistence) === 'current') return persistence.list()
  if (sessionPersistenceProtocol(persistence) === 'legacy') return persistence.listSnapshots()
  throw new Error(INCOMPLETE_PROTOCOL_ERROR)
}

export async function readSessionInspection(persistence, id) {
  if (sessionPersistenceProtocol(persistence) === 'current') {
    const handle = await persistence.open(id, 'read')
    try {
      const slice = await handle.read()
      return {
        meta: handle.header,
        inheritedEventCount: handle.inheritedEventCount,
        events: slice.events,
      }
    } finally {
      await handle.close()
    }
  }
  if (sessionPersistenceProtocol(persistence) === 'legacy') {
    const inspection = await persistence.inspect(id)
    return {
      meta: inspection.meta ?? inspection.header,
      inheritedEventCount: inspection.inheritedEventCount,
      events: inspection.events,
    }
  }
  throw new Error(INCOMPLETE_PROTOCOL_ERROR)
}

export function headerFromInspection(inspection, revision) {
  const meta = inspection?.meta ?? {}
  const inheritedEventCount = inspection?.inheritedEventCount ?? meta.inheritedEventCount ?? meta.seedLength
  return {
    ...meta,
    revision,
    ...(inheritedEventCount === undefined ? {} : { inheritedEventCount }),
  }
}