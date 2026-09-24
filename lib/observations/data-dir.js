/**
 * Explicit single-root/legacy-profile data identity. Default home-level data
 * stays under DSH_HOME; config.profile/DSH_PROFILE retain the old profile path.
 * Never infer identity from module paths, cwd or a lone installed bundle.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

// Mirrors the documented single-root precedence without reading host internals.
export function resolveHome(configured, env = process.env) {
  const value = configured ?? (env?.DSH_HOME?.trim() || join(homedir(), '.dsh'))
  return resolve(value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value)
}

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
    if (existsSync(join(root, entry.name, 'data', PLUGIN_NAME, 'usage.sqlite'))) {
      matched.push(entry.name)
      continue
    }
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
  const explicit = typeof profile === 'string' && profile.trim() ? profile.trim() : env?.DSH_PROFILE?.trim()
  if (explicit) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(explicit)) throw new TypeError('profile must be an explicit simple name')
    return explicit
  }
  // 0.1.7 has a single home root. Module paths, cwd and installed bundles do
  // not identify a legacy profile; selecting one requires an explicit option.
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
  const dshHome = resolveHome(home, env)
  const homeDir = join(dshHome, PLUGIN_NAME)
  const homeDb = join(homeDir, 'usage.sqlite')
  const homePresent = existsSync(homeDb)
  const candidates = listBundledProfiles(dshHome)
  let profileId = resolveProfileId({ moduleUrl, env, home: dshHome, profile, cwd })
  if (profileId == null && candidates.length > 0) {
    const candidateLedgerPresent = candidates.some((id) =>
      existsSync(join(dshHome, 'profiles', id, 'data', PLUGIN_NAME, 'usage.sqlite')))
    if (!homePresent && !candidateLedgerPresent) {
      // Fresh home: no store exists anywhere (home-level or any bundled
      // profile), so there is nothing to disambiguate — adopt the home-level
      // directory and let first write create the ledger.
      return {
        path: homeDir, useDir: homeDir, unresolved: false, candidates,
        orphanPresent: false, profileDbPresent: false, migrationPending: false, ledgerUnavailable: false,
      }
    }
    return {
      path: homePresent ? homeDir : null,
      useDir: homePresent ? homeDir : null,
      unresolved: true,
      candidates,
      orphanHomeDir: homePresent ? homeDir : undefined,
      orphanPresent: homePresent,
      profileDbPresent: candidateLedgerPresent,
      migrationPending: !homePresent && candidateLedgerPresent,
      ledgerUnavailable: !homePresent,
    }
  }
  // Fresh single-root homes and existing home-level ledgers keep their path.
  // Legacy profile directories remain opt-in; nothing is moved or merged.
  if (profileId == null) return {
    path: homeDir, useDir: homeDir, unresolved: false, candidates,
    orphanPresent: false, profileDbPresent: false, migrationPending: false, ledgerUnavailable: false,
  }
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
