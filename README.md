# DSH Accounts & Usage

`dsh-token-usage` 5.0.0 keeps the package name and existing local ledger while making the account the single unit of the whole interaction: every configured connection becomes an account automatically, official allowance windows lead the meters, and the local ledger stays a clearly labeled complementary view. No telemetry, prompt storage, or DSH source patches.

## Install

```sh
npx --yes github:shaomingbo/dsh-token-usage#v5.0.9
```

This installs into the `web` profile. Restart DSH yourself and hard-refresh the existing Web GUI; the installer never controls the DSH process.

```sh
npx --yes github:shaomingbo/dsh-token-usage#v5.0.9 status
npx --yes github:shaomingbo/dsh-token-usage#v5.0.9 uninstall
npx --yes github:shaomingbo/dsh-token-usage#v5.0.9 --profile web --source github:shaomingbo/dsh-token-usage#v5.0.9
npx --yes github:shaomingbo/dsh-token-usage#v5.0.9 --help
```

`--profile` defaults to `web`. `--source` defaults to the fixed `v4.2.0` tag and may also be set with `DSH_TOKEN_USAGE_SOURCE`.

### Local development

```sh
npx --yes github:shaomingbo/dsh-token-usage#v5.0.9 --source link:$PWD
```

The installer atomically changes only `dependencies["dsh-token-usage"]` and `dsh.profile.bundles`, runs `pnpm install --ignore-scripts` (with the documented corepack fallback), and restores the manifest if installation fails. Manual editing of those same two fields is a fallback, not the preferred installation path.

## Account lifecycle (v5)

The interaction is one journey: sidebar entry → dock → overview → per-account insight.

- **Zero-config accounts:** every configured connection (ChatGPT/Codex, Grok, each Antigravity account, GLM, Ollama Local/Cloud) becomes an `account_products` row with default attribution rules the moment it appears. Archived accounts are never resurrected.
- **Official-first meters:** CodexBar-style percent bars per window (primary 5h, weekly, daily, term) with reset countdowns, source badges (`official API`, `official page (brittle)`, `local ledger`, `user estimate`) and observed-at timestamps. The ledger never converts official percentages into token guesses; credits/percent limits stay official-observed only.
- **Simple configuration:** a host-side product-template catalog (`lib/accounts/templates.json`, seeded into `provider_templates`) pre-fills windows, exact values (GLM plan credits, Aliyun request caps, Gemini daily requests) and provider aliases. The wizard suggests accounts from observed ledger traffic; an advanced form still covers custom quotas, prices, balances and rules.
- **Honest local half:** each account's DSH-observed usage (equivalent $, new-compute tokens, requests, model table, 30-day trend) with average-rate extrapolation explicitly labeled as arithmetic, never as a forecast.
- **Deprecated:** the v5 billing-pool form is retired from the UI. `plans`/`plan_rules` remain readable and keep working through the lossless projection; `save-plan` RPCs stay available but report `deprecated`.

## Product model

See [`CONTEXT.md`](CONTEXT.md) for the canonical language: Connection, Credential, Product, Billing, Limit, Observation, Usage Ledger, and Attribution Rule.

- **Provider connections:** ChatGPT and Grok OAuth capabilities retain `<DSH_HOME>/.oauth.json`; Antigravity retains `<DSH_HOME>/.antigravity-auth.json`, multi-account activation, auto-failover, model route, and loopback proxy behavior. The UI starts OAuth/device authorization, supports Antigravity activation/removal, and imports GLM/Ollama API credentials through DSH Credentials. GLM, Ollama Local, and Ollama Cloud use the same internal provider-adapter seam.
- **Official observations:** provider-reported product, billing, allowance percentages, and resets are shown separately from local history. Limit values represent exact, range, dynamic, unpublished, or manual knowledge across rolling, fixed, billing-cycle, or rate windows.
- **Local usage ledger:** the existing `usage.sqlite`, request folding, project attribution, valuation, imports, corrections, exports, backups, retention, and `/token-usage` compatibility channel remain. It is a DSH-observed ledger, not a provider invoice.
- **Compatibility:** `/account-usage` is the unified loopback channel. `/token-usage` and `/subscription-antigravity` remain for the 4.x transition. When `dsh-subscription-search` is co-installed, it retains exclusive ownership of `/subscription-search`; this bundle registers only its callable ChatGPT/Grok backends through `searchChain` to avoid dual ownership.
- **Optional search-chain capability:** when the host exposes `searchChain`, ChatGPT/Grok may be registered as callable backends without returning credentials to callers. Search orchestration itself is not part of this package.

## Ollama behavior

Ollama Local has no applicable remote quota. Saving an Ollama Cloud API key synchronizes the official `/api/tags` catalog, enriches each completion model through `/api/show`, and provisions the `ollama-cloud` route against the official OpenAI-compatible `https://ollama.com/v1` endpoint. Context capacity, vision input, and thinking levels come from the official model-details response; output capacity is written only when `num_predict` is explicitly present. A manual sync control refreshes additions and removals without restarting DSH. No dedicated official quota endpoint is claimed, so configured key status remains labeled unverified. Settings-page allowance scraping is a separate explicit opt-in: the user manually pastes a Cookie header; only allowlisted Ollama session-cookie names are retained in the owner-only store. The plugin never reads Chrome or another browser profile, refuses redirects so credentials cannot cross origins, and labels parsed plan/session-hourly/weekly observations `official_ui` and `brittle`.

## Privacy and requests

Secrets live only in owner-only files or DSH credentials. SQLite, plugin-owned RPC responses, logs, diagnostics, and exports contain no access token, refresh token, API key, Authorization header, Cookie header, or session-cookie value. RPC channels are loopback-only. Ordinary ledger operation makes no network requests; price updates and provider observation refreshes are explicit. Auth refresh and configured model routes contact only their provider endpoints as required. Redirects carrying credentials are rejected and provider origins are allowlisted.

Prompts, responses, request bodies, and tool arguments are never persisted by this plugin. Ordinary exports anonymize local identifiers by default. Complete backups remain private and uninstall keeps all data.

## Data and migration

The existing path is unchanged:

`<DSH_HOME>/profiles/<profile>/data/dsh-token-usage/`

Linked development still falls back to `<DSH_HOME>/dsh-token-usage/`. Schema v7 is additive: legacy ledger, `plans`, and `plan_rules` tables remain; v5 plans and both quota windows are projected losslessly as manual estimates that stay authoritative for their projected copies, and account products gain `color`/`connection_id` columns. Pool attribution now reads `account_attribution_rules` (seeded by the projection for legacy plans). Existing files are backed up before transactional migration. Newer schemas refuse normal writes and have a separate read-only diagnostic seam.

## Development

```sh
pnpm install
npm run check
npm pack --dry-run
```

Tests use synthetic data and temporary `DSH_HOME` directories. The package targets the capabilities verified against DSH 0.1.1-rc.2 and Node 22.19+; it does not claim broader compatibility.

## License

[MIT](LICENSE)
