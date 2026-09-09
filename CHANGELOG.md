# Changelog

## 5.1.4 (unreleased preparation)

- Combine the governance candidate, Antigravity quota-surface hotfix and the verified
  OAuth lifecycle correction. This is a new local candidate, not the published v5.1.3 tag.
- Keep Settings connection facts independent of the analytics store and quota refresh;
  stored raw keys remain configured-unverified, never falsely Connected.
- Read Antigravity quota/catalog from daily, then prod, then sandbox; explicit baseUrl
  remains pinned. Generation and project discovery retain their existing paths.
- Expose the active subscription login through pending-login and support explicit
  provider cancellation before a challenge arrives. Closing a panel stops its local
  effects without cancelling Host authorization; reopening reattaches the same operation.
- Clear the local card and re-enable Connect when a reattached login reaches failed
  or cancelled, retaining its reason and adding no Host cancel/logout request. Two
  offline regressions cover these terminal states; no new real-provider claim follows.
- Preserve codex-runtime/v1, the 1800s ordinary / 120s setup / 300s compaction budgets,
  the two pinned SDK versions and existing data identity. No data migration is added.
- The pre-terminal-fix input passed 311 account tests and a paired Compaction R2
  suite (27 pass, one optional real-time test skipped). An explicitly authorized Grok
  test account passed close/reopen, cancellation before/after challenge, and final binding.
  These are candidate-specific checks, not other-provider OAuth or formal-tag acceptance.
- Commit/tag publication, final artifact installation and production activation remain
  separate gates. The 5.1.4 version number does not assert a published or reserved tag.

## 5.1.3

- Pair with compaction 0.3.2: ordinary production leases use 1800000ms absolute total,
  120000ms preparation, and the companion's published 300000ms output-idle watchdog.
  Continuous generation no longer hits the former 120000ms total cutoff.
- Bound metadata-only applicability and ordinary model/readiness/auth setup separately;
  setup completion does not refund time or renew the total lease.
- Keep compaction purpose at 300000ms total and preserve recovery, first stop reason,
  account binding, cancellation and checkpoint-format contracts. Short explicitly configured
  budgets remain short; implicit compact defaults are capped at 300000ms.
- Optional numeric diagnostics add setup/total/timeout budgets and a fixed setup|total
  timeout kind. No raw request, credential, event or opaque history is logged.
- Publication, isolated tag installation and current-GUI verification are separate gates;
  the historical 5.1.2 real-run evidence below is not evidence for this candidate.

## 5.1.2

Paired with `dsh-codex-compaction` `0.3.1`; tag identity and release-tag installation
results are recorded in the GitHub release. The recovery fix's real acceptance evidence
is distinct from those packaging and installation checks.

- Finish native SSE at valid completed/done plus one compaction item, without waiting for
  HTTP EOF or interpreting later bytes. Premature EOF (including truncated frames) and
  socket-read failures are `CODEX_RUNTIME_RESPONSE_STREAM`; malformed protocol remains
  non-retryable `CODEX_RUNTIME_RESPONSE_PROTOCOL`.
- Preserve the first TIMEOUT/CANCELLED/CLOSED/DISPOSED lease stop cause on later use.
  Explicit compaction opens use 300000ms; ordinary opens stay 120000ms. The companion's
  native converter also uses 300000ms, while replay/text converters stay 120000ms.
- Optional fixed-field diagnostics report the actual budget, phases, timings, byte/request
  counts and fixed-enum `eventCounts`; no raw event names, content or credentials.
  No login, checkpoint version or hidden transport/SDK retry is added.
- The companion owns one same-lease extra request (native retry OR text fallback, never
  stacked), with 60-second per-session/provider/model failure suppression. No account switch
  or deadline renewal. Native-to-text fallback is plugin policy, not an official Codex claim.
- De-identified real acceptance: 300000ms budget, 157372ms elapsed, one request, valid item
  plus completed event, official Basic history replacement, approximately 146849 tokens
  shadowed. The maintainer read summary/user-message/end and successful command/done from
  the disk journal; no fsync, crash-recovery or universal timeout-fix claim follows.
- Frozen production candidate rerun: 498 passing tests (plugin 135 + legacy-A 46 +
  comparison 34 + account 266 + paired 17). Compaction's real rc.1 temporary-home installer
  cycle also passed without boot. Account temporary-home installer/dump checks on both
  supported CLI versions remain maintainer release gates.
