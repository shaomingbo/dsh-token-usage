# DSH Accounts & Usage 5.0.0 Specification

## 5.0 Account Lifecycle Amendment

Version 5 makes the account the single unit of the whole interaction. Schema v7 is additive (`account_products.color`, `account_products.connection_id`) and pool attribution now reads `account_attribution_rules`; the v5 lossless projection keeps legacy `plans`/`plan_rules` working and stays authoritative for their projected copies after any legacy write.

Zero-config accounts: every configured connection becomes one `account_products` row (`source_kind='connection'`) with default provider-alias rules at priority 100; archived auto accounts are never resurrected, and only the active Antigravity account routes local traffic. A host-side product-template catalog (`lib/accounts/templates.json`, versioned, seeded into `provider_templates`/`provider_mappings`) pre-fills windows, officially published exact values and provider aliases; the wizard joins observed ledger traffic into suggestions, and an advanced form covers custom quotas, prices, balances and rules.

The UI journey is entry → dock → overview → per-account insight. Meters are official-first: provider windows render as percent bars with reset countdowns, source badges and observed-at timestamps; local quota percentages appear only for ledger-computable units (tokens/USD/requests with exact or manual values), credits and percent limits stay official-observed only, and the sidebar entry meters the watched account's primary window (dock ★ pin, client-side) falling back to the global tightest constraint across both worlds — one value mirrored by the energy capsule glyph, the percentage and the bar, using a Split Flex layout for long account names and with month-progress context kept to the tooltip. Each account insight separates official allowance, DSH-observed local usage (with arithmetic-only extrapolation), billing, attribution and connection management. The v5 billing-pool form is retired from the UI; the `save-plan` RPC family remains available but reports `deprecated`. Observation refresh stays explicit on the RPC surface, with a silent throttle (at most one background refresh per 15 minutes) piggy-backing on `entry-summary` polls.

## 4.0 Product Amendment

Version 4 keeps the `dsh-token-usage` package, data path, local Usage Ledger, and every request/privacy guarantee below. It adds the account domain defined in `CONTEXT.md`, an internal ProviderAdapter registry, additive schema v6 records for secret-free Connections, Credential metadata, Products, Billing, Limits, Observations, provider templates/mappings, and Attribution Rules, plus a unified loopback-only `/account-usage` interface.

Provider observations and the local Usage Ledger are separate facts in storage, RPC, and UI. A provider observation names its source and brittleness and never becomes an invoice claim. Secrets have no SQLite representation and never appear in plugin-owned RPC responses, logs, diagnostics, or exports; credential entry uses the dedicated DSH Credentials API. Provider HTTP requests use strict origins and reject redirect credential forwarding.

The integrated provider capability set is ChatGPT/Grok OAuth and allowance usage (without search orchestration), Antigravity multi-account OAuth/routes/models/proxy/failover, GLM official plugin observations, Ollama Local (quota not applicable), and Ollama Cloud API-key configuration with honestly unverified status (no dedicated official validation endpoint), plus explicitly opted-in manual settings-cookie observation. Existing `.oauth.json`, `.antigravity-auth.json`, model routes, and compatibility channels remain during the 4.x transition. Ollama cookies are manually supplied, reduced to an explicit allowlist, owner-only, never read automatically from Chrome, and their settings-derived observations are labeled `official_ui` and `brittle`.

Schema v6 retains every legacy table and transactionally maps v5 plans and both windows into manual-estimate Products/Billing/Limits. Existing files receive a pre-migration backup. Normal writes reject a newer schema; a separate read-only diagnostic opening is available for downgrade inspection.

The 4.0 UI is Accounts & Usage: provider connection cards and official observations appear separately from local ledger analytics. Domain/storage/adapter and host behavior take precedence over pixel polish.

## 4.1 Ollama Cloud Model Amendment

A configured `OLLAMA_API_KEY` provisions one `ollama-cloud` model route without moving or copying the credential. The plugin reads the official `GET https://ollama.com/api/tags` catalog and `POST https://ollama.com/api/show` details, then writes only secret-free route metadata under `llm-pi-ai.providers.ollama-cloud`. Inference uses Ollama's official OpenAI-compatible `https://ollama.com/v1` endpoint.

Only completion-capable models enter the route. Effective context uses a positive configured `num_ctx`, then the architecture-specific `model_info.*.context_length`; vision and thinking come from `capabilities`. Output capacity is written only for a positive `num_predict`. Detail failures retain listed models and any prior metadata, while list failures or empty listings never erase the previous route. Initial provisioning occurs only when a credential exists and the route is absent; later catalog reconciliation is explicit. A conflicting user-owned route is refused before the credential reaches the network.

## Problem Statement

DeepSeek Harness users can see contextual token pressure inside an active conversation, but they cannot inspect a durable, profile-wide account of model usage. They lack a trustworthy way to answer how many tokens they processed, which projects, sessions, models, and providers caused the usage, how much the usage would cost at public or customized prices, and whether a displayed number is provider-reported or estimated.

