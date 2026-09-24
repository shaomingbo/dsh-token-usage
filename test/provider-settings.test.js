import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createProviderSettings } from '../lib/provider-settings.js'
import { ensureChatGptGrokRoutes } from '../lib/capabilities/chatgpt-grok/capability.js'
import { ensureAntigravityRoute } from '../lib/capabilities/antigravity/capability.js'
import { settingsFixture } from './settings-fixture.js'

test('a439ba94 route bootstrap fails against the same new SettingsForms shape (negative control)', async () => {
  const source = execFileSync('git', ['show', 'a439ba94501d7d0277c3f3847d94d7e1d4498633:lib/capabilities/chatgpt-grok/capability.js'], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' })
  const body = source.match(/export async function ensureChatGptGrokRoutes\(settings\) \{([\s\S]*?)\n\}/)[1]
  const oldEnsure = new Function('settings', `return (async () => { ${body} })()`)
  await assert.rejects(oldEnsure(settingsFixture().forms), /settings.get is not a function/)
})

test('directory uses renamed entry and precise paths, not a redacted providers replacement', async () => {
  const settings = settingsFixture({ renamed: { providers: { 'openai-codex': { models: [{ id: 'mine' }], headers: { hidden: 'fixture-secret' } } } } }, { ns: 'renamed' })
  const describe = settings.forms.describe.bind(settings.forms)
  settings.forms.describe = options => {
    const rows = structuredClone(describe(options))
    delete rows[0].value.providers['openai-codex'].headers
    return rows
  }
  await ensureChatGptGrokRoutes(settings)
  assert.equal(settings.value.renamed.providers['openai-codex'].apiKeyEnv, 'OPENAI_CODEX_ACCESS_TOKEN')
  assert.deepEqual(settings.value.renamed.providers['openai-codex'].headers, { hidden: 'fixture-secret' })
  assert.deepEqual(settings.value.renamed.providers['openai-codex'].models, [{ id: 'mine' }])
  assert.ok(settings.forms.calls.every(call => call.namespace === 'renamed' && call.ops.every(op => op.path.length >= 3)))
  const count = settings.forms.calls.length
  await ensureChatGptGrokRoutes(settings)
  assert.equal(settings.forms.calls.length, count)
})

test('boot leaves custom credential refs and user route fields unchanged', async () => {
  const existing = { apiKeyEnv: 'USER_REF', displayName: 'Mine', models: [{ id: 'private' }], baseURL: 'https://private.invalid' }
  const settings = settingsFixture({ 'llm-pi-ai': { providers: { 'openai-codex': existing } } })
  await ensureChatGptGrokRoutes(settings)
  assert.deepEqual(settings.value['llm-pi-ai'].providers['openai-codex'], existing)
})

test('missing directory or volatile form degrades and warns; no namespace guess', async () => {
  for (const llm of [{ listConfigurableProviders: () => [] }, { listConfigurableProviders: () => [{ provider: 'openai-codex', settingsNs: 'renamed', settingsPath: ['providers', 'openai-codex'] }] }]) {
    const warnings = []
    const adapter = createProviderSettings({ llm, settings: { describe: () => [], mutate: assert.fail }, logger: { warn: text => warnings.push(text) } })
    await ensureChatGptGrokRoutes(adapter)
    assert.ok(warnings.length > 0)
  }
})

test('revision conflicts propagate rather than replaying stale redacted data', async () => {
  const settings = settingsFixture()
  const snapshot = settings.read('openai-codex')
  settings.forms.revision++
  await assert.rejects(settings.mutate(snapshot, [{ op: 'set', path: ['apiKeyEnv'], value: 'REF' }]), { code: 'SETTINGS_CONFLICT' })
})

test('unset may restore an inherited base credential ref: inspect effective value', async () => {
  const settings = settingsFixture({ 'llm-pi-ai': { providers: { 'openai-codex': { apiKeyEnv: 'OVERRIDE' } } } }, { base: { providers: { 'openai-codex': { apiKeyEnv: 'BASE_REF' } } } })
  await settings.mutate(settings.read('openai-codex'), [{ op: 'unset', path: ['apiKeyEnv'] }])
  assert.equal(settings.read('openai-codex').value.apiKeyEnv, 'BASE_REF')
})

test('antigravity updates one revision transaction and preserves undisclosed siblings', async () => {
  const settings = settingsFixture({ 'llm-pi-ai': { providers: { antigravity: { compat: { custom: true } } } } })
  assert.equal(await ensureAntigravityRoute(settings, 'http://127.0.0.1:51122/v1'), true)
  assert.equal(settings.forms.calls.length, 1)
  assert.equal(settings.read('antigravity').value.compat.custom, true)
})
