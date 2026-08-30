# Coding Plan 与预付费平台用量模型调研

> 调研日期：2026-09-02  
> 范围：OpenAI Codex、Claude Code、Gemini Code Assist / Gemini CLI、xAI Grok Build、智谱 GLM Coding Plan、Kimi Code、MiniMax Token Plan、小米 MiMo Token Plan，以及 OpenRouter、SiliconFlow、302.AI、AIHubMix 等中转/预付费平台。  
> 方法：仅采用厂商官方文档、官方帮助中心和官方 API 文档。套餐价格、额度和政策会变化；本报告侧重稳定的**计费结构与窗口语义**，不建议把当前数字固化为产品默认值。

## 1. 核心结论

当前设计中的 `kind + quota + reset_day` 无法覆盖市场实际情况。主要原因：

1. **付款周期不等于额度窗口。** 月费只是付款周期；Codex、Claude、GLM、MiniMax 等实际限制通常是 5 小时 + 周限。
2. **一个产品可能同时有多个 AND 关系的限制。** 达到任意一个限制都会被阻断，例如 5 小时额度、周额度、模型专属周额度。
3. **额度单位不统一。** 可能是请求数、消息范围、计划积分、Token、按 API 标价折算的金额、账户余额、RPM/TPM/RPD。
4. **很多消费订阅不公布精确上限。** OpenAI、Claude、Kimi、MiniMax 的部分限制只给范围、倍数或控制台进度条；强迫用户填一个“准确 Token 限额”会制造伪精确。
5. **订阅身份和 API 身份通常相互独立。** 同一 CLI 切换 OAuth / subscription key / API key 后，用的是完全不同的池。
6. **本地 DSH 账本只观察到 DSH 内的请求。** Claude Chat、ChatGPT Web、其他 IDE、手机端等共享消耗无法由本插件推断；除非存在官方剩余额度接口，否则不能把 DSH 用量当作官方剩余百分比。
7. **中转平台通常不是订阅。** 它们主要是预付余额 + 按量扣费 + 可选自动充值，可能有到期，也可能永久有效。

因此，产品应从“计费池”升级为以下四层：

```text
计费产品 Product
├── 付款 Billing（按月 / 按年 / 预付 / 月结）
├── 限制 Pools[]（0..n 个，同时生效）
│   ├── 窗口语义（滚动 5h / 固定周 / 每日 / 月账期 / 整个订阅期）
│   ├── 单位（请求 / Token / 积分 / USD / 百分比）
│   └── 上限可信度（精确 / 范围 / 动态 / 未公布）
├── 超额 Overage（停止 / 钱包 / API 回退 / 团队按量）
└── 观测 Observation（本地账本 / 官方 UI / CLI / 官方 API）
```

### 市场结构总览

| 产品 | 付款 | 同时生效的限制 | 超额 | 官方剩余量 |
|---|---|---|---|---|
| OpenAI Codex | ChatGPT 月订阅 | 5h + weekly；数字多为范围/动态 | ChatGPT credits 或 API Key | Dashboard / CLI，无 public consumer API |
| Claude Code | 月/年订阅 | 5h + weekly all + 可选模型周限 | usage credits / Console API | Settings / CLI，无 public consumer API |
| Gemini Code Assist | Cloud license | daily requests + per-minute/RPS | API/Vertex PAYG 回退 | Cloud Quotas |
| xAI Grok Build | 预付/API 月结 | RPS + TPM + spend tier | 预付自动充值/月结 | 响应 cost + Console/API |
| GLM Coding Plan | 月订阅 | 精确 5h credits + weekly credits | 个人硬停；团队可 PAYG | Console，无 public remains API |
| Kimi Code | 会员月/年 | 月度共享池 + Code 5h + weekly | Extra Usage 钱包 | Console / CLI |
| MiniMax Token Plan | 月订阅 | 5h + weekly，数字动态 | Credits 包 / PAYG Key | 官方 remains API + Console |
| MiMo Token Plan | 月/年订阅 | 整个 term 的 credits 总池 | 无；切 PAYG Key | Console |
| GitHub Copilot | 月/年订阅 | calendar-month AI credits / premium usage | usage budget | Billing / reports / API |
| Cursor | 月订阅 | 两个月度模型池 | on-demand PAYG | Dashboard |
| 阿里云 Coding Plan | 月订阅 | 5h + weekly + monthly 三重 requests | 硬停 | Console |
| Kiro | 月订阅 | monthly credits | add-on credits | Dashboard |
| OpenRouter / SiliconFlow / 302 / AIHubMix | 预付余额 | 钱包余额 + 独立 rate limits | top-up | 部分有 balance/usage API |

