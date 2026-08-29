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
      spaceOverview: 'Overview', spaceExplore: 'Explore', spaceCost: 'Cost & Budget', spaceData: 'Data & Settings',
      scope: 'Scope', reportedOnly: 'Reported only', includeEstimates: 'Including estimates', comparePrevious: 'Compare previous period',
      metricProcessing: 'Processing tokens', metricNewCompute: 'New-compute tokens', metricCost: 'Current-rule cost', metricRequests: 'Requests',
      insights: 'Deterministic findings', trend: 'Trend', composition: 'Token composition', activityRhythm: 'Activity rhythm',
      inspect: 'Open details', slice: 'Only this', sessions: 'Sessions', requestStream: 'Request stream', refresh: 'Refresh',
      costTrust: 'Cost trust', budgets: 'Monthly budgets', forecastWithheld: 'Forecast withheld', noFindings: 'No material deterministic findings in this scope.',
      filters: 'Filters', clearFilters: 'Reset', saveView: 'Save view', savedViews: 'Saved views', currentRules: 'current rules', originalValue: 'original',
      sessionNeutral: 'Session', drawerClose: 'Close inspector', back: 'Back', reportedBadge: 'reported', estimatedBadge: 'estimated', failedBadge: 'failed',
      dataPricing: 'Pricing', dataImport: 'Import & data', dataProfile: 'Profile', unnamedView: 'Named view', viewLimit: 'Up to 8 views',
      createBudget: 'Create / update budget', budgetLimit: 'Limit', scopeId: 'Scope ID', excludeRequest: 'Exclude request', applyCorrection: 'Apply correction', undoCorrection: 'Undo correction', correctionNote: 'Audit note', correctionAudit: 'Correction audit', projectsAdmin: 'Projects', projectSources: 'Source paths', renameProject: 'Rename', hideProject: 'Hide',
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
      spaceOverview: '总览', spaceExplore: '探索', spaceCost: '成本与预算', spaceData: '数据与设置',
      scope: '分析范围', reportedOnly: '仅已上报', includeEstimates: '含估算', comparePrevious: '对比上期',
      metricProcessing: '处理 Token', metricNewCompute: '新计算 Token', metricCost: '按当前规则费用', metricRequests: '请求数',
      insights: '确定性洞察', trend: '趋势', composition: 'Token 构成', activityRhythm: '活动节奏',
      inspect: '打开详情', slice: '仅看此项', sessions: '会话', requestStream: '请求流', refresh: '刷新',
      costTrust: '费用可信度', budgets: '自然月预算', forecastWithheld: '暂不提供预测', noFindings: '当前范围没有显著的确定性洞察。',
      filters: '筛选', clearFilters: '重置', saveView: '保存视图', savedViews: '已保存视图', currentRules: '当前规则', originalValue: '原始估值',
      sessionNeutral: '会话', drawerClose: '关闭详情', back: '返回', reportedBadge: '已上报', estimatedBadge: '估算', failedBadge: '失败',
      dataPricing: '定价', dataImport: '导入与数据', dataProfile: '个人设置', unnamedView: '命名视图', viewLimit: '最多 8 个视图',
      createBudget: '新建 / 更新预算', budgetLimit: '额度', scopeId: '范围 ID', excludeRequest: '排除此请求', applyCorrection: '应用修正', undoCorrection: '撤销修正', correctionNote: '审计备注', correctionAudit: '修正审计记录', projectsAdmin: '项目管理', projectSources: '来源路径', renameProject: '重命名', hideProject: '隐藏',
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
        space: 'overview',
        filter: { time: { preset: '30d' }, honesty: 'reported' },
        metric: 'processingTokens',
        compare: true,
        entity: 'session',
        rankingDimension: 'project',
        inspectorStack: [],
        dataSection: 'pricing',
        savedViews: [],
        analysisRevision: 0,
        restored: false,
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
      const { ctx, t, filter } = props
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
            h('button', { type: 'button', style: buttonStyle, onClick: () => download({ kind: 'requests-csv', filter }) }, t('exportCsv')),
            h('button', { type: 'button', style: buttonStyle, onClick: () => download({ kind: 'report-json', filter }) }, t('exportJson')),
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

    // ---------- v2 analytics workbench ----------
    const SPACES = [
      ['overview', 'spaceOverview'],
      ['explore', 'spaceExplore'],
      ['cost', 'spaceCost'],
      ['data', 'spaceData'],
    ]

    function metricValue(measures, metric) {
      if (!measures) return 0
      if (metric === 'cost') return measures.cost?.currentUsdNano ?? measures.currentUsdNano ?? 0
      return Number(measures[metric] ?? 0)
    }

    function metricText(measures, metric) {
      if (metric === 'cost') return fmtUsd(metricValue(measures, metric))
      return fmtTokens(metricValue(measures, metric))
    }

    function metricLabel(t, metric) {
      return t(metric === 'newComputeTokens' ? 'metricNewCompute' : metric === 'cost' ? 'metricCost' : metric === 'requests' ? 'metricRequests' : 'metricProcessing')
    }

    function copyFilter(filter) {
      return JSON.parse(JSON.stringify(filter ?? {}))
    }

    function querySpec(state) {
      const by = state.metric === 'cost' ? 'originalUsdNano' : state.metric
      if (state.space === 'explore') return {
        filter: state.filter,
        views: ['kpis', 'rankings', 'page', 'activity'],
        ranking: { dimension: state.rankingDimension, by, limit: 20 },
        page: { entity: state.entity, limit: 80 },
        compare: state.compare ? { kind: 'previous-period' } : undefined,
      }
      if (state.space === 'cost') return {
        filter: state.filter,
        views: ['kpis', 'series', 'rankings', 'insights', 'budgets'],
        series: { granularity: 'auto' },
        ranking: { dimension: state.rankingDimension, by: 'originalUsdNano', limit: 20 },
        compare: state.compare ? { kind: 'previous-period' } : undefined,
      }
      return {
        filter: state.filter,
        views: ['kpis', 'series', 'rankings', 'insights', 'activity', 'budgets'],
        series: { granularity: 'auto' },
        ranking: { dimension: state.rankingDimension, by, limit: 20 },
        compare: state.compare ? { kind: 'previous-period' } : undefined,
      }
    }

    function useAnalysis(ctx, state) {
      const signature = JSON.stringify({ space: state.space, filter: state.filter, metric: state.metric, compare: state.compare, entity: state.entity, dimension: state.rankingDimension, revision: state.analysisRevision })
      const [box, setBox] = React.useState({ status: 'loading', value: null, error: null })
      const reload = React.useCallback(() => {
        if (!state.open || state.space === 'data') return
        setBox((previous) => ({ ...previous, status: previous.value ? 'refreshing' : 'loading', error: null }))
        void rpc(ctx, 'query', querySpec(state)).then(
          (value) => setBox({ status: 'ready', value, error: null }),
          (error) => setBox((previous) => ({ ...previous, status: 'error', error })),
        )
      }, [ctx, state.open, state.space, signature])
      React.useEffect(() => {
        reload()
        if (!state.open || state.space === 'data') return undefined
        const timer = setInterval(reload, 15_000)
        return () => clearInterval(timer)
      }, [reload, state.open, state.space])
      return { ...box, reload }
    }

    function applyFilterPatch(ctx, store, patch) {
      return rpc(ctx, 'constrain', { filter: store.state.filter, patch }).then((filter) => {
        store.update({ filter })
        return filter
      }).catch((error) => store.update({ error: error.message }))
    }

    function pushInspector(store, kind, id) {
      const ref = { kind, id: String(id) }
      const stack = store.state.inspectorStack ?? []
      if (stack[stack.length - 1]?.kind === ref.kind && stack[stack.length - 1]?.id === ref.id) return
      store.update({ inspectorStack: [...stack, ref] })
    }

    function popInspector(store) {
      const stack = store.state.inspectorStack ?? []
      store.update({ inspectorStack: stack.slice(0, -1) })
    }

    function saveWorkbenchState(ctx, store) {
      const state = store.state
      const value = {
        space: state.space, filter: state.filter, metric: state.metric, compare: state.compare,
        entity: state.entity, rankingDimension: state.rankingDimension, dataSection: state.dataSection,
      }
      void rpc(ctx, 'set-setting', { key: 'v2LastState', value }).catch(() => {})
    }

    function ScopeBar({ ctx, store, state, t }) {
      const dimensions = ['project', 'model', 'provider', 'session', 'status', 'price']
      const chips = []
      for (const dimension of dimensions) {
        for (const value of state.filter[dimension] ?? []) chips.push({ dimension, value })
      }
      const setTime = (preset) => { void applyFilterPatch(ctx, store, { op: 'set-time', time: { preset } }) }
      const setHonesty = (honesty) => store.update({ filter: { ...copyFilter(state.filter), honesty } })
      const resetScope = async () => {
        const filter = await rpc(ctx, 'constrain', { filter: state.filter, patch: { op: 'reset' } })
        store.update({ filter: { ...filter, time: { preset: '30d' }, honesty: 'reported' }, metric: 'processingTokens', compare: true })
      }
      const saveView = () => {
        if ((state.savedViews ?? []).length >= 8) return
        const fallback = `${t('unnamedView')} ${(state.savedViews ?? []).length + 1}`
        const name = typeof window.prompt === 'function' ? window.prompt(t('saveView'), fallback) : fallback
        if (!name) return
        const savedViews = [...(state.savedViews ?? []), { id: `${Date.now()}`, name, state: { filter: copyFilter(state.filter), metric: state.metric, compare: state.compare, space: state.space, rankingDimension: state.rankingDimension } }].slice(0, 8)
        store.update({ savedViews })
        void rpc(ctx, 'set-setting', { key: 'v2SavedViews', value: savedViews }).catch(() => {})
      }
      return h('div', { className: 'tu-scope' },
        h('label', { className: 'tu-field' }, h('span', null, t('scope')),
          h('select', { name: 'time-range', 'aria-label': t('scope'), style: selectStyle, value: state.filter.time?.preset ?? 'custom', onChange: (event) => setTime(event.target.value) },
            state.filter.time?.preset ? null : h('option', { value: 'custom' }, 'custom'), h('option', { value: 'today' }, '1d'), h('option', { value: '7d' }, '7d'), h('option', { value: '30d' }, '30d'), h('option', { value: '90d' }, '90d'), h('option', { value: '12m' }, '12m'), h('option', { value: 'all' }, '∞'))),
        h('label', { className: 'tu-field' }, h('span', null, metricLabel(t, state.metric)),
          h('select', { name: 'primary-metric', 'aria-label': metricLabel(t, state.metric), style: selectStyle, value: state.metric, onChange: (event) => store.update({ metric: event.target.value }) },
            h('option', { value: 'processingTokens' }, t('metricProcessing')),
            h('option', { value: 'newComputeTokens' }, t('metricNewCompute')),
            h('option', { value: 'cost' }, t('metricCost')),
            h('option', { value: 'requests' }, t('metricRequests')))),
        h('label', { className: 'tu-check' }, h('input', { type: 'checkbox', name: 'honesty-toggle', 'aria-label': t('reportedOnly'), checked: state.filter.honesty === 'includingEstimates', onChange: (event) => setHonesty(event.target.checked ? 'includingEstimates' : 'reported') }), t(state.filter.honesty === 'includingEstimates' ? 'includeEstimates' : 'reportedOnly')),
        h('label', { className: 'tu-check' }, h('input', { type: 'checkbox', name: 'compare-toggle', 'aria-label': t('comparePrevious'), checked: state.compare, onChange: (event) => store.update({ compare: event.target.checked }) }), t('comparePrevious')),
        (state.savedViews ?? []).length ? h('select', { name: 'saved-view', 'aria-label': t('savedViews'), style: selectStyle, value: '', onChange: (event) => {
          const view = state.savedViews.find((entry) => entry.id === event.target.value)
          if (view) store.update({ ...view.state, filter: copyFilter(view.state.filter) })
        } }, h('option', { value: '' }, t('savedViews')), ...(state.savedViews ?? []).map((view) => h('option', { key: view.id, value: view.id }, view.name))) : null,
        h('button', { type: 'button', style: buttonStyle, onClick: saveView, title: t('viewLimit') }, t('saveView')),
        h('button', { type: 'button', className: 'tu-reset', onClick: () => { void resetScope() } }, t('clearFilters')),
        chips.length ? h('div', { className: 'tu-chips', 'aria-label': t('filters') }, ...chips.map((chip) => h('button', { key: `${chip.dimension}:${chip.value}`, type: 'button', className: 'tu-chip', onClick: () => { void applyFilterPatch(ctx, store, { op: 'remove', dimension: chip.dimension, key: chip.value }) } }, `${chip.dimension} · ${chip.value} ×`))) : null,
      )
    }

    function Kpis({ data, t }) {
      const kpis = data?.kpis ?? {}
      const delta = kpis.delta ?? {}
      const item = (label, value, change, note) => h('article', { style: cardStyle },
        h('p', { style: metricLabelStyle }, label),
        h('p', { style: metricValueStyle }, value),
        h('p', { style: metricSubStyle }, change === null || change === undefined ? (note ?? '—') : `${change >= 0 ? '↑' : '↓'} ${pct(Math.abs(change))}${note ? ` · ${note}` : ''}`))
      return h('section', { className: 'tu-kpis', 'aria-label': t('spaceOverview') },
        item(t('metricProcessing'), fmtTokens(kpis.processingTokens), delta.processingTokens, `${t('metricNewCompute')} ${fmtTokens(kpis.newComputeTokens)}`),
        item(t('metricNewCompute'), fmtTokens(kpis.newComputeTokens), delta.newComputeTokens, `${t('composition')} ${fmtTokens(kpis.cacheReadTokens)}`),
        item(t('metricCost'), fmtUsd(kpis.cost?.currentUsdNano), null, `${t('costCoverage')} ${pct(kpis.cost?.coverage)}`),
        item(t('metricRequests'), fmtTokens(kpis.requests), delta.requests, `${kpis.failedRequests ?? 0} ${t('failed')}`),
      )
    }

    function insightCopy(insight, t) {
      if (insight.id === 'price-coverage') return `${t('costCoverage')} ${pct(insight.params.coverage)} · ${fmtTokens(insight.params.unpricedTokens)} unpriced`
      if (insight.id === 'estimated-share') return `${t('estimatedShare')} ${pct(insight.params.share)}`
      if (insight.id === 'concentration') return `${insight.params.label} · ${pct(insight.params.share)}`
      if (insight.id === 'top-mover') return `${insight.params.label} · ${insight.params.delta >= 0 ? '+' : ''}${pct(insight.params.delta)}`
      return insight.id
    }

    function Insights({ ctx, store, insights, t }) {
      return h('section', { className: 'tu-section' }, h('div', { className: 'tu-section-head' }, h('h2', null, t('insights'))),
        insights?.length ? h('div', { className: 'tu-insights' }, ...insights.slice(0, 3).map((insight, index) => h('article', { key: insight.id, className: 'tu-insight' },
          h('span', { className: 'tu-insight-no' }, `0${index + 1}`),
          h('strong', null, insightCopy(insight, t)),
          h('button', { type: 'button', style: buttonStyle, onClick: () => { void applyFilterPatch(ctx, store, insight.action) } }, t('slice')),
        ))) : h('p', { style: mutedStyle }, t('noFindings')),
      )
    }

    function bucketWindow(bucket, granularity) {
      if (bucket.fromMs !== undefined && bucket.toMs !== undefined) return { fromMs: bucket.fromMs, toMs: bucket.toMs }
      const fromMs = Date.parse(granularity === 'month' ? `${bucket.key}-01T00:00:00Z` : `${bucket.key}T00:00:00Z`)
      const toMs = granularity === 'month' ? new Date(new Date(fromMs).setUTCMonth(new Date(fromMs).getUTCMonth() + 1)).getTime() : fromMs + (granularity === 'week' ? 7 : 1) * 86_400_000
      return { fromMs, toMs }
    }

    function Trend({ ctx, store, series, metric, t }) {
      const buckets = series?.buckets ?? []
      const max = Math.max(1, ...buckets.map((bucket) => metricValue(bucket.measures, metric)))
      return h('section', { className: 'tu-section' }, h('div', { className: 'tu-section-head' }, h('h2', null, t('trend')), h('span', null, series?.granularity ?? '—')),
        h('div', { className: 'tu-chart', role: 'list', 'aria-label': t('trend') }, ...buckets.map((bucket) => {
          const m = bucket.measures
          const total = Math.max(1, m.processingTokens)
          return h('button', { key: bucket.key, type: 'button', className: 'tu-bar-button', title: `${bucket.key} · ${metricText(m, metric)}`, onClick: () => { void applyFilterPatch(ctx, store, { op: 'set-time', time: bucketWindow(bucket, series.granularity) }) } },
            h('span', { className: 'tu-bar', style: { height: `${Math.max(3, metricValue(m, metric) / max * 100)}%` } },
              h('i', { style: { height: `${m.cacheReadTokens / total * 100}%`, background: C.accent } }),
              h('i', { style: { height: `${(m.inputTokens + m.cacheWriteTokens) / total * 100}%`, background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 55%, transparent)' } }),
              h('i', { style: { height: `${m.outputTokens / total * 100}%`, background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 25%, transparent)' } })),
            h('small', null, bucket.key.length > 4 ? bucket.key.slice(5) : bucket.key),
          )
        })),
      )
    }

    function Composition({ kpis, t }) {
      const total = Math.max(1, kpis?.processingTokens ?? 0)
      const pieces = [
        ['cache', kpis?.cacheReadTokens ?? 0, C.accent],
        ['input', (kpis?.inputTokens ?? 0) + (kpis?.cacheWriteTokens ?? 0), 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 55%, transparent)'],
        ['output', kpis?.outputTokens ?? 0, 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 25%, transparent)'],
      ]
      return h('section', { className: 'tu-section' }, h('h2', null, t('composition')),
        h('div', { className: 'tu-composition' }, ...pieces.map(([name, value, color]) => h('span', { key: name, title: `${name} ${fmtTokens(value)}`, style: { width: `${value / total * 100}%`, background: color } }))),
        h('p', { style: mutedStyle }, pieces.map(([name, value]) => `${name} ${fmtTokens(value)}`).join(' · ')),
      )
    }

    function Ranking({ ctx, store, ranking, metric, t, compact = false }) {
      const rows = ranking?.rows ?? []
      const max = Math.max(1, ...rows.map((row) => metricValue(row, metric)))
      const kind = ranking?.dimension ?? store.state.rankingDimension
      return h('section', { className: compact ? 'tu-ranking compact' : 'tu-section tu-ranking' },
        h('div', { className: 'tu-section-head' }, h('h2', null, t('rankings')),
          h('select', { name: 'ranking-dimension', 'aria-label': t('rankings'), style: selectStyle, value: store.state.rankingDimension, onChange: (event) => store.update({ rankingDimension: event.target.value }) },
            h('option', { value: 'project' }, t('byProject')), h('option', { value: 'model' }, t('byModel')), h('option', { value: 'provider' }, t('byProvider')), h('option', { value: 'session' }, t('sessions')))),
        h('div', { className: 'tu-rank-list' }, ...rows.map((row) => h('div', { key: row.key, className: 'tu-rank-row' },
          h('button', { type: 'button', className: 'tu-rank-main', onClick: () => pushInspector(store, kind, row.key) },
            h('span', null, row.label), h('strong', null, metricText(row, metric)),
            h('i', { style: { width: `${metricValue(row, metric) / max * 100}%` } })),
          h('button', { type: 'button', className: 'tu-slice', onClick: () => { void applyFilterPatch(ctx, store, { op: 'add', dimension: kind, key: row.key }) }, 'aria-label': `${t('slice')} ${row.label}` }, '＋'),
        ))),
      )
    }

    function Activity({ ctx, store, activity, t }) {
      const days = activity?.calendar ?? []
      const max = Math.max(1, ...days.map((day) => day.requests))
      return h('section', { className: 'tu-section' }, h('div', { className: 'tu-section-head' }, h('h2', null, t('activityRhythm')), h('span', null, '12 months')),
        h('div', { className: 'tu-heatmap', role: 'list', 'aria-label': t('activityRhythm') }, ...days.map((day) => h('button', { key: day.day, type: 'button', title: `${day.day} · ${day.requests}`, 'aria-label': `${day.day}: ${day.requests}`, style: heatCellStyle(Math.min(4, Math.ceil(day.requests / max * 4))), onClick: () => {
          void applyFilterPatch(ctx, store, { op: 'set-time', time: { fromMs: day.fromMs, toMs: day.toMs } })
        } }))),
        h('p', { style: mutedStyle }, 'Activity, not productivity · weekday × hour available in Explore'),
      )
    }

    function OverviewSpace({ ctx, store, data, t }) {
      return h('div', { className: 'tu-overview' },
        h(Kpis, { data, t }),
        h(Insights, { ctx, store, insights: data.insights, t }),
        h('div', { className: 'tu-two' }, h(Trend, { ctx, store, series: data.series, metric: store.state.metric, t }), h(Composition, { kpis: data.kpis, t })),
        h('div', { className: 'tu-two' }, h(Ranking, { ctx, store, ranking: data.rankings, metric: store.state.metric, t }), h(Activity, { ctx, store, activity: data.activity, t })),
      )
    }

    function ExploreSpace({ ctx, store, data, t }) {
      const entity = store.state.entity
      const rows = data.page?.rows ?? []
      return h('div', { className: 'tu-explore' },
        h('aside', { className: 'tu-facets' }, h(Ranking, { ctx, store, ranking: data.rankings, metric: store.state.metric, t, compact: true })),
        h('main', { className: 'tu-stream' },
          h('div', { className: 'tu-section-head' }, h('div', { className: 'tu-segment' },
            h('button', { type: 'button', className: entity === 'session' ? 'active' : '', onClick: () => store.update({ entity: 'session' }) }, t('sessions')),
            h('button', { type: 'button', className: entity === 'request' ? 'active' : '', onClick: () => store.update({ entity: 'request' }) }, t('requestStream'))),
            h('span', { style: mutedStyle }, `${rows.length} / ≤ 200`)),
          h('div', { className: 'tu-virtual-list' }, ...rows.map((row) => {
            const kind = entity === 'session' ? 'session' : 'request'
            const id = entity === 'session' ? row.id : row.id
            return h('article', { key: id, className: 'tu-stream-row' },
              h('button', { type: 'button', className: 'tu-stream-main', onClick: () => pushInspector(store, kind, id) },
                h('strong', null, entity === 'session' ? row.label : row.model),
                h('span', null, entity === 'session' ? `${row.projectLabel} · ${row.models.join(', ')}` : `${row.projectLabel} · ${row.provider}`),
                h('small', null, `${new Date(entity === 'session' ? row.startedAt : row.time).toLocaleString()} · ${fmtTokens(row.processingTokens)}`)),
              h('button', { type: 'button', style: buttonStyle, onClick: () => { void applyFilterPatch(ctx, store, { op: 'add', dimension: kind, key: id }) } }, t('slice')),
            )
          })),
        ),
      )
    }

    function BudgetForm({ ctx, store, t }) {
      const month = new Date().toISOString().slice(0, 7)
      return h('form', { className: 'tu-budget-form', onSubmit: (event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const scope = String(form.get('scope'))
        const scopeId = String(form.get('scopeId') ?? '').trim()
        void rpc(ctx, 'set-budget', {
          scope,
          scopeId: scope === 'profile' ? null : scopeId,
          unit: String(form.get('unit')),
          periodMonth: String(form.get('periodMonth')),
          limitValue: String(form.get('limitValue')),
        }).then(() => store.update({ analysisRevision: store.state.analysisRevision + 1 })).catch((error) => store.update({ error: error.message }))
      } },
        h('select', { name: 'scope', 'aria-label': t('scope'), style: selectStyle }, h('option', { value: 'profile' }, 'profile'), h('option', { value: 'project' }, 'project'), h('option', { value: 'provider' }, 'provider'), h('option', { value: 'model' }, 'model')),
        h('input', { name: 'scopeId', 'aria-label': t('scopeId'), placeholder: t('scopeId'), style: inputStyle }),
        h('select', { name: 'unit', 'aria-label': t('budgetLimit'), style: selectStyle }, h('option', { value: 'usd' }, 'USD'), h('option', { value: 'processingTokens' }, t('metricProcessing')), h('option', { value: 'newComputeTokens' }, t('metricNewCompute'))),
        h('input', { name: 'periodMonth', type: 'month', defaultValue: month, required: true, style: inputStyle, 'aria-label': 'month' }),
        h('input', { name: 'limitValue', type: 'number', min: '0.000001', step: 'any', required: true, placeholder: t('budgetLimit'), style: inputStyle, 'aria-label': t('budgetLimit') }),
        h('button', { type: 'submit', style: primaryButtonStyle }, t('createBudget')),
      )
    }

    function CostSpace({ ctx, store, data, t }) {
      const cost = data.kpis?.cost ?? {}
      const budgets = data.budgets?.rows ?? []
      const budgetText = (budget, value) => budget.unit === 'usd' ? fmtUsd(Number(value) * 1_000_000_000) : fmtTokens(value)
      return h('div', null,
        h(Kpis, { data, t }),
        h('div', { className: 'tu-two' },
          h('section', { className: 'tu-section' }, h('h2', null, t('costTrust')),
            h('p', { style: metricValueStyle }, fmtUsd(cost.currentUsdNano)),
            h('p', { style: mutedStyle }, `${t('currentRules')} · ${t('costCoverage')} ${pct(cost.coverage)} · ${t('originalValue')} ${fmtUsd(cost.originalUsdNano)}`)),
          h('section', { className: 'tu-section' }, h('h2', null, t('budgets')),
            budgets.length ? h('div', { className: 'tu-budget-list' }, ...budgets.map((budget) => h('article', { key: budget.id, className: 'tu-budget' },
              h('div', null, h('strong', null, `${budget.scope}${budget.scopeId ? ` · ${budget.scopeId}` : ''}`), h('span', null, `${budget.periodMonth} · ${budget.unit}`)),
              h('b', null, `${budgetText(budget, budget.spent)} / ${budgetText(budget, budget.limit)}`),
              h('i', { style: { width: `${Math.min(100, budget.progress * 100)}%` } }),
              h('small', null, budget.forecast === null ? `${t('forecastWithheld')} · ${budget.forecastReason}` : `forecast ${budgetText(budget, budget.forecast)}`),
            ))) : h('p', { style: mutedStyle }, t('empty')),
            h(BudgetForm, { ctx, store, t })),
        ),
        h('div', { className: 'tu-two' }, h(Trend, { ctx, store, series: data.series, metric: 'cost', t }), h(Ranking, { ctx, store, ranking: data.rankings, metric: 'cost', t })),
      )
    }

    function ProjectAdmin({ ctx, t }) {
      const projects = useAsync(() => rpc(ctx, 'projects'), [ctx])
      if (projects.status !== 'ready') return h(LoadPanel, { status: projects.status, error: projects.error, reload: projects.reload, t })
      const mutate = (endpoint, payload) => rpc(ctx, endpoint, payload).then(projects.reload).catch(() => {})
      return h('div', { className: 'tu-projects' },
        h('form', { className: 'tu-project-assign', onSubmit: (event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          const projectId = String(form.get('projectId') ?? '').trim()
          void mutate('assign-project', {
            cwd: String(form.get('cwd')),
            ...(projectId ? { projectId } : { identityKind: 'manual', identityValue: String(form.get('identityValue')), displayName: String(form.get('displayName')) }),
          })
        } },
          h('input', { name: 'cwd', required: true, placeholder: t('projectSources'), style: inputStyle, 'aria-label': t('projectSources') }),
          h('select', { name: 'projectId', style: selectStyle, 'aria-label': t('projectsAdmin') }, h('option', { value: '' }, '＋ new'), ...projects.value.map((project) => h('option', { key: project.id, value: project.id }, project.displayName))),
          h('input', { name: 'identityValue', placeholder: 'identity', style: inputStyle, 'aria-label': 'identity' }),
          h('input', { name: 'displayName', placeholder: t('displayName'), style: inputStyle, 'aria-label': t('displayName') }),
          h('button', { type: 'submit', style: primaryButtonStyle }, t('save'))),
        h('div', { className: 'tu-project-list' }, ...projects.value.map((project) => h('article', { key: project.id, style: cardStyle },
          h('form', { onSubmit: (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            void mutate('update-project', { id: project.id, patch: { displayName: String(form.get('displayName')), color: String(form.get('color') ?? '') || null, hidden: Boolean(form.get('hidden')) } })
          } },
            h('div', { className: 'tu-section-head' }, h('strong', null, project.displayName), h('small', null, project.identityKind)),
            h('input', { name: 'displayName', defaultValue: project.displayName, style: inputStyle, 'aria-label': t('renameProject') }),
            h('input', { name: 'color', type: 'color', defaultValue: project.color ?? '#4176e6', 'aria-label': 'color' }),
            h('label', { className: 'tu-check' }, h('input', { name: 'hidden', type: 'checkbox', defaultChecked: project.hidden }), t('hideProject')),
            h('button', { type: 'submit', style: buttonStyle }, t('save'))),
          h('p', { style: mutedStyle }, `${project.sourceCount} · ${project.sources.join(' · ')}`),
        ))),
      )
    }

    function DataSettingsSpace({ ctx, store, t }) {
      const section = store.state.dataSection
      return h('div', null,
        h('div', { className: 'tu-segment tu-data-segment' },
          h('button', { type: 'button', className: section === 'pricing' ? 'active' : '', onClick: () => store.update({ dataSection: 'pricing' }) }, t('dataPricing')),
          h('button', { type: 'button', className: section === 'data' ? 'active' : '', onClick: () => store.update({ dataSection: 'data' }) }, t('dataImport')),
          h('button', { type: 'button', className: section === 'projects' ? 'active' : '', onClick: () => store.update({ dataSection: 'projects' }) }, t('projectsAdmin')),
          h('button', { type: 'button', className: section === 'profile' ? 'active' : '', onClick: () => store.update({ dataSection: 'profile' }) }, t('dataProfile'))),
        section === 'pricing' ? h(PricingTab, { ctx, t }) : section === 'data' ? h(DataTab, { ctx, t, filter: store.state.filter }) : section === 'projects' ? h(ProjectAdmin, { ctx, t }) : h(SettingsTab, { ctx, t }),
      )
    }

    function RequestCorrection({ ctx, store, report, t }) {
      const request = report.request
      if (!request) return null
      const mutate = (endpoint, payload) => rpc(ctx, endpoint, payload)
        .then(() => store.update({ analysisRevision: store.state.analysisRevision + 1 }))
        .catch((error) => store.update({ error: error.message }))
      const exclude = () => mutate('correct-request', { id: request.id, correction: { excluded: true, note: t('excludeRequest') } })
      const undo = () => mutate('revoke-correction', { id: request.correction.id })
      const submit = (event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const number = (name) => form.get(name) === '' ? null : Number(form.get(name))
        void mutate('correct-request', { id: request.id, correction: {
          inputTokens: number('input'), outputTokens: number('output'),
          cacheReadTokens: number('cacheRead'), cacheWriteTokens: number('cacheWrite'),
          note: String(form.get('note') ?? '') || null,
        } })
      }
      return h('section', { className: 'tu-correction' },
        h('h3', null, t('applyCorrection')),
        h('form', { onSubmit: submit },
          h('div', { className: 'tu-correction-grid' },
            h('input', { name: 'input', type: 'number', min: '0', defaultValue: request.inputTokens, style: inputStyle, 'aria-label': 'input tokens' }),
            h('input', { name: 'output', type: 'number', min: '0', defaultValue: request.outputTokens, style: inputStyle, 'aria-label': 'output tokens' }),
            h('input', { name: 'cacheRead', type: 'number', min: '0', defaultValue: request.cacheReadTokens, style: inputStyle, 'aria-label': 'cache read tokens' }),
            h('input', { name: 'cacheWrite', type: 'number', min: '0', defaultValue: request.cacheWriteTokens, style: inputStyle, 'aria-label': 'cache write tokens' })),
          h('input', { name: 'note', defaultValue: request.correction?.note ?? '', placeholder: t('correctionNote'), style: { ...inputStyle, width: '100%', boxSizing: 'border-box', marginTop: 7 }, 'aria-label': t('correctionNote') }),
          h('div', { className: 'tu-correction-actions' },
            h('button', { type: 'submit', style: primaryButtonStyle }, t('applyCorrection')),
            h('button', { type: 'button', style: buttonStyle, onClick: () => { void exclude() } }, t('excludeRequest')),
            request.correction && !request.correction.isReset ? h('button', { type: 'button', style: buttonStyle, onClick: () => { void undo() } }, t('undoCorrection')) : null)),
      )
    }

    function InspectorDrawer({ ctx, store, state, t }) {
      const stack = state.inspectorStack ?? []
      const top = stack[stack.length - 1]
      const report = useAsync(() => top ? rpc(ctx, 'inspect', { ...top, filter: state.filter }) : Promise.resolve(null), [ctx, top?.kind, top?.id, JSON.stringify(state.filter), state.analysisRevision])
      if (!top) return null
      const value = report.value
      const direct = value?.direct
      return h('aside', { className: 'tu-drawer', role: 'dialog', 'aria-label': `${top.kind} ${top.id}` },
        h('div', { className: 'tu-drawer-head' },
          stack.length > 1 ? h('button', { type: 'button', style: buttonStyle, onClick: () => popInspector(store) }, `← ${t('back')}`) : null,
          h('div', null, h('small', null, top.kind), h('strong', null, value?.identity?.displayName ?? value?.identity?.model ?? value?.identity?.provider ?? shortId(top.id))),
          h('button', { type: 'button', style: closeStyle, onClick: () => store.update({ inspectorStack: [] }), 'aria-label': t('drawerClose') }, '✕')),
        report.status === 'loading' ? h('p', { style: mutedStyle }, t('loading')) : report.status === 'error' ? h('p', { style: errorStyle }, report.error?.message) : value ? h('div', { className: 'tu-drawer-body' },
          h('div', { className: 'tu-drawer-kpis' }, h('span', null, t('metricProcessing'), h('b', null, fmtTokens(direct?.processingTokens))), h('span', null, t('metricNewCompute'), h('b', null, fmtTokens(direct?.newComputeTokens))), h('span', null, t('metricCost'), h('b', null, fmtUsd(direct?.cost?.currentUsdNano))), h('span', null, t('metricRequests'), h('b', null, fmtTokens(direct?.requests)))),
          value.identity ? h('dl', { className: 'tu-identity' }, ...Object.entries(value.identity).filter(([, entry]) => ['string', 'number', 'boolean'].includes(typeof entry) || entry === null).flatMap(([key, entry]) => [h('dt', { key: `k-${key}` }, key), h('dd', { key: `v-${key}` }, String(entry ?? '—'))])) : null,
          value.kind === 'request' ? h(React.Fragment, null,
            h(RequestCorrection, { ctx, store, report: value, t }),
            value.corrections?.length ? h('section', { className: 'tu-correction-audit' }, h('h3', null, t('correctionAudit')), ...value.corrections.map((entry) => h('p', { key: entry.id, style: mutedStyle }, `#${entry.id} · ${entry.note ?? (entry.excluded ? 'excluded' : 'token correction')} · ${new Date(entry.createdAt).toLocaleString()}`))) : null,
          ) : null,
          value.children?.length ? h('section', null, h('h3', null, 'Children'), ...value.children.map((child) => h('button', { key: child.id, type: 'button', className: 'tu-inspector-link', onClick: () => pushInspector(store, 'session', child.id) }, `${shortId(child.id)} · ${fmtTokens(child.measures.processingTokens)}`))) : null,
          value.page?.rows?.length ? h('section', null, h('h3', null, value.page.entity), ...value.page.rows.slice(0, 20).map((row) => h('button', { key: row.id, type: 'button', className: 'tu-inspector-link', onClick: () => pushInspector(store, value.page.entity === 'session' ? 'session' : 'request', row.id) }, `${row.label ?? row.model ?? shortId(row.id)} · ${fmtTokens(row.processingTokens)}`))) : null,
        ) : null,
      )
    }

    function Workbench({ ctx, store, state, t }) {
      const analysis = useAnalysis(ctx, state)
      React.useEffect(() => { if (state.restored) saveWorkbenchState(ctx, store) }, [ctx, state.restored, state.space, JSON.stringify(state.filter), state.metric, state.compare, state.entity, state.rankingDimension, state.dataSection])
      if (state.space === 'data') return h(DataSettingsSpace, { ctx, store, t })
      if (!analysis.value && analysis.status === 'loading') return h('p', { style: mutedStyle }, t('loading'))
      if (!analysis.value && analysis.status === 'error') return h(LoadPanel, { status: 'error', error: analysis.error, reload: analysis.reload, t })
      const data = analysis.value
      return h('div', null,
        h('div', { className: 'tu-query-meta' }, h('span', null, `rev ${data.asOf?.revision ?? 0}`), h('button', { type: 'button', style: buttonStyle, onClick: analysis.reload }, t('refresh'))),
        state.space === 'overview' ? h(OverviewSpace, { ctx, store, data, t }) : state.space === 'explore' ? h(ExploreSpace, { ctx, store, data, t }) : h(CostSpace, { ctx, store, data, t }),
      )
    }

    const workbenchCss = `
      .tu-scope{display:flex;align-items:end;gap:10px;padding:10px 20px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));flex-wrap:wrap;background:var(--dsw-alias-bg-layer-1,#fff)}
      .tu-field{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--dsw-alias-label-secondary,#61666b)} .tu-check{display:flex;align-items:center;gap:5px;font-size:12px;padding:7px 0}
      .tu-chips{display:flex;gap:6px;flex-wrap:wrap;flex:1 0 100%}.tu-chip,.tu-reset{border:0;border-radius:999px;padding:4px 9px;background:var(--dsw-alias-bg-multi-select,#f5f6f7);color:var(--dsw-alias-label-primary,#111);cursor:pointer}.tu-reset{color:var(--dsw-alias-state-error-primary,#b42318)}
      .tu-query-meta{display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-bottom:8px;color:var(--dsw-alias-label-secondary,#61666b);font-size:11px}.tu-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}.tu-section{border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06));border-radius:12px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1,#fff);min-width:0}.tu-section h2,.tu-section h3{font-size:14px;margin:0 0 10px}.tu-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.tu-section-head h2{margin:0}.tu-section-head>span{font-size:11px;color:var(--dsw-alias-label-secondary,#61666b)}
      .tu-insights{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.tu-insight{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;padding:10px;border-left:3px solid var(--dsw-alias-state-business-primary,#4176e6);background:var(--dsw-alias-bg-multi-select,#f5f6f7);border-radius:7px}.tu-insight-no{font-size:11px;color:var(--dsw-alias-label-secondary,#61666b)}.tu-insight strong{font-size:13px}.tu-two{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(260px,.8fr);gap:14px;margin-top:14px}.tu-chart{height:220px;display:flex;align-items:end;gap:4px;padding-top:8px;overflow:hidden}.tu-bar-button{border:0;background:transparent;flex:1;min-width:5px;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px;cursor:pointer;color:var(--dsw-alias-label-secondary,#61666b);padding:0}.tu-bar-button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}.tu-bar-button small{font-size:9px}.tu-bar{display:flex;flex-direction:column-reverse;width:72%;min-height:3px;border-radius:4px 4px 1px 1px;overflow:hidden}.tu-bar i{display:block;width:100%;min-height:1px}.tu-composition{height:18px;border-radius:999px;display:flex;overflow:hidden;margin:18px 0 10px}.tu-composition span{display:block;height:100%}
      .tu-rank-list{display:flex;flex-direction:column}.tu-rank-row{display:flex;align-items:stretch;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.05))}.tu-rank-main{position:relative;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;flex:1;border:0;background:transparent;color:inherit;text-align:left;padding:9px 4px;cursor:pointer;overflow:hidden}.tu-rank-main i{position:absolute;left:0;bottom:2px;height:2px;background:var(--dsw-alias-state-business-primary,#4176e6)}.tu-slice{border:0;background:transparent;color:var(--dsw-alias-label-secondary,#61666b);cursor:pointer}.tu-heatmap{display:grid;grid-template-rows:repeat(7,11px);grid-auto-flow:column;grid-auto-columns:11px;gap:3px;overflow-x:auto;padding:3px}.tu-heatmap button{border:0;padding:0;cursor:pointer}.tu-explore{display:grid;grid-template-columns:minmax(230px,.65fr) minmax(420px,1.8fr);gap:14px}.tu-facets,.tu-stream{border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06));border-radius:12px;padding:12px;background:var(--dsw-alias-bg-layer-1,#fff);min-width:0}.tu-ranking.compact{padding:0}.tu-virtual-list{max-height:calc(100vh - 250px);overflow:auto;contain:layout paint}.tu-content.with-drawer{margin-right:min(420px,42vw)}.tu-stream-row{display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.05));content-visibility:auto;contain-intrinsic-size:68px}.tu-stream-main{display:flex;flex-direction:column;align-items:flex-start;gap:3px;flex:1;padding:10px 2px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.tu-stream-main span,.tu-stream-main small{font-size:11px;color:var(--dsw-alias-label-secondary,#61666b)}.tu-segment{display:inline-flex;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:9px;padding:2px}.tu-segment button{border:0;background:transparent;color:inherit;padding:5px 10px;border-radius:6px;cursor:pointer}.tu-segment button.active{background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.1))}.tu-data-segment{margin-bottom:16px}.tu-budget-list{display:flex;flex-direction:column;gap:10px}.tu-budget{display:grid;grid-template-columns:1fr auto;gap:4px;position:relative;padding-bottom:6px}.tu-budget div{display:flex;flex-direction:column}.tu-budget span,.tu-budget small{font-size:11px;color:var(--dsw-alias-label-secondary,#61666b)}.tu-budget i{position:absolute;left:0;bottom:0;height:3px;background:var(--dsw-alias-state-business-primary,#4176e6)}
      .tu-project-assign{display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:8px;margin-bottom:14px}.tu-project-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}.tu-project-list form{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.tu-project-list form input[name=displayName]{flex:1}
      .tu-budget-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:14px}.tu-budget-form button{grid-column:1/-1}
      .tu-drawer{position:absolute;right:0;top:0;bottom:0;width:min(420px,42vw);z-index:3;background:var(--dsw-alias-bg-layer-1,#fff);border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));box-shadow:-12px 0 28px rgba(0,0,0,.12);display:flex;flex-direction:column}.tu-drawer-head{display:flex;align-items:center;gap:10px;padding:14px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}.tu-drawer-head>div{display:flex;flex-direction:column;min-width:0}.tu-drawer-head>button:last-child{margin-left:auto}.tu-drawer-body{padding:14px;overflow:auto}.tu-drawer-kpis{display:grid;grid-template-columns:1fr 1fr;gap:8px}.tu-drawer-kpis span{display:flex;flex-direction:column;font-size:11px;color:var(--dsw-alias-label-secondary,#61666b);padding:9px;background:var(--dsw-alias-bg-multi-select,#f5f6f7);border-radius:8px}.tu-drawer-kpis b{font-size:15px;color:var(--dsw-alias-label-primary,#111)}.tu-identity{display:grid;grid-template-columns:auto 1fr;gap:5px 12px;font-size:12px}.tu-identity dt{color:var(--dsw-alias-label-secondary,#61666b)}.tu-identity dd{margin:0;overflow-wrap:anywhere}.tu-inspector-link{display:block;width:100%;border:0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.05));background:transparent;color:inherit;text-align:left;padding:8px 0;cursor:pointer}
      .tu-correction{margin-top:16px}.tu-correction-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.tu-correction-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
      @media(max-width:1100px){.tu-content.with-drawer{margin-right:0}.tu-kpis{grid-template-columns:1fr 1fr}.tu-two{grid-template-columns:1fr}.tu-insights{grid-template-columns:1fr}.tu-explore{grid-template-columns:230px 1fr}}
      @media(max-width:899px){.tu-kpis{grid-template-columns:1fr 1fr}.tu-explore{grid-template-columns:1fr}.tu-facets{display:none}.tu-drawer{width:100%;top:0}.tu-scope{padding:8px 12px}.tu-chart{height:170px}}
      @media(max-width:560px){.tu-kpis{grid-template-columns:1fr}.tu-two{grid-template-columns:1fr}.tu-stream-row{align-items:flex-start}.tu-stream-row>button:last-child{margin-top:10px}}
    `

    // ---------- Overlay shell ----------
    const TABS = SPACES

    function Overlay(props) {
      const { ctx, store, t } = props
      const state = useStore(store)
      React.useEffect(() => {
        if (!state.open) return undefined
        if (!state.restored) {
          void rpc(ctx, 'settings').then((payload) => {
            const restored = payload.settings?.v2LastState ?? {}
            const savedViews = Array.isArray(payload.settings?.v2SavedViews) ? payload.settings.v2SavedViews.slice(0, 8) : []
            store.update({ ...restored, filter: restored.filter ?? state.filter, savedViews, settingsData: payload.settings, restored: true })
          }).catch(() => store.update({ restored: true }))
        }
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if ((store.state.inspectorStack ?? []).length) popInspector(store)
          else store.update({ open: false })
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [ctx, state.open, state.restored, store])

      if (!state.open) return null
      return h('div', { style: overlayStyle, role: 'dialog', 'aria-label': t('title') },
        h('style', null, workbenchCss),
        h('div', { style: headerStyle },
          h('p', { style: titleStyle }, t('title')),
          h('nav', { style: tabRowStyle, 'aria-label': t('title') },
            ...TABS.map(([name, key]) => h('button', { key: name, type: 'button', style: tabStyle(state.space === name), 'aria-current': state.space === name ? 'page' : undefined, onClick: () => store.update({ space: name, inspectorStack: [] }) }, t(key))),
          ),
          h('button', { type: 'button', style: closeStyle, onClick: () => store.update({ open: false, inspectorStack: [] }), 'aria-label': t('close') }, '✕'),
        ),
        h(ScopeBar, { ctx, store, state, t }),
        h('div', { className: `tu-content${state.inspectorStack.length ? ' with-drawer' : ''}`, style: { ...contentStyle, position: 'relative' } }, state.restored ? h(Workbench, { ctx, store, state, t }) : h('p', { style: mutedStyle }, t('loading'))),
        h(InspectorDrawer, { ctx, store, state, t }),
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
      const visibleLabel = wide ? summaryLabel(mode, summary, t) : t('nav')
      return h('button', {
        type: 'button',
        style: footerButtonStyle(wide),
        'aria-label': `${t('nav')} ${visibleLabel}`,
        title: t('nav'),
        onClick: () => store.update({ open: true }),
      },
        h(UsageGlyph),
        wide ? h('span', null, visibleLabel) : null,
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
