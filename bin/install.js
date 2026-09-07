#!/usr/bin/env node
// Public CLI profile adapter (dsh-plugin-release contract). Every mutation is
// delegated to the public `dsh plugin` CLI of the exact tested DSH version;
// lifecycle scripts stay disabled; results are judged by exit status and
// manifest postconditions, never by human-readable prose. There is NO direct
// manifest fallback: if dsh is missing, unsupported, or the command fails,
// the installer fails closed with honest reporting (rc.1 does not promise
// rollback). This installer never starts, stops, restarts or replaces DSH.
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { readFileSync, lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACKAGE_NAME = 'dsh-token-usage'
export const SUPPORTED_DSH_VERSION = '0.1.2-rc.1'
// Default source derives from this package's own version so the pinned tag can
// never drift behind a release again (v5.0.23 shipped pinned to v5.0.22).
const PACKAGE_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
export const DEFAULT_SOURCE = `github:shaomingbo/dsh-token-usage#v${PACKAGE_VERSION.version}`
const CLI_GUIDANCE = `Install @deepseek-ai/dsh@${SUPPORTED_DSH_VERSION} and pnpm, put its dsh executable on PATH, then check dsh --version. No manifest fallback is available.`
const COMMANDS = ['install', 'status', 'uninstall']

export function validateProfile(profile) {
  if (typeof profile !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(profile)) {
    throw new Error('--profile must be a simple name (letters, digits, hyphens or underscores), not a path')
  }
  return profile
}

export function normalizeSource(source, cwd = process.cwd()) {
  if (source === DEFAULT_SOURCE) return source
  if (typeof source === 'string' && source.startsWith('link:') && source.slice(5).trim() && !/[\x00-\x1f\x7f]/.test(source)) {
    return `link:${resolve(cwd, source.slice(5))}`
  }
  throw new Error(`--source must be ${DEFAULT_SOURCE} or an explicit link:<local-path>; floating sources are not supported`)
}

export function parseArgs(argv) {
  const options = { command: 'install', profile: 'web', source: process.env.DSH_TOKEN_USAGE_SOURCE || DEFAULT_SOURCE }
  const seen = new Set()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (COMMANDS.includes(arg)) {
      if (seen.has('command')) throw new Error(`unexpected argument: ${arg}`)
      seen.add('command')
      options.command = arg
    } else if (arg === '--profile' || arg === '--source') {
      if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`)
      seen.add(arg)
      const value = argv[++index]
      if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value`)
      options[arg.slice(2)] = value
    } else throw new Error(`unknown argument: ${arg}`)
  }
  if (!options.profile || !options.source) throw new Error('--profile and --source require values')
  validateProfile(options.profile)
  options.source = normalizeSource(options.source)
  return options
}

export const HELP = `Usage: ${PACKAGE_NAME} [install|status|uninstall] [--profile <name>] [--source <source>]

No command means install. Default profile: web.
  install       Install the bundle through the public dsh plugin CLI (idempotent)
  status        Read-only manifest status; absent/uninstalled is a successful result
  uninstall     Remove the dependency and bundle (idempotent; the usage database is kept)
  --profile     Simple profile name, not a path
  --source      ${DEFAULT_SOURCE}
                or explicit link:<local-path> (relative to the invoking directory)
  -h, --help    Show help without requiring dsh or accessing a profile

Requires exactly dsh ${SUPPORTED_DSH_VERSION} on PATH. Check dsh --version.
All dependency operations pass --ignore-scripts. No direct manifest writes or fallback.
The fixed release tag is a candidate; its publication is not assumed.
The public CLI owns transactions; a failure does not guarantee dependency rollback.
This installer never starts, stops or restarts DSH. After a bundle change, manually
restart the corresponding profile when convenient. For Web, hard-refresh the existing GUI.
`

function readSnapshot(path) {
  try {
    const entry = lstatSync(path)
    if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1) throw Object.assign(new Error(), { code: 'UNSAFE_PROFILE_MANIFEST' })
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw new Error(`Cannot read profile manifest ${path}: ${error.code ?? 'read failed'}`)
  }
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Manifest-only status; credentials, settings, lockfiles and the ledger are never read. */
export function describeStatus(raw, path = '(profile)') {
  if (raw === null) return { installed: false, source: null, bundled: false, manifestExists: false }
  let manifest
  try { manifest = JSON.parse(raw) } catch { throw new Error(`Malformed profile manifest: ${path}`) }
  if (!object(manifest)
    || (manifest.dependencies !== undefined && !object(manifest.dependencies))
    || (manifest.dsh !== undefined && !object(manifest.dsh))
    || (manifest.dsh?.profile !== undefined && !object(manifest.dsh.profile))
    || (manifest.dsh?.profile?.bundles !== undefined && (!Array.isArray(manifest.dsh.profile.bundles) || !manifest.dsh.profile.bundles.every((entry) => typeof entry === 'string')))) {
    throw new Error(`Malformed profile manifest structure: ${path}`)
  }
  const hasDependency = Object.hasOwn(manifest.dependencies ?? {}, PACKAGE_NAME)
  const source = hasDependency ? manifest.dependencies[PACKAGE_NAME] : null
  if (hasDependency && (typeof source !== 'string' || !source)) throw new Error(`Malformed plugin dependency in ${path}`)
  const count = (manifest.dsh?.profile?.bundles ?? []).filter((entry) => entry === PACKAGE_NAME).length
  return { installed: source !== null && count === 1, source, bundled: count > 0, manifestExists: true }
}