Existing session history already contains most of the durable facts needed for this analysis, but users cannot aggregate those facts without scanning compressed logs, understanding turn and step semantics, excluding inherited fork prefixes, replacing repeated usage samples, resolving model aliases, and applying versioned prices. A naïve counter would double-count forked sessions, reasoning tokens, or streaming samples and could present partial prices as complete bills.

Users also need historical coverage from before plugin installation, ongoing capture without patching Harness, local-only storage, safe exports, and a profile-style Web interface similar in visual hierarchy to the Codex personal profile. The feature must be distributed as an ordinary Harness Web bundle, must not patch Harness source, and must never make Harness availability depend on the health of the usage database.

## Solution

Provide `dsh-token-usage`, an installable Harness Web bundle that builds a local usage ledger from the durable `SessionEvent` log and the post-commit `session/event` feed. The bundle imports existing sessions through read-only persistence APIs, records subsequent events in real time, reconciles missed events incrementally, and stores normalized request-level facts in a profile-private SQLite database.

The ledger treats one distinct session turn/step pair as one observable model call. It replaces earlier usage samples for the same step with the final sample, excludes fork-inherited seed prefixes from corpus totals, counts subagent lineage exactly once, ignores compaction markers for billing, and treats reasoning tokens as a subset of output tokens. When provider usage is absent, the bundle may estimate tokens in memory through the Harness token meter while persisting no prompt, response, tool argument, or secret.

A host-side query service exposes aggregated and request-level data to the plugin client. A sidebar footer action opens a full-frame overlay containing overview, requests, projects, sessions, models, providers, pricing, data-management, and settings views. The overview follows the information hierarchy of the supplied Codex profile reference while using Harness-native theme, locale, accessibility, and responsive behavior.

The bundle computes immutable original valuations from a versioned bundled price snapshot and presents a separate current-rule revaluation after aliases, prices, multipliers, or exchange-rate settings change. It supports CSV and JSON reports, complete backup and restore, configurable retention, audited corrections, and explicit source-deletion status. All processing is local by default, and network access occurs only when the user explicitly updates pricing data.

## User Stories

