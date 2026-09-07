# DSH Accounts & Usage

`dsh-token-usage` 5.x keeps the package name and existing local ledger while making the account the single unit of the whole interaction: every configured connection becomes an account automatically, official allowance windows lead the meters, and the local ledger stays a clearly labeled complementary view. No telemetry, prompt storage, or DSH source patches. The `5.1.0` stable release adds the owner-bound `codex-runtime/v1` capability (see below); the fixed tag is assumed only after the maintainer has actually pushed and verified it, and the historical RC tags (`5.1.0-rc.1`, `5.1.0-rc.2`) are retained.

## Install

```sh
npx --yes github:shaomingbo/dsh-token-usage#v5.1.0
```

This installs into the `web` profile. Restart DSH yourself and hard-refresh the existing Web GUI; the installer never controls the DSH process.

```sh
npx --yes github:shaomingbo/dsh-token-usage#v5.1.0 status
npx --yes github:shaomingbo/dsh-token-usage#v5.1.0 uninstall
npx --yes github:shaomingbo/dsh-token-usage#v5.1.0 --profile web --source github:shaomingbo/dsh-token-usage#v5.1.0
npx --yes github:shaomingbo/dsh-token-usage#v5.1.0 --help
```

`--profile` defaults to `web`. `--source` defaults to the version-derived fixed `v5.1.0` tag and may also be set with `DSH_TOKEN_USAGE_SOURCE`. The installer requires exactly `dsh` `0.1.2-rc.1` on PATH and delegates every mutation to the public `dsh plugin` CLI with `--ignore-scripts`; it verifies manifest postconditions and reports failures honestly — rc.1 does not promise rollback. If `dsh` is missing, is a different version, or the plugin command fails, the installer fails closed with guidance; there is no direct-manifest fallback.

### Local development

```sh
node bin/install.js --source link:$PWD
```

Only the fixed release source or an explicit `link:<local-path>` is accepted; floating sources are rejected.

## Account lifecycle (v5)

The interaction is one journey: sidebar entry → dock → overview → per-account insight.

- **Zero-config accounts:** every configured connection (ChatGPT/Codex, Grok, each Antigravity account, GLM, Ollama Local/Cloud) becomes an `account_products` row with default attribution rules the moment it appears. The Antigravity proxy carries the final connection after quota failover in a versioned OpenAI response identifier; the ledger recovers it from stock DSH pi-ai replay metadata without a DSH source patch. Archived accounts are never resurrected.
- **Official-first meters:** CodexBar-style percent bars per window (primary 5h, weekly, daily, term) with reset countdowns, source badges (`official API`, `official page (brittle)`, `local ledger`, `user estimate`) and observed-at timestamps. The ledger never converts official percentages into token guesses; credits/percent limits stay official-observed only.
- **Simple configuration:** a host-side product-template catalog (`lib/accounts/templates.json`, seeded into `provider_templates`) pre-fills windows, exact values (GLM plan credits, Aliyun request caps, Gemini daily requests) and provider aliases. The wizard suggests accounts from observed ledger traffic; an advanced form still covers custom quotas, prices, balances and rules.
- **Honest local half:** each account's DSH-observed usage (equivalent $, new-compute tokens, requests, model table, 30-day trend) with average-rate extrapolation explicitly labeled as arithmetic, never as a forecast.
- **Deprecated:** the v5 billing-pool form is retired from the UI. `plans`/`plan_rules` remain readable and keep working through the lossless projection; `save-plan` RPCs stay available but report `deprecated`.

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

Tests use synthetic data and temporary `DSH_HOME` directories. This release was verified against stock DSH `0.1.2-rc.1` on Node 24.18.0/macOS arm64; lower Node versions were not rerun for the new native capability; the installer refuses other `dsh` CLI versions. Earlier-version compatibility conclusions from previous releases do not carry over to this package, and no broader compatibility is claimed.

## Codex native capability (5.1.0 stable)

This version ships the owner-bound `codex-runtime/v1` capability for the paired
`dsh-codex-compaction` 0.3.0 stable release: native compaction/replay through the
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
