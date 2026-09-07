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

test('two bundled profiles without an explicit identity are unresolved', () => {
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
    assert.equal(identity.unresolved, true)
    assert.equal(identity.useDir, null)
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
