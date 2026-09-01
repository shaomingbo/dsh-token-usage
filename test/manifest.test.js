import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('..', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

test('package manifest follows the bundle conventions', async () => {
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, 'lib/index.js')
  assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './client', './cordis.patch.yml', './package.json'])
  assert.equal(manifest.bin[manifest.name], 'bin/install.js')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-connection'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots'))
  assert.ok(!manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'))
  for (const file of ['bin/install.js', 'cordis.patch.yml', 'lib', 'README.md', 'README.zh.md', 'LICENSE']) {
    assert.ok(manifest.files.includes(file), `files must ship ${file}`)
  }
  assert.ok(manifest.repository.url.includes('shaomingbo/dsh-token-usage'))
})

test('the bundle patch only inserts its own row', async () => {
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  assert.match(patch, /- insert:/)
  assert.match(patch, /- id: dsh-token-usage/)
  assert.match(patch, /name: dsh-token-usage/)
  assert.ok(!/- id: (?!dsh-token-usage)/.test(patch), 'must not touch other rows')
})
