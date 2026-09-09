# DSH Accounts & Usage

`dsh-token-usage` 保留原包名和本地账本。**5.1.4 是未发布的准备候选**，组合治理增量、Antigravity 额度面热修复与 OAuth 生命周期修复。无遥测、不保存提示词、不改 DSH 核心、不新增数据迁移。下方固定 tag 命令仅在对应 tag 实际发布并核验后使用。

## 5.1.4 候选范围与证据

设置页独立读取本地连接事实，不依赖统计库或触发额度刷新；已存原始 key 仍标为已配置但未校验。Antigravity 额度/目录读取优先 daily → prod → sandbox；显式 baseUrl 仍钉死，生成与项目发现路径不变。

订阅登录新增 pending-login 与 challenge 返回前/后的显式取消。关闭面板不取消宿主授权，重新展开重挂同一操作，不产生迟到弹窗或过期 UI 更新。修复终态前的输入候选已通过 **311 项账户测试**、**27 项压缩 R2 配对测试**（1 项可选实时时钟测试跳过），以及隔离 Lab 内明确授权的 **Grok** 关闭/重挂、早期/等待中取消及最终设备绑定。这不证明所有提供方 OAuth、所有失败模式或未来 tag 的安装。受测压缩 R2 是版本字段为 0.3.2 的源码快照，不代表已发布 0.3.2 tag 包含其后续回放修复。

`codex-runtime/v1` 接缝、普通1800秒/准备120秒/压缩300秒预算、SDK 钉住版本与数据身份不变。本准备候选另修复重挂登录failed/cancelled后卡片与禁用状态的清理，并补两项离线回归；未对这两种终态重复真实提供方验收。除此局部UI清理外，运行时保全自已测试输入，发布版本/文档另记差量；最终 commit/tag、artifact 与生产验收仍待完成。

## 历史 5.1.3 普通生成期限修复

本发布配套 `dsh-codex-compaction` 0.3.2。普通 Native 重放不再受 120 秒生成总上限限制：
生产 `open()` 的绝对总预算为 **1800 秒**（包含准备时间），模型解析/readiness/认证绑定
另有 **120 秒准备上限**，绑定成功即撤销准备计时器。配套转换器复用已发布 PiAiAdapter 的
**300 秒无模型输出超时**，文本、推理与工具参数增量均可重置空闲等待；网络心跳不算模型输出。
输出不能延长 owner 总期限。绕过配套转换器直接消费 owner 能力的调用只有 owner 期限，
不会自动获得另一套空闲监控。

显式 Native 压缩仍是 **300 秒总预算**，覆盖全部有限恢复，转换器也保持 300 秒；
不新增压缩准备阶段的短上限。retry/fallback、创建 provider、切换账户都不能续租。
取消与首次停止原因保持权威，凭据处理、v1 检查点和历史会话格式不变。

受信任 owner 工厂的 `timeoutMs` 仍表示总预算（默认 30000ms，上限 1800000ms）；
新增 `setupTimeoutMs`，默认 `min(timeoutMs,120000)`，上限 120000ms；
`compactionTimeoutMs` 默认 `min(timeoutMs,300000)`，避免普通生成预算隐式扩大压缩。
普通准备及只读 applicability 采用准备/总预算较小值。公开 `open()` 和模型工具不新增任意超时参数。
可选 diagnostics 保留 `budgetMs`，新增 `totalBudgetMs`、`setupBudgetMs`、`timeoutBudgetMs`
和 `timeoutKind: setup|total`，旧 owner 缺失字段保持缺失。owner 到期保留 `CODEX_RUNTIME_TIMEOUT`；
配套转换器空闲退出使用固定 idle 提示与 `TIMEOUT`，不透传原始 SDK 错误。
旧 v1 owner/reader 保持读取兼容，但仅更新一方不代表获得完整的新预算保障。

本地测试、不可变发布身份、tag 换装和原实例验收分别记账；契约本身不代表已在当前 GUI 生效。
有限预算不保证任意模型请求都能完成。

## 历史 5.1.2 Native runtime 修正

