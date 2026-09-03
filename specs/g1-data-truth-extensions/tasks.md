# Tasks: g1-data-truth-extensions

**Input**: `specs/g1-data-truth-extensions/spec.md`, `specs/g1-data-truth-extensions/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-DATA-007…016, FR-TRD-001…004, FR-SUP-001…002) or an acceptance criterion
of those requirements. Requirement IDs not assigned to this package never
appear here.

Format: `- [ ] T### [P?]` — **[P]** = parallelizable with its neighbors (disjoint files).
Tests are mandatory per PRD evidence rules: positive AND negative/failure-path
specs for every acceptance criterion this package authors or extends
(AC-133…136, AC-233 authored here; AC-020…023, AC-240…249 extended in place).
Plan-sanctioned scope exceptions recorded per milestone plan-level decisions 1
and 4: `packages/persistence/test/migrator.spec.ts` (central migration
registry, ADR-0019/0022 duty) and `tests/telemetry-catalog.spec.ts` (central
telemetry parity suite) are extended by this package even though they sit
outside the listed writeScopes.

## Phase 1 — Foundations: domain vocabularies and shared schemas (blocks later phases)

- [x] T001 Extend `packages/domain/src/acquisition.ts` to the reconciled
      ten-state decision vocabulary (FR-DATA-011): `UNSUPPORTED` replaces
      `CAPABILITY_UNAVAILABLE`; `FAILED` (with `AcquisitionFailureKind` =
      `TIMED_OUT` | `INVALID_RESPONSE`) replaces `TIMED_OUT`/`INVALID_RESPONSE`;
      `RETURNED_EMPTY` added as a genuine provider result distinct from
      `NOT_REQUESTED_BY_POLICY`; update `RETRIEVAL_FAILED_STATES`,
      terminal-state helpers, and the §13.8 record interface with the
      FR-DATA-012 field set (requestedFields, expectedValueOfInformation,
      estimatedCost, actualCost, candidateStateAtRequest, failureKind,
      acquisitionSeed provenance); add stable ErrorCodes for unknown failure
      kinds. Implement the member-level mapping helpers of plan ADR-1.
      Traces: FR-DATA-011, FR-DATA-012, AC-242, AC-243.
- [x] T002 Create `packages/domain/src/replay-modes.ts`: `ReplayMode` =
      REALIZABLE_REPLAY | ORACLE | HINDSIGHT |
      COUNTERFACTUAL_DATA_AVAILABILITY_RESEARCH (FR-DATA-008, §13.6 rule 2)
      with fail-closed parse; retrospective-only data visibility is a function
      of mode — realizable mode excludes entries whose
      `retrieved_as_backfill`/retrospective-only provenance postdates the
      boundary; labeled modes carry explicit diagnostics labeling. Traces:
      FR-DATA-008, FR-DATA-015, AC-241, AC-247.
- [x] T003 Create `packages/domain/src/dependence.ts`: `DependenceMethod`
      (DECLARED | EMPIRICAL), edge validity-interval types (validFrom,
      validUntil), confidence + `effectiveIndependenceMultiplier` policy
      (threshold table over the App. O.8 observation inputs, monotonic
      combined function, automatic credit reduction when material), and the
      point-in-time scope rule: credit at T resolves only from
      AVAILABLE_AT_THE_TIME edges whose validity interval contains T
      (plan ADR-3). Traces: FR-DATA-013, FR-DATA-014, FR-DATA-015, AC-245,
      AC-246, AC-247.
- [x] T004 Create `packages/domain/src/conflicts.ts`: `ProviderConflictClass`
      = BENIGN_LATENCY_ROUNDING_VARIANCE | COMMON_UPSTREAM_DUPLICATION |
      MATERIAL_DISAGREEMENT | UNRESOLVED_DECISION_CRITICAL and the
      deterministic `classifyConflict` function over observed values, latency
      deltas, rounding fingerprints, shared upstream lineage, and decision
      criticality (FR-DATA-016, §15.10 — conflicts are separate evidence
      resolved only by versioned deterministic rule or explicit CONFLICTING
      state). Traces: FR-DATA-016, AC-245.
