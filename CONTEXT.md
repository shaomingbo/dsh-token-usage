# DSH Accounts & Usage

This context describes provider accounts, provider-observed allowance information, and the separate local record of model usage visible to DeepSeek Harness.

## Language

**Connection**:
A configured relationship between one DSH profile and one provider account or local provider runtime. A connection identifies capability and status, not a secret or a usage record.
_Avoid_: Account, login, integration

**Credential**:
Secret authentication material held only by an owner-only credential store or the DSH credential seam. Only non-secret facts such as its kind, reference, expiry, and scopes may describe it elsewhere.
_Avoid_: Token record, auth row

**Product**:
The provider offering associated with a connection, such as a subscription tier, prepaid balance, cloud account, or local runtime. A product may have billing and zero or more limits.
_Avoid_: Plan, billing pool

**Billing**:
The price, balance, cycle, expiry, or payment classification of a product as stated by a provider or entered manually. Billing is distinct from both allowance limits and estimated local cost.
_Avoid_: Usage, quota

**Limit**:
A product allowance or rate constraint with a metric, unit, value mode, and window. Its value mode is exact, range, dynamic, unpublished, or manual; its window is rolling, fixed, billing-cycle, or rate-based.
_Avoid_: Quota window, cap row

**Observation**:
A time-stamped, secret-free statement about connection, product, billing, or limit state. An observation names its source and whether that source is brittle; it is not treated as an invoice or a prediction.
_Avoid_: Truth, entitlement

**Usage Ledger**:
The profile-private durable account of model calls observable by DSH, including token facts, local attribution, and valuation. It is independent of provider observations and cannot claim provider-internal retries or invoice accuracy.
_Avoid_: Provider usage, bill

**Attribution Rule**:
A user-controlled rule that maps locally observed provider/model usage to a connection or product without rewriting the underlying ledger facts. Rules affect derived views and can be changed without altering history.
_Avoid_: Ownership, request stamp

**Product Template**:
A versioned, host-side catalog entry describing a provider offering's structure — windows, officially published exact values, tiers, and provider aliases — used to pre-fill account creation. Templates carry structure, never secrets, and their numbers come from dated research rather than being hardcoded in the client.
_Avoid_: Hardcoded plan, client-side defaults
