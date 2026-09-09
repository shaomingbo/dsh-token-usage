# DSH Accounts & Usage

`dsh-token-usage` keeps the package name and local ledger. **5.1.4 is an unreleased preparation candidate** combining governance, the Antigravity quota-surface hotfix and the OAuth lifecycle correction. No telemetry, prompt storage, DSH core patches or new data migration. The fixed-tag commands below are for use only after the corresponding tag has actually been published and verified.

## 5.1.4 candidate scope and evidence

Settings reads local connection facts independently of analytics and quota refresh. Stored raw keys remain configured-unverified. Antigravity quota/catalog reads prefer daily → prod → sandbox; an explicit baseUrl stays pinned, and generation/project discovery are unchanged.

Subscription login supports pending-login and explicit cancellation before or after challenge delivery. Closing a panel does not cancel Host authorization; reopening reattaches the same operation, without late popups or stale UI updates. The input candidate passed **311 account tests**, **27 paired Compaction R2 tests** (one optional real-time test skipped), and authorized **Grok** close/reopen, early/waiting cancel and successful-device-binding checks in an isolated Lab. This is not proof of every provider's OAuth, every failure mode, or a future tag's installation. The tested Compaction R2 is a 0.3.2-versioned source snapshot, not a claim that the published 0.3.2 tag contains its later replay fixes.

The native `codex-runtime/v1` seam, 1800s ordinary / 120s setup / 300s compaction budgets, SDK pins and data identity are unchanged. This preparation additionally clears the local card when a reattached login finishes failed/cancelled, with two offline regressions; these terminal cases were not repeated against a real provider. Apart from that local UI cleanup, runtime code is preserved from the tested input; release version/documentation are a separate delta. Final commit/tag, artifact and production acceptance remain pending.

## Historical 5.1.3 ordinary-generation deadline correction

Pair this release with `dsh-codex-compaction` 0.3.2. Ordinary native replay no longer
uses a 120-second total generation cap: production `open()` has an absolute **1800-second**
lease, including preparation, and a separate **120-second** model/readiness/authentication
setup limit that is removed on successful binding. The companion uses the published
PiAiAdapter **300-second idle watchdog** for text, reasoning and tool-argument output.
Network keepalives do not count as model output. Output re-arms idle waiting, never the
owner's absolute deadline. Consumers of the owner capability without the companion's
converter get the owner deadline, not an implicit second idle watchdog.

Explicit native compaction remains **300 seconds total**, including all recovery attempts;
its converter remains 300 seconds as well. No retries, fallback requests, provider creation,
or account switches reset an existing lease. Caller cancellation and first stop reasons
remain authoritative; credentials and the v1 checkpoint format are unchanged.

The trusted owner factory retains `timeoutMs` as a total-budget option (default 30000ms,
maximum 1800000ms), adds `setupTimeoutMs` (default `min(timeoutMs,120000)`, maximum 120000ms),
and defaults `compactionTimeoutMs` to `min(timeoutMs,300000)` rather than widening compaction
implicitly. Ordinary setup and metadata-only applicability use the smaller setup/total budget.
No arbitrary timeout option is added to the public `open()` capability or model tools.
Optional diagnostics retain `budgetMs` and add `totalBudgetMs`, `setupBudgetMs`,
`timeoutBudgetMs` and `timeoutKind: setup|total`; fields absent in older owners remain absent.
Owner expiration remains `CODEX_RUNTIME_TIMEOUT`; the companion reports a fixed idle-timeout
message with code `TIMEOUT`, without exposing raw SDK diagnostics. Old v1 owners/readers stay
compatible but do not acquire the new budgets merely by updating one side.

Local tests, immutable release identity, tag installation and original-GUI acceptance are
recorded separately; the contract alone does not establish live acceptance. Finite budgets do not guarantee completion of arbitrary model requests.

## Historical 5.1.2 native-runtime correction

