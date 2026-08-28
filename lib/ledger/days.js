/**
 * Timezone-aware day arithmetic for aggregation. Days are computed in the
 * requested IANA timezone via Intl; raw timestamps stay in UTC everywhere.
 */

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

const dayCache = new Map()
const wallCache = new Map()

function dayFormatter(timezone) {
  let formatter = dayCache.get(timezone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    dayCache.set(timezone, formatter)
  }
  return formatter
}

function wallFormatter(timezone) {
  let formatter = wallCache.get(timezone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    wallCache.set(timezone, formatter)
  }
  return formatter
}

/**
 * Offset minutes east of UTC at `utcMs` in `timezone`: render the wall clock
 * in that zone, reinterpret it as UTC, and measure the difference.
 */
export function offsetAt(utcMs, timezone) {
  const parts = wallFormatter(timezone).formatToParts(new Date(utcMs))
  const get = (type) => Number(parts.find((part) => part.type === type)?.value)
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUTC - utcMs) / MINUTE)
}

/** The calendar date (YYYY-MM-DD) a UTC instant falls on in `timezone`. */
export function localDate(utcMs, timezone) {
  return dayFormatter(timezone).format(new Date(utcMs))
}

/** The UTC instants where the local day `ymd` starts and ends in `timezone`. */
export function localDayBounds(ymd, timezone) {
  const naiveStart = Date.parse(`${ymd}T00:00:00Z`)
  const startOffset = offsetAt(naiveStart, timezone)
  const start = naiveStart - startOffset * MINUTE
  const endOffset = offsetAt(start + 12 * HOUR, timezone)
  const end = naiveStart + DAY - endOffset * MINUTE
  return { start, end }
}

/** Iterate `[ymd, {start, end}]` for every local day intersecting [fromMs, toMs). */
export function eachLocalDay(fromMs, toMs, timezone) {
  const days = []
  const formatter = dayFormatter(timezone)
  let cursor = fromMs
  while (cursor < toMs) {
    const ymd = formatter.format(new Date(cursor))
    const bounds = localDayBounds(ymd, timezone)
    days.push([ymd, bounds])
    cursor = bounds.end
  }
  return days
}

/** Monday-based week start (YYYY-MM-DD) of a local calendar date. */
export function weekStart(ymd) {
  const utc = Date.parse(`${ymd}T00:00:00Z`)
  const day = new Date(utc).getUTCDay() // 0 = Sunday
  const backToMonday = (day + 6) % 7
  return new Date(utc - backToMonday * DAY).toISOString().slice(0, 10)
}