- Installer support remains `0.1.2-alpha.3` and `0.1.2-rc.1`, not a wider range; native
  compaction publicly targets rc.1. The observed alpha.3 launcher with rc.1 Web/Basic
  dependencies is not a pure-alpha.3 native-runtime acceptance test.
- Known non-blocking limitation: cancellation may display `CODEX_RUNTIME_ERROR` in the
  compaction status. Refreshing can cancel a pending manual command; tab switching alone
  is not established as a cause. Not all timeouts or hard context-limit failures are fixed.
- README commands target `v5.1.2`; the invalid older-tag `--source` example is replaced by
  `link:<local-path>`. Only this installer's own fixed version tag or `link:` is accepted.

## 5.1.1 (historical release)

Observation freshness: per-connection quota capabilities, overlay-scoped
Ollama settings scraping, profile data-dir identity without silent empty
stores, short sidebar poll while a refresh is running, 429/auth backoff,
and `link:` checkout dependency install. Default source is
`github:shaomingbo/dsh-token-usage#v5.1.1`. Codex runtime from 5.1.0 is
unchanged.

## 5.1.0

Stable release. Content equals the reviewed `5.1.0-rc.2` candidate: the
owner-bound `codex-runtime/v1` capability, the pinned SDKs and the public-CLI
installer are unchanged, and no production logic changed relative to
`5.1.0-rc.2`. The installer's default source stays version-derived
(`github:shaomingbo/dsh-token-usage#v5.1.0`). The fixed tag is assumed only
after the maintainer has actually pushed and verified it; the RC tags
(`5.1.0-rc.1`, `5.1.0-rc.2`) are retained as history. Pairs with
`dsh-codex-compaction` `0.3.0` stable; see that package's `docs/VALIDATION.md`
for the de-identified validation facts of this release train.

## 5.1.0-rc.2 (historical release candidate)

- Treat a schema-materialized empty model `input` array as unspecified, matching the public PiAiModelProfile contract; inherit host/catalog modalities instead of rejecting Sol with MODEL_METADATA.
- Preserve fail-closed validation of illegal nonempty modalities and every existing account/checkpoint binding.
- Verified with the real public settings schema, 240 account tests and 12 paired integration tests. Live Sol verification follows explicit candidate installation; no broader release claim is made.
- Pair with unchanged `dsh-codex-compaction` 0.3.0-rc.1. Prior RC tags are immutable.

## 5.1.0-rc.1 (release candidate)

Owner account companion release for `dsh-codex-compaction` 0.3.0-rc.1.

### New capability

- `codex-runtime/v1`: the owner-bound native Codex compaction/replay runtime,
  exported as the public `./codex-runtime` module entry. It reuses the existing
  ChatGPT login/refresh (no second login, grant or credential store) and keeps
  OAuth values, endpoints and headers inside the account owner.
- Trusted model facts: custom models (e.g. `gpt-6-astra`) resolve only through
  `createCodexModelFacts`, reading whitelisted public host-configured profile
  fields (id/name/contextWindow/maxTokens/input/reasoningEfforts) with the
  host-resolved model info as a cross-check. Conflicts and invalid values are
  fixed-vocabulary gaps; nothing is invented.
- Standard-route applicability verdicts are metadata-only, bounded by the
  runtime deadline, caller cancellation and disposal, and never resolve
  authentication or perform network I/O.
- The native HTTP/codec/replay path never reflects raw upstream errors or
  bodies; only fixed owner categories cross the seam.

### Installer

- `bin/install.js` is now a public CLI profile adapter: every mutation is
  delegated to the public `dsh plugin` CLI of the exact tested version
  (`0.1.2-rc.1`) with `--ignore-scripts`, judged by exit status and manifest
  postconditions. No direct manifest writes; failures are reported honestly
  without fabricating rollback. The default source stays version-derived
  (`github:shaomingbo/dsh-token-usage#v5.1.0-rc.1`).

### Compatibility

- Pinned SDKs unchanged: `@earendil-works/pi-ai` 0.82.1 (auth) and
  `pi-ai-codex-native` (npm alias) 0.84.4. The RC pair is for controlled validation, not stable deployment;
  do not assume the released 5.0.24 contains any of the above.