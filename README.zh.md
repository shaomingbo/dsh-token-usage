# dsh-token-usage

[DeepSeek Harness](https://github.com/shaomingbo/deepseek-harness) 的本地 Token 用量与费用分析插件：以个人资料式仪表盘展示 harness 处理了什么 —— Token、请求、项目、会话、模型、提供方与估算费用。无遥测。不存提示词。不 patch DSH。

## 安装

```sh
npx --yes github:shaomingbo/dsh-token-usage#v0.1.0
```

这一条命令会把 bundle 安装到 `web` profile。之后请**手动重启 DSH 并强制刷新 Web GUI** —— 安装器绝不会停止或触碰运行中的 DSH 进程。

其他命令：

```sh
npx --yes github:shaomingbo/dsh-token-usage#v0.1.0 status
npx --yes github:shaomingbo/dsh-token-usage#v0.1.0 uninstall
npx --yes github:shaomingbo/dsh-token-usage#v0.1.0 --profile web --source github:shaomingbo/dsh-token-usage#v0.1.0
npx --yes github:shaomingbo/dsh-token-usage#v0.1.0 --help
```

- `--profile <name>` — 目标 DSH profile（默认 `web`）
- `--source <source>` — 包来源；默认固定在 `v0.1.0` tag（绝不使用浮动分支）
- `DSH_TOKEN_USAGE_SOURCE` — 通过环境变量覆盖来源

### 本地开发

```sh
dsh-token-usage --source link:/绝对路径/dsh-token-usage
# 或
npx --yes github:shaomingbo/dsh-token-usage#v0.1.0 --source link:$PWD
```

### 手动兜底

安装器只修改 `profiles/<name>/package.json` 的两个位置 —— `dependencies["dsh-token-usage"]` 与 `dsh.profile.bundles` —— 然后在 profile 目录运行 `pnpm install --ignore-scripts`。你也可以手动完成这两处修改；写入是原子的，依赖安装失败时自动回滚。

## 功能

- **侧栏用量入口**（可选今日摘要），点击打开全屏仪表盘：概览、请求、会话、模型、提供方、定价、数据、设置。跟随 Harness 主题与中英文语言。
- **自动历史导入** —— 插件安装前的会话在后台以只读方式导入（可暂停、取消、续传）。错过的实时事件会从持久日志补齐。
- **正确的计数** —— 每个 session/turn/step 只算一次可观测调用；同一调用的后到 usage 样本整体替换而非累加；fork 继承的种子前缀绝不重复计费；子代理用量只在其自身会话计一次，并沿谱系上卷；compaction 不产生计费；reasoning token 始终是 output 的标注子集。
- **诚实的费用** —— 估算使用内置的版本化价格快照（源自 LiteLLM），叠加你的别名、自定义价格与提供方倍率。原始计价不可变；修改规则后另有「当前规则重算」。未知价格不计入并显示覆盖率，绝不猜测。
- **上报与估算分离** —— provider 上报的用量与内存估算在每一层都分开；失败请求计入请求数但绝不虚构 Token 或费用。
- **数据留在本机** —— profile 私有的 SQLite 账本（内置 `node:sqlite`，无原生依赖）。CSV/JSON 导出默认匿名化路径与会话 ID；完整备份是单独的、带隐私警告的操作。清理请求明细时保留匿名日级合计。卸载插件保留账本。
- **零 patch** —— 仅通过 Harness 文档化的扩展点组合（bundle 行、slots、loopback RPC、只读持久化 API）。

## 隐私

无遥测。默认无网络请求。提示词、回答、工具参数与凭据绝不写入账本、日志或导出。估算仅在 host 内存中临时读取消息内容。今日摘要、CNY 显示汇率、头像（仅本地图片）与价格数据全部留在本地。

## 数据位置

`<DSH_HOME>/profiles/<profile>/data/dsh-token-usage/` —— `usage.sqlite`（账本）与 `settings.json`（显示偏好）。本地 `link:` 开发安装回退到 `<DSH_HOME>/dsh-token-usage/`。`uninstall` 不会删除该目录；如需彻底清除请手动删除。

## 限制

- 用量是 Harness 可观测的账目，不是上游账单：从未进入会话日志的 provider 内部重试不可观测，也不会被猜测。
- 估算 seam 已在账本层实现并有测试，但 v0.1 尚未在 host 侧接上 Harness token meter，因此缺失 usage 的步骤保持「未知」而非估算。
- 已在 DSH 0.1.1-rc.2 验证，启动时做能力检查；不支持的运行时会得到明确诊断而非静默错算。
- 预算/告警、agent/skill 归因、非 DSH CLI 导入、云同步、自动汇率不在 v0.1 范围内。见 [SPEC.md](SPEC.md)。

## 开发

```sh
pnpm install          # 或 npm install
npm run check         # 语法 + 完整测试（node --test）
npm pack --dry-run    # 校验发布产物
```

测试落在 ledger seam：合成会话 fixture（绝不使用真实日志）、假 cordis 上下文下的 host 插件装配、临时 `DSH_HOME` 安装器生命周期、迁移与回滚、导出匿名化，以及 client bundle 的 module-loader 契约。

## 许可证

[MIT](LICENSE)
