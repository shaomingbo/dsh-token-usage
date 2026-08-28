import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

/** Minimal React + module-loader harness sufficient to drive apply(). */
function loadClientHarness() {
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  }
  const registrations = []
  const injected = []
  const ctx = {
    slots: {
      inject: (name, register) => injected.push({ name, register }),
      register: (definition, component) => {
        registrations.push({ definition, component })
        return () => {}
      },
    },
    locale: undefined,
    effect: (fn) => fn(),
  }
  const require = (name) => {
    if (name === 'react') return React
    throw new Error(`unexpected client dependency: ${name}`)
  }
  let bundle
  const window = { __ModuleLoader__: { load: (loaded) => { bundle = loaded } } }
  new Function('window', 'require', source)(window, require)
  return { bundle, require, injected, registrations, ctx }
}

test('client ships the module-loader factory bundle shape', () => {
  assert.ok(source.includes('window.__ModuleLoader__.load({'), 'must call the module loader at top level')
  assert.match(source, /id: 'dsh-token-usage'/)
  assert.match(source, /factory: \(require\) =>/)
})

test('client injects only slots and connection', () => {
  const { bundle, require } = loadClientHarness()
  const module = bundle.factory(require)
  assert.deepEqual([...module.inject].sort(), ['connection', 'slots'])
})

test('apply registers the sidebar action and the full-frame overlay', () => {
  const { bundle, require, injected, registrations, ctx } = loadClientHarness()
  bundle.factory(require).apply(ctx)
  const names = injected.map((entry) => entry.name)
  assert.ok(names.includes('sidebar.footer.action'), 'sidebar footer action missing')
  assert.ok(names.includes('shell.overlay'), 'shell overlay missing')
  // Drive each registration to prove the components exist.
  for (const entry of injected) entry.register()
  assert.ok(registrations.length >= 2)
  for (const { definition, component } of registrations) {
    assert.ok(['sidebar.footer.action', 'shell.overlay'].includes(definition.name))
    assert.equal(typeof component, 'function')
  }
  const overlay = registrations.find(({ definition }) => definition.name === 'shell.overlay')
  assert.ok(overlay.definition.id.startsWith('dsh-token-usage'))
})

test('client carries both locale dictionaries', () => {
  assert.match(source, /const zh = \{/)
  assert.match(source, /const en = \{/)
})

test('client uses host theme variables and never talks to the network directly', () => {
  assert.match(source, /var\(--dsw-/)
  assert.ok(!/https?:\/\//.test(source), 'no hardcoded remote URLs')
  assert.ok(!/fetch\(/.test(source), 'client never fetches directly; it uses the loopback channel')
})
