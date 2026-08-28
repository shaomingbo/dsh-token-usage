/**
 * Report exports (CSV/JSON) and database backup/restore/merge. Ordinary
 * exports anonymize local identifiers by default; complete backups keep them
 * and are a separate, privacy-flagged operation.
 */

/** Stable anonymization: sorted first-seen order → "project-1", "session-1". */
export function createAnonymizer() {
  const maps = new Map()
  return function anonymize(kind, value) {
    if (value === undefined || value === null) return value
    const key = `${kind}:${value}`
    let mapped = maps.get(key)
    if (mapped === undefined) {
      const count = [...maps.keys()].filter((existing) => existing.startsWith(`${kind}:`)).length + 1
      mapped = `${kind}-${count}`
      maps.set(key, mapped)
    }
    return mapped
  }
}

function csvCell(value) {
  if (value === undefined || value === null) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const REQUEST_COLUMNS = [
  'time', 'project', 'sessionId', 'provider', 'model', 'status', 'estimated',
  'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens',
  'reasoningTokens', 'processingTokens', 'costUsd',
]

/** Request rows → CSV. `anonymize` toggles identifier anonymization. */
export function requestsToCsv(rows, { anonymize: on = true, nanoToUsd = (nano) => nano === null || nano === undefined ? '' : String(nano) } = {}) {
  const mask = on ? createAnonymizer() : (_kind, value) => value
  const lines = [REQUEST_COLUMNS.join(',')]
  for (const row of rows) {
    lines.push([
      new Date(row.time).toISOString(),
      mask('project', row.cwd),
      mask('session', row.sessionId),
      row.provider,
      row.model,
      row.status,
      row.estimated ? 'yes' : 'no',
      row.inputTokens,
      row.outputTokens,
      row.cacheReadTokens,
      row.cacheWriteTokens,
      row.reasoningTokens,
      row.processingTokens,
      nanoToUsd(row.originalUsdNano),
    ].map(csvCell).join(','))
  }
  return `${lines.join('\n')}\n`
}

/** Structured JSON report; anonymizes project paths and session ids by default. */
export function reportToJson(report, { anonymize: on = true } = {}) {
  if (!on) return report
  const mask = createAnonymizer()
  const maskDeep = (value) => {
    if (Array.isArray(value)) return value.map(maskDeep)
    if (value !== null && typeof value === 'object') {
      const out = {}
      for (const [key, entry] of Object.entries(value)) {
        if (key === 'cwd') out[key] = mask('project', entry)
        else if (key === 'sessionId' || key === 'id' || key === 'parentSession') {
          out[key] = typeof entry === 'string' && !entry.includes('-') ? mask('session', entry) : entry
        } else out[key] = maskDeep(entry)
      }
      return out
    }
    return value
  }
  return maskDeep(report)
}
