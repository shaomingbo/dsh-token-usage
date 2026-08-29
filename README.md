# dsh-token-usage

Local token usage and cost analytics for [DeepSeek Harness](https://github.com/shaomingbo/deepseek-harness): a profile-style dashboard for what your harness processed — tokens, requests, projects, sessions, models, providers, and estimated cost. No telemetry. No prompts stored. No DSH patches.

## Install

```sh
npx --yes github:shaomingbo/dsh-token-usage#v0.1.0
```

That single command installs the bundle into the `web` profile. Then **restart DSH manually and hard-refresh the Web GUI** — the installer never restarts or touches the running DSH process.

Other commands:

```sh
npx --yes github:shaomingbo/dsh-token-usage#v0.1.0 status
npx --yes github:shaomingbo/dsh-token-usage#v0.1.0 uninstall
npx --yes github:shaomingbo/dsh-token-usage#v0.1.0 --profile web --source github:shaomingbo/dsh-token-usage#v0.1.0
npx --yes github:shaomingbo/dsh-token-usage#v0.1.0 --help
```

- `--profile <name>` — target DSH profile (default `web`)
- `--source <source>` — package source; the default is pinned to the `v0.1.0` tag (never a floating branch)
- `DSH_TOKEN_USAGE_SOURCE` — environment-variable override for the source

### Local development

```sh
dsh-token-usage --source link:/absolute/path/to/dsh-token-usage
# or
npx --yes github:shaomingbo/dsh-token-usage#v0.1.0 --source link:$PWD
```

### Manual fallback

The installer only ever edits two slots in `profiles/<name>/package.json` — `dependencies["dsh-token-usage"]` and `dsh.profile.bundles` — then runs `pnpm install --ignore-scripts` in the profile. You can make the same two edits by hand if you prefer; writes are atomic and rolled back if dependency installation fails.

## What you get

- **Sidebar usage entry** with an optional today summary, opening a full-frame dashboard: overview, requests, sessions, models, providers, pricing, data, settings. Follows the Harness theme and both locales.
- **Automatic history import** — sessions from before installation are imported read-only in the background (pausable, cancelable, resumable). Missed live events are reconciled from the durable log.
- **Correct counting** — one observable model call per session/turn/step; repeated usage samples replace instead of adding; fork-inherited seed prefixes are never double-counted; subagent usage counts once in its own session and rolls up through lineage; compaction never bills; reasoning tokens stay a labeled subset of output.
- **Honest cost** — estimates use an embedded versioned snapshot plus an optional, explicit LiteLLM refresh. Preview the source and observed-model matches before applying; no background fetch occurs. Provider-compatible unique matches apply automatically, while cross-provider candidates require an explicit alias chosen from observed/catalog dropdowns. Custom prices and provider multipliers remain available. Original valuations are immutable; current-rule revaluation changes immediately. Unknown prices are excluded and reported as coverage, never guessed.
- **Reported vs estimated** — provider-reported usage and in-memory estimates are separated at every level; failed requests count as requests but never fabricate tokens or cost.
- **Your data, your machine** — a profile-private SQLite ledger (built-in `node:sqlite`, no native deps). CSV/JSON exports anonymize paths and session ids by default; complete backups are a separate, privacy-flagged operation. Purge request details while keeping anonymous day-level totals. Uninstall keeps your ledger.
- **No patching** — the plugin composes through documented Harness extension points only (bundle rows, slots, loopback RPC, read-only persistence APIs).

## Privacy

No telemetry. No network requests by default. Prompts, responses, tool arguments, and credentials are never written to the ledger, logs, or exports. Estimation reads message content transiently in host memory only. The optional today summary, CNY display rate, avatars (local files only), and price data all stay local.

## Data location

`<DSH_HOME>/profiles/<profile>/data/dsh-token-usage/` — `usage.sqlite` (the ledger) and `settings.json` (display preferences). Linked-development installs fall back to `<DSH_HOME>/dsh-token-usage/`. `uninstall` does not delete this directory; remove it manually for a full wipe.

## Limitations

- Usage is a Harness-observed account, not an upstream invoice: provider-internal retries that never reached the session log are not observable and not guessed.
- The estimation seam is implemented and tested at the ledger level, but v0.1 does not yet attach the Harness token meter on the host side, so usage-less steps stay "unknown" rather than estimated.
- Verified against DSH 0.1.1-rc.2 with capability checks at startup; unsupported runtimes get a clear diagnostic instead of silent miscounting.
- Budgets/alerts, agent-skill attribution, non-DSH CLI imports, cloud sync, and automatic exchange rates are out of scope for v0.1. See [SPEC.md](SPEC.md).

## Development

```sh
pnpm install          # or npm install
npm run check         # syntax + full test suite (node --test)
npm pack --dry-run    # verify the published artifact
```

Tests run at the ledger seam: synthetic session fixtures (never real logs), the assembled host plugin over a fake cordis context, installer lifecycles in temporary `DSH_HOME`s, migration/rollback, export anonymization, and the client bundle's module-loader contract.

## License

[MIT](LICENSE)
