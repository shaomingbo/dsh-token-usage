import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OBSERVATION_REFRESH_ACTIVE_MS,
  createObservationFreshness,
  isCapabilityDue,
  observationKey,
  observationRefreshDue,
} from '../lib/observations/freshness.js'

const idle = {
  lastAttemptAt: 0, lastQuotaSuccessAt: 0, nextAttemptAt: 0, backoffMs: 0, runStatus: 'idle', errorCode: null,
}

test('silent cadence still uses the 2-minute active and 5-minute lull tiers', () => {
  const now = 1_000_000_000_000
  assert.equal(observationRefreshDue({ lastRefreshAt: now, pollerActive: true, now: now + 90_000 }).due, false)
  assert.equal(observationRefreshDue({ lastRefreshAt: now, pollerActive: true, now: now + OBSERVATION_REFRESH_ACTIVE_MS }).due, true)
  assert.equal(observationRefreshDue({ lastRefreshAt: now, pollerActive: false, now: now + OBSERVATION_REFRESH_ACTIVE_MS }).due, false)
})

test('API reachability success does not make quota due false after a failed scrape', () => {
  const now = 10_000
  const quota = {
    connectionId: 'openai-codex:default', capabilityId: 'official_usage_api', kind: 'quota',
    credentialPresent: true, authorized: true,
  }
  const cell = { ...idle, lastQuotaSuccessAt: 0, lastAttemptAt: now }
  assert.equal(isCapabilityDue(cell, quota, { trigger: 'sidebar-poll', pollerActive: true, now: now + 1_000 }), true)
})

test('cookie without auto-observe consent is not due on silent triggers but is due on manual', () => {
  const recipe = {
    connectionId: 'ollama-cloud:default', capabilityId: 'official_ui', kind: 'quota',
    credentialPresent: true, authorized: false,
  }
  assert.equal(isCapabilityDue(idle, recipe, { trigger: 'sidebar-poll', pollerActive: true, now: 1 }), false)
  assert.equal(isCapabilityDue(idle, recipe, { trigger: 'boot', now: 1 }), false)
  assert.equal(isCapabilityDue(idle, recipe, { trigger: 'manual', now: 1 }), true)
})

test('authorized official_ui is not due on silent triggers unless the accounts overlay is active', () => {
  const recipe = {
    connectionId: 'ollama-cloud:default', capabilityId: 'official_ui', kind: 'quota',
    credentialPresent: true, authorized: true,
  }
  assert.equal(isCapabilityDue(idle, recipe, { trigger: 'boot', now: 1 }), false)
  assert.equal(isCapabilityDue(idle, recipe, { trigger: 'sidebar-poll', pollerActive: true, overlayActive: false, now: 1 }), false)
  assert.equal(isCapabilityDue(idle, recipe, { trigger: 'overlay-open', overlayActive: true, now: 1 }), true)
  assert.equal(isCapabilityDue(idle, recipe, { trigger: 'manual', now: 1 }), true)
})

test('unsupported capabilities never retry for missing usable rows', () => {
  const recipe = { connectionId: 'ollama-local:default', capabilityId: 'none', kind: 'unsupported' }
  assert.equal(isCapabilityDue(idle, recipe, { trigger: 'sidebar-poll', now: 1 }), false)
  assert.equal(isCapabilityDue(idle, recipe, { trigger: 'manual', now: 1 }), false)
})

test('auth-required and backoff block both silent and manual retries', () => {
  const recipe = {
    connectionId: 'ollama-cloud:default', capabilityId: 'official_ui', kind: 'quota',
    credentialPresent: true, authorized: true,
  }
  assert.equal(isCapabilityDue({ ...idle, runStatus: 'auth-required' }, recipe, { trigger: 'manual', now: 5 }), false)
  assert.equal(isCapabilityDue({ ...idle, nextAttemptAt: 10_000 }, recipe, { trigger: 'manual', now: 5_000 }), false)
  assert.equal(isCapabilityDue({ ...idle, nextAttemptAt: 10_000 }, recipe, { trigger: 'sidebar-poll', now: 5_000 }), false)
})

test('an expired quota window is due even inside the silent cadence', () => {
  const now = 20_000
  const recipe = {
    connectionId: 'openai-codex:default', capabilityId: 'official_usage_api', kind: 'quota',
    credentialPresent: true, authorized: true, windowExpired: true,
  }
  const cell = { ...idle, lastQuotaSuccessAt: now - 1_000 }
  assert.equal(isCapabilityDue(cell, recipe, { trigger: 'sidebar-poll', pollerActive: true, now }), true)
})

test('ensureFresh coalesces concurrent callers and catch-up runs only the missing capability', async () => {
  const freshness = createObservationFreshness({ now: () => 1_000 })
  const runs = []
  const hang = []
  const quota = {
    connectionId: 'glm:default', capabilityId: 'official_usage_api', kind: 'quota',
    credentialPresent: true, authorized: true,
  }
  const cookie = {
    connectionId: 'ollama-cloud:default', capabilityId: 'official_ui', kind: 'quota',
    credentialPresent: true, authorized: true,
  }
  const first = freshness.ensureFresh({
    trigger: 'boot',
    recipes: [quota],
    run: (due) => {
      runs.push(due.map((item) => item.capabilityId))
      return new Promise((resolvePromise) => { hang.push(resolvePromise) })
    },
  })
  const joined = freshness.ensureFresh({
    trigger: 'manual',
    recipes: [quota, cookie],
    run: (due) => {
      runs.push(due.map((item) => item.capabilityId))
      return Promise.resolve(due.map((item) => ({ key: observationKey(item.connectionId, item.capabilityId), quotaSuccess: true })))
    },
  })
  await Promise.resolve()
  assert.equal(runs.length, 1)
  hang[0]([{ key: observationKey(quota.connectionId, quota.capabilityId), quotaSuccess: true }])
  await first
  await joined
  assert.deepEqual(runs, [['official_usage_api'], ['official_ui']])
})

test('429/timeout apply backoff; credential change clears auth-required', async () => {
  let now = 1_000
  const freshness = createObservationFreshness({ now: () => now })
  const recipe = {
    connectionId: 'ollama-cloud:default', capabilityId: 'official_ui', kind: 'quota',
    credentialPresent: true, authorized: true,
  }
  await freshness.ensureFresh({
    trigger: 'manual', recipes: [recipe],
    run: () => Promise.resolve([{ key: observationKey(recipe.connectionId, recipe.capabilityId), errorCode: 'timeout' }]),
  })
  const afterTimeout = freshness.snapshotFor(recipe.connectionId, recipe.capabilityId)
  assert.equal(afterTimeout.refreshStatus, 'backoff')
  now = 2_000
  const skipped = await freshness.ensureFresh({
    trigger: 'manual', recipes: [recipe],
    run: () => { throw new Error('should not run while backing off') },
  })
  assert.deepEqual(skipped.results, [])

  await freshness.ensureFresh({
    trigger: 'boot',
    recipes: [{ ...recipe, capabilityId: 'official_usage_api', connectionId: 'openai-codex:default' }],
    run: () => Promise.resolve([{
      key: observationKey('openai-codex:default', 'official_usage_api'),
      errorCode: 'USAGE_UNAUTHORIZED', authRequired: true,
    }]),
  })
  assert.equal(freshness.snapshotFor('openai-codex:default', 'official_usage_api').refreshStatus, 'auth-required')
  freshness.noteCredentialChange('openai-codex:default', 'official_usage_api')
  assert.equal(freshness.snapshotFor('openai-codex:default', 'official_usage_api').refreshStatus, 'idle')
})