- [x] T005 Create `packages/domain/src/trades.ts` (TradeSide =
      BUY | SELL | ROUND_TRIP | INVENTORY_NEUTRAL | UNKNOWN;
      ActorResolutionState = RESOLVED | PARTIAL | UNRESOLVED; pure
      deterministic `actorUncertaintyFactor` reducing feature-quality
      contribution under actor uncertainty — FR-TRD-004, §66.3 rule 7) and
      `packages/domain/src/timeline.ts` (delivery-timeline monotonicity
      predicates: delivery_eligible_at = max(decision_ready_at,
      policy_decided_at) per Appendix P; counterfactual versioning;
      non-delivered arms never enter earlier — AC-240 substrate). Traces:
      FR-TRD-003, FR-TRD-004, FR-DATA-009, AC-133, AC-134, AC-240.
- [x] T006 Create `packages/domain/src/supply.ts`: `SupplyMethod`
      vocabulary, market-cap basis (TOTAL | PROVIDER_CIRCULATING |
      ESTIMATED_CIRCULATING per §65.6), and the pure
      `marketCapMayHardReject(assessment, approvedFallbackAvailable)`
      predicate refusing hard rejection on low-confidence market cap when an
      approved liquidity/activity fallback exists (FR-SUP-002, plan ADR-4).
      Traces: FR-SUP-001, FR-SUP-002, AC-135.
- [x] T007 Extend `packages/domain/src/index.ts` exports for the new modules;
      add colocated domain tests `packages/domain/test/` for every new
      vocabulary's fail-closed parse and pure-function contracts (unknown
      replay mode, unknown conflict class, unknown trade side, unknown supply
      method, unknown failure kind all throw; monotonicity predicates hold at
      boundaries). Traces: FR-DATA-008, FR-DATA-009, FR-DATA-011, FR-DATA-013,
      FR-DATA-016, FR-TRD-004, FR-SUP-002, AC-240, AC-245, AC-135.
- [x] T008 Extend `packages/shared-schemas/src/data.ts`: BackfilledObservation
      fields (retrievedAsBackfill, original coordinates, fetchedAt,
      availableAt, unavailabilityReason — event time never substituting for
      availability, FR-DATA-007), CandidateDecisionTimeline schema
      (FR-DATA-009 field set with delivery timestamps + versioned
      counterfactual, FR-DATA-009), extended EvidenceAcquisitionDecisionSchema
      to the reconciled ten-state vocabulary + FR-DATA-012 fields,
      EmpiricalDependenceObservationSchema and extended SourceDependenceEdge
      (validity interval, method, evidence, confidence, multiplier —
      FR-DATA-013/014), ProviderConflictSchema (FR-DATA-016), and a
      ReplayQuerySemantics schema carrying the explicit mode label
      (FR-DATA-010 current-view vs historical-replay as two named query
      shapes, FR-DATA-008). Import — never restate — domain vocabularies;
      bump DATA_SCHEMA_REGISTRY_VERSION to 2; extend
      `packages/shared-schemas/test/data.spec.ts`. Traces: FR-DATA-007,
      FR-DATA-008, FR-DATA-009, FR-DATA-010, FR-DATA-011, FR-DATA-012,
      FR-DATA-013, FR-DATA-014, FR-DATA-016, AC-242, AC-245.
- [x] T009 [P] Create `packages/shared-schemas/src/trd.ts` (EconomicTradeEvent + EconomicRouteLeg schemas mirroring §66.2 exactly: net deltas as
      decimal strings, side enum, classification confidence, route leg refs,
      eventAt/availableAt, quality codes, actor-resolution state) and
      `packages/shared-schemas/src/sup.ts` (SupplyAssessment mirroring §65.6
      exactly: source, method, excluded supply, confidence, exclusion
      evidence, quality codes, market-cap basis); export both from
      `packages/shared-schemas/src/index.ts`; colocated schema tests.
      Traces: FR-TRD-001, FR-TRD-002, FR-SUP-001, AC-133, AC-135.

## Phase 2 — Persistence: migrations and repos (blocks Phase 3–5 verification)

