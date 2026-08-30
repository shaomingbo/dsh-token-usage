# dsh-token-usage

[DeepSeek Harness](https://github.com/shaomingbo/deepseek-harness) 的本地 Token 用量与费用分析插件：以个人资料式仪表盘展示 harness 处理了什么 —— Token、请求、项目、会话、模型、提供方与估算费用。无遥测。不存提示词。不 patch DSH。

## 安装

```sh
npx --yes github:shaomingbo/dsh-token-usage#v3.0.0
```

这一条命令会把 bundle 安装到 `web` profile。之后请**手动重启 DSH 并强制刷新 Web GUI** —— 安装器绝不会停止或触碰运行中的 DSH 进程。

其他命令：

```sh
npx --yes github:shaomingbo/dsh-token-usage#v3.0.0 status
npx --yes github:shaomingbo/dsh-token-usage#v3.0.0 uninstall
npx --yes github:shaomingbo/dsh-token-usage#v3.0.0 --profile web --source github:shaomingbo/dsh-token-usage#v0.1.0
npx --yes github:shaomingbo/dsh-token-usage#v3.0.0 --help
```

- `--profile <name>` — 目标 DSH profile（默认 `web`）
- `--source <source>` — 包来源；默认固定在 `v3.0.0` tag（绝不使用浮动分支）
- `DSH_TOKEN_USAGE_SOURCE` — 通过环境变量覆盖来源

### 本地开发

```sh
dsh-token-usage --source link:/绝对路径/dsh-token-usage
# 或
npx --yes github:shaomingbo/dsh-token-usage#v3.0.0 --source link:$PWD
```

### 手动兜底

安装器只修改 `profiles/<name>/package.json` 的两个位置 —— `dependencies["dsh-token-usage"]` 与 `dsh.profile.bundles` —— 然后在 profile 目录运行 `pnpm install --ignore-scripts`。你也可以手动完成这两处修改；写入是原子的，依赖安装失败时自动回滚。

## 功能

- **三层客观界面** —— 左侧栏微览（最紧计费池 + 月进度）、右侧停靠面板、全屏仪表盘。等值 $ / 新计算 Token / 请求三口径切换不改数据；30 天活动图可按池或按模型堆叠；模型跨池排行。没有教练文案 —— 只有数字和标明的算术外推。
- **计费池** —— 你配置订阅（额度、重置日、月费）和预付/中转余额（余额、到期日）。归因规则按 provider/模型通配匹配；未匹配进入「未归属」桶。规则变更不改写请求历史。
- **数据与设置角落** —— 池/规则编辑器、定价别名/覆盖/LiteLLM 刷新、导入导出备份清理、显示设置。v2 四空间工作台、详情栈、预算 UI、保存视图已移除（账本表保留）。
- **自动历史导入** —— 插件安装前的会话在后台以只读方式导入（可暂停、取消、续传）。错过的实时事件会从持久日志补齐。
- **正确的计数** —— 每个 session/turn/step 只算一次可观测调用；同一调用的后到 usage 样本整体替换而非累加；fork 继承的种子前缀绝不重复计费；子代理用量只在其自身会话计一次，并沿谱系上卷；compaction 不产生计费；reasoning token 始终是 output 的标注子集。
- **诚实的费用** —— 估算使用内置版本化快照，并支持用户显式从 LiteLLM 更新。更新前先预览数据源与已观测模型的匹配结果；插件不会后台联网。provider 兼容且唯一的候选自动匹配；跨 provider 候选必须在「已观测模型 → 价格目录模型」下拉框中明确选择。仍支持自定义价格与提供方倍率。原始计价不可变；当前规则重算立即生效。未知价格不计入并显示覆盖率，绝不猜测。
- **上报与估算分离** —— provider 上报的用量与内存估算在每一层都分开；失败请求计入请求数但绝不虚构 Token 或费用。
- **数据留在本机** —— profile 私有的 SQLite 账本（内置 `node:sqlite`，无原生依赖）。CSV/JSON 导出继承当前筛选，并默认匿名化路径与会话 ID；完整备份是单独的、带隐私警告的操作。清理请求明细时保留匿名日级合计。卸载插件保留账本。
- **零 patch** —— 仅通过 Harness 文档化的扩展点组合（bundle 行、slots、loopback RPC、只读持久化 API）。

## 隐私

无遥测。默认无网络请求。提示词、回答、工具参数与凭据绝不写入账本、日志或导出。估算仅在 host 内存中临时读取消息内容。今日摘要、CNY 显示汇率、头像（仅本地图片）与价格数据全部留在本地。

## 数据位置

`<DSH_HOME>/profiles/<profile>/data/dsh-token-usage/` —— `usage.sqlite`（账本）与 `settings.json`（显示偏好）。本地 `link:` 开发安装回退到 `<DSH_HOME>/dsh-token-usage/`。`uninstall` 不会删除该目录；如需彻底清除请手动删除。

## 限制

- 用量是 Harness 可观测的账目，不是上游账单：从未进入会话日志的 provider 内部重试不可观测，也不会被猜测。
- 估算 seam 已在账本层实现并有测试，但 v0.1 尚未在 host 侧接上 Harness token meter，因此缺失 usage 的步骤保持「未知」而非估算。
- 已在 DSH 0.1.1-rc.2 验证，启动时做能力检查；不支持的运行时会得到明确诊断而非静默错算。
- 告警自动化、账单/额度对账、agent/skill/tool 归因、跨 profile 聚合、云同步和自动汇率仍不在范围内。v2 工作台方案见 [V2-PLAN.md](V2-PLAN.md)。

## 开发

```sh
pnpm install          # 或 npm install
npm run check         # 语法 + 完整测试（node --test）
npm run bench:v2      # 10 万请求 / 1 万会话分析基准
npm pack --dry-run    # 校验发布产物
```

测试落在 ledger seam：合成会话 fixture（绝不使用真实日志）、假 cordis 上下文下的 host 插件装配、临时 `DSH_HOME` 安装器生命周期、迁移与回滚、导出匿名化，以及 client bundle 的 module-loader 契约。

## 许可证

[MIT](LICENSE)