Native SSE 在合法 `response.completed`/`response.done` 且存在一个有效压缩项时完成，
不再等待 HTTP EOF，之后字节不再解释。完成前 EOF（含帧截断）或 socket read 断开为
可恢复的 `CODEX_RUNTIME_RESPONSE_STREAM`；畸形 Native 响应为不可重试的
`CODEX_RUNTIME_RESPONSE_PROTOCOL`。首次停止原因 TIMEOUT/CANCELLED/CLOSED/DISPOSED
在后续 handle 调用中保留。显式压缩租约为 300 秒，普通请求仍为 120 秒；配套插件的
Native 转换器同为 300 秒，重放/文本转换器仍为 120 秒。创建 provider 或恢复都不能续租。
可选 `diagnostics()` 只返回固定字段/枚举与数字耗时/计数，含 `budgetMs` 和 `eventCounts`，
不包含原始事件名、内容、账户标识或凭据。

runtime 不增加自动重试、登录或 checkpoint 格式。配套压缩插件持有同租约**一次额外请求**：
Native retry 或白名单文本 fallback，不能叠加、换账户或重置期限。终止失败后按
session/provider/model 暂缓新接管压缩请求 60 秒，不暂停普通生成。Native→文本 fallback
是本插件配对策略，不是 Codex 官方行为声明。

一次获准的真实验收使用 300000ms 预算，耗时 157372ms，一次请求、合法 item + completed，
官方 Basic 产生新历史替换，约 146849 tokens 被 shadowed。维护者从磁盘 journal 读回
summary/user-message/end 与 command/done success。这是该次运行的证据，不证明 fsync、
崩溃恢复、无损回忆或全部超时根治。维护者已复验冻结生产候选，498 项（plugin 135 + legacy-A 46 +
comparison 34 + account 266 + paired 17）全绿；最终打包检查与发布 tag 换装仍是独立步骤。详见[证据与历史阶段](docs/research/codex-runtime-v1.md)。

**已知非阻断限制：**取消可能在压缩状态中误显示 `CODEX_RUNTIME_ERROR`。刷新可能取消等待中的
手动命令，尚无证据证明仅切 tab 就取消。持续上游故障与上下文硬限制仍可能导致失败。

## 安装（tag 存在后）

```sh
npx --yes --ignore-scripts github:shaomingbo/dsh-token-usage#v5.1.4
```

默认安装到 `web` profile。安装后由你手动重启 DSH，并强制刷新现有 Web GUI；安装器绝不控制 DSH 进程。

```sh
npx --yes --ignore-scripts github:shaomingbo/dsh-token-usage#v5.1.4 status
npx --yes --ignore-scripts github:shaomingbo/dsh-token-usage#v5.1.4 uninstall
npx --yes --ignore-scripts github:shaomingbo/dsh-token-usage#v5.1.4 --profile web --source link:<local-path>
npx --yes --ignore-scripts github:shaomingbo/dsh-token-usage#v5.1.4 --help
```

`--profile` 默认是 `web`；`--source` 默认固定到随包版本派生的 `v5.1.4` tag，也可用 `DSH_TOKEN_USAGE_SOURCE` 覆盖。安装器要求 PATH 上存在 `dsh` `0.1.2-rc.1` 或 `0.1.2-alpha.3`，所有变更都委托给公开 `dsh plugin` CLI 并带 `--ignore-scripts`；它核验 manifest 后置条件并如实报告失败——rc.1 不承诺回滚。`dsh` 缺失、版本不符或 plugin 命令失败时，安装器带指引地失败关闭；没有直接改 manifest 的兜底路径。

### 本地开发

```sh
node bin/install.js --source link:$PWD
```

只接受该安装器自身版本的固定 tag 或显式 `link:<local-path>`；其他版本 tag 与浮动源均被拒绝。本地源码变更需完成适用构建并由用户重启/刷新；仅建立 link 不保证热更新。

## 账户生命周期（v5）

整个交互是一条动线：侧栏入口 → dock → 总览 → 每账户洞察。

