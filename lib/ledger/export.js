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
      mask('project', row.cwd ?? row.project),
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
  const projectValue = (value) => String(value ?? '').replace(/^cwd:/, '')
  const maskProject = (value) => mask('project', projectValue(value))
  const maskDeep = (value, context = {}) => {
    if (Array.isArray(value)) {
      if (context.projectList) return value.map(maskProject)
      return value.map((entry) => maskDeep(entry, context))
    }
    if (value !== null && typeof value === 'object') {
      if (value.dimension === 'project' && Array.isArray(value.rows)) {
        return {
          ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'rows').map(([key, entry]) => [key, maskDeep(entry)])),
          rows: value.rows.map((row) => {
            const project = maskProject(row.key ?? row.project ?? row.label)
            return { ...maskDeep(row, { projectRow: true }), key: project, label: project, ...(row.project !== undefined ? { project } : {}) }
          }),
        }
      }
      const out = {}
      const rowProject = context.projectRow ? maskProject(value.key ?? value.project ?? value.label) : null
      for (const [key, entry] of Object.entries(value)) {
        if (context.projectRow && (key === 'key' || key === 'label')) out[key] = rowProject
        else if (key === 'cwd' || key === 'project' || key === 'projectId') out[key] = Array.isArray(entry) ? entry.map(maskProject) : maskProject(entry)
        else if (key === 'sessionId' || key === 'id' || key === 'parentSession') {
          out[key] = typeof entry === 'string' && !entry.includes('-') ? mask('session', entry) : entry
        } else out[key] = maskDeep(entry, { projectList: key === 'project', projectRow: context.projectRow && key === 'compare' })
      }
      return out
    }
    return value
  }
  return maskDeep(report)
}
