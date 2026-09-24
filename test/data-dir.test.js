import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectOrphanHomeLedger, resolveDataDir, resolveDataIdentity, resolveProfileId } from '../lib/observations/data-dir.js'

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-token-usage-datadir-'))
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

test('DSH_PROFILE and config.profile win over module location', () => {
  const env = tempHome()
  try {
    const dir = resolveDataDir({
      home: env.home,
      profile: 'web',
      env: { DSH_PROFILE: 'other' },
      cwd: env.home,
    })
    assert.equal(dir, join(env.home, 'profiles', 'web', 'data', 'dsh-token-usage'))
    assert.equal(resolveProfileId({ home: env.home, env: { DSH_PROFILE: 'lab' }, cwd: env.home }), 'lab')
  } finally {
    env.cleanup()
  }
})

test('two bundled profiles without any store anywhere adopt the home-level directory', () => {
  const env = tempHome()
  try {
    for (const name of ['web', 'lab']) {
      mkdirSync(join(env.home, 'profiles', name), { recursive: true })
      writeFileSync(join(env.home, 'profiles', name, 'package.json'), JSON.stringify({
        dependencies: { 'dsh-token-usage': 'link:../..' },
        dsh: { profile: { bundles: ['dsh-token-usage'] } },
      }))
    }
    const identity = resolveDataIdentity({ home: env.home, cwd: env.home, moduleUrl: import.meta.url })
    // Fresh single-root home: nothing to disambiguate, first write creates.
    assert.equal(identity.unresolved, false)
    assert.equal(identity.useDir, join(env.home, 'dsh-token-usage'))
    assert.deepEqual(identity.candidates.sort(), ['lab', 'web'])
  } finally {
    env.cleanup()
  }
})

test('a bundled profile holding a ledger keeps the legacy ambiguity unresolved', () => {
  const env = tempHome()
  try {
    for (const name of ['web', 'lab']) {
      mkdirSync(join(env.home, 'profiles', name, 'data', 'dsh-token-usage'), { recursive: true })
      writeFileSync(join(env.home, 'profiles', name, 'package.json'), JSON.stringify({
        dependencies: { 'dsh-token-usage': 'link:../..' },
        dsh: { profile: { bundles: ['dsh-token-usage'] } },
      }))
    }
    writeFileSync(join(env.home, 'profiles', 'lab', 'data', 'dsh-token-usage', 'usage.sqlite'), '')
    const identity = resolveDataIdentity({ home: env.home, cwd: env.home, moduleUrl: import.meta.url })
    assert.equal(identity.unresolved, true)
    assert.equal(identity.useDir, null)
    assert.equal(identity.migrationPending, true)
    assert.deepEqual(identity.candidates.sort(), ['lab', 'web'])
  } finally {
    env.cleanup()
  }
})

test('home-level ledger is kept when the resolved profile store does not exist', () => {
  const env = tempHome()
  try {
    mkdirSync(join(env.home, 'dsh-token-usage'), { recursive: true })
    writeFileSync(join(env.home, 'dsh-token-usage', 'usage.sqlite'), '')
    const identity = resolveDataIdentity({ home: env.home, profile: 'web', cwd: env.home })
    assert.equal(identity.migrationPending, true)
    assert.equal(identity.useDir, join(env.home, 'dsh-token-usage'))
    assert.equal(identity.path, join(env.home, 'profiles', 'web', 'data', 'dsh-token-usage'))
    assert.equal(existsSync(identity.path), false)
  } finally {
    env.cleanup()
  }
})

test('single-root default ignores cwd/module guesses and does not invent web', () => {
  const env = tempHome()
  try {
    assert.equal(resolveDataDir({ home: env.home, env: {}, cwd: join(env.home, 'profiles', 'web') }), join(env.home, 'dsh-token-usage'))
    assert.equal(resolveProfileId({ home: env.home, env: {}, cwd: join(env.home, 'profiles', 'web') }), null)
    assert.throws(() => resolveDataDir({ home: env.home, profile: '../other', env: {} }), /simple name/)
  } finally { env.cleanup() }
})

test('a legacy ledger without a manifest is unresolved until explicitly selected; never moved', () => {
  const env = tempHome()
  try {
    const legacy = join(env.home, 'profiles', 'old', 'data', 'dsh-token-usage')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, 'usage.sqlite'), '')
    const unknown = resolveDataIdentity({ home: env.home, env: {} })
    assert.equal(unknown.unresolved, true)
    assert.equal(unknown.useDir, null)
    assert.equal(resolveDataIdentity({ home: env.home, env: {}, profile: 'old' }).useDir, legacy)
    assert.equal(existsSync(join(env.home, 'dsh-token-usage')), false)
    assert.equal(existsSync(join(legacy, 'usage.sqlite')), true)
  } finally { env.cleanup() }
})

test('orphan home-level ledger is detected without being selected', () => {
  const env = tempHome()
  try {
    const dataDir = join(env.home, 'profiles', 'web', 'data', 'dsh-token-usage')
    mkdirSync(join(env.home, 'dsh-token-usage'), { recursive: true })
    writeFileSync(join(env.home, 'dsh-token-usage', 'usage.sqlite'), '')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'usage.sqlite'), '')
    const detected = detectOrphanHomeLedger(env.home, dataDir)
    assert.equal(detected.orphanPresent, true)
    assert.equal(detected.profileDbPresent, true)
    assert.equal(detected.orphanHomeDir, join(env.home, 'dsh-token-usage'))
    assert.equal(detected.path, dataDir)
  } finally {
    env.cleanup()
  }
})