function invoke(args, env) {
  // No shell, no direct pnpm calls, no private DSH imports.
  return spawnSync('dsh', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024, timeout: 300000 })
}

function success(result) {
  return !result.error && result.status === 0
}

function checkCli(env) {
  const version = invoke(['--version'], env)
  if (version.error?.code === 'ENOENT') throw new Error(`dsh is missing from PATH. ${CLI_GUIDANCE}`)
  if (!success(version)) throw new Error(`Cannot determine dsh CLI version. ${CLI_GUIDANCE}`)
  // --version is the version contract; never infer command success from prose.
  const actual = version.stdout.trim()
  if (actual !== SUPPORTED_DSH_VERSION) throw new Error(`Unsupported dsh CLI version ${JSON.stringify(actual)}; require exactly ${SUPPORTED_DSH_VERSION}. ${CLI_GUIDANCE}`)
  // Do NOT probe `dsh plugin ... --help`: in published rc.1 help is forwarded
  // to pnpm AFTER profile initialization. Only launcher help is read-only.
  if (!success(invoke(['--help'], env))) throw new Error(`dsh ${SUPPORTED_DSH_VERSION} lacks the required read-only launcher help capability. ${CLI_GUIDANCE}`)
}

/**
 * The public CLI owns all writes and dependency transactions, including recovery.
 * rc.1 does not promise rollback: report changed manifests, never overwrite them.
 * Only the profile package.json is inspected.
 */
export function runProfileAction({ command = 'install', profile = 'web', source = DEFAULT_SOURCE } = {}, { env = process.env, cwd = process.cwd() } = {}) {
  if (!COMMANDS.includes(command)) throw new Error(`Unknown command: ${command}`)
  validateProfile(profile)
  source = normalizeSource(source, cwd)
  const home = resolve(cwd, env.DSH_HOME || join(homedir(), '.dsh'))
  const path = join(home, 'profiles', profile, 'package.json')
  const cliEnv = { ...env, DSH_HOME: home, npm_config_ignore_scripts: 'true' }
  checkCli(cliEnv)
  for (const directory of [join(home, 'profiles'), join(home, 'profiles', profile)]) {
    try {
      const entry = lstatSync(directory)
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw Object.assign(new Error(), { code: 'UNSAFE_PROFILE_DIRECTORY' })
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Cannot safely inspect profile directory (${error.code ?? 'read failed'}).`)
    }
  }
  const before = readSnapshot(path)
  const status = describeStatus(before, path)
  if (command === 'status') return { ...status, profile, changed: false }
  if ((command === 'install' && status.installed && status.source === source)
    || (command === 'uninstall' && status.source === null && !status.bundled)) {
    return { ...status, profile, changed: false }
  }
  // pnpm 11's remove command rejects the --ignore-scripts shorthand. Its
  // documented config form enforces the same policy without a retry/fallback.
  const noScripts = command === 'install' ? '--ignore-scripts' : '--config.ignore-scripts=true'
  const args = ['plugin', '--profile', profile, command === 'install' ? 'add' : 'remove', command === 'install' ? source : PACKAGE_NAME, noScripts]
  const result = invoke(args, cliEnv)
  let after
  try { after = readSnapshot(path) } catch {
    throw new Error('Cannot verify profile manifest after public dsh CLI operation. State is unknown; inspect the profile manually. No installer rollback was attempted.')
  }
  if (!success(result)) {
    const state = before === after ? 'Profile manifest is unchanged; dependency state was not verified.' : 'Profile manifest changed; rollback is NOT confirmed. Inspect the profile manually before retrying.'
    throw new Error(`Public dsh plugin ${command === 'install' ? 'add' : 'remove'} failed (exit ${result.status ?? result.error?.code ?? 'unknown'}). ${state} The public CLI owns the transaction; no installer rollback or fallback was attempted.`)
  }
  const final = describeStatus(after, path)
  const satisfied = command === 'install'
    ? final.installed && final.source === source
    : final.source === null && !final.bundled
  if (!satisfied) throw new Error(`Public dsh CLI exited successfully but ${command} manifest postcondition failed. Inspect ${path}; no fallback or automatic rollback was attempted.`)
  return { ...final, profile, changed: before !== after }
}

export function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(HELP)
    return
  }
  const result = runProfileAction(options)
  console.log(`${PACKAGE_NAME} in profile ${options.profile}: ${result.installed ? 'installed' : result.source !== null || result.bundled ? 'incomplete' : 'not installed'}`)
  if (options.command === 'status') {
    console.log(`dependency: ${result.source ?? '(absent)'}; bundle entry: ${result.bundled ? 'present' : 'absent'}`)
  } else if (result.changed) {
    console.log('Bundle set changed. Manually restart the corresponding DSH profile when convenient; for Web, hard-refresh the existing GUI. No server lifecycle action was performed.')
  } else console.log('No change needed.')
  return result
}

// Node resolves the ESM entry through symlinks, so /var/folders/… or /tmp/…
// scripts would silently no-op if argv[1] were compared without realpath.
function invokedDirectly() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  try { run() } catch (error) {
    console.error(`${PACKAGE_NAME}: ${error.message}`)
    process.exitCode = 1
  }
}