- **零配置账户：** 每个已配置连接（ChatGPT/Codex、Grok、每个 Antigravity 账号、GLM、Ollama Local/Cloud）出现时即自动成为一条 `account_products` 记录并带默认归因规则。Antigravity 代理把配额故障转移后的最终连接写入带版本的 OpenAI 响应标识；账本从原装 DSH 已有的 pi-ai replay 元数据恢复它，不需要修改 DSH 源码。已归档的自动账户不会被重建。
- **官方优先的表盘：** CodexBar 式的窗口百分比条（主窗口 5h、周窗口、每日、订阅期）带重置倒计时、来源徽标（官方接口 / 官方页面（脆弱）/ 本地账本 / 用户估计）与观察时间。本地账本绝不把官方百分比换算成 token 猜测；积分/百分比额度只来自官方观察。
- **简单配置：** host 侧产品模板目录（`lib/accounts/templates.json`，启动时 seed 进 `provider_templates`）预填窗口、精确值（GLM 套餐积分、阿里云请求上限、Gemini 每日请求数）和 provider 别名；向导根据账本实测流量给建账户建议；高级表单仍支持自定义额度、价格、余额与规则。
- **诚实的本地半边：** 每个账户的 DSH 观察用量（等值 $、新计算 token、请求数、模型表、30 天趋势），外推明确标注为算术平均速率而非预测。
- **弃用：** v5 计费池表单从 UI 退役。`plans`/`plan_rules` 仍可读并经无损投影继续生效；`save-plan` RPC 保留但返回 `deprecated`。

### 未发布候选说明（P1-B / P1-C + 治理第二轮）

> 以下治理增量与 Antigravity 热修复、后续 OAuth 修复一起纳入 **未发布的5.1.4准备候选**；它们 **不属于** 已发布的 `v5.1.3` tag（`dddb7f2b`）。上方命令面向未来5.1.4 tag，不代表已核验的发布。原生运行时代码与预算保持不变，版本元数据和文档另作更新。`ACCOUNT-R2-REPORT.md`、`ACCOUNT-R3-REPORT.md` 仅保留历史工作树证据（不随包分发），不能单独证明最新 OAuth 或发布门禁。

### 生命周期所有权（P1-B）

账户授权状态、provider/模型能力和 `codex-runtime/v1` 原生能力由账户生命周期拥有；分析统计的用量存储是同一包内独立的生命周期域。分析统计的挂载、失败、停止与清理不会注销能力、不会取消在途原生运行、也不会改写账户数据；只有本 bundle 的 Host dispose 才按固定顺序同时结束两个域（先取消原生租约、再关闭用量存储、最后释放能力所有者）。统计降级时账户事实仍可见：`/account-usage` 的 `connections` 端点严格只读——仅本地连接状态、缓存的模型目录、adapter 与代理状态——不触碰用量存储、不创建账户、不触发额度网络刷新。`summary` 保留其 overlay 职责（零配置账户引导与观察节奏锚点）。对外提供的 `accountUsage` 服务只暴露 `list`/`observe`/`observations`；任何 RPC 或服务方法都不能停止任一生命周期，卸载统计 UI 也不结束任一生命周期。工作区证据见仓库根目录 `ACCOUNT-R2-REPORT.md`（不随包发布）。

### 「账户与模型」原生设置入口（P1-C，未发布候选）

通过原生 `settings.section` slot 新增「账户与模型」设置入口，把提供方连接带到分析 overlay 之外。它唯一的自动数据源是只读 `connections` RPC：本地连接事实、缓存模型目录与代理状态——不加载统计通道、不挂载 Dashboard、不会自行触发额度刷新/模型同步/登录；刷新连接事实是显式操作。展开某个连接会打开与洞察页相同的 `ConnectionSection` 控件，但在事实模式下运行（C-001 修复）：展开面板读取并重载与列表相同的只读 `connections` 载荷，因此展开、切换、刷新某个连接——以及每次显式登录、凭据保存、模型同步动作——都不会调用分析 `summary`、不创建账户、不启动观察轮，且统计库损坏时管理控件仍然完全可用。不另造第二套 OAuth、key 或模型同步实现；洞察页保留其基于 summary 的旧策略。连接以稳定的 `providerId` + `connectionId` 区分；已存储的 API key 或额度 Cookie 显示为「已配置 · 官方无校验」（AC-001），绝不显示为已验证连接。关闭页面或切换视图会停止本地设备授权等待，但不会取消宿主侧授权；显式「取消登录」按钮仍是唯一取消路径，重新打开时经非破坏性的 pending-login 查询重挂。证据见仓库根目录 `ACCOUNT-R2-REPORT.md`（不随包发布）。

