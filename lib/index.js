/**
 * Host half of dsh-token-usage: opens the profile-local ledger, folds live
 * session events, schedules read-only historical import and daily
 * reconciliation, and serves the client over the loopback-only
 * /token-usage channel. Failures stay contained here: the ledger never
 * takes Harness down, and it never stops, restarts, or patches anything.
 */

import { homedir, userInfo } from 'node:os'
import { realpathSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLedgerService, LedgerError } from './ledger/service.js'
import { SettingsStore } from './settings.js'
import { requestsToCsv, reportToJson } from './ledger/export.js'
import {
  LITELLM_PRICE_URL,
  PriceCatalog,
  nanoToUsdString,
  normalizeModelKey,
  parseLiteLlmPrices,
} from './ledger/pricing.js'

export const name = 'dsh-token-usage'
export const inject = ['connection', 'sessionPersistence', 'timer']

const CHANNEL = '/token-usage'
const DAY = 86_400_000

/**
 * Resolve the profile-private data directory. Conventionally installed
 * copies live under `<home>/profiles/<name>/node_modules/…`, so the real
 * path of this module reveals the profile name; `link:` development falls
 * back to a home-level directory. A row config `dataDir` always wins.
 */
export function resolveDataDir({ moduleUrl = import.meta.url, env = process.env, home } = {}) {
  const dshHome = resolve(home ?? env.DSH_HOME ?? join(homedir(), '.dsh'))
  try {
    const real = realpathSync(fileURLToPath(moduleUrl))
    const marker = `${sep}profiles${sep}`
    const markerIndex = real.lastIndexOf(marker)
    if (markerIndex !== -1) {
      const rest = real.slice(markerIndex + marker.length)
      const profile = rest.split(sep)[0]
      if (profile) return join(dshHome, 'profiles', profile, 'data', 'dsh-token-usage')
    }
  } catch {
    // Fall through to the home-level directory.
  }
  return join(dshHome, 'dsh-token-usage')
}

function defaultIdentity() {
  let name = null
  try {
    name = userInfo().username ?? null
  } catch {
    name = null
  }
  return { displayName: name, accountName: name }
}