1. As a Harness user, I want to see my all-time processed token total, so that I understand my overall model usage.
2. As a Harness user, I want to distinguish newly computed tokens from cached tokens, so that a large cache-read count does not mislead me about fresh computation.
3. As a Harness user, I want input, output, cache-read, cache-write, and reasoning breakdowns, so that I can understand how each model call consumed tokens.
4. As a Harness user, I want reasoning tokens identified as a subset of output tokens, so that they are not double-counted.
5. As a Harness user, I want provider-reported and estimated usage separated, so that I know which totals are exact observations and which are approximations.
6. As a Harness user, I want the overview to show both confirmed totals and totals including estimates, so that missing provider usage remains visible without being presented as exact.
7. As a Harness user, I want to see the percentage of total usage that was estimated, so that I can judge the reliability of an aggregate.
8. As a Harness user, I want the plugin to import sessions created before installation, so that my historical profile does not begin at zero.
9. As a Harness user, I want historical import to run in the background, so that it does not block Harness startup or an active conversation.
10. As a Harness user, I want to see import progress, imported sessions, imported calls, and errors, so that I know whether historical coverage is complete.
11. As a Harness user, I want to pause, resume, or cancel an import, so that a large history scan remains under my control.
12. As a Harness user, I want a canceled import to resume from its saved progress, so that completed work is not discarded.
13. As a Harness user, I want to limit a historical import to a date range, so that I can avoid scanning irrelevant old history.
14. As a Harness user, I want repeated imports to be idempotent, so that manually rescanning cannot duplicate usage.
15. As a Harness user, I want real-time capture and historical reconciliation to overlap safely, so that startup races do not double-count requests.
16. As a Harness user, I want missed live events recovered from durable session history, so that listener failures or plugin downtime do not leave permanent gaps.
17. As a Harness user, I want fork-inherited history counted only once globally, so that creating a fork does not multiply past token usage and cost.
18. As a Harness user, I want a fork detail view to separate inherited context from usage added by the fork, so that I understand its incremental cost.
19. As a Harness user, I want subagent calls counted in their own child sessions and rolled into the parent lineage when requested, so that delegated work is neither lost nor duplicated.
20. As a Harness user, I want a session detail view to show direct usage and usage including child sessions, so that I can inspect both local and lineage-wide cost.
21. As a Harness user, I want compaction events ignored as billing events, so that conversation summarization does not create fictitious usage.
22. As a Harness user, I want failed, aborted, and max-token steps included in request-health statistics, so that failures remain visible even when no usage was reported.
23. As a Harness user, I want usage-less failures to remain token- and cost-unknown, so that the plugin does not invent billing data.
24. As a Harness user, I want hidden provider retries described as an observability limitation, so that I do not mistake the ledger for an upstream invoice.
25. As a cost-conscious developer, I want usage grouped by project, so that I can identify expensive codebases.
26. As a cost-conscious developer, I want project identity to prefer Git repository identity and fall back to working directory, so that subdirectories of one repository do not fragment statistics.
27. As a cost-conscious developer, I want projects with missing child-session paths to inherit project identity through session lineage, so that subagent usage remains attributable.
28. As a Harness user, I want to merge and split project identities without changing raw records, so that I can correct automatic project grouping.
29. As a Harness user, I want to rename, color, or hide a project, so that the dashboard matches my working vocabulary.
30. As a privacy-conscious user, I want project paths and Git remotes to remain local, so that project identity does not become telemetry.
31. As a Harness user, I want usage grouped by original model and normalized model alias, so that provider-specific model spellings can be analyzed together without losing source facts.
32. As a Harness user, I want usage grouped by provider, so that I can compare provider utilization and cost.
33. As a Harness user, I want rankings switchable among projects, models, and providers, so that one overview supports different investigations.
34. As a Harness user, I want rankings switchable among token, cost, and request count, so that I can rank by the metric relevant to my question.
35. As a Harness user, I want ranking rows to show token, cost, and request count together, so that a ranking does not hide the other dimensions.
36. As a Harness user, I want a twelve-month activity heatmap, so that I can recognize long-term work patterns.
37. As a Harness user, I want the heatmap switchable among token, cost, and request count, so that activity can be viewed through different measures.
38. As a Harness user, I want a quantile-based heatmap color scale, so that a few extreme days do not flatten all ordinary activity.
39. As a Harness user, I want exact daily values on hover or focus, so that the visual scale does not hide the underlying numbers.
40. As a Harness user, I want current and longest activity streaks based on days with at least one observable model request, so that streaks reflect actual attempts to use a model.
41. As a Harness user, I want natural session span and estimated active duration shown separately, so that idle time does not masquerade as active work.
42. As a Harness user, I want active duration to stop accumulating after a configurable idle interval, so that long-open sessions remain meaningful.
43. As a Harness user, I want the overview to show all-time totals while trends and rankings default to the latest thirty days, so that the page balances history and current behavior.
44. As a Harness user, I want one global time filter to update related views, so that cross-view comparisons use the same period.
45. As a Harness user, I want raw timestamps stored independently of display timezone, so that I can regroup history after changing timezone.
46. As a Harness user, I want the default timezone to follow my system and support IANA timezone configuration, so that day boundaries match my locale.
47. As a Harness user, I want weeks to begin on Monday by default, so that weekly aggregation matches my expected calendar.
48. As a Harness user, I want a request list filterable by date, project, session, model, provider, status, and estimation state, so that I can isolate abnormal usage.
49. As a Harness user, I want request details to show time, status, attribution, token categories, valuation, price source, duration, and failure type when available, so that I can audit a call without reading conversation content.
50. As a privacy-conscious user, I want request details never to display prompts, responses, tool arguments, or secrets, so that the usage UI does not become a second conversation archive.
51. As a Harness user, I want a session analysis view without conversation text, so that I can inspect usage trends and model changes while preserving content privacy.
52. As a Harness user, I want public-list-price estimates, so that I can understand the approximate API value of my usage.
53. As a Harness user, I want custom model prices and provider multipliers, so that estimates can reflect a proxy or negotiated arrangement.
54. As a Harness user, I want input, output, cache-read, cache-write, reasoning, long-context, and effective-date price fields supported by the pricing model, so that future pricing rules do not require destructive schema changes.
55. As a Harness user, I want prices sourced from an embedded versioned snapshot, so that reports remain available offline and reproducible.
56. As a Harness user, I want an explicit action to update pricing from named upstream sources, so that network access and price changes are under my control.
57. As a Harness user, I want to review the source, timestamp, and summary of a price update before applying it, so that historical results do not change silently.
58. As a Harness user, I want unmatched models marked as price-unknown, so that the plugin does not guess a plausible but wrong price.
59. As a Harness user, I want cost coverage displayed, so that a partial aggregate is not presented as complete.
60. As a Harness user, I want an immutable original valuation and a separate current-rule revaluation, so that historical accounting remains reproducible after pricing changes.
61. As a Harness user, I want model-alias changes to affect current-rule revaluation without rewriting original valuation, so that corrections preserve audit history.
62. As a Harness user, I want USD to remain the base ledger currency, so that upstream model prices have a stable unit.
63. As a Harness user, I want to configure a fixed CNY display exchange rate, so that I can view approximate local-currency cost without automatic network access.
64. As a Harness user, I want the exchange rate and price version used by a valuation recorded, so that displayed amounts are explainable.
65. As a Harness user, I want provider-reported amounts distinguished from calculated amounts if Harness exposes them in the future, so that estimates never masquerade as actual payment.
65a. As an Ollama Cloud user, I want a configurable cache-hit scenario when cache detail is unavailable, with reported categories and the no-scenario value preserved, so that account and global cost estimates are useful without pretending to be a bill.
65b. As a Harness user, I want omitted, explicitly reported zero, and positive cache categories kept distinct whenever the runtime exposes that distinction, so that future provider telemetry automatically takes precedence over scenarios.
66. As a Harness user, I want to add a correction without modifying the original usage fact, so that obvious provider errors can be handled audibly and reversibly.
67. As a Harness user, I want to exclude a corrected or suspect record from aggregates while retaining it for audit, so that bad data does not distort the dashboard.
68. As a Harness user, I want request metadata retained according to a configurable policy, so that I can balance auditability and local storage.
69. As a Harness user, I want anonymous daily aggregates retained when old request detail is purged, so that long-term trends survive cleanup.
70. As a Harness user, I want deleted source sessions marked as unavailable rather than automatically erased from the ledger, so that deleting a conversation does not silently rewrite historical totals.
71. As a Harness user, I want a manual action to remove data whose source session is gone, so that I retain final control over cleanup.
72. As a Harness user, I want CSV exports of filtered request or aggregate data, so that I can analyze usage in spreadsheet tools.
73. As a Harness user, I want structured JSON reports, so that I can automate local analysis.
74. As a privacy-conscious user, I want ordinary CSV and JSON exports to anonymize absolute paths, remotes, and session identifiers by default, so that they are safer to share.
75. As a Harness user, I want an explicit complete export option, so that I can preserve all local identifiers when I need a faithful backup.
76. As a Harness user, I want complete backups to carry prominent privacy warnings, so that I do not confuse them with shareable reports.
77. As a Harness user, I want backups restorable by merge, so that I can combine non-overlapping ledger data without duplication.
78. As a Harness user, I want backups restorable by replacement, so that I can recover a known-good ledger state.
79. As a Harness user, I want replacement restore to back up the current database first, so that a restore mistake is reversible.
80. As a Harness user, I want schema migrations to back up data and run transactionally, so that plugin upgrades do not corrupt long-term history.
81. As a Harness user, I want a database created by a newer unsupported schema to open read-only or fail clearly, so that an older plugin does not damage it.
82. As a Harness user, I want database corruption to stop ledger writes without stopping Harness, so that an analytics failure cannot take down my agent workflow.
83. As a Harness user, I want read-only diagnostics and recovery choices for a damaged database, so that the plugin never deletes and recreates data without permission.
84. As a Harness user, I want uninstall to preserve the ledger by default, so that reinstalling does not lose history.
85. As a Harness user, I want the UI to disclose the retained-data location and deletion procedure, so that uninstall behavior is transparent.
86. As a Harness user, I want a locally configurable display name and avatar, so that the overview feels like a personal profile without requiring a cloud account.
87. As a Harness user, I want identity defaults derived from local system or Git information and overridable in settings, so that setup is convenient but explicit.
88. As a privacy-conscious user, I want avatars limited to imported local images or initials, so that opening the dashboard does not contact a remote image host.
89. As a Harness user, I want the current Harness profile displayed beside the local identity, so that I know which ledger scope I am viewing.
90. As a Harness user, I want a sidebar usage action, so that the dashboard is reachable without patching the existing conversation UI.
91. As a Harness user, I want a configurable today summary in the wide sidebar, so that I can glance at token or cost without opening the dashboard.
92. As a Harness user, I want the dashboard to open as a full-frame overlay and return to the unchanged conversation when closed, so that usage analysis does not disrupt work.
93. As a keyboard user, I want the overlay closable by keyboard with managed focus, so that it remains accessible.
94. As a Harness user, I want the UI to follow Harness dark and light themes, so that the plugin feels native.
95. As a Harness user, I want the UI to follow Harness Chinese and English locale, so that labels match the host application.
96. As a Harness user, I want large request lists paged or virtualized, so that a ledger with one hundred thousand calls remains responsive.
97. As a Harness user, I want each dashboard module to load and fail independently, so that a price error does not blank the token heatmap.
98. As a Harness user, I want clear loading, empty, partial-data, and retry states, so that I can distinguish no data from failed data.
99. As a Harness user, I want my most recent time, metric, and ranking filters restored locally, so that the dashboard reopens where I left it.
100. As a privacy-conscious user, I want no telemetry and no default network requests, so that local usage stays local.
101. As a Harness administrator, I want the bundle to check required Harness capabilities at startup, so that incompatible versions fail with actionable diagnostics instead of silently miscounting.
102. As a Harness administrator, I want a usage-plugin failure contained within the plugin, so that Harness remains available.
103. As a Harness administrator, I want the installer to support install, status, and uninstall idempotently, so that deployment can be automated safely.
104. As a Harness administrator, I want installation to modify only the bundle dependency and profile bundle list, so that unrelated profile configuration remains untouched.
105. As a Harness administrator, I want dependency installation to ignore lifecycle scripts and roll back manifest changes on failure, so that installing the plugin is safe.
106. As a Harness administrator, I want the installer never to restart Harness, so that process control remains with me.
107. As a plugin maintainer, I want synthetic session fixtures rather than copied personal logs, so that tests cannot leak real user content.
108. As a plugin maintainer, I want the assembled host ledger tested through its public query surface, so that tests protect observable behavior rather than internal methods.
109. As a plugin maintainer, I want distribution tests against temporary Harness homes, so that first install, repeat install, status, uninstall, malformed manifests, argument errors, and rollback remain reliable.
110. As a plugin maintainer, I want the client artifact validated through the Harness module-loader format, so that a published bundle cannot ship an unloadable Web client.
111. As a plugin maintainer, I want release artifacts checked with package dry-run and diff hygiene, so that the tagged installer contains the documented files and clean text output.
112. As a plugin maintainer, I want remote publication to require a separate human approval after local validation, so that preparing v0.1.0 does not implicitly publish it.

