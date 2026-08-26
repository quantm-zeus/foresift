# g0-provider-lifecycle — scoped specification

> This file is a SUBORDINATE DERIVATIVE of the authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`. It was seeded mechanically from
> the requirement manifest by `scripts/automation/bootstrap-package-spec.mjs` (builder v1). The PRD
> always wins over any wording below.

## Authority binding

- Milestone: `G0` (ACTIVE)
- Objective: Deliver provider operation lifecycle truth: stateful lifecycle (DISCOVERED through
  REMOVED) with documentation/pricing/rights verification TTLs that fail closed, deprecation rules
  for new implementations, audited read-only adapters bound to exact egress allowlists (GMGN
  strictly query-only, Helius supported raw/history operations), quarantine of responses carrying
  transaction payloads or key material, rights-change fail-closed handling, and source fingerprints
  for empirical dependence analysis.
- Risk: HIGH · writeScopes: `packages/provider-lifecycle/**`, `packages/providers/**`,
  `packages/shared-schemas/**`, `migrations/g0_prov_*.sql`, `tests/fixtures/prov/**`,
  `tests/acceptance/**`, `tests/negative/**`, `telemetry/prov.*`, `docs/provider-rights/**`
- Dependencies: `g0-contracts-data-truth` PROVEN, `g0-security-perimeter` PROVEN
- Bound inputs at seed time: main `5f52f8edf2fd`, manifest `e0f9f1284473`, PRD `baa521d9c67e`

## Assigned requirements (normative text quoted verbatim)

### FR-PROV-001 — 38. Functional requirements catalogue (PRD line 6402)

> Every provider operation has lifecycle state `DISCOVERED`, `VERIFIED`, `ACTIVE`, `DEGRADED`,
> `DEPRECATED`, `BLOCKED`, or `REMOVED`, with last documentation verification, last live probe,
> replacement operation, sunset date, and affected features.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/prov.ts`
- Fixture refs: `tests/fixtures/prov/`
- Telemetry refs: `telemetry/prov.*`

### FR-PROV-002 — 38. Functional requirements catalogue (PRD line 6403)

> Documentation, pricing/plan, quota, rights, schema, endpoint, authentication, and deprecation
> verification expire after a configured TTL; expiry prevents new active use of decision-critical
> fields until reverified.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/prov.ts`
- Fixture refs: `tests/fixtures/prov/`
- Telemetry refs: `telemetry/prov.*`

### FR-PROV-003 — 38. Functional requirements catalogue (PRD line 6404)

> A deprecated or maintenance-only provider operation cannot remain active for a new implementation
> unless an explicit time-bounded migration exception and replacement plan are approved.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/prov.ts`
- Fixture refs: `tests/fixtures/prov/`
- Telemetry refs: `telemetry/prov.*`

### FR-PROV-004 — 38. Functional requirements catalogue (PRD line 6405)

> Provider SDKs, MCP servers, skills, plugins, or packages containing trading, signing, wallet,
> swap, transaction-building, private-key, or arbitrary-request capability are not installed or
> exposed wholesale; only audited read-only operation adapters are permitted.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/prov.ts`
- Fixture refs: `tests/fixtures/prov/`
- Telemetry refs: `telemetry/prov.*`

### FR-PROV-005 — 38. Functional requirements catalogue (PRD line 6406)

> Each provider adapter enforces an exact allowlist of scheme, host, port, path template, HTTP
> method, content type, request fields, response schema, redirect policy, maximum bytes, and DNS/IP
> policy.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/prov.ts`
- Fixture refs: `tests/fixtures/prov/`
- Telemetry refs: `telemetry/prov.*`

### FR-PROV-006 — 38. Functional requirements catalogue (PRD line 6407)

> GMGN integration is query-only; swap, quote-to-transaction, sign, submit, private-key, wallet, and
> trading APIs, tools, environment variables, schemas, dependencies, and routes are prohibited and
> covered by negative tests.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/prov.ts`
- Fixture refs: `tests/fixtures/prov/`
- Telemetry refs: `telemetry/prov.*`

### FR-PROV-007 — 38. Functional requirements catalogue (PRD line 6408)

> New Helius integrations use supported raw/history operations and local supported-program decoding;
> deprecated enhanced-parser functionality may be retained only as non-authoritative evidence under
> a migration exception and never as the sole economic-event source.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/prov.ts`
- Fixture refs: `tests/fixtures/prov/`
- Telemetry refs: `telemetry/prov.*`

### FR-PROV-008 — 38. Functional requirements catalogue (PRD line 6409)

> A provider response containing transaction payloads, signing requests, executable instructions,
> private-key fields, or unexpected write capability is rejected, quarantined, audited, and excluded
> from model context.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/prov.ts`
- Fixture refs: `tests/fixtures/prov/`
- Telemetry refs: `telemetry/prov.*`

### FR-PROV-009 — 38. Functional requirements catalogue (PRD line 6410)

> Provider-plan or rights changes fail closed for affected storage, derived use, redistribution,
> caching, and export paths; previously stored restricted artifacts are quarantined or retired
> according to the updated rights policy.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/prov.ts`
- Fixture refs: `tests/fixtures/prov/`
- Telemetry refs: `telemetry/prov.*`

### FR-PROV-010 — 38. Functional requirements catalogue (PRD line 6411)

> Provider source fingerprints capture upstream lineage, field/value fingerprints, timing behavior,
> outage correlation, schema characteristics, and first-seen behavior for empirical dependence
> analysis.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/prov.ts`
- Fixture refs: `tests/fixtures/prov/`
- Telemetry refs: `telemetry/prov.*`

## Shared acceptance criteria

Attached to more than one requirement of this package — implement once, satisfy everywhere:

- **AC-250** · positive: `tests/acceptance/AC-250.spec.ts` · negative/failure:
  `tests/negative/AC-250.negative.spec.ts` — attached to 10 requirements
- **AC-251** · positive: `tests/acceptance/AC-251.spec.ts` · negative/failure:
  `tests/negative/AC-251.negative.spec.ts` — attached to 10 requirements
- **AC-252** · positive: `tests/acceptance/AC-252.spec.ts` · negative/failure:
  `tests/negative/AC-252.negative.spec.ts` — attached to 10 requirements
- **AC-253** · positive: `tests/acceptance/AC-253.spec.ts` · negative/failure:
  `tests/negative/AC-253.negative.spec.ts` — attached to 10 requirements
- **AC-254** · positive: `tests/acceptance/AC-254.spec.ts` · negative/failure:
  `tests/negative/AC-254.negative.spec.ts` — attached to 10 requirements
- **AC-255** · positive: `tests/acceptance/AC-255.spec.ts` · negative/failure:
  `tests/negative/AC-255.negative.spec.ts` — attached to 10 requirements
- **AC-256** · positive: `tests/acceptance/AC-256.spec.ts` · negative/failure:
  `tests/negative/AC-256.negative.spec.ts` — attached to 10 requirements
- **AC-257** · positive: `tests/acceptance/AC-257.spec.ts` · negative/failure:
  `tests/negative/AC-257.negative.spec.ts` — attached to 10 requirements
- **AC-258** · positive: `tests/acceptance/AC-258.spec.ts` · negative/failure:
  `tests/negative/AC-258.negative.spec.ts` — attached to 10 requirements
- **AC-259** · positive: `tests/acceptance/AC-259.spec.ts` · negative/failure:
  `tests/negative/AC-259.negative.spec.ts` — attached to 10 requirements
- **AC-270** · positive: `tests/acceptance/AC-270.spec.ts` · negative/failure:
  `tests/negative/AC-270.negative.spec.ts` — attached to 10 requirements
- **AC-271** · positive: `tests/acceptance/AC-271.spec.ts` · negative/failure:
  `tests/negative/AC-271.negative.spec.ts` — attached to 10 requirements
- **AC-272** · positive: `tests/acceptance/AC-272.spec.ts` · negative/failure:
  `tests/negative/AC-272.negative.spec.ts` — attached to 10 requirements
- **AC-273** · positive: `tests/acceptance/AC-273.spec.ts` · negative/failure:
  `tests/negative/AC-273.negative.spec.ts` — attached to 10 requirements

## Non-goals

Everything below is OUT OF SCOPE for this package:

- `g0-contracts-data-truth`: Establish the canonical data-truth foundation: versioned
  chain/asset/pool/launch/migration identity, immutable observations with revisions, point-in-time
  available_at replay with no-backdating, field-level quality codes, online/offline feature
  consistency, source lineage and independence groups, and tiered backup/PITR durability with
  separately protected encryption keys and recovery credentials over the shared persistence,
  object-store, and schema layers. This package also lands glob-driven root
  tsconfig/eslint/package/workspace configuration that picks up every later G0 package path
  automatically so subsequent packages need zero root-config edits. FR-DR recovery orchestration is
  delivered in G0 through packages/persistence/** (the manifest-declared owner); its
  workflow-runtime and release-conformance implementation mappings are reconciled by
  g0-traceability-conformance at milestone convergence.
- `g0-security-perimeter`: Stand up the permanent read-only security perimeter: append-only
  hash-chained audit chain with continuous verification, phishing-resistant step-up authentication
  primitives, deny-by-default egress/SSRF controls with rebinding tests, untrusted-content
  isolation, secrets and supply-chain policy, Alpha Lab import gating (approved non-executable
  schemas only, signature/hash/producer-trust verification, quarantine and content scanning, no
  direct policy activation), tenant-isolation and abuse-control primitives, incident process, and
  automated static/runtime proofs that no trading, custody, wallet-signing, private-key, or
  transaction-submission capability exists anywhere in the codebase.
- `g0-tool-core`: Implement the Shared Tool Core: a central versioned tool registry driving the
  exact authenticate-authorize-validate-cache-single-flight-quota-reserve-execute-audit pipeline
  with provenance, event-time, quality, and evidence envelopes; narrow actor/tool profiles; cache
  and cross-mode single-flight semantics; atomic quota reservation/commit/release; license-policy
  enforcement; and permanent prohibited-financial enforcement. The quota reservation/commit/release
  stage and the license-policy source land as stable extension-point interfaces (contracts plus
  dependency-injection seams) so later packages implement cost and quota semantics entirely outside
  packages/tool-core/** without editing it.
- `g0-cost-capacity`: Operate the free-first cost, quota, and sustainable-capacity control plane:
  declared cost classes, quota units, reset policies, and STRICT_FREE permission for every provider
  operation; STRICT_FREE blocking of paid, unknown-cost, and fallback operations with audited
  denials; protected reserves; degrade-breadth/depth-before-protected-quota; batch coalescing and
  exact-cache/single-flight ahead of reservation; verified-plan cost forecasts; separately activated
  paid-provider mode; and independently capped
  scheduler/workflow/database/object-store/notification/model resource budgets with data-provider
  STRICT_FREE independent from any configured BYOK model budget. Cost and quota semantics implement
  the tool-core extension-point interfaces without editing packages/tool-core/**.
- `g0-first-party-observation`: Provide bounded first-party observation: the versioned allowlisted
  Solana collector and protocol registry (Pump bonding curve/PumpSwap, Raydium AMM
  v4/CPMM/CLMM/Stable AMM/LaunchLab, Orca Whirlpools, Meteora DLMM/DAMM v1-v2/DBC, Jupiter route
  observation) with durable monotonic checkpoints, gap detection and non-backdating backfill,
  reorg-safe immutable revisions, decode-drift incident pausing, deterministic bounded failover,
  Sustainable Capacity Contract ceilings, health and first-seen timing metrics, and zero
  signing/wallet capability; plus the point-in-time discovery-universe registry making free
  aggregate discovery the default broad-universe path, with complete first-seen attribution, finite
  batch-oriented monitoring, and deterministic versioned candidate promotion. External collector
  access flows through the security perimeter's egress controls and audited read-only adapter layer.
- `g0-mcp-surface`: Expose the MCP Streamable HTTP surface: tools, resources, and prompts served
  from the Shared Tool Core registry with structured output and pagination; per-client
  authentication, profiles, quotas, and revocation plus personal bearer mode; exact scheme-host-port
  Origin allowlist rejection (HTTP 403) before session creation or any side effect; mutually tested
  transport protocol versions, content types, session identifiers, resumable-event ownership,
  message size limits, and per-client rate/concurrency limits; and authorization re-evaluated on
  every call and resource fetch - strictly read-only with no trading, custody, or signing capability
  exposed to any client.
- `g0-traceability-conformance`: Close the milestone with release-blocking traceability: the
  machine-readable requirement manifest kept authoritative and integrity-checked, globally unique
  and stable requirement/acceptance/invariant/artifact IDs with explicit supersession links, CI
  conformance that fails on unmapped normative items, orphaned code paths, or implementations
  outside their dependency gate, signed and hashed evidence artifacts for
  manual/legal/rights/approval gates, per-decision requirement/policy/model/tool/version
  traceability, and reproducible release reports with document, manifest, migration, SBOM hashes,
  conformance results, activation state, and rollback target. This package is also the central
  generator of all docs/generated/<family>-surfaces.json surface mappings and reconciles
  telemetry/surface mapping ownership across the milestone at convergence.

<!-- Seeded normative content ends here. Planner-owned sections (integration notes,
     invariants, open points resolved from authoritative sources) go below this line. -->

## Scope statement

This package owns **provider operation lifecycle truth**: the versioned operation
registry and its seven-state lifecycle, verification-TTL enforcement that fails closed, the
deprecation/migration-exception rules that bind new implementations, audited read-only adapters
bound to exact egress allowlists (GMGN strictly query-only, Helius supported raw/history
operations as the two safety-critical reference families), response quarantine, rights-change
fail-closed handling, and source fingerprints for empirical dependence analysis. All work lands
inside the binding write scopes:

```text
packages/provider-lifecycle/**            packages/providers/**
packages/shared-schemas/**                migrations/g0_prov_*.sql
tests/fixtures/prov/**                    tests/acceptance/**
tests/negative/**                         telemetry/prov.*
docs/provider-rights/**
```

`tests/acceptance/**` and `tests/negative/**` are shared milestone scopes: this package ADDS the
four missing manifest-declared suites (AC-270…273, both directions) and must leave the forty
suites already delivered by proven dependencies untouched and green.

## Binding elaboration from the authoritative contract

Where the seeded quotes above are compressed, the following PRD sections bind this package's
design. All citations are to `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`.

### FR-PROV-001 — lifecycle states and registry truth (§12.11, §15.3, §15.4)

- §12.11 fixes the state alphabet (`DISCOVERED`, `VERIFIED`, `ACTIVE`, `DEGRADED`, `DEPRECATED`,
  `BLOCKED`, `REMOVED`) and the transition rule: documentation/plan/rights/schema/deprecation and
  live-probe expiry may move an operation out of `ACTIVE` **without changing stored historical
  evidence** — lifecycle truth is a control-plane projection, never a mutation of evidence.
- §15.3 defines `ProviderOperationDefinition` (providerId, operationId, version,
  capabilityClass, supportedChains/Programs, input/rawOutput/normalizedOutputSchemaIds,
  quotaModelId, cachePolicyId, timeoutMs, retryPolicyId, declaredIndependenceGroup,
  upstreamLineage, licensePolicyId, costClass, quota fields, batchCapability,
  protectedReserveEligible, allowedInStrictFree, paidFallbackAllowed, deprecatedAt, sunsetAt,
  replacementOperationId, verificationExpiresAt, forbiddenOutputFields, negativeCapabilities).
  The registry stores exactly this shape (versioned, immutable per version).
- §15.4 fixes the per-operation health vocabulary (`HEALTHY`, `DEGRADED`, `SCHEMA_DRIFT`,
  `PLAN_UNVERIFIED`, `RIGHTS_UNVERIFIED`, `DEPRECATED`, `SUNSET_PENDING`, `QUOTA_LOW`,
  `QUOTA_EXHAUSTED`, `AUTH_FAILED`, `UNSUPPORTED`, `DISABLED`) tracked per operation, region /
  endpoint, plan, chain, and relevant program/version. "Affected features" means the feature- and
  tool-dependency registrations that reference an operation; they are first-class registry rows so
  deprecation can name its blast radius.

### FR-PROV-002 — verification TTLs fail closed (§15.4, §40)

- Eight verification kinds are named by the requirement text (documentation, pricing/plan, quota,
  rights, schema, endpoint, authentication, deprecation) plus the live-probe freshness demanded by
  FR-PROV-001's "last live probe". Each kind has a configured TTL and a verification record
  carrying evidence references.
- §15.4 rule 3 binds expiry outcomes: expired plan/rights/schema verification transitions the
  operation to `PLAN_UNVERIFIED`, `RIGHTS_UNVERIFIED`, or `DEGRADED`; rule 4 adds the
  `STRICT_FREE` consequence (an operation whose free-plan availability is not current and proven is
  blocked there). Expiry prevents **new active use of decision-critical fields** until
  reverification; already-stored evidence is untouched (INV-005/INV-006).
- AC-270 fixes the refresh bar: a successful **official-doc** verification AND a successful
  **live-contract** verification are jointly required before active decision use resumes.

### FR-PROV-003 — deprecation rules for new implementations (§15.4)

- Rule 1: `deprecatedAt` blocks new feature dependency unless an approved migration exists.
- Rule 2: a sunset date or official deprecation notice creates an incident and a migration
  deadline (incident creation goes through the security package's incident API).
- Rule 6: a deprecated operation cannot remain the sole source for a critical field.
- The escape hatch is narrow and explicit: a **time-bounded** migration exception with an approved
  replacement plan. Exceptions carry expiry instants; an expired exception re-blocks new
  implementations automatically (fail-closed).

### FR-PROV-004 — adapters only, never wholesale bundles (§35.7, §15.2, §41.1)

- Provider SDKs/MCP servers/skills/plugins/packages exposing trading, signing, wallet, swap,
  transaction-building, private-key, or arbitrary-request capability are never installed or exposed
  wholesale; capability arrives only as individually registered, audited read-only operation
  adapters.
- §15.2's capability class vocabulary includes `PROHIBITED_TRANSACTION_BUILD`, `PROHIBITED_SIGN`,
  `PROHIBITED_SUBMIT`, `PROHIBITED_CUSTODY`; these cannot be enabled by configuration (§41.1),
  and their presence in an installed dependency or provider bundle creates a negative-capability
  review and isolation requirement. Adapter registration validates the declared capability class
  and REFUSES prohibited classes outright.

### FR-PROV-005 — exact per-adapter allowlists (§35.3 cooperation, §15.3)

The eleven enforced dimensions split across two layers:

| Layer                                    | Dimensions                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `EgressGuard` (security package, reused) | scheme, host, port, redirect policy, maximum bytes, DNS/IP policy, TLS, byte/time limits |
| Adapter contract layer (this package)    | path template, HTTP method, content type(s), request fields, response schema             |

Deny-by-default holds in both layers: anything not explicitly declared for the adapter's
operation refuses with a typed reason.

### FR-PROV-006 — GMGN strictly query-only (§15.8 GMGN)

Only allowlisted query operations may be integrated. GMGN skills, MCP bundles, SDK modules, or
credentials enabling swap, transaction construction, signing, custody, or private-key use MUST NOT
be installed in production. No GMGN private key, wallet seed, hosted-wallet trading credential,
route key, swap endpoint, transaction payload, or order-status tool exists in environment schemas,
tool registries, dependencies, prompts, or tests except as a forbidden fixture. Contract tests
enumerate exposed operations and fail if a trading-related operation appears.

### FR-PROV-007 — Helius raw/history + local decoding (§15.8 Helius, §39 AC-256)

New code MUST NOT rely on deprecated Enhanced Transactions parsing as the authoritative
transaction-history path. Raw `getTransaction`, standard signature history, current plan-gated
history operations, and deterministic program decoding are separated. A plan-gated operation
unavailable in the active free plan remains disabled in `STRICT_FREE`. Provider-parsed transaction
output is supporting evidence only; normalized economic events require deterministic
coverage/quality checks. This package owns the deprecation registries (deprecatedAt, sunsetAt,
replacementOperationId per operation) that the security package's landed decoder-authority
validator consumes; retaining the enhanced parser as non-authoritative evidence requires a valid
migration exception from FR-PROV-003's registry.

### FR-PROV-008 — response quarantine (§15.8 DEX/quote SDKs, §39 AC-271)

A provider response containing transaction payloads, signing requests, executable instructions,
private-key fields, or unexpected write capability is rejected, quarantined, audited, and excluded
from model context. The DEX/quote-SDK rule generalizes: transaction-building output fields are
rejected, stripped before persistence, and unavailable to the agent. Quarantine records keep
detection class, field paths, hashes, and sizes — never the hazardous payload material itself
(private-key material must not be persisted even for forensics).

### FR-PROV-009 — rights/plan changes fail closed (§15.6, §39 AC-273)

Each operation declares the sixteen-field data-rights matrix (commercial_use_allowed,
personal_research_allowed, cache_allowed, maximum_cache_duration, raw_retention_allowed,
derived_features_allowed, model_training_allowed, redistribution_allowed,
public_alert_derivative_allowed, attribution_required, user_byok_required, raw_export_allowed,
jurisdiction_restrictions, terms_version, verified_at, verification_expires_at — note the last two
tie rights into the TTL engine of FR-PROV-002). Rights enforcement ultimately occurs in Tool Core,
export, model-context assembly, alert rendering, public publishing, and Alpha Lab manifests; this
package delivers the versioned declarations, the change-diff engine, the immediate fail-closed
decisions across storage / derived use / redistribution / caching / export paths, and the
enumeration of previously stored artifacts that become restricted (each mapped to quarantine or
retire actions per the updated policy). Consumer wiring lands where those subsystems land.

### FR-PROV-010 — source fingerprints (§15.7)

Provider count is not evidence independence. Each operation declares upstream lineage while the
fingerprint store captures, per operation/version: value/error correlation inputs, update and
first-seen timing correlation inputs, shared rounding/schema/fingerprint behavior, shared
outage/rate-limit windows, revision and lag patterns, identical missingness or ranking changes,
and known contractual/indexer lineage. The target dependence vocabulary is
`INDEPENDENT_WITHIN_TESTED_SCOPE`, `PARTIALLY_DEPENDENT`, `HIGHLY_DEPENDENT`, `UNKNOWN_DEPENDENCE`,
`SAME_UPSTREAM`. Fingerprint capture and storage are owned here; the `ProviderDependenceEstimator`
consumer lands with the evaluation stack (recorded as a non-goal boundary).

## Shared acceptance criteria — scoped obligations

All fourteen ACs attach to every assigned requirement. Ten suites already exist and pass (landed
by `g0-security-perimeter`, whose family shares AC-250…259); four are NEW and fully owned here.
"Implement once, satisfy everywhere" resolves per criterion as follows:

| ID     | Scoped obligation in this package                                                                                                                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-250 | MCP Origin primitive complete in `g0-security-perimeter`; no provider-side delta. Regression guard only: existing suites stay green.                                                                                                                                                                                      |
| AC-251 | MCP protocol guard complete in `g0-security-perimeter`; regression guard only.                                                                                                                                                                                                                                            |
| AC-252 | Cross-tenant resource authorization complete in `g0-security-perimeter`; regression guard only.                                                                                                                                                                                                                           |
| AC-253 | OAuth token-binding validators complete in `g0-security-perimeter`; regression guard only.                                                                                                                                                                                                                                |
| AC-254 | Registry-level complement to the landed scan surfaces: every registered operation carries `negativeCapabilities` metadata; adapter registration refuses `PROHIBITED_*` capability classes; the tree-level scans stay green over both new packages.                                                                        |
| AC-255 | Real-surface complement to the landed policy-layer GMGN pair: the actual GMGN adapter enumerates ONLY query operations (contract-test assertion), and forbidden trading-shaped registration/runtime variants are refused by this package's own validation.                                                                |
| AC-256 | The deprecation registries explicitly reserved for this package land here (Helius enhanced-parser operation marked deprecated with replacement pointer); the landed decoder-authority validator passes against the REAL registry entries; raw/history + local-decoding configuration remains the only authoritative path. |
| AC-257 | Every adapter outbound call flows through the security `EgressGuard` with the adapter's exact allowlist; the adapter contract layer adds method/path-template/content-type/request-field/response-schema/max-bytes batteries in package suites; the landed SSRF fixtures stay green.                                      |
| AC-258 | Provider responses reach model context only through the landed untrusted-content envelope labeled as provider text; quarantined content provably never reaches any envelope (integration assertion in package suites).                                                                                                    |
| AC-259 | Lifecycle transitions, verification expiries/refreshes, quarantines, and rights changes are audited through the landed hash-chained `AuditChain` (provider/blocked-operation/rights-change action classes); the chain's own corruption suites stay green.                                                                 |
| AC-270 | **Fully owned** — new positive AND negative suites: expired documentation/plan/rights/schema/deprecation verification moves the affected operation out of active decision use; only a successful official-doc AND live-contract verification refresh restores it.                                                         |
| AC-271 | **Fully owned** — new positive AND negative suites: each malicious-response class rejected, quarantined, audited, excluded from evidence/model context; clean responses still flow.                                                                                                                                       |
| AC-272 | Provider-side readiness inputs fully owned: a readiness evaluator over rights verification, lifecycle state, and prohibited-operation exposure reports BLOCKED until provider evidence passes; workspace/public gate machinery itself belongs to later packages (boundary recorded below).                                |
| AC-273 | **Fully owned** — new positive AND negative suites: a rights tightening immediately blocks newly prohibited cache/raw-retention/export/redistribution/model-use paths and enumerates existing affected artifacts for quarantine/retirement.                                                                               |

## Applicable architecture invariants (manifest §45 controls)

All ten invariants are declared controls for every requirement in this package:

| ID      | Text (PRD §45)                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-001 | "The system is permanently read-only with respect to financial execution, custody, signing, and transaction construction."                                                |
| INV-002 | "Agent intelligence never replaces deterministic identity, evidence, time, execution, risk, capability, rights, cost, quota, capacity, or policy controls."               |
| INV-003 | "No automated external side effect occurs directly from model output."                                                                                                    |
| INV-004 | "Every retained decision is reconstructable from frozen evidence, availability, acquisition state, configuration, code, adapter, and artifact versions."                  |
| INV-005 | "Historical replay uses only data and learned artifacts actually available to the system at the simulated time."                                                          |
| INV-006 | "Backfilled historical data is never backdated into production replay."                                                                                                   |
| INV-007 | "Evaluation includes alerts, watches, ignores, rejects, below-cutoff cases, exploration/control cases, and missed opportunities under symmetric action-time semantics."   |
| INV-008 | "Provider count is not source independence; declared lineage and empirical dependence both constrain effective confirmation."                                             |
| INV-009 | "A durable workflow or collector may retry; every state transition and external side effect remains idempotent and fenced."                                               |
| INV-010 | "The primary policy objective is conservative net shadow-portfolio utility under finite capital and hard constraints, not isolated price appreciation or alert win rate." |

Directly load-bearing here: INV-001 (the adapter layer exists to prove read-only provider access;
nothing may introduce a prohibited capability, not even in fixtures outside the sanctioned corpus),
INV-002 (TTL expiry, deprecation blocks, and rights blocks are deterministic gates no agent can
negotiate around), INV-003 (quarantine severs every path from provider content to side effects),
INV-004 (append-only transition ledger keeps lifecycle history reconstructable with evidence
references), INV-005 (replay resolves the original operation/version while current execution uses
only active replacements — §15.4 rule 5), INV-008 (fingerprints exist so empirical dependence can
constrain confirmation), INV-009 (idempotency keys fence lifecycle transitions and verification
records under retry).

## Accepted ADRs directly binding this package

Quoted/summarized from Appendix D of the authoritative PRD (all ACCEPTED there):

- **ADR-001**: PostgreSQL is authoritative for operational state; SQL migrations are the schema
  source of truth; unique constraints, transactions, locks, leases with fencing tokens enforce
  correctness — the lifecycle registry and transition ledger are ordinary SQL truth.
- **ADR-054**: Provider operations carry expiring verification; deprecated/unknown operations fail
  closed; bundles exposing trading/signing/transaction/private-key/custody/execution capability are
  decomposed to allowlisted read-only adapters only. This ADR IS this package's mandate.
- **ADR-058**: Hash drift, orphan items, prohibited capabilities, or unresolved release-blocking
  deviations fail CI/release — the registry's contract tests and negative fixtures are
  CI-runnable gates, not conventions.
- Repository ADRs binding implementation patterns: **ADR-0013** (Zod is the single approved
  runtime-validation library; authoritative schemas live in `packages/shared-schemas`),
  **ADR-0014** (PGlite is the deterministic in-process PostgreSQL TEST engine; production remains
  real PostgreSQL).

## Explicit scope boundaries within the milestone

Beyond the seeded per-package non-goals above, the following boundaries are recorded so review
cannot misread them as gaps:

- `docs/generated/prov-surfaces.json` appears in the manifest's apiToolUiRefs for this family but
  is generated CENTRALLY by `g0-traceability-conformance` at milestone convergence (milestone-level
  planning decision); this package produces none of `docs/generated/**`.
- The remaining §15.1 provider groups (DEX Screener, GoPlus, Honeypot.is, CoinGecko Onchain,
  Alchemy, DefiLlama, Moralis, Santiment, LunarCrush, standard Solana RPC, DEX/launchpad program
  decoders, the first-party collector) register through the SAME declarative definition format and
  adapter framework delivered here; their concrete adapters arrive with the packages/milestones
  that consume them. Absence of credentials or rights changes availability, never implementation
  completeness of the lifecycle substrate (§15.1).
- Cost classes, quota units/reservations, and STRICT_FREE budget semantics belong to
  `g0-cost-capacity` via the tool-core extension points; this package supplies the per-operation
  declaration fields (`costClass`, `allowedInStrictFree`, plan-availability verification state) that
  plane will consume, and implements none of the budget arithmetic.
- The `ProviderDependenceEstimator` and alert-policy consumption of effective independence land
  with the evaluation stack; this package captures and stores the fingerprints they will read.
- Workspace/public activation gate MACHINERY (OAuth, disclosures, claims, jurisdiction evidence)
  belongs to later packages; AC-272's provider-side readiness inputs land here as the documented
  contribution contract.

## Package success criteria

1. All ten assigned requirements have executable positive AND negative/failure-path verification:
   the fourteen manifest-declared AC suites green at HEAD — including the FOUR new suites
   (AC-270…273 × acceptance/negative) this package lands — plus colocated package suites.
2. Both milestone verification commands green:
   `pnpm --filter @foresift/provider-lifecycle test` and `pnpm --filter @foresift/providers test`.
3. The registry enforces the §12.11 state alphabet with a legal-transition graph, idempotent
   fenced transitions (INV-009), and expiry sweeps that are deterministic under an injected clock.
4. The GMGN adapter enumerates ONLY query operations under contract test; the Helius integration
   separates raw/history operations and local decoding; both bind every outbound call to exact
   per-adapter allowlists through the security `EgressGuard`.
5. The quarantine pipeline rejects, quarantines, audits, and excludes-from-context every declared
   malicious-response class, persisting detection metadata but never hazardous payload material.
6. A rights/plan tightening immediately blocks newly prohibited storage/derived-use/
   redistribution/cache/export paths and enumerates previously stored affected artifacts to
   quarantine or retire actions.
7. Migrations apply cleanly to empty databases alongside the proven `g0_data_*`/`g0_dr_*`/
   `g0_sec_*` sets; `pnpm verify` and `pnpm spec:verify` pass at the pushed HEAD.
8. No template placeholders remain in any scoped artifact; every task traces to an assigned
   requirement or its acceptance criteria; no prohibited capability exists anywhere in delivered
   code, configuration, documentation, or fixtures outside sanctioned forbidden fixtures.

## Assumptions

- PGlite serves as the deterministic migration/repository test engine (repository ADR-0014);
  production remains real PostgreSQL per product ADR-001.
- No test performs live network access: HTTP transport sits behind an injectable fetch seam, and
  all wire traffic in suites is served from sanitized recorded fixtures under `tests/fixtures/prov/`.
- Adapters ship disabled-by-default; absent credentials degrade availability, never implementation
  completeness (§15.1). Authentication material enters only through configuration seams and never
  enters git, logs, or fixtures.
- Verification timestamps come exclusively from the injected `ClockPort`; no wall-clock reads in
  decision logic (determinism, Constitution XI).
- Telemetry definitions are declarative contracts under `telemetry/prov.*` mirroring the
  established catalog format; emitter wiring lands with observability in a later milestone.
- Malicious-response fixtures (forbidden fixtures) contain inert structural markers proving the
  scanner detects each class — no real key material, no executable content, no resolvable imports.