- [x] T010 Author `migrations/g1_data_0001_decision_semantics.sql` exactly per
      plan data-model: `observations` gains retrieved_as_backfill +
      unavailability_reason with the no-event-time-substitution CHECKs
      (FR-DATA-007); `candidate_decision_timelines` table with monotonicity,
      delivery-symmetry, and append-only enforcement (FR-DATA-009, AC-240);
      `evidence_acquisition_decisions` extended with the FR-DATA-012 columns
      and the reconciled ten-state CHECK — rebuilt behind a pre-migration
      guard that aborts if any row holds a retired member (plan ADR-1).
      Traces: FR-DATA-007, FR-DATA-009, FR-DATA-011, FR-DATA-012, AC-240,
      AC-242, AC-243.
- [x] T011 Author `migrations/g1_data_0002_dependence_conflicts.sql`:
      `source_dependence_edges` gains valid_from/valid_until/method/
      evidence_ids/confidence/effective_independence_multiplier
      (FR-DATA-013); `empirical_dependence_observations` table with the App.
      O.8 input columns and estimation-time window (FR-DATA-014);
      append-only `provider_conflicts` table with the four-class CHECK and
      raw-observation preservation (FR-DATA-016). Traces: FR-DATA-013,
      FR-DATA-014, FR-DATA-016, AC-245, AC-246.
- [x] T012 [P] Author `migrations/g1_trd_0001_economic_trade_events.sql`
      (economic_trade_events + economic_route_legs per plan data-model,
      §66.2/§66.3) and `migrations/g1_sup_0001_supply_assessments.sql`
      (supply_assessments + market_cap_fallback_decisions with the
      structural no-hard-rejection-with-fallback CHECK, plan ADR-4).
      Traces: FR-TRD-001, FR-TRD-002, FR-SUP-001, FR-SUP-002, AC-133, AC-135.
- [x] T013 Extend the migrator family pattern and the central migration
      registry: add `trd|sup` to MIGRATION_FILE_PATTERN in
      `packages/persistence/src/migrator.ts` (fail-closed discovery of the
      new families) and extend
      `packages/persistence/test/migrator.spec.ts` — the plan-sanctioned
      central-registry scope exception (milestone plan-level decision 1,
      ADR-0019/0022 duty) — so the expected-script list covers all new
      `g1_data_*`, `g1_trd_*`, `g1_sup_*` scripts in lexicographic order.
      Traces: FR-DATA-007, FR-DATA-009, FR-DATA-011, FR-DATA-013, FR-TRD-001,
      FR-SUP-001 (migration substrate for every assigned requirement).
- [x] T014 Extend `packages/persistence/src/repos/backfill.ts` + create
      `packages/persistence/src/repos/timeline.ts`: backfill writes persist
      retrieved_as_backfill, original event coordinates, actual fetched_at,
      actual earliest available_at, and the earlier-unavailability reason —
      refusing any event-time-for-availability substitution (FR-DATA-007);
      timeline repo enforces the §13.7/App.-P monotonic chain, stores
      delivered_at only when applicable, requires versioned
      counterfactual_delivery_at for non-delivered arms, and refuses a
      non-delivered arm entering earlier than its counterfactual
      (FR-DATA-009, AC-240). Colocated suites. Traces: FR-DATA-007,
      FR-DATA-009, AC-240.
- [x] T015 Extend `packages/persistence/src/repos/acquisition.ts` to the
      reconciled vocabulary and FR-DATA-012 record: requested fields,
      expected value of information, estimated/actual cost,
      candidate-state-at-request, failure kinds, seed provenance —
      preserving write-before-retrieval ordering, one-way completion, and
      frozen-count semantics exactly (AC-243 regression lock; NOT_REQUESTED
      still carries no lifecycle fields — AC-242 lock; RETURNED_EMPTY never
      conflated with NOT_REQUESTED_BY_POLICY). Colocated suites. Traces:
      FR-DATA-011, FR-DATA-012, AC-242, AC-243, AC-247.