### 治理第三轮整合 + Antigravity 额度热修复（未发布候选）

本工作树把上一节的治理第二轮候选整合到 Antigravity 额度读取热修复（提交 `44125a55`：`lib/capabilities/antigravity/antigravity-api.js` 与 `lib/capabilities/antigravity/usage.js` 的额度/目录读取改为应答 daily→prod→sandbox 面，并新增 `test/antigravity-quota.test.js`；生成与项目发现不变）之上。第二轮候选与该热修复均不属于已发布的 `v5.1.3` tag。整合证据与 5.1.3 保全核验见仓库根目录 `ACCOUNT-R3-REPORT.md`（不随包发布）。

## 产品模型

规范词汇见 [`CONTEXT.md`](CONTEXT.md)：Connection、Credential、Product、Billing、Limit、Observation、Usage Ledger、Attribution Rule。

- **提供方连接：** ChatGPT/Grok OAuth 保留 `<DSH_HOME>/.oauth.json`；Antigravity 保留 `<DSH_HOME>/.antigravity-auth.json`、多账号切换、自动故障转移、模型路由和本地代理语义。UI 可发起 OAuth/设备授权、激活或移除 Antigravity 账号，并通过 DSH Credentials 导入 GLM/Ollama API 凭据。GLM、Ollama Local、Ollama Cloud 走同一个内部 ProviderAdapter seam。
- **官方观察：** 提供方声明的产品、计费、额度百分比与重置时间，和本地账本严格分开展示。额度支持 exact/range/dynamic/unpublished/manual，以及 rolling/fixed/billing/rate 窗口。每个连接的官方观察历史默认只保留最近 1,000 条（约数天），最新一条有效观察始终保留——无窗口的可达性探测永远不会把它挤掉；账户页的观察列表只展示最近 200 条。
- **本地用量账本：** 现有 `usage.sqlite`、请求折叠、项目归因、估值、导入、修正、导出、备份和保留策略全部保留。请求事实保留可选的提供方连接来源；精确连接规则优先于提供方／模型回退，未盖章的历史记录保持未归属，除非显式回退规则命中。它是 DSH 可观察账本，不是提供方账单。
- **兼容性：** 新统一通道为仅回环的 `/account-usage`。4.x 过渡期保留 `/token-usage`、`/subscription-antigravity`。若同时安装 `dsh-subscription-search`，`/subscription-search` 由它独占；本包只通过 `searchChain` 注册 ChatGPT/Grok 可调用后端，避免双重所有权。
- **可选搜索能力：** 主机提供 `searchChain` 时，可注册不泄露令牌的 ChatGPT/Grok 可调用后端；本包不包含搜索编排。

## Ollama 行为

Ollama Local 的远端额度为“不适用”。保存 Ollama Cloud API Key 后，插件会同步官方 `/api/tags` 目录，通过 `/api/show` 补全每个 completion 模型，并把 `ollama-cloud` 路由注册到官方 OpenAI-compatible 入口 `https://ollama.com/v1`。上下文容量、视觉输入和 thinking 档位均来自官方模型详情；只有详情明确给出 `num_predict` 时才写入输出上限。账户卡提供手动同步按钮，模型增删可在不重启 DSH 的情况下刷新。由于没有专用的官方额度端点，已配置 Key 的状态仍明确标为“未验证”。设置页额度抓取是独立显式开关：用户手工粘贴 Cookie Header；只把白名单内的 Ollama 会话 cookie 写入 owner-only 存储。本插件绝不读取 Chrome 或其他浏览器目录；携带凭据的重定向会被拒绝；解析出的套餐、会话/小时、周百分比及重置时间标记为 `official_ui`、`brittle`。

