# g0-first-party-observation — scoped specification

> This file is a SUBORDINATE DERIVATIVE of the authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`. It was seeded mechanically from
> the requirement manifest by `scripts/automation/bootstrap-package-spec.mjs` (builder v1). The PRD
> always wins over any wording below.

## Authority binding

- Milestone: `G0` (ACTIVE)
- Objective: Provide bounded first-party observation: the versioned allowlisted Solana collector and
  protocol registry (Pump bonding curve/PumpSwap, Raydium AMM v4/CPMM/CLMM/Stable AMM/LaunchLab,
  Orca Whirlpools, Meteora DLMM/DAMM v1-v2/DBC, Jupiter route observation) with durable monotonic
  checkpoints, gap detection and non-backdating backfill, reorg-safe immutable revisions,
  decode-drift incident pausing, deterministic bounded failover, Sustainable Capacity Contract
  ceilings, health and first-seen timing metrics, and zero signing/wallet capability; plus the
  point-in-time discovery-universe registry making free aggregate discovery the default
  broad-universe path, with complete first-seen attribution, finite batch-oriented monitoring, and
  deterministic versioned candidate promotion. External collector access flows through the security
  perimeter's egress controls and audited read-only adapter layer.
- Risk: HIGH · writeScopes: `apps/collector/**`, `packages/collector-core/**`,
  `packages/collector-solana/**`, `packages/collector-checkpoints/**`,
  `packages/collector-gap-recovery/**`, `packages/program-decoders/**`,
  `packages/discovery-universe/**`, `packages/cheap-monitor/**`, `packages/shared-schemas/**`,
  `migrations/g0_col_*.sql`, `migrations/g0_disc_*.sql`, `tests/fixtures/col/**`,
  `tests/fixtures/disc/**`, `tests/acceptance/**`, `tests/negative/**`, `telemetry/col.*`,
  `telemetry/disc.*`
- Dependencies: `g0-contracts-data-truth` PROVEN, `g0-security-perimeter` PROVEN,
  `g0-provider-lifecycle` PROVEN, `g0-cost-capacity` PROVEN
- Bound inputs at seed time: main `8855f1a7da61`, manifest `e0f9f1284473`, PRD `baa521d9c67e`

## Assigned requirements (normative text quoted verbatim)

### FR-COL-001 — 38. Functional requirements catalogue (PRD line 6387)

> A long-running first-party collector observes an explicit, versioned allowlist of chains,
> programs, program versions, accounts, event families, and finality policies; it cannot imply
> coverage outside that scope.

Normative level: MUST. Acceptance criteria: all 13 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/col.ts`
- Fixture refs: `tests/fixtures/col/`
- Telemetry refs: `telemetry/col.*`

### FR-COL-002 — 38. Functional requirements catalogue (PRD line 6388)

> The initial Solana collector and protocol registry implement versioned read-only coverage for Pump
> bonding curve/PumpSwap, Raydium AMM v4/CPMM/CLMM/Stable AMM/LaunchLab, Orca Whirlpools, Meteora
> DLMM/DAMM v1-v2/Dynamic Bonding Curve, and Jupiter route observation/reconciliation, including
> allowlisted pool or launch creation, state progress, migration, liquidity changes,
> authority/configuration changes, and selected economic swap/flow events; unsupported versions
> remain explicit and cannot inherit generic behavior.

Normative level: MUST. Acceptance criteria: all 13 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/col.ts`
- Fixture refs: `tests/fixtures/col/`
- Telemetry refs: `telemetry/col.*`

### FR-COL-003 — 38. Functional requirements catalogue (PRD line 6389)

> Each collector stream stores endpoint, subscription/filter version, connection generation, slot,
> block hash, transaction/signature, instruction/log/account coordinates, received time, earliest
> system availability, finality, raw artifact hash, decoder version, and rights policy.

Normative level: MUST. Acceptance criteria: all 13 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/col.ts`
- Fixture refs: `tests/fixtures/col/`
- Telemetry refs: `telemetry/col.*`

### FR-COL-004 — 38. Functional requirements catalogue (PRD line 6390)

> Collector checkpoints are durable and monotonic per partition; reconnect detects missing slot or
> sequence ranges, records a gap before backfill, and resumes from the last committed checkpoint
> without silently skipping events.

Normative level: MUST. Acceptance criteria: all 13 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/col.ts`
- Fixture refs: `tests/fixtures/col/`
- Telemetry refs: `telemetry/col.*`

### FR-COL-005 — 38. Functional requirements catalogue (PRD line 6391)

> Gap backfill uses independent bounded RPC/indexer operations where available, preserves actual
> retrieval time, and never backdates `available_at`; unresolved gaps explicitly downgrade coverage
> and population claims.

Normative level: MUST. Acceptance criteria: all 13 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/col.ts`
- Fixture refs: `tests/fixtures/col/`
- Telemetry refs: `telemetry/col.*`

### FR-COL-006 — 38. Functional requirements catalogue (PRD line 6392)

> Reorg, duplicate, delayed, out-of-order, and revised events use immutable revisions/compensating
> events; the collector never destructively rewrites prior observations.

Normative level: MUST. Acceptance criteria: all 13 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/col.ts`
- Fixture refs: `tests/fixtures/col/`
- Telemetry refs: `telemetry/col.*`

### FR-COL-007 — 38. Functional requirements catalogue (PRD line 6393)

> Program upgrades, decoder drift, account-layout changes, unknown instruction variants, and parity
> failures pause only affected decoding/scope, preserve raw events, create an incident, and prevent
> derived facts until revalidated.

Normative level: MUST. Acceptance criteria: all 13 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/col.ts`
- Fixture refs: `tests/fixtures/col/`
- Telemetry refs: `telemetry/col.*`

### FR-COL-008 — 38. Functional requirements catalogue (PRD line 6394)

> Collector health exposes connected state, endpoint generation, head slot, finalized slot,
> checkpoint lag, gap count/duration, backfill status, decode-failure rate, streamed bytes, event
> rate, deduplication rate, and resource consumption.

Normative level: MUST. Acceptance criteria: all 13 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/col.ts`
- Fixture refs: `tests/fixtures/col/`
- Telemetry refs: `telemetry/col.*`

### FR-COL-009 — 38. Functional requirements catalogue (PRD line 6395)

> Collector endpoint selection, failover, reconnect backoff, subscription sharding, and replay are
> deterministic and bounded; failover cannot create duplicate externally visible state or erase
> first-seen attribution.

Normative level: MUST. Acceptance criteria: all 13 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/col.ts`
- Fixture refs: `tests/fixtures/col/`
- Telemetry refs: `telemetry/col.*`

### FR-COL-010 — 38. Functional requirements catalogue (PRD line 6396)

> The collector has CPU, memory, network, subscription, event-rate, raw-storage, retry, and
> monthly-credit ceilings governed by the active Sustainable Capacity Contract.

Normative level: MUST. Acceptance criteria: all 13 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/col.ts`
- Fixture refs: `tests/fixtures/col/`
- Telemetry refs: `telemetry/col.*`

### FR-COL-011 — 38. Functional requirements catalogue (PRD line 6397)

> First-seen metrics distinguish source event time, collector receipt, provider availability,
> feature readiness, decision readiness, and delivery; the collector is an independent timing
> reference only for its verified scope.

Normative level: MUST. Acceptance criteria: all 13 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/col.ts`
- Fixture refs: `tests/fixtures/col/`
- Telemetry refs: `telemetry/col.*`

### FR-COL-012 — 38. Functional requirements catalogue (PRD line 6398)

> Collector credentials and dependencies expose no signing, private-key/seed, wallet
> creation/import/custody/management, transaction construction/submission, or arbitrary-subscription
> capability to the model or default MCP clients; read-only wallet-address observations remain data,
> not authority.

Normative level: MUST. Acceptance criteria: all 13 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/col.ts`
- Fixture refs: `tests/fixtures/col/`
- Telemetry refs: `telemetry/col.*`

### FR-DISC-001 — 38. Functional requirements catalogue (PRD line 6145)

> Free aggregate discovery is the default broad-universe path.

Normative level: MUST. Acceptance criteria: all 10 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/disc.ts`
- Fixture refs: `tests/fixtures/disc/`
- Telemetry refs: `telemetry/disc.*`

### FR-DISC-002 — 38. Functional requirements catalogue (PRD line 6146)

> Every first-seen candidate records source, source timestamp, system timestamp, source rank, and
> all subsequent discovery sources.

Normative level: MUST. Acceptance criteria: all 10 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/disc.ts`
- Fixture refs: `tests/fixtures/disc/`
- Telemetry refs: `telemetry/disc.*`

### FR-DISC-003 — 38. Functional requirements catalogue (PRD line 6147)

> The system maintains a point-in-time discovery-universe registry sufficient to measure source
> overlap, unique yield, and `NOT_DISCOVERED` misses.

Normative level: MUST. Acceptance criteria: all 10 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/disc.ts`
- Fixture refs: `tests/fixtures/disc/`
- Telemetry refs: `telemetry/disc.*`

### FR-DISC-004 — 38. Functional requirements catalogue (PRD line 6148)

> Cheap monitoring is batch-oriented and finite; it does not create one scheduler message/workflow
> per candidate.

Normative level: MUST. Acceptance criteria: all 10 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/disc.ts`
- Fixture refs: `tests/fixtures/disc/`
- Telemetry refs: `telemetry/disc.*`

### FR-DISC-005 — 38. Functional requirements catalogue (PRD line 6149)

> Candidate promotion from cheap monitoring to free-quota verification is deterministic and
> versioned.

Normative level: MUST. Acceptance criteria: all 10 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/disc.ts`
- Fixture refs: `tests/fixtures/disc/`
- Telemetry refs: `telemetry/disc.*`

## Shared acceptance criteria

Attached to more than one requirement of this package — implement once, satisfy everywhere:

- **AC-110** · positive: `tests/acceptance/AC-110.spec.ts` · negative/failure:
  `tests/negative/AC-110.negative.spec.ts` — attached to 17 requirements
- **AC-111** · positive: `tests/acceptance/AC-111.spec.ts` · negative/failure:
  `tests/negative/AC-111.negative.spec.ts` — attached to 17 requirements
- **AC-112** · positive: `tests/acceptance/AC-112.spec.ts` · negative/failure:
  `tests/negative/AC-112.negative.spec.ts` — attached to 17 requirements
- **AC-113** · positive: `tests/acceptance/AC-113.spec.ts` · negative/failure:
  `tests/negative/AC-113.negative.spec.ts` — attached to 17 requirements
- **AC-224** · positive: `tests/acceptance/AC-224.spec.ts` · negative/failure:
  `tests/negative/AC-224.negative.spec.ts` — attached to 17 requirements
- **AC-225** · positive: `tests/acceptance/AC-225.spec.ts` · negative/failure:
  `tests/negative/AC-225.negative.spec.ts` — attached to 17 requirements
- **AC-226** · positive: `tests/acceptance/AC-226.spec.ts` · negative/failure:
  `tests/negative/AC-226.negative.spec.ts` — attached to 17 requirements
- **AC-227** · positive: `tests/acceptance/AC-227.spec.ts` · negative/failure:
  `tests/negative/AC-227.negative.spec.ts` — attached to 17 requirements
- **AC-228** · positive: `tests/acceptance/AC-228.spec.ts` · negative/failure:
  `tests/negative/AC-228.negative.spec.ts` — attached to 17 requirements
- **AC-229** · positive: `tests/acceptance/AC-229.spec.ts` · negative/failure:
  `tests/negative/AC-229.negative.spec.ts` — attached to 17 requirements
- **AC-230** · positive: `tests/acceptance/AC-230.spec.ts` · negative/failure:
  `tests/negative/AC-230.negative.spec.ts` — attached to 12 requirements
- **AC-231** · positive: `tests/acceptance/AC-231.spec.ts` · negative/failure:
  `tests/negative/AC-231.negative.spec.ts` — attached to 12 requirements
- **AC-237** · positive: `tests/acceptance/AC-237.spec.ts` · negative/failure:
  `tests/negative/AC-237.negative.spec.ts` — attached to 12 requirements

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
- `g0-cost-capacity`: Operate the free-first cost, quota, and sustainable-capacity control plane:
  declared cost classes, quota units, reset policies, and STRICT_FREE permission for every provider
  operation; STRICT_FREE blocking of paid, unknown-cost, and fallback operations with audited
  denials; protected reserves; degrade-breadth/depth-before-protected-quota; batch coalescing and
  exact-cache/single-flight ahead of reservation; verified-plan cost forecasts; separately activated
  paid-provider mode; and independently capped
  scheduler/workflow/database/object-store/notification/model resource budgets with data-provider
  STRICT_FREE independent from any configured BYOK model budget. Cost and quota semantics implement
  the tool-core extension-point interfaces without editing packages/tool-core/**.
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

## Planner-owned integration points (proven seams consumed read-only — never edited)

This package owns its writeScopes (see Authority binding) and consumes the following
PROVEN dependency surfaces without editing them:

- **`packages/persistence`** (g0-contracts-data-truth substrate) — fenced checkpoint
  upsert (`FENCED_CHECKPOINT_UPSERT_SQL`, `commitCheckpoint`), gap registry
  (`registerGap`, `resolveGapStatus`, `blockingGapsForShard`), exactly-once canonical
  event ledger (`recordCanonicalEvent` over `canonical_event_keys`), immutable
  observations/revisions/compensating events (`appendObservation`, `appendRevision`,
  `appendCompensatingEvent`), backfill receipts + no-backdating
  (`assertNoBackdating`, `recordBackfillReceipt`, `backfillVisibleForReplay`),
  watermarks (`advanceWatermark`, `canClaimCompleteCoverage`), acquisition decisions
  (`recordAcquisitionDecision`, `completeRetrieval`), identity (`insertPool`,
  `registerLaunch`, `registerMigrationEdge`), source independence
  (`registerSourceIdentity`, `recordDependenceEdge`), replay (`replayObservations`).
  Tables `collector_checkpoints`, `collector_gaps`, `canonical_event_keys`,
  `observations`, `observation_revisions`, `backfill_receipts`, `watermarks` already
  exist — this package ADDS `g0_col_*`/`g0_disc_*` tables, never alters these.
- **`packages/security`** — `EgressGuard` with the `COLLECTOR` egress plane
  (`EgressAllowlistEntrySchema.plane`), `AuditChain` (sole audit sink),
  `Incidents` (severity-critical incidents), `GatePauses` (scoped decode pauses via
  scope strings), `NegativeCapabilityCanary` + decoder-authority validator
  (deprecated decoder cannot be authoritative), refusal of automatic reactivation.
- **`packages/providers`** — audited read-only adapter layer: `AdapterClient`,
  `AdapterRequestValidator`, `AllowlistDescriptor`, `AdapterRegistrar`, and the
  Helius operation catalog (`rpc.get_transaction`, `rpc.get_signatures_for_address`
  SUPPORTED; enhanced parser DEPRECATED non-authoritative; history plan-gated).
  Collector raw/backfill fetches flow through this layer bound to exact egress
  allowlists; no wholesale SDK/skill bundle is installed.
- **`packages/cost-router`** (g0-cost-capacity) — every collector provider/RPC call
  is admitted through `CostQuotaAdapter` (`estimate/admit/reserve`) in the active
  cost mode; `STRICT_FREE` applies; gap backfill may route to the
  `EMERGENCY_BACKFILL` protected reserve only when declared eligible; a
  cost/credit ceiling reached → safe pause, never silent paid overage.
- **`packages/capacity-planner` + `packages/quota-forecast`** (g0-cost-capacity) —
  collector ceilings (FR-COL-010) feed the 30-day Sustainable Capacity Contract
  replay (`replayCapacity`) and resource budgets; capacity breach blocks activation
  (AC-227) and forecast-tolerance breach raises incidents (AC-229).
- **`packages/tool-core`** — the frozen 24-stage pipeline ordering (exact-cache and
  single-flight ahead of quota reservation) is consumed, never modified; collector
  provider calls enter as provider operations.
- **`packages/object-store`** — first-party raw event batches and gap proofs are
  stored via `stagedUpload` (PENDING_UPLOAD → STORED_HASH_VERIFIED →
  INDEX_COMMITTED → AVAILABLE; §14.8 gate; §14.7 collector storage).
- **`packages/provider-lifecycle`** — provider operation registry declarations,
  documentation/pricing/rights verification TTLs (fail-closed), and
  `ResponseQuarantine` for responses carrying transaction payloads or key material.
- **`packages/shared-schemas`** — extends with `src/col.ts` + `src/disc.ts`
  (authoritative Zod schemas, ADR-0013). Note: `packages/domain/**` is NOT in this
  package's writeScopes (per ADR-0018 the domain extension must be declared in
  writeScopes at milestone planning time, and it was not), so all new col/disc
  vocabularies and fail-closed parse helpers live in the shared-schemas modules,
  importing existing domain/schema types rather than restating them.

## Applicable invariants (manifest security/rights/cost controls, binding)

- **INV-001** (permanent read-only): the collector observes; it never constructs,
  signs, or submits anything. Jupiter and all adapters are observation-only.
- **INV-002**: collector health/coverage state never replaces cost, quota, capacity,
  or policy controls — the capacity governor pauses within them.
- **INV-003**: no automated external side effect occurs directly from model output;
  the collector's subscriptions are fixed configuration (§35.6), not model-chosen.
- **INV-004**: every collector state transition is reconstructable from frozen
  stream receipts, checkpoint rows, decoder/program versions, and support manifests.
- **INV-005/INV-006**: replay uses only data available at the simulated time;
  backfilled events keep original chain `event_at` but `available_at >= retrieval`
  (structural in `BackfillReceiptSchema`; AC-225).
- **INV-007**: cheap-monitor expiry/rejection remains available for
  missed-opportunity evaluation (§12.7); nothing is silently dropped.
- **INV-008**: first-seen attribution records ALL subsequent discovery sources so
  source overlap/dependence is measurable; declared lineage constrains claims.
- **INV-009**: collector retries are safe — fenced checkpoints, exactly-once
  canonical keys, idempotent gap registration; a stale instance cannot advance a
  checkpoint after a newer fencing token takes ownership (§10.2).
- **INV-010**: coverage claims are conservative — unresolved gaps explicitly
  downgrade coverage and population claims (FR-COL-005, §63.12).

## Shared acceptance-criteria file ownership (facet model)

- AC-110, AC-111, AC-112, AC-113, AC-230, AC-231, AC-237 have no existing test
  files — this package creates the positive + negative pairs at the
  manifest-declared paths.
- AC-224…AC-229 files already exist (g0-cost-capacity landed the "cost facet",
  headers explicitly delimiting the collector substrate as owned elsewhere). This
  package EXTENDS those files additively with collector-facet describe blocks
  (append-only, never rewriting the cost-facet content), delivering the collector
  substrate those headers reserved.

## Risks (package-level)

- **Highest-surface package in G0** (17 requirements, 8 new workspace packages +
  an app): mitigated by strict seam reuse — all durable state machinery already
  PROVEN in persistence/security/cost packages; this package composes.
- **Decoder correctness vs generic-behavior leakage**: an unknown or mismatched
  design must return explicit UNSUPPORTED/degraded, never generic constant-product
  output (AC-230). Versioned decoder registry with signed support manifests is the
  structural control; fixtures carry adversarial layouts.
- **WebSocket/subscription transport**: §10.2 requires persistent outbound
  connections; the proven provider adapter layer is HTTP-only today. The collector
  transport is implemented inside `packages/collector-solana` as a read-only
  subscription/polling port behind the same `EgressGuard` COLLECTOR-plane
  allowlist, with deterministic bounded reconnect — not a new vendor SDK surface.
- **Cheap-monitor runaway**: 1,000 candidates → 1,000 scheduler messages is the
  exact failure AC-112 prohibits; the batch scheduler is the only writer of
  monitor work and is bounded by construction (finite due-row selection).
- **Migration registry convergence** (ADR-0019): seven new `g0_col_*`/`g0_disc_*`
  scripts MUST be added to `packages/persistence/test/migrator.spec.ts`'s exact G0
  list in lexicographic position — the plan-sanctioned central-registry duty is
  named explicitly in tasks.md.

## Resolved ambiguities (safest coherent interpretation, recorded here)

1. **Vocabulary home** — col/disc enums + parse helpers live in
   `packages/shared-schemas/src/{col,disc}.ts` because `packages/domain/**` is
   outside this package's writeScopes (ADR-0018 consequence; widening it here
   would repeat the failure mode ADR-0018 records).
2. **Incident plumbing** — decode-drift incidents are collector-scoped durable rows
   (`g0_col_0003`) with audit-chain references; severity-critical escalations
   reuse the security `Incidents` seam and decode pauses use `GatePauses` scope
   strings. No edit to `packages/security/**`.
3. **Reorg payloads** — reorg/finality corrections reuse the proven
   `CompensatingEventSchema` kinds (`REORG_SUPERSEDING`, `FINALITY_CORRECTION`);
   duplicates are absorbed by `canonical_event_keys`; delayed/out-of-order events
   are position-corrected via revisions with new `available_at`, never rewrites.
4. **Cheap-monitor promotion inputs** — promotion uses persistence/change signals
   plus execution/security eligibility, never current magnitude alone (§63.6);
   the decision record freezes feature + policy versions so replay is bit-identical
   (AC-113).
5. **First-party deltas for monitoring** — cheap monitoring consumes collector
   events first (§63.6), calling aggregate providers only within the free quota
   admitted by the cost plane; discovery-universe and cheap-monitor can never call
   paid operations (§42.1 dependency rule).