- [x] T016 [P] Create `packages/persistence/src/repos/dependence.ts`
      (validity-interval edge writes, empirical observation records, the
      point-in-time effective-credit resolver of plan ADR-3, automatic
      material-dependence credit reduction) and
      `packages/persistence/src/repos/conflicts.ts` (append-only conflict
      records preserving all raw observations with the four-way
      classification). Colocated suites including a replay-time leakage
      negative. Traces: FR-DATA-013, FR-DATA-014, FR-DATA-015, FR-DATA-016,
      AC-245, AC-246, AC-247.

## Phase 3 — New packages (blocks Phase 4–5)

- [x] T017 Scaffold `packages/economic-trade-normalizer` (package.json,
      tsconfig.json, src/index.ts, `bun test` script — G0 scaffold pattern,
      zero root-config edits) and implement the deterministic normalizer per
      plan module layout: legs grouping within one economic transaction,
      actor/router resolution with downgrade path, net-actor-delta
      computation (never route-volume summation), same-transaction round-trip + arbitrage + inventory-neutral classification, migration-aware
      double-count guards, raw-leg preservation for audit, and content-hash
      event identity for idempotent replay (plan ADR-2, §66.1–66.3, INV-013).
      STRICTLY read-only: consumes persisted swap/transfer observations;
      constructs nothing. Traces: FR-TRD-001, FR-TRD-002, FR-TRD-003,
      AC-133, AC-134.
- [ ] T018 Wire the FR-TRD-004 reduction: economic events carry
      actor_resolution_state; the `actorUncertaintyFactor` function
      (domain T005) maps state+confidence to a deterministic feature-quality
      reduction consumed downstream via quality codes and a capped
      contribution factor exported on the event. Extend
      `migrations/g1_trd_0001_economic_trade_events.sql` with the
      actor_resolution_state column truth and
      `packages/shared-schemas/src/trd.ts` with the reduction's schema
      surface (plan-sanctioned paths: plan §g1_trd_0001, shared-schemas
      trd module). Colocated suite proves
      monotone reduction and UNRESOLVED → degraded quality (never silently
      dropped evidence). Traces: FR-TRD-004, AC-134, AC-136.
- [x] T019 [P] Scaffold `packages/supply-confidence` (G0 scaffold pattern) and
      implement the §65.6 SupplyAssessment persistence/exposure (source,
      method, excluded supply, confidence, exclusion evidence, quality codes,
      market-cap basis) plus the market-cap fallback gate consuming the
      domain predicate (T006): hard rejection on low-confidence market cap
      alone is refused whenever an approved liquidity/activity fallback
      exists, and every gate outcome persists a decision row for audit.
      Colocated suites. Traces: FR-SUP-001, FR-SUP-002, AC-135.
- [x] T020 [P] Extend `packages/evidence/src/replay-modes.ts` + barrel:
      replay-mode resolution over the evidence substrate — realizable mode
      excludes retrospective-only entries before their actual availability
      and returns separately labeled shapes for oracle/hindsight/
      cross-fitted-research modes (never silently mixed); hidden current-data
      access in realizable mode fails closed. Colocated suite with the
      FR-DATA-008 mode-labeling vectors. Traces: FR-DATA-008, FR-DATA-010,
      FR-DATA-015, AC-241, AC-247.

## Phase 4 — Fixtures, acceptance and negative suites (blocks Phase 5)

- [x] T021 Author `tests/fixtures/data/g1-backfill-provenance.json` and
      `tests/fixtures/data/g1-replay-modes.json` (FR-DATA-007
      no-substitution vectors incl. backdating refusals and original
      coordinate preservation; FR-DATA-008 mode vectors incl. the §13.6
      COUNTERFACTUAL_DATA_AVAILABILITY_RESEARCH labeling) — extending
      G0 fixture conventions. Traces: FR-DATA-007, FR-DATA-008, AC-020,
      AC-021.
- [x] T022 [P] Author `tests/fixtures/trd/route-hop-double-count.json`
      (multi-pool routed swap → one economic trade, no hop-volume double
      count), `tests/fixtures/trd/arbitrage-inventory-neutral.json`
      (arbitrage/round-trip/inventory-neutral separation from organic
      demand), `tests/fixtures/trd/actor-uncertainty.json` (uncertainty
      reduction vectors), and `tests/fixtures/sup/supply-confidence.json`
      (source/method/excluded-supply/confidence exposure + fallback
      scenarios). Traces: FR-TRD-001, FR-TRD-002, FR-TRD-003, FR-TRD-004,
      FR-SUP-001, FR-SUP-002, AC-133, AC-134, AC-135, AC-136.
