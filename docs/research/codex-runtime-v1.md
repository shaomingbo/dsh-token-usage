# Unreleased Codex owner-bound capability

This document describes a local source increment over account package 5.0.24. It is NOT a claim that the published 5.0.24 tag already contains the capability, and it does not approve deployment.

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

The compaction bundle separately supplies generic DSH conversion and the experimental route, plus an isolated B backend/policy. Existing `openai-codex`, search backends, quota observations and account UI remain under their existing owners.

## Validation and development safety

The account workspace node_modules was found to symlink to the live Web profile. No dependency installation is performed there. The compaction repository's `scripts/account-snapshot.js` copies public source/tests into a temporary directory and runs a frozen dependency install there; `scripts/test-accounts.js` then runs the account suite and cross-plugin tests with synthetic credentials and a cleared ambient test environment.

Protected pre-existing modifications in auth-runtime.js, capability.js, client.js and subscription-login-reentry.test.js were not edited. New work is limited to native capability files, minimal host wiring, dependency/exports metadata, lockfile, a manifest expectation and documentation.

Real-account traffic, active GUI activation, full production process restore, GPT-6/new-model discovery and governed immutable release approval remain separate gates. No host process, live profile, stored account grant or existing session was modified by this development.