## Implementation Decisions

- The feature is an out-of-tree Harness Web bundle. It contributes host and client plugins through documented bundle composition and slot extension points; it does not patch Harness packages or replace existing single-owner UI slots.
- The host half owns one deep module, the usage ledger service. Its public responsibilities are importing durable session facts, accepting post-commit session events, maintaining the ledger, applying valuation rules, managing import jobs, and serving read-only query and data-management operations. SQLite details, fork filtering, event folding, and pricing resolution remain hidden behind this service.
- The client half mounts the plugin's own remote contribution and consumes the usage ledger service. It does not read session artifacts directly.
- The primary durable source is the Harness `SessionEvent` log. Historical import uses immutable inspection and incremental read APIs; it never uses a recovery load operation that can append to a cold session.
- Live capture listens to the post-commit session event feed. Listener failure cannot roll back the committed Harness event, so the ledger treats live capture as a low-latency path and durable reconciliation as the completeness path.
- The importer compares persistence snapshot revisions, stores the last observed sequence per source session, and resumes from the next sequence. It performs a daily current-profile reconciliation and a configurable periodic or manual scan for explicit additional data sources.
- Additional sources must be explicitly configured, validated as compatible Harness session stores, and opened read-only. Removing a source configuration does not erase imported ledger data.
- The unit of observable model usage is one distinct step identified by session, turn, and step. A repeated usage sample for that step replaces the earlier sample. The source event sequence remains stored for provenance and deterministic reconciliation.
- Event provenance uses the stable session and sequence identity. The ledger never uses rendered surface order because compaction may make visible surface sequence ordering non-monotonic.
- The importer locates the final constructor seed boundary for a fork or resume and marks all inherited-prefix model usage as non-own usage. Inherited usage may be shown for context but is excluded from global, project, model, provider, and cost aggregates.
- Subagent sessions are independent usage owners. Their own usage is counted once, and lineage is used only for roll-up and missing project inheritance.
- Compaction events, summaries, checkpoints, and surface replacements do not create billable calls. Original usage-bearing events remain the source of token accounting.
- Failed, aborted, interrupted, and max-token steps are retained as request-health records. They receive no token or cost value unless a provider usage sample or explicit estimate exists.
- Provider-internal retries absent from durable Harness events are outside the ledger's exact observability. The product explains that this ledger is a Harness-observed usage account, not an upstream invoice.
- Token categories are normalized as uncached input, output, cache read, cache write, and optional reasoning. Processing tokens sum uncached input, output, cache read, and cache write. New-compute tokens sum uncached input and output. Reasoning is a displayed subset of output and is never added again.
- Provider-reported usage and estimated usage remain distinct at record and aggregate levels. Every estimate records the estimator identity and version.
- Cache category presence is tri-state: reported, absent, or legacy-unknown. A reported value wins even when it is zero. A valuation scenario may apply only to absent/legacy-unknown Ollama Cloud cache detail; it never changes stored token facts or the request-level token-estimation flag.
- Estimation may read message content transiently in host memory and call the Harness token meter. Message content, tool arguments, request bodies, responses, credentials, and secrets are never written to the ledger, diagnostic export, report export, or logs owned by this plugin.
- The profile owns a private SQLite database. The implementation uses the Node built-in SQLite API and checks its availability at startup. The package declares compatibility with the supported Node 22 and 24 lines and reports a capability error instead of adding a second storage engine.
- SQLite migrations use a monotonic schema version, automatic pre-migration backup, and a transaction. A database newer than the plugin's supported schema is never opened for writes.
- Database or migration failure disables ledger writes and exposes diagnostics without preventing Harness startup or unrelated plugin behavior.
- Request facts and original valuations are immutable. Corrections, exclusions, alias changes, and current-rule valuations are appended or derived, remain auditable, and can be reversed without rewriting source facts.
- Source sessions missing during reconciliation receive a source-deleted status. Their ledger records remain until an explicit retention or deletion operation removes them.
- Request retention is configurable. Purging request details can preserve anonymized day-level aggregates, with the loss of future request-level audit and reattribution disclosed before deletion.
- Project identity prefers normalized Git repository identity and falls back to normalized working directory. Original path and remote observations remain local facts. User-defined merge, split, display-name, color, and hidden-state mappings affect derived views only.
- Missing project identity for a child session can inherit through session lineage. Project grouping does not imply agent-scope inheritance.
- Original provider and model names remain stored. A separate alias mapping resolves standard model identity for aggregation and current valuation. Automatic normalization is conservative; unresolved models remain explicit rather than being assigned by broad fuzzy matching.
- The price catalog includes an embedded, versioned LiteLLM-derived snapshot and can optionally ingest selected models.dev data. A user must explicitly initiate network refresh, inspect its source and changes, and confirm application.
- Pricing precedence is explicit user override, user alias/provider configuration, bundled price snapshot, optional supplemental catalog, then unknown. Unknown prices contribute tokens and requests but not cost; aggregates expose cost coverage.
- The pricing data model supports input, output, cache-read, cache-write, reasoning, long-context tiers, cache-duration variants, provider multipliers, and effective dates even if the first UI exposes only the common fields.
- Original valuation records the applied price version, source, USD amount, and exchange-rate context. Current valuation is a separate derived result under current aliases and pricing. Updating the catalog never silently rewrites original valuation.
- When the Ollama Cloud cache scenario applies, every current-cost aggregate uses the same valuation seam and exposes the configured rate, estimated cache-read tokens, method identifier, and the value calculated from reported categories alone. The client labels the primary amount as estimated and shows the latter as the no-cache-detail upper bound.
- USD is the ledger base currency. v0.1 supports an optional user-supplied fixed CNY display rate. It does not fetch exchange rates automatically.
- Monetary values use decimal arithmetic and durable decimal representations. UI rounding is presentation-only; report exports retain unrounded values.
- The host remote API supports overview, heatmap, trend, ranking, request-page, project, session, model, provider, price-coverage, import-status, source-status, export, backup, restore, correction, retention, and settings operations. List operations use cursor pagination and bounded filters suitable for at least one hundred thousand request records and ten thousand sessions.
- The client registers a sidebar footer action and a persistent full-frame shell overlay. The footer action owns open state; the overlay opts into pointer events, manages focus, closes by keyboard, and leaves the underlying conversation state unchanged.
- The wide sidebar can show today's tokens or estimated cost according to a local setting. The narrow sidebar shows only the usage icon.
- The overlay provides overview, requests, projects, sessions, models, providers, pricing, data, and settings views without introducing a URL router. The most recent global time filter, heatmap metric, and ranking mode persist in local settings.
- The overview uses local identity, current profile, five primary metrics, a twelve-month blue activity heatmap, secondary insights, and a switchable ranking. It follows Harness theme and layout variables and does not reproduce Codex branding.
- The primary overview metrics are all-time processing tokens, public-list-price estimate, request count, current active-day streak, and longest active-day streak. Secondary insights include daily peak, longest session, cache hit rate, active projects, estimate ratio, and price coverage.
- An active day contains at least one observable model request, including a failed request. Session detail displays natural elapsed span and estimated active duration; active duration stops accumulating across idle gaps longer than the default thirty-minute threshold.
- The heatmap defaults to processing tokens and supports cost and request count. It uses five quantile-based intensity levels while exposing exact values through hover and keyboard focus.
- Overview all-time metrics, twelve-month heatmap, and thirty-day trends and rankings have independent defaults, with one global time filter available to override applicable views.
- All timestamps are stored as source epoch values and grouped at query time in the configured IANA timezone. The default is system local time and Monday week starts.
- Local identity defaults from local system or Git information, remains editable, and supports initials or an imported local image copied into plugin-owned data. Remote avatar URLs are not supported.
- CSV export supports filtered requests and aggregates. JSON export supports structured reports. Ordinary exports anonymize absolute paths, remotes, and session identifiers by default through a stable export-local identity mapping.
- Complete backup is a separate operation that preserves local identifiers and displays a privacy warning. Restore supports idempotent merge and full replacement; replacement first creates a backup of the current database.
- v0.1 does not invent an encrypted backup format. Users are told to protect complete backup files with their preferred operating-system or archive encryption.
- Import, export, backup, restore, migration, and cleanup jobs expose status and progress. Long jobs can be canceled at safe transaction points and do not block the Web application or active sessions.
- No telemetry is emitted. Default operation makes no network requests. Future webhook, online exchange rate, and synchronization features must remain opt-in.
- The bundle exposes startup diagnostics for missing Harness services, unsupported runtime capabilities, unsupported database versions, import failures, and price-source failures. Each dashboard module has an independent loading, empty, partial, error, and retry state.
- The distribution package is ESM, exports host, client, bundle patch, and package metadata faces, and ships only documented runtime artifacts, bilingual documentation, license, and installer.
- The installer defaults to the Web profile and supports no-argument install plus install, status, uninstall, profile, source, and help operations. Its default source is the fixed v0.1.0 Git tag for the public repository; a plugin-specific environment variable and source option support local linked development.
- Installer writes are idempotent and atomic. It changes only the target dependency and profile bundle list, runs dependency installation with lifecycle scripts disabled, and restores the original manifest when installation fails.
- Uninstall removes only the manifest dependency and bundle entry. It does not delete ledger data, stop Harness, restart Harness, or signal the running process.
- The initial local release is prepared and verified through a linked source. Remote repository creation, push, tag, release, and topic configuration require a separate explicit human approval after local evidence is reviewed.

