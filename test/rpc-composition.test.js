import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import * as plugin from '../lib/index.js'
import { settingsFixture } from './settings-fixture.js'

// Opt-in integration against a locked, read-only lab runtime; no install/server.
const runtime = process.env.DSH_RPC_TEST_RUNTIME

test('official web-fetch-http named inject works without a row inject field', { skip: !runtime }, async () => {
  const { Context } = await published('cordis', '4.0.3')
  const { Loader } = await published('cordis-plugin-loader', '1.0.4')
  const http = await published('dsh-web-fetch-http', '0.1.7-alpha.1')
  const ctx = new Context()
  let registered
  const web = ctx.plugin({ apply(ctx) {
    ctx.provide('web', { registerFetchProvider(provider) { registered = provider } })
  } })
  await web.inertia
  const host = ctx.plugin(Loader, { baseUrl: import.meta.url })
  await host.inertia
  ctx.loader.builtins.http = http
  try {
    await ctx.loader.create({ id: 'http', name: 'cordis:http' })
    await ctx.loader.await()
    await ctx.loader.resolve('http').fiber.await()
    assert.ok(registered instanceof http.HttpFetchProvider)
  } finally {
    ctx.loader.remove('http')
    await web.dispose()
    await host.dispose()
  }
})
async function published(name, version) {
  const store = join(runtime, 'node_modules/.pnpm')
  const prefix = `@deepseek-ai+${name}@${version}_`
  const directory = readdirSync(store).find(name => name.startsWith(prefix))
  assert.ok(directory, `missing locked ${name}@${version}`)
  const require = createRequire(join(store, directory, 'node_modules', '_probe.cjs'))
  return import(pathToFileURL(require.resolve(`@deepseek-ai/${name}`)))
}

for (const mode of ['named', 'row', 'webServer-error', 'owner-missing-inject', 'unrelated-error', 'missing-inject']) {
  test(`real Cordis/Loader/Connection: ${mode}`, { skip: !runtime }, async () => {
    const { Context } = await published('cordis', '4.0.3')
    const { Loader } = await published('cordis-plugin-loader', '1.0.4')
    const { HostConnectionService } = await published('dsh-client-connection', '0.1.7-alpha.1')
    const home = mkdtempSync(join(tmpdir(), 'rpc-composition-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    const routes = new Map()
    const attempts = []
    let owner
    let connection
    const ps = settingsFixture()
    ctx.interval = () => () => {}
    ctx.provide('settings', ps.forms)
    ctx.provide('llm', ps.llm)
    ctx.provide('timer', {})
    ctx.provide('credentials', { resolve: async () => undefined, describe: async () => ({ configured: false }) })
    ctx.provide('sessionPersistence', { listSnapshots: async () => [] })
    const webFiber = ctx.plugin({ apply(ctx) { ctx.provide('webServer', {
      register(route) {
        attempts.push(route.path)
        if (mode === 'webServer-error') throw new Error('webServer unavailable')
        if (mode === 'unrelated-error') throw new Error('unexpected registration failure')
        assert.ok(!routes.has(route.path))
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    }) } })
    await webFiber.inertia
    const loaderFiber = ctx.plugin(Loader, { baseUrl: new URL('../package.json', import.meta.url).href })
    await loaderFiber.inertia
    const loader = ctx.loader
    ctx.provide('webRuntime', { trustedHosts: [] })
    loader.builtins.connection = { apply(ctx) {
      connection = new HostConnectionService(ctx, [], { isAuthenticated: () => false })
    } }
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    const ownerInject = patch.match(/- id: connection\n  inject: \[([^\]]+)\]/)?.[1].split(',').map(name => name.trim())
    assert.deepEqual(ownerInject, ['webRuntime', 'webServer'])
    await loader.create({
      id: 'connection', name: 'cordis:connection',
      inject: ['missing-inject', 'owner-missing-inject'].includes(mode) ? ['webRuntime'] : ownerInject,
    })
    await loader.await()
    // Row restores the consumer dependency through Loader metadata. The raw
    // negative control keeps consumer metadata but omits provider injection:
    // direct ctx.webServer works while the Connection getter's shadow fails.
    // Actual package-name import is used for the normal candidate.
    loader.builtins.probe = {
      ...plugin,
      inject: mode === 'row' ? plugin.inject.filter(name => name !== 'webServer') : plugin.inject,
      apply(ctx, config) {
        owner = ctx
        assert.equal(typeof ctx.webServer.register, 'function', 'consumer named/row metadata is effective')
        if (mode === 'missing-inject') {
          assert.throws(() => ctx.connection.rpc.handle('/token-usage', () => {}), /cannot get property "webServer" without inject/)
          return
        }
        return plugin.apply(ctx, config)
      },
    }
    try {
      await loader.create({
        id: 'probe',
        name: ['row', 'missing-inject'].includes(mode) ? 'cordis:probe' : 'dsh-token-usage',
        ...(mode === 'row' ? { inject: ['webServer'] } : {}),
        config: { providerProxy: false, dataDir: join(home, 'data'), fetchImpl: async () => { throw new Error('network disabled') } },
      })
      await loader.await()
      const fiber = loader.resolve('probe').fiber
      if (mode === 'unrelated-error') {
        assert.notEqual(fiber.state, 2, 'unrelated failures must propagate')
        return
      }
      await fiber.await()
      assert.equal(fiber.state, 2, 'plugin must stay active')
      if (mode === 'missing-inject') {
        assert.ok(owner)
        assert.equal(attempts.length, 0)
        return
      }
      const channels = ['/account-usage', '/subscription-antigravity', '/token-usage']
      assert.deepEqual([...attempts].sort(), mode === 'owner-missing-inject' ? [] : channels)
      assert.deepEqual([...routes.keys()].sort(), ['webServer-error', 'owner-missing-inject'].includes(mode) ? [] : channels)
      for (const channel of channels) {
        assert.ok([...connection.fetchRoutes.keys()].some(path => path.startsWith(`/api${channel}/`)))
      }
      const route = connection.fetchRoutes.get('/api/token-usage/overview')
      const response = await route.fetch(new Request('http://localhost/api/token-usage/overview', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method: 'overview', payload: {} }),
      }))
      assert.equal((await response.json()).result.ok, true)
      if (routes.size) {
        // Transport still owns admission: rejecting anonymous requests never
        // invokes a plugin handler. No substitute listener bypasses Connection.
        let status
        const req = { method: 'POST', url: '/token-usage/overview', headers: { host: 'localhost' } }
        const res = { writeHead(code) { status = code }, end() {} }
        await routes.get('/token-usage').handler(req, res)
        assert.ok(status === 401 || status === 403)
      }
    } finally {
      loader.remove('probe')
      loader.remove('connection')
      await webFiber.dispose()
      await loaderFiber.dispose()
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      rmSync(home, { recursive: true, force: true })
    }
    assert.equal(routes.size, 0, 'route disposal remains owner-bound')
    assert.equal(connection.fetchRoutes.size, 0, 'Fetch disposal remains owner-bound')
  })
}