Ollama Cloud 当前的 Chat Completions 用量没有可靠提供缓存命中 Token。插件默认使用可调的 **95% 缓存命中场景**重估 `ollama-cloud` 的当前公开标价等值；它不修改输入/缓存账本事实，并同时显示按已报告类别计算的“未计缓存上限”。该场景不应用于 Ollama Local 或其他提供方。缓存字段一旦被 DSH 明确标记为已报告（包括显式 0），真实值即优先；旧数据因历史接口丢失字段存在性而标记为 `unknown`。这个数字仍是估算，不是 Ollama 账单或实际扣款。

## 隐私与请求

秘密只存在于 owner-only 文件或 DSH credentials 中。SQLite、RPC 返回、日志、诊断和导出都不得包含 access/refresh token、API key、Authorization、Cookie Header 或会话 cookie 值。RPC 仅允许 loopback。普通账本运行不联网；价格更新和提供方观察刷新必须显式触发。认证刷新和已配置模型路由只在必要时访问对应提供方。所有提供方来源都使用 origin 白名单，并拒绝可能泄漏凭据的跨域重定向。

提示词、回复、请求体、工具参数都不会被本插件持久化。普通导出默认匿名化；完整备份应视为私密文件；卸载保留数据。

## 数据与迁移

原路径不变：`<DSH_HOME>/profiles/<profile>/data/dsh-token-usage/`。link 开发仍回退到 `<DSH_HOME>/dsh-token-usage/`。schema v8 增量记录可空的请求 `connection_id` 来源且不回填历史；schema v9 增量记录缓存字段的 `reported` / `absent` / `unknown` 状态，不重写 Token。原账本、`plans`、`plan_rules` 和 v5 套餐无损映射均保留。迁移前自动备份并在事务内执行。遇到更新 schema 时普通写入会拒绝，另有只读诊断 seam。

## 开发检查

```sh
pnpm install --frozen-lockfile --ignore-scripts
npm run check
npm pack --dry-run --ignore-scripts
```

`npm run bench:v2` 是仅开发用的分析基准，不随包发布。

测试只使用合成数据和临时 `DSH_HOME`。原生能力的测试组合以原装 DSH `0.1.2-rc.1`、Node 24.18.0/macOS arm64 为目标，尚未在更低 Node 版本重跑。安装器保留既有 `0.1.2-alpha.3` 与 `0.1.2-rc.1` 两个 CLI 版本支持，拒绝其他版本；最终候选将在二者临时 home 运行安装/`--dump-config` 验证。真实验收现场启动器为 alpha.3，实际 Web/Basic 依赖为 rc.1，不能将此混合现场当作纯 alpha.3 完整原生运行兼容证据。配套压缩包仅公开支持 rc.1，不扩大范围。

## Codex 原生能力（5.1.2）

本版本保留 5.1.0 引入的账户所有者绑定 `codex-runtime/v1` 能力，并加入恢复修正，供配套的
`dsh-codex-compaction` 0.3.1 调用：经既有 ChatGPT 连接做原生压缩/重放，
OAuth 值始终留在账户所有者内部，不另造登录或凭据存储。自定义模型（如
`gpt-6-astra`）只经可信 model-facts 接缝从公开的宿主配置 profile 字段解析；
缺失或冲突的 metadata 以固定词表缺口报告，绝不编造数值。不能认为已发布的
5.0.24 已含此能力；固定 tag 仅在维护者实际推送并核验后才成立，历史 RC tag
（`5.1.0-rc.1`、`5.1.0-rc.2`）保留。

若本 checkout 的 `node_modules` 链接 live profile，不要在这里安装依赖。请在配套
压缩项目运行 `npm run test:accounts-integration -- <isolated-account-source>`，它会创建临时源码/依赖副本验证，
不碰现网。详见[能力契约与隔离验证说明](docs/research/codex-runtime-v1.md)。

## 许可证

[MIT](LICENSE)
