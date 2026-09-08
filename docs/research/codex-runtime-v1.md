# Codex owner-bound capability

## 5.1.3 request-deadline correction

The 5.1.3 / compaction 0.3.2 pair separates ordinary setup (120000ms), absolute owner total
(1800000ms), and the paired compaction 0.3.2 converter's published Pi output-idle
watchdog (300000ms). See README for the exact factory options and diagnostic fields.
Compaction purpose remains a 300000ms absolute lease without the ordinary short setup
cap; all retries/fallback share it. No new SSE parser, core patch, login, storage migration
or checkpoint version is introduced. Updating only an older owner or only the reader
retains v1 readability but does not supply the complete new budget behavior.

Local regression includes production-sized mock-clock owner/SDK streams and real
owner/official-basic/Pi replay integration. Final local results, release/tag installation
and original-host acceptance must be recorded separately; none is inferred from the
historical 5.1.2 results below.

Local final checks for this pair on Node 24.18.0/macOS arm64: account `npm run check`
passed 275 tests; companion check passed 138 main + 46 legacy + 34 comparison tests;
paired check passed 25 tests, including one real-clock 130018ms synthetic tool-argument
stream through restored official Basic checkpoint replay, pinned SDK and public Pi converter.
The stream used fake auth and transport, not the upstream service. An independent static
review reported no substantiated P0/P1/P2. Both pack dry-runs and diff checks passed.
Temporary-home public installer cycles (first/repeat/status/dump/uninstall/repeat-uninstall)
and actual installed ESM entry loads passed: account on alpha.3; the pair on rc.1.
These local-link probes did not boot a server or touch a real profile. Immutable-tag probes,
publication and current-host acceptance remain separate release/deployment records.

## Historical 5.1.2 baseline

The 5.1.2 release, paired with compaction 0.3.1, carries the live-accepted recovery fix.
Tag identity, final packaging checks and release-tag installation are recorded separately
in the GitHub releases. The frozen production candidate's full regression
has also been rerun successfully. Historical stable/RC tags and earlier evidence
are retained below and in the changelog.

Historical origin: this capability began as a local source increment over account 5.0.24;
that published tag does not contain it, and the initial research did not authorize deployment.
The capability shipped in the 5.1.0 release train; 5.1.2 corrects completion and lifetime handling.

## 5.1.2 Native-only deadline

The accepted pair uses `open({ model, signal, purpose: 'compaction' })`.
Omitting purpose (or using `request`) retains the ordinary request budget. The owner factory
accepts `compactionTimeoutMs` separately (defaulting to `timeoutMs` for existing callers,
maximum 300000); ordinary `timeoutMs` remains capped at 120000. The 5.1.2 host composition
uses 120000 for ordinary requests and 300000 for compaction leases. The choice is made once
when opening the lease, before metadata/auth. Provider creation, retries and same-lease
fallback never renew it. The existing hard close/cancel/dispose semantics remain unchanged.

The optional secret-free diagnostic snapshot now includes `budgetMs`, fixed finer event
categories and detached `eventCounts`; no event names, ids or payloads are copied from the
server. The companion's native converter also uses 300000ms because native compaction emits
no pi chunks until the whole native response is valid; replay/text converters stay at 120000ms.
The accepted real run finished in 157372ms under a 300000ms budget with one request. This
bounded policy is not a guarantee that every real compaction finishes within 300 seconds.

## Ownership

`lib/index.js` constructs ChatGPT/Grok capabilities once as before, retains the ChatGPT initialization promise, and provides `ctx.codexRuntime` with protocol `codex-runtime/v1`. The runtime calls the existing `auth.configured()` and `auth.resolveOAuth()`; it creates no login, refresh runtime, store or credential migration.

Existing authentication stays on exact pi-ai0.82.1. New Codex protocol code uses the separate `pi-ai-codex-native` alias pinned to pi-ai0.84.4. Native SDK installation does not upgrade the active auth implementation. The generated lock contains both explicit versions; the isolated full account suite is the compatibility evidence, not a SemVer assumption.

## Public interface

Public module export: `dsh-token-usage/codex-runtime` exposes `createCodexRuntime` for owner-side composition/testing. Consumers normally use the Cordis capability, not the factory or internal auth modules.

The capability exposes describe/models, open, checkpoint codec/validation, a disclosed estimator and disposal. `open` returns immutable binding, a bound pi Provider factory, a numeric-only compaction usage receipt and close. No bearer, account ID, auth header, grant, credential reference or arbitrary authenticated fetch is returned.

The Provider's public auth resolver returns an empty resolved auth object; the actual existing-account bearer is applied inside its stream closure. Model descriptors come from the pinned catalog, not caller-supplied endpoints. Caller fetch, auth headers and response hooks cannot capture the bearer. Only a valid DSH user-agent is forwarded for attribution. Native and normal requests are fixed to Codex SSE and reject redirects.

Replay validates exact route/model/account identity and placeholder cardinality. Opaque metadata/signatures are preserved, not redacted into unusable state. Known credential echoes in structured/signature data fail; plain text redaction is best-effort and is not a proof against arbitrary malicious fragmented upstream echoes. Error bodies/headers are not forwarded.

## Accounting and scope