Native SSE completes at a valid `response.completed`/`response.done` with one valid compaction
item, without waiting for HTTP EOF; later bytes are not interpreted. Premature EOF (including
truncated frames) or socket-read failure is recoverable `CODEX_RUNTIME_RESPONSE_STREAM`;
malformed native responses are non-retryable `CODEX_RUNTIME_RESPONSE_PROTOCOL`.
The first lease stop cause (TIMEOUT/CANCELLED/CLOSED/DISPOSED) survives subsequent handle use.
Explicit compaction opens get 300 seconds while ordinary requests stay at 120 seconds. The
companion's native converter also gets 300 seconds; replay/text converters retain 120 seconds.
Neither provider creation nor recovery renews the original lease. Optional `diagnostics()`
returns fixed fields/enums and numeric timings/counts, including `budgetMs` and `eventCounts`,
never raw event names, content, account identifiers or credentials.

The runtime adds no automatic retries, new login or checkpoint format. The companion owns
one extra same-lease request: native retry OR allowlisted text fallback, never both; no account
switch or deadline renewal. Terminal failures suppress new taken-over compaction requests for
60 seconds per session/provider/model, without pausing ordinary generation. Native-to-text
fallback is this plugin pair's policy, not an official Codex behavior claim.

An authorized real run used a 300000ms budget, completed in 157372ms with one request and a
valid item plus completed event, and produced a new official Basic history replacement with
approximately 146849 tokens shadowed. The maintainer read summary/user-message/end and
successful command/done from the disk journal. This is evidence for that run, not fsync,
crash recovery, lossless recall or a cure for every timeout. The maintainer reran the frozen
production candidate: 498 tests passed (plugin 135 + legacy-A 46 + comparison 34 + account 266 +
paired 17). Final packaging checks and release-tag installation are separate steps.
See [the detailed evidence and historical stages](docs/research/codex-runtime-v1.md).

**Known non-blocking limitation:** cancellation may display `CODEX_RUNTIME_ERROR` in the
compaction status. Refreshing can cancel a pending manual command; tab switching alone has
not been shown to cancel it. Persistent upstream failures and hard context limits remain.

## Install (after the tag exists)

```sh
npx --yes --ignore-scripts github:shaomingbo/dsh-token-usage#v5.1.4
```

This installs into the `web` profile. Restart DSH yourself and hard-refresh the existing Web GUI; the installer never controls the DSH process.

```sh
npx --yes --ignore-scripts github:shaomingbo/dsh-token-usage#v5.1.4 status
npx --yes --ignore-scripts github:shaomingbo/dsh-token-usage#v5.1.4 uninstall
npx --yes --ignore-scripts github:shaomingbo/dsh-token-usage#v5.1.4 --profile web --source link:<local-path>
npx --yes --ignore-scripts github:shaomingbo/dsh-token-usage#v5.1.4 --help
```

`--profile` defaults to `web`. `--source` defaults to the version-derived fixed `v5.1.4` tag and may also be set with `DSH_TOKEN_USAGE_SOURCE`. The installer requires `dsh` `0.1.2-rc.1` or `0.1.2-alpha.3` on PATH and delegates every mutation to the public `dsh plugin` CLI with `--ignore-scripts`; it verifies manifest postconditions and reports failures honestly — rc.1 does not promise rollback. If `dsh` is missing, is a different version, or the plugin command fails, the installer fails closed with guidance; there is no direct-manifest fallback.

### Local development

```sh
node bin/install.js --source link:$PWD
```

Only this installer's own fixed version tag or an explicit `link:<local-path>` is accepted; other version tags and floating sources are rejected. Local source changes require the applicable build and a user-performed restart/refresh; linking alone is not a hot-reload guarantee.

## Account lifecycle (v5)

The interaction is one journey: sidebar entry → dock → overview → per-account insight.

