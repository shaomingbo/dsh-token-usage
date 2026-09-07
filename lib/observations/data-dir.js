/**
 * Profile data directory identity. Same profile, whether the plugin is a
 * conventional install or a symlink to a checkout, must resolve to
 * `<DSH_HOME>/profiles/<profile>/data/dsh-token-usage`. Never infer identity
 * from realpath of this module — that is what split link-dev onto a second ledger.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_NAME = 'dsh-token-usage'
const PROFILE_MARKER = `${sep}profiles${sep}`

export function profileIdFromPath(pathname) {
  const raw = String(pathname ?? '')
  const markerIndex = raw.lastIndexOf(PROFILE_MARKER)
  if (markerIndex === -1) return null
  const profile = raw.slice(markerIndex + PROFILE_MARKER.length).split(sep)[0]
  return profile && profile !== 'node_modules' ? profile : null
}

export function listBundledProfiles(dshHome) {
  const root = join(dshHome, 'profiles')
  let entries = []
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const matched = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    try {
      const manifest = JSON.parse(readFileSync(join(root, entry.name, 'package.json'), 'utf8'))
      const dep = manifest.dependencies?.[PLUGIN_NAME] ?? manifest.devDependencies?.[PLUGIN_NAME]
      const bundled = Array.isArray(manifest.dsh?.profile?.bundles) && manifest.dsh.profile.bundles.includes(PLUGIN_NAME)
      if (dep || bundled) matched.push(entry.name)
    } catch {
      // Unreadable profile manifests are skipped.
    }
  }
  return matched
}

export function resolveProfileId({
  moduleUrl,
  env = process.env,
  home,
  profile,
  cwd = process.cwd(),
} = {}) {
  if (typeof profile === 'string' && profile.trim()) return profile.trim()
  if (typeof env?.DSH_PROFILE === 'string' && env.DSH_PROFILE.trim()) return env.DSH_PROFILE.trim()
  try {
    if (moduleUrl != null) {
      const fromModule = profileIdFromPath(fileURLToPath(moduleUrl))
      if (fromModule) return fromModule
    }
  } catch {
    // Non-file module URLs fall through.
  }
  const fromCwd = profileIdFromPath(cwd)
  if (fromCwd) return fromCwd
  const bundled = listBundledProfiles(home)
  if (bundled.length === 1) return bundled[0]
  return null
}

export function resolveDataDir(options = {}) {
  const identity = resolveDataIdentity(options)
  return identity.path
}

export function resolveDataIdentity({
  moduleUrl,
  env = process.env,
  home,
  profile,
  cwd = process.cwd(),
} = {}) {
  const dshHome = resolve(home ?? env?.DSH_HOME ?? join(homedir(), '.dsh'))
  const homeDir = join(dshHome, PLUGIN_NAME)
  const homeDb = join(homeDir, 'usage.sqlite')
  const homePresent = existsSync(homeDb)
  const candidates = listBundledProfiles(dshHome)
  let profileId = resolveProfileId({ moduleUrl, env, home: dshHome, profile, cwd })
  if (profileId == null && candidates.length > 1) {
    return {
      path: homePresent ? homeDir : null,
      useDir: homePresent ? homeDir : null,
      unresolved: true,
      candidates,
      orphanHomeDir: homePresent ? homeDir : undefined,
      orphanPresent: homePresent,
      profileDbPresent: false,
      migrationPending: false,
      ledgerUnavailable: !homePresent,
    }
  }
  if (profileId == null) profileId = 'web'
  const dataDir = join(dshHome, 'profiles', profileId, 'data', PLUGIN_NAME)
  const profilePresent = existsSync(join(dataDir, 'usage.sqlite'))
  if (homePresent && !profilePresent) {
    return {
      path: dataDir,
      useDir: homeDir,
      profileId,
      unresolved: false,
      candidates,
      orphanHomeDir: homeDir,
      orphanPresent: true,
      profileDbPresent: false,
      migrationPending: true,
      ledgerUnavailable: false,
    }
  }
  return {
    path: dataDir,
    useDir: dataDir,
    profileId,
    unresolved: false,
    candidates,
    orphanHomeDir: homePresent ? homeDir : undefined,
    orphanPresent: homePresent,
    profileDbPresent: profilePresent,
    migrationPending: false,
    ledgerUnavailable: false,
  }
}

export function detectOrphanHomeLedger(dshHome, dataDir) {
  const identity = resolveDataIdentity({ home: dshHome, profile: profileIdFromPath(dataDir) ?? undefined })
  if (identity.orphanPresent !== true) return null
  return {
    path: dataDir,
    orphanHomeDir: identity.orphanHomeDir,
    orphanPresent: true,
    profileDbPresent: identity.profileDbPresent === true,
    migrationPending: identity.migrationPending === true,
  }
}
