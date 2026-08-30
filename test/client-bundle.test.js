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

test('v5 client keeps provider connections and official observations separate from the local ledger', () => {
  for (const label of ['DSH Accounts & Usage', 'Provider connections', 'Official observations', 'Local usage ledger', '提供方连接', '本地用量账本']) {
    assert.ok(source.includes(label), `missing Accounts & Usage label: ${label}`)
  }
  assert.ok(source.includes("'/account-usage'"))
  assert.ok(source.includes("'refresh-observations'"))
  assert.ok(source.includes("refresh: true"))
  assert.ok(source.includes("OLLAMA_SESSION_COOKIE"))
  assert.ok(source.includes("cookieOptIn"))
  assert.ok(source.includes("connection-action"))
  assert.ok(source.includes("'sync-model-catalog'"))
  assert.ok(source.includes('Sync Cloud models'))
  assert.ok(source.includes('同步 Cloud 模型'))
})

test('v5 account lifecycle: entry, dock, overview and per-account insight over the account RPCs', () => {
  // Three-layer objective UI: entry micro indicator, dock panel, full dashboard,
  // plus the per-account insight page.
  for (const label of ['最紧一池', '按账户堆叠', '按模型堆叠', '模型排行', '官方额度', '本地账本', '未归属', '建立你的账户']) {
    assert.ok(source.includes(label), `missing v5 label: ${label}`)
  }
  for (const endpoint of ["'query'", "'entry-summary'", "'save-account'", "'suggest-accounts'", "'templates'", "'accounts'", "'archive-account'", "kind: 'pool'"]) {
    assert.ok(source.includes(endpoint), `missing ${endpoint} surface`)
  }
  // Lens switch drives one query surface; refresh keeps the 15s cadence.
  assert.match(source, /lensBy\(state\.lens\)/)
  assert.match(source, /15_000/)
  // Official-first meters and honest source labels are mandatory.
  assert.ok(source.includes('OfficialWindowRow'))
  assert.ok(source.includes('sourceOfficialApi'))
  assert.ok(source.includes('observationDisclaimer'))
  // The four-space workbench, inspector stacks, and saved views are gone.
  assert.ok(!source.includes('成本与预算'), 'v2 cost space must be gone')
  assert.ok(!source.includes('inspectorStack'), 'inspector stack must be gone')
  assert.ok(!source.includes('savedViews'), 'saved views must be gone')
  // The legacy plan editor is retired; accounts own the editor surface.
  assert.ok(!source.includes("'save-plan'"), 'save-plan RPC must not be used by the client')
  assert.ok(!source.includes('PlansEditor'))
})