- **Zero-config accounts:** every configured connection (ChatGPT/Codex, Grok, each Antigravity account, GLM, Ollama Local/Cloud) becomes an `account_products` row with default attribution rules the moment it appears. The Antigravity proxy carries the final connection after quota failover in a versioned OpenAI response identifier; the ledger recovers it from stock DSH pi-ai replay metadata without a DSH source patch. Archived accounts are never resurrected.
- **Official-first meters:** CodexBar-style percent bars per window (primary 5h, weekly, daily, term) with reset countdowns, source badges (`official API`, `official page (brittle)`, `local ledger`, `user estimate`) and observed-at timestamps. The ledger never converts official percentages into token guesses; credits/percent limits stay official-observed only.
- **Simple configuration:** a host-side product-template catalog (`lib/accounts/templates.json`, seeded into `provider_templates`) pre-fills windows, exact values (GLM plan credits, Aliyun request caps, Gemini daily requests) and provider aliases. The wizard suggests accounts from observed ledger traffic; an advanced form still covers custom quotas, prices, balances and rules.
- **Honest local half:** each account's DSH-observed usage (equivalent $, new-compute tokens, requests, model table, 30-day trend) with average-rate extrapolation explicitly labeled as arithmetic, never as a forecast.
- **Deprecated:** the v5 billing-pool form is retired from the UI. `plans`/`plan_rules` remain readable and keep working through the lossless projection; `save-plan` RPCs stay available but report `deprecated`.

### Unreleased candidate work (P1-B / P1-C + governance round 2)

> These governance changes are included in the **unreleased 5.1.4 preparation candidate**, together with the Antigravity hotfix and the later OAuth correction. They are **not** part of the published `v5.1.3` tag (`dddb7f2b`). The commands above target the future 5.1.4 tag, not an already verified release. Existing native-runtime code and budgets remain unchanged; version metadata and documentation are updated separately. `ACCOUNT-R2-REPORT.md` and `ACCOUNT-R3-REPORT.md` retain historical working-tree evidence only (not packaged); neither alone establishes the latest OAuth or release gate.

### Lifecycle ownership (P1-B)

Account authorization state, provider/model capabilities, and the `codex-runtime/v1` native capability are owned by the account lifecycle; the analytics usage store is a separate lifecycle scope inside the same package. Analytics mount, failure, stop, and cleanup never unregister capabilities, never cancel in-flight native runs, and never rewrite account rows; only the Host dispose of this bundle ends both scopes (canceling native leases, closing the store, releasing capability owners, in that order). Account facts remain visible while analytics is degraded: the `/account-usage` `connections` endpoint is strictly read-only — local connection status, cached model catalogs, adapter and proxy state — and never touches the usage store, creates accounts, or starts a quota network refresh. `summary` keeps its overlay duties (zero-config account pass plus the observation-cadence anchor). The provided `accountUsage` service exposes only `list`/`observe`/`observations`; no RPC or service method may stop either lifecycle, and unmounting the analytics UI ends neither. See `ACCOUNT-R2-REPORT.md` in the repository root for the working-tree evidence (not part of the published package).

### Accounts & Models settings section (P1-C, unreleased candidate)

A native `settings.section` slot entry ("Accounts & Models") surfaces provider connections outside the analytics overlay. Its only automatic data source is the read-only `connections` RPC: local connection facts, cached model catalogs and proxy state — it never loads the usage statistics channel, never mounts the dashboard, and never triggers a quota refresh, model sync or login by itself. Refreshing the facts is an explicit action. Expanding a connection opens the same `ConnectionSection` controls used by the account insight, but in facts mode (C-001 fix): the expanded panel reads and reloads the very same read-only `connections` payload as the list, so expanding, switching or refreshing a row — and every explicit sign-in, credential or model-sync action — never calls the analytics `summary`, creates accounts or starts an observation, and the management controls stay fully usable even when the statistics store is broken. No second OAuth, key or model-sync implementation exists; the account insight keeps its own summary-based strategy. Connections are keyed by stable `providerId` + `connectionId`; stored API keys or quota cookies read as "Configured · no official check", never as a verified connection. Closing the page or switching views stops the local device-login wait without canceling the host authorization; the explicit cancel button remains the only path that cancels it, and reopening reattaches through the non-destructive pending-login query. See `ACCOUNT-R2-REPORT.md` in the repository root (not part of the published package).

