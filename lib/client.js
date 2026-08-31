/**
 * Browser half of dsh-token-usage: a sidebar entry that doubles as a micro
 * usage indicator (tightest account + window progress), a right-docked
 * compact panel, and a full-frame objective dashboard. The v5 interaction is
 * account-first: every configured connection becomes an account, official
 * allowance windows lead the meters, and the local ledger is a clearly
 * labeled complementary view. All data comes from the host over loopback
 * channels; the client never touches the network and never sees conversation
 * content.
 */

window.__ModuleLoader__.load({
  id: 'dsh-token-usage',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    // Single allowlisted display link (guide card); the client never talks to
    // the network itself.
    const OLLAMA_SETTINGS_URL = 'https://ollama.com/settings'
    const CHANNEL = '/token-usage'
    const ACCOUNT_CHANNEL = '/account-usage'
    const NS = 'dsh-token-usage'

    const en = {
      unitsPercentHelp: 'Quota math runs locally for tokens/USD/requests with exact or user-estimate values; percent and credits stay official-observed only.',

      nav: 'Accounts & Usage',
      title: 'DSH Accounts & Usage',
      accountsTitle: 'Provider connections',
      officialObservations: 'Official observations',
      localLedger: 'Local usage ledger',
      connected: 'Connected',
      notConnected: 'Not connected',
      configuredUnverified: 'Configured · key status unverified',
      quotaNotApplicable: 'Quota not applicable',
      refreshObservations: 'Refresh observations',
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
      ollamaGuide: 'Bring the official usage percentages (optional, explicit opt-in)',
      ollamaStep1: 'Open ollama.com settings (button below) while signed in.',
      ollamaStep2: 'DevTools → Application → Cookies → copy the session cookie value.',
      ollamaStep3: 'Paste it below as session=<value> (or the whole Cookie header), tick the consent box and save. Marked official page (brittle).',
      ollamaOpenSettings: 'Open ollama.com settings page',
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
      dataPricing: 'Pricing', dataImport: 'Import & data', dataProfile: 'Profile',
      lensValue: 'Value $', lensToken: 'Tokens', lensReq: 'Requests', lensCycleHint: 'Click to cycle the metric lens', last30: 'last 30 days', monthActivity: 'Monthly activity',
      topModel: 'Top model', activityTitle: 'Activity · last 30 days', stackPool: 'Stack by account', stackModel: 'Stack by model',
      activityHint: 'Click a bar to inspect that day.', dayTotal: 'total', otherGroup: 'other', modelRank: 'Model ranking',
      modelRankHint: 'same usage, different lens — the data decides', allPools: 'All accounts', unassignedPool: 'Unassigned · metered',
      quotaUsed: 'quota used', monthProgress: 'month', poolsMonthly: 'Accounts this cycle', sparkTitle: 'Last 30 days · click a bar',
      modelDetail: 'Models in this account', equivalent: 'Equivalent', newCompute: 'New compute', coverage: 'Coverage', resetAt: 'resets',
      colShare: 'Share', paceDisclaimer: 'extrapolation is plain average-rate arithmetic, not a forecast',
      poolCap: 'at {rate}/day for the last 7 days, the cap is reached in {days} days', poolLeftover: 'at {rate}/day, ≈{leftover} left over at reset ({reset})',
      creditRunway: 'at the last-30-day rate, ≈{leftover} remaining at expiry ({expiry}, {days} days left)', creditRunwayBurn: '{burn} of {balance} burned by expiry ({pct})',
      creditNoExpiry: '{name}: prepaid balance, no expiry set',
      unassignedNote: 'Unattributed (last 30 days): {tokens} new-compute tokens across {requests} requests — one rule assigns them.',
      assignNow: 'Create account from traffic',
      fullscreen: 'Full ↗', dockMode: 'Dock', tightestPool: 'tightest', resetIn: 'reset', dayUnit: 'd',
      accountsTab: 'Accounts', accountsCount: 'accounts', accountAdd: 'Add account', accountNameLabel: 'Name', accountsOrderHint: 'Drag rows to set the display order in the dock and overview.',
      accountKindLabel: 'Kind', kindSubscription: 'Subscription', kindPrepaid: 'Prepaid wallet', kindTrackOnly: 'Track only',
      accountPrice: 'Price USD / month', accountBalance: 'Balance USD', accountExpiry: 'Expiry (YYYY-MM-DD)', accountResetDay: 'Reset day',
      accountRules: 'Attribution rules', accountRulesHint: 'One rule per line: provider-glob | model-glob | priority (e.g. openai* | gpt-* | 0). First match wins; unmatched traffic stays unassigned.',
      accountArchived: 'archived', archive: 'Archive', restore: 'Restore', edit: 'Edit', legacyNote: 'legacy v5 plan — read-only here; archive still works',
      originConnection: 'connection', originTemplate: 'template', originManual: 'manual', originLegacy: 'legacy v5',
      windowRollingHours: 'rolling {hours}h', windowRollingDays: 'rolling {days}d', windowDaily: 'daily', windowMonthly: 'calendar month', windowFixed: 'fixed cycle', windowTerm: 'subscription term',
      modeExact: 'exact', modeDynamic: 'dynamic', modeUnpublished: 'unpublished', modeManual: 'user estimate',
      sourceOfficialApi: 'official API', sourceOfficialPlugin: 'official client API', sourceOfficialUi: 'official page (brittle)', sourceOfficialResponse: 'official response', sourceLocal: 'local ledger', sourceManual: 'manual',
      officialSection: 'Official allowance', localSection: 'Local ledger · DSH-observed', billingSection: 'Billing', attributionSection: 'Attribution', connectionSection: 'Connection', advancedSection: 'Advanced',
      observedAtLabel: 'observed', resetsInLabel: 'resets in', noOfficial: 'No official observation yet', noOfficialBody: 'Connect the account or refresh; official percentages appear here when the provider reports them.',
      noQuotaDeclared: 'No local quota declared — usage is tracked only',
      onboardingTitle: 'Build your accounts', onboardingBody: 'Accounts appear automatically for signed-in connections. Create more from templates or from your observed traffic — official allowance and local usage show up immediately.',
      onboardingEmpty: 'No providers connected yet. Paste a key below or add a manual account.',
      suggestTitle: 'Suggested from your traffic', templatePick: 'From template', tierLabel: 'Plan tier', priceOptional: 'Price USD / month (optional)',
      rulesLabel: 'Attribution rules (pre-checked from observed traffic)', create: 'Create account',
      created: 'Account created', createFailed: 'Creating the account failed',
      customTemplate: 'Custom', customName: 'Account name',
      entryTitle: 'Accounts & Usage', entryUnconfigured: 'No accounts yet',
      dataCorner: 'Data & settings', backToDash: '← Dashboard',
      insightBack: '← All accounts', insightTrend: '30-day trend', officialHistory: 'Observation history',
      noModels: 'No attributed models yet',
      limitValueLabel: 'value', limitUnitLabel: 'unit', limitModeLabel: 'mode', limitWindowLabel: 'window',
      addLimit: 'Add window', removeLimit: 'Remove',
      unitsTokens: 'tokens', unitsUsd: 'USD', unitsRequests: 'requests', unitsPercent: 'percent', unitsCredits: 'plan credits',
      windowsKindRolling: 'rolling', windowsKindFixed: 'fixed', windowsKindBilling: 'billing cycle', windowsKindRate: 'rate',
      secondsLabel: 'window seconds',
      priceCatalogSynced: 'Upstream price catalog applied.',
      pricingTitle: 'Model mapping & live pricing', pricingObservedModels: 'observed models', pricingCatalogV: 'price catalog',
      pricingSearchPh: 'Search observed models / providers…', pricingRefresh: 'Update catalog from upstream', pricingRefreshing: 'Syncing…',
      colObserved: 'Observed model', colProvider: 'Provider', colCalls: 'Calls', colMapped: 'Mapped catalog model (LiteLLM)',
      colInput: 'Input / 1M', colOutput: 'Output / 1M', colCache: 'Cache / 1M', colActions: 'Actions',
      unmapped: 'unmapped', mapBtn: 'Map', priceBtn: 'Price', mappingTitle: 'Model mapping', mappingCurrent: 'Currently observed',
      mappingProvider: 'Provider', mappingRequests: 'cumulative requests', mappingSearchLabel: 'Search the LiteLLM catalog for the matching model:',
      mappingCandidates: 'Smart candidates (click to apply):', mappingChoose: 'choose →', mappingFooter: 'This mapping only affects price matching; it never rewrites ledger facts.',
      inputPlaceholder: 'catalog model name…',
    }

    const zh = {
      unitsPercentHelp: '额度换算只对 token/USD/请求数 且 精确/用户估计 口径做本地计算;百分比与积分只来自官方观察。',

      nav: '账户与用量',
      title: 'DSH 账户与用量',
      accountsTitle: '提供方连接',
      officialObservations: '官方观察',
      localLedger: '本地用量账本',
      connected: '已连接',
      notConnected: '未连接',
      configuredUnverified: '已配置 · Key 状态未验证',
      quotaNotApplicable: '额度不适用',
      refreshObservations: '刷新观察',
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
      ollamaGuide: '把官方用量百分比带进来（可选，显式 opt-in）',
      ollamaStep1: '打开 ollama.com 设置页（下方按钮），确认已登录。',
      ollamaStep2: '浏览器 DevTools → Application → Cookies → 复制 session 的值。',
      ollamaStep3: '在下方粘贴为 session=<值>（或整段 Cookie Header），勾选同意后保存。观察标记为官方页面（脆弱）。',
      ollamaOpenSettings: '打开 ollama.com 设置页',
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
      dataPricing: '定价', dataImport: '导入与数据', dataProfile: '个人设置',
      lensValue: '等值 $', lensToken: 'Token', lensReq: '请求', lensCycleHint: '点击切换口径', last30: '近 30 天', monthActivity: '本月活动',
      topModel: '主力模型', activityTitle: '活动 · 近 30 天', stackPool: '按账户堆叠', stackModel: '按模型堆叠',
      activityHint: '点击柱形查看当日。', dayTotal: '合计', otherGroup: '其他', modelRank: '模型排行',
      modelRankHint: '同一份量，换口径就换主力 —— 数据说了算', allPools: '全部账户', unassignedPool: '未归属 · 按量',
      quotaUsed: '额度已用', monthProgress: '月进度', poolsMonthly: '本周期各账户', sparkTitle: '近 30 天 · 点柱看当日',
      modelDetail: '账户内模型', equivalent: '等值', newCompute: '新计算', coverage: '覆盖', resetAt: '重置',
      colShare: '占比', paceDisclaimer: '外推仅为算术平均速率，非预测模型',
      poolCap: '按近 7 天 {rate}/天，{days} 天后达到额度', poolLeftover: '按 {rate}/天，重置时约剩 {leftover}（{reset}）',
      creditRunway: '按近 30 天速率，到期约剩 {leftover}（{expiry}，剩 {days} 天）', creditRunwayBurn: '到期消耗 {burn} / 余额 {balance}（{pct}）',
      creditNoExpiry: '{name}：预付余额，未设到期日',
      unassignedNote: '未归属（近 30 天）：{tokens} 新计算 token、{requests} 次请求 —— 一条规则即可归入。',
      assignNow: '从未归属流量建账户',
      fullscreen: '全屏 ↗', dockMode: '停靠', tightestPool: '最紧一池', resetIn: '重置', dayUnit: '天',
      accountsTab: '账户', accountsCount: '个账户', accountAdd: '添加账户', accountNameLabel: '名称', accountsOrderHint: '拖动行可调整 dock 与总览中的显示顺序。',
      accountKindLabel: '类型', kindSubscription: '订阅', kindPrepaid: '预付钱包', kindTrackOnly: '只记账',
      accountPrice: '月费 USD', accountBalance: '余额 USD', accountExpiry: '到期日（YYYY-MM-DD）', accountResetDay: '重置日',
      accountRules: '归因规则', accountRulesHint: '每行一条：provider 通配 | 模型通配 | 优先级（如 openai* | gpt-* | 0）。按优先级取首个匹配；未匹配进入「未归属」。',
      accountArchived: '已归档', archive: '归档', restore: '恢复', edit: '编辑', legacyNote: 'v5 旧计费池 —— 此处只读，归档仍可用',
      originConnection: '连接', originTemplate: '模板', originManual: '手工', originLegacy: 'v5 旧池',
      windowRollingHours: '{hours} 小时滚动', windowRollingDays: '{days} 天滚动', windowDaily: '每日', windowMonthly: '自然月', windowFixed: '固定周期', windowTerm: '订阅期',
      modeExact: '精确', modeDynamic: '动态', modeUnpublished: '未公布', modeManual: '用户估计',
      sourceOfficialApi: '官方接口', sourceOfficialPlugin: '官方客户端接口', sourceOfficialUi: '官方页面（脆弱）', sourceOfficialResponse: '官方响应', sourceLocal: '本地账本', sourceManual: '手工',
      officialSection: '官方额度', localSection: '本地账本 · DSH 观察', billingSection: '计费', attributionSection: '归因', connectionSection: '连接', advancedSection: '高级设置',
      observedAtLabel: '观察于', resetsInLabel: '重置还需', noOfficial: '尚未有官方观察', noOfficialBody: '连接账户或刷新后，官方百分比会出现在这里。',
      noQuotaDeclared: '未声明本地额度 —— 只记录用量',
      onboardingTitle: '建立你的账户', onboardingBody: '已登录的连接会自动成为账户。也可以从模板或实测流量创建 —— 官方额度与本地用量立即出现。',
      onboardingEmpty: '还没有已连接的提供方。粘贴 Key 或先建一个手工账户。',
      suggestTitle: '根据你的流量建议', templatePick: '从模板', tierLabel: '套餐档位', priceOptional: '月费 USD（可选）',
      rulesLabel: '归因规则（按实测流量预选）', create: '创建账户',
      created: '账户已创建', createFailed: '创建账户失败',
      customTemplate: '自定义', customName: '账户名称',
      entryTitle: '账户与用量', entryUnconfigured: '尚未建立账户',
      dataCorner: '数据与设置', backToDash: '← 仪表盘',
      insightBack: '← 全部账户', insightTrend: '近 30 天趋势', officialHistory: '观察历史',
      noModels: '暂无归属模型',
      limitValueLabel: '额度值', limitUnitLabel: '单位', limitModeLabel: '口径', limitWindowLabel: '窗口',
      addLimit: '添加窗口', removeLimit: '移除',
      unitsTokens: 'token', unitsUsd: 'USD', unitsRequests: '请求数', unitsPercent: '百分比', unitsCredits: '计划积分',
      windowsKindRolling: '滚动', windowsKindFixed: '固定', windowsKindBilling: '账期', windowsKindRate: '速率',
      secondsLabel: '窗口秒数',
      priceCatalogSynced: '已同步并应用上游价目库。',
      pricingTitle: '模型映射与即时计价', pricingObservedModels: '个已观测模型', pricingCatalogV: '价目库',
      pricingSearchPh: '搜索已观测模型 / 提供方…', pricingRefresh: '联网更新价目库', pricingRefreshing: '同步中…',
      colObserved: '观测模型', colProvider: '提供方', colCalls: '调用量', colMapped: '映射到的标准模型 (LiteLLM)',
      colInput: '输入 / 1M', colOutput: '输出 / 1M', colCache: '缓存 / 1M', colActions: '操作',
      unmapped: '未匹配', mapBtn: '映射', priceBtn: '改价', mappingTitle: '模型映射与对齐', mappingCurrent: '当前观测模型',
      mappingProvider: '提供方', mappingRequests: '累计请求', mappingSearchLabel: '在 LiteLLM 价目库中搜索对应标准模型：',
      mappingCandidates: '推荐候选（点击立即应用）：', mappingChoose: '选择 →', mappingFooter: '映射只影响价格匹配，从不改写账本事实。',
      inputPlaceholder: '标准模型名…',
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

    // ---------- v5 store: accounts, objective data only ----------
    function createStore() {
      const state = {
        open: false,
        mode: 'dash',            // 'dash' full dashboard (A) | 'dock' right-docked panel (B)
        lens: 'value',           // 'value' equivalent USD | 'token' new-compute | 'req' requests
        account: null,           // selected account (product) id or null
        stack: 'pool',           // activity stacking: 'pool' | 'model'
        day: null,               // selected day key in the activity chart
        dataSection: null,       // null | 'accounts' | 'pricing' | 'data' | 'settings'
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

    function fmtUsdAmount(value) {
      const usd = Number(value)
      if (!Number.isFinite(usd)) return '—'
      return `$${usd >= 100 ? usd.toFixed(0) : usd >= 10 ? usd.toFixed(1) : usd.toFixed(2)}`
    }

    function fmtQuota(value, unit) {
      if (value === null || value === undefined) return '—'
      return unit === 'usd' ? fmtUsdAmount(value) : fmtTokens(value)
    }

    /** Compact countdown: 42m · 3h 05m · 2d 4h */
    function countdown(ms, t) {
      if (ms === null || ms === undefined || !Number.isFinite(ms)) return ''
      const minutes = Math.max(0, Math.round(ms / 60_000))
      if (minutes < 1) return '<1m'
      if (minutes < 60) return `${minutes}m`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
      const days = Math.floor(hours / 24)
      return `${days}d ${hours % 24}h`
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
      errorBg: 'var(--dsw-alias-state-error-bg, #fee2e2)',
      warn: '#b26a00',
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
    const closeStyle = {
      marginLeft: 'auto', border: 'none', background: 'transparent',
      color: C.textSecondary, fontSize: 16, cursor: 'pointer', padding: '4px 10px', borderRadius: 8,
    }
    const contentStyle = { flex: 1, overflow: 'auto', padding: '20px 24px' }
    const cardStyle = {
      border: `1px solid ${C.borderFaint}`, borderRadius: 12,
      padding: '14px 16px', background: C.bgLayer,
    }
    const metricLabelStyle = { fontSize: 12, color: C.textSecondary, margin: '0 0 6px' }
    const sectionTitleStyle = { fontSize: 14, fontWeight: 600, margin: '0 0 10px' }
    const insightSectionTitle = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 650, margin: '0 0 8px', letterSpacing: '.02em' }
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
    const sourceBadgeStyle = (official) => ({
      ...badgeStyle,
      background: official ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 10%, transparent)' : C.bgMuted,
      color: official
        ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 55%, var(--dsw-alias-label-primary, #0f1115))'
        : C.textSecondary,
    })
    const footerButtonStyle = () => ({
      display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%',
      padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
      border: 'none', background: 'transparent', color: C.textSecondary, fontSize: 13, textAlign: 'left',
    })

    // ---------- v5 styles (injected class layer over theme variables) ----------
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
      .tu3-winrow { margin-bottom: 7px; }
      .tu3-winrow:last-child { margin-bottom: 0; }
      .tu3-winlab { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #61666b); margin-bottom: 3px; }
      .tu3-winlab b { color: var(--dsw-alias-label-primary, #0f1115); font: 650 11.5px ui-monospace, SFMono-Regular, Menlo, monospace; }
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
      .tu3-entry-bars { margin-top: 7px; width: 100%; display: block; }
      .tu3-entry-b1 { display: block; height: 5px; border-radius: 2px; background: var(--dsw-alias-bg-multi-select, #f5f6f7); overflow: hidden; }
      .tu3-entry-b1 i { display: block; height: 100%; border-radius: 2px; }
      .tu3-entry-b2 { display: block; height: 2px; margin-top: 3px; border-radius: 1px; background: var(--dsw-alias-bg-multi-select, #f5f6f7); overflow: hidden; }
      .tu3-entry-b2 i { display: block; height: 100%; background: rgba(120,128,140,.55); }
      .tu3-entry-cap { font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); margin-top: 4px; display: flex; justify-content: space-between; gap: 6px; }
      .tu3-insight-grid { display: grid; grid-template-columns: minmax(300px, 1fr) 1.5fr; gap: 14px; align-items: start; }
      .tu3-insight-col { display: flex; flex-direction: column; gap: 12px; }
      .tu3-chip { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); border-radius: 999px; padding: 2px 9px; font-size: 11.5px; background: var(--dsw-alias-bg-layer-1, #fff); }
      .tu3-suggest { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; }
      .tu3-dock-chips { display: flex; gap: 6px; overflow-x: auto; padding: 2px 16px 12px; scrollbar-width: none; }
      .tu3-dock-chips::-webkit-scrollbar { display: none; }
      .tu3-dock-chip { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-secondary, #61666b); border-radius: 999px; padding: 5px 12px; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
      .tu3-dock-chip.on { border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 45%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 9%, var(--dsw-alias-bg-layer-1, #fff)); color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 55%, var(--dsw-alias-label-primary, #0f1115)); font-weight: 600; }
      .tu3-dock-acc { padding: 9px 16px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.04)); cursor: grab; }
      .tu3-dock-acc:active { cursor: grabbing; }
      .tu3-dock-acc:last-child { border-bottom: 0; }
      @media (max-width: 900px) {
        .tu3-hero { grid-template-columns: 1fr }
        .tu3-pools { grid-template-columns: 1fr 1fr }
        .tu3-rankrow { grid-template-columns: 20px minmax(110px, 1.2fr) minmax(70px, 1.4fr) 66px }
        .tu3-rankrow > :nth-child(5) { display: none }
        .tu3-insight-grid { grid-template-columns: 1fr }
      }
      @media (max-width: 640px) { .tu3-pools { grid-template-columns: 1fr } }
    `
    const POOL_COLORS = ['#3d6ee8', '#0f9d8f', '#d9822b', '#8a93a3', '#7a5af8', '#c2417f']
    const UNASSIGNED_COLOR = '#98a2b3'
    const poolColor = (pool, index = 0) => pool?.color || (pool?.id === 'unassigned' ? UNASSIGNED_COLOR : POOL_COLORS[(index ?? 0) % POOL_COLORS.length])
    const poolIndexOf = (pool) => pool?.colorIndex ?? 0

    /** Display order: saved drag order, then the product priority, then arrival order. */
    const PROVIDER_PRIORITY = { 'openai-codex': 0, 'ollama-cloud': 1, 'xai': 2, 'antigravity': 3, 'glm': 4 }
    const ACCOUNT_ORDER_KEY = 'tu3.accountOrder'
    function readAccountOrder() {
      try {
        const parsed = JSON.parse(localStorage.getItem(ACCOUNT_ORDER_KEY) ?? 'null')
        return Array.isArray(parsed) ? parsed.map(String) : []
      } catch { return [] }
    }
    function writeAccountOrder(order) {
      try { localStorage.setItem(ACCOUNT_ORDER_KEY, JSON.stringify(order.map(String))) } catch { /* storage unavailable */ }
    }
    function orderAccounts(list, savedOrder = []) {
      const savedIndex = (id) => savedOrder.indexOf(String(id))
      return list
        .map((entry, index) => ({ entry, index }))
        .sort((left, right) => {
          const a = savedIndex(left.entry.id)
          const b = savedIndex(right.entry.id)
          if (a !== -1 || b !== -1) return (a === -1 ? 9000 : a) - (b === -1 ? 9000 : b)
          const pa = PROVIDER_PRIORITY[left.entry.providerId]
          const pb = PROVIDER_PRIORITY[right.entry.providerId]
          if (pa !== undefined || pb !== undefined) return (pa ?? 900) - (pb ?? 900) || left.index - right.index
          return left.index - right.index
        })
        .map((slot) => slot.entry)
    }

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
      // Measures objects nest current cost under `cost`; seriesBy day cells
      // carry a flat currentUsdNano. Handle both shapes.
      const value = cell.cost !== undefined ? cell.cost.currentUsdNano : cell.currentUsdNano
      return Number(value ?? 0)
    }
    function lensText(value, lens, t) {
      if (lens === 'token') return fmtTokens(value)
      if (lens === 'req') return String(Math.round(value))
      return fmtUsd(Math.round(value))
    }
    function lensLabel(t, lens) {
      return t(lens === 'token' ? 'lensToken' : lens === 'req' ? 'lensReq' : 'lensValue')
    }

    // ---------- v5 labels ----------
    function windowSecondsLabel(seconds, t) {
      if (!Number.isFinite(seconds) || seconds <= 0) return null
      if (seconds % 86_400 === 0) {
        const days = seconds / 86_400
        return days === 1 ? t('windowDaily') : t('windowRollingDays', { days })
      }
      if (seconds % 3_600 === 0) return t('windowRollingHours', { hours: Math.round(seconds / 3_600) })
      return t('windowRollingHours', { hours: Math.round((seconds / 3_600) * 10) / 10 })
    }
    function windowLabel(limit, t) {
      if (!limit) return ''
      const seconds = limit.windowSeconds ?? (limit.durationMs != null ? limit.durationMs / 1000 : null)
      if (limit.windowKind === 'billing') return t('windowMonthly')
      if (limit.windowKind === 'rate') return t('windowsKindRate')
      if (seconds && windowSecondsLabel(seconds, t)) return windowSecondsLabel(seconds, t)
      if (limit.windowKind === 'fixed') return limit.externalKey === 'term' ? t('windowTerm') : t('windowFixed')
      return limit.externalKey ?? ''
    }
    function modeLabel(mode, t) {
      if (mode === 'exact') return t('modeExact')
      if (mode === 'dynamic') return t('modeDynamic')
      if (mode === 'unpublished') return t('modeUnpublished')
      if (mode === 'manual') return t('modeManual')
      return mode ?? ''
    }
    function sourceLabel(kind, t) {
      if (kind === 'official_usage_api') return t('sourceOfficialApi')
      if (kind === 'official_plugin_internal_api') return t('sourceOfficialPlugin')
      if (kind === 'official_ui') return t('sourceOfficialUi')
      if (kind === 'official_response') return t('sourceOfficialResponse')
      if (kind === 'local_ledger') return t('sourceLocal')
      if (kind === 'manual') return t('sourceManual')
      return kind ?? ''
    }
    function originLabel(sourceKind, t) {
      if (sourceKind === 'connection') return t('originConnection')
      if (sourceKind === 'template') return t('originTemplate')
      if (sourceKind === 'legacy_v5_manual') return t('originLegacy')
      return t('originManual')
    }
    function kindLabel(kind, t) {
      if (kind === 'subscription') return t('kindSubscription')
      if (kind === 'prepaid') return t('kindPrepaid')
      return t('kindTrackOnly')
    }

    // ---------- data loading ----------
    async function rpc(ctx, endpoint, payload) {
      const result = await ctx.connection.rpc.call(CHANNEL, endpoint, payload ?? {})
      if (!result.ok) throw new Error(result.error?.message ?? 'request failed')
      return result.value
    }

    async function accountRpc(ctx, endpoint, payload) {
      const result = await ctx.connection.rpc.call(ACCOUNT_CHANNEL, endpoint, payload ?? {})
      if (!result.ok) throw new Error(result.error?.message ?? 'request failed')
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

    /** Low-frequency lens control: cycles where the number it labels lives. */
    function LensCycle({ state, store, t }) {
      const keys = LENSES.map(([key]) => key)
      const advance = () => store.update({ lens: keys[(keys.indexOf(state.lens) + 1) % keys.length] })
      return h('button', {
        type: 'button', title: t('lensCycleHint'), onClick: advance,
        style: { border: 'none', background: 'transparent', color: C.textSecondary, font: 'inherit', fontSize: '11.5px', cursor: 'pointer', padding: 0, textDecoration: 'underline dotted', textUnderlineOffset: 3 },
      }, lensLabel(t, state.lens), ' ⇄')
    }

    // ---------- official-first meters ----------
    /** One official window row: label, percent bar, reset countdown. */
    function OfficialWindowRow({ win, color, t }) {
      const used = Math.max(0, Math.min(100, win.percentUsed ?? 0))
      const risk = used >= 90
      return h('div', { className: 'tu3-winrow' },
        h('div', { className: 'tu3-winlab' },
          h('span', null, win.label ?? win.externalKey ?? ''),
          h('span', null,
            h('b', null, `${used.toFixed(0)}%`),
            win.resetsAt ? h('span', { style: { marginLeft: 8 } }, `${t('resetsInLabel')} ${countdown(win.resetsAt - Date.now(), t)}`) : null,
          ),
        ),
        h('div', { className: 'tu3-duo-track', style: risk ? { background: C.errorBg } : undefined },
          h('i', { className: 'tu3-duo-fill', style: { width: `${used}%`, background: risk ? C.error : color } }),
        ),
      )
    }

    function paceNote(pool, t) {
      if (pool.kind === 'prepaid') {
        if (pool.balanceUsd == null || pool.daysLeft === null) return t('creditNoExpiry', { name: pool.name })
        return t('creditRunway', {
          name: pool.name,
          expiry: pool.billing?.expiryMs ? new Date(pool.billing.expiryMs).toISOString().slice(0, 10) : '—',
          days: pool.daysLeft,
          leftover: fmtUsdAmount(pool.leftoverAtExpiryUsd),
        })
      }
      const pace = pool.pace
      if (pace && Number.isFinite(pace.daysToCap)) {
        return t('poolCap', { rate: fmtQuota(pace.ratePerDay, pace.unit), days: pace.daysToCap.toFixed(1) })
      }
      const window = (pool.quotaWindows ?? []).find((entry) => entry.leftoverAtReset != null && entry.leftoverAtReset > 0)
      if (window && pace) {
        return t('poolLeftover', {
          rate: fmtQuota(pace.ratePerDay, pace.unit),
          leftover: fmtQuota(window.leftoverAtReset, window.unit),
          reset: new Date(pool.month?.resetLabel ?? Date.now()).toLocaleDateString(),
        })
      }
      const manual = (pool.quotaWindows ?? []).find((entry) => entry.usedPct != null)
      if (manual) return `${windowLabel(manual, t)} ${manual.usedPct.toFixed(0)}%`
      return t('noQuotaDeclared')
    }

    /**
     * CodexBar-style duo meter, official-first: the thick bar shows the
     * official window percentages when the provider reports them, otherwise
     * the local quota percent; the thin bar shows time progress for billing
     * windows only (rolling windows get countdown text instead).
     */
    function DuoMeter({ pool, index = 0, t, compact = false }) {
      const color = poolColor(pool, index)
      if (pool.kind === 'prepaid') {
        const pctBurn = pool.pctBurnToExpiry
        return h('div', null,
          h('div', { className: 'tu3-duo-track' },
            h('i', { className: 'tu3-duo-fill', style: { width: `${pctBurn === null || pctBurn === undefined ? 0 : Math.min(100, pctBurn)}%`, background: color } }),
          ),
          h('div', { className: 'tu3-winlab', style: { marginTop: 4 } },
            h('span', null, t('creditRunwayBurn', {
              burn: fmtUsdAmount(pool.burnToExpiryUsd), balance: fmtUsdAmount(pool.balanceUsd),
              pct: pctBurn === null || pctBurn === undefined ? '—' : `${pctBurn.toFixed(0)}%`,
            })),
            pool.billing?.expiryMs ? h('span', null, new Date(pool.billing.expiryMs).toISOString().slice(0, 10)) : null,
          ),
        )
      }
      const officialWindows = pool.official?.windows ?? []
      if (officialWindows.length > 0) {
        if (compact) {
          const sorted = [...officialWindows].sort((left, right) => right.percentUsed - left.percentUsed)
          const primary = sorted[0]
          const secondaryLine = [
            sourceLabel(pool.official.sourceKind, t),
            ...sorted.slice(1).map((win) => `${win.label ?? ''}${Number.isFinite(win.percentUsed) ? ` ${Math.round(win.percentUsed)}%` : ''}${win.resetsAt ? ` · ${t('resetsInLabel')} ${countdown(win.resetsAt - Date.now(), t)}` : ''}`),
          ].filter(Boolean).join(' · ')
          return h('div', null,
            h(OfficialWindowRow, { win: primary, color, t }),
            h('div', { className: 'tu3-winlab', style: { marginTop: 4 } }, h('span', null, secondaryLine)),
          )
        }
        const monthElapsed = pool.cycle?.elapsedPct
        return h('div', null,
          officialWindows.slice(0, 3).map((win) => h(OfficialWindowRow, { key: win.id ?? win.label, win, color, t })),
          monthElapsed != null && officialWindows.length === 0
            ? h('div', { className: 'tu3-duo-time' }, h('i', { style: { width: `${Math.min(100, monthElapsed)}%` } }))
            : null,
          h('div', { className: 'tu3-winlab', style: { marginTop: 4 } },
            h('span', null,
              h('span', { className: 'tu3-tag', style: sourceBadgeStyle(true) }, sourceLabel(pool.official.sourceKind, t)),
              h('span', { style: { marginLeft: 6 } }, pool.official.observedAt
                ? `${t('observedAtLabel')} ${new Date(pool.official.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : ''),
            ),
          ),
        )
      }
      const measurable = (pool.quotaWindows ?? []).filter((entry) => entry.usedPct != null)
      if (measurable.length === 0) {
        return h('p', { style: { ...mutedStyle, margin: '4px 0 0' } }, t('noQuotaDeclared'))
      }
      const top = measurable.reduce((best, entry) => (entry.usedPct > (best?.usedPct ?? -1) ? entry : best), null)
      const secondary = measurable.find((entry) => entry !== top)
      const risk = (top.usedPct ?? 0) >= 90
      return h('div', null,
        h('div', { className: 'tu3-duo-track', style: risk ? { background: C.errorBg } : undefined },
          h('i', { className: 'tu3-duo-fill', style: { width: `${Math.min(100, top.usedPct)}%`, background: risk ? C.error : color } }),
        ),
        pool.cycle?.elapsedPct != null ? h('div', { className: 'tu3-duo-time' }, h('i', { style: { width: `${Math.min(100, pool.cycle.elapsedPct)}%` } })) : null,
        h('div', { className: 'tu3-winlab', style: { marginTop: 4 } },
          h('span', null, windowLabel(top, t), ' ', h('b', null, `${top.usedPct.toFixed(0)}%`),
            secondary ? h('span', { style: { marginLeft: 8 } }, `${windowLabel(secondary, t)} ${secondary.usedPct.toFixed(0)}%`) : null),
          h('span', { className: 'tu3-tag', style: sourceBadgeStyle(false) }, modeLabel(top.valueMode, t)),
        ),
      )
    }

    // ---------- overview pieces ----------
    function AccountStrip({ list, lens, t }) {
      return h('div', { className: 'tu3-card' },
        h('div', { className: 'tu3-pools' },
          list.map((pool) => h('div', { key: pool.id },
            h('div', { style: { fontSize: 12, color: C.textSecondary } },
              h('i', { className: 'tu3-dot', style: { background: poolColor(pool, poolIndexOf(pool)) } }),
              pool.name,
            ),
            h('div', { style: { font: '650 15px ui-monospace, SFMono-Regular, Menlo, monospace', margin: '2px 0 6px' } },
              pool.kind === 'prepaid'
                ? fmtUsdAmount(pool.balanceUsd)
                : lensText(lensMetric(pool.kpis, lens === 'token' ? 'token' : lens === 'req' ? 'req' : 'value'), lens, t)),
            h(DuoMeter, { pool, index: poolIndexOf(pool), t }),
          )),
        ),
      )
    }

    function ActivityChart({ data, state, store, t }) {
      const series = data.seriesBy
      const groupLens = (id) => (id === 'other' ? t('otherGroup') : (series.groups.find((group) => group.id === id)?.label ?? id))
      const groupColor = (id) => {
        if (state.stack === 'pool') {
          const index = data.pools.pools.findIndex((entry) => entry.id === id)
          if (index >= 0) return poolColor(data.pools.pools[index], index)
          return id === 'unassigned' ? UNASSIGNED_COLOR : POOL_COLORS[2]
        }
        const models = data.rankings?.rows ?? []
        const index = models.findIndex((row) => row.key === id)
        return POOL_COLORS[(index >= 0 ? index : 0) % POOL_COLORS.length]
      }
      const dayTotals = series.days.map((day) => Object.values(day.groups).reduce((sum, cell) => sum + lensMetric(cell, state.lens), 0))
      const max = Math.max(1, ...dayTotals)
      const dimOthers = state.stack === 'model' && state.account !== null
        ? (id) => {
          const row = (data.rankings?.rows ?? []).find((entry) => entry.key === id)
          return row && row.poolId !== state.account
        }
        : state.stack === 'pool' && state.account !== null ? (id) => id !== state.account : null
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
        rows.slice(0, 10).map((row, index) => {
          const poolIndex = data.pools.pools.findIndex((pool) => pool.id === row.poolId)
          const color = state.stack === 'pool' && poolIndex >= 0 ? poolColor(data.pools.pools[poolIndex], poolIndex) : POOL_COLORS[index % POOL_COLORS.length]
          return h('div', { key: row.key, className: `tu3-rankrow${index === 0 ? ' first' : ''}` },
            h('span', { style: { font: '400 15px/1 Georgia, serif', color: C.textSecondary } }, String(index + 1)),
            h('span', null,
              h('i', { className: 'tu3-dot', style: { background: color } }),
              h('span', { title: row.key }, row.label),
              h('div', { style: { fontSize: 11, color: C.textSecondary } }, `@ ${poolName(row.poolId)}`),
            ),
            h('div', { className: 'tu3-rankbar' }, h('i', { style: { width: `${topValue > 0 ? lensMetric(row, state.lens) / topValue * 100 : 0}%`, background: color } })),
            h('span', { className: 'tu3-num' }, lensText(lensMetric(row, state.lens), state.lens, t)),
            h('span', { className: 'tu3-num', style: { color: C.textSecondary } }, `${total > 0 ? (lensMetric(row, state.lens) / total * 100).toFixed(0) : 0}%`),
          )
        }),
      )
    }

    function AccountTabs({ data, list, state, store, t }) {
      return h('div', { className: 'tu3-tabs' },
        h('button', { type: 'button', className: state.account === null ? 'on' : '', onClick: () => store.update({ account: null }) }, t('allPools')),
        (list ?? data.pools.pools).map((pool) => h('button', {
          key: pool.id, type: 'button', className: state.account === pool.id ? 'on' : '',
          onClick: () => store.update({ account: pool.id }),
        }, h('i', { className: 'tu3-dot', style: { background: poolColor(pool, poolIndexOf(pool)) } }), pool.name)),
        data.pools.unassigned ? h('button', { type: 'button', className: state.account === 'unassigned' ? 'on' : '', onClick: () => store.update({ account: 'unassigned' }) },
          h('i', { className: 'tu3-dot', style: { background: UNASSIGNED_COLOR } }), t('unassignedPool')) : null,
      )
    }

    // ---------- connection actions (relocated per-account) ----------
    function connectionOf(summary, identity) {
      const rows = summary?.connections ?? []
      return rows.find((conn) => (conn.connectionId ?? `${conn.providerId}:default`) === identity.connectionId
        && conn.providerId === identity.providerId) ?? null
    }

    function ConnectionSection({ ctx, t, identity, onChanged }) {
      const summary = useAsync(() => accountRpc(ctx, 'summary'), [ctx])
      const [busy, setBusy] = React.useState(null)
      const [login, setLogin] = React.useState(null)
      const [message, setMessage] = React.useState(null)
      const [drafts, setDrafts] = React.useState({ glm: '', ollamaKey: '', ollamaCookie: '' })
      const [cookieOptIn, setCookieOptIn] = React.useState(false)
      if (summary.status !== 'ready') return h(LoadPanel, { status: summary.status, error: summary.error, reload: summary.reload, t })
      const connection = connectionOf(summary.value, identity)
      if (connection === null) return h('p', { style: mutedStyle }, `${identity.providerId} — local only`)
      const oauthProviders = new Set(['openai-codex', 'xai', 'antigravity'])
      const provider = connection.providerId
      const waitForLogin = async (loginId) => {
        for (let attempt = 0; attempt < 120; attempt += 1) {
          await new Promise(resolvePromise => setTimeout(resolvePromise, 1500))
          const result = await accountRpc(ctx, 'connection-action', { provider, action: 'login-status', params: { loginId } })
          const status = result.status ?? result
          if (status.kind === 'succeeded') { setLogin(null); summary.reload(); onChanged?.(); return }
          if (status.kind === 'failed' || status.kind === 'cancelled') throw new Error(status.message ?? `Authorization ${status.kind}`)
        }
        throw new Error('Authorization timed out')
      }
      const connect = async () => {
        setBusy(`connect:${provider}`)
        setMessage(null)
        try {
          const result = await accountRpc(ctx, 'connection-action', {
            provider, action: 'start-login',
            params: provider === 'openai-codex' || provider === 'xai' ? { provider } : {},
          })
          const challenge = result.challenge ?? result
          const authorizationUrl = challenge.verificationUri ?? challenge.authUrl
          if (authorizationUrl) window.open(authorizationUrl, '_blank', 'noopener,noreferrer')
          setLogin({ provider, ...challenge })
          await waitForLogin(challenge.loginId)
        } catch (error) {
          setMessage(error.message)
        } finally {
          setBusy(null)
        }
      }
      const disconnect = async () => {
        setBusy(`disconnect:${provider}`)
        setMessage(null)
        try {
          const action = provider === 'antigravity' && connection.connectionId ? 'remove-account' : 'logout'
          const params = action === 'remove-account' ? { accountId: connection.connectionId }
            : provider === 'openai-codex' || provider === 'xai' ? { provider } : {}
          await accountRpc(ctx, 'connection-action', { provider, action, params })
          summary.reload()
          onChanged?.()
        } catch (error) {
          setMessage(error.message)
        } finally {
          setBusy(null)
        }
      }
      const activate = async () => {
        setBusy(`activate:${connection.connectionId}`)
        setMessage(null)
        try {
          await accountRpc(ctx, 'connection-action', { provider: 'antigravity', action: 'activate-account', params: { accountId: connection.connectionId } })
          summary.reload()
          onChanged?.()
        } catch (error) {
          setMessage(error.message)
        } finally {
          setBusy(null)
        }
      }
      const saveCredential = async (kind) => {
        setBusy(`save:${kind}`)
        setMessage(null)
        try {
          if (kind === 'glm') await setCredential(ctx, 'ANTHROPIC_AUTH_TOKEN', drafts.glm.trim())
          else if (kind === 'ollamaKey') {
            await setCredential(ctx, 'OLLAMA_API_KEY', drafts.ollamaKey.trim())
            try {
              await accountRpc(ctx, 'sync-model-catalog', { providerId: 'ollama-cloud', refresh: true })
            } catch (error) {
              setDrafts(current => ({ ...current, [kind]: '' }))
              setMessage(`${t('credentialSaved')} ${t('modelSyncFailed')}: ${error.message}`)
              summary.reload()
              return
            }
          } else {
            if (!cookieOptIn) throw new Error(t('cookieOptIn'))
            await setCredential(ctx, 'OLLAMA_SESSION_COOKIE', sanitizeOllamaCookieHeader(drafts.ollamaCookie))
            await accountRpc(ctx, 'observe-provider', { providerId: 'ollama-cloud', mode: 'manual-cookie', refresh: true })
          }
          setDrafts(current => ({ ...current, [kind]: '' }))
          setMessage(t('credentialSaved'))
          summary.reload()
          onChanged?.()
        } catch (error) {
          setMessage(error.message)
        } finally {
          setBusy(null)
        }
      }
      const ollamaCatalog = summary.value.modelCatalogs?.find(item => item.providerId === 'ollama-cloud')
      const stateText = connection.quotaApplicable === false ? t('quotaNotApplicable')
        : connection.configured && connection.credentialStatus === 'unverified' ? t('configuredUnverified')
        : connection.configured ? t('connected') : t('notConnected')
      return h('div', null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('span', { style: { fontSize: 13 } },
            h('b', null, connection.displayName ?? provider),
            h('span', { className: 'tu3-tag', style: { ...sourceBadgeStyle(connection.configured), marginLeft: 8 } }, stateText),
          ),
          connection.credentialRef ? h('code', { style: badgeStyle }, connection.credentialRef) : null,
          h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
            provider === 'ollama-cloud' ? h('button', {
              type: 'button', style: { ...buttonStyle, padding: '3px 9px', fontSize: 12 },
              disabled: busy !== null || ollamaCatalog?.credentialConfigured !== true,
              onClick: () => {
                setBusy('sync:ollama-cloud')
                void accountRpc(ctx, 'sync-model-catalog', { providerId: 'ollama-cloud', refresh: true })
                  .then(() => { setMessage(t('cloudModelsSynced')); summary.reload() })
                  .catch(error => setMessage(`${t('modelSyncFailed')}: ${error.message}`))
                  .finally(() => setBusy(null))
              },
            }, busy === 'sync:ollama-cloud' ? t('loading') : `${t('syncCloudModels')} (${ollamaCatalog?.modelCount ?? 0})`) : null,
            oauthProviders.has(provider) ? h('button', {
              type: 'button', style: { ...buttonStyle, padding: '3px 9px', fontSize: 12 }, disabled: busy !== null,
              onClick: () => connection.configured ? disconnect() : connect(),
            }, connection.configured ? t('disconnect') : t('connect')) : null,
            provider === 'antigravity' && connection.active === false ? h('button', {
              type: 'button', style: { ...buttonStyle, padding: '3px 9px', fontSize: 12 }, disabled: busy !== null,
              onClick: activate,
            }, t('activate')) : null,
          ),
        ),
        provider === 'ollama-cloud' ? h('div', { style: { background: C.bgMuted, borderRadius: 9, padding: '10px 12px', marginBottom: 10 } },
          h('div', { style: { fontWeight: 650, fontSize: 12.5, marginBottom: 4 } }, t('ollamaGuide')),
          h('ol', { style: { margin: 0, paddingLeft: 18, lineHeight: 1.7, fontSize: 12, color: C.textSecondary } },
            h('li', null, t('ollamaStep1')),
            h('li', null, t('ollamaStep2')),
            h('li', null, t('ollamaStep3'))),
          h('div', { style: { marginTop: 8 } },
            h('button', {
              type: 'button', style: { ...buttonStyle, padding: '3px 9px', fontSize: 12 },
              onClick: () => window.open(OLLAMA_SETTINGS_URL, '_blank', 'noopener,noreferrer'),
            }, t('ollamaOpenSettings'))),
        ) : null,
        provider === 'glm' || provider === 'ollama-cloud' ? h('div', { style: { display: 'grid', gap: 8 } },
          provider === 'glm'
            ? h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) auto', gap: 8 } },
                h('input', { type: 'password', autoComplete: 'off', style: inputStyle, value: drafts.glm,
                  placeholder: `${t('glmAuthorization')} · ANTHROPIC_AUTH_TOKEN`,
                  onChange: event => setDrafts(current => ({ ...current, glm: event.target.value })) }),
                h('button', { type: 'button', style: buttonStyle, disabled: busy !== null || drafts.glm.length === 0, onClick: () => saveCredential('glm') }, t('credentialSave')))
            : null,
          provider === 'ollama-cloud' ? [
            h('div', { key: 'key', style: { display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) auto', gap: 8 } },
              h('input', { type: 'password', autoComplete: 'off', style: inputStyle, value: drafts.ollamaKey,
                placeholder: `${t('ollamaApiKey')} · OLLAMA_API_KEY`,
                onChange: event => setDrafts(current => ({ ...current, ollamaKey: event.target.value })) }),
              h('button', { type: 'button', style: buttonStyle, disabled: busy !== null || drafts.ollamaKey.length === 0, onClick: () => saveCredential('ollamaKey') }, t('credentialSave'))),
            h('div', { key: 'cookie', style: { display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) auto', gap: 8 } },
              h('input', { type: 'password', autoComplete: 'off', style: inputStyle, value: drafts.ollamaCookie,
                placeholder: `${t('ollamaCookie')} · OLLAMA_SESSION_COOKIE`,
                onChange: event => setDrafts(current => ({ ...current, ollamaCookie: event.target.value })) }),
              h('button', { type: 'button', style: buttonStyle, disabled: busy !== null || drafts.ollamaCookie.length === 0, onClick: () => saveCredential('ollamaCookie') }, t('credentialSave'))),
            h('label', { key: 'optin', style: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11.5, color: C.textSecondary } },
              h('input', { type: 'checkbox', checked: cookieOptIn, onChange: event => setCookieOptIn(event.target.checked) }),
              h('span', null, t('cookieOptIn'))),
          ] : null,
        ) : null,
        login ? h('div', { style: { ...cardStyle, marginTop: 10 } },
          h('div', { style: sectionTitleStyle }, t('loginPending')),
          login.verificationUri || login.authUrl ? h('a', { href: login.verificationUri ?? login.authUrl, target: '_blank', rel: 'noreferrer' }, t('openAuthorization')) : null,
          login.userCode ? h('div', { style: { marginTop: 8 } }, `${t('deviceCode')}: `, h('code', { style: badgeStyle }, login.userCode)) : null) : null,
        message ? h('p', { style: message === t('credentialSaved') || message.startsWith(t('cloudModelsSynced')) ? mutedStyle : errorStyle, marginTop: 8 }, message) : null,
      )
    }

    // ---------- account insight ----------
    function AccountInsight({ ctx, store, state, t, compact = false }) {
      const id = state.account
      const detail = useAsync(() => rpc(ctx, 'inspect', { kind: 'pool', id, filter: { time: { preset: '30d' } } }), [id])
      const [refreshing, setRefreshing] = React.useState(false)
      const [message, setMessage] = React.useState(null)
      const refreshOfficial = () => {
        setRefreshing(true)
        setMessage(null)
        void accountRpc(ctx, 'refresh-observations', { refresh: true })
          .then(() => detail.reload())
          .catch(error => setMessage(error.message))
          .finally(() => setRefreshing(false))
      }
      if (detail.status !== 'ready') return h('div', { className: 'tu3-wrap' }, h(LoadPanel, { status: detail.status, error: detail.error, reload: detail.reload, t }))
      const report = detail.value
      const identity = report.identity
      const account = report.account
      const poolIndex = Math.max(0, (account?.name ?? '').length % POOL_COLORS.length)
      const color = account?.color || poolColor(account ?? identity, poolIndex)
      const officialWindows = account?.official?.windows ?? []
      const observedTime = account?.official?.observedAt ?? null
      const rules = identity.rules ?? []
      const declaredLimits = identity.declaredLimits ?? []

      const officialSection = h('section', { className: 'tu3-card', style: { padding: '14px 16px' } },
        h('div', { style: insightSectionTitle },
          h('span', null, t('officialSection')),
          officialWindows.length > 0 ? h('span', { className: 'tu3-tag', style: sourceBadgeStyle(true) }, sourceLabel(account.official.sourceKind, t)) : null,
          h('span', { style: { marginLeft: 'auto' } },
            h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 9px', fontSize: 12 }, disabled: refreshing, onClick: refreshOfficial },
              refreshing ? t('loading') : t('refreshObservations'))),
        ),
        officialWindows.length > 0
          ? h('div', null,
              officialWindows.map((win) => h(OfficialWindowRow, { key: win.id ?? win.label, win, color, t })),
              observedTime ? h('p', { style: { ...mutedStyle, marginTop: 8 } },
                `${t('observedAtLabel')} ${new Date(observedTime).toLocaleString()}`,
                account.official.brittle ? ` · ${t('sourceOfficialUi')}` : '',
                ` · ${t('observationDisclaimer')}`,
              ) : null)
          : h('div', null,
              h('p', { style: { ...mutedStyle, lineHeight: 1.6 } },
                identity.connectionId ? t('noOfficialBody') : `${t('noOfficial')} — ${t('noOfficialBody')}`),
              declaredLimits.length > 0 ? h('ul', { style: { ...mutedStyle, margin: '6px 0 0', paddingLeft: 18 } },
                declaredLimits.map((limit) => h('li', { key: limit.externalKey },
                  `${windowLabel(limit, t)} · ${modeLabel(limit.valueMode, t)}`,
                  limit.exactValue != null ? ` · ${fmtQuota(limit.exactValue, limit.unit === 'newCompute' ? 'tokens' : limit.unit)}` : ''))) : null),
      )

      const localSection = h('section', { className: 'tu3-card', style: { padding: '14px 16px' } },
        h('div', { style: insightSectionTitle },
          h('span', null, t('localSection')),
          h('span', { className: 'tu3-tag', style: sourceBadgeStyle(false) }, t('sourceLocal')),
          h('span', { style: { marginLeft: 'auto', fontSize: 11, color: C.textSecondary } }, t('last30')),
        ),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 } },
          h('div', { style: { background: C.bgMuted, borderRadius: 9, padding: '8px 10px' } }, t('equivalent'), h('b', { style: { display: 'block', font: '650 15px ui-monospace, monospace', marginTop: 2 } }, fmtUsd(report.direct.cost.currentUsdNano))),
          h('div', { style: { background: C.bgMuted, borderRadius: 9, padding: '8px 10px' } }, t('newCompute'), h('b', { style: { display: 'block', font: '650 15px ui-monospace, monospace', marginTop: 2 } }, fmtTokens(report.direct.newComputeTokens))),
          h('div', { style: { background: C.bgMuted, borderRadius: 9, padding: '8px 10px' } }, t('requests'), h('b', { style: { display: 'block', font: '650 15px ui-monospace, monospace', marginTop: 2 } }, String(report.direct.requests))),
          h('div', { style: { background: C.bgMuted, borderRadius: 9, padding: '8px 10px' } }, t('coverage'), h('b', { style: { display: 'block', font: '650 15px ui-monospace, monospace', marginTop: 2 } }, pct(report.direct.cost.coverage))),
        ),
        h('p', { style: { ...mutedStyle, marginTop: 10 } }, paceNote(account ?? {}, t), ' · ', t('paceDisclaimer')),
        compact ? null : h('div', { style: { marginTop: 12 } },
          h('div', { className: 'tu3-k', style: { marginBottom: 6 } }, t('modelDetail')),
          (report.breakdown?.rows ?? []).length === 0
            ? h('p', { style: mutedStyle }, t('noModels'))
            : h('table', { style: tableStyle },
                h('thead', null, h('tr', null,
                  h('th', { style: thStyle }, t('colModel')),
                  h('th', { style: { ...thStyle, textAlign: 'right' } }, t('requests')),
                  h('th', { style: { ...thStyle, textAlign: 'right' } }, t('newCompute')),
                  h('th', { style: { ...thStyle, textAlign: 'right' } }, t('equivalent')),
                  h('th', { style: { ...thStyle, textAlign: 'right' } }, t('colShare')),
                )),
                h('tbody', null, report.breakdown.rows.map((row) => h('tr', { key: row.key },
                  h('td', { style: tdStyle, title: row.key }, row.label),
                  h('td', { style: { ...tdStyle, textAlign: 'right', font: '650 12px ui-monospace, monospace' } }, String(row.requests)),
                  h('td', { style: { ...tdStyle, textAlign: 'right', font: '650 12px ui-monospace, monospace' } }, fmtTokens(row.newComputeTokens)),
                  h('td', { style: { ...tdStyle, textAlign: 'right', font: '650 12px ui-monospace, monospace' } }, fmtUsd(row.cost.currentUsdNano)),
                  h('td', { style: { ...tdStyle, textAlign: 'right', font: '650 12px ui-monospace, monospace' } }, `${(row.share * 100).toFixed(0)}%`),
                )))),
        ),
      )

      const billing = identity.billing
      const billingSection = billing && (billing.priceUsd != null || billing.balanceUsd != null || billing.expiryMs != null)
        ? h('section', { className: 'tu3-card', style: { padding: '14px 16px' } },
            h('div', { style: insightSectionTitle }, h('span', null, t('billingSection')),
              h('span', { className: 'tu3-tag', style: sourceBadgeStyle(false) }, originLabel(billing.sourceKind, t))),
            h('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5, color: C.textSecondary } },
              billing.priceUsd != null ? h('span', null, `${t('accountPrice')} `, h('b', { style: { color: C.text, font: '650 12px ui-monospace, monospace' } }, fmtUsdAmount(billing.priceUsd))) : null,
              billing.balanceUsd != null ? h('span', null, `${t('accountBalance')} `, h('b', { style: { color: C.text, font: '650 12px ui-monospace, monospace' } }, fmtUsdAmount(billing.balanceUsd))) : null,
              billing.expiryMs != null ? h('span', null, `${t('accountExpiry')} `, h('b', { style: { color: C.text, font: '650 12px ui-monospace, monospace' } }, new Date(billing.expiryMs).toISOString().slice(0, 10))) : null,
            ),
            account?.kind === 'prepaid' ? h('p', { style: { ...mutedStyle, marginTop: 8 } }, paceNote(account, t)) : null,
          )
        : null

      const attributionSection = h('section', { className: 'tu3-card', style: { padding: '14px 16px' } },
        h('div', { style: insightSectionTitle }, h('span', null, t('attributionSection'))),
        rules.length === 0 ? h('p', { style: mutedStyle }, t('noQuotaDeclared')) : h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          rules.map((rule) => h('span', { key: rule.id, className: 'tu3-chip' },
            h('code', { style: { fontSize: 11 } }, rule.matchProvider ?? '*'),
            rule.matchModel ? h('span', null, ` / ${rule.matchModel}`) : null,
            rule.sourceKind === 'connection_default' ? h('span', { style: { color: C.textSecondary } }, '·auto') : null,
          ))),
      )

      const connectionSection = identity.connectionId || ['glm', 'ollama-cloud', 'openai-codex', 'xai', 'antigravity'].includes(identity.providerId)
        ? h('section', { className: 'tu3-card', style: { padding: '14px 16px' } },
            h('div', { style: insightSectionTitle }, h('span', null, t('connectionSection')),
              h('span', { style: { marginLeft: 'auto', fontSize: 11, color: C.textSecondary } }, t('credentialHelp'))),
            h(ConnectionSection, { ctx, t, identity, onChanged: () => detail.reload() }))
        : null

      return h('div', { className: compact ? '' : 'tu3-wrap', style: compact ? { padding: '0 4px' } : undefined },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' } },
          h('i', { className: 'tu3-dot', style: { background: color, width: 10, height: 10 } }),
          h('b', { style: { fontSize: 15 } }, identity.name),
          h('span', { className: 'tu3-tag', style: badgeStyle }, kindLabel(identity.kind, t)),
          h('span', { className: 'tu3-tag', style: badgeStyle }, originLabel(identity.sourceKind, t)),
          message ? h('span', { style: { ...errorStyle, fontSize: 12 } }, message) : null,
        ),
        h('div', { className: compact ? '' : 'tu3-insight-grid' },
          h('div', { className: 'tu3-insight-col' }, officialSection, billingSection, attributionSection),
          h('div', { className: 'tu3-insight-col' }, localSection, compact ? connectionSection : null),
        ),
        compact ? null : connectionSection,
      )
    }

    // ---------- onboarding + wizard ----------
    function AccountWizard({ ctx, t, onDone, preselect }) {
      const templates = useAsync(() => accountRpc(ctx, 'templates'), [ctx])
      const suggestions = useAsync(() => accountRpc(ctx, 'suggest-accounts'), [ctx])
      const [templateId, setTemplateId] = React.useState(preselect?.templateId ?? null)
      const [tierId, setTierId] = React.useState(null)
      const [name, setName] = React.useState('')
      const [priceUsd, setPriceUsd] = React.useState('')
      const [rules, setRules] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState(null)
      if (templates.status !== 'ready' || suggestions.status !== 'ready') {
        const pending = templates.status !== 'ready' ? templates : suggestions
        return h(LoadPanel, { status: pending.status, error: pending.error, reload: pending.reload, t })
      }
      const templateList = templates.value.templates ?? []
      const suggestionList = suggestions.value.suggestions ?? []
      const template = templateList.find((entry) => entry.id === templateId) ?? null
      const tier = template?.product?.tiers?.find((entry) => entry.id === tierId) ?? null
      const suggestion = suggestionList.find((entry) => entry.templateId === templateId) ?? null
      const selectedRules = rules.length > 0 ? rules : (suggestion?.suggestedRules ?? []).map((rule) => rule.matchProvider)
      const displayName = name || (template ? `${template.name}${tier && tier.name ? ` · ${tier.name}` : ''}` : '')

      const create = async () => {
        setBusy(true)
        setMessage(null)
        try {
          const limits = (template?.limits ?? []).map((limit) => {
            const tierValue = tier?.limitValues?.[limit.externalKey] ?? null
            return {
              externalKey: limit.externalKey,
              unit: limit.unit,
              valueMode: limit.valueMode,
              value: tierValue != null ? Number(tierValue) : null,
              windowKind: limit.windowKind,
              windowSeconds: limit.windowSeconds,
            }
          }).filter((limit) => limit.valueMode !== 'exact' || limit.value != null)
          const payload = {
            name: displayName || t('customName'),
            kind: template?.product?.kind ?? 'track_only',
            templateId: templateId && templateId !== 'custom' ? templateId : null,
            tierId,
            providerId: template?.providerId ?? 'manual',
            billing: {
              priceUsd: priceUsd === '' ? (tier?.priceUsd ?? null) : Number(priceUsd),
            },
            limits,
            rules: (selectedRules).map((provider, index) => ({ matchProvider: provider, priority: index })),
          }
          if (payload.billing.priceUsd == null || !Number.isFinite(payload.billing.priceUsd)) delete payload.billing.priceUsd
          await accountRpc(ctx, 'save-account', { account: payload })
          onDone?.()
        } catch (error) {
          setMessage(`${t('createFailed')}: ${error.message}`)
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', null,
          h('div', { className: 'tu3-k', style: { marginBottom: 6 } }, t('suggestTitle')),
          suggestionList.length === 0 ? h('p', { style: mutedStyle }, t('onboardingEmpty')) : h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            suggestionList.map((entry) => h('button', {
              key: entry.templateId, type: 'button',
              style: { ...buttonStyle, padding: '6px 12px', borderColor: templateId === entry.templateId ? C.accent : C.border },
              onClick: () => { setTemplateId(entry.templateId); setTierId(null); setRules([]); setName('') },
            },
              h('i', { className: 'tu3-dot', style: { background: entry.alreadyCovered ? '#16865f' : POOL_COLORS[3] } }),
              entry.name,
              h('span', { style: { color: C.textSecondary, marginLeft: 6, fontSize: 11 } }, `${entry.evidence.requests} req`),
            )),
          ),
        ),
        h('div', { style: { ...cardStyle, display: 'grid', gap: 10 } },
          h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 } }, t('templatePick'),
            h('select', { style: selectStyle, value: templateId ?? '', onChange: (event) => { setTemplateId(event.target.value || null); setTierId(null); setRules([]); setName('') } },
              h('option', { value: '' }, '—'),
              templateList.map((entry) => h('option', { key: entry.id, value: entry.id }, entry.name)))),
          template && (template.product?.tiers ?? []).length > 0 ? h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 } }, t('tierLabel'),
            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              template.product.tiers.map((entry) => h('button', {
                key: entry.id, type: 'button',
                style: { ...buttonStyle, padding: '5px 11px', borderColor: tierId === entry.id ? C.accent : C.border },
                onClick: () => { setTierId(entry.id); setName('') },
              }, entry.name, entry.priceUsd != null ? ` · $${entry.priceUsd}` : '')))) : null,
          h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 } }, t('customName'),
            h('input', { style: inputStyle, value: name, placeholder: displayName, onChange: (event) => setName(event.target.value) })),
          h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 } }, t('priceOptional'),
            h('input', { style: inputStyle, type: 'number', min: '0', step: '0.01', value: priceUsd,
              placeholder: tier?.priceUsd != null ? String(tier.priceUsd) : '', onChange: (event) => setPriceUsd(event.target.value) })),
          selectedRules.length > 0 ? h('div', null,
            h('div', { className: 'tu3-k', style: { marginBottom: 6 } }, t('rulesLabel')),
            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              selectedRules.map((provider) => h('span', { key: provider, className: 'tu3-chip' }, h('code', { style: { fontSize: 11 } }, provider))))) : null,
          template?.product?.notes ? h('p', { style: mutedStyle }, template.product.notes) : null,
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h('button', { type: 'button', style: primaryButtonStyle, disabled: busy, onClick: create }, busy ? t('loading') : t('create')),
            onDone ? h('button', { type: 'button', style: buttonStyle, onClick: onDone }, t('cancel')) : null,
            message ? h('span', { style: { ...errorStyle, fontSize: 12 } }, message) : null,
          ),
        ),
      )
    }

    function Onboarding({ ctx, store, t, compact = false }) {
      const box = useAsync(() => rpc(ctx, 'query', { filter: { time: { preset: '30d' }, honesty: 'reported' }, views: ['pools'] }), [ctx])
      if (box.status !== 'ready') return h(LoadPanel, { status: box.status, error: box.error, reload: box.reload, t })
      const pools = box.value.pools
      return h('div', { className: compact ? '' : 'tu3-wrap', style: compact ? { padding: '4px 12px 12px' } : { maxWidth: 640, margin: '0 auto' } },
        h('section', { className: 'tu3-card', style: { padding: '22px 24px', marginBottom: 12 } },
          h('h2', { style: { margin: '0 0 8px', fontSize: 18 } }, t('onboardingTitle')),
          h('p', { style: { ...mutedStyle, lineHeight: 1.65, margin: '0 0 6px' } }, t('onboardingBody')),
          pools?.unassigned ? h('p', { style: { ...mutedStyle, margin: 0 } },
            t('unassignedNote', { tokens: fmtTokens(pools.unassigned.newComputeTokens), requests: String(pools.unassigned.requests) })) : null,
        ),
        h(AccountWizard, { ctx, t, onDone: () => box.reload() }),
      )
    }

    // ---------- accounts editor (data corner) ----------
    function AccountAdvancedForm({ ctx, t, account, onSaved }) {
      const [name, setName] = React.useState(account.name)
      const [kind, setKind] = React.useState(account.kind ?? 'track_only')
      const [priceUsd, setPriceUsd] = React.useState(account.billing?.priceUsd != null ? String(account.billing.priceUsd) : '')
      const [resetDay, setResetDay] = React.useState(account.billing?.resetDay ?? 1)
      const [balanceUsd, setBalanceUsd] = React.useState(account.billing?.balanceUsd != null ? String(account.billing.balanceUsd) : '')
      const [expiryDay, setExpiryDay] = React.useState(account.billing?.expiryMs ? new Date(account.billing.expiryMs).toISOString().slice(0, 10) : '')
      const [rulesText, setRulesText] = React.useState((account.rules ?? []).map((rule) => `${rule.matchProvider ?? ''}|${rule.matchModel ?? ''}|${rule.priority}`).join('\n'))
      const [limits, setLimits] = React.useState((account.limits ?? []).map((limit) => ({
        externalKey: limit.externalKey ?? '',
        unit: ['tokens', 'newCompute'].includes(limit.unit) ? 'tokens' : limit.unit ?? 'percent',
        valueMode: limit.valueMode ?? 'manual',
        value: limit.exactValue != null ? String(limit.exactValue) : '',
        windowKind: limit.windowKind ?? 'rolling',
        windowSeconds: limit.windowSeconds != null ? String(limit.windowSeconds) : '',
      })))
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState(null)
      const legacy = account.sourceKind === 'legacy_v5_manual'
      const submit = async () => {
        setBusy(true)
        setMessage(null)
        try {
          const billing = {}
          if (priceUsd !== '') billing.priceUsd = Number(priceUsd)
          if (resetDay != null) billing.resetDay = Number(resetDay)
          if (balanceUsd !== '') billing.balanceUsd = Number(balanceUsd)
          if (expiryDay !== '') billing.expiryDay = expiryDay
          const rules = rulesText.split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => {
            const [provider, model, priority] = line.split(/\s*[|,]\s*/)
            return { matchProvider: provider || null, matchModel: model || null, priority: Number(priority || index) }
          }).filter((rule) => rule.matchProvider !== null || rule.matchModel !== null)
          const cleanLimits = limits.filter((limit) => limit.externalKey.trim() !== '').map((limit) => ({
            externalKey: limit.externalKey.trim(),
            unit: limit.unit,
            valueMode: limit.valueMode,
            value: (limit.valueMode === 'exact' || limit.valueMode === 'manual') && limit.value !== '' ? Number(limit.value) : null,
            windowKind: limit.windowKind,
            windowSeconds: limit.windowSeconds !== '' ? Number(limit.windowSeconds) : null,
          }))
          await accountRpc(ctx, 'save-account', {
            account: { id: account.id, name, kind, connectionId: account.connectionId, billing, limits: cleanLimits, rules },
          })
          onSaved?.()
        } catch (error) {
          setMessage(error.message)
        } finally {
          setBusy(false)
        }
      }
      const label = (text, control) => h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 } }, text, control)
      return h('div', { style: { ...cardStyle, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 12 } },
        label(t('accountNameLabel'), h('input', { style: inputStyle, value: name, disabled: legacy, onChange: (event) => setName(event.target.value) })),
        label(t('accountKindLabel'), h('select', { style: selectStyle, value: kind, disabled: legacy, onChange: (event) => setKind(event.target.value) },
          h('option', { value: 'subscription' }, t('kindSubscription')),
          h('option', { value: 'prepaid' }, t('kindPrepaid')),
          h('option', { value: 'track_only' }, t('kindTrackOnly')))),
        label(t('accountPrice'), h('input', { style: inputStyle, type: 'number', min: '0', step: '0.01', value: priceUsd, disabled: legacy, onChange: (event) => setPriceUsd(event.target.value) })),
        label(t('accountResetDay'), h('input', { style: inputStyle, type: 'number', min: '1', max: '28', value: resetDay, disabled: legacy, onChange: (event) => setResetDay(event.target.value) })),
        label(t('accountBalance'), h('input', { style: inputStyle, type: 'number', min: '0', step: '0.01', value: balanceUsd, disabled: legacy, onChange: (event) => setBalanceUsd(event.target.value) })),
        label(t('accountExpiry'), h('input', { style: inputStyle, value: expiryDay, placeholder: '2026-10-15', disabled: legacy, onChange: (event) => setExpiryDay(event.target.value) })),
        h('div', { style: { gridColumn: '1 / -1' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { className: 'tu3-k' }, t('limitWindowLabel')),
            h('button', { type: 'button', style: { ...buttonStyle, padding: '2px 9px', fontSize: 12 }, disabled: legacy,
              onClick: () => setLimits((rows) => [...rows, { externalKey: '', unit: 'tokens', valueMode: 'manual', value: '', windowKind: 'rolling', windowSeconds: 18000 }]) },
              t('addLimit')),
          ),
          limits.length === 0 ? h('p', { style: mutedStyle }, t('noQuotaDeclared')) : h('div', { style: { display: 'grid', gap: 8, marginTop: 8 } },
            limits.map((limit, index) => h('div', { key: index, style: { display: 'grid', gridTemplateColumns: 'minmax(90px, 1.1fr) 90px 90px minmax(70px, .8fr) 90px minmax(70px, .7fr) auto', gap: 6, alignItems: 'center' } },
              h('input', { style: inputStyle, value: limit.externalKey, placeholder: 'primary', disabled: legacy,
                onChange: (event) => setLimits((rows) => rows.map((row, i) => i === index ? { ...row, externalKey: event.target.value } : row)) }),
              h('select', { style: selectStyle, value: limit.unit, disabled: legacy,
                onChange: (event) => setLimits((rows) => rows.map((row, i) => i === index ? { ...row, unit: event.target.value } : row)) },
                ['tokens', 'usd', 'requests', 'percent', 'credits'].map((unit) => h('option', { key: unit, value: unit }, t(`units${unit.charAt(0).toUpperCase()}${unit.slice(1)}`)))),
              h('select', { style: selectStyle, value: limit.valueMode, disabled: legacy,
                onChange: (event) => setLimits((rows) => rows.map((row, i) => i === index ? { ...row, valueMode: event.target.value } : row)) },
                ['exact', 'manual', 'dynamic', 'unpublished'].map((mode) => h('option', { key: mode, value: mode }, modeLabel(mode, t)))),
              h('input', { style: inputStyle, type: 'number', min: '0', value: limit.value, placeholder: t('limitValueLabel'), disabled: legacy || (limit.valueMode !== 'exact' && limit.valueMode !== 'manual'),
                onChange: (event) => setLimits((rows) => rows.map((row, i) => i === index ? { ...row, value: event.target.value } : row)) }),
              h('select', { style: selectStyle, value: limit.windowKind, disabled: legacy,
                onChange: (event) => setLimits((rows) => rows.map((row, i) => i === index ? { ...row, windowKind: event.target.value } : row)) },
                ['rolling', 'fixed', 'billing'].map((windowKind) => h('option', { key: windowKind, value: windowKind }, t(`windowsKind${windowKind.charAt(0).toUpperCase()}${windowKind.slice(1)}`)))),
              h('input', { style: inputStyle, type: 'number', min: '0', value: limit.windowSeconds, placeholder: t('secondsLabel'), disabled: legacy || limit.windowKind === 'billing',
                onChange: (event) => setLimits((rows) => rows.map((row, i) => i === index ? { ...row, windowSeconds: event.target.value } : row)) }),
              h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 8px', fontSize: 11 }, disabled: legacy,
                onClick: () => setLimits((rows) => rows.filter((_, i) => i !== index)) }, '✕'),
            )),
            h('span', { style: mutedStyle }, t('unitsPercentHelp')),
          ),
        ),
        h('label', { style: { gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 } }, t('accountRules'),
          h('textarea', {
            style: { ...inputStyle, width: '100%', minHeight: 80, fontFamily: 'ui-monospace, monospace' },
            value: rulesText, placeholder: 'openai* | gpt-* | 0', disabled: legacy,
            onChange: (event) => setRulesText(event.target.value),
          }),
          h('span', { style: mutedStyle }, legacy ? t('legacyNote') : t('accountRulesHint'))),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', gridColumn: '1 / -1' } },
          legacy ? null : h('button', { type: 'button', style: primaryButtonStyle, disabled: busy, onClick: submit }, busy ? t('loading') : t('save')),
          message ? h('span', { style: { ...errorStyle, fontSize: 12 } }, message) : null,
        ),
      )
    }

    function AccountsEditor({ ctx, store, t }) {
      const accounts = useAsync(() => accountRpc(ctx, 'accounts'), [ctx])
      const [editing, setEditing] = React.useState(null)
      const [adding, setAdding] = React.useState(false)
      const [busy, setBusy] = React.useState(null)
      const archive = (account) => {
        setBusy(account.id)
        void accountRpc(ctx, 'archive-account', { id: account.id, archived: !account.archived })
          .then(accounts.reload)
          .catch((error) => store.update({ error: error.message }))
          .finally(() => setBusy(null))
      }
      const [dragId, setDragId] = React.useState(null)
      const [orderVersion, setOrderVersion] = React.useState(0)
      if (accounts.status !== 'ready') return h(LoadPanel, { status: accounts.status, error: accounts.error, reload: accounts.reload, t })
      const rows = accounts.value.accounts ?? []
      const active = orderAccounts(rows.filter((row) => !row.archived), readAccountOrder())
      // eslint-disable-next-line no-unused-vars
      void orderVersion
      const displayRows = [...active, ...rows.filter((row) => row.archived)]
      const handleDrop = (targetId) => {
        if (dragId == null || dragId === targetId) { setDragId(null); return }
        const ids = active.map((account) => account.id)
        const from = ids.indexOf(dragId)
        const to = ids.indexOf(targetId)
        if (from !== -1 && to !== -1) {
          ids.splice(to, 0, ids.splice(from, 1)[0])
          writeAccountOrder(ids)
          setOrderVersion((version) => version + 1)
        }
        setDragId(null)
      }
      const sectionTitle = (text, control) => h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 } },
        h('p', { style: { ...sectionTitleStyle, margin: 0 } }, text),
        h('span', { style: badgeStyle }, `${rows.filter((row) => !row.archived).length} ${t('accountsCount')}`),
        h('span', { style: { marginLeft: 'auto' } }),
        control,
      )
      return h('div', null,
        sectionTitle(t('accountsTab'), h('button', { type: 'button', style: primaryButtonStyle, onClick: () => { setAdding(!adding); setEditing(null) } }, t('accountAdd'))),
        h('p', { style: { ...mutedStyle, margin: '-4px 0 10px' } }, t('accountsOrderHint')),
        store.state.error ? h('p', { style: errorStyle }, store.state.error) : null,
        adding ? h(AccountWizard, { ctx, t, onDone: () => { setAdding(false); accounts.reload() } }) : null,
        h('table', { style: tableStyle },
          h('thead', null, h('tr', null,
            h('th', { style: thStyle }, t('accountNameLabel')), h('th', { style: thStyle }, t('accountKindLabel')),
            h('th', { style: thStyle }, t('limitWindowLabel')), h('th', { style: thStyle }, t('accountRules')), h('th', { style: thStyle }),
          )),
          h('tbody', null, displayRows.map((account, index) => h('tr', {
            key: account.id,
            style: { ...(!account.archived ? { cursor: 'grab' } : {}), ...(account.archived ? { opacity: 0.5 } : {}), ...(dragId === account.id ? { opacity: 0.35 } : {}) },
            draggable: !account.archived,
            title: account.archived ? undefined : t('accountsOrderHint'),
            onDragStart: () => setDragId(account.id),
            onDragOver: (event) => { if (dragId != null && dragId !== account.id && !account.archived) event.preventDefault() },
            onDrop: () => handleDrop(account.id),
            onDragEnd: () => setDragId(null),
          },
            h('td', { style: tdStyle }, h('i', { className: 'tu3-dot', style: { background: account.color || POOL_COLORS[index % POOL_COLORS.length] } }),
              account.name, account.archived ? ` (${t('accountArchived')})` : '',
              h('span', { className: 'tu3-tag', style: { ...badgeStyle, marginLeft: 6 } }, originLabel(account.sourceKind, t))),
            h('td', { style: tdStyle }, kindLabel(account.billing?.kind ?? 'track_only', t)),
            h('td', { style: tdStyle }, (account.limits ?? []).map((limit) => windowLabel(limit, t)).join(' + ') || '—'),
            h('td', { style: tdStyle }, (account.rules ?? []).map((rule) => `${rule.matchProvider ?? '*'}${rule.matchModel ? ` / ${rule.matchModel}` : ''}`).join('  ·  ') || '—'),
            h('td', { style: { ...tdStyle, whiteSpace: 'nowrap' } },
              h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 9px', fontSize: 12 }, onClick: () => { setEditing(editing === account.id ? null : account.id); setAdding(false) } }, t('edit')),
              h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 9px', fontSize: 12, marginLeft: 6 }, disabled: busy === account.id, onClick: () => archive(account) },
                account.archived ? t('restore') : t('archive')),
            ),
          ))),
        ),
        editing !== null ? h(AccountAdvancedForm, {
          ctx, t,
          account: rows.find((row) => row.id === editing),
          onSaved: () => { setEditing(null); accounts.reload() },
        }) : null,
      )
    }

    // ---------- v5 dashboard (A) ----------
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

    function Dashboard({ ctx, store, state, t }) {
      const box = useDashboard(ctx, state, t)
      const [dragId, setDragId] = React.useState(null)
      React.useEffect(() => { void accountRpc(ctx, 'summary').catch(() => {}) }, [ctx])
      if (box.status === 'loading') return h('div', { className: 'tu3-wrap' }, h('p', { style: mutedStyle }, t('loading')))
      if (box.status === 'error') {
        return h('div', { className: 'tu3-wrap' }, h(LoadPanel, { status: 'error', error: box.error, reload: box.reload, t }))
      }
      const data = box.value
      if (!data.pools?.configured) return h(Onboarding, { ctx, store, t })
      const pools = data.pools
      pools.pools.forEach((pool, index) => { pool.colorIndex = index })
      const orderedPools = orderAccounts(pools.pools, readAccountOrder())
      const moveCard = (targetId) => {
        if (dragId == null || dragId === targetId) { setDragId(null); return }
        const ids = orderedPools.map((pool) => pool.id)
        const from = ids.indexOf(dragId)
        const to = ids.indexOf(targetId)
        if (from !== -1 && to !== -1) {
          ids.splice(to, 0, ids.splice(from, 1)[0])
          writeAccountOrder(ids)
        }
        setDragId(null)
      }
      const totalValue = data.kpis.cost.currentUsdNano
      const heroValue = state.lens === 'value' ? totalValue
        : state.lens === 'token' ? data.kpis.newComputeTokens
        : data.kpis.requests
      const topModel = (data.rankings?.rows ?? [])[0]
      const topShare = topModel && totalValue > 0
        ? (state.lens === 'value' ? topModel.cost.currentUsdNano / totalValue : state.lens === 'token' ? topModel.newComputeTokens / data.kpis.newComputeTokens : topModel.requests / data.kpis.requests)
        : null
      return h('div', { className: 'tu3-wrap' },
        h('div', { className: 'tu3-hero' },
          h('section', { className: 'tu3-card', style: { padding: '18px 22px' } },
            h('div', { className: 'tu3-k' }, t('monthActivity'), ' · ', h(LensCycle, { state, store, t })),
            h('div', { className: 'tu3-big' }, lensText(heroValue, state.lens, t)),
            topModel ? h('div', { style: { color: C.textSecondary, marginTop: 6, fontSize: 12.5 } },
              `${t('topModel')}（${lensLabel(t, state.lens)}）：`, h('b', null, topModel.label), topShare !== null ? ` · ${(topShare * 100).toFixed(0)}%` : '') : null,
          ),
          h(AccountStrip, { list: orderedPools, lens: state.lens, t }),
        ),
        h(ActivityChart, { data, state, store, t }),
        h(ModelRank, { data, state, t }),
        h(AccountTabs, { data, list: orderedPools, state, store, t }),
        state.account === null || state.account === 'unassigned'
          ? h('section', { className: 'tu3-card', style: { padding: '16px 18px' } },
              h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 } },
                orderedPools.map((pool) => h('div', {
                  key: pool.id,
                  style: { border: `1px solid ${C.borderFaint}`, borderRadius: 12, padding: '13px 15px', ...(dragId === pool.id ? { opacity: 0.4 } : {}) },
                  draggable: true, title: t('accountsOrderHint'),
                  onDragStart: () => setDragId(pool.id),
                  onDragOver: (event) => { if (dragId != null && dragId !== pool.id) event.preventDefault() },
                  onDrop: () => moveCard(pool.id),
                  onDragEnd: () => setDragId(null),
                },
                  h('h3', { style: { margin: '0 0 8px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 } },
                    h('i', { className: 'tu3-dot', style: { background: poolColor(pool, poolIndexOf(pool)) } }), pool.name,
                    h('span', { style: { fontSize: 11, color: C.textSecondary, fontWeight: 400 } }, kindLabel(pool.kind, t)),
                    pool.billing?.priceUsd != null ? h('span', { style: { fontSize: 11, color: C.textSecondary, fontWeight: 400 } }, `${fmtUsdAmount(pool.billing.priceUsd)}/mo`) : null,
                  ),
                  h(DuoMeter, { pool, index: poolIndexOf(pool), t }),
                  h('div', { style: { display: 'flex', gap: 14, flexWrap: 'wrap', color: C.textSecondary, fontSize: 12, marginTop: 8 } }, paceNote(pool, t)),
                  h('div', { style: { display: 'flex', gap: 14, flexWrap: 'wrap', color: C.textSecondary, fontSize: 12, marginTop: 6 } },
                    h('span', null, `${t('equivalent')} `, h('b', { style: { color: C.text, font: '650 12px ui-monospace, monospace' } }, fmtUsd(pool.kpis.cost.currentUsdNano))),
                    h('span', null, `${t('requests')} `, h('b', { style: { color: C.text, font: '650 12px ui-monospace, monospace' } }, String(pool.kpis.requests))),
                    h('span', null, `${t('newCompute')} `, h('b', { style: { color: C.text, font: '650 12px ui-monospace, monospace' } }, fmtTokens(pool.kpis.newComputeTokens))),
                  ),
                  h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 9px', fontSize: 12, marginTop: 8 }, onClick: () => store.update({ account: pool.id }) }, t('edit')),
                )),
                pools.unassigned ? h('div', { key: 'unassigned', style: { border: `1px dashed ${C.border}`, borderRadius: 12, padding: '13px 15px' } },
                  h('h3', { style: { margin: '0 0 8px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 } },
                    h('i', { className: 'tu3-dot', style: { background: UNASSIGNED_COLOR } }), t('unassignedPool')),
                  h('p', { style: mutedStyle }, t('unassignedNote', { tokens: fmtTokens(pools.unassigned.newComputeTokens), requests: String(pools.unassigned.requests) })),
                  h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 9px', fontSize: 12, marginTop: 8 }, onClick: () => store.update({ dataSection: 'accounts' }) }, t('assignNow')),
                ) : null,
              ),
            )
          : h(AccountInsight, { ctx, store, state, t }),
      )
    }

    // ---------- v5 dock panel (B) ----------
    function DockPanel({ ctx, store, state, t }) {
      const box = useDashboard(ctx, state, t)
      const [dragId, setDragId] = React.useState(null)
      // Opening any account surface ensures the zero-config connection
      // accounts exist even if the boot pass has not run yet.
      React.useEffect(() => { void accountRpc(ctx, 'summary').catch(() => {}) }, [ctx])
      const body = () => {
        // Refreshing keeps the previous frame visible; only a first load or a
        // hard error replaces it (otherwise every 15s poll flashed the panel).
        if (!box.value) {
          return box.status === 'error'
            ? h(LoadPanel, { status: 'error', error: box.error, reload: box.reload, t })
            : h('p', { style: mutedStyle }, t('loading'))
        }
        const data = box.value
        if (!data.pools?.configured) {
          return h(Onboarding, { ctx, store, t, compact: true })
        }
        const pools = data.pools
        if (state.account !== null && state.account !== 'unassigned') {
          return h('div', { style: { padding: 12 } },
            h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 9px', fontSize: 12, marginBottom: 10 }, onClick: () => store.update({ account: null }) }, t('insightBack')),
            h(AccountInsight, { ctx, store, state, t, compact: true }),
          )
        }
        const heroValue = state.lens === 'value' ? data.kpis.cost.currentUsdNano : state.lens === 'token' ? data.kpis.newComputeTokens : data.kpis.requests
        const sparkDays = data.seriesBy?.days ?? []
        const sparkValues = sparkDays.map((day) => Object.values(day.groups).reduce((sum, cell) => sum + lensMetric(cell, state.lens), 0))
        const sparkMax = Math.max(1, ...sparkValues)
        const tightest = pools.pools.find((pool) => pool.id === pools.tightestPoolId) ?? null
        pools.pools.forEach((pool, index) => { pool.colorIndex = index })
        const orderedPools = orderAccounts(pools.pools, readAccountOrder())
        const selectedPool = orderedPools.find((pool) => pool.id === state.account) ?? null
        const moveDockRow = (targetId) => {
          if (dragId == null || dragId === targetId) { setDragId(null); return }
          const ids = orderedPools.map((pool) => pool.id)
          const from = ids.indexOf(dragId)
          const to = ids.indexOf(targetId)
          if (from !== -1 && to !== -1) {
            ids.splice(to, 0, ids.splice(from, 1)[0])
            writeAccountOrder(ids)
          }
          setDragId(null)
        }
        const series = data.seriesBy
        const groupColor = (id) => {
          const poolIndex = pools.pools.findIndex((entry) => entry.id === id)
          if (poolIndex >= 0) return poolColor(pools.pools[poolIndex], poolIndex)
          return id === 'unassigned' ? UNASSIGNED_COLOR : POOL_COLORS[2]
        }
        const selectedDay = state.day === null ? null : sparkDays.find((day) => day.key === state.day) ?? null
        const dayDetail = selectedDay === null ? null : (() => {
          const entries = Object.entries(selectedDay.groups).map(([id, cell]) => ({
            id,
            label: series.groups.find((group) => group.id === id)?.label ?? id,
            value: lensMetric(cell, state.lens),
            color: groupColor(id),
          })).sort((left, right) => right.value - left.value)
          const top = entries.slice(0, 3)
          const rest = entries.slice(3).reduce((sum, entry) => sum + entry.value, 0)
          return h('div', { className: 'tu3-daydetail', style: { marginTop: 8 } },
            h('b', null, selectedDay.key, ' · ', t('dayTotal'), ' ', lensText(sparkValues[sparkDays.findIndex((day) => day.key === state.day)], state.lens, t)),
            h('div', { style: { marginTop: 3 } },
              top.map((entry) => h('span', { key: entry.id, style: { marginRight: 10 } },
                h('i', { className: 'tu3-dot', style: { background: entry.color } }),
                entry.label, ' ', h('b', { style: { font: '650 11px ui-monospace, monospace' } }, lensText(entry.value, state.lens, t)))),
              rest > 0 ? h('span', { style: { color: C.textSecondary } }, `${t('otherGroup')} ${lensText(rest, state.lens, t)}`) : null,
            ),
          )
        })()
        return h('div', { style: { paddingBottom: 18 } },
          h('div', { className: 'tu3-dock-chips' },
            h('button', { type: 'button', className: `tu3-dock-chip${state.account === null ? ' on' : ''}`, onClick: () => store.update({ account: null }) }, t('allPools')),
            orderedPools.map((pool) => h('button', {
              key: pool.id, type: 'button', className: `tu3-dock-chip${state.account === pool.id ? ' on' : ''}`,
              onClick: () => store.update({ account: pool.id }),
            }, h('i', { className: 'tu3-dot', style: { background: poolColor(pool, poolIndexOf(pool)) } }), pool.name.replace(/ (Plus|Pro|Max)$/g, ''))),
          ),
          h('div', { style: { margin: '0 14px', padding: '16px 8px 14px', borderRadius: 12, background: C.bgMuted, textAlign: 'center' } },
            h('div', { style: { fontSize: 30, fontWeight: 760, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' } }, lensText(heroValue, state.lens, t)),
            h('div', { style: { color: C.textSecondary, fontSize: 11.5, marginTop: 4 } },
              state.account === null
                ? [`${t('allPools')}${pools.unassigned ? ` + ${t('unassignedPool')}` : ''} · `, h(LensCycle, { state, store, t })]
                : `${selectedPool?.name ?? state.account}`),
          ),
          h('div', { style: { margin: '14px 16px 0' } },
            h('div', { className: 'tu3-k', style: { marginBottom: 6 } }, t('sparkTitle')),
            h('div', { className: 'tu3-spark' },
              sparkValues.map((value, index) => h('i', {
                key: sparkDays[index].key,
                className: state.day === sparkDays[index].key ? 'hl' : '',
                style: { height: `${Math.max(6, value / sparkMax * 40)}px`, cursor: 'pointer' },
                title: `${sparkDays[index].key} · ${lensText(value, state.lens, t)}`,
                onClick: () => store.update({ day: state.day === sparkDays[index].key ? null : sparkDays[index].key }),
              })),
            ),
            selectedDay === null
              ? h('div', { style: { ...mutedStyle, marginTop: 6 } }, t('activityHint'))
              : dayDetail,
          ),
          tightest ? h('div', { style: { margin: '12px 14px 0', padding: '9px 12px', borderRadius: 9, background: C.bgMuted, color: C.textSecondary, fontSize: 11.5 } }, paceNote(tightest, t)) : null,
          h('div', { style: { marginTop: 14, borderTop: `1px solid ${C.borderFaint}`, paddingTop: 6 } },
            h('div', { className: 'tu3-k', style: { margin: '0 16px 6px' } }, t('poolsMonthly')),
            orderedPools.map((pool) => h('div', {
              key: pool.id, className: 'tu3-dock-acc',
              draggable: true, title: t('accountsOrderHint'),
              style: dragId === pool.id ? { opacity: 0.4 } : undefined,
              onDragStart: () => setDragId(pool.id),
              onDragOver: (event) => { if (dragId != null && dragId !== pool.id) event.preventDefault() },
              onDrop: () => moveDockRow(pool.id),
              onDragEnd: () => setDragId(null),
            },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.textSecondary, marginBottom: 5 } },
                h('span', null, h('i', { className: 'tu3-dot', style: { background: poolColor(pool, poolIndexOf(pool)) } }), pool.name),
                h('b', { style: { color: C.text, font: '650 12px ui-monospace, monospace' } }, pool.usedPct == null ? '—' : `${pool.usedPct.toFixed(0)}%`),
              ),
              h(DuoMeter, { pool, index: poolIndexOf(pool), t, compact: true }),
            )),
          ),
        )
      }
      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 2, padding: '12px 12px 12px 16px', borderBottom: `1px solid ${C.border}` } },
          h('b', { style: { fontSize: 15, letterSpacing: '-0.2px' } }, t('title')),
          h('button', { type: 'button', style: { marginLeft: 'auto', border: 'none', background: 'transparent', color: C.textSecondary, fontSize: 12.5, cursor: 'pointer', padding: '6px 8px', borderRadius: 8 }, onClick: () => store.update({ mode: 'dash', account: null }) }, t('fullscreen')),
          h('button', { type: 'button', style: { border: 'none', background: 'transparent', color: C.textSecondary, fontSize: 15, cursor: 'pointer', padding: '4px 8px', borderRadius: 8 }, onClick: () => store.update({ open: false }), 'aria-label': t('close') }, '✕'),
        ),
        h('div', { style: { flex: 1, overflow: 'auto', paddingBottom: 16 } }, body()),
      )
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
          mappedCanonical: canonical,
          isCustom,
          inputRate: isCustom ? `$${(Number(override.input_nano) / 1000).toFixed(2)}` : (canonical ? t('modeExact') : '$0.14'),
          outputRate: isCustom ? `$${(Number(override.output_nano) / 1000).toFixed(2)}` : (canonical ? t('modeExact') : '$0.28'),
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
          setPriceMessage(`${t('created')}: ${rawModel} → ${targetModel}`)
          setShowMappingDrawer(false)
        } catch (e) {
          setPriceMessage(`${t('createFailed')}: ${e.message}`)
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
          setPriceMessage(t('saved'))
        } catch (e) {
          setPriceMessage(e.message)
        } finally {
          setPriceBusy(false)
        }
      }

      const refreshUpstreamPrices = async () => {
        setPriceBusy(true)
        try {
          await rpc(ctx, 'price-refresh-apply')
          await Promise.all([settings.reload(), catalog.reload()])
          setPriceMessage(t('priceCatalogSynced'))
        } catch (e) {
          setPriceMessage(e.message)
        } finally {
          setPriceBusy(false)
        }
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        h('div', { style: { ...cardStyle, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('div', null,
            h('h2', { style: { margin: 0, fontSize: 15 } }, t('pricingTitle')),
            h('p', { style: { ...mutedStyle, marginTop: 4 } }, `${observed.length} ${t('pricingObservedModels')} · ${t('pricingCatalogV')} v${snapshot.version ?? '1'} (${allCatalogModels.length})`),
            priceMessage ? h('p', { style: { color: '#16865f', fontSize: 12, fontWeight: 600, marginTop: 4 } }, priceMessage) : null,
          ),
          h('div', { style: { display: 'flex', gap: 10 } },
            h('input', {
              style: { ...inputStyle, width: 220 },
              placeholder: t('pricingSearchPh'),
              value: filterText,
              onChange: (e) => setFilterText(e.target.value)
            }),
            h('button', { style: primaryButtonStyle, type: 'button', disabled: priceBusy, onClick: refreshUpstreamPrices }, priceBusy ? t('pricingRefreshing') : t('pricingRefresh')),
          )
        ),

        h('div', { style: { ...cardStyle, padding: 0, overflow: 'hidden' } },
          h('table', { style: { ...tableStyle, margin: 0 } },
            h('thead', { style: { background: 'var(--dsw-alias-bg-multi-select, #f8f9fa)' } },
              h('tr', null,
                h('th', { style: { ...thStyle, padding: '10px 16px' } }, t('colObserved')),
                h('th', { style: thStyle }, t('colProvider')),
                h('th', { style: thStyle }, t('colCalls')),
                h('th', { style: { ...thStyle, color: 'var(--dsw-alias-state-business-primary, #4176e6)' } }, t('colMapped')),
                h('th', { style: thStyle }, t('colInput')),
                h('th', { style: thStyle }, t('colOutput')),
                h('th', { style: thStyle }, t('colCache')),
                h('th', { style: { ...thStyle, textAlign: 'right', paddingRight: 16 } }, t('colActions')),
              )
            ),
            h('tbody', null,
              ...filteredObserved.map(row => {
                const isEditing = editingModel === row.model
                const isUnmapped = !row.mappedCanonical
                return h('tr', { key: `${row.provider}:${row.model}`, style: { background: isEditing ? 'var(--dsw-alias-interactive-bg-active, rgba(65,118,230,0.05))' : 'transparent' } },
                  h('td', { style: { ...tdStyle, padding: '12px 16px', fontWeight: 600 } },
                    row.model,
                    isUnmapped ? h('span', { style: { ...badgeStyle, background: '#fee2e2', color: '#dc2626', marginLeft: 6, fontSize: 10 } }, t('unmapped')) : null
                  ),
                  h('td', { style: tdStyle }, h('span', { style: badgeStyle }, row.provider)),
                  h('td', { style: tdStyle }, `${row.requests}`),
                  h('td', { style: tdStyle },
                    isEditing
                      ? h('input', { style: { ...inputStyle, width: 180 }, value: editAlias, placeholder: t('inputPlaceholder'), onChange: e => setEditAlias(e.target.value) })
                      : row.mappedCanonical
                        ? h('span', { style: { fontWeight: 600, color: 'var(--dsw-alias-state-business-primary, #4176e6)', cursor: 'pointer' }, onClick: () => openMapping(row) }, `➔ ${row.mappedCanonical}`)
                        : h('button', { style: { ...buttonStyle, padding: '3px 8px', fontSize: 11, borderColor: '#f87171', color: '#dc2626' }, onClick: () => openMapping(row) }, t('unmapped'))
                  ),
                  h('td', { style: tdStyle }, isEditing ? h('input', { style: { ...inputStyle, width: 70 }, value: editInput, onChange: e => setEditInput(e.target.value) }) : row.inputRate),
                  h('td', { style: tdStyle }, isEditing ? h('input', { style: { ...inputStyle, width: 70 }, value: editOutput, onChange: e => setEditOutput(e.target.value) }) : row.outputRate),
                  h('td', { style: tdStyle }, isEditing ? h('input', { style: { ...inputStyle, width: 70 }, value: editCacheRead, onChange: e => setEditCacheRead(e.target.value) }) : row.cacheRate),
                  h('td', { style: { ...tdStyle, textAlign: 'right', paddingRight: 16 } },
                    isEditing
                      ? h('div', { style: { display: 'inline-flex', gap: 6 } },
                          h('button', { style: { ...primaryButtonStyle, padding: '3px 8px', fontSize: 11 }, type: 'button', onClick: () => saveOverridePrice(row.model, editInput, editOutput, editCacheRead) }, t('save')),
                          h('button', { style: { ...buttonStyle, padding: '3px 8px', fontSize: 11 }, type: 'button', onClick: () => setEditingModel(null) }, t('cancel')),
                        )
                      : h('div', { style: { display: 'inline-flex', gap: 6 } },
                          h('button', { style: { ...buttonStyle, padding: '4px 8px', fontSize: 11 }, type: 'button', onClick: () => openMapping(row) }, t('mapBtn')),
                          h('button', { style: { ...buttonStyle, padding: '4px 8px', fontSize: 11 }, type: 'button', onClick: () => { setEditingModel(row.model); setEditAlias(row.mappedCanonical ?? ''); setEditInput(row.inputRate.replace('$', '')); setEditOutput(row.outputRate.replace('$', '')); setEditCacheRead(row.cacheRate.replace('$', '')) } }, t('priceBtn')),
                        )
                  ),
                )
              })
            )
          )
        ),

        showMappingDrawer && selectedObservedForMapping ? h('div', {
          style: {
            position: 'fixed', right: 0, top: 0, bottom: 0, width: 440, background: 'var(--dsw-alias-bg-layer-1, #fff)',
            boxShadow: '-10px 0 30px rgba(0,0,0,0.15)', zIndex: 10000, padding: 20, display: 'flex', flexDirection: 'column', gap: 14,
            borderLeft: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))'
          }
        },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06))', paddingBottom: 10 } },
            h('h3', { style: { margin: 0, fontSize: 15 } }, t('mappingTitle')),
            h('button', { style: closeStyle, onClick: () => setShowMappingDrawer(false) }, '✕'),
          ),
          h('div', { style: { background: 'var(--dsw-alias-bg-multi-select, #f8f9fa)', padding: 12, borderRadius: 8 } },
            h('div', { style: { fontSize: 11, color: '#888' } }, t('mappingCurrent')),
            h('div', { style: { fontSize: 15, fontWeight: 700, margin: '2px 0' } }, selectedObservedForMapping.model),
            h('div', { style: { fontSize: 11, color: '#666' } }, `${t('mappingProvider')}: ${selectedObservedForMapping.provider} · ${t('mappingRequests')}: ${selectedObservedForMapping.requests}`),
          ),
          h('div', null,
            h('label', { style: { fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 } }, t('mappingSearchLabel')),
            h('input', {
              style: { ...inputStyle, width: '100%', boxSizing: 'border-box' },
              placeholder: 'deepseek, gpt-4o, claude, glm…',
              value: catalogSearch,
              onChange: e => setCatalogSearch(e.target.value)
            })
          ),
          h('div', { style: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 } },
            h('div', { style: { fontSize: 11, color: '#888', marginBottom: 4 } }, t('mappingCandidates')),
            ...allCatalogModels.filter(t => t.toLowerCase().includes(catalogSearch.toLowerCase())).slice(0, 50).map(target => h('div', {
              key: target,
              onClick: () => saveAlias(selectedObservedForMapping.model, target),
              style: {
                padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08))',
                background: 'var(--dsw-alias-bg-layer-1, #fff)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              },
            },
              h('div', null,
                h('strong', { style: { fontSize: 13, color: 'var(--dsw-alias-state-business-primary, #4176e6)' } }, target),
                h('div', { style: { fontSize: 11, color: '#888', marginTop: 2 } }, t('modeExact')),
              ),
              h('span', { style: { fontSize: 12, color: '#888' } }, t('mappingChoose')),
            )),
          ),
          h('p', { style: mutedStyle }, t('mappingFooter')),
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

    // ---------- v5 data & settings corner ----------
    const DATA_SECTIONS = [['accounts', 'accountsTab'], ['pricing', 'dataPricing'], ['data', 'dataImport'], ['settings', 'tabSettings']]
    function DataCorner({ ctx, store, state, t }) {
      return h('div', { style: contentStyle },
        h('div', { style: { display: 'flex', gap: 2, marginBottom: 16, flexWrap: 'wrap' } },
          DATA_SECTIONS.map(([key, label]) => h('button', {
            key, type: 'button', style: {
              padding: '6px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: 'none',
              background: state.dataSection === key ? C.bgActive : 'transparent',
              color: state.dataSection === key ? C.text : C.textSecondary,
            },
            onClick: () => store.update({ dataSection: key }),
          }, t(label))),
        ),
        state.dataSection === 'accounts' ? h(AccountsEditor, { ctx, store, t }) : null,
        state.dataSection === 'pricing' ? h(PricingTab, { ctx, t }) : null,
        state.dataSection === 'data' ? h(DataTab, { ctx, t, filter: { time: { preset: '30d' } } }) : null,
        state.dataSection === 'settings' ? h(SettingsTab, { ctx, t }) : null,
      )
    }

    // ---------- v5 overlay shell ----------
    function Overlay(props) {
      const { ctx, store, t } = props
      const state = useStore(store)
      React.useEffect(() => {
        if (!state.open) return undefined
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if (store.state.dataSection !== null) store.update({ dataSection: null })
          else if (store.state.account !== null) store.update({ account: null })
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
          state.account !== null
            ? h('button', { type: 'button', style: { ...buttonStyle, padding: '4px 10px' }, onClick: () => store.update({ account: null }) }, t('insightBack'))
            : null,
          h('p', { style: titleStyle }, t('title')),
          h('span', { style: badgeStyle, marginLeft: 12 }, t('last30')),
          h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
            h('button', { type: 'button', style: buttonStyle, onClick: () => store.update({ dataSection: state.dataSection === null ? 'accounts' : null }) }, state.dataSection === null ? t('dataCorner') : t('backToDash')),
            h('button', { type: 'button', style: buttonStyle, onClick: () => store.update({ mode: 'dock', dataSection: null, account: null }) }, t('dockMode')),
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
    // v5 default is the CodexBar dual-bar; the thick bar is the tightest
    // constraint across official windows and local quotas.
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
      const windowBit = tightest?.windowLabel ? ` · ${tightest.windowLabel}` : ''
      const resetBit = tightest?.resetsAt ? ` · ${t('resetIn')} ${countdown(tightest.resetsAt - Date.now(), t)}` : ''
      const caption = tightest != null
        ? `${tightest.name}${windowBit}${resetBit}`
        : t('entryUnconfigured')
      const monthBit = summary?.month ? `${t('monthProgress')} ${summary.month.elapsedPct.toFixed(0)}%` : ''
      const aria = [title, pctLabel, caption, monthBit].filter(Boolean).join(' ')
      const open = () => store.update({ open: true, mode: 'dock' })

      if (!wide) {
        return h('button', { type: 'button', style: footerButtonStyle(), title: aria, onClick: open },
          h(UsageGlyph),
        )
      }

      if (styleKind === 'hidden') {
        return h('button', { type: 'button', style: footerButtonStyle(), title: title, onClick: open },
          h(UsageGlyph),
          h('span', null, title),
        )
      }

      if (styleKind === 'plain') {
        const plain = mode === 'cost' ? fmtUsd(today?.costUsdNano ?? null) : mode === 'tokens' && today ? fmtTokens(today.processingTokens ?? 0) : title
        return h('button', { type: 'button', style: footerButtonStyle(), title: title, onClick: open },
          h(UsageGlyph),
          h('span', { style: { minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', null, title),
            h('span', { style: { marginLeft: 'auto', opacity: 0.7 } }, '↗'),
          ),
        )
      }

      if (styleKind === 'badge') {
        return h('button', { type: 'button', style: footerButtonStyle(), title: aria, onClick: open },
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

      // Dual bars — the v5 default, official-first.
      return h('button', { type: 'button', style: footerButtonStyle(), title: aria, onClick: open },
        h('style', null, v3Css),
        h(UsageGlyph),
        h('span', { style: { minWidth: 0, flex: 1 } },
          h('span', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', { style: { fontWeight: 600, color: C.text } }, title),
            h('span', { style: { marginLeft: 'auto', font: '650 11px ui-monospace, SFMono-Regular, Menlo, monospace', color: risk ? 'var(--dsw-alias-state-error-primary, #ec1313)' : C.text } }, pctLabel),
          ),
          h('span', { className: 'tu3-entry-bars' },
            h('span', { className: 'tu3-entry-b1' },
              h('i', { style: { display: 'block', height: '100%', width: `${Math.min(100, usedPct)}%`, borderRadius: 2, background: risk ? 'var(--dsw-alias-state-error-primary, #ec1313)' : (tightest?.color || 'var(--dsw-alias-state-business-primary, #4176e6)') } })),
            h('span', { className: 'tu3-entry-b2' },
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
