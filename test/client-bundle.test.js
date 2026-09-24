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
    useRef: (initial) => ({ current: initial }),
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

test('client injects slots, connection and the remote credentials namespace', () => {
  const { bundle, require } = loadClientHarness()
  const module = bundle.factory(require)
  assert.deepEqual([...module.inject].sort(), ['connection', 'remote', 'remote.credentials', 'slots'])
})

test('apply registers the sidebar action and the full-frame overlay', () => {
  const { bundle, require, injected, registrations, ctx } = loadClientHarness()
  bundle.factory(require).apply(ctx)
  const names = injected.map((entry) => entry.name)
  assert.ok(names.includes('sidebar.footer.action'), 'sidebar footer action missing')
  assert.ok(names.includes('shell.overlay'), 'shell overlay missing')
  assert.ok(names.includes('settings.section'), 'Accounts & Models settings section missing')
  // Drive each registration to prove the components exist.
  for (const entry of injected) entry.register()
  assert.ok(registrations.length >= 3)
  for (const { definition, component } of registrations) {
    assert.ok(['sidebar.footer.action', 'shell.overlay', 'settings.section'].includes(definition.name))
    assert.equal(typeof component, 'function')
  }
  const overlay = registrations.find(({ definition }) => definition.name === 'shell.overlay')
  assert.ok(overlay.definition.id.startsWith('dsh-token-usage'))
  // The settings section keeps the slot shape proven by the installed
  // dsh-attention plugin: stable id, label and the runtime inject share.
  const settings = registrations.find(({ definition }) => definition.name === 'settings.section')
  assert.equal(settings.definition.id, 'accounts-models')
  assert.equal(typeof settings.definition.label, 'function')
  assert.match(String(settings.definition.label()), /Accounts & Models|账户与模型/)
  assert.equal(typeof settings.definition.inject, 'function')
  const share = settings.definition.inject()
  assert.deepEqual([...Object.keys(share).sort()], ['connection', 'locale', 'store'])
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
  assert.equal(source.includes('ollamaManualCookie'), false)
  assert.ok(source.includes("OLLAMA_SESSION_COOKIE"))
  assert.ok(source.includes("cookieOptIn"))
  assert.ok(source.includes('ollamaCloudAutoObserve'))
  assert.match(source, /return `__Secure-session=\$\{input\}`/)
  assert.equal(source.includes('return `session=${input}`'), false)
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
  // One allowlisted display link for the Ollama cookie guide; no other remote
  // URLs, and no direct fetching.
  const remoteUrls = [...source.matchAll(/https?:\/\/[^'"`\s)]+/g)].map((match) => match[0])
  assert.deepEqual([...new Set(remoteUrls)], ['https://ollama.com/settings'])
  assert.ok(!/fetch\(/.test(source), 'client never fetches directly; it uses the loopback channel')
})

test('sidebar entry meters the watched-or-tightest window in pools mode', () => {
  assert.match(source, /tu3-entry-b1/)
  assert.ok(!source.includes('tu3-entry-b2'), 'the month time bar is retired from the entry')
  assert.match(source, /MeterGlyph/, 'energy capsule glyph replaces the bar-chart decoration')
  assert.match(source, /justifyContent/, 'Split Flex layout for dense sidebars')
  assert.match(source, /entry-summary/)
  assert.match(source, /sidebarSummary/)
  assert.match(source, /'pools'/)
  assert.ok(source.includes('pinSidebar'), 'dock pin affordance')
  assert.ok(source.includes("'tu3.sidebarWatch'"), 'client-side watch storage')
})

test('pace notes are average-rate arithmetic, labelled as such', () => {
  assert.match(source, /paceDisclaimer/)
  assert.match(source, /ratePerDay/)
  assert.match(source, /leftoverAtExpiryUsd/)
})

test('Ollama cache-cost scenarios are adjustable and visibly disclosed', () => {
  for (const label of [
    'Ollama Cloud assumed cache hit (%)',
    'Ollama Cloud 假设缓存命中率（%）',
    'no-cache value',
    '未计缓存上限',
  ]) assert.ok(source.includes(label), `missing cache estimate disclosure: ${label}`)
  assert.ok(source.includes('ollamaCloudCacheEstimatePct'))
  assert.ok(source.includes('reportedUsageUsdNano'))
  assert.ok(source.includes('estimatedCacheReadTokens'))
})

test('v5 components render against a mocked host without throwing', async () => {
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (initial) => ({ current: initial }),
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
    },
    remote: {
      credentials: {
        set: async () => ({ ok: true }),
        describe: async (refs) => ({ ok: true, value: Object.fromEntries((refs ?? []).map((ref) => [ref, { configured: true }])) }),
      },
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
  assert.deepEqual([...module.inject].sort(), ['connection', 'remote', 'remote.credentials', 'slots'])
  module.apply(ctx)
  assert.ok(registrations.length >= 2)
  const t = (key) => key

  // Sidebar entry meters the watched-or-tightest window. The registration
  // returns an element; drive its underlying component function after
  // seeding the shared store with an entry summary.
  const entry = registrations.find(({ definition }) => definition.name === 'sidebar.footer.action')
  const overlayForStore = registrations.find(({ definition }) => definition.name === 'shell.overlay')
  const sharedStore = overlayForStore.component({}).props.store
  const entrySummaryFixture = {
    configured: true,
    month: { elapsedPct: 50, daysLeft: 15, resetLabel: '2026-09-01' },
    tightest: { id: 'x', name: 'Grok / X subscription', color: null, usedPct: 70, sourceKind: 'official_usage_api', windowLabel: 'weekly', resetsAt: Date.now() + 3_600_000 },
    pools: [{
      id: 'connection:openai-codex:default', name: 'ChatGPT Plus/Pro', color: '#3d6ee8', kind: 'subscription',
      usedPct: 42, window: { label: '5h', resetsAt: Date.now() + 3_600_000, usedPct: 42, sourceKind: 'official_usage_api' },
    }],
  }
  sharedStore.update({ entrySummary: entrySummaryFixture })
  const entryElement = entry.component({ wide: true })
  const entryTree = entryElement.type(entryElement.props)
  const entryJson = JSON.stringify(entryTree)
  assert.ok(entryJson.includes('tu3-entry-b1'), 'level bar missing')
  assert.ok(!entryJson.includes('tu3-entry-b2'), 'the month time bar must be gone')
  assert.ok(entryJson.includes('Grok / X subscription'), 'tightest fallback caption name missing')
  assert.ok(entryJson.includes('70%'), 'tightest percentage missing')
  assert.ok(!entryJson.includes('★ '), 'unpinned entry shows no pin marker')

  // Pinned watch: client-side storage selects the account; the entry mirrors
  // that account's own window instead of the global tightest.
  const backing = new Map([['tu3.sidebarWatch', 'connection:openai-codex:default']])
  globalThis.localStorage = {
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => { backing.set(key, value) },
    removeItem: (key) => { backing.delete(key) },
  }
  try {
    const pinnedElement = entry.component({ wide: true })
    const pinnedJson = JSON.stringify(pinnedElement.type(pinnedElement.props))
    assert.ok(pinnedJson.includes('★ ChatGPT Plus/Pro'), 'pinned focus caption name missing')
    assert.ok(pinnedJson.includes('42%'), 'pinned window percentage missing')
    assert.ok(pinnedJson.includes('Grok / X subscription 70%'), 'hover context keeps the global tightest')
    assert.ok(!pinnedJson.includes('tu3-entry-b2'), 'month bar stays gone while pinned')
  } finally {
    delete globalThis.localStorage
  }

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

test('sidebar footer meters the watched window the dock row stars', async () => {
  // GLM observed two windows: the 5h rolling one (26%) and an MCP billing
  // window (100%) — the tightest. The dock row stars the 5h window; the
  // footer must meter the same starred window, not the server-side fullest
  // pick, or the two surfaces disagree (26% vs 100% for one account).
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (initial) => ({ current: initial }),
  }
  const responses = new Map([
    ['/token-usage:entry-summary', { configured: true, month: {}, tightest: null, pools: [] }],
  ])
  const registrations = []
  const ctx = {
    slots: {
      inject: (name, register) => register(),
      register: (definition, component) => { registrations.push({ definition, component }); return () => {} },
    },
    connection: {
      rpc: { call: async (channel, endpoint) => {
        const value = responses.get(`${channel}:${endpoint}`)
        if (value === undefined) return { ok: false, error: { code: 'missing', message: `unmapped ${channel}:${endpoint}` } }
        return { ok: true, value }
      } },
    },
    remote: {
      credentials: {
        set: async () => ({ ok: true }),
        describe: async (refs) => ({ ok: true, value: Object.fromEntries((refs ?? []).map((ref) => [ref, { configured: true }])) }),
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
  const module = bundle.factory(require)
  module.apply(ctx)
  const entry = registrations.find(({ definition }) => definition.name === 'sidebar.footer.action')
  const overlayForStore = registrations.find(({ definition }) => definition.name === 'shell.overlay')
  const sharedStore = overlayForStore.component({}).props.store

  const now = Date.now()
  sharedStore.update({
    entrySummary: {
      configured: true,
      month: { elapsedPct: 32, daysLeft: 20, resetLabel: '2026-09-30' },
      tightest: { id: 'connection:glm:default', name: 'GLM / Z.AI', color: '#e5a23c', usedPct: 100, sourceKind: 'official_client_api', windowLabel: 'MCP', resetsAt: now + 19 * 86_400_000, ageMs: 60_000, brittle: true },
      pools: [{
        id: 'connection:glm:default', name: 'GLM / Z.AI', color: '#e5a23c', kind: 'subscription',
        usedPct: 100,
        window: { label: 'MCP', resetsAt: now + 19 * 86_400_000, usedPct: 100, sourceKind: 'official_client_api', ageMs: 60_000 },
        official: { observedAt: now - 60_000, sourceKind: 'official_client_api', brittle: true, windows: [
          { id: 'glm-window:5', label: '5小时', percentUsed: 26, resetsAt: now + 4 * 3_600_000 },
          { id: 'glm-window:mcp', label: 'MCP', percentUsed: 100, resetsAt: now + 19 * 86_400_000, ageMs: 60_000 },
        ] },
      }],
      unassigned: null,
      tightestPoolId: 'connection:glm:default',
    },
  })
  const backing = new Map([['tu3.watchedWindows', JSON.stringify({ 'connection:glm:default': 'glm-window:5' })]])
  globalThis.localStorage = {
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => { backing.set(key, value) },
    removeItem: (key) => { backing.delete(key) },
  }
  const buildSummary = (fiveHourPct, fiveHourReset) => ({
    configured: true,
    month: { elapsedPct: 32, daysLeft: 20, resetLabel: '2026-09-30' },
    tightest: { id: 'connection:glm:default', name: 'GLM / Z.AI', color: '#e5a23c', usedPct: 100, sourceKind: 'official_client_api', windowLabel: 'MCP', resetsAt: now + 19 * 86_400_000, ageMs: 60_000, brittle: true },
    pools: [{
      id: 'connection:glm:default', name: 'GLM / Z.AI', color: '#e5a23c', kind: 'subscription',
      usedPct: 100,
      window: { label: 'MCP', resetsAt: now + 19 * 86_400_000, usedPct: 100, sourceKind: 'official_client_api', ageMs: 60_000 },
      official: { observedAt: now - 60_000, sourceKind: 'official_client_api', brittle: true, windows: [
        { id: 'glm-window:5', label: '5小时', percentUsed: fiveHourPct, resetsAt: fiveHourReset },
        { id: 'glm-window:mcp', label: 'MCP', percentUsed: 100, resetsAt: now + 19 * 86_400_000, ageMs: 60_000 },
      ] },
    }],
    unassigned: null,
    tightestPoolId: 'connection:glm:default',
  })
  sharedStore.update({ entrySummary: buildSummary(26, now + 4 * 3_600_000) })
  try {
    const meterJson = () => JSON.stringify(entry.component({ wide: true }).type(entry.component({ wide: true }).props))
    // Phase 1: the starred 5h window meters (26%), the MCP window does not.
    let json = meterJson()
    assert.ok(json.includes('26%') && json.includes('5小时'), 'the starred 5h window meters the footer')
    assert.ok(!json.includes('MCP'), 'the unwatched MCP window must not meter the footer (the global tightest line keeps its own 100%)')
    // Phase 2: watching the MCP window meters it — watched wins, no silent
    // fallback to the tightest window.
    backing.set('tu3.watchedWindows', JSON.stringify({ 'connection:glm:default': 'glm-window:mcp' }))
    json = meterJson()
    assert.ok(json.includes('MCP') && json.includes('100%'), 'watching the MCP window meters it, watched wins')
    assert.ok(!json.includes('5小时'), 'the unstarred window must not bleed into the meter')
    // Phase 3: the starred window with unknown percentage and reset keeps its
    // own nulls — it must not borrow the MCP window's 100% or its countdown.
    sharedStore.update({ entrySummary: buildSummary(null, null) })
    backing.set('tu3.watchedWindows', JSON.stringify({ 'connection:glm:default': 'glm-window:5' }))
    json = meterJson()
    assert.ok(!json.includes('MCP'), 'the unknown starred window must not borrow the MCP values')
    assert.ok(!json.includes('重置还需'), 'an unknown reset must not borrow the other window\'s countdown')
    // The pre-existing caption renders the no-level placeholder instead of a
    // percentage when the metered window's level is unknown.
    assert.ok(json.includes('No declared local usage') || json.includes('—'), 'the unknown level renders as the no-quota placeholder')
  } finally {
    delete globalThis.localStorage
  }
})

test('settings section: an emptied account pool keeps the add-account flow reachable', async () => {
  const harness = createSettingsHarness({
    connections: {
      adapters: [],
      connections: [
        { providerId: 'openai-codex', displayName: 'OpenAI Codex (ChatGPT subscription)', configured: true, credentialKind: 'oauth', credentialRef: 'OPENAI_CODEX_OAUTH', observationSource: 'official_usage_api' },
        { providerId: 'ollama-local', displayName: 'Ollama Local', configured: false, quotaApplicable: false, observationSource: 'none' },
      ],
      modelCatalogs: [],
      antigravity: { activeAccountId: null, autoFailover: true, accounts: [] },
      privacy: {},
    },
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    const tree = runtime.render(settingsComponent, {})
    assert.ok(findButtons(tree, 'Antigravity').length === 1, 'the pool entry renders even with zero accounts')
    findButtons(tree, 'Antigravity')[0].props.onClick()
    await flushMicrotasks()
    const detail = runtime.render(settingsComponent, {})
    assert.equal(findButtons(detail, '＋ Add account').length, 1, 'the add-account flow stays reachable from an empty pool')
    runtime.unmountAll()
  } finally {
    restore()
  }
})

test('pool login: cancel then immediate retry keeps the new wait alive', async () => {
  let loginCounter = 0
  const harness = createSettingsHarness({
    connections: settingsConnectionsPayload(),
    extraResponses: {
      '/account-usage:connection-action': (payload) => {
        if (payload?.action === 'pending-login') return { login: null, active: false }
        if (payload?.action === 'start-login') {
          loginCounter += 1
          return { challenge: { loginId: `L${loginCounter}`, authUrl: 'https://example.com/agg' } }
        }
        if (payload?.action === 'login-status') return { status: { kind: 'pending' } }
        if (payload?.action === 'cancel-login') return {}
        return {}
      },
    },
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    findButtons(runtime.render(settingsComponent, {}), 'Antigravity')[0].props.onClick()
    await flushMicrotasks()
    const add = () => findButtons(runtime.render(settingsComponent, {}), '＋ Add account')[0]
    add().props.onClick()
    await flushMicrotasks()
    assert.equal(loginCounter, 1, 'the first login started')
    findButtons(runtime.render(settingsComponent, {}), 'Cancel sign-in')[0].props.onClick()
    await flushMicrotasks()
    assert.ok(!JSON.stringify(runtime.render(settingsComponent, {})).includes('Cancel sign-in'), 'the first card closed')
    // Immediate retry: the abandoned loop must not retire the NEW wait.
    add().props.onClick()
    await flushMicrotasks()
    assert.equal(loginCounter, 2, 'the retry started a second login')
    await harness.clock.advance()
    assert.ok(countAction(harness, 'login-status') >= 1, 'the new wait polls the host status')
    runtime.unmountAll()
    await harness.clock.advance()
    const pollsBefore = countAction(harness, 'login-status')
    await harness.clock.advance()
    assert.equal(countAction(harness, 'login-status'), pollsBefore, 'no orphaned loop survives the unmount')
  } finally {
    restore()
  }
})

test('pool login: reopening the dialog reattaches to the pending authorization', async () => {
  const harness = createSettingsHarness({
    connections: settingsConnectionsPayload(),
    extraResponses: {
      '/account-usage:connection-action': (payload) => {
        if (payload?.action === 'pending-login') return { login: { loginId: 'P9', authUrl: 'https://example.com/agg' }, active: true }
        if (payload?.action === 'login-status') return { status: { kind: 'pending' } }
        if (payload?.action === 'cancel-login') return {}
        return {}
      },
    },
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    findButtons(runtime.render(settingsComponent, {}), 'Antigravity')[0].props.onClick()
    await flushMicrotasks()
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    const json = JSON.stringify(runtime.render(settingsComponent, {}))
    assert.ok(json.includes('Cancel sign-in'), 'the reopened panel restores the pending authorization card')
    assert.ok(json.includes('Open authorization page'), 'the rebuilt authorization link is available for reattach')
    assert.equal(countAction(harness, 'start-login'), 0, 'reattach never starts a new authorization')
    await harness.clock.advance()
    assert.ok(countAction(harness, 'login-status') >= 1, 'the reattached wait resumes polling')
    findButtons(runtime.render(settingsComponent, {}), 'Cancel sign-in')[0].props.onClick()
    await flushMicrotasks()
    assert.equal(countAction(harness, 'cancel-login'), 1, 'the reattached card can cancel the host authorization')
    runtime.unmountAll()
  } finally {
    restore()
  }
})

test('pool login: a late reattach response never overrides a newer login', async () => {
  // The reattach request parks while the user starts login A2; when the old
  // response lands it must not take the card or the wait back to A1.
  let releaseReattach
  const reattachPromise = new Promise(resolve => { releaseReattach = resolve })
  const harness = createSettingsHarness({
    connections: settingsConnectionsPayload(),
    extraResponses: {
      '/account-usage:connection-action': (payload) => {
        if (payload?.action === 'pending-login') return reattachPromise
        if (payload?.action === 'start-login') return { challenge: { loginId: 'A2', authUrl: 'https://example.com/agg-a2' } }
        if (payload?.action === 'login-status') return { status: { kind: 'pending' } }
        if (payload?.action === 'cancel-login') return {}
        return {}
      },
    },
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    findButtons(runtime.render(settingsComponent, {}), 'Antigravity')[0].props.onClick()
    await flushMicrotasks()
    findButtons(runtime.render(settingsComponent, {}), '＋ Add account')[0].props.onClick()
    await flushMicrotasks()
    assert.equal(countAction(harness, 'start-login'), 1, 'login A2 started while the reattach was parked')
    assert.ok(JSON.stringify(runtime.render(settingsComponent, {})).includes('agg-a2'), 'the card shows the A2 authorization link')
    releaseReattach({ ok: true, value: { login: { loginId: 'A1', authUrl: 'https://example.com/agg-a1' } } })
    await flushMicrotasks()
    const late = JSON.stringify(runtime.render(settingsComponent, {}))
    assert.ok(!late.includes('agg-a1'), 'the late reattach response must not take over the card')
    assert.ok(late.includes('agg-a2'), 'the newer login stays on screen')
    await harness.clock.advance()
    const lastPoll = harness.rpcCalls.filter(entry => entry.endpoint === 'connection-action' && entry.payload?.action === 'login-status').pop()
    assert.equal(lastPoll.payload.params.loginId, 'A2', 'the wait keeps polling the current login')
    runtime.unmountAll()
  } finally {
    restore()
  }
})

test('pool login: the abandoned poll does not unlock a cancel still in flight', async () => {
  let releaseCancel
  const cancelPromise = new Promise(resolve => { releaseCancel = resolve })
  const harness = createSettingsHarness({
    connections: settingsConnectionsPayload(),
    extraResponses: {
      '/account-usage:connection-action': (payload) => {
        if (payload?.action === 'pending-login') return { login: null, active: false }
        if (payload?.action === 'start-login') return { challenge: { loginId: 'L1', authUrl: 'https://example.com/agg' } }
        if (payload?.action === 'login-status') return { status: { kind: 'pending' } }
        if (payload?.action === 'cancel-login') return cancelPromise
        return {}
      },
    },
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    findButtons(runtime.render(settingsComponent, {}), 'Antigravity')[0].props.onClick()
    await flushMicrotasks()
    findButtons(runtime.render(settingsComponent, {}), '＋ Add account')[0].props.onClick()
    await flushMicrotasks()
    // Cancel with a deliberately delayed RPC; the abandoned poll's timer
    // fires while the cancel-login is still parked.
    findButtons(runtime.render(settingsComponent, {}), 'Cancel sign-in')[0].props.onClick()
    await flushMicrotasks()
    let add = findButtons(runtime.render(settingsComponent, {}), '＋ Add account')[0]
    assert.equal(add.props.disabled, true, 'the cancel in flight holds the busy gate')
    await harness.clock.advance()
    add = findButtons(runtime.render(settingsComponent, {}), '＋ Add account')[0]
    assert.equal(add.props.disabled, true, 'the abandoned poll must not release the cancel busy gate')
    releaseCancel({ ok: true, value: {} })
    await flushMicrotasks()
    add = findButtons(runtime.render(settingsComponent, {}), '＋ Add account')[0]
    assert.equal(add.props.disabled, false, 'the busy gate releases when the cancel settles')
    runtime.unmountAll()
  } finally {
    restore()
  }
})

test('credential writes mirror the host api-remotes contract', () => {
  // The host's own ui-settings-models page writes credentials through
  // ctx.remote.credentials (api-remotes): set(ref, value) + describe([ref])
  // answering { ok, value | error } with the describe payload keyed by ref.
  assert.match(source, /remote\.credentials\.set\(ref, value\)/)
  assert.match(source, /remote\.credentials\.describe\(\[ref\]\)/)
  assert.match(source, /setResponse\?\.ok !== true/)
  assert.match(source, /describe\.value\?\.\[ref\]\?\.configured/)
  assert.ok(!source.includes('ctx.connection.api'), 'the nonexistent connection.api facade must not be referenced')
})

test('fullscreen panel: styled account tabs, sub-card strip and stable stack colors', () => {
  // Account filter tabs carry the pill class; the selected state is tu3-tab.on.
  assert.match(source, /className: `tu3-tab\$\{state\.account === null \? ' on' : ''\}`/)
  assert.match(source, /className: `tu3-tab\$\{state\.account === pool\.id \? ' on' : ''\}`/)
  assert.match(source, /className: `tu3-tab\$\{state\.account === 'unassigned' \? ' on' : ''\}`/)
  // The hero strip renders each account as its own sub-card with a meta footer
  // row, and the grid adapts instead of pinning four columns.
  assert.match(source, /className: 'tu3-pool'/)
  assert.match(source, /\.tu3-pool \{/)
  assert.match(source, /\.tu3-poolmeta \{/)
  assert.match(source, /\.tu3-pools \{[^}]*auto-fill/)
  // Model-stack colors: one shared mapping for legend, segments, day detail
  // and ranking rows; 'other' and unranked groups fold to the neutral grey.
  assert.match(source, /function modelGroupColor/)
  assert.match(source, /return index >= 0 \? POOL_COLORS\[index % POOL_COLORS\.length\] : UNASSIGNED_COLOR/)
  assert.match(source, /return modelGroupColor\(data, id\)/)
  // Pool-stack ranking rows follow the account color; unattributed models stay grey.
  assert.match(source, /row\.poolId === 'unassigned' \? UNASSIGNED_COLOR : modelGroupColor\(data, row\.key\)/)
  // Connection section rhythm: the action row keeps its right alignment and
  // token-scale margins instead of the old margin-shorthand that reset it.
  assert.match(source, /flexWrap: 'wrap', marginBottom: S\.m \}/)
  assert.ok(!source.includes("alignSelf: 'flex-start', margin: `"), 'action-row margin shorthand must not override marginLeft: auto')
  // The full-width connection card is separated from the insight grid above.
  assert.match(source, /h\('div', \{ style: \{ marginTop: 12 \} \}, connectionSection\)/)
  // Account switches anchor the scroll at the filter tabs (no clamp jump to
  // the model ranking while the insight loads); the anchor is re-applied
  // when the insight content lands, once per account id.
  assert.match(source, /tabsRowRef/)
  assert.match(source, /scrollIntoView\(\{ block: 'start' \}\)/)
  assert.match(source, /minHeight: '100vh'/)
  assert.match(source, /anchoredIdRef/)
  assert.match(source, /const scrollTabsIntoView = /)
  // Model-stack bars always show legend-true colors; the focus dim belongs to
  // the pool stack only, at a readable opacity.
  assert.match(source, /const dimOthers = state\.stack === 'pool' && state\.account !== null \? \(id\) => id !== state\.account : null/)
  assert.ok(!source.includes("opacity: dim ? 0.22 : 1"), 'the near-invisible 0.22 dim made dominant models read as wrong colors')
  assert.match(source, /opacity: dim \? 0\.3 : 1/)
})

// ---------------------------------------------------------------------------
// Hook-level harness. A miniature React runtime with real useState/useRef/
// useCallback/useEffect semantics (deps-aware, cleanups, path-keyed
// instances), a manual clock driving the poll timers, and a controllable
// document.visibilityState. This is what lets the tests below prove the
// usePoll/useAsync/summary-sharing behavior without a DOM renderer or any
// new dependency.
// ---------------------------------------------------------------------------

const flushMicrotasks = async () => {
  for (let round = 0; round < 8; round += 1) await new Promise((resolve) => setImmediate(resolve))
}

function createClock() {
  const pending = new Map()
  let seq = 0
  return {
    setTimeout: (fn) => { seq += 1; pending.set(seq, fn); return seq },
    clearTimeout: (id) => { pending.delete(id) },
    size: () => pending.size,
    // Fire every timer pending at entry exactly once, then drain the
    // microtask chains those firings started. Timers scheduled by those
    // chains wait for the next advance.
    async advance() {
      const due = [...pending.values()]
      pending.clear()
      for (const fn of due) fn()
      await flushMicrotasks()
    },
  }
}

function createDocumentMock() {
  const listeners = new Map()
  return {
    visibilityState: 'visible',
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener: (type, fn) => { listeners.get(type)?.delete(fn) },
    emit: (type) => { for (const fn of [...(listeners.get(type) ?? [])]) fn() },
    listenerCount: (type) => (listeners.get(type)?.size ?? 0),
    querySelector: () => null,
  }
}

function createStorageMock(entries = []) {
  const backing = new Map(entries)
  return {
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => { backing.set(key, String(value)) },
    removeItem: (key) => { backing.delete(key) },
  }
}

function createHookRuntime() {
  const slots = new Map()
  let bornSeq = 0
  let pass = 0
  let pathKey = ''
  let cursor = 0
  let queuedCleanups = []
  let queuedEffects = []

  const depsEqual = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index])

  const takeSlot = () => {
    const key = `${pathKey}#${cursor}`
    cursor += 1
    let slot = slots.get(key)
    if (!slot) {
      slot = { key, deps: undefined, value: undefined, cleanup: null, seen: -1, born: bornSeq++ }
      slots.set(key, slot)
    }
    slot.seen = pass
    return slot
  }

  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) {
      const slot = takeSlot()
      if (slot.value === undefined) slot.value = { current: typeof initial === 'function' ? initial() : initial }
      const box = slot.value
      return [box.current, (patch) => { box.current = typeof patch === 'function' ? patch(box.current) : patch }]
    },
    useRef(initial) {
      const slot = takeSlot()
      if (slot.value === undefined) slot.value = { current: initial }
      return slot.value
    },
    useCallback(fn, deps) {
      const slot = takeSlot()
      if (slot.value === undefined || !depsEqual(slot.deps, deps)) { slot.value = fn; slot.deps = deps }
      return slot.value
    },
    useMemo(fn, deps) {
      const slot = takeSlot()
      if (slot.value === undefined || !depsEqual(slot.deps, deps)) { slot.value = fn(); slot.deps = deps }
      return slot.value
    },
    useEffect(fn, deps) {
      const slot = takeSlot()
      if (!depsEqual(slot.deps, deps)) {
        if (slot.cleanup !== null) queuedCleanups.push(slot)
        slot.deps = deps
        queuedEffects.push({ slot, fn })
      }
    },
  }

  const renderElement = (element, location) => {
    if (element === null || element === undefined || typeof element !== 'object') return element
    if (Array.isArray(element)) return element.map((child, index) => renderElement(child, [...location, index]))
    if (typeof element.type !== 'function') {
      return { ...element, children: (element.children ?? []).map((child, index) => renderElement(child, [...location, index])) }
    }
    const name = element.type.name ?? 'anon'
    const parentKey = pathKey
    const parentCursor = cursor
    pathKey = JSON.stringify([...location, name])
    cursor = 0
    let output
    try {
      output = element.type(element.props ?? {})
    } finally {
      pathKey = parentKey
      cursor = parentCursor
    }
    const branches = Array.isArray(output) ? output : [output]
    return { type: name, props: element.props, children: branches.map((child, index) => renderElement(child, [...location, name, index])) }
  }

  const flush = () => {
    const cleanups = queuedCleanups
    const effects = queuedEffects
    queuedCleanups = []
    queuedEffects = []
    for (const slot of cleanups) {
      const cleanup = slot.cleanup
      slot.cleanup = null
      if (cleanup) cleanup()
    }
    for (const { slot, fn } of effects) slot.cleanup = fn() ?? null
  }

  const sweep = () => {
    for (const [key, slot] of [...slots]) {
      if (slot.seen < pass) {
        if (slot.cleanup !== null) {
          const cleanup = slot.cleanup
          slot.cleanup = null
          cleanup()
        }
        slots.delete(key)
      }
    }
  }

  return {
    React,
    render: (component, props) => {
      pass += 1
      const tree = renderElement(React.createElement(component, props), [0])
      flush()
      sweep()
      return tree
    },
    unmountAll: () => {
      for (const [key, slot] of [...slots].sort((a, b) => a[1].born - b[1].born)) {
        if (slot.cleanup !== null) {
          const cleanup = slot.cleanup
          slot.cleanup = null
          cleanup()
        }
        slots.delete(key)
      }
    },
  }
}

function createHookHarness({ controlled = [], responses = new Map() } = {}) {
  const runtime = createHookRuntime()
  const clock = createClock()
  const doc = createDocumentMock()
  const rpcCalls = []
  const pendingByEndpoint = new Map()
  const call = (channel, endpoint, payload) => {
    // Exercise the current /api path while keeping logical-channel fixtures.
    if (channel === '/api') {
      const [owner, ...parts] = endpoint.split('/')
      channel = `/${owner}`
      endpoint = parts.join('/')
    }
    rpcCalls.push({ channel, endpoint, payload })
    const key = `${channel}:${endpoint}`
    if (controlled.includes(key)) {
      return new Promise((resolve, reject) => {
        if (!pendingByEndpoint.has(key)) pendingByEndpoint.set(key, [])
        pendingByEndpoint.get(key).push({ resolve, reject, payload })
      })
    }
    const value = responses.get(key)
    if (value === undefined) return Promise.resolve({ ok: false, error: { code: 'missing', message: `unmapped ${key}` } })
    return Promise.resolve({ ok: true, value: typeof value === 'function' ? value(payload) : value })
  }
  const registrations = []
  const credentialSets = []
  // window.open is part of the local login contract (the authorization page
  // may open only for a live panel): record every call so tests can prove
  // nothing opens from a late challenge after unmount.
  const windowOpens = []
  const ctx = {
    slots: {
      inject: (name, register) => register(),
      register: (definition, component) => { registrations.push({ definition, component }); return () => {} },
    },
    connection: {
      rpc: { call },
    },
    remote: {
      credentials: {
        // api-remotes namespace (same contract as the host's own
        // ui-settings-models): set(ref, value) + describe([ref]) answer
        // { ok, value | error }. The tests record set() calls so they can
        // prove writes go through the owner API, never around it, and
        // describe() confirms the stored ref.
        set: async (ref, value) => { credentialSets.push({ ref, value }); return { ok: true } },
        describe: async (refs) => ({
          ok: true,
          value: Object.fromEntries((refs ?? []).map((ref) => [ref, { configured: true }])),
        }),
      },
    },
    locale: undefined,
    effect: (fn) => fn(),
  }
  let bundle
  const require = (name) => {
    if (name === 'react') return runtime.React
    throw new Error(`unexpected client dependency: ${name}`)
  }
  const windowMock = {
    __ModuleLoader__: { load: (loaded) => { bundle = loaded } },
    addEventListener: () => {},
    removeEventListener: () => {},
    open: (...args) => { windowOpens.push(args) },
  }
  new Function('window', 'require', source)(windowMock, require)
  bundle.factory(require).apply(ctx)
  const findComponent = (name) => registrations.find(({ definition }) => definition.name === name).component
  return {
    runtime,
    clock,
    doc,
    ctx,
    registrations,
    store: findComponent('shell.overlay')({}).props.store,
    overlayComponent: findComponent('shell.overlay'),
    entryComponent: findComponent('sidebar.footer.action'),
    rpcCalls,
    credentialSets,
    windowOpens,
    pending: (key) => pendingByEndpoint.get(key) ?? [],
    count: (endpoint) => rpcCalls.filter((entry) => entry.endpoint === endpoint).length,
  }
}

function installClientGlobals({ clock, doc }) {
  const previous = {
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  }
  globalThis.document = doc
  globalThis.localStorage = createStorageMock()
  globalThis.setTimeout = clock.setTimeout
  globalThis.clearTimeout = clock.clearTimeout
  return () => {
    globalThis.document = previous.document
    globalThis.localStorage = previous.localStorage
    globalThis.setTimeout = previous.setTimeout
    globalThis.clearTimeout = previous.clearTimeout
  }
}

// ---- shared RPC fixtures for the hook harness ----
const harnessMeasures = () => ({
  requests: 0, calls: 0, failedRequests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
  cacheWriteTokens: 0, reasoningTokens: 0, processingTokens: 0, newComputeTokens: 0,
  cost: { originalUsdNano: 0, currentUsdNano: 0, coverage: 1, pricedTokens: 0, totalTokens: 0 },
})
const harnessPool = (id, name) => ({
  id, name, kind: 'subscription', sourceKind: 'connection', providerId: 'openai-codex',
  connectionId: id, color: '#3d6ee8', limits: [], quotaWindows: [], kpis: harnessMeasures(),
  usedPct: 42, localUsedPct: null, officialUsedPct: 42, pace: null, billing: null,
  official: { observedAt: 1_800_000_000_000, sourceKind: 'official_usage_api', brittle: false, windows: [] },
})
const harnessQueryPayload = () => ({
  kpis: harnessMeasures(),
  pools: {
    configured: true,
    month: { elapsedPct: 50, daysLeft: 15, resetLabel: '2026-09-01' },
    pools: [harnessPool('connection:openai-codex:default', 'ChatGPT Plus/Pro')],
    unassigned: null,
    tightestPoolId: 'connection:openai-codex:default',
  },
  seriesBy: { groups: [], days: [] },
  rankings: { rows: [] },
  window: {},
  asOf: {},
})
const harnessSummaryPayload = () => ({
  product: { name: 'DSH Accounts & Usage' },
  connections: [],
  modelCatalogs: [],
  antigravity: null,
  privacy: {},
})
const harnessInspectPayload = (name) => ({
  kind: 'pool',
  id: name,
  identity: {
    name, color: null, kind: 'subscription', providerId: 'openai-codex',
    connectionId: 'connection:openai-codex:default', sourceKind: 'connection', billing: null, declaredLimits: [], rules: [],
  },
  account: null,
  direct: harnessMeasures(),
  trend: { buckets: [] },
  breakdown: { rows: [] },
  page: { entity: 'request', rows: [], nextCursor: null },
})
const harnessEntrySummaryPayload = () => ({
  configured: true,
  month: { elapsedPct: 50, daysLeft: 15, resetLabel: '2026-09-01' },
  tightest: { id: 'x', name: 'Grok / X subscription', color: null, usedPct: 70, sourceKind: 'official_usage_api', windowLabel: 'weekly', resetsAt: Date.now() + 3_600_000 },
  pools: [],
})

test('usePoll: runs never overlap, pause while hidden, resume visibly, stop on unmount', async () => {
  const harness = createHookHarness({
    controlled: ['/token-usage:entry-summary'],
    responses: new Map([['/token-usage:settings', { settings: {} }]]),
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, clock, doc, entryComponent, pending, count } = harness
    const resolveEntrySummary = () => {
      // Controlled deferreds resolve with the RPC envelope, like the host.
      for (const entry of pending('/token-usage:entry-summary').splice(0)) entry.resolve({ ok: true, value: harnessEntrySummaryPayload() })
    }

    runtime.render(entryComponent, { wide: true })
    await flushMicrotasks()
    // Mount: the poll fires immediately (entry-summary) and settings are
    // pulled exactly once; overview is never requested.
    assert.equal(count('entry-summary'), 1)
    assert.equal(count('settings'), 1)
    assert.equal(count('overview'), 0)

    // The first run is still in flight: time can pass but nothing re-runs.
    await clock.advance()
    assert.equal(count('entry-summary'), 1, 'a pending run must not overlap')

    // Only after the run settles is the next one scheduled.
    resolveEntrySummary()
    await flushMicrotasks()
    await clock.advance()
    assert.equal(count('entry-summary'), 2)

    // Settle run #2: the next tick is now armed as a pending timer.
    resolveEntrySummary()
    await flushMicrotasks()

    // Hidden tab: the pending timer is dropped and the cycle pauses.
    doc.visibilityState = 'hidden'
    doc.emit('visibilitychange')
    await clock.advance()
    await clock.advance()
    assert.equal(count('entry-summary'), 2, 'no runs while hidden')

    // Becoming visible fires exactly one immediate run.
    doc.visibilityState = 'visible'
    doc.emit('visibilitychange')
    await flushMicrotasks()
    assert.equal(count('entry-summary'), 3, 'visible resumes with one immediate run')
    resolveEntrySummary()
    await flushMicrotasks()

    // Unmount stops the cycle and clears the timer and the listener.
    runtime.unmountAll()
    assert.equal(clock.size(), 0, 'no pending timer after unmount')
    assert.equal(doc.listenerCount('visibilitychange'), 0, 'visibility listener removed')
    resolveEntrySummary()
    await clock.advance()
    assert.equal(count('entry-summary'), 3, 'no runs after unmount')
    assert.equal(count('settings'), 1, 'settings are not polled')
    assert.equal(count('overview'), 0, 'overview is never requested')
  } finally {
    restore()
  }
})

test('DataTab pulls import status on mount and polls only while an import runs', async () => {
  const harness = createHookHarness({
    controlled: ['/token-usage:import-status'],
    responses: new Map([
      ['/token-usage:import-control', { running: true, done: 0, total: 0, errors: 0, paused: false, canceled: false, lastError: null }],
    ]),
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, clock, overlayComponent, store, pending, count } = harness
    const resolveStatus = (running) => {
      for (const entry of pending('/token-usage:import-status').splice(0)) {
        entry.resolve({ ok: true, value: { running, done: 1, total: 2, errors: 0, paused: false, canceled: false, lastError: null } })
      }
    }
    const findButton = (tree, label) => {
      let found = null
      const walk = (node) => {
        if (found || node === null || node === undefined || typeof node !== 'object') return
        if (Array.isArray(node)) { node.forEach(walk); return }
        if (node.type === 'button' && JSON.stringify(node.children ?? []).includes(`"${label}"`)) found = node
        ;(node.children ?? []).forEach(walk)
      }
      walk(tree)
      return found
    }

    store.update({ open: true, mode: 'dash', dataSection: 'data' })
    runtime.render(overlayComponent, {})
    await flushMicrotasks()
    // Mount pulls once; with no import running the poll stays disabled.
    assert.equal(count('import-status'), 1)
    resolveStatus(false)
    await flushMicrotasks()
    runtime.render(overlayComponent, {})
    await clock.advance()
    assert.equal(count('import-status'), 1, 'idle tab must not poll')

    // A scan control action re-arms the poll with an immediate pull.
    const rescan = findButton(runtime.render(overlayComponent, {}), 'Rescan')
    assert.ok(rescan, 'rescan button rendered')
    rescan.props.onClick()
    await flushMicrotasks()
    assert.equal(count('import-control'), 1, 'scan action reaches import-control')
    runtime.render(overlayComponent, {})
    await flushMicrotasks()
    assert.equal(count('import-status'), 2, 'poll re-arms with an immediate pull')

    // While running, the chained poll keeps cycling.
    resolveStatus(true)
    await flushMicrotasks()
    await clock.advance()
    assert.equal(count('import-status'), 3)

    // When the import finishes the poll stops by itself.
    resolveStatus(false)
    await flushMicrotasks()
    runtime.render(overlayComponent, {})
    await clock.advance()
    assert.equal(count('import-status'), 3, 'no polling once the import is idle')
    runtime.unmountAll()
    assert.equal(clock.size(), 0, 'no pending timer after unmount')
  } finally {
    restore()
  }
})

test('sidebar entry pulls settings once on mount (plus revision bumps), never periodically', async () => {
  const harness = createHookHarness({
    responses: new Map([
      ['/token-usage:entry-summary', harnessEntrySummaryPayload()],
      ['/token-usage:settings', { settings: {} }],
    ]),
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, clock, entryComponent, store, count } = harness
    runtime.render(entryComponent, { wide: true })
    await flushMicrotasks()
    runtime.render(entryComponent, { wide: true })
    assert.equal(count('settings'), 1)
    assert.equal(count('overview'), 0)

    // Several poll cycles later: entry-summary advanced, settings did not.
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await clock.advance()
      await flushMicrotasks()
    }
    assert.ok(count('entry-summary') >= 4, `entry-summary keeps polling (got ${count('entry-summary')})`)
    assert.equal(count('settings'), 1, 'settings must not be polled periodically')

    // A settings save elsewhere bumps the revision; the entry refreshes once.
    store.update({ settingsRevision: (store.state.settingsRevision ?? 0) + 1 })
    runtime.render(entryComponent, { wide: true })
    await flushMicrotasks()
    assert.equal(count('settings'), 2, 'revision bump refetches settings once')
    await clock.advance()
    await flushMicrotasks()
    assert.equal(count('settings'), 2, 'and still no periodic settings polling')

    // Plain mode renders the title only — and still never calls overview.
    store.update({ settingsData: { sidebarSummary: 'plain' } })
    const tree = runtime.render(entryComponent, { wide: true })
    await flushMicrotasks()
    const json = JSON.stringify(tree)
    assert.ok(json.includes('Accounts & Usage'), 'plain mode shows the entry title')
    assert.ok(json.includes('↗'), 'plain mode keeps the open affordance')
    assert.ok(!json.includes('tu3-entry-b1'), 'plain mode has no level bar')
    assert.equal(count('overview'), 0, 'overview dead path is gone in plain mode')
    runtime.unmountAll()
  } finally {
    restore()
  }
})

test('useAsync: a stale response never overwrites the latest one', async () => {
  const harness = createHookHarness({
    controlled: ['/token-usage:inspect'],
    responses: new Map([
      ['/token-usage:query', harnessQueryPayload()],
      ['/account-usage:summary', harnessSummaryPayload()],
    ]),
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, overlayComponent, store, pending, count } = harness
    const resolveInspect = (id, name) => {
      const queue = pending('/token-usage:inspect')
      const entry = queue.find((item) => item.payload?.id === id)
      assert.ok(entry, `expected an in-flight inspect for ${id}`)
      queue.splice(queue.indexOf(entry), 1)
      entry.resolve({ ok: true, value: harnessInspectPayload(name) })
    }

    store.update({ open: true, mode: 'dash', account: 'account-a' })
    runtime.render(overlayComponent, {})
    await flushMicrotasks()
    runtime.render(overlayComponent, {})
    await flushMicrotasks()
    assert.equal(count('inspect'), 1)
    assert.equal(pending('/token-usage:inspect')[0].payload.id, 'account-a')

    // Switch accounts while the first inspect is still in flight.
    store.update({ account: 'account-b' })
    runtime.render(overlayComponent, {})
    await flushMicrotasks()
    assert.equal(count('inspect'), 2)

    // The newer request (B) resolves first, then the stale one (A) lands.
    resolveInspect('account-b', 'Identity B')
    await flushMicrotasks()
    runtime.render(overlayComponent, {})
    resolveInspect('account-a', 'Identity A')
    await flushMicrotasks()
    const tree = runtime.render(overlayComponent, {})
    const json = JSON.stringify(tree)
    assert.ok(json.includes('Identity B'), 'the latest response wins')
    assert.ok(!json.includes('Identity A'), 'the stale response is dropped')
    runtime.unmountAll()
  } finally {
    restore()
  }
})

test('one overlay open issues exactly one account summary RPC', async () => {
  const harness = createHookHarness({
    responses: new Map([
      ['/token-usage:query', harnessQueryPayload()],
      ['/account-usage:summary', harnessSummaryPayload()],
      ['/account-usage:inspect', harnessInspectPayload('ChatGPT Plus/Pro')],
    ]),
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, overlayComponent, store, count } = harness
    store.update({ open: true, mode: 'dash', account: null })
    runtime.render(overlayComponent, {})
    await flushMicrotasks()
    runtime.render(overlayComponent, {})
    await flushMicrotasks()
    assert.equal(count('summary'), 1, 'first open fires summary exactly once')

    // Opening an account detail mounts a ConnectionSection: it must reuse the
    // shared session instead of firing its own summary.
    store.update({ account: 'connection:openai-codex:default' })
    runtime.render(overlayComponent, {})
    await flushMicrotasks()
    runtime.render(overlayComponent, {})
    await flushMicrotasks()
    assert.equal(count('summary'), 1, 'dashboard and ConnectionSection share one summary')

    // Switching to the dock within the same open session shares it too.
    store.update({ mode: 'dock' })
    runtime.render(overlayComponent, {})
    await flushMicrotasks()
    runtime.render(overlayComponent, {})
    await flushMicrotasks()
    assert.equal(count('summary'), 1, 'DockPanel joins the same shared summary session')

    // Closing ends the session; reopening refetches exactly once.
    store.update({ open: false })
    runtime.render(overlayComponent, {})
    await flushMicrotasks()
    store.update({ open: true, mode: 'dash', account: 'connection:openai-codex:default' })
    runtime.render(overlayComponent, {})
    await flushMicrotasks()
    runtime.render(overlayComponent, {})
    await flushMicrotasks()
    assert.equal(count('summary'), 2, 'the next open session refires summary once')
    runtime.unmountAll()
  } finally {
    restore()
  }
})

test('sidebar entry renders an expired tightest window as unknown with the expired caption', async () => {
  const base = harnessEntrySummaryPayload()
  const harness = createHookHarness({
    responses: new Map([
      ['/token-usage:entry-summary', {
        ...base,
        tightest: { ...base.tightest, usedPct: 70, resetsAt: Date.now() - 60_000, stale: false, ageMs: null, expired: true, brittle: false },
      }],
      ['/token-usage:settings', { settings: {} }],
    ]),
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, entryComponent } = harness
    runtime.render(entryComponent, { wide: true })
    await flushMicrotasks()
    const tree = runtime.render(entryComponent, { wide: true })
    const json = JSON.stringify(tree)
    assert.ok(json.includes('Window reset — waiting for a new observation'), 'expired caption present')
    assert.ok(json.includes('"—"'), 'expired percent reads as unknown, never 0%')
    assert.ok(!json.includes('70%'), 'the stale percentage must not show')
    runtime.unmountAll()
  } finally {
    restore()
  }
})

test('sidebar entry labels a stale official observation with its relative age', async () => {
  const base = harnessEntrySummaryPayload()
  const harness = createHookHarness({
    responses: new Map([
      ['/token-usage:entry-summary', {
        ...base,
        tightest: { ...base.tightest, usedPct: 70, stale: true, ageMs: 32 * 60_000, expired: false },
      }],
      ['/token-usage:settings', { settings: {} }],
    ]),
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, entryComponent } = harness
    runtime.render(entryComponent, { wide: true })
    await flushMicrotasks()
    const tree = runtime.render(entryComponent, { wide: true })
    const json = JSON.stringify(tree)
    assert.ok(json.includes('32m ago'), 'relative age is visible next to the percent')
    assert.ok(json.includes('Official data is stale'), 'stale warning carried in title/aria')
    assert.ok(json.includes('70%'), 'a merely stale observation keeps its value')
    runtime.unmountAll()
  } finally {
    restore()
  }
})

test('account insight marks brittle official sources by flag, not by source kind', async () => {
  const account = {
    ...harnessPool('connection:glm:default', 'GLM Coding Plan'),
    official: {
      observedAt: Date.now() - 60_000,
      sourceKind: 'official_plugin_internal_api',
      brittle: true,
      windows: [{ id: 'w1', label: '5h', percentUsed: 66, resetsAt: Date.now() + 3_600_000, observedAt: Date.now() - 60_000, ageMs: 60_000, stale: false, expired: false }],
    },
  }
  const harness = createHookHarness({
    responses: new Map([
      ['/token-usage:query', harnessQueryPayload()],
      ['/account-usage:summary', harnessSummaryPayload()],
      ['/token-usage:inspect', { ...harnessInspectPayload('GLM Coding Plan'), account }],
    ]),
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, overlayComponent, store } = harness
    store.update({ open: true, mode: 'dash', account: 'connection:glm:default' })
    runtime.render(overlayComponent, {})
    await flushMicrotasks()
    // Second render mounts AccountInsight (the dashboard box is ready); the
    // third shows its settled inspect payload.
    runtime.render(overlayComponent, {})
    await flushMicrotasks()
    const tree = runtime.render(overlayComponent, {})
    const json = JSON.stringify(tree)
    assert.ok(json.includes('Brittle source'), 'brittle hint renders even though the kind is not official_ui')
    assert.ok(json.includes('official client API'), 'sourceLabel still maps the source kind itself')
    assert.ok(!json.includes('official page'), 'no official_ui label is implied by the brittle flag')
    runtime.unmountAll()
  } finally {
    restore()
  }
})

test('cost hero marks the unknown-price floor and ranking shares use the host full-set total', async () => {
  const payload = harnessQueryPayload()
  payload.partial = { purgedDays: false, unknownPrices: true, sourceDeleted: false, estimatesIncluded: false }
  payload.rankings = {
    dimension: 'model', by: 'currentUsdNano', total: 1000,
    rows: [{
      key: 'm1', label: 'Big Model', requests: 0, newComputeTokens: 0,
      cost: { ...harnessMeasures().cost, currentUsdNano: 420 },
      share: 0.42, poolId: 'connection:openai-codex:default',
    }],
  }
  const harness = createHookHarness({
    responses: new Map([
      ['/token-usage:query', payload],
      ['/account-usage:summary', harnessSummaryPayload()],
    ]),
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, overlayComponent, store } = harness
    store.update({ open: true, mode: 'dash', account: null })
    runtime.render(overlayComponent, {})
    await flushMicrotasks()
    const tree = runtime.render(overlayComponent, {})
    const json = JSON.stringify(tree)
    assert.ok(json.includes('≥'), 'floor marker sits next to the amount')
    assert.ok(json.includes('Partly unpriced'), 'unpriced badge present')
    assert.ok(json.includes('Some models have no price; the cost is a lower bound'), 'floor disclosure in the title')
    // The one page row holds 420 of a 1000 full-set total: a locally
    // re-derived denominator would print 100%, the host share prints 42%.
    assert.ok(json.includes('42%'), 'share comes from the returned full-set share')
    runtime.unmountAll()
  } finally {
    restore()
  }
})

test('locale dictionaries have no duplicate keys and identical en/zh key sets', () => {
  // Duplicate object-literal keys silently overwrite (the old newCompute
  // bug), so this inspects the dictionary source instead of the built
  // objects: a line-start key or a `, key:` continuation both count.
  const dictKeys = (name) => {
    const start = source.indexOf(`const ${name} = {`)
    assert.ok(start >= 0, `missing ${name} dictionary`)
    const open = source.indexOf('{', start)
    const end = source.indexOf('\n    }', open)
    assert.ok(end > open, `unterminated ${name} dictionary`)
    return [...source.slice(open + 1, end).matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*:/gm)].map((match) => match[1])
  }
  const enKeys = dictKeys('en')
  const zhKeys = dictKeys('zh')
  assert.ok(enKeys.length > 100 && zhKeys.length > 100, 'dictionaries must still carry their keys')
  const duplicates = (keys) => [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))]
  assert.deepEqual(duplicates(enKeys), [], 'en dictionary has duplicate keys')
  assert.deepEqual(duplicates(zhKeys), [], 'zh dictionary has duplicate keys')
  assert.deepEqual([...new Set(enKeys)].sort(), [...new Set(zhKeys)].sort(), 'en and zh key sets must be identical')
})

test('localJson: read/write/remove with fallbacks for missing, corrupt and legacy values', () => {
  const { bundle, require } = loadClientHarness()
  const module = bundle.factory(require)
  assert.equal(typeof module.localJson, 'function', 'localJson is exposed for the storage tests')
  const backing = new Map()
  const previous = globalThis.localStorage
  globalThis.localStorage = {
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => { backing.set(key, String(value)) },
    removeItem: (key) => { backing.delete(key) },
  }
  try {
    const store = module.localJson('test.key', () => ({ fallback: true }))
    // A missing key falls back, with a fresh object per read.
    assert.deepEqual(store.read(), { fallback: true })
    assert.notEqual(store.read(), store.read())
    // write() JSON-encodes; the value round-trips through read().
    store.write({ marked: 'x' })
    assert.equal(backing.get('test.key'), JSON.stringify({ marked: 'x' }))
    assert.deepEqual(store.read(), { marked: 'x' })
    // JSON-shaped but unparseable content falls back instead of throwing.
    backing.set('test.key', '{"broken"')
    assert.deepEqual(store.read(), { fallback: true })
    // A value that was never JSON (legacy plain string) reads back raw.
    backing.set('test.key', 'connection:provider:default')
    assert.equal(store.read(), 'connection:provider:default')
    // remove() drops the key so read() falls back again.
    store.write('value')
    store.remove()
    assert.equal(backing.has('test.key'), false)
    assert.deepEqual(store.read(), { fallback: true })
    // Storage failures are swallowed on write, remove and read.
    globalThis.localStorage = {
      getItem: () => { throw new Error('unavailable') },
      setItem: () => { throw new Error('full') },
      removeItem: () => { throw new Error('gone') },
    }
    assert.doesNotThrow(() => store.write('x'))
    assert.doesNotThrow(() => store.remove())
    assert.deepEqual(store.read(), { fallback: true })
  } finally {
    globalThis.localStorage = previous
  }
})

// ---------------------------------------------------------------------------
// P1-C: the Accounts & Models native settings section. Everything below
// drives the actually registered component through the hook harness — no
// source-string assertions. The section's only automatic data source is the
// read-only `connections` RPC; statistics channels, dashboard mounts and
// provider refresh/sync/login stay out unless a user action fires them.
// ---------------------------------------------------------------------------

/** Collect every rendered button whose children JSON contains the label. */
function findButtons(tree, label) {
  const found = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.type === 'button' && JSON.stringify(node.children ?? []).includes(`"${label}"`)) found.push(node)
    ;(node.children ?? []).forEach(walk)
  }
  walk(tree)
  return found
}

const settingsConnectionsPayload = () => ({
  adapters: [],
  connections: [
    { providerId: 'openai-codex', displayName: 'OpenAI Codex (ChatGPT subscription)', configured: true, credentialKind: 'oauth', credentialRef: 'OPENAI_CODEX_OAUTH', observationSource: 'official_usage_api' },
    { providerId: 'ollama-cloud', displayName: 'Ollama Cloud', configured: true, credentialKind: 'api_key_or_manual_cookie', credentialStatus: 'manual-cookie', credentialRef: 'OLLAMA_SESSION_COOKIE', observationSource: 'official_ui' },
    { providerId: 'glm', displayName: 'GLM / Z.AI', configured: false, credentialKind: 'raw_authorization', credentialRef: 'ZAI_CODING_CN_API_KEY', observationSource: 'official_plugin_internal_api' },
    { providerId: 'ollama-local', displayName: 'Ollama Local', configured: false, quotaApplicable: false, observationSource: 'none' },
    { providerId: 'antigravity', connectionId: 'account-a', displayName: 'one@example.com', configured: true, credentialKind: 'oauth', credentialRef: 'ANTIGRAVITY_ACCESS_TOKEN', observationSource: 'official_usage_api' },
  ],
  modelCatalogs: [{ providerId: 'ollama-cloud', routeId: 'ollama-cloud', configured: true, modelCount: 3, credentialConfigured: true }],
  antigravity: {
    activeAccountId: 'account-a', autoFailover: true,
    accounts: [
      { provider: 'antigravity', configured: true, accountId: 'account-a', active: true, email: 'one@example.com', expires: 4102444800000, expired: false },
      { provider: 'antigravity', configured: true, accountId: 'account-b', active: false, email: 'two@example.com', expires: 1, expired: true },
    ],
  },
  privacy: { secretsInRpc: false, secretsInSqlite: false, localLedgerSeparate: true },
})

function createSettingsHarness({ connections = settingsConnectionsPayload(), summary, extraResponses = {}, controlled = [] } = {}) {
  const responses = new Map([
    ['/account-usage:connections', connections],
    ['/account-usage:pending-login', { login: null, active: false }],
    ...Object.entries(extraResponses),
  ])
  if (summary !== undefined) responses.set('/account-usage:summary', summary)
  const harness = createHookHarness({ responses, controlled })
  harness.settingsComponent = harness.registrations.find(({ definition }) => definition.name === 'settings.section').component
  return harness
}

const SETTINGS_QUIET_ENDPOINTS = [
  'summary', 'query', 'entry-summary', 'import-status', 'settings', 'overview',
  'sync-model-catalog', 'refresh-observations', 'observe-provider',
]

/** connection-action calls are endpoint+action; count by the action payload. */
function countAction(harness, action) {
  return harness.rpcCalls.filter((entry) => entry.endpoint === 'connection-action' && entry.payload?.action === action).length
}

/** Every call that went through the statistics channel — always zero here. */
const tokenUsageChannelCalls = (harness) => harness.rpcCalls.filter((entry) => entry.channel === '/token-usage').length

/** Collect every rendered input whose placeholder contains the fragment. */
function findInputs(tree, placeholderFragment) {
  const found = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.type === 'input' && String(node.props?.placeholder ?? '').includes(placeholderFragment)) found.push(node)
    ;(node.children ?? []).forEach(walk)
  }
  walk(tree)
  return found
}

test('settings section mounts read-only: connections facts only, honest badges, no statistics or refresh', async () => {
  const harness = createSettingsHarness()
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent, count, rpcCalls } = harness
    const tree = runtime.render(settingsComponent, {})
    await flushMicrotasks()
    const settled = runtime.render(settingsComponent, {})
    const json = JSON.stringify(settled)

    // The one automatic call is the read-only connections endpoint.
    assert.equal(count('connections'), 1)
    for (const endpoint of SETTINGS_QUIET_ENDPOINTS) {
      assert.equal(count(endpoint), 0, `settings mount must not call ${endpoint}`)
    }
    for (const action of ['start-login', 'cancel-login', 'login-status', 'logout', 'pending-login']) {
      assert.equal(countAction(harness, action), 0, `settings mount must not run ${action}`)
    }

    // Facts render per source; the Antigravity pool collapses into one entry.
    assert.ok(json.includes('OpenAI Codex (ChatGPT subscription)'), 'codex connection fact missing')
    assert.ok(json.includes('Connection ID') && json.includes('openai-codex:default'), 'connection id fact visible')
    assert.ok(json.includes('4 connection(s)'), 'connection count shown; the hidden local service is excluded')
    assert.ok(findButtons(settled, 'Ollama Local').length === 0, 'Ollama Local has no account surface — kept out of the panel')
    assert.ok(json.includes('Antigravity') && json.includes('2 account(s)'), 'pool source with its account summary shown')

    // Evidence-only states: a stored quota cookie is configured, never a
    // verified model call; an unconfigured provider reads as not connected.
    assert.ok(json.includes('Configured · no official check'), 'unverified credential state shown')
    assert.ok(json.includes('Not connected'), 'unconfigured state shown')
    const connectedBadges = (JSON.stringify(settled).match(/"Connected"/g) ?? []).length
    assert.equal(connectedBadges, 2, 'the oauth provider reads as Connected in its list row and detail head; the cookie path must not')

    // The cached model catalog rides with the Ollama Cloud detail (B-form).
    findButtons(runtime.render(settingsComponent, {}), 'Ollama Cloud')[0].props.onClick()
    await flushMicrotasks()
    const withCatalog = JSON.stringify(runtime.render(settingsComponent, {}))
    assert.ok(withCatalog.includes('Sync Cloud models (3)'), 'cached catalog count shown in the ollama-cloud detail')
    assert.equal(count('sync-model-catalog'), 0, 'catalog display never syncs by itself')

    // The pool detail carries the account roster (B-form).
    findButtons(runtime.render(settingsComponent, {}), 'Antigravity')[0].props.onClick()
    await flushMicrotasks()
    const poolTree = runtime.render(settingsComponent, {})
    const withPool = JSON.stringify(poolTree)
    assert.ok(withPool.includes('one@example.com'), 'the active pool account email shows in the pool detail')
    assert.ok(withPool.includes('two@example.com'), 'the standby pool account email shows in the pool detail')
    assert.ok(withPool.includes('Account pool · 2'), 'pool head shows the account count')
    // An expired ACCESS token refreshes on next use — the expired standby
    // keeps the activation action; only removal is destructive.
    assert.equal(findButtons(poolTree, 'Set active').length, 1, 'the expired standby still offers activation')
    assert.ok(!withPool.includes('Sign in again'), 'an expired access token must not swap the action for a re-login')
    assert.deepEqual(rpcCalls.filter((entry) => entry.endpoint === 'summary'), [])
    runtime.unmountAll()
  } finally {
    restore()
  }
})

