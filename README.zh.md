# DSH Accounts & Usage

`dsh-token-usage` 4.0.1 保留原包名和本地用量账本，并新增统一的提供方账号连接与官方用量观察。无遥测、不保存提示词、不修改 DSH 源码。

## 安装

```sh
npx --yes github:shaomingbo/dsh-token-usage#v4.0.1
```

默认安装到 `web` profile。安装后由你手动重启 DSH，并强制刷新现有 Web GUI；安装器绝不控制 DSH 进程。

```sh
npx --yes github:shaomingbo/dsh-token-usage#v4.0.1 status
npx --yes github:shaomingbo/dsh-token-usage#v4.0.1 uninstall
npx --yes github:shaomingbo/dsh-token-usage#v4.0.1 --profile web --source github:shaomingbo/dsh-token-usage#v4.0.1
npx --yes github:shaomingbo/dsh-token-usage#v4.0.1 --help
```

`--profile` 默认是 `web`；`--source` 默认固定到 `v4.0.1` tag，也可用 `DSH_TOKEN_USAGE_SOURCE` 覆盖。

### 本地开发

```sh
npx --yes github:shaomingbo/dsh-token-usage#v4.0.1 --source link:$PWD
```

安装器只原子修改 `dependencies["dsh-token-usage"]` 和 `dsh.profile.bundles`，执行 `pnpm install --ignore-scripts`（含 corepack 回退），失败时恢复 manifest。手工修改同样两个字段仅作为兜底。

## 产品模型

规范词汇见 [`CONTEXT.md`](CONTEXT.md)：Connection、Credential、Product、Billing、Limit、Observation、Usage Ledger、Attribution Rule。

- **提供方连接：** ChatGPT/Grok OAuth 保留 `<DSH_HOME>/.oauth.json`；Antigravity 保留 `<DSH_HOME>/.antigravity-auth.json`、多账号切换、自动故障转移、模型路由和本地代理语义。UI 可发起 OAuth/设备授权、激活或移除 Antigravity 账号，并通过 DSH Credentials 导入 GLM/Ollama API 凭据。GLM、Ollama Local、Ollama Cloud 走同一个内部 ProviderAdapter seam。
- **官方观察：** 提供方声明的产品、计费、额度百分比与重置时间，和本地账本严格分开展示。额度支持 exact/range/dynamic/unpublished/manual，以及 rolling/fixed/billing/rate 窗口。
- **本地用量账本：** 现有 `usage.sqlite`、请求折叠、项目归因、估值、导入、修正、导出、备份和保留策略全部保留。它是 DSH 可观察账本，不是提供方账单。
- **兼容性：** 新统一通道为仅回环的 `/account-usage`。4.x 过渡期保留 `/token-usage`、`/subscription-antigravity`。若同时安装 `dsh-subscription-search`，`/subscription-search` 由它独占；本包只通过 `searchChain` 注册 ChatGPT/Grok 可调用后端，避免双重所有权。
- **可选搜索能力：** 主机提供 `searchChain` 时，可注册不泄露令牌的 ChatGPT/Grok 可调用后端；本包不包含搜索编排。

## Ollama 行为

Ollama Local 的远端额度为“不适用”。Ollama Cloud API Key 有官方 Bearer 模型访问语义，但没有专用的官方额度或校验端点，因此已配置 Key 的状态明确标为“未验证”。设置页额度抓取是独立显式开关：用户手工粘贴 Cookie Header；只把白名单内的 Ollama 会话 cookie 写入 owner-only 存储。本插件绝不读取 Chrome 或其他浏览器目录；携带凭据的重定向会被拒绝；解析出的套餐、会话/小时、周百分比及重置时间标记为 `official_ui`、`brittle`。

## 隐私与请求

秘密只存在于 owner-only 文件或 DSH credentials 中。SQLite、RPC 返回、日志、诊断和导出都不得包含 access/refresh token、API key、Authorization、Cookie Header 或会话 cookie 值。RPC 仅允许 loopback。普通账本运行不联网；价格更新和提供方观察刷新必须显式触发。认证刷新和已配置模型路由只在必要时访问对应提供方。所有提供方来源都使用 origin 白名单，并拒绝可能泄漏凭据的跨域重定向。

提示词、回复、请求体、工具参数都不会被本插件持久化。普通导出默认匿名化；完整备份应视为私密文件；卸载保留数据。

## 数据与迁移

原路径不变：`<DSH_HOME>/profiles/<profile>/data/dsh-token-usage/`。link 开发仍回退到 `<DSH_HOME>/dsh-token-usage/`。schema v6 为纯增量：保留原账本、`plans`、`plan_rules`；v5 套餐和两个窗口无损映射为 manual estimate。迁移前自动备份并在事务内执行。遇到更新 schema 时普通写入会拒绝，另有只读诊断 seam。

## 开发检查

```sh
pnpm install
npm run check
npm pack --dry-run
```

测试只使用合成数据和临时 `DSH_HOME`。当前能力针对 DSH 0.1.1-rc.2 与 Node 22.19+ 验证，不宣称更广兼容性。

## 许可证

[MIT](LICENSE)