`compactionUsage()` reports observed numeric facts only when the native response provided valid counts. It preserves absent versus explicit-zero cache-read fields; defaults from the SDK's numeric placeholder are not observations. Handles are single-flight and cannot leak a prior receipt into a failed/new operation.

The current replay estimator is conservative JSON UTF-16 length/4 with `exact:false`. It is neither a fee estimate nor a provider-token oracle. Native checkpoints in this candidate reject media at actual wire content positions without deleting legitimate tool-argument keys.

The compaction bundle supplies generic DSH conversion and the standard-route official Basic
summarization seam. Its experimental route and isolated B backend/policy remain legacy readers,
not the primary automatic backend. Existing `openai-codex`, search backends, quota observations
and account UI remain under their existing owners.

## 5.1.2 completion/lifetime correction over 5.1.1

A valid completed/done event with one native compaction item ends the SSE response; HTTP EOF
is not required and subsequent bytes are ignored independently of chunk boundaries. Invalid
complete input before completion still fails. Premature EOF, including truncated JSON/SSE/
UTF-8 frames, or socket read failure is recoverable `CODEX_RUNTIME_RESPONSE_STREAM`;
malformed native response/limit rejection is non-retryable `CODEX_RUNTIME_RESPONSE_PROTOCOL`.
The first handle stop cause (TIMEOUT/CANCELLED/CLOSED/DISPOSED) is preserved on later provider/
auth/stream use. The original deadline and single-flight guard remain authoritative. Protocol
and checkpoint v1 remain unchanged; optional purpose/diagnostics are described above. No lease
renewal, native SDK retry or credential access is introduced.

The 0.3.1 compaction consumer owns one extra request in the same lease/account/model/endpoint:
network/5xx/stream failures prefer one native retry after 200ms; other allowlisted availability
failures may use text fallback. They cannot stack, switch accounts or renew the deadline.
Expired/cancelled leases and identity/protocol errors do not trigger recovery; native carrier
histories never fall back to text. Terminal failures suppress new taken-over compaction for
60 seconds per session/provider/model, without pausing ordinary generation. State is bounded,
process-local and reset on restart; only official replacement plus clean end clears failures.
Native-to-text fallback is this plugin pair's policy, not an official Codex behavior claim.

Optional `diagnostics()` and open-failure snapshots expose fixed fields only: phase, actual
`budgetMs`, lease-relative monotonic timings, numeric HTTP status, request/byte/chunk/event
counts, fixed-enum last event and detached `eventCounts`. Request counts are lease-wide;
response counters describe the latest request. Closing freezes elapsed time; unknown event
names/types map to fixed `other` categories. No raw ids, bodies, headers, URLs, prompts,
credentials or opaque native state are included.

## Current validation and limits

The maintainer reran the frozen production candidate: **498 passing tests = plugin 135 +
legacy-A 46 + comparison 34 + account 266 + paired 17**. The account and paired suites use
fresh isolated snapshots with synthetic auth/transport. Compaction's real rc.1 temporary-home
installer check also passed install/repeat/status/`--dump-config`/uninstall without booting a
host. Final package/documentation checks and release-tag installation are separate steps.

An authorized real acceptance on the original instance selected **300000ms**, finished in
**157372ms** with **one request**, and yielded a valid native item plus completed event.
Official Basic produced a **new history replacement** with approximately **146849 tokens
shadowed**. The maintainer read `compaction/summary`, replacement `user/message`,
`compaction/end` and `command/done` success from the **disk journal**. This establishes this
run's recorded result, not fsync, crash recovery, lossless recall or elimination of all timeouts.

Compatibility remains bounded: the account installer supports only its existing
`0.1.2-alpha.3` + `0.1.2-rc.1` CLI versions; both temporary-home install/dump checks are final
release gates. The paired compaction package publicly supports rc.1 only. The live launcher
was alpha.3 but actual Web/Basic dependencies were rc.1; this mixed environment is not proof
of full native-runtime compatibility on pure alpha.3.

Known non-blocking limitation: cancellation can display `CODEX_RUNTIME_ERROR` in compaction
status. Refreshing may cancel a pending manual command; tab switching alone is not an
established cause. Persistent upstream failures, expired budgets and hard context limits
can still stop work. This limitation does not block the accepted release.

## Development safety and historical stages

The account workspace node_modules was found to symlink to the live Web profile. No dependency installation is performed there. The compaction repository's `scripts/account-snapshot.js` copies public source/tests into a temporary directory and runs a frozen dependency install there; `scripts/test-accounts.js` then runs the account suite and cross-plugin tests with synthetic credentials and a cleared ambient test environment.

Historical completion-only correction: the fresh isolated **260-test account suite** and
**16-test real-owner/Basic paired suite** passed with synthetic auth/transport. Those earlier
counts were not live deployment or account-availability evidence; later acceptance is above.

Historical initial implementation: protected pre-existing modifications in auth-runtime.js,
capability.js, client.js and subscription-login-reentry.test.js were not edited. Work at that
stage was limited to native capability files, minimal host wiring, dependency/exports metadata,
lockfile, a manifest expectation and documentation. Real-account traffic, active GUI activation,
full production process restore, GPT-6/new-model discovery and governed immutable release
approval were then separate gates; no host process, live profile, stored grant or existing
session was modified by that development stage. This is historical scope, not a statement that
the later accepted recovery fix remains untested.
