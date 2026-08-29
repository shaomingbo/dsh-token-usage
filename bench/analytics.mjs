import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { openDatabase, transaction } from '../lib/ledger/db.js'
import { createLedgerService } from '../lib/ledger/service.js'

const REQUESTS = 100_000
const SESSIONS = 10_000
const NOW = Date.UTC(2026, 7, 31, 12)
const DAY = 86_400_000
const dir = mkdtempSync(join(tmpdir(), 'dsh-token-usage-bench-'))
const path = join(dir, 'usage.sqlite')

try {
  const db = openDatabase(path)
  transaction(db, () => {
    const source = db.prepare('INSERT INTO sources (session_id, last_seq, source, created_at, cwd, deleted) VALUES (?, 9, ?, ?, ?, 0)')
    const project = db.prepare("INSERT OR IGNORE INTO projects (id, identity_kind, identity_value, display_name, created_at) VALUES (?, 'git', ?, ?, ?)")
    const projectSource = db.prepare("INSERT OR IGNORE INTO project_sources (cwd, project_id, source, created_at) VALUES (?, ?, 'git', ?)")
    for (let index = 0; index < SESSIONS; index += 1) {
      const projectIndex = index % 100
      const cwd = `/bench/project-${projectIndex}`
      source.run(`s-${index}`, 'profile', NOW - (index % 30) * DAY, cwd)
      project.run(`p-${projectIndex}`, `remote-${projectIndex}`, `project-${projectIndex}`, NOW)
      projectSource.run(cwd, `p-${projectIndex}`, NOW)
    }
    const request = db.prepare(`
      INSERT INTO requests (session_id, turn, step, seq, time, provider, model_raw, owned,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
        status, estimated, original_usd_nano, price_version, duration_ms)
      VALUES (?, ?, 0, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'ok', 0, ?, 'bench', ?)
    `)
    for (let index = 0; index < REQUESTS; index += 1) {
      const model = index % 2 ? 'deepseek-chat' : 'deepseek-reasoner'
      const input = 300 + index % 100
      const output = 80 + index % 40
      const cacheRead = index % 3 ? 500 : 0
      request.run(`s-${index % SESSIONS}`, Math.floor(index / SESSIONS), index % 10, NOW - (index % 30) * DAY - (index % 86_400_000), 'deepseek', model, input, output, cacheRead, 0, index % 50, 1000, 2500 + index % 500)
    }
  })
  db.close()

  const service = createLedgerService({ databasePath: path })
  const spec = {
    filter: { timezone: 'UTC', time: { fromMs: NOW - 30 * DAY, toMs: NOW + 1 } },
    views: ['kpis', 'series', 'rankings'],
    series: { granularity: 'auto' },
    ranking: { dimension: 'project', by: 'processingTokens', limit: 20 },
    compare: { kind: 'previous-period' },
    now: NOW,
  }
  const coldStart = performance.now()
  service.query(spec)
  const coldMs = performance.now() - coldStart
  const interactive = []
  for (let index = 0; index < 20; index += 1) {
    const start = performance.now()
    service.query({ ...spec, filter: { ...spec.filter, project: [`p-${index}`] } })
    interactive.push(performance.now() - start)
  }
  interactive.sort((a, b) => a - b)
  for (let index = 0; index < 2; index += 1) service.query(spec)
  const timings = []
  for (let index = 0; index < 20; index += 1) {
    const start = performance.now()
    service.query(spec)
    timings.push(performance.now() - start)
  }
  service.dispose()
  timings.sort((a, b) => a - b)
  const p50 = timings[Math.floor(timings.length * 0.5)]
  const p95 = timings[Math.floor(timings.length * 0.95)]
  const interactiveP95 = interactive[Math.floor(interactive.length * 0.95)]
  console.log(JSON.stringify({ requests: REQUESTS, sessions: SESSIONS, runs: timings.length, coldMs: Number(coldMs.toFixed(2)), interactiveP95Ms: Number(interactiveP95.toFixed(2)), cachedP50Ms: Number(p50.toFixed(2)), cachedP95Ms: Number(p95.toFixed(2)), targetMs: 100 }, null, 2))
  if (interactiveP95 > 100 || p95 > 100) process.exitCode = 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