export function apply(ctx, config = {}) {
  const dataDir = config.dataDir !== undefined
    ? resolve(String(config.dataDir))
    : resolveDataDir()
  const settings = new SettingsStore(join(dataDir, 'settings.json'))
  if (settings.get('displayName') === null || settings.get('accountName') === null) {
    const identity = defaultIdentity()
    if (settings.get('displayName') === null) settings.set('displayName', identity.displayName)
    if (settings.get('accountName') === null) settings.set('accountName', identity.accountName)
  }

  // Degraded mode: the ledger opens lazily so a corrupt or unsupported store
  // never blocks this plugin, Harness boot, or any other plugin.
  let service = null
  let lastError = null
  function openLedger() {
    if (service !== null) return service
    try {
      service = createLedgerService({ databasePath: join(dataDir, 'usage.sqlite') })
      lastError = null
    } catch (error) {
      lastError = error instanceof LedgerError
        ? error
        : new LedgerError('ledger-open-failed', error instanceof Error ? error.message : String(error))
      ctx.logger.error('dsh-token-usage: ledger unavailable: %s', lastError.message)
    }
    return service
  }
  openLedger()

  const importState = {
    running: false, paused: false, canceled: false,
    total: 0, done: 0, calls: 0, errors: 0,
    startedAt: null, finishedAt: null, lastError: null,
  }
  let pendingPricePreview = null

  async function fetchPricePreview(led) {
    const response = await fetch(LITELLM_PRICE_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw Object.assign(new Error(`LiteLLM price fetch failed with HTTP ${response.status}`), { code: 'price-source-failed' })
    const updatedAt = Date.now()
    const prices = parseLiteLlmPrices(await response.json(), { updatedAt })
    if (prices.size === 0) throw Object.assign(new Error('LiteLLM returned no complete model prices'), { code: 'price-source-empty' })
    const catalog = led.priceCatalog()
    const previewCatalog = new PriceCatalog({ snapshot: { version: 'preview', source: 'preview', models: {} }, updates: prices })
    const candidateIndex = new Map()
    for (const model of prices.keys()) {
      const key = normalizeModelKey(model)
      const candidates = candidateIndex.get(key) ?? []
      candidates.push(model)
      candidateIndex.set(key, candidates)
    }
    const mappings = catalog.observed.map((row) => ({
      model: row.model,
      provider: row.provider,
      requests: row.requests,
      matched: previewCatalog.priceFor(row.model, row.provider)?.matchedModel ?? null,
      candidates: (candidateIndex.get(normalizeModelKey(row.model)) ?? []).slice(0, 5),
    }))
    pendingPricePreview = {
      prices,
      source: 'litellm-upstream',
      updatedAt,
      expiresAt: updatedAt + 10 * 60_000,
    }
    return {
      fetched: prices.size,
      matchedObserved: mappings.filter((row) => row.matched !== null).length,
      observed: mappings.length,
      mappings: mappings.slice(0, 50),
      updatedAt,
      source: 'LiteLLM',
    }
  }

  async function importSnapshot(snap) {
    // SessionInspection is { meta: SessionHeader, events } — the header lives
    // on `meta`, never on `header`.
    const inspection = await ctx.sessionPersistence.inspect(snap.header.id)
    const header = { ...inspection.meta, revision: snap.revision }
    const result = service.importSession({ header, events: inspection.events }, { source: 'profile' })
    importState.calls += result.imported
  }

  async function runImport({ full = false } = {}) {
    if (service === null || importState.running) return { started: false, reason: importState.running ? 'already-running' : 'unavailable' }
    importState.running = true
    importState.paused = false
    importState.canceled = false
    importState.errors = 0
    importState.lastError = null
    importState.startedAt = Date.now()
    importState.finishedAt = null
    try {
      const snapshots = await ctx.sessionPersistence.listSnapshots()
      service.reconcileSources(snapshots.map((snap) => ({ id: snap.header.id, revision: snap.revision })))
      importState.total = snapshots.length
      importState.done = 0
      for (const snap of snapshots) {
        while (importState.paused && !importState.canceled) await delay(250)
        if (importState.canceled) break
        try {
          const known = service.getSourceMeta(snap.header.id)
          if (!full && known !== null && known.revision === snap.revision) {
            importState.done += 1
            continue
          }
          await importSnapshot(snap)
        } catch (error) {
          importState.errors += 1
          importState.lastError = error instanceof Error ? error.message : String(error)
          ctx.logger.warn('dsh-token-usage: import failed for %s: %s', snap.header.id, importState.lastError)
        }
        importState.done += 1
      }
    } catch (error) {
      importState.errors += 1
      importState.lastError = error instanceof Error ? error.message : String(error)
      ctx.logger.warn('dsh-token-usage: import pass failed: %s', importState.lastError)
    } finally {
      importState.running = false
      importState.finishedAt = Date.now()
    }
    return { started: true }
  }

  // Live capture: post-commit events only. Constructor seeds do not emit;
  // historical import owns everything before the watermark. Creation
  // metadata (cwd, lineage) lives on the durable header, not the session.
  try {
    ctx.on('session/event', (session, event) => {
      if (service === null) return
      try {
        const header = session.header ?? {}
        service.ingestEvent({
          id: session.id ?? header.id,
          createdAt: header.createdAt,
          cwd: header.cwd,
          parentSession: header.parentSession,
          seedLength: header.seedLength,
          origin: header.origin,
        }, event)
      } catch {
        // Contained: a live-capture failure must never break the feed.
      }
    })
  } catch (error) {
    ctx.logger.warn('dsh-token-usage: live capture unavailable: %s', error instanceof Error ? error.message : String(error))
  }

  // Startup import (background), then a daily reconciliation pass.
  void Promise.resolve().then(() => runImport({ full: false }))
  ctx.interval(() => { void runImport({ full: false }) }, DAY)

  const envelopeFailure = (message, code = 'internal') => ({ ok: false, error: { code, message } })
  const envelopeSuccess = (value) => ({ ok: true, value })

  function requireLedger() {
    if (service === null) openLedger()
    if (service === null) throw Object.assign(new Error(lastError?.message ?? 'ledger unavailable'), { code: 'ledger-unavailable' })
    return service
  }

  function timezone() {
    return settings.get('timezone') ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  }

  function overviewPayload() {
    const tz = timezone()
    const overview = service.getOverview({ timezone: tz })
    const today = service.getDailySeries({ from: isoDate(Date.now(), tz), to: isoDate(Date.now() + DAY, tz), timezone: tz })
    return {
      totals: overview.totals,
      totalsIncludingEstimates: overview.totalsIncludingEstimates,
      estimatedShare: overview.estimatedShare,
      cost: overview.cost,
      streaks: overview.streaks,
      costCnyRate: settings.get('cnyRate'),
      today: today.days[0] ?? null,
    }
  }

  function isoDate(ms, tz) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
  }

  ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload, signal) => {
    try {
      const led = requireLedger()
      const body = payload ?? {}
      switch (endpoint) {
        case 'overview':
          return envelopeSuccess({ ...overviewPayload(), identity: publicIdentity(settings), profile: profileLabel() })
        case 'daily': {
          const tz = body.timezone ?? timezone()
          const to = body.to ?? isoDate(Date.now() + DAY, tz)
          const from = body.from ?? isoDate(Date.now() - 364 * DAY, tz)
          return envelopeSuccess(led.getDailySeries({ from, to, timezone: tz }))
        }
        case 'rankings': {
          const days = Number.isFinite(body.days) ? Number(body.days) : 30
          const toMs = Date.now()
          return envelopeSuccess(led.getRankings({ dimension: body.dimension ?? 'model', timezone: timezone(), fromMs: toMs - days * DAY, toMs }))
        }
        case 'requests':
          return envelopeSuccess(led.listRequests({
            sessionId: body.sessionId, model: body.model, provider: body.provider,
            status: body.status, estimated: body.estimated,
            fromMs: body.fromMs, toMs: body.toMs,
            limit: body.limit ?? 50, offset: body.offset ?? 0,
          }))
        case 'sessions':
          return envelopeSuccess(led.listSessions({ timezone: timezone(), limit: body.limit ?? 100, offset: body.offset ?? 0 }))
        case 'session-detail':
          return envelopeSuccess(led.getSessionDetail(String(body.id), { timezone: timezone() }))
        case 'import-status':
          return envelopeSuccess({ ...importState })
        case 'import-control': {
          const action = body.action
          if (action === 'pause') importState.paused = true
          else if (action === 'resume') importState.paused = false
          else if (action === 'cancel') importState.canceled = true
          else if (action === 'scan') void runImport({ full: body.full === true })
          else throw new Error(`unknown import action: ${String(action)}`)
          return envelopeSuccess({ ...importState })
        }
        case 'settings':
          return envelopeSuccess({
            settings: settings.toJSON(),
            aliases: ledDump(led, 'aliases'),
            overrides: ledDump(led, 'price_overrides'),
            updates: ledDump(led, 'price_updates'),
            multipliers: ledDump(led, 'providers'),
            priceSnapshot: led.snapshotMeta(),
          })
        case 'price-catalog':
          return envelopeSuccess(led.priceCatalog())
        case 'price-refresh-preview':
          return envelopeSuccess(await fetchPricePreview(led))
        case 'price-refresh-apply': {
          if (pendingPricePreview === null || pendingPricePreview.expiresAt < Date.now()) {
            await fetchPricePreview(led)
          }
          const pending = pendingPricePreview
          const result = led.setUpstreamPrices(pending.prices, {
            source: pending.source,
            updatedAt: pending.updatedAt,
          })
          pendingPricePreview = null
          return envelopeSuccess(result)
        }
        case 'set-setting': {
          const value = settings.set(String(body.key), body.value)
          return envelopeSuccess({ key: body.key, value })
        }
        case 'set-alias':
          led.setAlias(String(body.model), String(body.canonical))
          return envelopeSuccess({})
        case 'set-override':
          led.setOverride(String(body.model), {
            inputNano: Number(body.inputNano), outputNano: Number(body.outputNano),
            cacheReadNano: body.cacheReadNano !== undefined ? Number(body.cacheReadNano) : undefined,
            cacheWriteNano: body.cacheWriteNano !== undefined ? Number(body.cacheWriteNano) : undefined,
          })
          return envelopeSuccess({})
        case 'set-multiplier':
          led.setMultiplier(String(body.provider), Number(body.bps))
          return envelopeSuccess({})
        case 'export': {
          const content = exportContent(led, body)
          return envelopeSuccess(content)
        }
        case 'backup': {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-')
          const path = join(dataDir, 'backups', `usage-${stamp}.sqlite`)
          led.backupTo(path)
          return envelopeSuccess({ path })
        }
        case 'restore': {
          // Restorable files live in the plugin's own backups directory.
          const backupsDir = join(dataDir, 'backups')
          const resolvedPath = resolve(String(body.path))
          if (resolvedPath !== backupsDir && !resolvedPath.startsWith(backupsDir + sep)) {
            throw Object.assign(new Error('restore path must be inside the plugin backups directory'), { code: 'bad-backup-path' })
          }
          led.restoreFrom(resolvedPath, { mode: body.mode === 'replace' ? 'replace' : 'merge' })
          return envelopeSuccess({})
        }
        case 'purge': {
          const days = Number(body.days)
          if (!Number.isFinite(days) || days <= 0) throw new Error('purge requires a positive day count')
          const cutoff = Date.now() - days * DAY
          const result = led.purgeBefore(cutoff, { timezone: timezone() })
          return envelopeSuccess({ cutoff, ...result })
        }
        default:
          return envelopeFailure(`unknown token-usage endpoint: ${endpoint}`)
      }
    } catch (error) {
      return envelopeFailure(
        error instanceof Error ? error.message : 'token-usage request failed',
        error?.code,
      )
    }
  }, { authority: 'loopback' })

  function ledDump(led, table) {
    return led.dumpTable(table)
  }

  function publicIdentity(store) {
    const displayName = store.get('displayName') ?? 'local user'
    const accountName = store.get('accountName') ?? displayName
    const avatarDataUrl = store.get('avatarDataUrl')
    const initials = String(displayName).slice(0, 2).toUpperCase()
    return { displayName, accountName, avatarDataUrl, initials }
  }

  function profileLabel() {
    return config.profileLabel ?? null
  }

  function exportContent(led, body) {
    const kind = body.kind ?? 'requests-csv'
    if (kind === 'requests-csv') {
      const rows = led.listRequests({ limit: 100_000 }).rows
      return {
        filename: `token-usage-requests-${new Date().toISOString().slice(0, 10)}.csv`,
        mime: 'text/csv',
        content: requestsToCsv(rows, { anonymize: body.anonymize !== false, nanoToUsd: nanoToUsdString }),
      }
    }
    if (kind === 'report-json') {
      const tz = timezone()
      const report = {
        generatedAt: new Date().toISOString(),
        timezone: tz,
        overview: overviewPayload(),
        daily: led.getDailySeries({ timezone: tz, from: isoDate(Date.now() - 364 * DAY, tz), to: isoDate(Date.now() + DAY, tz) }).days,
        models: led.getRankings({ dimension: 'model', timezone: tz }),
        providers: led.getRankings({ dimension: 'provider', timezone: tz }),
        projects: led.getRankings({ dimension: 'project', timezone: tz }),
      }
      return {
        filename: `token-usage-report-${new Date().toISOString().slice(0, 10)}.json`,
        mime: 'application/json',
        content: JSON.stringify(reportToJson(report, { anonymize: body.anonymize !== false }), null, 2),
      }
    }
    throw new Error(`unknown export kind: ${String(kind)}`)
  }

  ctx.on('dispose', () => {
    service?.dispose()
    service = null
  })
}

function delay(ms) {
  return new Promise((resolvePromise) => { setTimeout(resolvePromise, ms) })
}
