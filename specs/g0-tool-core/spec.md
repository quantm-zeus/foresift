# g0-tool-core — scoped specification

> This file is a SUBORDINATE DERIVATIVE of the authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`. It was seeded mechanically from
> the requirement manifest by `scripts/automation/bootstrap-package-spec.mjs` (builder v1). The PRD
> always wins over any wording below.

## Authority binding

- Milestone: `G0` (ACTIVE)
- Objective: Implement the Shared Tool Core: a central versioned tool registry driving the exact
  authenticate-authorize-validate-cache-single-flight-quota-reserve-execute-audit pipeline with
  provenance, event-time, quality, and evidence envelopes; narrow actor/tool profiles; cache and
  cross-mode single-flight semantics; atomic quota reservation/commit/release; license-policy
  enforcement; and permanent prohibited-financial enforcement. The quota reservation/commit/release
  stage and the license-policy source land as stable extension-point interfaces (contracts plus
  dependency-injection seams) so later packages implement cost and quota semantics entirely outside
  packages/tool-core/** without editing it.
- Risk: HIGH · writeScopes: `packages/tool-core/**`, `packages/domain/**`,
  `packages/shared-schemas/**`, `migrations/g0_core_*.sql`, `tests/fixtures/core/**`,
  `tests/acceptance/**`, `tests/negative/**`, `telemetry/core.*`
- Dependencies: `g0-contracts-data-truth` PROVEN, `g0-security-perimeter` PROVEN
- Bound inputs at seed time: main `00f577ca70d8`, manifest `e0f9f1284473`, PRD `baa521d9c67e`

## Assigned requirements (normative text quoted verbatim)

### FR-CORE-001 — 38. Functional requirements catalogue (PRD line 5987)

> Central versioned tool registry.

Normative level: MUST. Acceptance criteria: all 32 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/core.ts`
- Fixture refs: `tests/fixtures/core/`
- Telemetry refs: `telemetry/core.*`

### FR-CORE-002 — 38. Functional requirements catalogue (PRD line 5988)

> Exact execution pipeline from authorization to audit.

Normative level: MUST. Acceptance criteria: all 32 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/core.ts`
- Fixture refs: `tests/fixtures/core/`
- Telemetry refs: `telemetry/core.*`

### FR-CORE-003 — 38. Functional requirements catalogue (PRD line 5989)

> Provenance, event-time, quality, and evidence envelope.

Normative level: MUST. Acceptance criteria: all 32 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/core.ts`
- Fixture refs: `tests/fixtures/core/`
- Telemetry refs: `telemetry/core.*`

### FR-CORE-004 — 38. Functional requirements catalogue (PRD line 5990)

> Narrow actor/tool profiles.

Normative level: MUST. Acceptance criteria: all 32 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/core.ts`
- Fixture refs: `tests/fixtures/core/`
- Telemetry refs: `telemetry/core.*`

### FR-CORE-005 — 38. Functional requirements catalogue (PRD line 5991)

> Permanent prohibited-financial enforcement.

Normative level: MUST. Acceptance criteria: all 32 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/core.ts`
- Fixture refs: `tests/fixtures/core/`
- Telemetry refs: `telemetry/core.*`

### FR-CORE-006 — 38. Functional requirements catalogue (PRD line 5992)

> Exact cache and cross-mode single-flight.

Normative level: MUST. Acceptance criteria: all 32 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/core.ts`
- Fixture refs: `tests/fixtures/core/`
- Telemetry refs: `telemetry/core.*`

### FR-CORE-007 — 38. Functional requirements catalogue (PRD line 5993)

> Atomic quota reservation/commit/release.

Normative level: MUST. Acceptance criteria: all 32 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/core.ts`
- Fixture refs: `tests/fixtures/core/`
- Telemetry refs: `telemetry/core.*`

### FR-CORE-008 — 38. Functional requirements catalogue (PRD line 5994)

> License-policy enforcement.

Normative level: MUST. Acceptance criteria: all 32 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/core.ts`
- Fixture refs: `tests/fixtures/core/`
- Telemetry refs: `telemetry/core.*`

## Shared acceptance criteria

Attached to more than one requirement of this package — implement once, satisfy everywhere:

- **AC-001** · positive: `tests/acceptance/AC-001.spec.ts` · negative/failure:
  `tests/negative/AC-001.negative.spec.ts` — attached to 8 requirements
- **AC-002** · positive: `tests/acceptance/AC-002.spec.ts` · negative/failure:
  `tests/negative/AC-002.negative.spec.ts` — attached to 8 requirements
- **AC-003** · positive: `tests/acceptance/AC-003.spec.ts` · negative/failure:
  `tests/negative/AC-003.negative.spec.ts` — attached to 8 requirements
- **AC-004** · positive: `tests/acceptance/AC-004.spec.ts` · negative/failure:
  `tests/negative/AC-004.negative.spec.ts` — attached to 8 requirements
- **AC-020** · positive: `tests/acceptance/AC-020.spec.ts` · negative/failure:
  `tests/negative/AC-020.negative.spec.ts` — attached to 8 requirements
- **AC-021** · positive: `tests/acceptance/AC-021.spec.ts` · negative/failure:
  `tests/negative/AC-021.negative.spec.ts` — attached to 8 requirements
- **AC-022** · positive: `tests/acceptance/AC-022.spec.ts` · negative/failure:
  `tests/negative/AC-022.negative.spec.ts` — attached to 8 requirements
- **AC-023** · positive: `tests/acceptance/AC-023.spec.ts` · negative/failure:
  `tests/negative/AC-023.negative.spec.ts` — attached to 8 requirements
- **AC-050** · positive: `tests/acceptance/AC-050.spec.ts` · negative/failure:
  `tests/negative/AC-050.negative.spec.ts` — attached to 8 requirements
- **AC-051** · positive: `tests/acceptance/AC-051.spec.ts` · negative/failure:
  `tests/negative/AC-051.negative.spec.ts` — attached to 8 requirements
- **AC-052** · positive: `tests/acceptance/AC-052.spec.ts` · negative/failure:
  `tests/negative/AC-052.negative.spec.ts` — attached to 8 requirements
- **AC-053** · positive: `tests/acceptance/AC-053.spec.ts` · negative/failure:
  `tests/negative/AC-053.negative.spec.ts` — attached to 8 requirements
- **AC-240** · positive: `tests/acceptance/AC-240.spec.ts` · negative/failure:
  `tests/negative/AC-240.negative.spec.ts` — attached to 8 requirements
- **AC-241** · positive: `tests/acceptance/AC-241.spec.ts` · negative/failure:
  `tests/negative/AC-241.negative.spec.ts` — attached to 8 requirements
- **AC-242** · positive: `tests/acceptance/AC-242.spec.ts` · negative/failure:
  `tests/negative/AC-242.negative.spec.ts` — attached to 8 requirements
- **AC-243** · positive: `tests/acceptance/AC-243.spec.ts` · negative/failure:
  `tests/negative/AC-243.negative.spec.ts` — attached to 8 requirements
- **AC-244** · positive: `tests/acceptance/AC-244.spec.ts` · negative/failure:
  `tests/negative/AC-244.negative.spec.ts` — attached to 8 requirements
- **AC-245** · positive: `tests/acceptance/AC-245.spec.ts` · negative/failure:
  `tests/negative/AC-245.negative.spec.ts` — attached to 8 requirements
- **AC-246** · positive: `tests/acceptance/AC-246.spec.ts` · negative/failure:
  `tests/negative/AC-246.negative.spec.ts` — attached to 8 requirements
- **AC-247** · positive: `tests/acceptance/AC-247.spec.ts` · negative/failure:
  `tests/negative/AC-247.negative.spec.ts` — attached to 8 requirements
- **AC-248** · positive: `tests/acceptance/AC-248.spec.ts` · negative/failure:
  `tests/negative/AC-248.negative.spec.ts` — attached to 8 requirements
- **AC-249** · positive: `tests/acceptance/AC-249.spec.ts` · negative/failure:
  `tests/negative/AC-249.negative.spec.ts` — attached to 8 requirements
- **AC-250** · positive: `tests/acceptance/AC-250.spec.ts` · negative/failure:
  `tests/negative/AC-250.negative.spec.ts` — attached to 8 requirements
- **AC-251** · positive: `tests/acceptance/AC-251.spec.ts` · negative/failure:
  `tests/negative/AC-251.negative.spec.ts` — attached to 8 requirements
- **AC-252** · positive: `tests/acceptance/AC-252.spec.ts` · negative/failure:
  `tests/negative/AC-252.negative.spec.ts` — attached to 8 requirements
- **AC-253** · positive: `tests/acceptance/AC-253.spec.ts` · negative/failure:
  `tests/negative/AC-253.negative.spec.ts` — attached to 8 requirements
- **AC-254** · positive: `tests/acceptance/AC-254.spec.ts` · negative/failure:
  `tests/negative/AC-254.negative.spec.ts` — attached to 8 requirements
- **AC-255** · positive: `tests/acceptance/AC-255.spec.ts` · negative/failure:
  `tests/negative/AC-255.negative.spec.ts` — attached to 8 requirements
- **AC-256** · positive: `tests/acceptance/AC-256.spec.ts` · negative/failure:
  `tests/negative/AC-256.negative.spec.ts` — attached to 8 requirements
- **AC-257** · positive: `tests/acceptance/AC-257.spec.ts` · negative/failure:
  `tests/negative/AC-257.negative.spec.ts` — attached to 8 requirements
- **AC-258** · positive: `tests/acceptance/AC-258.spec.ts` · negative/failure:
  `tests/negative/AC-258.negative.spec.ts` — attached to 8 requirements
- **AC-259** · positive: `tests/acceptance/AC-259.spec.ts` · negative/failure:
  `tests/negative/AC-259.negative.spec.ts` — attached to 8 requirements

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
- `g0-provider-lifecycle`: Deliver provider operation lifecycle truth: stateful lifecycle
  (DISCOVERED through REMOVED) with documentation/pricing/rights verification TTLs that fail closed,
  deprecation rules for new implementations, audited read-only adapters bound to exact egress
  allowlists (GMGN strictly query-only, Helius supported raw/history operations), quarantine of
  responses carrying transaction payloads or key material, rights-change fail-closed handling, and
  source fingerprints for empirical dependence analysis.
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

## Planner-owned scope statement

This package implements the **Shared Tool Core** (PRD §16): the single choke
point through which every tool call in the system flows. It owns the central
versioned tool registry (FR-CORE-001), the exact 24-stage authenticate →
authorize → validate → cache → single-flight → quota-reserve → execute → audit
execution pipeline (FR-CORE-002), the provenance/event-time/quality/evidence
result envelope (FR-CORE-003), narrow actor/tool profiles (FR-CORE-004),
permanent prohibited-financial enforcement at registration and execution time
(FR-CORE-005), exact caching plus cross-mode database-backed single-flight with
fencing tokens (FR-CORE-006), atomic quota reservation/commit/release delivered
as a stable extension-point contract (FR-CORE-007), and license-policy
enforcement delivered as an injectable fail-closed policy source (FR-CORE-008).

Two boundaries define the package's shape:

1. **Extension-point boundary (binding for later packages).** The quota
   reservation/commit/release stage and the license-policy source land ONLY as
   stable contracts (TypeScript interfaces + Zod schemas + SQL state machines +
   dependency-injection seams) inside `packages/tool-core/**`. Cost, quota, and
   capacity semantics are implemented by `g0-cost-capacity` entirely outside
   `packages/tool-core/**`, without editing it (milestone objective; PRD §16.7).
2. **Manifest-owner reconciliation.** The manifest's `implementationRefs` for
   FR-CORE-001…008 name `packages/domain/**` and `packages/shared-schemas/**`
   with owner `packages/domain`; the milestone decomposition additionally
   assigns `packages/tool-core/**` as the implementation home of the registry
   and pipeline. Domain contracts and shared schemas land in the manifest-named
   paths; the engine lands in `packages/tool-core/**`. The
   manifest-derived implementation mapping is reconciled by
   `g0-traceability-conformance` at milestone convergence — the same pattern the
   milestone record established for FR-DR. This package never edits
   `docs/spec/**` or `docs/generated/**`.

## Applicable architecture invariants (manifest §45, quoted)

All ten invariants attached to every FR-CORE requirement, verbatim:

- **INV-001:** The system is permanently read-only with respect to financial
  execution, custody, signing, and transaction construction.
- **INV-002:** Agent intelligence never replaces deterministic identity,
  evidence, time, execution, risk, capability, rights, cost, quota, capacity,
  or policy controls.
- **INV-003:** No automated external side effect occurs directly from model
  output.
- **INV-004:** Every retained decision is reconstructable from frozen evidence,
  availability, acquisition state, configuration, code, adapter, and artifact
  versions.
- **INV-005:** Historical replay uses only data and learned artifacts actually
  available to the system at the simulated time.
- **INV-006:** Backfilled historical data is never backdated into production
  replay.
- **INV-007:** Evaluation includes alerts, watches, ignores, rejects,
  below-cutoff cases, exploration/control cases, and missed opportunities under
  symmetric action-time semantics.
- **INV-008:** Provider count is not source independence; declared lineage and
  empirical dependence both constrain effective confirmation.
- **INV-009:** A durable workflow or collector may retry; every state
  transition and external side effect remains idempotent and fenced.
- **INV-010:** The primary policy objective is conservative net shadow-portfolio
  utility under finite capital and hard constraints, not isolated price
  appreciation or alert win rate.

How each invariant constrains THIS package concretely:

| Invariant   | Tool-core obligation                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| INV-001     | Registry refuses any definition whose action class, name, or schema expresses trading/signing/custody/transaction construction; pipeline re-checks action class per call (FR-CORE-005).                                  |
| INV-002     | Provider choice, cache admission, quota admission, and license verdicts are deterministic policy inputs injected into the pipeline — never model decisions (§16.9: "The agent MUST NOT select a paid provider by name"). |
| INV-003     | The pipeline exposes only read-only provider/collector operations; stage 14 dispatches solely through allowlisted adapters bound by the security perimeter.                                                              |
| INV-004     | Stages 5/19/22 persist acquisition state, evidence metadata, source fingerprint, actual cost, and decision impact so every result is reconstructable (AC-243 substrate).                                                 |
| INV-005/006 | Cache keys carry explicit as-of semantics (§16.4); stale tiers never backdate availability into replayed reads (AC-020 substrate).                                                                                       |
| INV-007     | Workload classes include EVALUATION_LOW and BACKFILL_LOW with symmetric action-time handling in the envelope (AC-240 substrate).                                                                                         |
| INV-008     | Envelope conflicts (`ProviderConflictRef[]`) preserve disagreement; provenance records source lineage refs for downstream independence analysis (AC-245–247 substrate).                                                  |
| INV-009     | Lease release validates fencing tokens; reservation transitions are guarded SQL state machines; retries of commit/release are idempotent (FR-CORE-006/007).                                                              |
| INV-010     | Backpressure order degrades breadth/depth before touching protected reserve (§16.8), keeping interactive investigation capacity conservative.                                                                            |

## Accepted product ADRs directly binding this package

- **ADR-0013 (Zod is the single approved runtime schema-validation library)** —
  all tool input/output validation (pipeline stages 3, 15, 17) runs
  authoritative Zod schemas from `packages/shared-schemas/src/core.ts`;
  validation failures fail closed.
- **ADR-0014 (PGlite as the deterministic database test engine)** — migration
  suites for `g0_core_*.sql`, lease fencing tests, reservation state-machine
  tests, and exact-cache tests run on PGlite via the existing
  `@foresift/persistence` test helpers; SQL must stay portable to production
  PostgreSQL.

## Integration points (landed dependency surface)

- `@foresift/domain`: `AcquisitionState` vocabulary (NOT_REQUESTED_BY_POLICY,
  REQUESTED, COST_BLOCKED, QUOTA_BLOCKED, CAPABILITY_UNAVAILABLE, RIGHTS_BLOCKED,
  PROVIDER_UNAVAILABLE, TIMED_OUT, RETURNED, INVALID_RESPONSE) is the exact
  state set stages 5/22 persist; `EvidenceAcquisitionDecision`,
  `UtcTimestamp`, quality codes, and typed `ForesiftError` codes are reused, not
  duplicated.
- `@foresift/shared-schemas`: new authoritative module `src/core.ts` mirrors
  every tool-core boundary type (manifest `schemaRefs`); exported from the
  package index alongside data/dr/sec modules.
- `@foresift/persistence`: migrator applies `g0_core_*.sql`; acquisition repo
  persists pre-execution states; canonical JSON utility produces stable cache-key
  serialization; `DatabaseEngine` seam carries lease and reservation tables.
- `@foresift/security`: `AuditChain.append` is the sole audit sink for stage 23;
  `NegativeCapabilityCanary` catalog feeds registration-time prohibited-content
  screening; egress allowlist enforcement wraps stage 14 dispatch; typed
  security error vocabulary stays in `packages/security`.
- `@foresift/evidence` / object-store: stage 19 persists evidence/artifact
  metadata and source fingerprints through the landed evidence-index interfaces.
- Downstream consumers: `g0-cost-capacity` implements the quota and license
  extension points; `g0-mcp-surface` serves tools, resources, and prompts from
  this registry and re-evaluates authorization per call through the same
  pipeline entrypoint; collector/provider packages register audited read-only
  operations as registry tools.

## Package success criteria

1. All eight assigned requirements implemented with their 32 shared acceptance
   criteria exercised by both positive and negative/failure-path specs at the
   manifest-declared file paths (creating `AC-001…AC-004` suites that do not
   yet exist; extending the already-present suites with the tool-core substrate
   blocks they lack).
2. The 24-stage pipeline executes in exactly the PRD §16.2 order with every
   blocked/not-requested exit distinguishable and persisted BEFORE any external
   request; no stage may be skipped or reordered by configuration.
3. Quota reservation/commit/release and license-policy source are consumable
   contracts: a compile-time-typed adapter can be written outside
   `packages/tool-core/**` without modifying tool-core sources (proven by the
   test suite injecting reference adapters from outside the package sources).
4. Single-flight demonstrably collapses concurrent identical requests across
   simulated modes to one provider call within the dedupe window (AC-003), with
   fencing-token release refusing stale holders (INV-009).
5. Prohibited-financial screening refuses prohibited definitions at
   registration and prohibited calls at execution, with refusal events audited
   (AC-050/AC-254 substrate; permanent INV-001).
6. `pnpm --filter @foresift/domain test`, `pnpm --filter @foresift/tool-core
test`, and the full aggregate gate stay green; no regression in any
   dependency-package suite.

## Assumptions

- Provider/collector adapter implementations, MCP transport, cost/quota policy
  values, and observability emitters belong to other packages/milestones; the
  pipeline integrates them exclusively through the seams named above.
- Telemetry `telemetry/core.*` lands as the declarative catalog contract
  (`telemetry/core.catalog.json`) mirroring `packages/shared-schemas/src/core.ts`
  field lists, following the proven sec-catalog convention; emitter wiring is
  deferred to the observability milestone.
- The freshness TTL table in PRD §16.5 is seeded as the default policy table;
  making it configurable per deployment is configuration data, not code change.
