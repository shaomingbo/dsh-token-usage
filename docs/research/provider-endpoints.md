# Provider endpoint research: Z.AI GLM and Ollama Cloud

This note records implementation evidence for a DSH **Accounts & Usage** TypeScript plugin. It separates documented API contracts from behavior observed in first-party or pinned public client code. No live requests with user credentials were made.

## Source classification

- **Official documented contract**: vendor documentation or OpenAPI.
- **Official client behavior, not a documented API contract**: code published by the vendor that calls an otherwise undocumented endpoint.
- **Pinned third-party behavior**: CodexBar source at commit [`efb952e0bf5f92e639959de549952ec73a88b9e9`](https://github.com/steipete/CodexBar/tree/efb952e0bf5f92e639959de549952ec73a88b9e9). It is useful behavioral evidence, but it is not an Ollama contract and can break when Ollama changes its site.

## Z.AI GLM Coding Plan usage

### What is official

Z.AI documents that its `glm-plan-usage` Claude Code plugin queries GLM Coding Plan quota and usage, and says it is available only for the Personal plan. The documentation links the `zai-org/zai-coding-plugins` repository and gives the `/glm-plan-usage:usage-query` command ([Z.AI Usage Query Plugin documentation](https://docs.z.ai/devpack/extension/usage-query-plugin)).

The exact HTTP behavior below comes from Z.AI's official plugin source pinned at commit [`0446d0bb0bc537d97d3ab3664c4b8b9c4a0e1254`](https://github.com/zai-org/zai-coding-plugins/blob/0446d0bb0bc537d97d3ab3664c4b8b9c4a0e1254/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs). Z.AI does **not** publish these monitor routes as a stable API reference on the documentation page, so treat them as official-client behavior rather than a versioned public contract.

### Endpoints and request semantics

For the global Z.AI service, the official plugin derives the origin from `ANTHROPIC_BASE_URL` and sends these requests:

```text
GET https://api.z.ai/api/monitor/usage/model-usage?startTime=<encoded>&endTime=<encoded>
GET https://api.z.ai/api/monitor/usage/tool-usage?startTime=<encoded>&endTime=<encoded>
GET https://api.z.ai/api/monitor/usage/quota/limit
```

The source also supports the same paths on `https://open.bigmodel.cn` and `https://dev.bigmodel.cn` for the ZHIPU platform. A DSH implementation focused on Z.AI should hard-code or exactly allowlist `https://api.z.ai`; it should not infer a credential destination from arbitrary user input.

The model/tool time arguments are URL-encoded strings in local time formatted `yyyy-MM-dd HH:mm:ss`. The official script starts at yesterday's current hour at `HH:00:00` and ends today at the current hour at `HH:59:59`. This is the script's query window, not a documented server requirement. The quota request has no query string ([pinned official script](https://github.com/zai-org/zai-coding-plugins/blob/0446d0bb0bc537d97d3ab3664c4b8b9c4a0e1254/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs)).

The official script sends:

```http
Authorization: <ANTHROPIC_AUTH_TOKEN>
Accept-Language: en-US,en
Content-Type: application/json
```

`Authorization` contains the token **verbatim**; the code does not prepend `Bearer`. It sends no request body. The environment variable names are Claude compatibility details; a DSH account record need not reuse them, but it must preserve the bare-token header behavior if it calls these routes ([pinned official script](https://github.com/zai-org/zai-coding-plugins/blob/0446d0bb0bc537d97d3ab3664c4b8b9c4a0e1254/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs)).

### Envelopes, fields, and errors

The official client considers **only HTTP 200** successful. Any other status becomes an error containing the status and raw body. Network errors reject the request. On HTTP 200 it parses JSON and emits `json.data` when truthy, otherwise the entire top-level value. Invalid JSON is printed as a raw response body and still resolves successfully; a typed DSH client should instead report a parse/protocol error ([pinned official script](https://github.com/zai-org/zai-coding-plugins/blob/0446d0bb0bc537d97d3ab3664c4b8b9c4a0e1254/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs)).

Only the quota fields actually consumed by the official code can be asserted from this primary source:

```text
data.limits[]
  type                 "TOKENS_LIMIT" or "TIME_LIMIT" are recognized
  percentage
  currentValue         read for TIME_LIMIT
  usage                read for TIME_LIMIT
  usageDetails         passed through for TIME_LIMIT
```

For `TOKENS_LIMIT`, the script outputs only the percentage and labels it `Token usage(5 Hour)`. For `TIME_LIMIT`, it outputs percentage, `currentValue`, `usage` (under a misspelled `totol` output key), and `usageDetails`, labeled `MCP usage(1 Month)`. Those human labels are hard-coded client interpretations, not demonstrated server fields. The official source does not define a schema for model-usage, tool-usage, `usageDetails`, top-level `code`/`success`, or non-200 error JSON. Preserve unknown fields and validate minimally rather than inventing a closed schema.

### Redirect and origin security

The official plugin uses Node `https.request`, checks the first response, and implements no redirect following. Therefore a 3xx is an error and the token is not automatically replayed to a redirect target ([pinned official script](https://github.com/zai-org/zai-coding-plugins/blob/0446d0bb0bc537d97d3ab3664c4b8b9c4a0e1254/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs)). A DSH client should retain this fail-closed behavior, or at minimum never forward `Authorization` across origins.

Do **not** copy the official script's platform test literally: it uses `baseUrl.includes("api.z.ai")` but constructs the request origin from the parsed input URL. A crafted URL whose path/query contains `api.z.ai` could pass that substring test and receive the credential on another host. For DSH:

1. require `https:`;
2. compare `URL.hostname` exactly against an allowlist (`api.z.ai`, and only add CN hosts if intentionally supported);
3. reject userinfo and unexpected ports;
4. construct the three URLs from the selected known origin, not from an arbitrary base URL;
5. disable redirects, bound response size/time, and never log headers or full error bodies that might echo secrets.

These are defensive implementation requirements inferred from the credential flow; they are not claims that Z.AI documents such a policy.

### Z.AI uncertainties

- The monitor routes, response schemas, rate limits, and stability guarantees are undocumented.
- The official source proves current client expectations, not that all accounts or plans can access the routes. The public page explicitly limits the plugin to Personal plans.
- Exact invalid/expired-token status codes and error envelopes are not specified.
- The semantics and units of model/tool response fields are not established by the cited primary sources.

## Ollama Cloud API-key validation

### Official API contract

Ollama documents the direct cloud base URL as `https://ollama.com/api`; local Ollama remains `http://localhost:11434/api` ([API introduction](https://docs.ollama.com/api/introduction)). Direct cloud access uses an API key in `Authorization: Bearer <key>`. Keys currently do not expire but can be revoked ([Authentication](https://docs.ollama.com/api/authentication)). Local API access does not require authentication, so a local endpoint must not be treated as proof that a cloud key is valid.

Ollama publishes no dedicated `validate`, identity, or key-introspection endpoint in the cited API documentation/OpenAPI ([OpenAPI](https://docs.ollama.com/openapi.yaml)). Consequently, the plugin can prove that a particular authenticated operation succeeded, but there is no cited official contract for a side-effect-free general key-validation call.

Relevant official endpoints are:

```text
GET  https://ollama.com/api/tags
POST https://ollama.com/api/show
POST https://ollama.com/api/web_search
```

`GET /api/tags` returns an object with `models[]`. Documented model fields include `name`, `model`, `remote_model`, `remote_host`, `modified_at`, `size`, `digest`, and nested `details` (`format`, `family`, `families`, `parameter_size`, `quantization_level`) ([List models](https://docs.ollama.com/api/tags)).

`POST /api/show` accepts a model id and returns serialized `parameters`, `capabilities`, high-level `details`, and architecture-specific `model_info`; a positive `*.context_length` is the documented model-capacity fact used by the DSH model route ([Show model details](https://docs.ollama.com/api-reference/show-model-details#show-model-details)). Ollama also documents OpenAI-compatible `/v1/chat/completions`, `/v1/models`, vision, tools, usage, and reasoning effort support ([OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)); direct Cloud inference uses the same Ollama host with Bearer authentication.

`POST /api/web_search` requires JSON with `query` (string) and optionally `max_results` (1–10, default 5); success returns `results[]` with `title`, `url`, and `content` ([Web search](https://docs.ollama.com/capabilities/web-search)). The official example uses the same Bearer header.

Ollama documents common statuses 200, 400, 404, 429, 500, and 502, and JSON errors shaped as `{"error":"..."}`. It does not document the exact status/body for missing, invalid, or revoked cloud API keys on these endpoints ([Errors](https://docs.ollama.com/api/errors)). Code should therefore classify 401/403 as unauthorized if observed, but retain the raw status category and not claim those codes are guaranteed by the official docs.

### Validation recommendation and limitation

A strict implementation should say **"cloud API access verified"**, not **"key intrinsically valid"**, after a successful authenticated cloud operation. There is no officially documented, side-effect-free validation endpoint.

- `GET /api/tags` is cheap and its success envelope is documented, but the official docs do not explicitly promise that this route always rejects an invalid key on the cloud host.
- A real `POST /api/web_search` success verifies access to an authenticated feature, but performs a search and may consume quota/rate limit; it is not a side-effect-free validation probe.
- Do not accept an arbitrary 400 as proof of authentication unless deliberately adopting the pinned CodexBar heuristic below. The official error documentation says 400 means bad request; it does not guarantee authentication is checked first.

For account setup, the honest result model is therefore at least `verified`, `unauthorized`, `reachable-but-unverified`, and `network/protocol error`, rather than a Boolean that overstates certainty.

### Redirect and origin security

Use a fixed `https://ollama.com` origin for cloud verification. If configurable endpoints are supported for testing or Ollama-compatible servers, allow HTTPS or loopback HTTP only, and never send a cloud key to a user-supplied non-Ollama origin without an explicit trust decision. Disable redirects for credentialed requests, or follow only same-origin HTTPS redirects while stripping `Authorization` otherwise. Do not silently turn an `ollama.com` request into `www.ollama.com` or another subdomain with credentials attached; no cited official document promises such redirect behavior.

## Pinned CodexBar findings (behavioral, brittle, non-official)

CodexBar's public Ollama provider at pinned commit [`efb952e0bf5f92e639959de549952ec73a88b9e9`](https://github.com/steipete/CodexBar/tree/efb952e0bf5f92e639959de549952ec73a88b9e9) implements two separate paths.

### API-key heuristic

Its [`OllamaAPIUsageFetcher`](https://github.com/steipete/CodexBar/blob/efb952e0bf5f92e639959de549952ec73a88b9e9/Sources/CodexBarCore/Providers/Ollama/OllamaUsageFetcher.swift) does the following:

1. `POST https://ollama.com/api/web_search` with `Authorization: Bearer <key>`, JSON content type, and body `{"query":""}`.
2. Treats **200 or 400** as validation success, 401/403 as invalid/revoked, and everything else as a network error.
3. Then requests `GET https://ollama.com/api/tags` with the same Bearer header and counts `models[]`.

CodexBar's own pinned documentation says the tags catalog is public and cannot verify a key by itself ([pinned Ollama provider note](https://github.com/steipete/CodexBar/blob/efb952e0bf5f92e639959de549952ec73a88b9e9/docs/ollama.md)). Accepting 400 from an empty required query is a clever non-destructive probe, but it depends on undocumented server validation order and status behavior. It should be labeled a **heuristic**, guarded by tests/telemetry-free diagnostics, and easy to replace. It is not an official Ollama validation contract.

CodexBar also enforces HTTPS or loopback HTTP for overridden endpoints and requires the validation and tags URLs to have the same scheme/host/effective port ([pinned fetcher](https://github.com/steipete/CodexBar/blob/efb952e0bf5f92e639959de549952ec73a88b9e9/Sources/CodexBarCore/Providers/Ollama/OllamaUsageFetcher.swift)). That is sound credential-boundary behavior worth retaining independently of the probe heuristic.

### Manual settings scraping

CodexBar states that Cloud Usage quota windows are not available through the documented API and therefore scrapes the Plan & Billing/settings HTML with a browser session cookie ([pinned provider note](https://github.com/steipete/CodexBar/blob/efb952e0bf5f92e639959de549952ec73a88b9e9/docs/ollama.md)). Its pinned implementation:

- fetches `GET https://ollama.com/settings` with a `Cookie` header and browser-like `Accept`, user-agent, language, origin, and referer headers;
- recognizes session cookie names including `__Secure-session`, `session`, `ollama_session`, `__Host-ollama_session`, `wos-session`, and NextAuth token names/chunks;
- allows a manually pasted `Cookie:` header or curl capture, but requires a recognized session cookie;
- follows redirects using `URLSession`, reattaching the cookie only to HTTPS `ollama.com`, `www.ollama.com`, or any `*.ollama.com` host and stripping it for other hosts;
- treats final Ollama `/signin`, `signin.ollama.com`, or a WorkOS authorization URL as an expired/not-logged-in session;
- treats HTTP 401/403 as invalid credentials and other non-200 statuses as network errors
  ([pinned fetcher](https://github.com/steipete/CodexBar/blob/efb952e0bf5f92e639959de549952ec73a88b9e9/Sources/CodexBarCore/Providers/Ollama/OllamaUsageFetcher.swift)).

The pinned HTML parser extracts:

- plan name from markup around the literal `Cloud Usage`;
- account email from `id="header-email"`;
- session usage from `Session usage` or fallback label `Hourly usage`;
- weekly usage from `Weekly usage`;
- percentage from text like `<number>% used`, falling back to an inline `width: <number>%` style;
- reset time from a `data-time` ISO-8601 attribute;
- a hard-coded five-hour session window when the label is exactly `Session usage`
  ([pinned parser](https://github.com/steipete/CodexBar/blob/efb952e0bf5f92e639959de549952ec73a88b9e9/Sources/CodexBarCore/Providers/Ollama/OllamaUsageParser.swift)).

All of this scraping behavior is brittle: cookie names, identity provider, labels, DOM structure, inline styles, reset attributes, and plan layout can change without API-version notice. It also handles a browser session secret, which is broader and more sensitive than an API key. A DSH plugin should make scraping manual/opt-in, keep it host-side, never persist HTML or log cookie values, redact diagnostics, apply strict response-size/time limits, and clearly show `scraped from settings page` provenance and last-success time. Prefer an exact redirect-host allowlist over CodexBar's broad `*.ollama.com` rule.

## Implementation summary

```text
Z.AI usage:
  Use the three official-client GET routes on exact https://api.z.ai.
  Send the token verbatim in Authorization (no Bearer).
  Accept only 200, parse JSON strictly, preserve unknown fields, do not follow redirects.
  Mark schemas/endpoints as undocumented and potentially changeable.

Ollama Cloud key:
  Use Authorization: Bearer <key> only on trusted HTTPS origins.
  No official dedicated validation endpoint exists.
  Report successful authenticated operation vs unauthorized vs unverified, not an overstated Boolean.
  If adopting CodexBar's empty-web-search 200/400 probe, label and isolate it as a brittle heuristic.

Ollama quota bars:
  Only pinned CodexBar settings-page scraping evidence was found.
  Treat it as optional, manual, provenance-labeled HTML scraping—not official API behavior.
```