---

## 2. 国际 Coding Plan

### 2.1 OpenAI Codex / ChatGPT

**产品形态**

- Codex 包含于 ChatGPT 的多个套餐；ChatGPT 登录与 API Key 是两套独立计费身份。API Key 使用标准 API 价格，且不包含 Codex 云端能力。[Codex pricing](https://developers.openai.com/codex/pricing) · [Codex auth](https://learn.chatgpt.com/docs/auth.md)
- Codex 本地消息与云任务共享额度；ChatGPT Work 等相关功能也可能共享 Codex 使用池。[Codex pricing](https://developers.openai.com/codex/pricing.md)

**限制结构**

- 主窗口是**滚动 5 小时**；另有周限制，但官方未公布统一的周上限数字。[Codex pricing](https://developers.openai.com/codex/pricing)
- 官方对 5 小时额度给的是按模型/套餐划分的**消息范围**，不是固定 Token 或固定消息数。消耗受到模型、上下文、推理、工具调用、缓存、Local/Cloud 等影响。[Codex pricing](https://developers.openai.com/codex/pricing.md)
- Pro 的某些模型可能有独立额度；Enterprise/Edu flexible pricing 则以 credits 扩展，不是固定消息上限。[Codex pricing](https://developers.openai.com/codex/pricing)

**超额与观测**

- 可购买 ChatGPT credits，或切换 API Key 按 API 价格使用；两者必须建成两个池。[Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)
- 官方剩余用量主要在 Codex usage dashboard 与 CLI `/status`；没有公开的消费订阅剩余额度 API。[Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)

**建模结论**

- 付款：月订阅。
- 限制：`rolling 5h` + `weekly unpublished/dynamic`，可有模型独立池。
- 单位：官方消息范围 / credits；不能默认用 Token 上限。
- 官方剩余量：应允许用户手工录入或未来读取 CLI/UI；本地账本只能显示 DSH-observed activity。

### 2.2 Anthropic Claude Code

**产品形态**

- Claude Code 包含于 Claude 付费计划，且与 Claude Chat **共享同一使用量**。[Claude pricing](https://claude.com/pricing) · [Use Claude Code with Pro/Max](https://support.anthropic.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)
- 使用 `ANTHROPIC_API_KEY` 会切到 Console API 计费，不再消耗订阅额度。[Claude Code authentication](https://code.claude.com/docs/en/authentication)

**限制结构**

- 所有计划都有**滚动 5 小时会话窗口**；付费计划还叠加周限制。[Claude pricing](https://claude.com/pricing)
- 周限制可能分为 all-model 与 Opus-only 等模型专属池；周重置时间是账户分配的固定时间，不一定与购买日相同。[How usage and length limits work](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)
- 官方明确说明没有固定消息数；额度受消息长度、文件、项目规模、模型、effort 与工具调用影响。[Use Claude Code with Pro/Max](https://support.anthropic.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)

**超额与观测**

- 付费计划可启用 usage credits，按标准 API 价格额外扣费；也可使用 Console API credits。超额应建为第二钱包池。[Manage usage credits](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans)
- 观测入口包括 Settings > Usage、Claude Code `/status` 与 `/usage`；官方没有公开消费订阅剩余额度 API。[Claude Code costs](https://code.claude.com/docs/en/costs.md)

**建模结论**

- 限制：`rolling 5h` + `weekly all models` + 可选 `weekly model-specific`。
- 额度公开性：动态/未公布；不可要求精确 Token 上限。
- 订阅池与 usage credits/API 钱包必须分离。

### 2.3 Google Gemini Code Assist / Gemini CLI / Antigravity

**产品状态**

- Gemini Code Assist Standard / Enterprise 与 Gemini CLI 的 agent mode 共享每日请求额度。[Gemini Code Assist quotas](https://developers.google.com/gemini-code-assist/resources/quotas)
- 消费者 Gemini Code Assist for individuals / Google AI Pro / Ultra 的 Google Login coding 路径在 2026-06-18 停止服务，消费者被引导到 Antigravity；Standard/Enterprise 不受影响。[Code Assist deprecations](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals)

**限制结构**

- Standard：1,500 model requests / user / day；Enterprise：2,000 / day。agent mode 与 CLI 合并计算；一次用户 prompt 可能产生多次 model request。[Gemini Code Assist quotas](https://developers.google.com/gemini-code-assist/resources/quotas)
- 还存在每分钟限速与 Cloud 侧 RPS；GitHub review 是独立配额。[Gemini for Google Cloud quotas](https://docs.cloud.google.com/gemini/docs/quotas)
- Gemini API Key 是另一套 PAYG / free-tier 身份，具有 RPM、TPM、RPD 等限制，RPD 在 Pacific midnight 重置。[Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- Antigravity 公布的是 weekly rate limits / flexible AI credit pool，但精确数字未公开。[Antigravity pricing](https://antigravity.google/pricing)

**建模结论**

- Google Cloud coding：`fixed daily request quota` + `per-minute rate limit`。
- Gemini API：`RPM + TPM + RPD + spend tier`，不是订阅 token 池。
- Antigravity：`weekly dynamic/unpublished`；不可从旧 Gemini CLI 1000/1500/2000 表推断现行消费者额度。

### 2.4 xAI Grok Build / API

**产品形态**

- Grok Build 支持浏览器登录或 `XAI_API_KEY`；官方文档没有给出可验证的 SuperGrok 消费订阅 coding 额度。[Grok Build overview](https://docs.x.ai/build/overview.md)
- API 使用预付 credits 或企业月结，不是固定月度 token 包。[xAI billing](https://docs.x.ai/console/billing.md)

**限制结构**

- API 按模型限制 RPS 与 TPM，额度随累计消费 tier 变化；达到限制返回 429。[xAI rate limits](https://docs.x.ai/developers/rate-limits.md)
- 每次推理响应可以返回 `usage.cost_in_usd_ticks`，是本次调研中最适合程序化客观计费的接口之一。[xAI cost tracking](https://docs.x.ai/developers/cost-tracking.md)

**建模结论**

- 默认建模为 `prepaid wallet / invoice` + `RPS/TPM`，不要凭第三方信息创建“SuperGrok coding 月包”。

---

## 3. 国内 Coding Plan

### 3.1 智谱 GLM Coding Plan

**产品形态**

- 独立 coding 订阅，个人 Lite/Pro/Max 与团队席位；coding key / base URL 与普通 PAYG API 区分。[GLM Coding Plan overview](https://docs.bigmodel.cn/cn/coding-plan/overview) · [Quick start](https://docs.bigmodel.cn/cn/coding-plan/quick-start)

**限制结构**

- 同时存在公开精确的**5 小时积分**与**周积分**：Lite 2,000 / 10,000，Pro 12,000 / 60,000，Max 28,000 / 140,000。[GLM Coding Plan overview](https://docs.bigmodel.cn/cn/coding-plan/overview)
- 5 小时积分按消费后动态刷新；周积分从下单/订阅时起 7 天刷新。[GLM Coding Plan overview](https://docs.bigmodel.cn/cn/coding-plan/overview)
- 额度单位是计划积分，积分由输入、缓存、输出及 MCP 工具系数计算；不同模型系数不同，非高峰期还有折扣。[GLM Coding Plan overview](https://docs.bigmodel.cn/cn/coding-plan/overview)

**超额与观测**

- 个人版用尽后停止，通常不自动扣账户余额；团队版可选 PAYG 超额。[GLM Coding Plan FAQ](https://docs.bigmodel.cn/cn/coding-plan/faq) · [Team plan](https://docs.bigmodel.cn/cn/coding-plan/team)
- 官方文档未找到 public remains API，主要通过用量页面观察。

**建模结论**

- 双限制：`rolling-after-consume 5h credits` + `weekly-from-order credits`。
- 积分系数属于 rate card/modifier，不属于 quota limit 本身。

### 3.2 Kimi Code

**产品形态**

- Kimi Code 不是独立 coding SKU，而是 Kimi 会员权益；会员月度额度会被 Agent、PPT、Code、Work、Claw 等共享。[Kimi Code membership](https://www.kimi.com/code/docs/en/kimi-code/membership.html) · [Membership update rules](https://www.kimi.com/help/membership/membership-update-rules)
- Kimi Code OAuth / coding key 与 Moonshot Open Platform PAYG API 独立。[Kimi Code overview](https://www.kimi.com/code/docs/en/)

**限制结构**

- 三层同时生效：会员月度共享池 + Kimi Code 周额度 + 滚动 5 小时限速。[Kimi Code membership](https://www.kimi.com/code/docs/en/kimi-code/membership.html)
- 周/5 小时数值主要以页面提示为准；官方没有稳定的公开数值表。

**超额与观测**

- Extra Usage 是独立预付钱包，月/周/小时额度耗尽后可继续扣钱包；余额不失效。[Kimi membership rules](https://www.kimi.com/help/membership/membership-update-rules)
- 观测入口：Code Console、CLI `/usage`、会员用量记录；没有公开 remains HTTP API。

**建模结论**

- 必须支持“共享会员池 + coding 专属 5h/weekly overlays + Extra Usage 钱包”，不能只建一个 Kimi 池。

### 3.3 MiniMax Token Plan

**产品形态**

- Token Plan 是 Coding Plan 的升级版，属于 coding/agent 订阅；Subscription Key 与 PAYG API Key 分离。[Token Plan intro](https://platform.minimaxi.com/docs/token-plan/intro) · [Token Plan pricing](https://platform.minimaxi.com/docs/guides/pricing-token-plan)

**限制结构**

- 同时存在 5 小时与周窗口；各模态按对应 PAYG 标价从包含额度中扣减并共享一个 bar。[Token Plan FAQ](https://platform.minimaxi.com/docs/token-plan/faq)
- 官方没有公开固定的 5h/周 quota 数字；控制台进度条是运行时事实。中英文文档对 5h 是 fixed 还是 rolling 存在表述差异，因此 schema 不应硬编码其中一种。[Token Plan intro CN](https://platform.minimaxi.com/docs/token-plan/intro) · [Token Plan intro Intl](https://platform.minimax.io/docs/token-plan/intro)

**超额与观测**

- 可购买 Credits，先扣 included quota，后扣 Credits；Credits 有 365 天有效期。[Token Plan FAQ](https://platform.minimaxi.com/docs/token-plan/faq)
- MiniMax 提供 `GET /v1/token_plan/remains`，但官方未公布完整响应 schema。[Token Plan FAQ](https://platform.minimax.io/docs/token-plan/faq)

**建模结论**

- 双窗口，但上限来源应允许 `official_api / dynamic UI`，而不是要求用户手填伪精确值。

### 3.4 小米 MiMo Token Plan

**产品形态**

- 专用于 coding tools 的 Token Plan，使用 `tp-` Key 与独立 base URL；与常规 PAYG `sk-` Key 分离。[MiMo Token Plan subscription](https://mimo.mi.com/docs/zh-CN/tokenplan/Token%20Plan/subscription)

**限制结构**

- 额度是整个月/年订阅期的一次性 credits 总池；官方未说明 5 小时或周窗口。[MiMo Token Plan pricing](https://mimo.mi.com/docs/zh-CN/price/token-plan)
- 模型按 cache-hit / cache-miss / output 等不同 credits/token 系数扣减；夜间还有 0.8x 系数。[MiMo Token Plan subscription](https://mimo.mi.com/docs/zh-CN/tokenplan/Token%20Plan/subscription)

**超额与观测**

- credits 耗尽或订阅到期即停止；不自动回退余额。继续使用需升级或切 PAYG API。[MiMo Token Plan FAQ](https://mimo.mi.com/docs/zh-CN/quick-start/faq/token-plan)
- 官方主要提供控制台进度和提醒，未找到 remains HTTP API。

**建模结论**

- `term_lump credits`，没有 5h/周；月付与年付应保留真实 term，而不是强制转成每月 refill。

---

## 4. 其他代表性 Coding 产品

### 4.1 GitHub Copilot

- GitHub Copilot 使用按月包含的 premium requests / AI Credits 模型；额度在**每月 1 日 00:00 UTC** 重置，而不是用户订阅扣款日。未用额度不结转。[Understanding requests in Copilot](https://docs.github.com/copilot/concepts/copilot-billing/understanding-and-managing-requests-in-copilot) · [Usage-based billing for individuals](https://docs.github.com/copilot/concepts/billing/usage-based-billing-for-individuals)
- 不同模型/功能按不同倍率消耗；基础模型和 premium 模型行为不同。用尽后可使用基础模型，或为额外 premium usage 设置 budget/overage。[Understanding requests in Copilot](https://docs.github.com/copilot/concepts/copilot-billing/understanding-and-managing-requests-in-copilot)
- 观测主要通过 GitHub Billing / Copilot usage 页面和企业 usage reports；GitHub REST billing API 能提供组织层用量。[GitHub billing usage API](https://docs.github.com/rest/billing/usage)

**建模启示**：`calendar_month UTC` + `AI credits/premium requests` + `model/feature multiplier` + `overage budget`。付款日与额度重置日必须分开。

### 4.2 Cursor

- Cursor 付费计划包含两个独立的月度 usage pools：Cursor 自有模型池与 OpenAI/Anthropic/Google 等 Other Models 池；两者按 billing cycle 重置，未用额度不结转。[Cursor models and pricing](https://cursor.com/docs/models-and-pricing) · [Usage limits](https://cursor.com/help/models-and-usage/usage-limits)
- Other Models 主要按模型公开 API 标价消耗 included usage；模型越贵、上下文越长，池消耗越快。[Cursor models and pricing](https://cursor.com/docs/models-and-pricing)
- 用尽后可启用 on-demand PAYG，并设置 spend limit；也可选择硬停止或升级。[Cursor overages](https://cursor.com/help/account-and-billing/overages)

**建模启示**：一个 plan 下可有多个按“模型集合”划分的月度池；overage 是另一个后付费池。

### 4.3 阿里云百炼 Coding Plan

- Coding Plan Pro 公开三组同时生效的请求数限制：**5 小时滚动 6,000 requests、每周 45,000、每月 90,000**；达到任意一个即停止。[阿里云 Coding Plan](https://help.aliyun.com/zh/model-studio/coding-plan)
- 5 小时按每笔调用在 5 小时后恢复；周限每周一 00:00 UTC+8 重置；月限按订阅对应日重置。[阿里云 Coding Plan](https://help.aliyun.com/zh/model-studio/coding-plan)
- 额度单位是模型调用 request，而非用户 prompt，也不是 Token；一个复杂任务可能触发多次模型调用。超限不会自动回退 PAYG。[Coding Plan FAQ](https://help.aliyun.com/zh/model-studio/coding-plan-faq)

**建模启示**：同一 plan 需要 `rolling 5h + fixed weekly + billing-cycle monthly` 三个 AND 池，单位是 model requests。

### 4.4 Kiro

- Kiro 使用月度 credits；不同模型/任务复杂度按倍率消耗 credits。额度按自然月/账期重置，未用不结转。[Kiro pricing](https://kiro.dev/pricing/) · [Kiro billing](https://kiro.dev/docs/billing/)
- 付费计划可以购买 add-on credits 继续使用；Free 是硬停止。[Kiro billing FAQ](https://kiro.dev/docs/billing/related-questions/)

**建模启示**：`monthly credits` + `model multiplier` + `add-on wallet`，与 MiniMax/Xiaomi 的 credits 结构相似但 rate card 不同。

---

## 5. 中转与预付费平台

| 平台 | 计费形态 | 余额/到期 | 可程序化观测 | 官方来源 |
|---|---|---|---|---|
| OpenRouter | 预付 USD credits；可自动充值；推理按 provider 价格扣费，购币有手续费 | 条款允许未用 credits 1 年后到期 | `GET /api/v1/credits`；completion `usage.cost`；generation usage API | [FAQ](https://openrouter.ai/docs/faq) · [Credits API](https://openrouter.ai/docs/api/api-reference/credits/get-credits) · [Usage accounting](https://openrouter.ai/docs/use-cases/usage-accounting) |
| xAI API | 预付 credits + 可选企业月结；自动 top-up | 余额池，无月度 token 包 | Console Usage；响应 `usage.cost_in_usd_ticks`；Management billing APIs | [Billing](https://docs.x.ai/console/billing.md) · [Cost tracking](https://docs.x.ai/developers/cost-tracking.md) |
| SiliconFlow | 人民币充值余额 + 赠送余额；支持自动充值 | 官方充值协议称余额无有效期 | `GET /v1/user/info` 返回 balance/chargeBalance/totalBalance；详细账单主要在控制台 | [财务 FAQ](https://docs.siliconflow.com/cn/faqs/misc_finance) · [User info API](https://docs.siliconflow.com/en/api-reference/userinfo/get-user-info) · [充值协议](https://docs.siliconflow.com/cn/legals/recharge-policy) |
| 302.AI | 纯 PAYG，充值后按 Token/次扣费，无月费套餐 | 官方帮助页称余额永久有效 | `GET /dashboard/balance`；调用明细在后台 | [API Pricing](https://help.302.ai/en/docs/API-Pricing) · [Balance API](https://doc.302.ai/262796252e0) |
| AIHubMix | PAYG quota/余额；管理 key 与推理 key 分离 | API key 可设置独立 quota/expiry | `GET /api/user/self` 返回 quota/used_quota/request_count；模型 API 提供价格 | [Balance API](https://docs.aihubmix.com/cn/api/CliEndpoints/get-self) · [CLI docs](https://docs.aihubmix.com/en/api/aihubmix-cli) · [Models API](https://docs.aihubmix.com/en/api/Models-API) |

**统一建模建议**

- 这些平台默认建为 `prepaid_wallet`，而不是 `subscription`。
- 余额、自动充值阈值、余额到期属于 Billing/Wallet；RPM/TPM 属于 Rate Limit；模型价格属于 Rate Card。三者不能混在“额度”字段里。
- 有官方 balance API 的平台，可将余额标记为 `official_api`；只有网页控制台的标记为 `manual`。

---

## 6. 推荐的数据模型方向（仅结论，不实施）

### 6.1 Product 与 Billing

```json
{
  "product": "claude_code",
  "vendor": "anthropic",
  "billingIdentity": "subscription",
  "planName": "Max 5x",
  "billing": {
    "cadence": "month",
    "price": { "currency": "USD", "amount": 100 },
    "renewalAnchor": "2026-09-12T08:00:00+08:00"
  }
}
```

`billing.cadence` 只描述付款，不决定 quota window。

### 6.2 限制应是数组

```json
{
  "limits": [
    {
      "id": "session_5h",
      "window": { "kind": "rolling_duration", "durationMs": 18000000 },
      "unit": "percent",
      "limit": { "kind": "dynamic", "value": null },
      "observation": "official_ui_or_cli"
    },
    {
      "id": "weekly_all_models",
      "window": { "kind": "fixed_cycle", "durationMs": 604800000, "anchor": "account_assigned" },
      "unit": "percent",
      "limit": { "kind": "unpublished", "value": null },
      "observation": "official_ui_or_cli"
    }
  ]
}
```

### 6.3 必须支持的 window.kind

- `rolling_duration`：过去 5 小时、过去 7 天。
- `rolling_after_consume`：GLM 所描述的每笔消费 5 小时后释放。
- `fixed_cycle`：账户分配的周重置、订阅日起 7 天。
- `calendar_day`：每日，带时区。
- `billing_cycle`：每月某日/购买日起每月。
- `term_lump`：整个订阅期/年度一次性 credits。
- `cumulative_spend_tier`：xAI API tier。
- `rate_limit`：RPM/TPM/RPS，不与余额池合并。

### 6.4 limit.kind

- `exact`：GLM credits、Gemini Standard/Enterprise daily requests。
- `range`：OpenAI 5h message range。
- `multiplier`：Claude Max 5x/20x 相对 Pro。
- `dynamic`：控制台实时条，数值会变。
- `unpublished`：只知道存在限制。
- `manual_estimate`：用户自填；UI 必须明确标“用户估计”。

### 6.5 观测来源

```text
local_ledger        DSH 内的客观用量，不等于官方剩余
official_response   API 响应的 token/cost
official_usage_api  remains/balance/usage endpoint
official_cli        /status、/usage、/stats model
official_ui         控制台手工读取
manual              用户录入
```

必须把 `observed usage` 与 `official remaining` 分开。没有官方同步时，UI 应显示：

- “DSH 观察到：过去 5h 处理了 …”
- 而不是“官方 5h 额度已用 42%”。

---

## 7. 对当前配置 UI 的直接判断

当前表单的问题：

1. `reset_day` 同时承担账单日、额度窗口和重置语义，概念错误。
2. 只允许一个 quota，覆盖不了 5h + weekly + model-specific 多池。
3. quota 强制数值，不适合 dynamic/unpublished 限额。
4. unit 只有 newCompute / USD，缺 credits、requests、messages/range、percent、RPM/TPM。
5. subscription 与 API/prepaid wallet 没有分成不同 billing identity。
6. 没有 observation/source，无法区分官方剩余与 DSH 本地估计。
7. 没有 overage/fallback，无法表达 Kimi Extra Usage、MiniMax Credits、Claude usage credits、API key fallback。

后续若重做，建议先以**产品模板 + 高级自定义**代替让用户从零填写：

- OpenAI Codex：5h dynamic + weekly unpublished + optional credits。
- Claude Code：5h dynamic + weekly all + optional Opus weekly + usage credits。
- GLM Coding Plan：5h exact credits + weekly exact credits。
- Kimi Code：membership month + coding 5h/weekly dynamic + Extra Usage wallet。
- MiniMax Token Plan：5h/weekly dynamic + Credits wallet。
- MiMo Token Plan：term_lump credits。
- Gemini Code Assist：daily requests + per-minute rate。
- OpenRouter/SiliconFlow/302/AIHubMix/xAI：prepaid wallet + rate limits。

模板中的具体价格和额度应来自可更新 catalog，不应写死在 schema 或 client bundle 中。