- [x] T023 Author `tests/acceptance/AC-133.spec.ts`,
      `tests/acceptance/AC-134.spec.ts`,
      `tests/acceptance/AC-136.spec.ts` and
      `tests/acceptance/AC-233.spec.ts` scoped per spec I4 — AC-133: routed
      multi-pool swap produces exactly one economic trade and no hop-volume
      double count; AC-134: inventory-neutral arbitrage does not increase
      organic unique-buyer/demand features; AC-136: actor-uncertainty and
      quality-code fixtures produce bounded deterministic reductions;
      AC-233: net deltas include fee legs (transfer fees/rent/program fees
      as delta components) on the economic-event side. G0 suite conventions
      (`tests/acceptance/helpers.ts`, PGlite). Traces: FR-TRD-001…004,
      AC-133, AC-134, AC-136, AC-233.
- [x] T024 [P] Author `tests/acceptance/AC-135.spec.ts`: low-confidence
      circulating supply cannot act as the sole hard gate under an approved
      fallback profile — the gate persists a fallback decision and
      evaluation proceeds; supply assessments expose source, method,
      excluded supply, and confidence end to end. Traces: FR-SUP-001,
      FR-SUP-002, AC-135.
- [x] T025 Author the matching negative suites
      `tests/negative/AC-133.negative.spec.ts`,
      `tests/negative/AC-134.negative.spec.ts`,
      `tests/negative/AC-135.negative.spec.ts`,
      `tests/negative/AC-136.negative.spec.ts`,
      `tests/negative/AC-233.negative.spec.ts`: leg-summing double count is
      detected/refused; misclassified organic aggregation is refused;
      hard-reject-on-market-cap-alone with fallback available is refused by
      the predicate and unrecordable in SQL; unresolved actor state cannot
      yield full-quality contribution; fee-leg omission fails parity.
      Traces: FR-TRD-001…004, FR-SUP-002, AC-133, AC-134, AC-135, AC-136,
      AC-233.
- [ ] T026 Extend the shared suites in place with G1 cases:
      `tests/acceptance/AC-020.spec.ts` + negative (backfilled row invisible
      before actual availability; no event-time substitution),
      `tests/acceptance/AC-240.spec.ts` + negative (timeline monotonicity +
      counterfactual symmetry through the repo), `tests/acceptance/AC-242.spec.ts` /
      `tests/acceptance/AC-243.spec.ts` suites stay green under the reconciled vocabulary
      (regression lock) with new positive cases for requestedFields/seed
      persistence before retrieval, and `tests/acceptance/AC-245.spec.ts`/`tests/acceptance/AC-247.spec.ts`
      cases for validity-interval credit resolution and
      DIAGNOSTIC_RETROSPECTIVE isolation (the validity-interval G1 cases use the
      persistence G1 edge writer writeDependenceEdge from
      packages/persistence/src/repos/dependence.ts, not the G0
      sources.ts path). Also reconcile the two G0-era substrate suites with plan
      ADR-1's vocabulary: `packages/domain/test/vocabulary.spec.ts` (reconciled
      ten-state list with `RETURNED_EMPTY` valid) and
      `packages/shared-schemas/test/data.spec.ts` (registry version 2 at both
      assertions; negative fixtures carry only reconciled states). Traces:
      FR-DATA-007, FR-DATA-009, FR-DATA-011, FR-DATA-012, FR-DATA-015, AC-020,
      AC-240, AC-242, AC-243, AC-245, AC-247.

## Phase 5 — Telemetry catalogs, manifest regen, full verification

