/**
 * Browser half of dsh-token-usage: a sidebar usage entry with an optional
 * today summary, and a full-frame overlay dashboard (overview, requests,
 * sessions, models, providers, pricing, data, settings). All data comes from
 * the host over the loopback-only /token-usage channel; the client never
 * touches the network and never sees conversation content.
 */

window.__ModuleLoader__.load({
  id: 'dsh-token-usage',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const CHANNEL = '/token-usage'
    const NS = 'dsh-token-usage'

    const en = {
      nav: 'Usage',
      title: 'Token usage',
      close: 'Close (Esc)',
      tabOverview: 'Overview',
      tabRequests: 'Requests',
      tabSessions: 'Sessions',
      tabModels: 'Models',
      tabProviders: 'Providers',
      tabPricing: 'Pricing',
      tabData: 'Data',
      tabSettings: 'Settings',
      processedTokens: 'Processed tokens',
      newCompute: 'new compute',
      inclEstimates: 'including estimates',
      estimatedCost: 'Estimated cost (public list price)',
      requests: 'Requests',
      failed: 'failed',
      currentStreak: 'Current streak',
      longestStreak: 'Longest streak',
      days: 'days',
      today: 'Today',
      heatmap: 'Activity (last 12 months)',
      rankings: 'Rankings',
      byProject: 'Projects',
      byModel: 'Models',
      byProvider: 'Providers',
      rankByTokens: 'Tokens',
      rankByCost: 'Cost',
      rankByRequests: 'Requests',
      estimatedShare: 'Estimated share',
      costCoverage: 'Price coverage',
      loadFailed: 'Usage data is unavailable.',
      retry: 'Retry',
      loading: 'Loading…',
      empty: 'No usage recorded yet.',
      colTime: 'Time',
      colProject: 'Project',
      colModel: 'Model',
      colProvider: 'Provider',
      colTokens: 'Tokens',
      colCost: 'Cost (est.)',
      colStatus: 'Status',
      statusOk: 'reported',
      statusEstimated: 'estimated',
      statusFailed: 'failed',
      statusUnknown: 'unknown',
      importTitle: 'History import',
      importIdle: 'Idle',
      importRunning: 'Importing',
      importDone: 'sessions scanned',
      importErrors: 'errors',
      rescan: 'Rescan',
      fullRescan: 'Full rescan',
      pause: 'Pause',
      resume: 'Resume',
      cancel: 'Cancel',
      exportCsv: 'Export requests (CSV)',
      exportJson: 'Export report (JSON)',
      backup: 'Create backup',
      backupCreated: 'Backup written',
      restoreTitle: 'Restore backup',
      restorePath: 'Backup path',
      restoreMerge: 'Merge',
      restoreReplace: 'Replace',
      restore: 'Restore',
      purgeTitle: 'Retention',
      purgeIntro: 'Delete request details older than this many days (day-level totals are kept):',
      purge: 'Purge now',
      purged: 'requests deleted',
      identity: 'Profile',
      displayName: 'Display name',
      accountName: 'Account name',
      avatar: 'Avatar (local image)',
      timezone: 'Timezone (IANA, empty = system)',
      cnyRate: 'CNY per USD (fixed display rate)',
      sidebarSummary: 'Sidebar summary',
      sidebarTokens: 'Today tokens',
      sidebarCost: 'Today cost',
      sidebarHidden: 'Hidden',
      save: 'Save',
      saved: 'Saved',
      aliases: 'Model aliases',
      aliasIntro: 'Map a raw model name to a canonical one for aggregation and current pricing.',
      aliasModel: 'Raw model',
      aliasCanonical: 'Canonical model',
      addAlias: 'Add alias',
      overrides: 'Custom prices (nano-USD per token)',
      overrideModel: 'Model',
      overrideInput: 'Input',
      overrideOutput: 'Output',
      addOverride: 'Add price',
      multipliers: 'Provider multipliers (basis points, 10000 = ×1)',
      multiplierProvider: 'Provider',
      multiplierBps: 'Multiplier',
      addMultiplier: 'Add multiplier',
      priceSnapshot: 'Price snapshot',
      priceModels: 'models',
      priceRefresh: 'Update from LiteLLM',
      priceRefreshIntro: 'Network access happens only when you click preview. Review matches before applying.',
      pricePreview: 'Preview update',
      priceApply: 'Apply update',
      priceFetched: 'catalog models fetched',
      priceMatched: 'observed models matched',
      priceApplied: 'Price update applied.',
      selectObservedModel: 'Select observed model',
      selectCatalogModel: 'Select catalog model',
      selectProvider: 'Select provider',
      useCandidate: 'Use candidate',
      searchObservedModel: 'Search observed models…',
      searchCatalogModel: 'Search price catalog…',
      filteredOptions: '{shown} of {total} options',
      sessionDetail: 'Session detail',
      direct: 'Direct',
      inclChildren: 'Including subagent sessions',
      inherited: 'Inherited context (fork seed, not billed again)',
      sourceDeleted: 'source deleted',
      inheritedShort: 'fork',
      subagent: 'subagent',
      prev: 'Previous',
      next: 'Next',
    }

    const zh = {
      nav: '用量',
      title: 'Token 用量',
      close: '关闭 (Esc)',
      tabOverview: '概览',
      tabRequests: '请求',
      tabSessions: '会话',
      tabModels: '模型',
      tabProviders: '提供方',
      tabPricing: '定价',
      tabData: '数据',
      tabSettings: '设置',
      processedTokens: '处理 Token',
      newCompute: '新计算',
      inclEstimates: '含估算',
      estimatedCost: '估算费用（公开标价）',
      requests: '请求数',
      failed: '失败',
      currentStreak: '连续活跃',
      longestStreak: '最长连续',
      days: '天',
      today: '今日',
      heatmap: '活动（近 12 个月）',
      rankings: '排行',
      byProject: '项目',
      byModel: '模型',
      byProvider: '提供方',
      rankByTokens: 'Token',
      rankByCost: '费用',
      rankByRequests: '请求',
      estimatedShare: '估算占比',
      costCoverage: '价格覆盖率',
      loadFailed: '用量数据不可用。',
      retry: '重试',
      loading: '加载中…',
      empty: '还没有任何用量记录。',
      colTime: '时间',
      colProject: '项目',
      colModel: '模型',
      colProvider: '提供方',
      colTokens: 'Token',
      colCost: '费用（估）',
      colStatus: '状态',
      statusOk: '已上报',
      statusEstimated: '估算',
      statusFailed: '失败',
      statusUnknown: '未知',
      importTitle: '历史导入',
      importIdle: '空闲',
      importRunning: '导入中',
      importDone: '个会话已扫描',
      importErrors: '个错误',
      rescan: '增量扫描',
      fullRescan: '全量扫描',
      pause: '暂停',
      resume: '继续',
      cancel: '取消',
      exportCsv: '导出请求 (CSV)',
      exportJson: '导出报告 (JSON)',
      backup: '创建备份',
      backupCreated: '备份已写入',
      restoreTitle: '恢复备份',
      restorePath: '备份路径',
      restoreMerge: '合并',
      restoreReplace: '替换',
      restore: '恢复',
      purgeTitle: '保留期限',
      purgeIntro: '删除超过该天数的请求明细（保留匿名日级合计）：',
      purge: '立即清理',
      purged: '条请求已删除',
      identity: '个人资料',
      displayName: '显示名',
      accountName: '账号名',
      avatar: '头像（本地图片）',
      timezone: '时区（IANA，留空=跟随系统）',
      cnyRate: 'CNY/USD 固定显示汇率',
      sidebarSummary: '侧栏摘要',
      sidebarTokens: '今日 Token',
      sidebarCost: '今日费用',
      sidebarHidden: '隐藏',
      save: '保存',
      saved: '已保存',
      aliases: '模型别名',
      aliasIntro: '把原始模型名映射到标准名，用于聚合与当前计价。',
      aliasModel: '原始模型',
      aliasCanonical: '标准模型',
      addAlias: '添加别名',
      overrides: '自定义价格（nano-USD / token）',
      overrideModel: '模型',
      overrideInput: '输入',
      overrideOutput: '输出',
      addOverride: '添加价格',
      multipliers: '提供方倍率（基点，10000 = ×1）',
      multiplierProvider: '提供方',
      multiplierBps: '倍率',
      addMultiplier: '添加倍率',
      priceSnapshot: '价格快照',
      priceModels: '个模型',
      priceRefresh: '从 LiteLLM 更新',
      priceRefreshIntro: '仅在点击预览时联网；先查看匹配结果，再确认应用。',
      pricePreview: '预览更新',
      priceApply: '应用更新',
      priceFetched: '个价格模型已获取',
      priceMatched: '个已观测模型成功匹配',
      priceApplied: '价格数据已更新。',
      selectObservedModel: '选择已观测模型',
      selectCatalogModel: '选择价格目录模型',
      selectProvider: '选择提供方',
      useCandidate: '使用候选',
      searchObservedModel: '搜索已观测模型…',
      searchCatalogModel: '搜索价格目录…',
      filteredOptions: '显示 {shown} / {total} 项',
      sessionDetail: '会话详情',
      direct: '直接用量',
      inclChildren: '含子会话',
      inherited: '继承上下文（fork 种子，不重复计费）',
      sourceDeleted: '源已删除',
      inheritedShort: 'fork',
      subagent: '子代理',
      prev: '上一页',
      next: '下一页',
    }

    function readLocale(ctx) {
      try {
        return ctx.locale
      } catch {
        return undefined
      }
    }

    function registerCopy(locale) {
      try {
        return locale.register(NS, { zh, en })
      } catch (error) {
        if (!String(error?.message ?? error).includes('already has locale')) throw error
        return () => {}
      }
    }

    // ---------- tiny external store ----------
    function createStore() {
      const state = {
        open: false,
        tab: 'overview',
        error: null,
        overview: null,
        daily: [],
        rankings: { dimension: 'project', rows: [] },
        importStatus: null,
        settingsData: null,
      }
      const listeners = new Set()
      return {
        get state() { return state },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
        update(patch) {
          Object.assign(state, typeof patch === 'function' ? patch(state) : patch)
          for (const listener of listeners) listener()
        },
      }
    }

    function useStore(store) {
      const [, force] = React.useState(0)
      React.useEffect(() => store.subscribe(() => force((n) => n + 1)), [store])
      return store.state
    }

    function useT(locale) {
      return React.useCallback((key, params) => {
        const tag = String(locale?.language ?? locale?.tag ?? locale ?? ((typeof navigator !== 'undefined' ? navigator.language : 'en') || 'en')).toLowerCase()
        const dict = tag.startsWith('zh') ? zh : en
        let text = dict[key] ?? en[key] ?? key
        if (params) {
          for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
        }
        return text
      }, [locale])
    }

    // ---------- formatting ----------
    function fmtTokens(n) {
      if (n === null || n === undefined) return '—'
      if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
      if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
      if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
      return String(n)
    }

    function fmtUsd(nano, cnyRate) {
      if (nano === null || nano === undefined) return '—'
      const usd = nano / 1e9
      const text = usd >= 100 ? usd.toFixed(2) : usd >= 1 ? usd.toFixed(2) : usd.toFixed(4)
      if (cnyRate) return `$${text} ≈ ¥${(usd * cnyRate).toFixed(2)}`
      return `$${text}`
    }

    function pct(value) {
      return `${Math.round((value ?? 0) * 100)}%`
    }

    function shortPath(path) {
      if (!path) return '—'
      const parts = String(path).split('/').filter(Boolean)
      return parts.length ? parts[parts.length - 1] : path
    }

    function shortId(id) {
      return String(id ?? '').slice(0, 8)
    }

    // ---------- styles (DSH alias theme variables; follow light/dark) ----------
    const C = {
      bgBase: 'var(--dsw-alias-bg-base, #fff)',
      bgLayer: 'var(--dsw-alias-bg-layer-1, #fff)',
      bgMuted: 'var(--dsw-alias-bg-multi-select, #f5f6f7)',
      bgHover: 'var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06))',
      bgActive: 'var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, 0.1))',
      accent: 'var(--dsw-alias-state-business-primary, #4176e6)',
      brandFill: 'var(--dsw-alias-button-primary-fill, #0f1115)',
      brandText: 'var(--dsw-alias-label-primary-foreground, #fff)',
      text: 'var(--dsw-alias-label-primary, #0f1115)',
      textSecondary: 'var(--dsw-alias-label-secondary, #61666b)',
      border: 'var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1))',
      borderFaint: 'var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04))',
      error: 'var(--dsw-alias-state-error-primary, #ec1313)',
      skeleton: 'var(--dsw-alias-bg-skeleton, rgba(0, 0, 0, 0.04))',
    }
    const overlayStyle = {
      position: 'absolute', inset: 0, zIndex: 30, pointerEvents: 'auto',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: C.bgBase, color: C.text,
      font: 'inherit',
    }
    const headerStyle = {
      display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px',
      borderBottom: `1px solid ${C.border}`,
    }
    const titleStyle = { fontSize: 16, fontWeight: 600, margin: 0 }
    const tabRowStyle = { display: 'flex', gap: 2, marginLeft: 12, flexWrap: 'wrap' }
    const tabStyle = (active) => ({
      padding: '6px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
      border: 'none',
      background: active ? C.bgActive : 'transparent',
      color: active ? C.text : C.textSecondary,
    })
    const closeStyle = {
      marginLeft: 'auto', border: 'none', background: 'transparent',
      color: C.textSecondary, fontSize: 16, cursor: 'pointer', padding: '4px 10px', borderRadius: 8,
    }
    const contentStyle = { flex: 1, overflow: 'auto', padding: '20px 24px' }
    const cardStyle = {
      border: `1px solid ${C.borderFaint}`, borderRadius: 12,
      padding: '14px 16px', background: C.bgLayer,
    }
    const cardGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }
    const metricLabelStyle = { fontSize: 12, color: C.textSecondary, margin: '0 0 6px' }
    const metricValueStyle = { fontSize: 22, fontWeight: 600, margin: 0 }
    const metricSubStyle = { fontSize: 12, color: C.textSecondary, margin: '4px 0 0' }
    const sectionTitleStyle = { fontSize: 14, fontWeight: 600, margin: '0 0 10px' }
    const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
    const thStyle = { textAlign: 'left', padding: '6px 12px 6px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.textSecondary, fontWeight: 500 }
    const tdStyle = { textAlign: 'left', padding: '7px 12px 7px 0', borderBottom: `1px solid ${C.borderFaint}` }
    const buttonStyle = {
      padding: '6px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
      border: `1px solid ${C.border}`, background: C.bgBase,
      color: C.text,
    }
    const primaryButtonStyle = { ...buttonStyle, background: C.brandFill, borderColor: 'transparent', color: C.brandText }
    const inputStyle = {
      fontSize: 13, padding: '6px 10px', borderRadius: 8,
      border: `1px solid ${C.border}`, background: C.bgBase,
      color: C.text,
    }
    const selectStyle = { ...inputStyle }
    const mutedStyle = { color: C.textSecondary, fontSize: 12, margin: 0 }
    const errorStyle = { color: C.error, fontSize: 13 }
    const badgeStyle = {
      fontSize: 11, padding: '2px 8px', borderRadius: 999,
      background: C.bgMuted, color: C.textSecondary,
    }
    const avatarStyle = (size) => ({
      width: size, height: size, borderRadius: '50%', objectFit: 'cover',
      background: C.bgActive, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: C.text, fontWeight: 600, fontSize: size / 2.4, overflow: 'hidden',
    })
    const identityRowStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '8px 0 16px' }
    const heatCellStyle = (level) => ({
      width: 11, height: 11, borderRadius: 3,
      background: [
        'var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12))',
        'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 25%, transparent)',
        'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 45%, transparent)',
        'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 70%, transparent)',
        'var(--dsw-alias-state-business-primary, #4176e6)',
      ][level] ?? C.skeleton,
    })
    const footerButtonStyle = () => ({
      display: 'flex', alignItems: 'center', gap: 8, width: 'auto',
      padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
      border: 'none', background: 'transparent', color: C.textSecondary, fontSize: 13,
    })

    // ---------- data loading ----------
    async function rpc(ctx, endpoint, payload) {
      const result = await ctx.connection.rpc.call(CHANNEL, endpoint, payload ?? {})
      if (!result.ok) throw new Error(result.error?.message ?? 'request failed')
      return result.value
    }

    function useAsync(fn, deps) {
      const [state, setState] = React.useState({ status: 'loading', value: null, error: null })
      const run = React.useCallback(() => {
        setState({ status: 'loading', value: null, error: null })
        fn().then(
          (value) => setState({ status: 'ready', value, error: null }),
          (error) => setState({ status: 'error', value: null, error }),
        )
      }, deps)
      React.useEffect(() => { run() }, [run])
      return { ...state, reload: run }
    }

    // ---------- shared bits ----------
    function LoadPanel(props) {
      const { status, error, reload, t, children } = props
      if (status === 'loading') return h('p', { style: mutedStyle }, t('loading'))
      if (status === 'error') {
        return h('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
          h('span', { style: errorStyle }, t('loadFailed'), error?.message ? ` (${error.message})` : ''),
          h('button', { type: 'button', style: buttonStyle, onClick: reload }, t('retry')),
        )
      }
      return children
    }

    function rankingRows(rows, metric) {
      const sorted = [...rows]
      sorted.sort((a, b) => {
        if (metric === 'cost') return (b.usdNano ?? 0) - (a.usdNano ?? 0)
        if (metric === 'requests') return b.requests - a.requests
        return b.processingTokens - a.processingTokens
      })
      return sorted
    }

    // ---------- Overview ----------
    function OverviewTab(props) {
      const { ctx, store, t } = props
      const state = useStore(store)
      const overview = useAsync(() => rpc(ctx, 'overview'), [ctx])
      const daily = useAsync(() => rpc(ctx, 'daily', { days: 365 }).then((value) => value.days), [ctx])
      const [dimension, setDimension] = React.useState('project')
      const rankings = useAsync(() => rpc(ctx, 'rankings', { dimension, days: 30 }), [ctx, dimension])
      const data = overview.value

      React.useEffect(() => {
        if (data !== null && data !== undefined && overview.value !== store.state.overview) {
          store.update({ overview: data })
        }
      }, [data, overview.value, store])

      if (overview.status !== 'ready') {
        return h(LoadPanel, { status: overview.status, error: overview.error, reload: overview.reload, t })
      }
      const totals = data.totalsIncludingEstimates
      const identity = data.identity ?? { displayName: '—', initials: '··' }
      return h('div', null,
        h('div', { style: identityRowStyle },
          identity.avatarDataUrl
            ? h('img', { src: identity.avatarDataUrl, alt: '', style: avatarStyle(72) })
            : h('div', { style: avatarStyle(72) }, identity.initials ?? '··'),
          h('div', { style: { fontSize: 20, fontWeight: 600 } }, identity.displayName),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h('span', { style: mutedStyle }, `@${identity.accountName ?? 'local'}`),
            data.profile ? h('span', { style: badgeStyle }, data.profile) : null,
          ),
        ),
        h('div', { style: cardGridStyle },
          h('div', { style: cardStyle },
            h('p', { style: metricLabelStyle }, t('processedTokens')),
            h('p', { style: metricValueStyle }, fmtTokens(totals.processingTokens)),
            h('p', { style: metricSubStyle }, `${t('newCompute')} ${fmtTokens(data.totals.newComputeTokens)} · ${t('inclEstimates')}`),
          ),
          h('div', { style: cardStyle },
            h('p', { style: metricLabelStyle }, t('estimatedCost')),
            h('p', { style: metricValueStyle }, fmtUsd(data.cost.usdNano, data.costCnyRate)),
            h('p', { style: metricSubStyle }, `${t('costCoverage')} ${pct(data.cost.coverage)}`),
          ),
          h('div', { style: cardStyle },
            h('p', { style: metricLabelStyle }, t('requests')),
            h('p', { style: metricValueStyle }, String(data.totals.requests)),
            h('p', { style: metricSubStyle }, `${t('failed')} ${data.totals.failedRequests}`),
          ),
          h('div', { style: cardStyle },
            h('p', { style: metricLabelStyle }, t('currentStreak')),
            h('p', { style: metricValueStyle }, `${data.streaks.current} ${t('days')}`),
          ),
          h('div', { style: cardStyle },
            h('p', { style: metricLabelStyle }, t('longestStreak')),
            h('p', { style: metricValueStyle }, `${data.streaks.longest} ${t('days')}`),
          ),
        ),
        h('div', { style: cardStyle },
          h('p', { style: sectionTitleStyle }, t('heatmap')),
          h(Heatmap, { days: daily.value ?? [], t }),
        ),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 } },
          h('div', { style: cardStyle },
            h('p', { style: sectionTitleStyle }, t('rankings')),
            h('div', { style: { display: 'flex', gap: 6, marginBottom: 10 } },
              ...['project', 'model', 'provider'].map((name) =>
                h('button', { key: name, type: 'button', style: tabStyle(dimension === name), onClick: () => setDimension(name) },
                  t(name === 'project' ? 'byProject' : name === 'model' ? 'byModel' : 'byProvider'))),
            ),
            h('table', { style: tableStyle },
              h('thead', null, h('tr', null,
                h('th', { style: thStyle }, t(dimension === 'project' ? 'colProject' : dimension === 'model' ? 'colModel' : 'colProvider')),
                h('th', { style: thStyle }, t('rankByTokens')),
                h('th', { style: thStyle }, t('rankByRequests')),
              )),
              h('tbody', null,
                ...(rankings.value?.rows ?? []).slice(0, 8).map((row) =>
                  h('tr', { key: row.key },
                    h('td', { style: tdStyle }, dimension === 'project' ? shortPath(row.key) : row.key),
                    h('td', { style: tdStyle }, fmtTokens(row.processingTokens)),
                    h('td', { style: tdStyle }, String(row.requests)),
                  )),
              ),
            ),
          ),
          h('div', { style: cardStyle },
            h('p', { style: sectionTitleStyle }, t('today')),
            h('p', { style: metricValueStyle }, fmtTokens(data.today?.processingTokens ?? 0)),
            h('p', { style: metricSubStyle }, `${t('requests')} ${data.today?.requests ?? 0}`),
            h('p', { style: sectionTitleStyle }, t('estimatedShare')),
            h('p', { style: metricValueStyle }, pct(data.estimatedShare)),
          ),
        ),
      )
    }

    const HEAT_ROWS = 7

    function Heatmap(props) {
      const { days } = props
      if (!days.length) return h('p', { style: mutedStyle }, '—')
      const volumes = days.map((day) => day.processingTokens)
      const sorted = [...volumes].sort((a, b) => a - b)
      const quantile = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] ?? 0
      const thresholds = [quantile(0.25), quantile(0.5), quantile(0.75), quantile(0.92)]
      const cells = []
      // Align the first column to Monday so each column is one calendar week.
      const firstPad = (new Date(days[0].date + 'T00:00:00Z').getUTCDay() + 6) % 7
      for (let pad = 0; pad < firstPad; pad += 1) cells.push(null)
      for (const day of days) {
        let level = 0
        if (day.requests > 0 && day.processingTokens > 0) {
          level = 1
          if (day.processingTokens > thresholds[0]) level = 2
          if (day.processingTokens > thresholds[1]) level = 3
          if (day.processingTokens > thresholds[2] || (thresholds[3] > 0 && day.processingTokens >= thresholds[3])) level = 4
        }
        cells.push(h('div', {
          key: day.date,
          title: `${day.date} · ${fmtTokens(day.processingTokens)} · ${day.requests}`,
          style: heatCellStyle(level),
        }))
      }
      const weeks = []
      for (let index = 0; index < cells.length; index += HEAT_ROWS) {
        weeks.push(h('div', { key: index, style: { display: 'flex', flexDirection: 'column', gap: 2 } }, ...cells.slice(index, index + HEAT_ROWS)))
      }
      return h('div', { style: { display: 'flex', gap: 2, overflowX: 'auto', padding: '4px 0' } }, ...weeks)
    }

    // ---------- Requests ----------
    function RequestsTab(props) {
      const { ctx, t } = props
      const [status, setStatus] = React.useState('')
      const [days, setDays] = React.useState(30)
      const [offset, setOffset] = React.useState(0)
      const page = useAsync(() => rpc(ctx, 'requests', {
        status: status || undefined,
        fromMs: Date.now() - days * 86400000,
        limit: 50, offset,
      }), [ctx, status, days, offset])
      if (page.status !== 'ready') return h(LoadPanel, { status: page.status, error: page.error, reload: page.reload, t })
      const rows = page.value.rows
      if (!rows.length) return h('p', { style: mutedStyle }, t('empty'))
      return h('div', null,
        h('div', { style: { display: 'flex', gap: 8, marginBottom: 12 } },
          h('select', { style: selectStyle, value: status, onChange: (event) => { setStatus(event.target.value); setOffset(0) } },
            h('option', { value: '' }, t('colStatus')),
            h('option', { value: 'ok' }, t('statusOk')),
            h('option', { value: 'estimated' }, t('statusEstimated')),
            h('option', { value: 'failed' }, t('statusFailed')),
          ),
          h('select', { style: selectStyle, value: String(days), onChange: (event) => { setDays(Number(event.target.value)); setOffset(0) } },
            ...[7, 30, 90].map((count) => h('option', { key: count, value: String(count) }, `${count} ${t('days')}`)),
          ),
        ),
        h('table', { style: tableStyle },
          h('thead', null, h('tr', null,
            h('th', { style: thStyle }, t('colTime')),
            h('th', { style: thStyle }, t('colProject')),
            h('th', { style: thStyle }, t('colModel')),
            h('th', { style: thStyle }, t('colTokens')),
            h('th', { style: thStyle }, t('colCost')),
            h('th', { style: thStyle }, t('colStatus')),
          )),
          h('tbody', null, ...rows.map((row) =>
            h('tr', { key: `${row.sessionId}:${row.turn}:${row.step}` },
              h('td', { style: tdStyle }, new Date(row.time).toLocaleString()),
              h('td', { style: tdStyle }, shortPath(row.cwd)),
              h('td', { style: tdStyle }, row.model),
              h('td', { style: tdStyle }, fmtTokens(row.processingTokens)),
              h('td', { style: tdStyle }, (row.currentUsdNano ?? row.originalUsdNano) === null ? '—' : fmtUsd(row.currentUsdNano ?? row.originalUsdNano)),
              h('td', { style: tdStyle }, t(row.status === 'ok' ? 'statusOk' : row.status === 'estimated' ? 'statusEstimated' : row.status === 'failed' ? 'statusFailed' : 'statusUnknown')),
            ))),
        ),
        h('div', { style: { display: 'flex', gap: 8, marginTop: 12 } },
          h('button', { type: 'button', style: buttonStyle, disabled: offset === 0, onClick: () => setOffset(Math.max(0, offset - 50)) }, t('prev')),
          h('button', { type: 'button', style: buttonStyle, disabled: rows.length < 50, onClick: () => setOffset(offset + 50) }, t('next')),
        ),
      )
    }

    // ---------- Sessions ----------
    function SessionsTab(props) {
      const { ctx, t } = props
      const [selected, setSelected] = React.useState(null)
      const list = useAsync(() => rpc(ctx, 'sessions', {}), [ctx])
      const detail = useAsync(
        () => (selected ? rpc(ctx, 'session-detail', { id: selected }) : Promise.resolve(null)),
        [ctx, selected],
      )
      if (list.status !== 'ready') return h(LoadPanel, { status: list.status, error: list.error, reload: list.reload, t })
      return h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(280px, 380px)', gap: 16 } },
        h('table', { style: tableStyle },
          h('thead', null, h('tr', null,
            h('th', { style: thStyle }, 'ID'),
            h('th', { style: thStyle }, t('colProject')),
            h('th', { style: thStyle }, t('colTokens')),
            h('th', { style: thStyle }, ''),
          )),
          h('tbody', null, ...list.value.rows.map((row) =>
            h('tr', { key: row.id, onClick: () => setSelected(row.id), style: { cursor: 'pointer' } },
              h('td', { style: tdStyle }, shortId(row.id)),
              h('td', { style: tdStyle }, shortPath(row.cwd)),
              h('td', { style: tdStyle }, fmtTokens(row.processingTokens)),
              h('td', { style: tdStyle },
                row.sourceDeleted ? h('span', { style: badgeStyle }, t('sourceDeleted')) : null,
                row.origin === 'subagent' ? h('span', { style: badgeStyle }, t('subagent')) : null,
                row.seedLength ? h('span', { style: badgeStyle }, t('inheritedShort')) : null,
              ),
            ))),
        ),
        selected
          ? h('div', { style: cardStyle },
              h('p', { style: sectionTitleStyle }, `${t('sessionDetail')} ${shortId(selected)}`),
              detail.status !== 'ready' || detail.value === null
                ? h('p', { style: mutedStyle }, t('loading'))
                : h('div', null,
                    h('p', { style: metricSubStyle }, `${t('direct')}: ${fmtTokens(detail.value.direct.processingTokens)}`),
                    h('p', { style: metricSubStyle }, `${t('inclChildren')}: ${fmtTokens(detail.value.includingChildren.processingTokens)}`),
                    h('p', { style: metricSubStyle }, `${t('inherited')}: ${fmtTokens(detail.value.inheritedTotals.processingTokens)}`),
                  ),
            )
          : h('div', { style: cardStyle }, h('p', { style: mutedStyle }, t('sessionDetail'))),
      )
    }

    // ---------- Rankings (models / providers) ----------
    function RankingsTab(props) {
      const { ctx, t, dimension } = props
      const rankings = useAsync(() => rpc(ctx, 'rankings', { dimension, days: 90 }), [ctx, dimension])
      if (rankings.status !== 'ready') return h(LoadPanel, { status: rankings.status, error: rankings.error, reload: rankings.reload, t })
      const rows = rankingRows(rankings.value.rows, 'tokens')
      if (!rows.length) return h('p', { style: mutedStyle }, t('empty'))
      return h('table', { style: tableStyle },
        h('thead', null, h('tr', null,
          h('th', { style: thStyle }, t(dimension === 'model' ? 'colModel' : 'colProvider')),
          h('th', { style: thStyle }, t('rankByTokens')),
          h('th', { style: thStyle }, t('rankByRequests')),
        )),
        h('tbody', null, ...rows.map((row) =>
          h('tr', { key: row.key },
            h('td', { style: tdStyle }, row.key),
            h('td', { style: tdStyle }, fmtTokens(row.processingTokens)),
            h('td', { style: tdStyle }, String(row.requests)),
          ))),
      )
    }

    // ---------- Pricing ----------
    function SearchableSelect(props) {
      const { items, value, onChange, query, onQuery, searchPlaceholder, selectPlaceholder, name, t } = props
      const needle = query.trim().toLowerCase()
      let filtered = needle
        ? items.filter((item) => item.toLowerCase().includes(needle)).slice(0, 300)
        : items.slice(0, 300)
      if (value && !filtered.includes(value)) filtered = [value, ...filtered]
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 180, flex: 1 } },
        h('input', {
          type: 'search', name: `${name}-search`, style: inputStyle,
          placeholder: searchPlaceholder, value: query,
          onChange: (event) => onQuery(event.target.value),
        }),
        h('select', {
          name, style: selectStyle, value,
          onChange: (event) => onChange(event.target.value),
        },
          h('option', { value: '' }, selectPlaceholder),
          ...filtered.map((item) => h('option', { key: item, value: item }, item)),
        ),
        h('span', { style: mutedStyle }, t('filteredOptions', { shown: filtered.length, total: items.length })),
      )
    }

    function PricingTab(props) {
      const { ctx, t } = props
      const settings = useAsync(() => rpc(ctx, 'settings'), [ctx])
      const catalog = useAsync(() => rpc(ctx, 'price-catalog'), [ctx])
      const [aliasModel, setAliasModel] = React.useState('')
      const [aliasCanonical, setAliasCanonical] = React.useState('')
      const [aliasModelQuery, setAliasModelQuery] = React.useState('')
      const [aliasTargetQuery, setAliasTargetQuery] = React.useState('')
      const [overrideModel, setOverrideModel] = React.useState('')
      const [overrideQuery, setOverrideQuery] = React.useState('')
      const [overrideInput, setOverrideInput] = React.useState('')
      const [overrideOutput, setOverrideOutput] = React.useState('')
      const [multiplierProvider, setMultiplierProvider] = React.useState('')
      const [multiplierBps, setMultiplierBps] = React.useState('')
      const [pricePreview, setPricePreview] = React.useState(null)
      const [priceMessage, setPriceMessage] = React.useState(null)
      const [priceError, setPriceError] = React.useState(null)
      const [priceBusy, setPriceBusy] = React.useState(false)
      if (settings.status !== 'ready' || catalog.status !== 'ready') {
        const pending = settings.status !== 'ready' ? settings : catalog
        return h(LoadPanel, { status: pending.status, error: pending.error, reload: pending.reload, t })
      }
      const snapshot = settings.value.priceSnapshot ?? { models: [], updatedModels: [] }
      const observed = catalog.value.observed ?? []
      const observedModels = [...new Set(observed.map((row) => row.model))]
      const previewCandidates = (pricePreview?.mappings ?? []).flatMap((row) => row.candidates ?? [])
      const targetModels = [...new Set([...(catalog.value.updated ?? []), ...(catalog.value.bundled ?? []), ...previewCandidates, ...observedModels])].sort()
      const providers = [...new Set(observed.map((row) => row.provider).filter(Boolean))].sort()
      const submit = (endpoint, payload, reset) => {
        void rpc(ctx, endpoint, payload).then(() => { reset(); settings.reload(); catalog.reload() }).catch((error) => setPriceError(error.message))
      }
      const preview = () => {
        setPriceBusy(true); setPriceError(null); setPriceMessage(null)
        void rpc(ctx, 'price-refresh-preview').then(setPricePreview).catch((error) => setPriceError(error.message)).finally(() => setPriceBusy(false))
      }
      const applyPrices = () => {
        setPriceBusy(true); setPriceError(null)
        void rpc(ctx, 'price-refresh-apply').then(() => {
          setPriceMessage(t('priceApplied')); setPricePreview(null); settings.reload(); catalog.reload()
        }).catch((error) => setPriceError(error.message)).finally(() => setPriceBusy(false))
      }
      const options = (items) => items.map((item) => h('option', { key: item, value: item }, item))
      return h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } },
        h('div', { style: cardStyle },
          h('p', { style: sectionTitleStyle }, `${t('priceSnapshot')} v${snapshot.version ?? '—'} (${snapshot.source ?? '—'})`),
          h('p', { style: mutedStyle }, `${snapshot.models.length} ${t('priceModels')} · ${(snapshot.updatedModels ?? []).length} upstream`),
          h('p', { style: { ...sectionTitleStyle, marginTop: 14 } }, t('priceRefresh')),
          h('p', { style: mutedStyle }, t('priceRefreshIntro')),
          h('button', { type: 'button', style: primaryButtonStyle, disabled: priceBusy, onClick: preview }, priceBusy ? t('loading') : t('pricePreview')),
          pricePreview ? h('div', { style: { marginTop: 10 } },
            h('p', { style: mutedStyle }, `${pricePreview.fetched} ${t('priceFetched')} · ${pricePreview.matchedObserved}/${pricePreview.observed} ${t('priceMatched')}`),
            h('table', { style: { ...tableStyle, marginTop: 6 } }, h('tbody', null,
              ...(pricePreview.mappings ?? []).slice(0, 8).map((row) => h('tr', { key: `${row.provider}:${row.model}` },
                h('td', { style: tdStyle }, row.model),
                h('td', { style: tdStyle }, row.matched
                  ? `→ ${row.matched}`
                  : row.candidates?.length
                    ? h('button', {
                        type: 'button',
                        style: tabStyle(false),
                        title: t('useCandidate'),
                        onClick: () => {
                          setAliasModel(row.model)
                          setAliasCanonical(row.candidates[0])
                          setAliasModelQuery(row.model)
                          setAliasTargetQuery(row.candidates[0])
                        },
                      }, `→ ${row.candidates[0]}`)
                    : '—'),
              )),
            )),
            h('button', { type: 'button', style: primaryButtonStyle, disabled: priceBusy, onClick: applyPrices }, t('priceApply')),
          ) : null,
          priceMessage ? h('p', { style: mutedStyle }, priceMessage) : null,
          priceError ? h('p', { style: errorStyle }, priceError) : null,
        ),
        h('div', { style: cardStyle },
          h('p', { style: sectionTitleStyle }, t('aliases')),
          h('p', { style: mutedStyle }, t('aliasIntro')),
          h('table', { style: { ...tableStyle, marginTop: 8 } },
            h('tbody', null, ...(settings.value.aliases ?? []).map((row) =>
              h('tr', { key: row.model_raw },
                h('td', { style: tdStyle }, row.model_raw),
                h('td', { style: tdStyle }, `→ ${row.canonical}`),
              ))),
          ),
          h('div', { style: { display: 'flex', gap: 6, marginTop: 8, alignItems: 'flex-start', flexWrap: 'wrap' } },
            h(SearchableSelect, {
              name: 'alias-observed-model', items: observedModels,
              value: aliasModel, onChange: setAliasModel,
              query: aliasModelQuery, onQuery: setAliasModelQuery,
              searchPlaceholder: t('searchObservedModel'), selectPlaceholder: t('selectObservedModel'), t,
            }),
            h(SearchableSelect, {
              name: 'alias-catalog-model', items: targetModels,
              value: aliasCanonical, onChange: setAliasCanonical,
              query: aliasTargetQuery, onQuery: setAliasTargetQuery,
              searchPlaceholder: t('searchCatalogModel'), selectPlaceholder: t('selectCatalogModel'), t,
            }),
            h('button', {
              type: 'button', style: primaryButtonStyle,
              onClick: () => aliasModel && aliasCanonical && submit('set-alias', { model: aliasModel, canonical: aliasCanonical }, () => {
                setAliasModel(''); setAliasCanonical(''); setAliasModelQuery(''); setAliasTargetQuery('')
              }),
            }, t('addAlias')),
          ),
        ),
        h('div', { style: cardStyle },
          h('p', { style: sectionTitleStyle }, t('overrides')),
          h('div', { style: { display: 'flex', gap: 6, marginTop: 8, alignItems: 'flex-start', flexWrap: 'wrap' } },
            h(SearchableSelect, {
              name: 'override-model', items: targetModels,
              value: overrideModel, onChange: setOverrideModel,
              query: overrideQuery, onQuery: setOverrideQuery,
              searchPlaceholder: t('searchCatalogModel'), selectPlaceholder: t('selectCatalogModel'), t,
            }),
            h('input', { name: 'override-input-price', style: inputStyle, placeholder: t('overrideInput'), inputMode: 'numeric', value: overrideInput, onChange: (event) => setOverrideInput(event.target.value) }),
            h('input', { name: 'override-output-price', style: inputStyle, placeholder: t('overrideOutput'), inputMode: 'numeric', value: overrideOutput, onChange: (event) => setOverrideOutput(event.target.value) }),
            h('button', { type: 'button', style: primaryButtonStyle, onClick: () => overrideModel && overrideInput && overrideOutput && submit('set-override', { model: overrideModel, inputNano: Number(overrideInput), outputNano: Number(overrideOutput) }, () => { setOverrideModel(''); setOverrideInput(''); setOverrideOutput(''); setOverrideQuery('') }) }, t('addOverride')),
          ),
        ),
        h('div', { style: cardStyle },
          h('p', { style: sectionTitleStyle }, t('multipliers')),
          h('div', { style: { display: 'flex', gap: 6, marginTop: 8 } },
            h('select', { style: selectStyle, value: multiplierProvider, onChange: (event) => setMultiplierProvider(event.target.value) },
              h('option', { value: '' }, t('selectProvider')), ...options(providers)),
            h('input', { style: inputStyle, placeholder: t('multiplierBps'), inputMode: 'numeric', value: multiplierBps, onChange: (event) => setMultiplierBps(event.target.value) }),
            h('button', { type: 'button', style: primaryButtonStyle, onClick: () => multiplierProvider && multiplierBps && submit('set-multiplier', { provider: multiplierProvider, bps: Number(multiplierBps) }, () => { setMultiplierProvider(''); setMultiplierBps('') }) }, t('addMultiplier')),
          ),
        ),
      )
    }

    // ---------- Data ----------
    function DataTab(props) {
      const { ctx, t } = props
      const [status, setStatus] = React.useState(null)
      const [backupPath, setBackupPath] = React.useState(null)
      const [restorePath, setRestorePath] = React.useState('')
      const [purgeDays, setPurgeDays] = React.useState('')
      const refresh = React.useCallback(() => { void rpc(ctx, 'import-status').then(setStatus).catch(() => {}) }, [ctx])
      React.useEffect(() => {
        refresh()
        const timer = setInterval(refresh, 3000)
        return () => clearInterval(timer)
      }, [refresh])
      const control = (action, extra) => { void rpc(ctx, 'import-control', { action, ...extra }).then(setStatus).catch(() => {}) }
      const download = (payload) => {
        void rpc(ctx, 'export', payload).then((file) => {
          const blob = new Blob([file.content], { type: file.mime })
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = file.filename
          anchor.click()
          URL.revokeObjectURL(url)
        }).catch(() => {})
      }
      const importRunning = status?.running === true
      return h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } },
        h('div', { style: cardStyle },
          h('p', { style: sectionTitleStyle }, t('importTitle')),
          h('p', { style: mutedStyle }, status === null
            ? t('loading')
            : importRunning
              ? `${t('importRunning')} · ${status.done}/${status.total} ${t('importDone')}${status.errors ? ` · ${status.errors} ${t('importErrors')}` : ''}`
              : `${t('importIdle')} · ${status.total ?? 0} ${t('importDone')}${status.errors ? ` · ${status.errors} ${t('importErrors')}` : ''}`),
          status?.lastError ? h('p', { style: { ...errorStyle, marginTop: 6, wordBreak: 'break-all' } }, status.lastError) : null,
          h('div', { style: { display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' } },
            h('button', { type: 'button', style: buttonStyle, onClick: () => control('scan', { full: false }) }, t('rescan')),
            h('button', { type: 'button', style: buttonStyle, onClick: () => control('scan', { full: true }) }, t('fullRescan')),
            importRunning
              ? h('button', { type: 'button', style: buttonStyle, onClick: () => control('pause') }, t('pause'))
              : null,
            importRunning
              ? h('button', { type: 'button', style: buttonStyle, onClick: () => control('cancel') }, t('cancel'))
              : null,
          ),
        ),
        h('div', { style: cardStyle },
          h('p', { style: sectionTitleStyle }, t('exportCsv') + ' / ' + t('exportJson')),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('button', { type: 'button', style: buttonStyle, onClick: () => download({ kind: 'requests-csv' }) }, t('exportCsv')),
            h('button', { type: 'button', style: buttonStyle, onClick: () => download({ kind: 'report-json' }) }, t('exportJson')),
          ),
        ),
        h('div', { style: cardStyle },
          h('p', { style: sectionTitleStyle }, t('backup')),
          h('button', { type: 'button', style: primaryButtonStyle, onClick: () => { void rpc(ctx, 'backup').then((value) => setBackupPath(value.path)).catch(() => {}) } }, t('backup')),
          backupPath ? h('p', { style: { ...mutedStyle, marginTop: 8 } }, `${t('backupCreated')}: ${backupPath}`) : null,
          h('p', { style: { ...sectionTitleStyle, marginTop: 14 } }, t('restoreTitle')),
          h('div', { style: { display: 'flex', gap: 6 } },
            h('input', { style: { ...inputStyle, flex: 1 }, placeholder: t('restorePath'), value: restorePath, onChange: (event) => setRestorePath(event.target.value) }),
            h('button', { type: 'button', style: buttonStyle, onClick: () => restorePath && void rpc(ctx, 'restore', { path: restorePath, mode: 'merge' }).catch(() => {}) }, t('restoreMerge')),
            h('button', { type: 'button', style: buttonStyle, onClick: () => restorePath && void rpc(ctx, 'restore', { path: restorePath, mode: 'replace' }).catch(() => {}) }, t('restoreReplace')),
          ),
        ),
        h('div', { style: cardStyle },
          h('p', { style: sectionTitleStyle }, t('purgeTitle')),
          h('p', { style: mutedStyle }, t('purgeIntro')),
          h('div', { style: { display: 'flex', gap: 6, marginTop: 8 } },
            h('input', { style: inputStyle, placeholder: '365', value: purgeDays, onChange: (event) => setPurgeDays(event.target.value) }),
            h('button', { type: 'button', style: buttonStyle, onClick: () => purgeDays && void rpc(ctx, 'purge', { days: Number(purgeDays) }).catch(() => {}) }, t('purge')),
          ),
        ),
      )
    }

    // ---------- Settings ----------
    function SettingsTab(props) {
      const { ctx, t } = props
      const settings = useAsync(() => rpc(ctx, 'settings'), [ctx])
      const [saved, setSaved] = React.useState(false)
      if (settings.status !== 'ready') return h(LoadPanel, { status: settings.status, error: settings.error, reload: settings.reload, t })
      const current = settings.value.settings ?? {}
      const save = (key, value) => {
        void rpc(ctx, 'set-setting', { key, value }).then(() => {
          setSaved(true)
          setTimeout(() => setSaved(false), 1200)
          settings.reload()
        }).catch(() => {})
      }
      const field = (key, label, type = 'text') => h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 } },
        label,
        h('input', {
          style: inputStyle, type, value: current[key] ?? '',
          onChange: () => {}, onBlur: (event) => event.target.value !== (current[key] ?? '') && save(key, event.target.value || null),
        }),
      )
      return h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } },
        h('div', { style: cardStyle },
          h('p', { style: sectionTitleStyle }, t('identity')),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            field('displayName', t('displayName')),
            field('accountName', t('accountName')),
            h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 } },
              t('avatar'),
              h('input', {
                style: inputStyle, type: 'file', accept: 'image/png,image/jpeg,image/webp',
                onChange: (event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = () => save('avatarDataUrl', String(reader.result))
                  reader.readAsDataURL(file)
                },
              }),
            ),
            saved ? h('span', { style: mutedStyle }, t('saved')) : null,
          ),
        ),
        h('div', { style: cardStyle },
          h('p', { style: sectionTitleStyle }, t('tabSettings')),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            field('timezone', t('timezone')),
            field('cnyRate', t('cnyRate'), 'number'),
            h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 } },
              t('sidebarSummary'),
              h('select', {
                style: selectStyle, value: current.sidebarSummary ?? 'tokens',
                onChange: (event) => save('sidebarSummary', event.target.value),
              },
                h('option', { value: 'tokens' }, t('sidebarTokens')),
                h('option', { value: 'cost' }, t('sidebarCost')),
                h('option', { value: 'hidden' }, t('sidebarHidden')),
              ),
            ),
          ),
        ),
      )
    }

    // ---------- Overlay shell ----------
    const TABS = [
      ['overview', 'tabOverview'],
      ['requests', 'tabRequests'],
      ['sessions', 'tabSessions'],
      ['models', 'tabModels'],
      ['providers', 'tabProviders'],
      ['pricing', 'tabPricing'],
      ['data', 'tabData'],
      ['settings', 'tabSettings'],
    ]

    function Overlay(props) {
      const { ctx, store, locale, t } = props
      const state = useStore(store)
      React.useEffect(() => {
        if (!state.open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') store.update({ open: false })
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [state.open, store])

      if (!state.open) return null
      const tab = state.tab
      return h('div', { style: overlayStyle, role: 'dialog', 'aria-label': t('title') },
        h('div', { style: headerStyle },
          h('p', { style: titleStyle }, t('title')),
          h('div', { style: tabRowStyle },
            ...TABS.map(([name, key]) =>
              h('button', { key: name, type: 'button', style: tabStyle(tab === name), onClick: () => store.update({ tab: name }) }, t(key))),
          ),
          h('button', { type: 'button', style: closeStyle, onClick: () => store.update({ open: false }), 'aria-label': t('close') }, '✕'),
        ),
        h('div', { style: contentStyle },
          tab === 'overview' ? h(OverviewTab, { ctx, store, locale, t }) : null,
          tab === 'requests' ? h(RequestsTab, { ctx, t }) : null,
          tab === 'sessions' ? h(SessionsTab, { ctx, t }) : null,
          tab === 'models' ? h(RankingsTab, { ctx, t, dimension: 'model' }) : null,
          tab === 'providers' ? h(RankingsTab, { ctx, t, dimension: 'provider' }) : null,
          tab === 'pricing' ? h(PricingTab, { ctx, t }) : null,
          tab === 'data' ? h(DataTab, { ctx, t }) : null,
          tab === 'settings' ? h(SettingsTab, { ctx, t }) : null,
        ),
      )
    }

    // ---------- Sidebar entry ----------
    function SidebarEntry(props) {
      const { ctx, store, t } = props
      const state = useStore(store)
      const wide = props?.wide === true
      const summary = state.overview?.today
      const mode = store.state.settingsData?.sidebarSummary
      React.useEffect(() => {
        void rpc(ctx, 'overview').then((data) => store.update({ overview: data })).catch(() => {})
        void rpc(ctx, 'settings').then((data) => store.update({ settingsData: data.settings })).catch(() => {})
      }, [ctx, store])
      return h('button', {
        type: 'button',
        style: footerButtonStyle(wide),
        'aria-label': t('nav'),
        title: t('nav'),
        onClick: () => store.update({ open: true }),
      },
        h(UsageGlyph),
        wide ? h('span', null, summaryLabel(mode, summary, t)) : null,
      )
    }

    function summaryLabel(mode, today, t) {
      if (mode === 'hidden') return t('nav')
      if (!today) return t('nav')
      if (mode === 'cost') return fmtUsd(today.costUsdNano ?? null)
      return `${t('today')} ${fmtTokens(today.processingTokens ?? 0)}`
    }

    function UsageGlyph() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true },
        h('rect', { x: 1.5, y: 7, width: 3, height: 7, rx: 1, fill: 'currentColor' }),
        h('rect', { x: 6.5, y: 3.5, width: 3, height: 10.5, rx: 1, fill: 'currentColor' }),
        h('rect', { x: 11.5, y: 1, width: 3, height: 13, rx: 1, fill: 'currentColor' }),
      )
    }

    const inject = ['slots', 'connection']

    function apply(ctx) {
      try {
        const store = createStore()
        const locale = readLocale(ctx)
        if (locale !== undefined && typeof locale.register === 'function') {
          if (typeof ctx.effect === 'function') ctx.effect(() => registerCopy(locale), 'dsh-token-usage: copy dictionaries')
          else registerCopy(locale)
        }
        const t = locale !== undefined && typeof locale.bind === 'function' ? locale.bind(NS) : (key, params) => {
          const zhUi = String((typeof navigator !== 'undefined' && navigator.language) || 'en').toLowerCase().startsWith('zh')
          let text = (zhUi ? zh[key] : undefined) ?? en[key] ?? key
          if (params) {
            for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
          }
          return text
        }

        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'token-usage',
          order: 6,
          label: () => t('nav'),
        }, (props) => h(SidebarEntry, { ...props, ctx, store, locale, t })))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-token-usage-dashboard',
          order: 1,
        }, (props) => h(Overlay, { ...props, ctx, store, locale, t })))
      } catch (error) {
        console.error('[dsh-token-usage] apply failed:', error)
      }
    }

    return { apply, inject }
  },
})
