# DSH Accounts & Usage

`dsh-token-usage` 5.x 保留原包名和本地用量账本，并新增统一的提供方账号连接与官方用量观察。无遥测、不保存提示词、不修改 DSH 源码。`5.1.0-rc.2` 发布候选新增由账户所有者绑定的 `codex-runtime/v1` 能力（见下文）；在固定 tag 实际推送并核验之前，它不是已发布产物。

## 安装

```sh
npx --yes github:shaomingbo/dsh-token-usage#v5.1.0-rc.2
```

默认安装到 `web` profile。**固定 tag 是发布候选；不假定其已发布。** 安装后由你手动重启 DSH，并强制刷新现有 Web GUI；安装器绝不控制 DSH 进程。

```sh
npx --yes github:shaomingbo/dsh-token-usage#v5.1.0-rc.2 status
npx --yes github:shaomingbo/dsh-token-usage#v5.1.0-rc.2 uninstall
npx --yes github:shaomingbo/dsh-token-usage#v5.1.0-rc.2 --profile web --source github:shaomingbo/dsh-token-usage#v5.1.0-rc.2
npx --yes github:shaomingbo/dsh-token-usage#v5.1.0-rc.2 --help
```

`--profile` 默认是 `web`；`--source` 默认固定到随包版本派生的 `v5.1.0-rc.2` tag，也可用 `DSH_TOKEN_USAGE_SOURCE` 覆盖。安装器要求 PATH 上存在精确的 `dsh` `0.1.2-rc.1`，所有变更都委托给公开 `dsh plugin` CLI 并带 `--ignore-scripts`；它核验 manifest 后置条件并如实报告失败——rc.1 不承诺回滚。`dsh` 缺失、版本不符或 plugin 命令失败时，安装器带指引地失败关闭；没有直接改 manifest 的兜底路径。

### 本地开发

```sh
node bin/install.js --source link:$PWD
```

只接受固定候选源或显式 `link:<本地路径>`；浮动源会被拒绝。

## 账户生命周期（v5）

整个交互是一条动线：侧栏入口 → dock → 总览 → 每账户洞察。

- **零配置账户：** 每个已配置连接（ChatGPT/Codex、Grok、每个 Antigravity 账号、GLM、Ollama Local/Cloud）出现时即自动成为一条 `account_products` 记录并带默认归因规则。Antigravity 代理把配额故障转移后的最终连接写入带版本的 OpenAI 响应标识；账本从原装 DSH 已有的 pi-ai replay 元数据恢复它，不需要修改 DSH 源码。已归档的自动账户不会被重建。
- **官方优先的表盘：** CodexBar 式的窗口百分比条（主窗口 5h、周窗口、每日、订阅期）带重置倒计时、来源徽标（官方接口 / 官方页面（脆弱）/ 本地账本 / 用户估计）与观察时间。本地账本绝不把官方百分比换算成 token 猜测；积分/百分比额度只来自官方观察。
- **简单配置：** host 侧产品模板目录（`lib/accounts/templates.json`，启动时 seed 进 `provider_templates`）预填窗口、精确值（GLM 套餐积分、阿里云请求上限、Gemini 每日请求数）和 provider 别名；向导根据账本实测流量给建账户建议；高级表单仍支持自定义额度、价格、余额与规则。
- **诚实的本地半边：** 每个账户的 DSH 观察用量（等值 $、新计算 token、请求数、模型表、30 天趋势），外推明确标注为算术平均速率而非预测。
- **弃用：** v5 计费池表单从 UI 退役。`plans`/`plan_rules` 仍可读并经无损投影继续生效；`save-plan` RPC 保留但返回 `deprecated`。

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

测试只使用合成数据和临时 `DSH_HOME`。本发布候选实际验证环境为原装 DSH `0.1.2-rc.1`、Node 24.18.0/macOS arm64；新原生能力尚未在更低 Node 版本重跑；安装器拒绝其他 `dsh` CLI 版本。旧版本的兼容结论不沿用到本包，也不宣称更广兼容性。

## Codex 原生能力（5.1.0-rc.2 发布候选）

本版本提供由账户所有者绑定的 `codex-runtime/v1` 能力，供配套的
`dsh-codex-compaction` 0.3.0-rc.1 候选调用：经既有 ChatGPT 连接做原生压缩/重放，
OAuth 值始终留在账户所有者内部，不另造登录或凭据存储。自定义模型（如
`gpt-6-astra`）只经可信 model-facts 接缝从公开的宿主配置 profile 字段解析；
缺失或冲突的 metadata 以固定词表缺口报告，绝不编造数值。**两个 RC 候选均非
稳定版**——不能认为已发布的 5.0.24 已含此能力，固定 tag 仅在实际推送并核验后才成立。

若本 checkout 的 `node_modules` 链接 live profile，不要在这里安装依赖。请在配套
压缩项目运行 `npm run test:accounts-integration -- <isolated-account-source>`，它会创建临时源码/依赖副本验证，
不碰现网。详见[能力契约与隔离验证说明](docs/research/codex-runtime-v1.md)。

## 许可证

[MIT](LICENSE)