### Governance round 3 integration + Antigravity quota hotfix (unreleased candidate)

This tree integrates the governance round-2 candidate above on top of the Antigravity allowance-read hotfix (commit `44125a55`: `lib/capabilities/antigravity/antigravity-api.js` and `lib/capabilities/antigravity/usage.js` answer quota/catalog reads from the daily→prod→sandbox surfaces, with a new `test/antigravity-quota.test.js`; generation and project discovery are unchanged). Neither the round-2 candidate nor this hotfix is part of the published `v5.1.3` tag. Integration evidence and 5.1.3-preservation checks: see `ACCOUNT-R3-REPORT.md` in the repository root (not part of the published package).

## Product model

See [`CONTEXT.md`](CONTEXT.md) for the canonical language: Connection, Credential, Product, Billing, Limit, Observation, Usage Ledger, and Attribution Rule.

- **Provider connections:** ChatGPT and Grok OAuth capabilities retain `<DSH_HOME>/.oauth.json`; Antigravity retains `<DSH_HOME>/.antigravity-auth.json`, multi-account activation, auto-failover, model route, and loopback proxy behavior. The UI starts OAuth/device authorization, supports Antigravity activation/removal, and imports GLM/Ollama API credentials through DSH Credentials. GLM, Ollama Local, and Ollama Cloud use the same internal provider-adapter seam.
- **Official observations:** provider-reported product, billing, allowance percentages, and resets are shown separately from local history. Limit values represent exact, range, dynamic, unpublished, or manual knowledge across rolling, fixed, billing-cycle, or rate windows. Each connection keeps only its newest 1,000 stored observations (a few days) — the latest usable one is always retained, so a window-less reachability probe can never mask it — and the account page lists just the most recent 200.
- **Local usage ledger:** the existing `usage.sqlite`, request folding, project attribution, valuation, imports, corrections, exports, backups, retention, and `/token-usage` compatibility channel remain. Request facts retain optional provider connection provenance; exact connection rules outrank provider/model fallbacks, while unstamped historical rows remain unassigned unless an explicit fallback rule matches. It is a DSH-observed ledger, not a provider invoice.
- **Compatibility:** `/account-usage` is the unified loopback channel. `/token-usage` and `/subscription-antigravity` remain for the 4.x transition. When `dsh-subscription-search` is co-installed, it retains exclusive ownership of `/subscription-search`; this bundle registers only its callable ChatGPT/Grok backends through `searchChain` to avoid dual ownership.
- **Optional search-chain capability:** when the host exposes `searchChain`, ChatGPT/Grok may be registered as callable backends without returning credentials to callers. Search orchestration itself is not part of this package.

## Ollama behavior

Ollama Local has no applicable remote quota. Saving an Ollama Cloud API key synchronizes the official `/api/tags` catalog, enriches each completion model through `/api/show`, and provisions the `ollama-cloud` route against the official OpenAI-compatible `https://ollama.com/v1` endpoint. Context capacity, vision input, and thinking levels come from the official model-details response; output capacity is written only when `num_predict` is explicitly present. A manual sync control refreshes additions and removals without restarting DSH. No dedicated official quota endpoint is claimed, so configured key status remains labeled unverified. Settings-page allowance scraping is a separate explicit opt-in: the user manually pastes a Cookie header; only allowlisted Ollama session-cookie names are retained in the owner-only store. The plugin never reads Chrome or another browser profile, refuses redirects so credentials cannot cross origins, and labels parsed plan/session-hourly/weekly observations `official_ui` and `brittle`.