- [x] T027 Extend `telemetry/data.catalog.json` (backfill.provenance_recorded,
      decision.timeline_recorded, dependence.edge_validity_updated,
      conflict.classified — fields mirroring the authoritative schemas, with
      requirementRefs FR-DATA-007…016) and create
      `telemetry/trd.catalog.json` (trade.normalized, trade.side_classified,
      trade.actor_downgraded, trade.double_count_blocked) and
      `telemetry/sup.catalog.json` (supply.assessed, supply.fallback_decided);
      all DECLARATIVE_CONTRACT_ONLY (G2 wiring). Extend
      `tests/telemetry-catalog.spec.ts` — the plan-sanctioned central-parity
      scope exception (milestone plan-level decision 4) — pinning the new
      catalogs to the authoritative schemas. Traces: FR-DATA-007, FR-DATA-009,
      FR-DATA-013, FR-DATA-016, FR-TRD-001, FR-TRD-002, FR-TRD-004,
      FR-SUP-001, FR-SUP-002.
- [ ] T028 [executor: COORDINATOR] [evidence: VERIFICATION_ONLY] Run the four
      milestone verification commands on the canonical tree: `test -d
packages/persistence && pnpm --filter @foresift/persistence test`,
      `test -d packages/evidence && pnpm --filter @foresift/evidence test`,
      `test -d packages/economic-trade-normalizer && pnpm --filter
@foresift/economic-trade-normalizer test`, `test -d
packages/supply-confidence && pnpm --filter
@foresift/supply-confidence test`. All green required. Traces:
      FR-DATA-007…016, FR-TRD-001…004, FR-SUP-001…002 (package-gate proof of
      every assigned requirement's substrate).
- [ ] T029 [executor: COORDINATOR] Regenerate the coordinator test manifest
      (`node scripts/automation/bun-migration-manifest.mjs --out
evidence/bun-migration/bun-migration-manifest.json`) after all new test
      files exist so `pnpm test`/`test:all` collect and classify them
      (PGlite-backed suites → DATABASE_PGLITE; OOM-safe per the test runtime
      contract). Mechanical bookkeeping (ADR-0020: coordinator-owned, zero-AI;
      the wave prep node regenerates the manifest mechanically — a writer
      touching `evidence/bun-migration/` is an ownership violation by law).
      Traces: FR-DATA-007…016,
      FR-TRD-001…004, FR-SUP-001…002 (verification substrate for every
      assigned requirement).
- [ ] T030 [executor: COORDINATOR] [evidence: VERIFICATION_ONLY] Run the full
      aggregate gate `pnpm verify` and the integrity gate `pnpm spec:verify`
      at the pushed HEAD; require green (the complete Bun suite runs ONLY
      through the coordinator — never a bare `bun test` over the tree). If
      anything turns red outside writeScopes, classify per governance, fix
      only in-scope failures, and record the rest in the run's out-of-scope
      notes. Traces: FR-DATA-007…016, FR-TRD-001…004, FR-SUP-001…002 (full
      suite + manifest integrity proof).

## Cross-artifact consistency analysis (speckit-analyze, completed at planning)

- **Coverage**: 16/16 assigned requirements traced; every assigned AC
  (AC-020…023, AC-130…136, AC-233, AC-240…249) has an owner task or an
  explicitly recorded boundary (AC-130…132 authored by g1-solana-security —
  spec I4; AC-244/248/249 substrate-only per spec §3 shared-AC scoping and
  the G0 precedent, extended only where G1 code participates).
- **Traceability**: no task cites a requirement outside the package's
  assignment (validator-enforced); every task cites ≥1 FR or AC.
- **Scope**: every predicted write lands inside writeScopes except the two
  plan-sanctioned exceptions (T013 central migration registry; T027 central
  telemetry parity suite) recorded here and in the milestone decomposition
  record; `evidence/bun-migration/bun-migration-manifest.json` regen (T029)
  is mechanical bookkeeping per repo precedent (g0-first-party-observation
  T063).
- **Ordering**: Phase 1 → 2 → 3 → 4 → 5 dependencies flow through explicit
  T-id references; vocabularies (Phase 1) precede schemas and SQL; SQL
  precedes repos; repos precede packages; suites precede the manifest regen
  and gates.
- **Read-only law**: no task introduces trading/custody/signing/
  transaction-submission capability; T017's normalizer is a pure consumer.
- **No placeholders**: no template markers, no unresolved clarification
  blocks anywhere in the scoped artifacts.
