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

test('credential writes mirror the DSH Web high-level facade contract', () => {
  assert.match(source, /credentials\.set\(\{ ref, value \}\)/)
  assert.match(source, /credentials\.describe\(\{ refs: \[ref\] \}\)/)
  assert.match(source, /response\?\.result\?\.ok/)
  assert.match(source, /describe\.result\.value\.credentials/)
  assert.ok(!source.includes('credentialRequest('), 'the facade must not receive a nested RpcRequest')
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
  const ctx = {
    slots: {
      inject: (name, register) => register(),
      register: (definition, component) => { registrations.push({ definition, component }); return () => {} },
    },
    connection: { rpc: { call }, api: { credentials: { set: async () => ({ result: { ok: true } }) } } },
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
    open: () => {},
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