Ollama Cloud Chat Completions currently do not provide reliable cached-token usage. The plugin therefore defaults to an adjustable **95% cache-hit scenario** for current public-list-price revaluation of `ollama-cloud` only. It never rewrites input/cache ledger facts and also exposes the value calculated from reported categories alone as the no-cache-detail upper bound. Ollama Local and other providers are not affected. Explicitly reported cache data—including a reported zero—wins as soon as DSH preserves that distinction; legacy rows are marked `unknown` because older ingestion lost field presence. This remains an estimate, not an Ollama invoice or charged amount.

## Privacy and requests

Secrets live only in owner-only files or DSH credentials. SQLite, plugin-owned RPC responses, logs, diagnostics, and exports contain no access token, refresh token, API key, Authorization header, Cookie header, or session-cookie value. RPC channels are loopback-only. Ordinary ledger operation makes no network requests; price updates and provider observation refreshes are explicit. Auth refresh and configured model routes contact only their provider endpoints as required. Redirects carrying credentials are rejected and provider origins are allowlisted.

Prompts, responses, request bodies, and tool arguments are never persisted by this plugin. Ordinary exports anonymize local identifiers by default. Complete backups remain private and uninstall keeps all data.

## Data and migration

The existing path is unchanged:

`<DSH_HOME>/profiles/<profile>/data/dsh-token-usage/`

Linked development still falls back to `<DSH_HOME>/dsh-token-usage/`. Schema v8 additively records nullable request `connection_id` provenance without backfilling history; schema v9 records cache-field presence as `reported`, `absent`, or legacy `unknown` without rewriting token values. The legacy ledger, `plans`, and `plan_rules` remain, and v5 plans are projected losslessly. Pool attribution reads `account_attribution_rules`. Existing files are backed up before transactional migration. Newer schemas refuse normal writes and have a separate read-only diagnostic seam.

## Development

```sh
pnpm install --frozen-lockfile --ignore-scripts
npm run check
npm pack --dry-run --ignore-scripts
```

`npm run bench:v2` is a development-only analytics benchmark and is not published with the package.

Tests use synthetic data and temporary `DSH_HOME` directories. The native capability's tested composition targets stock DSH `0.1.2-rc.1` on Node 24.18.0/macOS arm64; lower Node versions were not rerun. The installer retains exactly its existing CLI support for `0.1.2-alpha.3` and `0.1.2-rc.1`, rejecting other versions; final-candidate temporary-home install/`--dump-config` checks on both are maintainer release gates. The live acceptance environment had an alpha.3 launcher but actual Web/Basic dependencies at rc.1: this mixed environment is not proof of full native-runtime compatibility on pure alpha.3. The paired compaction package publicly supports rc.1 only; no broader range is claimed.

## Codex native capability (5.1.2)

This version retains the owner-bound `codex-runtime/v1` capability introduced in 5.1.0
and adds the recovery correction for the paired `dsh-codex-compaction` 0.3.1 release:
native compaction/replay through the
existing ChatGPT connection, with OAuth values kept inside the account owner and
no second login or credential store. Custom models (e.g. `gpt-6-astra`) resolve
only through the trusted model-facts seam reading public host-configured profile
fields; missing or conflicting metadata reports fixed-vocabulary gaps instead of
invented values. The published 5.0.24 artifact must not be assumed to contain
this interface, and the fixed tags are assumed only after the maintainer has
actually pushed and verified them; the historical RC tags (`5.1.0-rc.1`,
`5.1.0-rc.2`) are retained.

If this checkout's `node_modules` points at a live DSH profile, do not install
dependencies there. Validate the paired checkout with the compaction project's
`npm run test:accounts-integration -- <isolated-account-source>`, which builds a temporary source/dependency
snapshot instead. See [the capability contract and isolated validation notes](docs/research/codex-runtime-v1.md).

## License

[MIT](LICENSE)
