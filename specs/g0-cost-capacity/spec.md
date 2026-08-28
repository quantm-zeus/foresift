# g0-cost-capacity — scoped specification

> This file is a SUBORDINATE DERIVATIVE of the authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`. It was seeded mechanically from
> the requirement manifest by `scripts/automation/bootstrap-package-spec.mjs` (builder v1). The PRD
> always wins over any wording below.

## Authority binding

- Milestone: `G0` (ACTIVE)
- Objective: Operate the free-first cost, quota, and sustainable-capacity control plane: declared
  cost classes, quota units, reset policies, and STRICT_FREE permission for every provider
  operation; STRICT_FREE blocking of paid, unknown-cost, and fallback operations with audited
  denials; protected reserves; degrade-breadth/depth-before-protected-quota; batch coalescing and
  exact-cache/single-flight ahead of reservation; verified-plan cost forecasts; separately activated
  paid-provider mode; and independently capped
  scheduler/workflow/database/object-store/notification/model resource budgets with data-provider
  STRICT_FREE independent from any configured BYOK model budget. Cost and quota semantics implement
  the tool-core extension-point interfaces without editing packages/tool-core/**.
- Risk: HIGH · writeScopes: `packages/cost-router/**`, `packages/capacity-planner/**`,
  `packages/quota-forecast/**`, `packages/shared-schemas/**`, `migrations/g0_cost_*.sql`,
  `tests/fixtures/cost/**`, `tests/acceptance/**`, `tests/negative/**`, `telemetry/cost.*`
- Dependencies: `g0-tool-core` PROVEN, `g0-provider-lifecycle` PROVEN
- Bound inputs at seed time: main `b4978cdbf332`, manifest `e0f9f1284473`, PRD `baa521d9c67e`

## Assigned requirements (normative text quoted verbatim)

### FR-COST-001 — 38. Functional requirements catalogue (PRD line 6132)

> Every provider operation declares cost class, quota-unit cost, reset policy, batch capability,
> minimum candidate stage, reserve eligibility, and `STRICT_FREE` permission.

Normative level: MUST. Acceptance criteria: all 12 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/cost.ts`
- Fixture refs: `tests/fixtures/cost/`
- Telemetry refs: `telemetry/cost.*`

### FR-COST-002 — 38. Functional requirements catalogue (PRD line 6133)

> `STRICT_FREE` blocks paid, unknown-cost, overage, automatic-upgrade, and paid-fallback operations.

Normative level: MUST. Acceptance criteria: all 12 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/cost.ts`
- Fixture refs: `tests/fixtures/cost/`
- Telemetry refs: `telemetry/cost.*`

### FR-COST-003 — 38. Functional requirements catalogue (PRD line 6134)

> Protected reserves exist for risk monitoring, alert verification, interactive MCP, and emergency
> backfill.

Normative level: MUST. Acceptance criteria: all 12 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/cost.ts`
- Fixture refs: `tests/fixtures/cost/`
- Telemetry refs: `telemetry/cost.*`

### FR-COST-004 — 38. Functional requirements catalogue (PRD line 6135)

> Broad scans degrade breadth/depth before consuming protected quota.

Normative level: MUST. Acceptance criteria: all 12 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/cost.ts`
- Fixture refs: `tests/fixtures/cost/`
- Telemetry refs: `telemetry/cost.*`

### FR-COST-005 — 38. Functional requirements catalogue (PRD line 6136)

> Provider calls are batch-coalesced where supported and exact-cache/single-flight precede quota
> reservation.

Normative level: MUST. Acceptance criteria: all 12 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/cost.ts`
- Fixture refs: `tests/fixtures/cost/`
- Telemetry refs: `telemetry/cost.*`

### FR-COST-006 — 38. Functional requirements catalogue (PRD line 6137)

> Cost forecasts use current verified provider plan metadata and observed usage.

Normative level: MUST. Acceptance criteria: all 12 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/cost.ts`
- Fixture refs: `tests/fixtures/cost/`
- Telemetry refs: `telemetry/cost.*`

### FR-COST-007 — 38. Functional requirements catalogue (PRD line 6138)

> Blocked cost operations are audited with candidate, caller, reason, and alternative behavior.

Normative level: MUST. Acceptance criteria: all 12 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/cost.ts`
- Fixture refs: `tests/fixtures/cost/`
- Telemetry refs: `telemetry/cost.*`

### FR-COST-008 — 38. Functional requirements catalogue (PRD line 6139)

> Paid data-provider mode requires a separate immutable policy, explicit budget, approval,
> activation, and re-authentication.

Normative level: MUST. Acceptance criteria: all 12 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/cost.ts`
- Fixture refs: `tests/fixtures/cost/`
- Telemetry refs: `telemetry/cost.*`

### FR-COST-009 — 38. Functional requirements catalogue (PRD line 6140)

> Scheduler, workflow, database, object-store, notification, and model resource budgets are forecast
> and independently capped.

Normative level: MUST. Acceptance criteria: all 12 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/cost.ts`
- Fixture refs: `tests/fixtures/cost/`
- Telemetry refs: `telemetry/cost.*`

### FR-COST-010 — 38. Functional requirements catalogue (PRD line 6141)

> Data-provider `STRICT_FREE` is independent from an explicitly configured BYOK model budget.

Normative level: MUST. Acceptance criteria: all 12 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/cost.ts`
- Fixture refs: `tests/fixtures/cost/`
- Telemetry refs: `telemetry/cost.*`

## Shared acceptance criteria

Attached to more than one requirement of this package — implement once, satisfy everywhere:

- **AC-100** · positive: `tests/acceptance/AC-100.spec.ts` · negative/failure:
  `tests/negative/AC-100.negative.spec.ts` — attached to 10 requirements
- **AC-101** · positive: `tests/acceptance/AC-101.spec.ts` · negative/failure:
  `tests/negative/AC-101.negative.spec.ts` — attached to 10 requirements
- **AC-102** · positive: `tests/acceptance/AC-102.spec.ts` · negative/failure:
  `tests/negative/AC-102.negative.spec.ts` — attached to 10 requirements
- **AC-103** · positive: `tests/acceptance/AC-103.spec.ts` · negative/failure:
  `tests/negative/AC-103.negative.spec.ts` — attached to 10 requirements
- **AC-104** · positive: `tests/acceptance/AC-104.spec.ts` · negative/failure:
  `tests/negative/AC-104.negative.spec.ts` — attached to 10 requirements
- **AC-105** · positive: `tests/acceptance/AC-105.spec.ts` · negative/failure:
  `tests/negative/AC-105.negative.spec.ts` — attached to 10 requirements
- **AC-224** · positive: `tests/acceptance/AC-224.spec.ts` · negative/failure:
  `tests/negative/AC-224.negative.spec.ts` — attached to 10 requirements
- **AC-225** · positive: `tests/acceptance/AC-225.spec.ts` · negative/failure:
  `tests/negative/AC-225.negative.spec.ts` — attached to 10 requirements
- **AC-226** · positive: `tests/acceptance/AC-226.spec.ts` · negative/failure:
  `tests/negative/AC-226.negative.spec.ts` — attached to 10 requirements
- **AC-227** · positive: `tests/acceptance/AC-227.spec.ts` · negative/failure:
  `tests/negative/AC-227.negative.spec.ts` — attached to 10 requirements
- **AC-228** · positive: `tests/acceptance/AC-228.spec.ts` · negative/failure:
  `tests/negative/AC-228.negative.spec.ts` — attached to 10 requirements
- **AC-229** · positive: `tests/acceptance/AC-229.spec.ts` · negative/failure:
  `tests/negative/AC-229.negative.spec.ts` — attached to 10 requirements

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
- `g0-provider-lifecycle`: Deliver provider operation lifecycle truth: stateful lifecycle
  (DISCOVERED through REMOVED) with documentation/pricing/rights verification TTLs that fail closed,
  deprecation rules for new implementations, audited read-only adapters bound to exact egress
  allowlists (GMGN strictly query-only, Helius supported raw/history operations), quarantine of
  responses carrying transaction payloads or key material, rights-change fail-closed handling, and
  source fingerprints for empirical dependence analysis.
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
## Invariants and cross-cutting rules

The following invariants from the requirement manifest bind this package's implementation (see `INV-*` in the manifest's `securityRightsCostControls`). They are quoted here for convenience but the PRD text wins on any conflict:

- **INV-001** — System is permanently read-only re financial execution/custody/signing/transaction construction. Cost routing never creates trading/signing surfaces.
- **INV-002** — Intelligence never replaces deterministic cost/quota/capacity/policy controls. Cost admission is deterministic policy, not model output.
- **INV-004** — Every retained decision is reconstructable from frozen evidence, availability, acquisition state, configuration, code, adapter, and artifact versions.
- **INV-009** — Durable collector/workflow may retry; every state transition and external side effect remains idempotent and fenced.
- **INV-010** — Primary objective is conservative shadow-portfolio utility under finite capital and hard constraints, not isolated price appreciation.

Additional binding product rules (PRD §33–37, §9.5; see capsule line anchors) that this package must satisfy: cost admission is fail-closed on unknown/unverified cost; BYOK model budget is a separate namespace from data-provider STRICT_FREE; paid-provider activation is a distinct immutable policy with explicit approval/activation/re-authentication.

## Integration points

### Upstream dependencies (PROVEN, consumed as-is)

- **g0-tool-core** — Operation registry contracts (tool definitions), exact 24-stage pipeline ordering (§16.2), reservation lifecycle SQL guards, license-verdict wiring, envelope meta types. This package MUST NOT edit `packages/tool-core/**`; it binds to the stable seams `QuotaReservationAdapter` and `LicensePolicySource` via composition-root dependency injection.
- **g0-provider-lifecycle** — Provider operation definitions in `prov.prov_operations` (costClass, quotaModelId, estimatedQuotaUnits, quotaResetPolicyId, batchCapability, protectedReserveEligible, allowedInStrictFree, verificationExpiresAt). Cost declarations and verification TTLs are authoritative there; this package reads them, never writes `prov.**` rows.
- **g0-contracts-data-truth** — Persistence engine (`DatabaseEngine`), migration runner, domain vocabularies, shared-schema primitives.

### Owned interfaces exposed downstream

| Interface | Package | Consumer |
|-----------|---------|----------|
| `QuotaReservationAdapter` (cost semantics) | `packages/cost-router` | `packages/tool-core` composition root (stages 12/13/18) |
| `LicensePolicySource` (paid-provider verdicts) | `packages/cost-router` | `packages/tool-core` cache-key + license stage |
| Capacity admission + backpressure policy | `packages/capacity-planner` | `packages/tool-core` stage 12 policy hook |
| Cost forecast provider | `packages/quota-forecast` | planner, audit/incidents |

### State ownership

- `prov.prov_operations` — **read-only** from this package (provider-lifecycle owns writes).
- `core.core_quota_reservations` — written via `QuotaReservationAdapter.reserve/commit/release` using the guarded SQL helpers already proven in `packages/tool-core/src/quota-contract.ts`; new cost-specific columns/constraints land in `migrations/g0_cost_*.sql` (cost tables, quota balances, reserve buckets, capacity ceilings).
- `core.exact_cache` / `core.single_flight_leases` — read indirectly through pipeline cache stages; batch coalescing and ahead-of-reservation semantics (§16.4/§16.6) are enforced by ensuring stages 6–11 run before 12 per the frozen sequence.

## Domain model for this package

The package extends — not replaces — the provider-operation row. Cost semantics are a **policy layer** over the operation registry's declared fields.

- **OperationCostDeclaration** (view over `prov_operations`): costClass ∈ {FREE_UNMETERED,FREE_QUOTA,PAID_EXPLICIT,UNKNOWN_COST,DISABLED}, quotaModelId, estimatedQuotaUnits, quotaResetPolicyId, batchCapability (nullable JSON), minimumCandidateStage, protectedReserveEligible, allowedInStrictFree. Every operation declares all seven; absence fails closed (FR-COST-001).
- **CostClass policy** (`STRICT_FREE` default; paid modes are separately activated): STRICT_FREE admits only operations where `allowedInStrictFree === true` and costClass ∈ {FREE_UNMETERED,FREE_QUOTA} and verification is current; blocks paid/unknown/overage/auto-upgrade/paid-fallback before network execution with `COST_BLOCKED` and an audited denial carrying candidate, caller, reason, alternative (FR-COST-002, FR-COST-007).
- **Protected reserves**: named quota buckets for risk-monitoring, alert-verification, interactive-MCP, emergency-backfill. Each has an independent cap/remaining ledger; consumption by those workload classes bypasses broad-scan exhaustion via reservation priority; exhaustion of the general pool degrades breadth/depth instead of invading reserves (FR-COST-003/004).
- **Batch coalescing controller**: when `batchCapability !== null`, groups compatible requests up to the provider's maximum safe batch size, charges one reservation per provider call, and respects the exact-cache/single-flight ordering (§16.4 narrowly ahead of reservation) (FR-COST-005).
- **Quota/capacity ledgers**: per-provider/per-period balances keyed by `(providerId, quotaModelId, periodWindow)`, updated atomically on reserve/commit/release/expire using the existing guarded UPDATE helpers. Forecast provider computes estimated-vs-actual deltas against current **verified** plan metadata; unverified metadata transitions operations to UNVERIFIED/blocked (FR-COST-006).
- **Paid-provider activation**: an immutable `paid_provider_policies` row (budget, approver, activationAt, reAuthDueAt). No paid data-provider call succeeds unless a verified active paid policy exists; re-authentication gates renew it (FR-COST-008/010).
- **Independent resource budgets** (FR-COST-009): six ceilings — scheduler slots, workflow steps, DB growth, object-store bytes, notification rate, model tokens. Each has a forecast model, a current-usage counter, and an admit-or-degrade decision. BYOK model budget lives in the model namespace and never lifts data-provider STRICT_FREE.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Unknown/UNKNOWN_COST priced as free | Fail-closed: any missing/unknown costClass or quota estimate throws `UNKNOWN_COST` and blocks at stage 12 (never falls through to reserve). Negative tests assert this path. |
| Protected reserve invaded under scan pressure | Degrade logic runs before reserve lookup; integration tests assert reserve counters untouched when broad scans exhaust general pool (AC-101/AC-228). |
| Batch batching hides quota cost | Batch coalescing is observable: one reservation per provider call, batch size emitted in telemetry; forecast recomputes cost from observed batch size. |
| Paid fallback silently activated | `paidFallbackAllowed` defaults false; STRICT_FREE refuses any operation where `paidFallbackAllowed` would be consulted without a verified paid policy. |
| Unverified plan metadata keeps old free limits | Freshness check on `verificationExpiresAt` at estimate time; expiry transitions to UNVERIFIED/COST_BLOCKED rather than honoring stale limits (AC-103). |
| Model BYOK budget lifts data-provider STRICT_FREE | Namespace isolation: model-budget adapter and data-provider adapter are disjoint injection bindings; no shared counter. AC-105 exercises both simultaneously. |
| Migration ordering race with tool-core/provider-lifecycle | Migrations are additive and named `g0_cost_*.sql`; runner enforces ordered application; no table owned by another package is altered. |

## Non-goals reaffirmed

- No trading, custody, wallet signing, transaction submission, or key handling (INV-001 permanent).
- No provider adapter implementation (owned by provider-lifecycle).
- No pipeline ordering or reservation SQL state-machine changes (owned by tool-core).
- No telemetry emission wiring beyond the declarative catalog in `telemetry/cost.*` (G2 observability milestone owns emitters).

## Open points — resolved

No planning TODOs remain. All requirement semantics needed for planning are present in the capsule's requirement quotes, the AC texts, and the PRD line anchors cited there. Where the PRD's detailed cost-table prose (e.g., §33–37) is needed at build time, implementers open those sections at the capsule's anchors on demand.