## Testing Decisions

- Tests assert externally observable ledger, query, export, installer, and client-loading behavior rather than private SQL statements, helper call order, or component implementation details.
- The primary and highest test seam is the assembled host usage ledger through its public remote/query surface. Tests provide a temporary profile, a temporary SQLite database, and synthetic durable session events through a controlled persistence provider, then assert the same aggregates and pages the client consumes.
- Historical import and live capture use the same assembled seam. Tests overlap an import with live delivery, repeat both operations, simulate a missed live event, reconcile from the durable sequence, and prove stable totals.
- Synthetic fixtures cover a normal one-step turn, a multi-step turn, repeated usage samples for one step, a usage-less failure, an interrupted turn, a max-token ending, cache reads, cache writes, reasoning tokens, missing prices, and estimation. Fixtures contain no real prompt or response from a user session.
- Fork fixtures contain a physically copied parent prefix and multiple constructor-seed markers. Tests prove that only events after the final seed boundary count as fork-owned usage and that inherited context can still be queried separately.
- Subagent fixtures use independent child sessions and parent lineage. Tests prove direct and lineage-inclusive totals, child project inheritance, and no duplication in the parent.
- Compaction fixtures include summary, prune, checkpoint, end, and surface replacement events. Tests prove that compaction does not create or remove usage and that log sequence, not visible surface order, drives processing.
- Recovery and revision fixtures prove that appended synthetic closers do not duplicate usage, changed revisions trigger incremental reads, unchanged revisions do not rescan event bodies, and disappeared sessions become source-deleted rather than being removed.
- Token tests prove the definitions of processing tokens and new-compute tokens, prove that reasoning is not added twice, and prove exact and estimated aggregates and ratios.
- Privacy tests observe every plugin-owned durable record, log entry, ordinary export, and diagnostic export produced from fixtures containing sentinel prompt, response, tool-argument, and credential strings. The sentinel strings must not cross those observable outputs.
- Project tests cover Git identity, working-directory fallback, path normalization, child-lineage fallback, manual merge, split, rename, hide, and preservation of source facts.
- Time tests cover system-local default, explicit IANA zones, UTC source storage, daylight-saving transitions, Monday week boundaries, active-day streaks, natural span, and active duration with idle cutoff.
- Pricing tests cover precedence, versioned snapshots, exact model lookup, aliases, provider multipliers, cache prices, long-context tiers, effective dates, unknown prices, cost coverage, fixed CNY display rate, decimal precision, immutable original valuation, and current-rule revaluation.
- Correction and retention tests prove append-only correction history, reversible exclusion, request-detail purge, retained anonymous aggregates, explicit source-deleted cleanup, and no silent deletion.
- Export tests cover filtered request CSV, aggregate CSV, report JSON, default anonymization, explicit complete identifiers, decimal precision, timezone metadata, and cancellation.
- Backup tests cover deterministic validation, idempotent merge, conflict handling that preserves source facts, replacement with automatic pre-backup, unsupported versions, malformed input, and interrupted restore rollback.
- Migration tests begin from every supported schema fixture, verify transactional success, verify rollback on injected failure, verify pre-migration backup, and verify that a newer schema cannot be opened for writes.
- Corruption tests verify that ledger writes stop, Harness-facing plugin startup remains contained, the original database remains untouched, read-only diagnostics are attempted, and recovery choices are reported.
- Query tests exercise filters, sorting, cursor pagination, aggregate consistency, independent module failure, and a data volume representative of one hundred thousand calls and ten thousand sessions.
- The client artifact test loads the packaged lazy client module through the same module-loader protocol expected by Harness and verifies registration of the sidebar action, overlay, remote contribution, and required injected services.
- Client behavior tests cover open and close, preserved conversation state, wide and narrow sidebar rendering, keyboard dismissal, focus restoration, loading and error states, persisted filters, locale switching, theme variables, and accessible names.
- The existing `dsh-attention` host, client-bundle, and installer tests are prior art for separating host behavior, packaged client loading, and temporary-profile installer behavior. The existing `dsh-visualization` client-artifact and interaction tests are prior art for packaged Web artifacts and interaction assertions. The existing `dsh-subscription-search` usage and installer tests are prior art for local usage data services and release installation behavior.
- Installer tests run against temporary Harness homes and cover first install, repeated install, status when complete, status when partially configured, uninstall, repeated uninstall, non-default profile, explicit source, environment source, help, missing option values, unknown arguments, malformed manifests, missing profiles, dependency-install failure, rollback, atomic-write cleanup, missing pnpm with corepack fallback, and failure of both package-manager paths.
- Package tests validate the export map, bundle metadata, client inject list, fixed release source, file allowlist, executable installer, and absence of undeclared runtime files.
- Runtime compatibility tests cover supported Node 22 and 24 environments where feasible and always cover the capability-diagnostic path when built-in SQLite is unavailable.
- Local release evidence includes focused tests, the package check command, package dry-run, diff hygiene, and a temporary-profile linked-source install/status/uninstall cycle.
- Browser acceptance uses the existing Harness Web GUI after the user manually restarts DSH. It verifies the real sidebar entry, overlay navigation, historical import, live update, filters, exports, theme and locale behavior, Console errors, network requests, and a basic Lighthouse accessibility and best-practices audit.
- The agent never stops, restarts, replaces, signals, or kills the DSH process during testing. Verification that requires bundle activation pauses until the user confirms a manual restart.