test('settings section: refresh is explicit and touches only the connections endpoint; empty state is clear', async () => {
  const harness = createSettingsHarness()
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent, count } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    const refresh = findButtons(runtime.render(settingsComponent, {}), 'Refresh connections')
    assert.equal(refresh.length, 1)
    refresh[0].props.onClick()
    await flushMicrotasks()
    runtime.render(settingsComponent, {})
    assert.equal(count('connections'), 2, 'explicit refresh refetches connection facts')
    for (const endpoint of SETTINGS_QUIET_ENDPOINTS) {
      assert.equal(count(endpoint), 0, `refresh must not call ${endpoint}`)
    }
    for (const action of ['start-login', 'cancel-login', 'login-status', 'logout', 'pending-login']) {
      assert.equal(countAction(harness, action), 0, `refresh must not run ${action}`)
    }
    runtime.unmountAll()
  } finally {
    restore()
  }

  // Empty connection list: a clear hint instead of a blank section.
  const emptyHarness = createSettingsHarness({ connections: { connections: [], modelCatalogs: [], antigravity: null, privacy: {} } })
  const emptyRestore = installClientGlobals(emptyHarness)
  try {
    const { runtime, settingsComponent } = emptyHarness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    const json = JSON.stringify(runtime.render(settingsComponent, {}))
    assert.ok(json.includes('No provider connections detected'), 'empty state message missing')
    emptyHarness.runtime.unmountAll()
  } finally {
    emptyRestore()
  }
})

