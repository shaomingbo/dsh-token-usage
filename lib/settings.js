/**
 * Plugin settings persisted next to the ledger (identity, display timezone,
 * sidebar summary, CNY rate, retention, alias/override/multiplier tables are
 * in SQLite; this file keeps only small display preferences and the local
 * avatar). Atomic whole-file JSON, no conversation content ever.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

const DEFAULTS = {
  displayName: null,
  accountName: null,
  avatarDataUrl: null,
  timezone: null, // null = follow system
  cnyRate: null, // null = USD only
  sidebarSummary: 'pools', // 'pools' dual bars | 'badge' | 'plain' | 'hidden'
  retentionDays: null, // null = keep forever
}

export class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath
    this.data = { ...DEFAULTS }
    this.load()
  }

  load() {
    try {
      if (existsSync(this.filePath)) {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'))
        this.data = { ...DEFAULTS, ...parsed }
      }
    } catch {
      this.data = { ...DEFAULTS }
    }
  }

  get(key) {
    return this.data[key]
  }

  set(key, value) {
    if (!(key in DEFAULTS)) throw new Error(`unknown setting: ${key}`)
    this.data[key] = value
    this.save()
    return this.data[key]
  }

  toJSON() {
    return { ...this.data }
  }

  save() {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.tmp`
    writeFileSync(temp, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8')
    renameSync(temp, this.filePath)
  }
}