test('client uses host theme variables and never talks to the network directly', () => {
  assert.match(source, /var\(--dsw-/)
  assert.ok(!/https?:\/\//.test(source), 'no hardcoded remote URLs')
  assert.ok(!/fetch\(/.test(source), 'client never fetches directly; it uses the loopback channel')
})

test('sidebar entry renders the tightest-pool micro bars in pools mode', () => {
  assert.match(source, /tu3-entry-b1/)
  assert.match(source, /entry-summary/)
  assert.match(source, /sidebarSummary/)
  assert.match(source, /'pools'/)
})

test('pace notes are average-rate arithmetic, labelled as such', () => {
  assert.match(source, /paceDisclaimer/)
  assert.match(source, /ratePerDay/)
  assert.match(source, /leftoverAtExpiryUsd/)
})

test('v5 components render against a mocked host without throwing', async () => {
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  }
  const emptyMeasures = () => ({
    requests: 0, calls: 0, failedRequests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    cacheWriteTokens: 0, reasoningTokens: 0, processingTokens: 0, newComputeTokens: 0,
    cost: { originalUsdNano: 0, currentUsdNano: 0, coverage: 1, pricedTokens: 0, totalTokens: 0 },
  })
  const pool = (id, name, extra = {}) => ({
    id, name, kind: 'subscription', sourceKind: 'connection', providerId: 'openai-codex',
    connectionId: 'openai-codex:default', color: '#3d6ee8', limits: [], quotaWindows: [], kpis: emptyMeasures(),
    usedPct: null, localUsedPct: null, officialUsedPct: 42, pace: null, billing: null,
    official: {
      observedAt: 1_800_000_000_000, sourceKind: 'official_usage_api', brittle: false,
      windows: [{ id: 'w1', label: '5h', percentUsed: 42, resetsAt: Date.now() + 3_600_000, durationMs: 18_000_000 }],
    },
    ...extra,
  })
  const poolsPayload = {
    configured: true,
    month: { elapsedPct: 50, daysLeft: 15, resetLabel: '2026-09-01' },
    pools: [pool('connection:openai-codex:default', 'ChatGPT Plus/Pro')],
    unassigned: null,
    tightestPoolId: 'connection:openai-codex:default',
  }
  const responses = new Map([
    ['/token-usage:entry-summary', { configured: true, month: poolsPayload.month, tightest: { id: 'x', name: 'ChatGPT Plus/Pro', color: null, usedPct: 42, sourceKind: 'official_usage_api', windowLabel: '5h', resetsAt: Date.now() + 3_600_000 }, pools: [] }],
    ['/token-usage:settings', { settings: {}, aliases: [], overrides: [], updates: [], multipliers: [], priceSnapshot: {} }],
    ['/token-usage:overview', { totals: {}, cost: {}, streaks: {}, today: null }],
    ['/token-usage:query', { kpis: emptyMeasures(), pools: poolsPayload, seriesBy: { groups: [], days: [] }, rankings: { rows: [] }, window: {}, asOf: {} }],
    ['/token-usage:inspect', {
      kind: 'pool', id: 'connection:openai-codex:default',
      identity: { name: 'ChatGPT Plus/Pro', color: null, kind: 'subscription', providerId: 'openai-codex', connectionId: 'openai-codex:default', sourceKind: 'connection', billing: null, declaredLimits: [], rules: [] },
      account: poolsPayload.pools[0], direct: emptyMeasures(), trend: { buckets: [] }, breakdown: { rows: [] },
      page: { entity: 'request', rows: [], nextCursor: null },
    }],
    ['/account-usage:summary', { product: { name: 'DSH Accounts & Usage' }, connections: [], modelCatalogs: [], antigravity: null, privacy: {} }],
    ['/account-usage:templates', { templates: [] }],
    ['/account-usage:suggest-accounts', { suggestions: [] }],
    ['/account-usage:accounts', { accounts: [] }],
    ['/account-usage:observations', { observations: [] }],
  ])
  const ctx = {
    slots: {
      inject: (name, register) => register(),
      register: (definition, component) => { registrations.push({ definition, component }); return () => {} },
    },
    connection: {
      rpc: {
        call: async (channel, endpoint) => {
          const value = responses.get(`${channel}:${endpoint}`)
          if (value === undefined) return { ok: false, error: { code: 'missing', message: `unmapped ${channel}:${endpoint}` } }
          return { ok: true, value }
        },
      },
      api: { credentials: { set: async () => ({ ok: true }) } },
    },
    locale: undefined,
    effect: (fn) => fn(),
  }
  const registrations = []
  const require = (name) => {
    if (name === 'react') return React
    throw new Error(`unexpected client dependency: ${name}`)
  }
  let bundle
  const window = { __ModuleLoader__: { load: (loaded) => { bundle = loaded } } }
  new Function('window', 'require', source)(window, require)
  const module = bundle.factory(require)
  assert.deepEqual([...module.inject].sort(), ['connection', 'slots'])
  module.apply(ctx)
  assert.ok(registrations.length >= 2)
  const t = (key) => key

  // Sidebar entry renders the dual-bar micro indicator. The registration
  // returns an element; drive its underlying component function.
  const entry = registrations.find(({ definition }) => definition.name === 'sidebar.footer.action')
  const entryElement = entry.component({ wide: true })
  const entryTree = entryElement.type(entryElement.props)
  assert.ok(JSON.stringify(entryTree).includes('tu3-entry-b1'), 'dual-bar micro indicator missing')

  // Overlay renders dock and dashboard modes, with and without a selected account.
  const overlay = registrations.find(({ definition }) => definition.name === 'shell.overlay')
  const overlayElement = overlay.component({})
  const store = overlayElement.props.store
  const renderOverlay = () => overlayElement.type(overlayElement.props)
  assert.equal(store.state.open, false)
  store.update({ open: true, mode: 'dock' })
  assert.equal(store.state.open, true)
  store.update({ mode: 'dash', account: 'connection:openai-codex:default' })
  assert.ok(renderOverlay())
  store.update({ account: null })
  assert.ok(renderOverlay())
  store.update({ dataSection: 'accounts' })
  assert.ok(renderOverlay())
  // Drain pending promise chains from the rpc mocks.
  await new Promise((resolvePromise) => { setTimeout(resolvePromise, 30) })
})