// C-001 regression: expanding a row must NOT load the analytics summary.
// The old draft asserted summary=1 here — that was the bug (the shared
// ConnectionSection pulled in ensureAccountSummary), now the expanded panel
// runs in facts mode and the statistics path stays at zero.
test('settings section: manage expands the shared ConnectionSection on connections facts only; statistics stay out', async () => {
  const connectionRows = [
    { providerId: 'openai-codex', displayName: 'OpenAI Codex (ChatGPT subscription)', configured: true, credentialKind: 'oauth', credentialRef: 'OPENAI_CODEX_OAUTH', observationSource: 'official_usage_api' },
    { providerId: 'glm', displayName: 'GLM / Z.AI', configured: false, credentialKind: 'raw_authorization', credentialRef: 'ZAI_CODING_CN_API_KEY', observationSource: 'official_plugin_internal_api' },
  ]
  // `summary` is deliberately mapped (a live host would offer it) to prove
  // the section never reaches for it, and every /token-usage endpoint stays
  // unmapped so any statistics call would fail loudly.
  const harness = createSettingsHarness({
    connections: { adapters: [], connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
    summary: { product: { name: 'DSH Accounts & Usage' }, connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent, count } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    assert.equal(count('summary'), 0, 'collapsed section never loads the summary')
    assert.equal(tokenUsageChannelCalls(harness), 0, 'no statistics channel call on mount')

    // Expanding a connection is an explicit user action, but it is NOT
    // consent for the analytics summary: the reused ConnectionSection reads
    // the already-loaded read-only facts and fires no RPC at all.
    // Selecting a source mounts the shared ConnectionSection in the detail
    // pane on the already-loaded facts — an explicit user action, but NOT
    // consent for the analytics summary.
    const codexItem = findButtons(runtime.render(settingsComponent, {}), 'OpenAI Codex (ChatGPT subscription)')
    assert.equal(codexItem.length, 1, 'one list entry per source')
    codexItem[0].props.onClick()
    await flushMicrotasks()
    let expanded = runtime.render(settingsComponent, {})
    await flushMicrotasks()
    expanded = runtime.render(settingsComponent, {})
    assert.equal(count('summary'), 0, 'selecting must not load the analytics summary (C-001)')
    assert.equal(findButtons(expanded, 'Disconnect').length, 1, 'the real connection controls render from facts')

    // Select the other source: still zero summary calls, and the shared
    // facts are reused instead of refetched (minimal loading).
    findButtons(runtime.render(settingsComponent, {}), 'GLM / Z.AI')[0].props.onClick()
    await flushMicrotasks()
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    assert.equal(count('summary'), 0, 'switching rows still never loads the summary')
    assert.equal(count('connections'), 1, 'expand/switch reuse the loaded facts; no refetch')
    // No write path may run by itself.
    for (const action of ['start-login', 'logout', 'cancel-login', 'login-status']) {
      assert.equal(countAction(harness, action), 0, `${action} must stay user-triggered`)
    }
    for (const endpoint of ['sync-model-catalog', 'observe-provider', 'refresh-observations']) {
      assert.equal(count(endpoint), 0, `${endpoint} must stay user-triggered`)
    }
    assert.equal(tokenUsageChannelCalls(harness), 0, 'the usage statistics channel is never touched')
    runtime.unmountAll()
  } finally {
    restore()
  }
})

// C-001 acceptance: with the whole statistics world failing (unmapped
// `summary`, unmapped /token-usage endpoints) the settings management flow
// must stay fully usable, and every explicit owner action must refresh the
// read-only connections facts instead of the analytics summary.
test('settings section: with statistics failing, expanded controls stay usable and explicit owner actions reload the connections facts', async () => {
  let rows = [
    { providerId: 'openai-codex', displayName: 'OpenAI Codex (ChatGPT subscription)', configured: true, credentialKind: 'oauth', credentialRef: 'OPENAI_CODEX_OAUTH', observationSource: 'official_usage_api' },
    { providerId: 'ollama-cloud', displayName: 'Ollama Cloud', configured: true, credentialKind: 'api_key_or_manual_cookie', credentialStatus: 'manual-cookie', credentialRef: 'OLLAMA_SESSION_COOKIE', observationSource: 'official_ui' },
    { providerId: 'glm', displayName: 'GLM / Z.AI', configured: false, credentialKind: 'raw_authorization', credentialRef: 'ZAI_CODING_CN_API_KEY', observationSource: 'official_plugin_internal_api' },
  ]
  const harness = createSettingsHarness({
    connections: () => ({
      adapters: [],
      connections: rows,
      modelCatalogs: [{ providerId: 'ollama-cloud', routeId: 'ollama-cloud', configured: true, modelCount: 2, credentialConfigured: true }],
      antigravity: null,
      privacy: {},
    }),
    extraResponses: {
      '/account-usage:sync-model-catalog': () => ({ added: 2, updated: 0 }),
      '/account-usage:connection-action': (payload) => {
        if (payload?.action === 'logout') {
          rows = rows.map((row) => row.providerId === 'openai-codex' ? { ...row, configured: false } : row)
          return {}
        }
        if (payload?.action === 'start-login') return { challenge: { loginId: 'L2', verificationUri: 'https://example.com/activate' } }
        if (payload?.action === 'login-status') {
          rows = rows.map((row) => row.providerId === 'openai-codex' ? { ...row, configured: true } : row)
          return { status: { kind: 'succeeded' } }
        }
        return {}
      },
    },
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent, count } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    assert.equal(count('summary'), 0)

    // Select the codex source: the real controls render from facts while the
    // statistics endpoint would fail on every call.
    findButtons(runtime.render(settingsComponent, {}), 'OpenAI Codex (ChatGPT subscription)')[0].props.onClick()
    await flushMicrotasks()
    let tree = runtime.render(settingsComponent, {})
    await flushMicrotasks()
    tree = runtime.render(settingsComponent, {})
    assert.equal(count('summary'), 0, 'expanding never calls the failing statistics endpoint')
    const disconnect = findButtons(tree, 'Disconnect')
    assert.equal(disconnect.length, 1, 'the connection controls are usable with statistics down')

    // Explicit disconnect: the host owner action, then exactly one facts
    // reload — no summary, no statistics channel, no ledger write.
    disconnect[0].props.onClick()
    await flushMicrotasks()
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    runtime.render(settingsComponent, {})
    assert.equal(countAction(harness, 'logout'), 1, 'disconnect went through the host owner action')
    assert.equal(count('connections'), 2, 'the action reloaded the read-only facts exactly once')
    assert.equal(count('summary'), 0, 'no statistics call followed the action')
    assert.equal(tokenUsageChannelCalls(harness), 0, 'the usage ledger channel was never touched')

    // Switch to the ollama source: explicit model sync through the owner
    // endpoint, then the facts reload.
    findButtons(runtime.render(settingsComponent, {}), 'Ollama Cloud')[0].props.onClick()
    await flushMicrotasks()
    tree = runtime.render(settingsComponent, {})
    await flushMicrotasks()
    tree = runtime.render(settingsComponent, {})
    const sync = findButtons(tree, 'Sync Cloud models (2)')
    assert.equal(sync.length, 1, 'the model sync control is available on the expanded row')
    assert.equal(count('sync-model-catalog'), 0, 'sync stays user-triggered')
    sync[0].props.onClick()
    await flushMicrotasks()
    await flushMicrotasks()
    assert.equal(count('sync-model-catalog'), 1, 'the sync reached the owner endpoint once')
    assert.equal(count('connections'), 3, 'the sync reloaded the read-only facts')
    assert.equal(count('summary'), 0, 'still no statistics call')

    // GLM credential save: the high-level credentials facade writes the
    // credential (never a direct settings/credential store write) and the
    // facts reload.
    findButtons(runtime.render(settingsComponent, {}), 'GLM / Z.AI')[0].props.onClick()
    await flushMicrotasks()
    tree = runtime.render(settingsComponent, {})
    await flushMicrotasks()
    tree = runtime.render(settingsComponent, {})
    const glmInput = findInputs(tree, 'ZAI_CODING_CN_API_KEY')
    assert.equal(glmInput.length, 1, 'the GLM credential input renders')
    glmInput[0].props.onChange({ target: { value: ' test-key-value ' } })
    await flushMicrotasks()
    const save = findButtons(runtime.render(settingsComponent, {}), 'Save credential')
    assert.equal(save.length, 1, 'the save control is available')
    assert.equal(save[0].props.disabled, false, 'save enables once a draft exists')
    save[0].props.onClick()
    await flushMicrotasks()
    await flushMicrotasks()
    assert.equal(harness.credentialSets.length, 1, 'the save went through the credentials facade')
    assert.deepEqual(harness.credentialSets[0], { ref: 'ZAI_CODING_CN_API_KEY', value: 'test-key-value' })
    assert.equal(count('connections'), 4, 'the credential save reloaded the facts')
    assert.equal(count('summary'), 0, 'still zero statistics calls')

    // Codex sign-in: explicit connect starts the host authorization, the
    // local wait succeeds, and the facts reload — the summary stays silent.
    findButtons(runtime.render(settingsComponent, {}), 'OpenAI Codex (ChatGPT subscription)')[0].props.onClick()
    await flushMicrotasks()
    tree = runtime.render(settingsComponent, {})
    await flushMicrotasks()
    tree = runtime.render(settingsComponent, {})
    const connect = findButtons(tree, 'Connect')
    assert.equal(connect.length, 1, 'the sign-in control is available for the unconfigured oauth row')
    connect[0].props.onClick()
    await flushMicrotasks()
    assert.equal(countAction(harness, 'start-login'), 1, 'connect started the host authorization exactly once')
    await harness.clock.advance()
    assert.equal(countAction(harness, 'login-status'), 1, 'the local wait polled the host status once')
    await flushMicrotasks()
    tree = runtime.render(settingsComponent, {})
    await flushMicrotasks()
    tree = runtime.render(settingsComponent, {})
    assert.equal(count('connections'), 5, 'the login success reloaded the read-only facts')
    assert.equal(count('summary'), 0, 'the whole management flow stayed off the statistics path')
    assert.equal(tokenUsageChannelCalls(harness), 0, 'no ledger write, no usage import, nothing')
    runtime.unmountAll()
    await harness.clock.advance()
    assert.equal(countAction(harness, 'login-status'), 1, 'no wait loop survives the section')
  } finally {
    restore()
  }
})

test('connection login wait dies with the section and never cancels the host authorization', async () => {
  const connectionRows = [
    { providerId: 'openai-codex', displayName: 'OpenAI Codex (ChatGPT subscription)', configured: false, credentialKind: 'oauth', credentialRef: 'OPENAI_CODEX_OAUTH', observationSource: 'official_usage_api' },
  ]
  const harness = createSettingsHarness({
    connections: { adapters: [], connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
    summary: { product: { name: 'DSH Accounts & Usage' }, connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
    extraResponses: {
      '/account-usage:connection-action': (payload) => {
        if (payload?.action === 'start-login') return { challenge: { loginId: 'L1', verificationUri: 'https://example.com/activate' } }
        if (payload?.action === 'login-status') return { status: { kind: 'pending' } }
        return {}
      },
    },
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent, count, rpcCalls } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    // The detail pane mounts the connection controls for the default source;
    // a few flush passes let the facts land and the reattach effect run.
    for (let i = 0; i < 3; i += 1) {
      runtime.render(settingsComponent, {})
      await flushMicrotasks()
    }
    // The reattach pass is non-destructive: it asks for a pending login
    // (status query only), never starts one.
    assert.equal(countAction(harness, 'pending-login'), 1)
    assert.equal(countAction(harness, 'start-login'), 0)

    // Explicit connect: start-login, then the local 1.5s wait loop polls
    // login-status.
    const connect = findButtons(runtime.render(settingsComponent, {}), 'Connect')
    assert.equal(connect.length, 1)
    connect[0].props.onClick()
    await flushMicrotasks()
    assert.equal(countAction(harness, 'start-login'), 1)
    await harness.clock.advance()
    assert.equal(countAction(harness, 'login-status'), 1, 'local wait polls the login status')

    // Section unmount (collapse/close): the local wait stops and no host
    // cancel-login fires — the device authorization keeps running.
    runtime.unmountAll()
    await harness.clock.advance()
    await harness.clock.advance()
    assert.equal(countAction(harness, 'login-status'), 1, 'no login-status polls after unmount')
    assert.equal(countAction(harness, 'cancel-login'), 0, 'closing the page must not cancel the host authorization')
    assert.equal(countAction(harness, 'logout'), 0, 'closing the page must not log out')
  } finally {
    restore()
  }
})

test('explicit user cancel asks the host once and stops the local wait; reopening reattaches via pending-login only', async () => {
  const connectionRows = [
    { providerId: 'openai-codex', displayName: 'OpenAI Codex (ChatGPT subscription)', configured: false, credentialKind: 'oauth', credentialRef: 'OPENAI_CODEX_OAUTH', observationSource: 'official_usage_api' },
  ]
  const harness = createSettingsHarness({
    connections: { adapters: [], connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
    summary: { product: { name: 'DSH Accounts & Usage' }, connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
    extraResponses: {
      '/account-usage:connection-action': (payload) => {
        if (payload?.action === 'pending-login') return { login: { loginId: 'P1', userCode: 'CODE-1', verificationUri: 'https://example.com/activate' } }
        if (payload?.action === 'login-status') return { status: { kind: 'pending' } }
        if (payload?.action === 'cancel-login') return {}
        return {}
      },
    },
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent, count } = harness
    // Mount with a live pending login: the section reattaches to it through
    // the non-destructive pending-login query and resumes the local wait.
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    // A few flush passes let the facts land and the reattach effect run.
    for (let i = 0; i < 3; i += 1) {
      runtime.render(settingsComponent, {})
      await flushMicrotasks()
    }
    const tree = runtime.render(settingsComponent, {})
    const json = JSON.stringify(tree)
    assert.ok(json.includes('CODE-1'), 'reattached pending login shows the device code')
    assert.equal(countAction(harness, 'pending-login'), 1, 'reattach used the pending-login status query')
    assert.equal(countAction(harness, 'start-login'), 0, 'reattach never starts a new authorization')
    await harness.clock.advance()
    assert.equal(countAction(harness, 'login-status'), 1, 'reattached wait resumes polling')

    // The user clicks Cancel sign-in: the host is asked once and the local
    // wait stops — distinct from the unmount path above.
    const cancel = findButtons(runtime.render(settingsComponent, {}), 'Cancel sign-in')
    assert.equal(cancel.length, 1)
    cancel[0].props.onClick()
    await flushMicrotasks()
    assert.equal(countAction(harness, 'cancel-login'), 1, 'explicit cancel reaches the host once')
    await harness.clock.advance()
    await harness.clock.advance()
    assert.equal(countAction(harness, 'login-status'), 1, 'local wait stopped after explicit cancel')
    runtime.unmountAll()
  } finally {
    restore()
  }
})

test('settings section: unknown model catalog state is explicit and never syncs by itself', async () => {
  const harness = createSettingsHarness({
    connections: {
      adapters: [],
      connections: [{ providerId: 'ollama-cloud', displayName: 'Ollama Cloud', configured: true, credentialKind: 'api_key_or_manual_cookie', credentialStatus: 'unverified', credentialRef: 'OLLAMA_API_KEY', observationSource: 'official_response' }],
      modelCatalogs: [{ providerId: 'ollama-cloud', routeId: 'ollama-cloud', configured: true, modelCount: 0, credentialConfigured: true }],
      antigravity: null,
      privacy: {},
    },
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent, count } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    const json = JSON.stringify(runtime.render(settingsComponent, {}))
    assert.ok(json.includes('Sync Cloud models (0)'), 'the cached catalog count renders explicitly — zero means nothing cached yet')
    assert.equal(count('sync-model-catalog'), 0, 'no automatic model synchronization')
    runtime.unmountAll()
  } finally {
    restore()
  }
})

// ---------------------------------------------------------------------------
// AC-001 + OUT-AC-001 regressions (governance round 2, on the 5.1.3 base).
// The parent repro scripts (login-unmount-repro.mjs / glm-label-repro.mjs)
// asserted these as frozen-candidate defects; the cases below pin the fixed
// behavior with the same fake-RPC/fake-clock harness. No credentials, no
// browser, no provider network.
// ---------------------------------------------------------------------------

// OUT-AC-001: closing the section while the start-login RPC is still in
// flight. The late challenge must not update local state, must not open the
// authorization page, and must not create a new login-status wait — while the
// host-owned authorization itself is never cancelled or logged out.
test('closing while start-login is in flight: the late challenge starts nothing local', async () => {
  const connectionRows = [
    { providerId: 'openai-codex', displayName: 'OpenAI Codex (ChatGPT subscription)', configured: false, credentialKind: 'oauth', credentialRef: 'OPENAI_CODEX_OAUTH', observationSource: 'official_usage_api' },
  ]
  const harness = createSettingsHarness({
    connections: { adapters: [], connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
    summary: { product: { name: 'DSH Accounts & Usage' }, connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
    controlled: ['/account-usage:connection-action'],
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    for (let i = 0; i < 3; i += 1) {
      await flushMicrotasks()
      runtime.render(settingsComponent, {})
    }
    const connect = findButtons(runtime.render(settingsComponent, {}), 'Connect')[0]
    assert.ok(connect, 'the sign-in control renders for the unconfigured oauth row')
    connect.props.onClick()
    await flushMicrotasks()
    assert.equal(countAction(harness, 'start-login'), 1, 'connect started the host authorization')

    // Close the section while start-login is still parked in flight.
    runtime.unmountAll()
    const parked = harness.pending('/account-usage:connection-action').find(entry => entry.payload?.action === 'start-login')
    assert.ok(parked, 'start-login stayed in flight across the unmount')
    parked.resolve({ ok: true, value: { challenge: { loginId: 'late-start', verificationUri: 'https://example.invalid/activate' } } })
    await flushMicrotasks()
    await harness.clock.advance()
    await harness.clock.advance()

    assert.equal(countAction(harness, 'login-status'), 0, 'a late challenge must not start login-status polling after unmount')
    assert.equal(harness.windowOpens.length, 0, 'a late challenge must not open the authorization page after unmount')
    assert.equal(countAction(harness, 'cancel-login'), 0, 'closing the page never cancels the host authorization')
    assert.equal(countAction(harness, 'logout'), 0, 'closing the page never logs out')
  } finally {
    harness.runtime.unmountAll()
    restore()
  }
})

// OUT-AC-001: an in-flight login-status poll that RESOLVES after unmount.
// The wait dies silently: no state refresh, no further polls, no host cancel.
test('a login-status response landing after unmount changes nothing and starts nothing', async () => {
  const connectionRows = [
    { providerId: 'openai-codex', displayName: 'OpenAI Codex (ChatGPT subscription)', configured: false, credentialKind: 'oauth', credentialRef: 'OPENAI_CODEX_OAUTH', observationSource: 'official_usage_api' },
  ]
  const harness = createSettingsHarness({
    connections: { adapters: [], connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
    summary: { product: { name: 'DSH Accounts & Usage' }, connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
    controlled: ['/account-usage:connection-action'],
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    for (let i = 0; i < 3; i += 1) {
      await flushMicrotasks()
      runtime.render(settingsComponent, {})
    }
    findButtons(runtime.render(settingsComponent, {}), 'Connect')[0].props.onClick()
    await flushMicrotasks()
    const parkedStart = harness.pending('/account-usage:connection-action').find(entry => entry.payload?.action === 'start-login')
    parkedStart.resolve({ ok: true, value: { challenge: { loginId: 'L1', verificationUri: 'https://example.invalid/activate' } } })
    await flushMicrotasks()
    assert.equal(harness.windowOpens.length, 1, 'the authorization page opened exactly once while mounted')
    await harness.clock.advance()
    assert.equal(countAction(harness, 'login-status'), 1, 'the local wait polled once while mounted')

    // Unmount while that login-status RPC is still parked in flight.
    runtime.unmountAll()
    const parkedPoll = harness.pending('/account-usage:connection-action').find(entry => entry.payload?.action === 'login-status')
    parkedPoll.resolve({ ok: true, value: { status: { kind: 'succeeded' } } })
    await flushMicrotasks()
    await harness.clock.advance()
    await harness.clock.advance()

    assert.equal(countAction(harness, 'login-status'), 1, 'no further polls after unmount')
    assert.equal(harness.count('connections'), 1, 'the late success must not reload the facts after unmount')
    assert.equal(countAction(harness, 'cancel-login'), 0, 'unmount never cancels the host authorization')
    assert.equal(countAction(harness, 'logout'), 0, 'unmount never logs out')
  } finally {
    harness.runtime.unmountAll()
    restore()
  }
})

// OUT-AC-001: identity switch while start-login is in flight. Collapsing the
// codex row and expanding the xai row replaces the panel; the late challenge
// for the previous identity must strand silently instead of driving the new
// panel's state, timers or facts.
test('switching connection identity while start-login is in flight strands the late challenge', async () => {
  const connectionRows = [
    { providerId: 'openai-codex', displayName: 'OpenAI Codex (ChatGPT subscription)', configured: false, credentialKind: 'oauth', credentialRef: 'OPENAI_CODEX_OAUTH', observationSource: 'official_usage_api' },
    { providerId: 'xai', displayName: 'Grok / X subscription', configured: false, credentialKind: 'oauth', credentialRef: 'XAI_OAUTH', observationSource: 'official_usage_api' },
  ]
  const harness = createSettingsHarness({
    connections: { adapters: [], connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
    summary: { product: { name: 'DSH Accounts & Usage' }, connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
    controlled: ['/account-usage:connection-action'],
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    for (let i = 0; i < 3; i += 1) {
      await flushMicrotasks()
      runtime.render(settingsComponent, {})
    }
    findButtons(runtime.render(settingsComponent, {}), 'Connect')[0].props.onClick()
    await flushMicrotasks()
    assert.equal(countAction(harness, 'start-login'), 1, 'the codex row started its host authorization')

    // Switch identity: select the xai source in the list.
    findButtons(runtime.render(settingsComponent, {}), 'Grok / X subscription')[0].props.onClick()
    for (let i = 0; i < 3; i += 1) {
      await flushMicrotasks()
      runtime.render(settingsComponent, {})
    }

    // The codex start-login challenge lands after the switch.
    const parkedStart = harness.pending('/account-usage:connection-action').find(entry => entry.payload?.action === 'start-login')
    parkedStart.resolve({ ok: true, value: { challenge: { loginId: 'late-codex', verificationUri: 'https://example.invalid/activate' } } })
    await flushMicrotasks()
    await harness.clock.advance()
    await harness.clock.advance()

    assert.equal(countAction(harness, 'login-status'), 0, 'the stranded challenge must not poll for any identity')
    assert.equal(harness.windowOpens.length, 0, 'the stranded challenge must not open the authorization page')
    assert.equal(countAction(harness, 'cancel-login'), 0, 'an identity switch never cancels the host authorization')
    assert.equal(harness.count('connections'), 1, 'the stranded challenge must not reload the shared facts')
    const reconnected = findButtons(runtime.render(settingsComponent, {}), 'Connect')[0]
    assert.ok(reconnected, 'the new identity keeps its own sign-in control')
    assert.equal(reconnected.props.disabled, false, 'the identity switch released the abandoned login busy gate')
  } finally {
    harness.runtime.unmountAll()
    restore()
  }
})

// OUT-AC-001: reopening after a guarded unmount must still reattach to the
// host-owned pending login through the non-destructive pending-login query —
// without starting a new authorization.
test('reopening the section after a guarded unmount reattaches through pending-login only', async () => {
  const connectionRows = [
    { providerId: 'openai-codex', displayName: 'OpenAI Codex (ChatGPT subscription)', configured: false, credentialKind: 'oauth', credentialRef: 'OPENAI_CODEX_OAUTH', observationSource: 'official_usage_api' },
  ]
  const harness = createSettingsHarness({
    connections: { adapters: [], connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
    summary: { product: { name: 'DSH Accounts & Usage' }, connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
    controlled: ['/account-usage:connection-action'],
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    for (let i = 0; i < 3; i += 1) {
      await flushMicrotasks()
      runtime.render(settingsComponent, {})
    }
    findButtons(runtime.render(settingsComponent, {}), 'Connect')[0].props.onClick()
    await flushMicrotasks()
    assert.equal(countAction(harness, 'start-login'), 1)
    runtime.unmountAll()
    const parkedStart = harness.pending('/account-usage:connection-action').find(entry => entry.payload?.action === 'start-login')
    parkedStart.resolve({ ok: true, value: { challenge: { loginId: 'L9', verificationUri: 'https://example.invalid/activate' } } })
    await flushMicrotasks()
    assert.equal(countAction(harness, 'login-status'), 0, 'the unmounted panel never polled')

    // Reopen: a fresh mount reattaches to the same host-owned login. The
    // pending-login response is parked while ordinary state-driven re-render
    // passes run (and a dep-changing explicit refresh forces a real effect
    // cleanup/re-run) — none of that may tear the reattach down (R2-AC-001).
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    const parkedReattach = [...harness.pending('/account-usage:connection-action')].reverse().find(entry => entry.payload?.action === 'pending-login')
    assert.ok(parkedReattach, 'the reopened panel queried pending-login')
    // State-driven render passes while the response is still parked.
    for (let i = 0; i < 3; i += 1) {
      runtime.render(settingsComponent, {})
      await flushMicrotasks()
    }
    // An explicit facts refresh changes the effect deps (data.value) and
    // forces a real cleanup/re-run cycle; the parked response must survive it.
    const connectionsBeforeRefresh = harness.count('connections')
    findButtons(runtime.render(settingsComponent, {}), 'Refresh connections')[0].props.onClick()
    await flushMicrotasks()
    assert.equal(harness.count('connections'), connectionsBeforeRefresh + 1, 'the explicit refresh reloaded the facts while pending-login was parked')
    // Only now does the host answer.
    parkedReattach.resolve({ ok: true, value: { login: { loginId: 'L9', userCode: 'CODE-9', verificationUri: 'https://example.invalid/activate' } } })
    await flushMicrotasks()
    const reopened = runtime.render(settingsComponent, {})
    assert.ok(JSON.stringify(reopened).includes('CODE-9'), 'the reopened panel shows the pending device code after state-driven re-renders')
    assert.equal(countAction(harness, 'pending-login'), 2, 'exactly one pending-login query per mount, no refire from dep churn')
    assert.equal(countAction(harness, 'start-login'), 1, 'reattach never starts a new authorization')
    await harness.clock.advance()
    assert.equal(countAction(harness, 'login-status'), 1, 'the live panel resumes its own local wait')
    assert.equal(countAction(harness, 'cancel-login'), 0, 'no cancel fired anywhere in the flow')
  } finally {
    harness.runtime.unmountAll()
    restore()
  }
})

// R2-AC-001 (first mount, slow RPC): a pending-login response that lands only
// after state-driven re-render passes must still reattach — the reattach is
// bound to the panel lifecycle, not to one effect run.
test('a slow pending-login response survives state-driven re-renders and reattaches on first mount', async () => {
  const connectionRows = [
    { providerId: 'openai-codex', displayName: 'OpenAI Codex (ChatGPT subscription)', configured: false, credentialKind: 'oauth', credentialRef: 'OPENAI_CODEX_OAUTH', observationSource: 'official_usage_api' },
  ]
  const harness = createSettingsHarness({
    connections: { adapters: [], connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
    summary: { product: { name: 'DSH Accounts & Usage' }, connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
    controlled: ['/account-usage:connection-action'],
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    const parkedReattach = harness.pending('/account-usage:connection-action').find(entry => entry.payload?.action === 'pending-login')
    assert.ok(parkedReattach, 'the mounted panel queried pending-login')
    // State-driven re-render passes (reattach bookkeeping, parent renders)
    // while the host has not answered yet.
    for (let i = 0; i < 3; i += 1) {
      runtime.render(settingsComponent, {})
      await flushMicrotasks()
    }
    parkedReattach.resolve({ ok: true, value: { login: { loginId: 'P1', userCode: 'CODE-DELAYED', verificationUri: 'https://example.invalid/activate' } } })
    await flushMicrotasks()
    const tree = runtime.render(settingsComponent, {})
    assert.ok(JSON.stringify(tree).includes('CODE-DELAYED'), 'the delayed pending login shows the device code')
    assert.equal(countAction(harness, 'start-login'), 0, 'reattach never starts a new authorization')
    await harness.clock.advance()
    assert.equal(countAction(harness, 'login-status'), 1, 'the reattached wait polls the host status')
    assert.equal(countAction(harness, 'cancel-login'), 0, 'reattach never cancels the host authorization')
    runtime.unmountAll()
    await harness.clock.advance()
    assert.equal(countAction(harness, 'login-status'), 1, 'no polls after unmount')
  } finally {
    harness.runtime.unmountAll()
    restore()
  }
})

// R2-AC-001 (rejection side): a pending-login response that lands after
// unmount must change nothing — no device code can matter, no local wait may
// start, and the host authorization is never cancelled.
test('a pending-login response landing after unmount starts nothing and cancels nothing', async () => {
  const connectionRows = [
    { providerId: 'openai-codex', displayName: 'OpenAI Codex (ChatGPT subscription)', configured: false, credentialKind: 'oauth', credentialRef: 'OPENAI_CODEX_OAUTH', observationSource: 'official_usage_api' },
  ]
  const harness = createSettingsHarness({
    connections: { adapters: [], connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
    summary: { product: { name: 'DSH Accounts & Usage' }, connections: connectionRows, modelCatalogs: [], antigravity: null, privacy: {} },
    controlled: ['/account-usage:connection-action'],
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    const parkedReattach = harness.pending('/account-usage:connection-action').find(entry => entry.payload?.action === 'pending-login')
    assert.ok(parkedReattach, 'the mounted panel queried pending-login')
    for (let i = 0; i < 2; i += 1) {
      runtime.render(settingsComponent, {})
      await flushMicrotasks()
    }
    runtime.unmountAll()
    parkedReattach.resolve({ ok: true, value: { login: { loginId: 'P2', userCode: 'CODE-LATE-UNMOUNT', verificationUri: 'https://example.invalid/activate' } } })
    await flushMicrotasks()
    await harness.clock.advance()
    await harness.clock.advance()
    assert.equal(countAction(harness, 'login-status'), 0, 'a late pending-login must not start polling after unmount')
    assert.equal(harness.windowOpens.length, 0, 'a late pending login must not open anything after unmount')
    assert.equal(countAction(harness, 'cancel-login'), 0, 'unmount never cancels the host authorization')
    assert.equal(countAction(harness, 'logout'), 0, 'unmount never logs out')
  } finally {
    harness.runtime.unmountAll()
    restore()
  }
})

// AC-001: a stored raw GLM key is configured, never a verified model call.
// Variant 1 uses the producer shape after the fix (credentialStatus present).
test('settings: a configured GLM raw key reads as configured-unverified, never Connected (producer marks it)', async () => {
  const harness = createSettingsHarness({
    connections: {
      adapters: [],
      connections: [
        { providerId: 'openai-codex', displayName: 'OpenAI Codex (ChatGPT subscription)', configured: true, credentialKind: 'oauth', credentialRef: 'OPENAI_CODEX_OAUTH', observationSource: 'official_usage_api' },
        { providerId: 'glm', displayName: 'GLM / Z.AI', configured: true, credentialKind: 'raw_authorization', credentialStatus: 'unverified', credentialRef: 'ZAI_CODING_CN_API_KEY', observationSource: 'official_plugin_internal_api' },
      ],
      modelCatalogs: [],
      antigravity: null,
      privacy: {},
    },
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    const json = JSON.stringify(runtime.render(settingsComponent, {}))
    assert.ok(json.includes('Configured · no official check'), 'the stored raw key is labelled configured-unverified')
    const connectedBadges = (json.match(/"Connected"/g) ?? []).length
    assert.equal(connectedBadges, 2, 'the oauth provider reads as Connected in its list row and detail head')
    // Honest badge styling: the official-blue badge appears only for the
    // oauth row (background + color strings), never for the raw-key row.
    const officialBadgeMarks = (json.match(/4176e6/g) ?? []).length
    assert.equal(officialBadgeMarks, 2, 'the raw-key row must not wear the verified-badge styling')
  } finally {
    harness.runtime.unmountAll()
    restore()
  }
})

// AC-001 variant 2: even when a payload predates the producer marking (no
// credentialStatus), the shared badge derives the unverified verdict from
// credentialKind — a stored raw key can never render as Connected.
test('settings: a raw_authorization key stays configured-unverified even without the producer marking', async () => {
  const harness = createSettingsHarness({
    connections: {
      adapters: [],
      connections: [
        { providerId: 'openai-codex', displayName: 'OpenAI Codex (ChatGPT subscription)', configured: true, credentialKind: 'oauth', credentialRef: 'OPENAI_CODEX_OAUTH', observationSource: 'official_usage_api' },
        { providerId: 'glm', displayName: 'GLM / Z.AI', configured: true, credentialKind: 'raw_authorization', credentialRef: 'ZAI_CODING_CN_API_KEY', observationSource: 'official_plugin_internal_api' },
      ],
      modelCatalogs: [],
      antigravity: null,
      privacy: {},
    },
  })
  const restore = installClientGlobals(harness)
  try {
    const { runtime, settingsComponent } = harness
    runtime.render(settingsComponent, {})
    await flushMicrotasks()
    const json = JSON.stringify(runtime.render(settingsComponent, {}))
    assert.ok(json.includes('Configured · no official check'), 'the raw key is labelled configured-unverified')
    const connectedBadges = (json.match(/"Connected"/g) ?? []).length
    assert.equal(connectedBadges, 2, 'the oauth provider reads as Connected in its list row and detail head')
    assert.equal((json.match(/4176e6/g) ?? []).length, 2, 'the raw-key row must not wear the verified-badge styling')
  } finally {
    harness.runtime.unmountAll()
    restore()
  }
})
