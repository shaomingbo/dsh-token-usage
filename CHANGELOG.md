# Changelog

## 5.1.0-rc.2 (release candidate)

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