## Out of Scope

- Importing Claude Code, Codex CLI, Gemini CLI, OpenCode, or any non-Harness session format.
- Cross-profile aggregation in v0.1; each installed profile owns its own ledger.
- Cross-device synchronization, cloud storage, shared team dashboards, cloud rankings, or telemetry.
- Budget enforcement, budget alerts, native operating-system alerts, Webhooks, or automated external notifications in v0.1. The ledger may preserve fields needed by a later budget feature.
- Agent, skill, tool, or plugin attribution and rankings in v0.1.
- Automatic online exchange rates or historical foreign-exchange feeds.
- Encrypted backup design, password management, or key recovery.
- Provider invoice import, subscription quota tracking, payment reconciliation, discounts inferred from bills, or claims about actual paid cost.
- Guessing provider-internal retries or charges not represented by durable Harness events.
- Capturing, storing, searching, exporting, or rendering prompts, responses, request bodies, tool arguments, or credentials.
- Modifying Harness source, patching installed Harness packages, replacing the existing conversation UI, or adding a URL router.
- Supporting Node versions outside the Harness-supported Node 22 and 24 lines through a second SQLite implementation.
- Optimizing for million-call or distributed-database scale in v0.1.
- Password-protected share links, remote avatars, or remotely hosted profile identity.
- Automatic deletion of ledger data during bundle uninstall.
- Remote GitHub publication before the separate post-validation approval.

