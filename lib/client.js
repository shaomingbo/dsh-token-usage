/**
 * Browser half of dsh-token-usage: a sidebar entry that doubles as a micro
 * usage indicator (tightest billing pool + month progress), a right-docked
 * compact panel, and a full-frame objective dashboard (summary, dual-stacked
 * activity, model ranking, per-pool detail). All data comes from the host
 * over the loopback-only /token-usage channel; the client never touches the
 * network and never sees conversation content.
 */

window.__ModuleLoader__.load({
  id: 'dsh-token-usage',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const CHANNEL = '/token-usage'
    const NS = 'dsh-token-usage'

    const en = {
      nav: 'Accounts & Usage',
      title: 'DSH Accounts & Usage',
      accountsTitle: 'Provider connections',
      officialObservations: 'Official observations',
      localLedger: 'Local usage ledger',
      connected: 'Connected',
      notConnected: 'Not connected',
      configuredUnverified: 'Configured · key status unverified',
      quotaNotApplicable: 'Quota not applicable',
      refreshObservations: 'Refresh official observations',
      connect: 'Connect',
      disconnect: 'Disconnect',
      activate: 'Activate',
      openAuthorization: 'Open authorization page',
      deviceCode: 'Device code',
      loginPending: 'Waiting for authorization…',
      credentialImports: 'API keys and observation credentials',
      glmAuthorization: 'GLM Authorization value',
      ollamaApiKey: 'Ollama Cloud API key',
      ollamaCookie: 'Ollama Cookie Header',
      credentialSave: 'Save credential',
      cookieOptIn: 'I explicitly opt in to fetching Ollama Cloud Usage from the official settings page with these allowlisted session cookies.',
      credentialSaved: 'Credential saved in DSH Credentials.',
      cloudModels: 'Cloud models',
      syncCloudModels: 'Sync Cloud models',
      cloudModelsSynced: 'Cloud models synchronized',
      modelSyncFailed: 'model synchronization failed',
      modelDetailsIncomplete: 'model details incomplete',
      credentialHelp: 'Secrets are written to DSH Credentials, never to the usage database or account RPC responses.',
      observationDisclaimer: 'Provider observations are separate from the local ledger and are not an invoice.',
      close: 'Close (Esc)',
      tabSettings: 'Settings',
      newCompute: 'new compute',
      requests: 'Requests',
      loadFailed: 'Usage data is unavailable.',
      retry: 'Retry',
      loading: 'Loading…',
      colModel: 'Model',
      importTitle: 'History import',
      importIdle: 'Idle',
      importRunning: 'Importing',
      importDone: 'sessions scanned',
      importErrors: 'errors',
      rescan: 'Rescan',
      fullRescan: 'Full rescan',
      pause: 'Pause',
      cancel: 'Cancel',
      exportCsv: 'Export requests (CSV)',
      exportJson: 'Export report (JSON)',
      backup: 'Create backup',
      backupCreated: 'Backup written',
      restoreTitle: 'Restore backup',
      restorePath: 'Backup path',
      restoreMerge: 'Merge',
      restoreReplace: 'Replace',
      purgeTitle: 'Retention',
      purgeIntro: 'Delete request details older than this many days (day-level totals are kept):',
      purge: 'Purge now',
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
      dataPricing: 'Pricing', dataImport: 'Import & data', dataProfile: 'Profile', unnamedView: 'Named view', viewLimit: 'Up to 8 views',
      lensValue: 'Value $', lensToken: 'Tokens', lensReq: 'Requests', last30: 'last 30 days', monthActivity: 'Monthly activity',
      topModel: 'Top model', activityTitle: 'Activity · last 30 days', stackPool: 'Stack by pool', stackModel: 'Stack by model',
      activityHint: 'Click a bar to inspect that day.', dayTotal: 'total', otherGroup: 'other', modelRank: 'Model ranking',
      modelRankHint: 'same usage, different lens — the data decides', allPools: 'All pools', unassignedPool: 'Unassigned · metered',
      quotaUsed: 'quota used', monthProgress: 'month', poolsMonthly: 'Pool usage this cycle', sparkTitle: 'Last 30 days · click a bar',
      modelDetail: 'Models in this pool', equivalent: 'Equivalent', newCompute: 'New compute', coverage: 'Coverage', resetAt: 'resets',
      colShare: 'Share', colModel: 'Model', paceDisclaimer: 'extrapolation is plain average-rate arithmetic, not a forecast',
      poolCap: 'at {rate}/day for the last 7 days, the cap is reached in {days} days', poolLeftover: 'at {rate}/day, ≈{leftover} left over at reset ({reset})',
      creditRunway: 'at the last-30-day rate, ≈{leftover} remaining at {expiry} ({days} days left)', creditRunwayBurn: '{burn} of {balance} burned by expiry ({pct})',
      creditNoExpiry: '{name}: credit balance, no expiry set', unconfiguredTitle: 'No billing pools configured',
      unconfiguredBody: 'Add each subscription or prepaid balance, then attribution rules. Pick a quota window that matches the product: monthly billing reset, rolling 7-day cap, or rolling 5-hour cap — not all three in the reset-day field.',
      configurePlans: 'Configure billing pools', unassignedNote: 'Unattributed (last 30 days): {tokens} new-compute tokens across {requests} requests — add a rule to assign them.',
      fullscreen: 'Full ↗', dockMode: 'Dock', tightestPool: 'tightest', resetIn: 'reset', dayUnit: 'd',
      plansTitle: 'Billing pools', plansActive: 'active', planAdd: 'Add pool', planName: 'Name', planKind: 'Kind', planKindSub: 'Subscription',
      planKindCredit: 'Prepaid / relay', planQuota: 'Quota', planQuotaUnit: 'Quota unit', quotaNewCompute: 'new-compute tokens', quotaUsd: 'USD spend',
      planWindow: 'Window', resetDay: 'reset day', expiry: 'expiry', planBalance: 'Balance USD', planPrice: 'Price USD / month',
      planRules: 'Rules', planRulesEdit: 'Rules', planRulesFor: 'Attribution rules for', planRulesHint: 'One rule per line: provider-glob | model-glob | priority (e.g. openai* | gpt-* | 0). First match wins; unmatched traffic lands in "Unassigned".',
      planArchived: 'archived', planArchive: 'Archive', planRestore: 'Restore', edit: 'Edit', cancel: 'Cancel', save: 'Save',
      windowNone: 'No cap (track only)', window5h: 'Rolling 5 hours', window7d: 'Rolling 7 days', windowMonth: 'Calendar month',
      planWindow2: 'Second cap (optional)', planWindow2Quota: 'Second-cap quota', planWindowHelp: 'Reset day is the monthly billing/quota reset (like a statement date). A 5-hour session cap or weekly token cap is a rolling window — choose it under Quota window, not Reset day. Codex-style plans: 5 hours as the main window, 7 days as the second cap.',
      poolRolling: '{window} at {pct}%', poolNoCap: 'No quota cap — usage is tracked only',
      sidebarPools: 'Tightest pool', sidebarBars: 'Dual bars (CodexBar)', sidebarBadge: 'Badge', sidebarPlain: 'Plain text',
      entryTitle: 'Accounts & Usage', entryUnconfigured: 'No billing pools yet',
      dataCorner: 'Data & settings', backToDash: '← Dashboard',
    }

    const zh = {
      nav: '账户与用量',
      title: 'DSH 账户与用量',
      accountsTitle: '提供方连接',
      officialObservations: '官方观察',
      localLedger: '本地用量账本',
      connected: '已连接',
      notConnected: '未连接',
      configuredUnverified: '已配置 · Key 状态未验证',
      quotaNotApplicable: '额度不适用',
      refreshObservations: '刷新官方观察',
      connect: '连接',
      disconnect: '断开',
      activate: '设为当前账户',
      openAuthorization: '打开授权页面',
      deviceCode: '设备码',
      loginPending: '等待授权…',
      credentialImports: 'API Key 与观察凭据',
      glmAuthorization: 'GLM Authorization 值',
      ollamaApiKey: 'Ollama Cloud API Key',
      ollamaCookie: 'Ollama Cookie Header',
      credentialSave: '保存凭据',
      cookieOptIn: '我明确同意使用这些白名单会话 Cookie，从 Ollama 官方设置页读取 Cloud Usage。',
      credentialSaved: '凭据已保存到 DSH Credentials。',
      cloudModels: 'Cloud 模型',
      syncCloudModels: '同步 Cloud 模型',
      cloudModelsSynced: 'Cloud 模型已同步',
      modelSyncFailed: '模型同步失败',
      modelDetailsIncomplete: '个模型详情不完整',
      credentialHelp: '秘密仅写入 DSH Credentials，不进入用量数据库或账户 RPC 响应。',
      observationDisclaimer: '提供方观察与本地账本分开，不代表账单。',
      close: '关闭 (Esc)',
      tabSettings: '设置',
      newCompute: '新计算',
      requests: '请求数',
      loadFailed: '用量数据不可用。',
      retry: '重试',
      loading: '加载中…',
      colModel: '模型',
      importTitle: '历史导入',
      importIdle: '空闲',
      importRunning: '导入中',
      importDone: '个会话已扫描',
      importErrors: '个错误',
      rescan: '增量扫描',
      fullRescan: '全量扫描',
      pause: '暂停',
      cancel: '取消',
      exportCsv: '导出请求 (CSV)',
      exportJson: '导出报告 (JSON)',
      backup: '创建备份',
      backupCreated: '备份已写入',
      restoreTitle: '恢复备份',
      restorePath: '备份路径',
      restoreMerge: '合并',
      restoreReplace: '替换',
      purgeTitle: '保留期限',
      purgeIntro: '删除超过该天数的请求明细（保留匿名日级合计）：',
      purge: '立即清理',
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
      dataPricing: '定价', dataImport: '导入与数据', dataProfile: '个人设置', unnamedView: '命名视图', viewLimit: '最多 8 个视图',
      lensValue: '等值 $', lensToken: 'Token', lensReq: '请求', last30: '近 30 天', monthActivity: '本月活动',
      topModel: '主力模型', activityTitle: '活动 · 近 30 天', stackPool: '按池堆叠', stackModel: '按模型堆叠',
      activityHint: '点击柱形查看当日。', dayTotal: '合计', otherGroup: '其他', modelRank: '模型排行',
      modelRankHint: '同一份量，换口径就换主力 —— 数据说了算', allPools: '全部', unassignedPool: '未归属 · 按量',
      quotaUsed: '额度已用', monthProgress: '月进度', poolsMonthly: '本周期各池用量', sparkTitle: '近 30 天 · 点柱看当日',
      modelDetail: '池内模型', equivalent: '等值', newCompute: '新计算', coverage: '覆盖', resetAt: '重置',
      colShare: '占比', colModel: '模型', paceDisclaimer: '外推仅为算术平均速率，非预测模型',
      poolCap: '按近 7 天 {rate}/天，{days} 天后达到额度', poolLeftover: '按 {rate}/天，重置时约剩 {leftover}（{reset}）',
      creditRunway: '按近 30 天速率，到期约剩 {leftover}（剩 {days} 天，{expiry}）', creditRunwayBurn: '到期消耗 {burn} / 余额 {balance}（{pct}）',
      creditNoExpiry: '{name}：预付余额，未设到期日', unconfiguredTitle: '尚未配置计费池',
      unconfiguredBody: '先为每个订阅或预付余额建一个计费池，再写归因规则。额度窗口要和产品一致：月账单重置、7 天滚动、或 5 小时滚动——不要把周限/5 小时填进「重置日」。',
      configurePlans: '配置计费池', unassignedNote: '未归属（近 30 天）：{tokens} 新计算 token、{requests} 次请求 —— 补一条规则即可归入。',
      fullscreen: '全屏 ↗', dockMode: '停靠', tightestPool: '最紧一池', resetIn: '重置', dayUnit: '天',
      plansTitle: '计费池', plansActive: '个启用', planAdd: '添加池', planName: '名称', planKind: '类型', planKindSub: '订阅',
      planKindCredit: '预付 / 中转', planQuota: '额度', planQuotaUnit: '额度单位', quotaNewCompute: '新计算 token', quotaUsd: 'USD 花费',
      planWindow: '窗口', resetDay: '重置日', expiry: '到期日', planBalance: '余额 USD', planPrice: '月费 USD',
      planRules: '规则', planRulesEdit: '规则', planRulesFor: '归因规则：', planRulesHint: '每行一条：provider 通配 | 模型通配 | 优先级（如 openai* | gpt-* | 0）。按优先级取首个匹配；未匹配进入「未归属」。',
      planArchived: '已归档', planArchive: '归档', planRestore: '恢复', edit: '编辑', cancel: '取消', save: '保存',
      windowNone: '无额度（只记账）', window5h: '5 小时滚动', window7d: '7 天滚动', windowMonth: '自然月',
      planWindow2: '第二额度（可选）', planWindow2Quota: '第二额度值', planWindowHelp: '「重置日」是月度账单/额度重置日（类似出账日）。5 小时会话上限和周 token 限是滚动窗口——在「额度窗口」里选，不要填进重置日。Codex 类套餐：主窗口选 5 小时，第二额度选 7 天。',
      poolRolling: '{window} 已用 {pct}%', poolNoCap: '未设额度，只记录用量',
      sidebarPools: '最紧一池', sidebarBars: '双条（CodexBar）', sidebarBadge: '徽章', sidebarPlain: '纯文字',
      entryTitle: '账户与用量', entryUnconfigured: '尚未配置计费池',
      dataCorner: '数据与设置', backToDash: '← 仪表盘',
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
    // ---------- v3 store: subscription usage, objective data only ----------
    function createStore() {
      const state = {
        open: false,
        mode: 'dash',            // 'dash' full dashboard (A) | 'dock' right-docked panel (B)
        lens: 'value',           // 'value' equivalent USD | 'token' new-compute | 'req' requests
        sub: 'all',              // selected pool id or 'all'
        stack: 'pool',           // activity stacking: 'pool' | 'model'
        day: null,               // selected day key in the activity chart
        dataSection: null,       // null | 'plans' | 'pricing' | 'data' | 'settings'
        entrySummary: null,
        overview: null,
        settingsData: null,
        analysisRevision: 0,
        error: null,
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

    function formatSessionLabel(row, t) {
      if (typeof row === 'string') return row
      if (row.title && row.title.trim()) return row.title.trim()
      if (row.sessionTitle && row.sessionTitle.trim()) return row.sessionTitle.trim()
      if (row.identity?.title && row.identity.title.trim()) return row.identity.title.trim()
      if (row.label && !row.label.startsWith('Session •')) return row.label
      return row.label ?? `Session • ${shortId(row.id)}`
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
      display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%',
      padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
      border: 'none', background: 'transparent', color: C.textSecondary, fontSize: 13, textAlign: 'left',
    })

    // ---------- data loading ----------
    async function rpc(ctx, endpoint, payload) {
      const result = await ctx.connection.rpc.call(CHANNEL, endpoint, payload ?? {})
      if (!result.ok) throw new Error(result.error?.message ?? 'request failed')
      return result.value
    }

    async function accountRpc(ctx, endpoint, payload) {
      const result = await ctx.connection.rpc.call('/account-usage', endpoint, payload ?? {})
      if (!result.ok) throw new Error(result.error?.message ?? 'account request failed')
      return result.value
    }

    async function setCredential(ctx, ref, value) {
      const response = await ctx.connection.api.credentials.set({ ref, value })
      const result = response?.result ?? response
      if (result?.ok !== true) throw new Error(result?.error?.message ?? 'credential save failed')
    }

    const OLLAMA_COOKIE_NAMES = new Set([
      'session', '__Secure-session', 'ollama_session', '__Host-ollama_session', 'wos-session',
      '__Secure-next-auth.session-token', 'next-auth.session-token',
      '__Secure-better-auth.session_token', 'better-auth.session_token',
    ])

    function sanitizeOllamaCookieHeader(header) {
      if (typeof header !== 'string' || /[\r\n]/.test(header)) throw new Error('Cookie Header must be one line')
      const selected = []
      const seen = new Set()
      for (const segment of header.split(';')) {
        const index = segment.indexOf('=')
        if (index < 1) continue
        const name = segment.slice(0, index).trim()
        const value = segment.slice(index + 1).trim()
        if (!OLLAMA_COOKIE_NAMES.has(name) || seen.has(name) || value.length === 0) continue
        if (/[,;\s]/.test(value)) throw new Error('Ollama session cookie contains invalid characters')
        selected.push(`${name}=${value}`)
        seen.add(name)
      }
      if (selected.length === 0) throw new Error('Cookie Header contains no recognized Ollama session cookie')
      return selected.join('; ')
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
    // ---------- Pricing ----------
    function PricingTab(props) {
      const { ctx, t } = props
      const settings = useAsync(() => rpc(ctx, 'settings'), [ctx])
      const catalog = useAsync(() => rpc(ctx, 'price-catalog'), [ctx])
      const [filterText, setFilterText] = React.useState('')
      const [editingModel, setEditingModel] = React.useState(null)
      const [editAlias, setEditAlias] = React.useState('')
      const [editInput, setEditInput] = React.useState('')
      const [editOutput, setEditOutput] = React.useState('')
      const [editCacheRead, setEditCacheRead] = React.useState('')
      const [showMappingDrawer, setShowMappingDrawer] = React.useState(false)
      const [selectedObservedForMapping, setSelectedObservedForMapping] = React.useState(null)
      const [catalogSearch, setCatalogSearch] = React.useState('')
      const [priceBusy, setPriceBusy] = React.useState(false)
      const [priceMessage, setPriceMessage] = React.useState(null)

      if (settings.status !== 'ready' || catalog.status !== 'ready') {
        const pending = settings.status !== 'ready' ? settings : catalog
        return h(LoadPanel, { status: pending.status, error: pending.error, reload: pending.reload, t })
      }

      const snapshot = settings.value.priceSnapshot ?? { models: [], updatedModels: [] }
      const observed = catalog.value.observed ?? []
      const aliases = new Map((settings.value.aliases ?? []).map(a => [a.model_raw, a.canonical]))
      const overrides = new Map((settings.value.overrides ?? []).map(o => [o.model, o]))

      const bundledModels = catalog.value.bundled ?? []
      const updatedModels = catalog.value.updated ?? []
      const allCatalogModels = [...new Set([...updatedModels, ...bundledModels])].sort()

      const rows = observed.map(item => {
        const canonical = aliases.get(item.model) ?? null
        const override = overrides.get(item.model) ?? (canonical ? overrides.get(canonical) : null)
        const isCustom = Boolean(override)
        return {
          model: item.model,
          provider: item.provider,
          requests: item.requests,
          processingTokens: item.processingTokens,
          mappedCanonical: canonical,
          isCustom,
          inputRate: isCustom ? `$${(Number(override.input_nano) / 1000).toFixed(2)}` : (canonical ? '标准价' : '$0.14'),
          outputRate: isCustom ? `$${(Number(override.output_nano) / 1000).toFixed(2)}` : (canonical ? '标准价' : '$0.28'),
          cacheRate: isCustom && override.cache_read_nano ? `$${(Number(override.cache_read_nano) / 1000).toFixed(3)}` : '$0.014',
        }
      })

      const filteredObserved = rows.filter(o => o.model.toLowerCase().includes(filterText.toLowerCase()) || o.provider.toLowerCase().includes(filterText.toLowerCase()))

      const openMapping = (row) => {
        setSelectedObservedForMapping(row)
        setCatalogSearch(row.model.split(/[-_/]/)[0])
        setShowMappingDrawer(true)
      }

      const saveAlias = async (rawModel, targetModel) => {
        setPriceBusy(true)
        try {
          await rpc(ctx, 'set-alias', { model: rawModel, canonical: targetModel })
          await Promise.all([settings.reload(), catalog.reload()])
          setPriceMessage(`已成功关联【${rawModel}】➔【${targetModel}】`)
          setShowMappingDrawer(false)
        } catch (e) {
          alert(`保存映射失败: ${e.message}`)
        } finally {
          setPriceBusy(false)
        }
      }

      const saveOverridePrice = async (model, inputStr, outputStr, cacheStr) => {
        setPriceBusy(true)
        try {
          const inputNano = Math.round(parseFloat(inputStr || '0') * 1000)
          const outputNano = Math.round(parseFloat(outputStr || '0') * 1000)
          const cacheReadNano = cacheStr ? Math.round(parseFloat(cacheStr) * 1000) : undefined
          await rpc(ctx, 'set-override', { model, inputNano, outputNano, cacheReadNano })
          await Promise.all([settings.reload(), catalog.reload()])
          setEditingModel(null)
          setPriceMessage(`已保存【${model}】的自定义单价并触发重算！`)
        } catch (e) {
          alert(`保存单价失败: ${e.message}`)
        } finally {
          setPriceBusy(false)
        }
      }

      const refreshUpstreamPrices = async () => {
        setPriceBusy(true)
        try {
          await rpc(ctx, 'price-refresh-apply')
          await Promise.all([settings.reload(), catalog.reload()])
          setPriceMessage('已成功同步并应用 LiteLLM 最新价目库！')
        } catch (e) {
          alert(`刷新失败: ${e.message}`)
        } finally {
          setPriceBusy(false)
        }
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        // 顶部操作区
        h('div', { style: { ...cardStyle, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('div', null,
            h('h2', { style: { margin: 0, fontSize: 15 } }, '🎯 模型映射与即时计价表 (Smart Model Aliases & Live Pricing)'),
            h('p', { style: { ...mutedStyle, marginTop: 4 } }, `已观测 ${observed.length} 个模型 · 价目库 v${snapshot.version ?? '1'} (${allCatalogModels.length} 个上游模型)`),
            priceMessage ? h('p', { style: { color: '#10b981', fontSize: 12, fontWeight: 600, marginTop: 4 } }, priceMessage) : null,
          ),
          h('div', { style: { display: 'flex', gap: 10 } },
            h('input', {
              style: { ...inputStyle, width: 220 },
              placeholder: '搜索已观测模型 / 提供方…',
              value: filterText,
              onChange: (e) => setFilterText(e.target.value)
            }),
            h('button', { style: primaryButtonStyle, type: 'button', disabled: priceBusy, onClick: refreshUpstreamPrices }, priceBusy ? '同步中…' : '🔄 联网更新价目库'),
          )
        ),

        // 核心表格：集成映射关系与价格明细
        h('div', { style: { ...cardStyle, padding: 0, overflow: 'hidden' } },
          h('table', { style: { ...tableStyle, margin: 0 } },
            h('thead', { style: { background: 'var(--dsw-alias-bg-multi-select, #f8f9fa)' } },
              h('tr', null,
                h('th', { style: { ...thStyle, padding: '10px 16px' } }, '观测模型 (Observed)'),
                h('th', { style: thStyle }, '提供方'),
                h('th', { style: thStyle }, '调用量'),
                h('th', { style: { ...thStyle, color: 'var(--dsw-alias-state-business-primary, #4176e6)' } }, '映射到的标准模型 (LiteLLM ID)'),
                h('th', { style: thStyle }, '输入 / 1M'),
                h('th', { style: thStyle }, '输出 / 1M'),
                h('th', { style: thStyle }, '缓存 / 1M'),
                h('th', { style: { ...thStyle, textAlign: 'right', paddingRight: 16 } }, '操作'),
              )
            ),
            h('tbody', null,
              ...filteredObserved.map(row => {
                const isEditing = editingModel === row.model
                const isUnmapped = !row.mappedCanonical
                return h('tr', { key: `${row.provider}:${row.model}`, style: { background: isEditing ? 'var(--dsw-alias-interactive-bg-active, rgba(65,118,230,0.05))' : 'transparent' } },
                  h('td', { style: { ...tdStyle, padding: '12px 16px', fontWeight: 600 } },
                    row.model,
                    isUnmapped ? h('span', { style: { ...badgeStyle, background: '#fee2e2', color: '#dc2626', marginLeft: 6, fontSize: 10 } }, '未匹配') : null
                  ),
                  h('td', { style: tdStyle }, h('span', { style: badgeStyle }, row.provider)),
                  h('td', { style: tdStyle }, `${row.requests} 次`),
                  // 映射目标列 (突出显示与可点击更改)
                  h('td', { style: tdStyle },
                    isEditing
                      ? h('input', { style: { ...inputStyle, width: 180 }, value: editAlias, placeholder: '输入标准模型名…', onChange: e => setEditAlias(e.target.value) })
                      : row.mappedCanonical
                        ? h('span', { style: { fontWeight: 600, color: 'var(--dsw-alias-state-business-primary, #4176e6)', cursor: 'pointer' }, onClick: () => openMapping(row), title: '点击更改映射关系' }, `➔ ${row.mappedCanonical}`)
                        : h('button', { style: { ...buttonStyle, padding: '3px 8px', fontSize: 11, borderColor: '#f87171', color: '#dc2626' }, onClick: () => openMapping(row) }, '⚡ 关联价目模型')
                  ),
                  h('td', { style: tdStyle }, isEditing ? h('input', { style: { ...inputStyle, width: 70 }, value: editInput, onChange: e => setEditInput(e.target.value) }) : row.inputRate),
                  h('td', { style: tdStyle }, isEditing ? h('input', { style: { ...inputStyle, width: 70 }, value: editOutput, onChange: e => setEditOutput(e.target.value) }) : row.outputRate),
                  h('td', { style: tdStyle }, isEditing ? h('input', { style: { ...inputStyle, width: 70 }, value: editCacheRead, onChange: e => setEditCacheRead(e.target.value) }) : row.cacheRate),
                  h('td', { style: { ...tdStyle, textAlign: 'right', paddingRight: 16 } },
                    isEditing
                      ? h('div', { style: { display: 'inline-flex', gap: 6 } },
                          h('button', { style: { ...primaryButtonStyle, padding: '3px 8px', fontSize: 11 }, type: 'button', onClick: () => saveOverridePrice(row.model, editInput, editOutput, editCacheRead) }, '保存'),
                          h('button', { style: { ...buttonStyle, padding: '3px 8px', fontSize: 11 }, type: 'button', onClick: () => setEditingModel(null) }, '取消'),
                        )
                      : h('div', { style: { display: 'inline-flex', gap: 6 } },
                          h('button', { style: { ...buttonStyle, padding: '4px 8px', fontSize: 11 }, type: 'button', onClick: () => openMapping(row) }, '映射'),
                          h('button', { style: { ...buttonStyle, padding: '4px 8px', fontSize: 11 }, type: 'button', onClick: () => { setEditingModel(row.model); setEditAlias(row.mappedCanonical ?? ''); setEditInput(row.inputRate.replace('$', '')); setEditOutput(row.outputRate.replace('$', '')); setEditCacheRead(row.cacheRate.replace('$', '')) } }, '改价'),
                        )
                  ),
                )
              })
            )
          )
        ),

        // 弹出的智能映射搜索与匹配面板
        showMappingDrawer && selectedObservedForMapping ? h('div', {
          style: {
            position: 'fixed', right: 0, top: 0, bottom: 0, width: 440, background: 'var(--dsw-alias-bg-layer-1, #fff)',
            boxShadow: '-10px 0 30px rgba(0,0,0,0.15)', zIndex: 10000, padding: 20, display: 'flex', flexDirection: 'column', gap: 14,
            borderLeft: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))'
          }
        },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06))', paddingBottom: 10 } },
            h('h3', { style: { margin: 0, fontSize: 15 } }, '🔗 模型映射与对齐'),
            h('button', { style: closeStyle, onClick: () => setShowMappingDrawer(false) }, '✕'),
          ),
          h('div', { style: { background: 'var(--dsw-alias-bg-multi-select, #f8f9fa)', padding: 12, borderRadius: 8 } },
            h('div', { style: { fontSize: 11, color: '#888' } }, '当前观测模型 (Raw Observed)'),
            h('div', { style: { fontSize: 15, fontWeight: 700, margin: '2px 0' } }, selectedObservedForMapping.model),
            h('div', { style: { fontSize: 11, color: '#666' } }, `提供方: ${selectedObservedForMapping.provider} · 累计请求: ${selectedObservedForMapping.requests} 次`),
          ),
          h('div', null,
            h('label', { style: { fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 } }, '🔍 在 LiteLLM 价目库中搜索对应标准模型：'),
            h('input', {
              style: { ...inputStyle, width: '100%', boxSizing: 'border-box' },
              placeholder: '输入模型名称搜索 (如 deepseek, gpt-4o, claude, glm)...',
              value: catalogSearch,
              onChange: e => setCatalogSearch(e.target.value)
            })
          ),
          h('div', { style: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 } },
            h('div', { style: { fontSize: 11, color: '#888', marginBottom: 4 } }, '智能推荐候选 (点击立即应用)：'),
            ...allCatalogModels.filter(t => t.toLowerCase().includes(catalogSearch.toLowerCase())).slice(0, 50).map(target => h('div', {
              key: target,
              onClick: () => saveAlias(selectedObservedForMapping.model, target),
              style: {
                padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08))',
                background: 'var(--dsw-alias-bg-layer-1, #fff)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                transition: 'all 0.15s ease',
              },
              onMouseEnter: (e) => e.currentTarget.style.borderColor = 'var(--dsw-alias-state-business-primary, #4176e6)',
              onMouseLeave: (e) => e.currentTarget.style.borderColor = 'var(--dsw-alias-border-l1, rgba(0,0,0,0.08))',
            },
              h('div', null,
                h('strong', { style: { fontSize: 13, color: 'var(--dsw-alias-state-business-primary, #4176e6)' } }, target),
                h('div', { style: { fontSize: 11, color: '#888', marginTop: 2 } }, '官方标准定价 · 完整支持 Cache & Output 拆解'),
              ),
              h('span', { style: { fontSize: 12, color: '#888' } }, '选择 ➔'),
            ))
          ),
          h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06))', paddingTop: 10, display: 'flex', justifyContent: 'flex-end' } },
            h('button', { style: buttonStyle, onClick: () => setShowMappingDrawer(false) }, '关闭')
          )
        ) : null
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
                style: selectStyle, value: current.sidebarSummary ?? 'pools',
                onChange: (event) => save('sidebarSummary', event.target.value),
              },
                h('option', { value: 'pools' }, t('sidebarBars')),
                h('option', { value: 'badge' }, t('sidebarBadge')),
                h('option', { value: 'plain' }, t('sidebarPlain')),
                h('option', { value: 'hidden' }, t('sidebarHidden')),
              ),
            ),
          ),
        ),
      )
    }


    // ---------- v3 styles (injected class layer over theme variables) ----------
    const v3Css = `
      .tu3-wrap { max-width: 1180px; margin: 0 auto; padding: 18px 24px 60px; }
      .tu3-hero { display: grid; grid-template-columns: minmax(230px, .9fr) 2fr; gap: 12px; margin-bottom: 12px; }
      .tu3-pools { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding: 14px 16px; }
      .tu3-k { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--dsw-alias-label-secondary, #61666b); }
      .tu3-big { font-size: 40px; font-weight: 760; letter-spacing: -1.5px; line-height: 1.05; margin-top: 6px; font-variant-numeric: tabular-nums; }
      .tu3-card { border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.04)); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, #fff); }
      .tu3-act { display: flex; align-items: flex-end; gap: 2px; height: 150px; padding-top: 8px; }
      .tu3-bar { flex: 1; min-width: 8px; display: flex; flex-direction: column-reverse; border-radius: 3px 3px 1px 1px; overflow: hidden; cursor: pointer; background: var(--dsw-alias-bg-multi-select, #f5f6f7); border: 0; padding: 0; }
      .tu3-bar:hover, .tu3-bar.sel { outline: 2px solid var(--dsw-alias-label-primary, #0f1115); outline-offset: -2px; }
      .tu3-bar.dim { opacity: .22; }
      .tu3-axis { display: flex; justify-content: space-between; color: var(--dsw-alias-label-secondary, #61666b); font-size: 11px; margin-top: 6px; }
      .tu3-duo-track { height: 10px; border-radius: 999px; background: var(--dsw-alias-bg-multi-select, #f5f6f7); overflow: hidden; }
      .tu3-duo-fill { display: block; height: 100%; border-radius: 999px; }
      .tu3-duo-time { height: 3px; border-radius: 999px; background: var(--dsw-alias-bg-multi-select, #f5f6f7); margin-top: 3px; overflow: hidden; }
      .tu3-duo-time i { display: block; height: 100%; background: rgba(120,128,140,.55); border-radius: 999px; }
      .tu3-legend { display: flex; gap: 12px; color: var(--dsw-alias-label-secondary, #61666b); font-size: 11.5px; margin-left: auto; flex-wrap: wrap; }
      .tu3-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; vertical-align: baseline; }
      .tu3-tabs { display: flex; gap: 6px; margin: 2px 0 12px; flex-wrap: wrap; }
      .tu3-tab { border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); background: var(--dsw-alias-bg-layer-1, #fff); border-radius: 999px; padding: 7px 15px; cursor: pointer; color: var(--dsw-alias-label-secondary, #61666b); font-size: 13px; }
      .tu3-tab.on { background: var(--dsw-alias-label-primary, #0f1115); color: var(--dsw-alias-label-primary-foreground, #fff); border-color: transparent; }
      .tu3-rankrow { display: grid; grid-template-columns: 20px minmax(140px, 1.2fr) minmax(120px, 2fr) 84px 64px; gap: 10px; align-items: center; padding: 8px 6px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.04)); font-size: 12.5px; }
      .tu3-rankrow.first { background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 7%, transparent); border-radius: 8px; }
      .tu3-rankbar { height: 8px; background: var(--dsw-alias-bg-multi-select, #f5f6f7); border-radius: 999px; overflow: hidden; }
      .tu3-rankbar i { display: block; height: 100%; border-radius: 999px; }
      .tu3-num { text-align: right; font: 650 12px ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
      .tu3-spark { display: flex; align-items: flex-end; gap: 1px; height: 40px; }
      .tu3-spark i { flex: 1; min-width: 3px; border-radius: 1px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 35%, transparent); }
      .tu3-spark i.hl { background: var(--dsw-alias-state-business-primary, #4176e6); }
      .tu3-daydetail { margin-top: 10px; padding: 9px 13px; border-radius: 9px; background: var(--dsw-alias-bg-multi-select, #f5f6f7); font-size: 12.5px; }
      .tu3-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); border-radius: 8px; overflow: hidden; }
      .tu3-seg button { border: 0; background: transparent; padding: 5px 12px; cursor: pointer; color: var(--dsw-alias-label-secondary, #61666b); font-size: 12.5px; }
      .tu3-seg button.on { background: var(--dsw-alias-label-primary, #0f1115); color: var(--dsw-alias-label-primary-foreground, #fff); }
      .tu3-tag { display: inline-block; border-radius: 999px; padding: 2px 9px; font-size: 11px; white-space: nowrap; }
      .tu3-entry-bars { margin-top: 7px; width: 100%; }
      .tu3-entry-b1 { height: 5px; border-radius: 2px; background: var(--dsw-alias-bg-multi-select, #f5f6f7); overflow: hidden; }
      .tu3-entry-b1 i { display: block; height: 100%; border-radius: 2px; }
      .tu3-entry-b2 { height: 2px; margin-top: 3px; border-radius: 1px; background: var(--dsw-alias-bg-multi-select, #f5f6f7); overflow: hidden; }
      .tu3-entry-b2 i { display: block; height: 100%; background: rgba(120,128,140,.55); }
      .tu3-entry-cap { font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); margin-top: 4px; display: flex; justify-content: space-between; gap: 6px; }
      @media (max-width: 900px) {
        .tu3-hero { grid-template-columns: 1fr }
        .tu3-pools { grid-template-columns: 1fr 1fr }
        .tu3-rankrow { grid-template-columns: 20px minmax(110px, 1.2fr) minmax(70px, 1.4fr) 66px }
        .tu3-rankrow > :nth-child(5) { display: none }
      }
      @media (max-width: 640px) { .tu3-pools { grid-template-columns: 1fr } }
    `
    const POOL_COLORS = ['#3d6ee8', '#0f9d8f', '#d9822b', '#8a93a3', '#7a5af8', '#c2417f']
    const UNASSIGNED_COLOR = '#98a2b3'
    const poolColor = (pool) => pool?.color || (pool?.id === 'unassigned' ? UNASSIGNED_COLOR : POOL_COLORS[0])

    const LENSES = [
      ['value', 'lensValue'],
      ['token', 'lensToken'],
      ['req', 'lensReq'],
    ]
    const lensBy = (lens) => (lens === 'token' ? 'newComputeTokens' : lens === 'req' ? 'requests' : 'currentUsdNano')
    function lensMetric(cell, lens) {
      if (!cell) return 0
      if (lens === 'token') return Number(cell.newComputeTokens ?? 0)
      if (lens === 'req') return Number(cell.requests ?? 0)
      return Number(cell.currentUsdNano ?? 0)
    }
    function lensText(value, lens, t) {
      if (lens === 'token') return fmtTokens(value)
      if (lens === 'req') return String(Math.round(value))
      return fmtUsd(Math.round(value))
    }
    function lensLabel(t, lens) {
      return t(lens === 'token' ? 'lensToken' : lens === 'req' ? 'lensReq' : 'lensValue')
    }
    function fmtUsdAmount(value) {
      const usd = Number(value)
      if (!Number.isFinite(usd)) return '—'
      return `$${usd >= 100 ? usd.toFixed(0) : usd >= 10 ? usd.toFixed(1) : usd.toFixed(2)}`
    }
    function fmtQuota(value, unit) {
      if (value === null || value === undefined) return '—'
      return unit === 'usd' ? fmtUsdAmount(value) : fmtTokens(value)
    }

    // ---------- v3 data hook ----------
    function useDashboard(ctx, state, t) {
      const signature = JSON.stringify({ open: state.open, lens: state.lens, stack: state.stack, revision: state.analysisRevision })
      const [box, setBox] = React.useState({ status: 'loading', value: null, error: null })
      const reload = React.useCallback(() => {
        if (!state.open) return
        setBox((previous) => ({ ...previous, status: previous.value ? 'refreshing' : 'loading', error: null }))
        void rpc(ctx, 'query', {
          filter: { time: { preset: '30d' }, honesty: 'reported' },
          views: ['kpis', 'pools', 'seriesBy', 'rankings'],
          seriesBy: { groupBy: state.stack },
          ranking: { dimension: 'model', by: lensBy(state.lens), limit: 30 },
        }).then(
          (value) => setBox({ status: 'ready', value, error: null }),
          (error) => setBox((previous) => ({ ...previous, status: 'error', error })),
        )
      }, [ctx, signature, state.open, state.lens, state.stack])
      React.useEffect(() => {
        reload()
        if (!state.open) return undefined
        const timer = setInterval(reload, 15_000)
        return () => clearInterval(timer)
      }, [reload, state.open])
      return { ...box, reload }
    }

    function windowLabel(kind, t) {
      if (kind === '5h') return t('window5h')
      if (kind === '7d') return t('window7d')
      if (kind === 'month') return t('windowMonth')
      return t('windowNone')
    }

    function paceNote(pool, t) {
      if (pool.kind === 'credit') {
        if (pool.balanceUsd == null || pool.daysLeft === null) return t('creditNoExpiry', { name: pool.name })
        return t('creditRunway', {
          name: pool.name,
          expiry: pool.expiryDay ?? '—',
          days: pool.daysLeft,
          leftover: fmtUsdAmount(pool.leftoverAtExpiryUsd),
        })
      }
      if (pool.daysToCap !== null && pool.daysToCap !== undefined) {
        return t('poolCap', { rate: fmtQuota(pool.ratePerDay, pool.leftoverUnit), days: pool.daysToCap.toFixed(1), resetDays: 0 })
      }
      if (pool.windowKind === 'month' && pool.leftoverAtReset != null) {
        return t('poolLeftover', { rate: fmtQuota(pool.ratePerDay, pool.leftoverUnit), leftover: fmtQuota(pool.leftoverAtReset, pool.leftoverUnit), reset: pool.cycle?.resetLabel ?? '' })
      }
      if (pool.usedPct != null) return t('poolRolling', { window: windowLabel(pool.windowKind, t), pct: pool.usedPct.toFixed(0) })
      return t('poolNoCap')
    }

    function DuoMeter({ pool, t }) {
      if (pool.kind === 'credit') {
        const pctBurn = pool.pctBurnToExpiry
        return h('div', null,
          h('div', { className: 'tu3-duo-track' },
            h('i', { className: 'tu3-duo-fill', style: { width: `${pctBurn === null || pctBurn === undefined ? 0 : Math.min(100, pctBurn)}%`, background: poolColor(pool) } }),
          ),
          h('div', { style: { display: 'flex', justifyContent: 'space-between', color: C.textSecondary, fontSize: 12, marginTop: 5, gap: 8 } },
            h('span', null, t('creditRunwayBurn', { burn: fmtUsdAmount(pool.burnToExpiryUsd), balance: fmtUsdAmount(pool.balanceUsd), pct: pctBurn === null || pctBurn === undefined ? '—' : `${pctBurn.toFixed(0)}%` })),
            h('span', null, pool.expiryDay ?? ''),
          ),
        )
      }
      const thinPct = pool.secondaryUsedPct ?? pool.cycle?.elapsedPct
      const thinLabel = pool.secondaryUsedPct != null
        ? `${windowLabel(pool.secondaryWindowKind, t)} ${pool.secondaryUsedPct.toFixed(0)}%`
        : pool.cycle?.elapsedPct != null ? `${t('monthProgress')} ${pool.cycle.elapsedPct.toFixed(0)}%` : ''
      return h('div', null,
        h('div', { className: 'tu3-duo-track' },
          h('i', { className: 'tu3-duo-fill', style: { width: `${Math.min(100, pool.usedPct ?? 0)}%`, background: poolColor(pool) } }),
        ),
        thinPct != null ? h('div', { className: 'tu3-duo-time' }, h('i', { style: { width: `${Math.min(100, thinPct)}%` } })) : null,
        h('div', { style: { display: 'flex', justifyContent: 'space-between', color: C.textSecondary, fontSize: 12, marginTop: 5, gap: 8 } },
          h('span', null, pool.usedPct == null ? windowLabel(pool.windowKind, t) : `${windowLabel(pool.windowKind, t)} ${fmtQuota(pool.used, pool.quotaUnit)} / ${fmtQuota(pool.quotaValue, pool.quotaUnit)} (${pool.usedPct.toFixed(0)}%)`),
          thinLabel ? h('span', null, thinLabel) : null,
        ),
      )
    }

    function PoolsStrip({ pools, lens, t }) {
      return h('div', { className: 'tu3-card' },
        h('div', { className: 'tu3-pools' },
          pools.pools.map((pool) => h('div', { key: pool.id },
            h('div', { style: { fontSize: 12, color: C.textSecondary } },
              h('i', { className: 'tu3-dot', style: { background: poolColor(pool) } }),
              pool.name,
            ),
            h('div', { style: { font: '650 15px ui-monospace, SFMono-Regular, Menlo, monospace', margin: '2px 0 6px' } },
              pool.kind === 'sub'
                ? lensText(lensMetric(pool.kpis, lens === 'token' ? 'token' : lens === 'req' ? 'req' : 'value'), lens, t)
                : fmtUsdAmount(pool.balanceUsd)),
            h(DuoMeter, { pool, t }),
          )),
        ),
      )
    }

    function ActivityChart({ data, state, store, t }) {
      const series = data.seriesBy
      const groupLens = (id) => (id === 'other' ? t('otherGroup') : (series.groups.find((group) => group.id === id)?.label ?? id))
      const groupColor = (id) => {
        if (state.stack === 'pool') {
          const pool = data.pools.pools.find((entry) => entry.id === id)
          if (pool) return poolColor(pool)
          return id === 'unassigned' ? UNASSIGNED_COLOR : POOL_COLORS[2]
        }
        const models = data.rankings?.rows ?? []
        const index = models.findIndex((row) => row.key === id)
        return POOL_COLORS[(index >= 0 ? index : 0) % POOL_COLORS.length]
      }
      const dayTotals = series.days.map((day) => Object.values(day.groups).reduce((sum, cell) => sum + lensMetric(cell, state.lens), 0))
      const max = Math.max(1, ...dayTotals)
      const dimOthers = state.stack === 'model' && state.sub !== 'all'
        ? (id) => {
          const row = (data.rankings?.rows ?? []).find((entry) => entry.key === id)
          return row && row.poolId !== state.sub
        }
        : state.stack === 'pool' && state.sub !== 'all' ? (id) => id !== state.sub : null
      const selectedDay = state.day === null ? null : series.days.find((day) => day.key === state.day) ?? null
      return h('section', { className: 'tu3-card', style: { padding: '16px 20px', marginBottom: 12 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 2 } },
          h('h2', { style: { margin: 0, fontSize: 14 } }, t('activityTitle')),
          h('span', { className: 'tu3-seg' },
            h('button', { type: 'button', className: state.stack === 'pool' ? 'on' : '', onClick: () => store.update({ stack: 'pool' }) }, t('stackPool')),
            h('button', { type: 'button', className: state.stack === 'model' ? 'on' : '', onClick: () => store.update({ stack: 'model' }) }, t('stackModel')),
          ),
          h('div', { className: 'tu3-legend' },
            series.groups.map((group) => h('span', { key: group.id },
              h('i', { className: 'tu3-dot', style: { background: groupColor(group.id) } }),
              groupLens(group.id),
              state.sub !== 'all' && ((state.stack === 'pool' && group.id === state.sub) || dimOthers?.(group.id) === false) ? ' ◂' : '',
            )),
          ),
        ),
        h('div', { className: 'tu3-act' },
          series.days.map((day, index) => h('button', {
            key: day.key, type: 'button',
            className: `tu3-bar${state.day === day.key ? ' sel' : ''}`,
            title: `${day.key} · ${lensText(dayTotals[index], state.lens, t)}`,
            onClick: () => store.update({ day: state.day === day.key ? null : day.key }),
          },
            series.groups.map((group) => {
              const cell = day.groups[group.id]
              if (!cell) return null
              const dim = dimOthers !== null && dimOthers(group.id)
              return h('i', { key: group.id, style: { height: `${Math.max(2, lensMetric(cell, state.lens) / max * 138)}px`, background: groupColor(group.id), opacity: dim ? 0.22 : 1, display: 'block' } })
            }),
          )),
        ),
        h('div', { className: 'tu3-axis' }, series.days.length > 0
          ? [series.days[0].key, series.days[Math.floor(series.days.length / 2)].key, series.days[series.days.length - 1].key].map((key) => h('span', { key }, key))
          : null),
        selectedDay === null
          ? h('div', { className: 'tu3-daydetail', style: { color: C.textSecondary } }, t('activityHint'))
          : h('div', { className: 'tu3-daydetail' },
              h('b', null, selectedDay.key, ' · ', t('dayTotal'), ' ', lensText(dayTotals[series.days.findIndex((day) => day.key === selectedDay.key)], state.lens, t)),
              h('div', { style: { marginTop: 4 } },
                series.groups.map((group) => {
                  const cell = selectedDay.groups[group.id]
                  if (!cell) return null
                  return h('span', { key: group.id, style: { marginRight: 12 } },
                    h('i', { className: 'tu3-dot', style: { background: groupColor(group.id) } }),
                    groupLens(group.id), ' ', h('b', null, lensText(lensMetric(cell, state.lens), state.lens, t)),
                  )
                }),
              ),
            ),
      )
    }

    function ModelRank({ data, state, t }) {
      const rows = data.rankings?.rows ?? []
      if (rows.length === 0) return null
      const top = rows[0]
      const topValue = lensMetric(top, state.lens)
      const total = rows.reduce((sum, row) => sum + lensMetric(row, state.lens), 0)
      const poolName = (poolId) => {
        if (poolId === 'unassigned') return t('unassignedPool')
        return data.pools.pools.find((pool) => pool.id === poolId)?.name ?? poolId
      }
      return h('section', { className: 'tu3-card', style: { padding: '16px 20px', marginBottom: 12 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' } },
          h('h2', { style: { margin: 0, fontSize: 14 } }, `${t('modelRank')} · ${lensLabel(t, state.lens)}`),
          h('span', { style: { fontSize: 11, color: C.textSecondary } }, t('modelRankHint')),
        ),
        rows.slice(0, 10).map((row, index) => h('div', { key: row.key, className: `tu3-rankrow${index === 0 ? ' first' : ''}` },
          h('span', { style: { font: '400 15px/1 Georgia, serif', color: C.textSecondary } }, String(index + 1)),
          h('span', null,
            h('i', { className: 'tu3-dot', style: { background: state.stack === 'pool' ? poolColor(data.pools.pools.find((pool) => pool.id === row.poolId) ?? { id: row.poolId }) : POOL_COLORS[index % POOL_COLORS.length] } }),
            h('span', { title: row.key }, row.label),
            h('div', { style: { fontSize: 11, color: C.textSecondary } }, `@ ${poolName(row.poolId)}`),
          ),
          h('div', { className: 'tu3-rankbar' }, h('i', { style: { width: `${topValue > 0 ? lensMetric(row, state.lens) / topValue * 100 : 0}%`, background: state.stack === 'pool' ? poolColor(data.pools.pools.find((pool) => pool.id === row.poolId) ?? { id: row.poolId }) : POOL_COLORS[index % POOL_COLORS.length] } })),
          h('span', { className: 'tu3-num' }, lensText(lensMetric(row, state.lens), state.lens, t)),
          h('span', { className: 'tu3-num', style: { color: C.textSecondary } }, `${total > 0 ? (lensMetric(row, state.lens) / total * 100).toFixed(0) : 0}%`),
        )),
      )
    }

    function PoolTabs({ data, state, store, t }) {
      return h('div', { className: 'tu3-tabs' },
        h('button', { type: 'button', className: state.sub === 'all' ? 'on' : '', onClick: () => store.update({ sub: 'all' }) }, t('allPools')),
        data.pools.pools.map((pool) => h('button', {
          key: pool.id, type: 'button', className: state.sub === pool.id ? 'on' : '',
          onClick: () => store.update({ sub: pool.id }),
        }, h('i', { className: 'tu3-dot', style: { background: poolColor(pool) } }), pool.name)),
        data.pools.unassigned ? h('button', { type: 'button', className: state.sub === 'unassigned' ? 'on' : '', onClick: () => store.update({ sub: 'unassigned' }) },
          h('i', { className: 'tu3-dot', style: { background: UNASSIGNED_COLOR } }), t('unassignedPool')) : null,
      )
    }

    function PoolDetail({ data, state, t }) {
      if (state.sub === 'all') {
        return h('section', { className: 'tu3-card', style: { padding: '16px 18px' } },
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 } },
            data.pools.pools.map((pool) => h('div', { key: pool.id, style: { border: `1px solid ${C.borderFaint}`, borderRadius: 12, padding: '13px 15px' } },
              h('h3', { style: { margin: '0 0 8px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 } },
                h('i', { className: 'tu3-dot', style: { background: poolColor(pool) } }), pool.name,
                h('span', { style: { fontSize: 11, color: C.textSecondary, fontWeight: 400 } }, pool.kind === 'sub' ? (pool.priceUsdNano != null ? fmtUsd(pool.priceUsdNano) + '/mo' : '') : t('creditPool')),
              ),
              h(DuoMeter, { pool, t }),
              h('div', { style: { display: 'flex', gap: 14, flexWrap: 'wrap', color: C.textSecondary, fontSize: 12, marginTop: 8 } }, paceNote(pool, t)),
              h('div', { style: { display: 'flex', gap: 14, flexWrap: 'wrap', color: C.textSecondary, fontSize: 12, marginTop: 6 } },
                h('span', null, `${t('equivalent')} `, h('b', { style: { color: C.text, font: '650 12px ui-monospace, monospace' } }, fmtUsd(pool.kpis.cost.currentUsdNano))),
                h('span', null, `${t('requests')} `, h('b', { style: { color: C.text, font: '650 12px ui-monospace, monospace' } }, String(pool.kpis.requests))),
                h('span', null, `${t('newCompute')} `, h('b', { style: { color: C.text, font: '650 12px ui-monospace, monospace' } }, fmtTokens(pool.kpis.newComputeTokens))),
              ),
            )),
          ),
        )
      }
      const pool = state.sub === 'unassigned'
        ? { id: 'unassigned', name: t('unassignedPool'), kind: 'credit', kpis: data.pools.unassigned, balanceUsd: null, daysLeft: null }
        : data.pools.pools.find((entry) => entry.id === state.sub)
      if (!pool) return null
      const models = (data.rankings?.rows ?? []).filter((row) => row.poolId === state.sub)
      const scopedKpis = pool.kpis
      return h('section', { className: 'tu3-card', style: { padding: '18px 20px' } },
        h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 1.4fr', gap: 20 } },
          h('div', null,
            h('div', { className: 'tu3-k' }, pool.name, ' · ', pool.kind === 'sub' ? `${fmtUsd(pool.priceUsdNano)}/mo · ${t('resetAt')} ${pool.cycle?.resetLabel ?? ''}` : t('creditPool')),
            h('div', { style: { margin: '10px 0 6px', fontSize: 26, fontWeight: 760 } },
              pool.kind === 'sub' ? `${(pool.usedPct ?? 0).toFixed(0)}%` : fmtUsdAmount(pool.balanceUsd)),
            h(DuoMeter, { pool, t }),
            h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 16 } },
              h('div', { style: { background: C.bgMuted, borderRadius: 9, padding: '10px 12px' } }, t('equivalent'), h('b', { style: { display: 'block', font: '650 17px ui-monospace, monospace', marginTop: 2 } }, fmtUsd(scopedKpis.cost.currentUsdNano))),
              h('div', { style: { background: C.bgMuted, borderRadius: 9, padding: '10px 12px' } }, t('requests'), h('b', { style: { display: 'block', font: '650 17px ui-monospace, monospace', marginTop: 2 } }, String(scopedKpis.requests))),
              h('div', { style: { background: C.bgMuted, borderRadius: 9, padding: '10px 12px' } }, t('newCompute'), h('b', { style: { display: 'block', font: '650 17px ui-monospace, monospace', marginTop: 2 } }, fmtTokens(scopedKpis.newComputeTokens))),
              h('div', { style: { background: C.bgMuted, borderRadius: 9, padding: '10px 12px' } }, t('coverage'), h('b', { style: { display: 'block', font: '650 17px ui-monospace, monospace', marginTop: 2 } }, pct(scopedKpis.cost.coverage))),
            ),
            h('p', { style: { color: C.textSecondary, fontSize: 11, marginTop: 12 } }, paceNote(pool, t), ' · ', t('paceDisclaimer')),
          ),
          h('div', null,
            h('div', { className: 'tu3-k', style: { marginBottom: 6 } }, t('modelDetail')),
            h('table', { style: tableStyle },
              h('thead', null, h('tr', null,
                h('th', { style: thStyle }, t('colModel')),
                h('th', { style: { ...thStyle, textAlign: 'right' } }, t('requests')),
                h('th', { style: { ...thStyle, textAlign: 'right' } }, t('newCompute')),
                h('th', { style: { ...thStyle, textAlign: 'right' } }, t('equivalent')),
                h('th', { style: { ...thStyle, textAlign: 'right' } }, t('colShare')),
              )),
              h('tbody', null, models.map((row) => h('tr', { key: row.key },
                h('td', { style: tdStyle, title: row.key }, row.label),
                h('td', { style: { ...tdStyle, textAlign: 'right', font: '650 12px ui-monospace, monospace' } }, String(row.requests)),
                h('td', { style: { ...tdStyle, textAlign: 'right', font: '650 12px ui-monospace, monospace' } }, fmtTokens(row.newComputeTokens)),
                h('td', { style: { ...tdStyle, textAlign: 'right', font: '650 12px ui-monospace, monospace' } }, fmtUsd(row.cost.currentUsdNano)),
                h('td', { style: { ...tdStyle, textAlign: 'right', font: '650 12px ui-monospace, monospace' } }, `${(row.share * 100).toFixed(0)}%`),
              ))),
            ),
          ),
        ),
      )
    }

    function Unconfigured({ store, t }) {
      return h('section', { className: 'tu3-card', style: { padding: '40px 24px', textAlign: 'center', maxWidth: 520, margin: '40px auto' } },
        h('h2', { style: { margin: '0 0 8px', fontSize: 18 } }, t('unconfiguredTitle')),
        h('p', { style: { color: C.textSecondary, margin: '0 0 18px' } }, t('unconfiguredBody')),
        h('button', { type: 'button', style: primaryButtonStyle, onClick: () => store.update({ dataSection: 'plans' }) }, t('configurePlans')),
      )
    }

    function AccountsPanel({ ctx, t }) {
      const summary = useAsync(() => accountRpc(ctx, 'summary'), [ctx])
      const [observations, setObservations] = React.useState(null)
      const [refreshing, setRefreshing] = React.useState(false)
      const [busy, setBusy] = React.useState(null)
      const [login, setLogin] = React.useState(null)
      const [message, setMessage] = React.useState(null)
      const [drafts, setDrafts] = React.useState({ glm: '', ollamaKey: '', ollamaCookie: '' })
      const [cookieOptIn, setCookieOptIn] = React.useState(false)

      const refresh = (withCookie = false) => {
        setRefreshing(true)
        setMessage(null)
        void accountRpc(ctx, 'refresh-observations', { refresh: true, ollamaManualCookie: withCookie })
          .then(setObservations).catch(error => setMessage(error.message)).finally(() => setRefreshing(false))
      }
      const syncCloudModels = async () => {
        setBusy('sync:ollama-cloud')
        setMessage(null)
        try {
          const result = await accountRpc(ctx, 'sync-model-catalog', { providerId: 'ollama-cloud', refresh: true })
          const partial = result.failedDetails > 0 ? ` · ${result.failedDetails} ${t('modelDetailsIncomplete')}` : ''
          setMessage(`${t('cloudModelsSynced')}: ${result.modelCount}${partial}`)
          summary.reload()
          return result
        } catch (error) {
          setMessage(`${t('modelSyncFailed')}: ${error.message}`)
          throw error
        } finally {
          setBusy(null)
        }
      }
      const waitForLogin = async (provider, loginId) => {
        for (let attempt = 0; attempt < 120; attempt += 1) {
          await new Promise(resolvePromise => setTimeout(resolvePromise, 1500))
          const result = await accountRpc(ctx, 'connection-action', { provider, action: 'login-status', params: { loginId } })
          const status = result.status ?? result
          if (status.kind === 'succeeded') { setLogin(null); summary.reload(); return }
          if (status.kind === 'failed' || status.kind === 'cancelled') throw new Error(status.message ?? `Authorization ${status.kind}`)
        }
        throw new Error('Authorization timed out')
      }
      const connect = async (connection) => {
        const provider = connection.providerId
        setBusy(`connect:${provider}`)
        setMessage(null)
        try {
          const result = await accountRpc(ctx, 'connection-action', {
            provider,
            action: 'start-login',
            params: provider === 'openai-codex' || provider === 'xai' ? { provider } : {},
          })
          const challenge = result.challenge ?? result
          const authorizationUrl = challenge.verificationUri ?? challenge.authUrl
          if (authorizationUrl) window.open(authorizationUrl, '_blank', 'noopener,noreferrer')
          setLogin({ provider, ...challenge })
          await waitForLogin(provider, challenge.loginId)
        } catch (error) {
          setMessage(error.message)
        } finally {
          setBusy(null)
        }
      }
      const disconnect = async (connection) => {
        const provider = connection.providerId
        setBusy(`disconnect:${provider}`)
        setMessage(null)
        try {
          const action = provider === 'antigravity' && connection.connectionId ? 'remove-account' : 'logout'
          const params = action === 'remove-account' ? { accountId: connection.connectionId }
            : provider === 'openai-codex' || provider === 'xai' ? { provider } : {}
          await accountRpc(ctx, 'connection-action', { provider, action, params })
          summary.reload()
        } catch (error) {
          setMessage(error.message)
        } finally {
          setBusy(null)
        }
      }
      const activate = async (connection) => {
        setBusy(`activate:${connection.connectionId}`)
        setMessage(null)
        try {
          await accountRpc(ctx, 'connection-action', {
            provider: 'antigravity', action: 'activate-account', params: { accountId: connection.connectionId },
          })
          summary.reload()
        } catch (error) {
          setMessage(error.message)
        } finally {
          setBusy(null)
        }
      }
      const save = async (kind) => {
        setBusy(`save:${kind}`)
        setMessage(null)
        try {
          let synced = null
          if (kind === 'glm') await setCredential(ctx, 'ANTHROPIC_AUTH_TOKEN', drafts.glm.trim())
          else if (kind === 'ollamaKey') {
            await setCredential(ctx, 'OLLAMA_API_KEY', drafts.ollamaKey.trim())
            try {
              synced = await accountRpc(ctx, 'sync-model-catalog', { providerId: 'ollama-cloud', refresh: true })
            } catch (error) {
              setDrafts(current => ({ ...current, [kind]: '' }))
              setMessage(`${t('credentialSaved')} ${t('modelSyncFailed')}: ${error.message}`)
              summary.reload()
              return
            }
          } else {
            if (!cookieOptIn) throw new Error(t('cookieOptIn'))
            const cookieHeader = sanitizeOllamaCookieHeader(drafts.ollamaCookie)
            await setCredential(ctx, 'OLLAMA_SESSION_COOKIE', cookieHeader)
            await accountRpc(ctx, 'observe-provider', { providerId: 'ollama-cloud', mode: 'manual-cookie', refresh: true })
          }
          setDrafts(current => ({ ...current, [kind]: '' }))
          const partial = synced?.failedDetails > 0 ? ` · ${synced.failedDetails} ${t('modelDetailsIncomplete')}` : ''
          setMessage(synced ? `${t('credentialSaved')} ${t('cloudModelsSynced')}: ${synced.modelCount}${partial}` : t('credentialSaved'))
          summary.reload()
        } catch (error) {
          setMessage(error.message)
        } finally {
          setBusy(null)
        }
      }
      if (summary.status !== 'ready') return h('section', { className: 'tu3-card', style: { padding: 16, marginBottom: 12 } }, h(LoadPanel, { status: summary.status, error: summary.error, reload: summary.reload, t }))
      const oauthProviders = new Set(['openai-codex', 'xai', 'antigravity'])
      const ollamaModelCatalog = summary.value.modelCatalogs?.find(item => item.providerId === 'ollama-cloud')
      const messageIsSuccess = typeof message === 'string' && !message.includes(t('modelSyncFailed'))
        && (message.startsWith(t('credentialSaved')) || message.startsWith(t('cloudModelsSynced')))
      return h('section', { className: 'tu3-card', style: { padding: '16px 18px', marginBottom: 12 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 } },
          h('h2', { style: { margin: 0, fontSize: 15 } }, t('accountsTitle')),
          h('span', { style: badgeStyle }, t('officialObservations')),
          h('button', { type: 'button', style: { ...buttonStyle, marginLeft: 'auto' }, disabled: refreshing, onClick: () => refresh(cookieOptIn) }, refreshing ? t('loading') : t('refreshObservations')),
        ),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 9 } },
          summary.value.connections.map(connection => h('article', { key: `${connection.providerId}:${connection.connectionId ?? ''}`, style: { border: `1px solid ${C.borderFaint}`, borderRadius: 10, padding: '10px 12px' } },
            h('div', { style: { fontWeight: 650, fontSize: 13 } }, connection.displayName),
            h('div', { style: { color: C.textSecondary, fontSize: 11.5, marginTop: 5 } }, connection.quotaApplicable === false ? t('quotaNotApplicable') : connection.configured && connection.credentialStatus === 'unverified' ? t('configuredUnverified') : connection.configured ? t('connected') : t('notConnected')),
            connection.credentialRef ? h('code', { style: { ...badgeStyle, display: 'inline-block', marginTop: 7 } }, connection.credentialRef) : null,
            connection.providerId === 'ollama-cloud' ? h('div', { style: { color: C.textSecondary, fontSize: 11.5, marginTop: 7 } }, `${t('cloudModels')}: ${ollamaModelCatalog?.modelCount ?? 0}`) : null,
            connection.providerId === 'ollama-cloud' ? h('button', {
              type: 'button', style: { ...buttonStyle, marginTop: 8 },
              disabled: busy !== null || ollamaModelCatalog?.credentialConfigured !== true,
              onClick: () => { void syncCloudModels().catch(() => {}) },
            }, busy === 'sync:ollama-cloud' ? t('loading') : t('syncCloudModels')) : null,
            oauthProviders.has(connection.providerId) ? h('button', {
              type: 'button', style: { ...buttonStyle, marginTop: 8 }, disabled: busy !== null,
              onClick: () => connection.configured ? disconnect(connection) : connect(connection),
            }, connection.configured ? t('disconnect') : t('connect')) : null,
            connection.providerId === 'antigravity' && connection.active === false ? h('button', {
              type: 'button', style: { ...buttonStyle, marginTop: 8, marginLeft: 6 }, disabled: busy !== null,
              onClick: () => activate(connection),
            }, t('activate')) : null,
          )),
        ),
        login ? h('div', { style: { ...cardStyle, marginTop: 10 } },
          h('div', { style: sectionTitleStyle }, t('loginPending')),
          login.verificationUri || login.authUrl ? h('a', { href: login.verificationUri ?? login.authUrl, target: '_blank', rel: 'noreferrer' }, t('openAuthorization')) : null,
          login.userCode ? h('div', { style: { marginTop: 8 } }, `${t('deviceCode')}: `, h('code', { style: badgeStyle }, login.userCode)) : null) : null,
        h('div', { style: { ...cardStyle, marginTop: 12 } },
          h('h3', { style: sectionTitleStyle }, t('credentialImports')),
          h('p', { style: mutedStyle }, t('credentialHelp')),
          ...[
            ['glm', 'glmAuthorization', 'ANTHROPIC_AUTH_TOKEN'],
            ['ollamaKey', 'ollamaApiKey', 'OLLAMA_API_KEY'],
            ['ollamaCookie', 'ollamaCookie', 'OLLAMA_SESSION_COOKIE'],
          ].map(([kind, label, ref]) => h('div', { key: kind, style: { display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) auto', gap: 8, marginTop: 9 } },
            h('input', {
              type: 'password', autoComplete: 'off', style: inputStyle,
              value: drafts[kind], placeholder: `${t(label)} · ${ref}`,
              onChange: event => setDrafts(current => ({ ...current, [kind]: event.target.value })),
            }),
            h('button', { type: 'button', style: buttonStyle, disabled: busy !== null || drafts[kind].length === 0, onClick: () => save(kind) }, t('credentialSave')))),
          h('label', { style: { display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, fontSize: 12, color: C.textSecondary } },
            h('input', { type: 'checkbox', checked: cookieOptIn, onChange: event => setCookieOptIn(event.target.checked) }),
            h('span', null, t('cookieOptIn'))),
        ),
        observations ? h('div', { style: { ...cardStyle, marginTop: 10 } },
          h('div', { style: sectionTitleStyle }, `${t('officialObservations')} · ${new Date(observations.observedAt).toLocaleString()}`),
          ...(observations.adapters ?? []).map(item => h('div', { key: item.providerId, style: mutedStyle },
            `${item.providerId}: ${item.error ? item.error.code : (item.observation?.limits ?? []).map(limit => limit.percentUsed === null ? limit.mode : `${limit.percentUsed}%`).join(' · ') || 'ok'}`))) : null,
        message ? h('p', { style: messageIsSuccess ? mutedStyle : errorStyle }, message) : null,
        h('p', { style: { ...mutedStyle, marginTop: 10 } }, t('observationDisclaimer')),
      )
    }

    // ---------- v4 Accounts & Usage dashboard ----------
    function Dashboard({ ctx, store, state, t }) {
      const box = useDashboard(ctx, state, t)
      if (box.status === 'loading') return h('div', { className: 'tu3-wrap' }, h('p', { style: mutedStyle }, t('loading')))
      if (box.status === 'error') {
        return h('div', { className: 'tu3-wrap' }, h(LoadPanel, { status: 'error', error: box.error, reload: box.reload, t }))
      }
      const data = box.value
      if (!data.pools?.configured) return h('div', { className: 'tu3-wrap' }, h(AccountsPanel, { ctx, t }), h(Unconfigured, { store, t }))
      const pools = data.pools
      const totalValue = data.kpis.cost.currentUsdNano
      const heroValue = state.lens === 'value' ? totalValue
        : state.lens === 'token' ? data.kpis.newComputeTokens
        : data.kpis.requests
      const topModel = (data.rankings?.rows ?? [])[0]
      const topShare = topModel && totalValue > 0
        ? (state.lens === 'value' ? topModel.cost.currentUsdNano / totalValue : state.lens === 'token' ? topModel.newComputeTokens / data.kpis.newComputeTokens : topModel.requests / data.kpis.requests)
        : null
      return h('div', { className: 'tu3-wrap' },
        h(AccountsPanel, { ctx, t }),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 8px' } }, h('h2', { style: { margin: 0, fontSize: 15 } }, t('localLedger')), h('span', { style: badgeStyle }, t('last30'))),
        h('div', { className: 'tu3-hero' },
          h('section', { className: 'tu3-card', style: { padding: '18px 22px' } },
            h('div', { className: 'tu3-k' }, `${t('monthActivity')} · ${lensLabel(t, state.lens)}`),
            h('div', { className: 'tu3-big' }, lensText(heroValue, state.lens, t)),
            topModel ? h('div', { style: { color: C.textSecondary, marginTop: 6, fontSize: 12.5 } },
              `${t('topModel')}（${lensLabel(t, state.lens)}）：`, h('b', null, topModel.label), topShare !== null ? ` · ${(topShare * 100).toFixed(0)}%` : '') : null,
            h('div', { style: { marginTop: 12 } },
              h('span', { className: 'tu3-seg', role: 'tablist' },
                LENSES.map(([key, label]) => h('button', {
                  key, type: 'button', className: state.lens === key ? 'on' : '',
                  onClick: () => store.update({ lens: key }),
                }, t(label))),
              ),
            ),
          ),
          h(PoolsStrip, { pools, lens: state.lens, t }),
        ),
        h(ActivityChart, { data, state, store, t }),
        h(ModelRank, { data, state, t }),
        h(PoolTabs, { data, state, store, t }),
        h(PoolDetail, { data, state, t }),
        pools.unassigned ? h('p', { style: { color: C.textSecondary, fontSize: 12, marginTop: 8 } },
          t('unassignedNote', { tokens: fmtTokens(pools.unassigned.newComputeTokens), requests: String(pools.unassigned.requests) })) : null,
      )
    }

    // ---------- v3 dock panel (B) ----------
    function DockPanel({ ctx, store, state, t }) {
      const box = useDashboard(ctx, state, t)
      const openPlans = () => store.update({ mode: 'dash', dataSection: 'plans' })
      const body = () => {
        if (box.status !== 'ready') return h('p', { style: mutedStyle }, box.status === 'error' ? t('loadFailed') : t('loading'))
        const data = box.value
        if (!data.pools?.configured) {
          return h('div', { style: { padding: '28px 22px 36px', textAlign: 'left' } },
            h('p', { style: { ...mutedStyle, lineHeight: 1.65, margin: '0 0 18px', fontSize: 13.5 } }, t('unconfiguredBody')),
            h('button', { type: 'button', style: primaryButtonStyle, onClick: openPlans }, t('configurePlans')),
          )
        }
        const pools = data.pools
        const rows = data.rankings?.rows ?? []
        const top3 = rows.slice(0, 3)
        const heroValue = state.lens === 'value' ? data.kpis.cost.currentUsdNano : state.lens === 'token' ? data.kpis.newComputeTokens : data.kpis.requests
        const sparkDays = data.seriesBy?.days ?? []
        const sparkValues = sparkDays.map((day) => Object.values(day.groups).reduce((sum, cell) => sum + lensMetric(cell, state.lens), 0))
        const sparkMax = Math.max(1, ...sparkValues)
        const tightest = pools.pools.find((pool) => pool.id === pools.tightestPoolId) ?? null
        return h('div', { style: { padding: 12 } },
          h('div', { className: 'tu3-card', style: { overflow: 'hidden' } },
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', padding: '12px 14px 8px' } },
              h('span', { className: 'tu3-seg' },
                LENSES.map(([key, label]) => h('button', { key, type: 'button', className: state.lens === key ? 'on' : '', onClick: () => store.update({ lens: key }) }, t(label)))),
            ),
            h('div', { style: { display: 'flex', gap: 5, overflow: 'auto', padding: '8px 12px', borderBottom: `1px solid ${C.borderFaint}` } },
              h('button', { type: 'button', className: `tu3-tab${state.sub === 'all' ? ' on' : ''}`, style: { padding: '3px 10px', fontSize: 12 }, onClick: () => store.update({ sub: 'all' }) }, t('allPools')),
              pools.pools.map((pool) => h('button', {
                key: pool.id, type: 'button', className: `tu3-tab${state.sub === pool.id ? ' on' : ''}`,
                style: { padding: '3px 10px', fontSize: 12 }, onClick: () => store.update({ sub: pool.id }),
              }, h('i', { className: 'tu3-dot', style: { background: poolColor(pool) } }), pool.name.replace(/ (Plus|Pro|Max)$/, ''))),
            ),
            h('div', { style: { padding: '12px 14px 8px', textAlign: 'center' } },
              h('div', { style: { fontSize: 30, fontWeight: 760, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' } }, lensText(heroValue, state.lens, t)),
              h('div', { style: { color: C.textSecondary, fontSize: 11.5, marginTop: 2 } },
                state.sub === 'all'
                  ? `${t('allPools')} · ${lensLabel(t, state.lens)}`
                  : `${pools.pools.find((pool) => pool.id === state.sub)?.name ?? state.sub}`),
            ),
            h('div', { style: { padding: '4px 14px 10px' } },
              h('div', { className: 'tu3-k', style: { marginBottom: 6 } }, `${t('topModel')} · ${lensLabel(t, state.lens)}`),
              top3.map((row, index) => h('div', { key: row.key, style: { display: 'grid', gridTemplateColumns: 'minmax(90px, 1.1fr) minmax(50px, 1fr) 58px', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${C.borderFaint}`, fontSize: 12 } },
                h('span', { title: row.key },
                  h('i', { className: 'tu3-dot', style: { background: POOL_COLORS[index % POOL_COLORS.length] } }), row.label,
                  h('div', { style: { fontSize: 10.5, color: C.textSecondary } }, `@ ${row.poolId === 'unassigned' ? t('unassignedPool') : pools.pools.find((pool) => pool.id === row.poolId)?.name ?? row.poolId}`)),
                h('div', { className: 'tu3-rankbar' }, h('i', { style: { width: `${top3.length && lensMetric(top3[0], state.lens) > 0 ? lensMetric(row, state.lens) / lensMetric(top3[0], state.lens) * 100 : 0}%`, background: POOL_COLORS[index % POOL_COLORS.length] } })),
                h('span', { className: 'tu3-num' }, lensText(lensMetric(row, state.lens), state.lens, t)),
              )),
            ),
            h('div', { style: { padding: '4px 14px 12px' } },
              h('div', { className: 'tu3-k', style: { marginBottom: 6 } }, t('poolsMonthly')),
              pools.pools.map((pool) => h('div', { key: pool.id, style: { marginBottom: 9 } },
                h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: C.textSecondary, marginBottom: 4 } },
                  h('span', null, h('i', { className: 'tu3-dot', style: { background: poolColor(pool) } }), pool.name),
                  h('b', { style: { color: C.text, font: '650 11.5px ui-monospace, monospace' } }, pool.kind === 'sub' ? `${(pool.usedPct ?? 0).toFixed(0)}%` : fmtUsdAmount(pool.balanceUsd)),
                ),
                h(DuoMeter, { pool, t }),
              )),
            ),
            tightest ? h('div', { style: { padding: '0 14px 10px', color: C.textSecondary, fontSize: 11.5 } }, paceNote(tightest, t)) : null,
            h('div', { style: { padding: '0 14px 12px' } },
              h('div', { className: 'tu3-k', style: { marginBottom: 4 } }, t('sparkTitle')),
              h('div', { className: 'tu3-spark' },
                sparkValues.map((value, index) => h('i', {
                  key: sparkDays[index].key,
                  className: state.day === sparkDays[index].key ? 'hl' : '',
                  style: { height: `${Math.max(6, value / sparkMax * 40)}px`, cursor: 'pointer' },
                  title: `${sparkDays[index].key} · ${lensText(value, state.lens, t)}`,
                  onClick: () => store.update({ day: state.day === sparkDays[index].key ? null : sparkDays[index].key }),
                })),
              ),
            ),
          ),
        )
      }
      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${C.border}` } },
          h('b', { style: { fontSize: 15, letterSpacing: '-0.2px' } }, t('title')),
          h('span', { style: { marginLeft: 'auto' } }),
          h('button', { type: 'button', style: { ...buttonStyle, padding: '6px 12px', fontSize: 12 }, onClick: () => store.update({ mode: 'dash' }) }, t('fullscreen')),
          h('button', { type: 'button', style: { ...closeStyle, width: 32, height: 32 }, onClick: () => store.update({ open: false }) }, '✕'),
        ),
        h('div', { style: { flex: 1, overflow: 'auto', paddingBottom: 16 } }, body()),
      )
    }

    // ---------- plans editor ----------
    function PlansEditor({ ctx, store, t }) {
      const plans = useAsync(() => rpc(ctx, 'plans'), [ctx])
      const [editing, setEditing] = React.useState(null)
      const [rulesFor, setRulesFor] = React.useState(null)
      const [ruleDraft, setRuleDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      if (plans.status !== 'ready') return h(LoadPanel, { status: plans.status, error: plans.error, reload: plans.reload, t })
      const rows = plans.value ?? []
      const save = async (plan) => {
        setBusy(true)
        try { await rpc(ctx, 'save-plan', { plan }); plans.reload() } catch (error) { store.update({ error: error.message }) } finally { setBusy(false) }
      }
      const blank = { kind: 'sub', name: '', priceUsd: '', quotaUnit: 'newCompute', quotaValue: '', resetDay: 1, windowKind: 'month', window2Kind: 'none', window2QuotaValue: '', window2QuotaUnit: 'newCompute', balanceUsd: '', expiryDay: '' }
      const startEdit = (plan) => setEditing(plan === null ? { ...blank } : {
        id: plan.id, kind: plan.kind, name: plan.name, priceUsd: plan.priceUsdNano != null ? String(plan.priceUsdNano / 1e9) : '',
        quotaUnit: plan.quotaUnit ?? 'newCompute', quotaValue: plan.quotaValue != null ? String(plan.quotaValue) : '',
        resetDay: plan.resetDay ?? 1, windowKind: plan.windowKind ?? 'month',
        window2Kind: plan.window2Kind ?? 'none', window2QuotaValue: plan.window2QuotaValue != null ? String(plan.window2QuotaValue) : '',
        window2QuotaUnit: plan.window2QuotaUnit ?? 'newCompute',
        balanceUsd: plan.balanceUsdNano != null ? String(plan.balanceUsdNano / 1e9) : '',
        expiryDay: plan.expiryDay ?? '',
      })
      const submit = () => {
        const draft = editing
        save({
          id: draft.id, kind: draft.kind, name: draft.name, priceUsd: draft.priceUsd === '' ? undefined : Number(draft.priceUsd),
          quotaUnit: draft.quotaUnit, quotaValue: draft.quotaValue === '' ? undefined : Number(draft.quotaValue),
          resetDay: Number(draft.resetDay), windowKind: draft.windowKind, window2Kind: draft.window2Kind,
          window2QuotaValue: draft.window2QuotaValue === '' ? undefined : Number(draft.window2QuotaValue),
          window2QuotaUnit: draft.window2QuotaUnit,
          balanceUsd: draft.balanceUsd === '' ? undefined : Number(draft.balanceUsd), expiryDay: draft.expiryDay || undefined,
        })
        setEditing(null)
      }
      const submitRules = async () => {
        const entries = ruleDraft.split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => {
          const [provider, model, priority] = line.split(/\s*[|,]\s*/)
          return { matchProvider: provider || null, matchModel: model || null, priority: Number(priority || index) }
        })
        setBusy(true)
        try { await rpc(ctx, 'save-plan-rules', { planId: rulesFor.id, rules: entries }); plans.reload() } catch (error) { store.update({ error: error.message }) } finally { setBusy(false) }
        setRulesFor(null)
      }
      return h('div', null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 } },
          h('p', { style: { ...sectionTitleStyle, margin: 0 } }, t('plansTitle')),
          h('span', { style: badgeStyle }, `${rows.filter((row) => !row.archived).length} ${t('plansActive')}`),
          h('span', { style: { marginLeft: 'auto' } }),
          h('button', { type: 'button', style: primaryButtonStyle, onClick: () => startEdit(null) }, t('planAdd')),
        ),
        h('p', { style: { ...mutedStyle, lineHeight: 1.6, margin: '0 0 14px', maxWidth: 720 } }, t('planWindowHelp')),
        store.state.error ? h('p', { style: errorStyle }, store.state.error) : null,
        h('table', { style: tableStyle },
          h('thead', null, h('tr', null,
            h('th', { style: thStyle }, t('planName')), h('th', { style: thStyle }, t('planKind')),
            h('th', { style: thStyle }, t('planQuota')), h('th', { style: thStyle }, t('planWindow')),
            h('th', { style: thStyle }, t('planRules')), h('th', { style: thStyle }),
          )),
          h('tbody', null, rows.map((plan) => h('tr', { key: plan.id, style: plan.archived ? { opacity: 0.5 } : undefined },
            h('td', { style: tdStyle }, h('i', { className: 'tu3-dot', style: { background: plan.color || POOL_COLORS[0] } }), plan.name, plan.archived ? ` (${t('planArchived')})` : ''),
            h('td', { style: tdStyle }, plan.kind === 'sub' ? t('planKindSub') : t('planKindCredit')),
            h('td', { style: tdStyle }, plan.kind === 'sub' ? `${fmtQuota(plan.quotaValue, plan.quotaUnit)} ${plan.quotaUnit === 'usd' ? '' : 'tokens'}` : fmtUsd(plan.balanceUsdNano)),
            h('td', { style: tdStyle }, plan.kind === 'sub' ? `${windowLabel(plan.windowKind ?? 'month', t)}${(plan.windowKind ?? 'month') === 'month' ? ` · ${t('resetDay')} ${plan.resetDay}` : ''}${plan.window2Kind ? ` + ${windowLabel(plan.window2Kind, t)}` : ''}` : `${t('expiry')} ${plan.expiryDay ?? '—'}`),
            h('td', { style: tdStyle }, (plan.rules ?? []).map((rule) => `${rule.matchProvider ?? '*'}${rule.matchModel ? ` / ${rule.matchModel}` : ''}`).join('  ·  ') || '—'),
            h('td', { style: { ...tdStyle, whiteSpace: 'nowrap' } },
              h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 9px', fontSize: 12 }, onClick: () => startEdit(plan) }, t('edit')),
              h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 9px', fontSize: 12, marginLeft: 6 }, onClick: () => { setRulesFor(plan); setRuleDraft((plan.rules ?? []).map((rule) => `${rule.matchProvider ?? ''}|${rule.matchModel ?? ''}|${rule.priority}`).join('\n')) } }, t('planRulesEdit')),
              h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 9px', fontSize: 12, marginLeft: 6 }, onClick: () => { void rpc(ctx, 'archive-plan', { id: plan.id, archived: !plan.archived }).then(plans.reload).catch((error) => store.update({ error: error.message })) } }, plan.archived ? t('planRestore') : t('planArchive')),
            ),
          ))),
        ),
        editing !== null ? h('div', { style: { ...cardStyle, marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 } },
          h('label', { style: { fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 } }, t('planName'),
            h('input', { style: inputStyle, value: editing.name, onChange: (event) => setEditing({ ...editing, name: event.target.value }) })),
          h('label', { style: { fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 } }, t('planKind'),
            h('select', { style: selectStyle, value: editing.kind, onChange: (event) => setEditing({ ...editing, kind: event.target.value }) },
              h('option', { value: 'sub' }, t('planKindSub')), h('option', { value: 'credit' }, t('planKindCredit')))),
          h('label', { style: { fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 } }, t('planPrice'),
            h('input', { style: inputStyle, value: editing.priceUsd, placeholder: '20', onChange: (event) => setEditing({ ...editing, priceUsd: event.target.value }) })),
          editing.kind === 'sub' ? h('label', { style: { fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 } }, t('planWindow'),
            h('select', { style: selectStyle, value: editing.windowKind, onChange: (event) => setEditing({ ...editing, windowKind: event.target.value }) },
              h('option', { value: 'none' }, t('windowNone')),
              h('option', { value: '5h' }, t('window5h')),
              h('option', { value: '7d' }, t('window7d')),
              h('option', { value: 'month' }, t('windowMonth')))) : null,
          editing.kind === 'sub' && editing.windowKind !== 'none' ? h('label', { style: { fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 } }, t('planQuotaUnit'),
            h('select', { style: selectStyle, value: editing.quotaUnit, onChange: (event) => setEditing({ ...editing, quotaUnit: event.target.value }) },
              h('option', { value: 'newCompute' }, t('quotaNewCompute')), h('option', { value: 'usd' }, t('quotaUsd')))) : null,
          editing.kind === 'sub' && editing.windowKind !== 'none' ? h('label', { style: { fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 } }, t('planQuota'),
            h('input', { style: inputStyle, value: editing.quotaValue, placeholder: editing.windowKind === '5h' ? '例如 5 小时额度' : '60000000', onChange: (event) => setEditing({ ...editing, quotaValue: event.target.value }) })) : null,
          editing.kind === 'sub' && editing.windowKind === 'month' ? h('label', { style: { fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 } }, t('resetDay'),
            h('input', { style: inputStyle, value: editing.resetDay, onChange: (event) => setEditing({ ...editing, resetDay: event.target.value }) })) : null,
          editing.kind === 'sub' ? h('label', { style: { fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 } }, t('planWindow2'),
            h('select', { style: selectStyle, value: editing.window2Kind, onChange: (event) => setEditing({ ...editing, window2Kind: event.target.value }) },
              h('option', { value: 'none' }, t('windowNone')),
              h('option', { value: '5h' }, t('window5h')),
              h('option', { value: '7d' }, t('window7d')),
              h('option', { value: 'month' }, t('windowMonth')))) : null,
          editing.kind === 'sub' && editing.window2Kind !== 'none' ? h('label', { style: { fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 } }, t('planWindow2Quota'),
            h('input', { style: inputStyle, value: editing.window2QuotaValue, onChange: (event) => setEditing({ ...editing, window2QuotaValue: event.target.value }) })) : null,
          editing.kind === 'credit' ? h('label', { style: { fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 } }, t('planBalance'),
            h('input', { style: inputStyle, value: editing.balanceUsd, placeholder: '21.3', onChange: (event) => setEditing({ ...editing, balanceUsd: event.target.value }) })) : null,
          editing.kind === 'credit' ? h('label', { style: { fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 } }, t('expiry'),
            h('input', { style: inputStyle, value: editing.expiryDay, placeholder: '2026-10-15', onChange: (event) => setEditing({ ...editing, expiryDay: event.target.value }) })) : null,
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'end' } },
            h('button', { type: 'button', style: primaryButtonStyle, disabled: busy, onClick: submit }, t('save')),
            h('button', { type: 'button', style: buttonStyle, onClick: () => setEditing(null) }, t('cancel')),
          ),
        ) : null,
        rulesFor !== null ? h('div', { style: { ...cardStyle, marginTop: 14 } },
          h('p', { style: sectionTitleStyle }, `${t('planRulesFor')} ${rulesFor.name}`),
          h('p', { style: mutedStyle }, t('planRulesHint')),
          h('textarea', { style: { ...inputStyle, width: '100%', minHeight: 90, fontFamily: 'ui-monospace, monospace' }, value: ruleDraft, onChange: (event) => setRuleDraft(event.target.value) }),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
            h('button', { type: 'button', style: primaryButtonStyle, disabled: busy, onClick: submitRules }, t('save')),
            h('button', { type: 'button', style: buttonStyle, onClick: () => setRulesFor(null) }, t('cancel')),
          ),
        ) : null,
      )
    }

    // ---------- v3 data & settings corner ----------
    const DATA_SECTIONS = [['plans', 'plansTitle'], ['pricing', 'dataPricing'], ['data', 'dataImport'], ['settings', 'tabSettings']]
    function DataCorner({ ctx, store, state, t }) {
      return h('div', { style: contentStyle },
        h('div', { style: { display: 'flex', gap: 2, marginBottom: 16, flexWrap: 'wrap' } },
          DATA_SECTIONS.map(([key, label]) => h('button', {
            key, type: 'button', style: tabStyle(state.dataSection === key),
            onClick: () => store.update({ dataSection: key }),
          }, t(label))),
        ),
        state.dataSection === 'plans' ? h(PlansEditor, { ctx, store, t }) : null,
        state.dataSection === 'pricing' ? h(PricingTab, { ctx, t }) : null,
        state.dataSection === 'data' ? h(DataTab, { ctx, t, filter: { time: { preset: '30d' } } }) : null,
        state.dataSection === 'settings' ? h(SettingsTab, { ctx, t }) : null,
      )
    }

    // ---------- v3 overlay shell ----------
    function Overlay(props) {
      const { ctx, store, t } = props
      const state = useStore(store)
      React.useEffect(() => {
        if (!state.open) return undefined
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if (store.state.dataSection !== null) store.update({ dataSection: null })
          else store.update({ open: false })
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [state.open, store])

      if (!state.open) return null
      if (state.mode === 'dock') {
        return h('div', { style: { position: 'absolute', inset: 0, zIndex: 30, pointerEvents: 'auto', display: 'flex', justifyContent: 'flex-end', background: 'rgba(15,17,21,.14)' }, onClick: (event) => { if (event.target === event.currentTarget) store.update({ open: false }) } },
          h('style', null, v3Css),
          h('div', { style: { width: 420, maxWidth: '92vw', height: '100%', background: C.bgBase, borderLeft: `1px solid ${C.border}`, color: C.text, display: 'flex', flexDirection: 'column' }, role: 'dialog', 'aria-label': t('title'), onClick: (event) => event.stopPropagation() },
            h(DockPanel, { ctx, store, state, t }),
          ),
        )
      }
      return h('div', { style: overlayStyle, role: 'dialog', 'aria-label': t('title') },
        h('style', null, v3Css),
        h('div', { style: headerStyle },
          h('p', { style: titleStyle }, t('title')),
          h('span', { className: 'tu3-seg', style: { marginLeft: 14 } },
            LENSES.map(([key, label]) => h('button', { key, type: 'button', className: state.lens === key ? 'on' : '', onClick: () => store.update({ lens: key }) }, t(label)))),
          h('span', { style: badgeStyle, marginLeft: 12 }, t('last30')),
          h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
            h('button', { type: 'button', style: buttonStyle, onClick: () => store.update({ dataSection: state.dataSection === null ? 'plans' : null }) }, state.dataSection === null ? t('dataCorner') : t('backToDash')),
            h('button', { type: 'button', style: buttonStyle, onClick: () => store.update({ mode: 'dock', dataSection: null }) }, t('dockMode')),
            h('button', { type: 'button', style: closeStyle, onClick: () => store.update({ open: false }), 'aria-label': t('close') }, '✕'),
          ),
        ),
        state.dataSection !== null
          ? h(DataCorner, { ctx, store, state, t })
          : h('div', { style: { ...contentStyle, position: 'relative' } }, h(Dashboard, { ctx, store, state, t })),
      )
    }

    function UsageGlyph() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true, style: { flexShrink: 0, marginTop: 2 } },
        h('rect', { x: 1.5, y: 7, width: 3, height: 7, rx: 1, fill: 'currentColor' }),
        h('rect', { x: 6.5, y: 3.5, width: 3, height: 10.5, rx: 1, fill: 'currentColor' }),
        h('rect', { x: 11.5, y: 1, width: 3, height: 13, rx: 1, fill: 'currentColor' }),
      )
    }

    // ---------- sidebar entry (micro indicator) ----------
    // v3 default is the CodexBar dual-bar. Legacy tokens/cost settings map to plain text.
    function entryStyle(mode) {
      if (mode === 'badge') return 'badge'
      if (mode === 'hidden') return 'hidden'
      if (mode === 'plain' || mode === 'cost') return 'plain'
      // 'pools' and the legacy default 'tokens' both render as dual bars.
      return 'bars'
    }

    function SidebarEntry(props) {
      const { ctx, store, t } = props
      const state = useStore(store)
      const wide = props?.wide !== false
      const mode = state.settingsData?.sidebarSummary ?? 'pools'
      const styleKind = entryStyle(mode)
      React.useEffect(() => {
        const load = () => {
          void rpc(ctx, 'entry-summary').then((entrySummary) => store.update({ entrySummary })).catch(() => {})
          void rpc(ctx, 'settings').then((data) => store.update({ settingsData: data.settings })).catch(() => {})
          if (styleKind === 'plain') void rpc(ctx, 'overview').then((overview) => store.update({ overview })).catch(() => {})
        }
        load()
        const timer = setInterval(load, 60_000)
        return () => clearInterval(timer)
      }, [ctx, store, styleKind])
      const summary = state.entrySummary
      const today = state.overview?.today
      const tightest = summary?.tightest ?? null
      const usedPct = tightest?.usedPct ?? 0
      const risk = tightest != null && usedPct >= 90
      const pctLabel = tightest != null ? `${usedPct.toFixed(0)}%` : '—'
      const title = t('entryTitle')
      const caption = tightest != null && summary?.month
        ? `${t('tightestPool')} ${tightest.name} · ${t('resetIn')} ${summary.month.daysLeft}${t('dayUnit')}`
        : t('entryUnconfigured')
      const aria = `${title} ${pctLabel} ${caption}`
      const open = () => store.update({ open: true, mode: 'dock' })

      if (!wide) {
        return h('button', { type: 'button', style: footerButtonStyle(), 'aria-label': aria, title: aria, onClick: open },
          h(UsageGlyph),
        )
      }

      if (styleKind === 'hidden') {
        return h('button', { type: 'button', style: footerButtonStyle(), 'aria-label': title, title: title, onClick: open },
          h(UsageGlyph),
          h('span', null, title),
        )
      }

      if (styleKind === 'plain') {
        const plain = mode === 'cost' ? fmtUsd(today?.costUsdNano ?? null) : mode === 'tokens' && today ? fmtTokens(today.processingTokens ?? 0) : title
        return h('button', { type: 'button', style: footerButtonStyle(), 'aria-label': `${title} ${plain}`, title: title, onClick: open },
          h(UsageGlyph),
          h('span', { style: { minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', null, title),
            h('span', { style: { marginLeft: 'auto', opacity: 0.7 } }, '↗'),
          ),
        )
      }

      if (styleKind === 'badge') {
        return h('button', { type: 'button', style: footerButtonStyle(), 'aria-label': aria, title: aria, onClick: open },
          h(UsageGlyph),
          h('span', { style: { minWidth: 0, flex: 1 } },
            h('span', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              tightest ? h('i', { className: 'tu3-dot', style: { background: tightest.color || 'var(--dsw-alias-state-business-primary, #4176e6)' } }) : null,
              h('span', { style: { fontWeight: 600, color: C.text } }, title),
              h('span', {
                style: {
                  marginLeft: 'auto', font: '650 11px ui-monospace, SFMono-Regular, Menlo, monospace',
                  borderRadius: 999, padding: '2px 8px',
                  background: risk ? 'var(--dsw-alias-state-error-bg, #fee2e2)' : C.bgMuted,
                  color: risk ? 'var(--dsw-alias-state-error-primary, #ec1313)' : C.textSecondary,
                },
              }, pctLabel),
            ),
            h('span', { style: { display: 'block', fontSize: 10, color: C.textSecondary, marginTop: 3 } }, caption),
          ),
        )
      }

      // Dual bars — the v3 default, matching the CodexBar prototype.
      return h('button', { type: 'button', style: footerButtonStyle(), 'aria-label': aria, title: aria, onClick: open },
        h('style', null, v3Css),
        h(UsageGlyph),
        h('span', { style: { minWidth: 0, flex: 1 } },
          h('span', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', { style: { fontWeight: 600, color: C.text } }, title),
            h('span', { style: { marginLeft: 'auto', font: '650 11px ui-monospace, SFMono-Regular, Menlo, monospace', color: risk ? 'var(--dsw-alias-state-error-primary, #ec1313)' : C.text } }, pctLabel),
          ),
          h('span', { style: { display: 'block', marginTop: 7 } },
            h('span', { style: { display: 'block', height: 5, borderRadius: 2, background: C.bgMuted, overflow: 'hidden' } },
              h('i', { style: { display: 'block', height: '100%', width: `${Math.min(100, usedPct)}%`, borderRadius: 2, background: risk ? 'var(--dsw-alias-state-error-primary, #ec1313)' : (tightest?.color || 'var(--dsw-alias-state-business-primary, #4176e6)') } })),
            h('span', { style: { display: 'block', height: 2, marginTop: 3, borderRadius: 1, background: C.bgMuted, overflow: 'hidden' } },
              h('i', { style: { display: 'block', height: '100%', width: `${Math.min(100, summary?.month?.elapsedPct ?? 0)}%`, background: 'rgba(120,128,140,.55)' } })),
          ),
          h('span', { style: { display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 10, color: C.textSecondary, marginTop: 4 } },
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, caption),
            summary?.month ? h('span', { style: { flexShrink: 0 } }, `${t('monthProgress')} ${summary.month.elapsedPct.toFixed(0)}%`) : null,
          ),
        ),
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