## Further Notes

- Canonical Harness vocabulary is used throughout: a profile composes bundles; the durable `SessionEvent` log is the source of truth; a turn contains zero or more steps; one step represents one observable model request plus its resulting tool work; lineage is parent/child data and does not imply agent-scope inheritance.
- Plugin-specific vocabulary:
  - **Usage ledger**: the profile-private durable projection of observable model calls, token facts, attribution, valuations, and audit records.
  - **Usage sample**: a provider-reported or estimated token observation for one step.
  - **Observable model call**: one distinct session, turn, and step represented in the durable log.
  - **Inherited usage**: usage events physically copied into a fork or resume seed; visible for context but excluded from new usage totals.
  - **Original valuation**: immutable cost calculated under the price and exchange-rate version applied when the ledger first valued the usage fact.
  - **Current valuation**: derived cost under current aliases, price rules, multipliers, and display exchange rate.
  - **Processing tokens**: uncached input plus output plus cache-read plus cache-write tokens.
  - **New-compute tokens**: uncached input plus output tokens.
  - **Cost coverage**: the fraction of included usage for which a matching price exists.
  - **Source-deleted**: a ledger record whose originating durable session is no longer present in a configured source.
- The visual reference guides information hierarchy, not branding or pixel copying. The plugin uses Harness theme variables, typography, locale, slots, and interaction conventions.
- The intended public installation command uses a fixed semantic-version tag. Documentation must not recommend a floating branch or `latest` source.
- The installer is a distribution tool, not a process manager or data-removal tool.
- The current implementation target is Harness 0.1.1-rc.2, with capability checks used to detect compatible future builds. The project must not claim unverified compatibility.
- The target GitHub repository and issue tracker do not yet exist. This specification is therefore the publication-ready issue body, but remote repository creation and issue publication remain intentionally blocked by the previously agreed requirement for separate approval after local validation. When the tracker exists, create `ready-for-agent` with description `Specification is complete and ready for implementation by an agent` and color `#0E8A16`, publish this spec as one issue, and apply only that triage label.
