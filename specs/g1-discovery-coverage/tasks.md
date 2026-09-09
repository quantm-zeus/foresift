# Tasks: g1-discovery-coverage

**Input**: `specs/g1-discovery-coverage/spec.md`, `specs/g1-discovery-coverage/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-DISC-006…014) or an acceptance criterion of those requirements. Requirement
IDs not assigned to this package never appear here.

Format: `- [ ] T### [P?]` — **[P]** = parallelizable with its neighbors (disjoint
files). A PRODUCT task that must stay serial carries exactly one
`[serial-reason: SEMANTIC_DEPENDENCY|SHARED_FILE|ORDERED_MIGRATION|SHARED_INVARIANT|COORDINATOR_BOUNDARY|SAFETY_SERIALIZATION]`
marker (2026-09-08 maintainer directive; the parallelism audit refuses an
unjustified serial plan). Test-owned work carries `[executor: TEST]` and is
routed to the test-author lanes; implementation-dispatched product tasks NEVER
carry test/fixture/spec writes (2026-09-07 ownership admission law — the graph
builder refuses such plans before any provider spend). Tests are mandatory per
PRD evidence rules: positive AND negative/failure-path facet cases for every
assigned AC (AC-110…113, AC-224…229) — added in place under the facet
convention, never rewriting existing cases.

Plan-sanctioned scope exceptions recorded per ADR-0019/0022 duty and milestone
plan-level decisions 1 and 4, named by exact path:
`packages/persistence/test/migrator.spec.ts` (central expected-script registry,
test-owned T024) and `tests/telemetry-catalog.spec.ts` (central telemetry parity
suite, test-owned T023) are extended by this package even though they sit
outside the listed writeScopes. No other out-of-scope write exists (ADR-5: zero
`packages/persistence/**` source writes — the Drizzle mirror excludes the
`disc` schema; no `docs/generated/**` regen per milestone plan-level decision 2).

**Vocabulary law (binding)**: the SQL CHECK/ENUM literal lists in plan.md's
data model are THE vocabulary authority. Every task below transcribes them
verbatim; no writer or test author may invent, rename, or omit members:

- DiscEntryReason (8): `FIRST_PARTY_SUPPORTED_PROGRAM_EVENT`, `FREE_AGGREGATE_OBSERVATION`, `AUTHORIZED_LAUNCH_NOTIFICATION`, `USER_WATCHLIST_ADDITION`, `AUTHORIZED_SOCIAL_MENTION`, `SELECTIVE_VERIFICATION_HIT`, `RETROSPECTIVE_ENUMERATION_HIT`, `STRATIFIED_SAMPLE_DRAW`
- DiscRightsBasis (5): `FIRST_PARTY_COLLECTOR`, `AUTHORIZED_FEED_CONTRACT`, `FREE_PUBLIC_TERMS`, `USER_PROVIDED`, `EXCLUDED`
- DiscManipulationPolicy (3): `LABEL_AND_RETAIN`, `LABEL_AND_DOWNWEIGHT`, `EXCLUDE_PAID_PLACEMENTS`
- DiscClaimBasis (3): `INDEPENDENT_FIRST_PARTY_OBSERVATION`, `INDEPENDENT_PROVIDER_LINEAGE`, `KNOWN_INCLUSION_PROBABILITIES`
- DiscConstraintKind (6): `COLLECTOR_GAP`, `DECODER_OUTAGE`, `UNVERIFIED_PROGRAM_VERSION`, `PROVIDER_UNAVAILABLE`, `RIGHTS_EXCLUSION`, `IDENTITY_UNRESOLVED`
- DiscConstraintEffect (3): `NARROW_CLAIM`, `EXCLUDE_WINDOW`, `BLOCK_CLAIM`
- DiscChainAccessPurpose (2): `VERIFICATION`, `RETROSPECTIVE_BACKFILL`
- DiscRecallVerdict (4): `INDEPENDENT_ESTIMATE`, `DEPENDENT_DISCLOSED`, `SELF_RECALL_REFUSED`, `NO_ADMISSIBLE_BASIS`
- DiscLatenessBasis (3): `SOURCE_OBSERVED_AT`, `SOURCE_PUBLISHED_AT`, `SOURCE_AVAILABLE_AT`

Staging order mirrors the PRD-mandated deterministic pipeline: vocabularies
first, then persistence, then the coverage-metrics core, then the
recall/constraint/claim/chain-access honesty layers, then the cheap-monitor
riders, then fixtures and AC suites, then telemetry and gates.

## Phase 1 — Domain vocabularies and error codes (blocks later phases)

- [ ] T001 [P] Create `packages/domain/src/disc.ts`: `DiscEntryReason` (8 members
      per vocabulary law), `DiscRightsBasis` (5), `DiscManipulationPolicy` (3),
      `DiscClaimBasis` (3), `DiscConstraintKind` (6), `DiscConstraintEffect`
      (3), `DiscChainAccessPurpose` (2), `DiscRecallVerdict` (4),
      `DiscLatenessBasis` (3) as const objects with fail-closed parse functions
      throwing typed `DiscError`s with stable `DiscErrorCode`s
      (DISC_ENTRY_REASON_UNKNOWN, DISC_RIGHTS_BASIS_UNKNOWN,
      DISC_MANIPULATION_POLICY_UNKNOWN, DISC_CLAIM_BASIS_UNKNOWN,
      DISC_CONSTRAINT_KIND_UNKNOWN, DISC_CONSTRAINT_EFFECT_UNKNOWN,
      DISC_CHAIN_ACCESS_PURPOSE_UNKNOWN, DISC_RECALL_VERDICT_UNKNOWN,
      DISC_LATENESS_BASIS_UNKNOWN); plus the pure laws
      `recallClaimBasisAdmissible` (FR-DISC-010: a claim basis is admissible
      only when first-party observation is independent, provider lineage is
      independent per the proven dependence resolution, or inclusion
      probabilities are valid — nonzero, within [0,1], covering the sampled
      strata), `selfRecallRefused` (FR-DISC-010: an evaluated source inside
      the generating universe's source set can never produce an independent
      recall claim), `constraintBlocksPublication` (FR-DISC-013: a standing
      unresolved BLOCK_CLAIM constraint refuses report publication), and
      `fullMarketLanguageSubstantiated` (FR-DISC-014: full-market /
      all-Solana / universal-recall language is substantiated only by an
      exhaustive sampling contract with recorded selection probabilities).
      Colocated unit tests are authored by the test-owned task T027
      (2026-09-07 ownership law: implementation lanes carry product work
      only). Traces: FR-DISC-006, FR-DISC-008, FR-DISC-009, FR-DISC-010,
      FR-DISC-013, FR-DISC-014.
- [ ] T002 [serial-reason: SEMANTIC_DEPENDENCY] Extend `packages/domain/src/errors.ts`
      with the DISC_* error-code block and the `DiscError` subclass, and extend
      `packages/domain/src/index.ts` exports for the new disc module. Traces:
      FR-DISC-006, FR-DISC-007, FR-DISC-008, FR-DISC-009, FR-DISC-010,
      FR-DISC-011, FR-DISC-012, FR-DISC-013, FR-DISC-014.

## Phase 2 — Shared schemas (blocks persistence repos and PGlite suites)

- [ ] T003 [P] Extend `packages/shared-schemas/src/disc.ts`: Zod schemas
      `DiscSourceProfileSchema` (FR-DISC-011: source/profile_version,
      sourceClass via the existing `DiscoverySourceClassSchema`, coverage
      scope object, rights basis (5 members), query/filter version,
      upstream-dependence disclosure, upstream lineage keys, manipulation
      policy, collector scope ids, effective window with
      superseded_at > effective_from refinement),
      `UniverseEntryProvenanceSchema` (FR-DISC-011: entry ref, normalized
      identity, entry reason (8 members), coverage-scope ref, rights record,
      query/filter version, upstream dependence object, first-party observed
      flag), `PopulationConstraintSchema` (FR-DISC-013: manifest ref, kind ×
      effect vocabularies, optional source/scope/program-version narrowing,
      window bounds, nonempty evidence refs, resolution timestamp),
      `ChainAccessDeclarationSchema` (FR-DISC-008: version, purpose,
      chain/program scope, the four positive numeric bounds, FREE-only cost
      class, paid-fallback structurally false, reserve compatibility,
      tolerance percent 1–100), `ChainAccessConsumptionSchema` (positive
      counts, optional incident ref), `RecallEstimateSchema` (FR-DISC-006/
      009/010: manifest ref, evaluated source, claim basis, verdict,
      [0,1] estimate, inclusion-probability source, evidence refs, constraint
      refs, asOf), and `CoverageMetricSetSchema` (FR-DISC-012/007: the §63.8
      metric field set with named-population + asOf + per-source attribution,
      refined so every null metric carries a quality code — never silently
      absent) — importing domain enums (never restating), `.strict()`,
      ISO-8601 Z timestamps, `sha256:<hex>` content addresses where
      applicable, `DISC_SCHEMA_REGISTRY_VERSION = 1`; unknown
      reason/effect/verdict/basis values fail closed; refinement enforces
      estimate-requires-basis and evidence-requires-verdict at the payload
      layer mirroring the SQL law. Colocated schema tests are authored by the
      test-owned task T027 (2026-09-07 ownership law). Traces: FR-DISC-006,
      FR-DISC-007, FR-DISC-008, FR-DISC-009, FR-DISC-010, FR-DISC-011,
      FR-DISC-012, FR-DISC-013.

## Phase 3 — Persistence: migration family `disc` + registry extension (blocks repos and PGlite suites)

- [ ] T004 [serial-reason: ORDERED_MIGRATION] Create
      `migrations/g1_disc_0001_source_profiles.sql`: `disc.disc_source_profiles`
      (additive-versioned, PRIMARY KEY (source_id, profile_version), the
      §63.2 source-class CHECK, DiscRightsBasis and DiscManipulationPolicy
      CHECK literals transcribed verbatim, effective/superseded window law)
      and `disc.universe_entry_provenance` (PRIMARY KEY entry_id FK to the
      proven `disc.discovery_universe_entries`, entry-reason / rights /
      coverage-scope / query-filter-version / upstream-dependence CHECKs,
      first-party-observed flag); plus the nullable rider columns on
      `disc.cheap_monitor_rows` (population_manifest_id, entry_provenance_id)
      and `disc.promotion_decisions` (population_manifest_id) — additive only,
      G0 state machines and CHECK laws untouched. Apply-on-PGlite clean,
      idempotent on replay. Traces: FR-DISC-009, FR-DISC-011.
- [ ] T005 [serial-reason: ORDERED_MIGRATION] Create
      `migrations/g1_disc_0002_constraints_gateways.sql`: the nine ENUM types
      (`disc_entry_reason`, `disc_claim_basis`, `disc_constraint_kind`,
      `disc_constraint_effect`, `disc_chain_access_purpose`,
      `disc_recall_verdict`, `disc_lateness_basis` — all members verbatim),
      `disc.population_constraints` (manifest FK, kind × effect, evidence-ref
      and resolution laws), `disc.chain_access_declarations` (versioned
      bounds, FREE-only cost CHECK, paid_fallback CHECK-false, tolerance),
      `disc.chain_access_consumption` (declaration FK, positive counts,
      incident ref), `disc.recall_estimates` (manifest FK, claim basis,
      verdict, [0,1] estimate, evidence and constraint refs, asOf;
      estimate-requires-basis and evidence-requires-verdict CHECKs); append-
      only `disc.refuse_mutation` triggers on source profiles, entry
      provenance, constraints, and recall estimates. Traces: FR-DISC-006,
      FR-DISC-008, FR-DISC-010, FR-DISC-013, FR-DISC-014.
- [ ] T006 [P] [executor: TEST] Extend the colocated migration suites
      `packages/discovery-universe/test/migrations.spec.ts` and
      `packages/cheap-monitor/test/migrations.spec.ts` (test-owned paths,
      2026-09-07 ownership law): g1_disc_0001/0002 discovery expectations,
      apply/idempotency coverage, and the rider-column SQL-truth assertions.
      Traces: FR-DISC-009, FR-DISC-011, FR-DISC-013.

## Phase 4 — Source profiles, provenance, and coverage metrics (blocks honesty layers)

- [ ] T007 [serial-reason: SEMANTIC_DEPENDENCY] Implement
      `packages/discovery-universe/src/source-profiles.ts` + extend
      `packages/discovery-universe/src/index.ts`: FR-DISC-011 — profile
      registration keyed (source_id, profile_version) with additive-version
      law (a change is a NEW version; superseding the current profile, never
      editing), entry-provenance persistence with idempotent upsert keyed by
      entry_id (ON CONFLICT DO NOTHING matching the G0 attribution seam),
      claim-support predicate (an entry without complete provenance cannot
      support a coverage or recall claim), and per-source profile lookup
      effective at an asOf timestamp. Depends on T001–T005. Colocated suites
      authored by test-owned T027 (ownership law). Traces: FR-DISC-011,
      FR-DISC-009, AC-110.
- [ ] T008 [serial-reason: SEMANTIC_DEPENDENCY] Implement
      `packages/discovery-universe/src/coverage-metrics.ts`: FR-DISC-012 +
      FR-DISC-007 — pure metric functions resolved at an explicit asOf
      boundary through the proven `visibleAt` predicate over the
      `DiscoveryUniverseRegistry` snapshot seam: unique discovery yield per
      source, pairwise overlap and effective independent yield (multiplying
      by the proven dependence multipliers via
      `calculateEffectiveIndependenceMultiplier`), first-seen lead/lag
      distribution (per source vs the earliest first-party observation),
      provider lateness (basis recorded: source_observed_at /
      source_published_at / source_available_at), source coverage loss
      (windows where a previously-yielding source yields nothing while
      collector scope stayed healthy), extended-at-first-seen rate, identity
      failures (unresolved-identity sightings excluded from double counting,
      counted as identity-failure rate instead — §63.12), unsupported-program
      exclusions (scope-manifest program/version set), and price extension at
      first system availability (consuming the proven economic observation
      substrate read-only). Every metric output is a
      `CoverageMetricSet` with named population + asOf + per-source
      attribution; null metrics carry quality codes. Depends on T003/T007.
      Colocated suites authored by test-owned T027 (ownership law). Traces:
      FR-DISC-007, FR-DISC-012, AC-225, AC-226.

## Phase 5 — Honesty layers: recall, constraints, claim language, chain access (blocks AC suites)

- [ ] T009 [serial-reason: SEMANTIC_DEPENDENCY] Implement
      `packages/discovery-universe/src/recall-estimator.ts`: FR-DISC-006 +
      FR-DISC-010 — claim-basis admission (three admissible bases via the T001
      pure laws), structural self-recall refusal (the evaluated source inside
      the generating universe's source set persists a `SELF_RECALL_REFUSED`
      verdict and can never yield `INDEPENDENT_ESTIMATE`), lineage
      independence through the proven dependence-edge resolution
      (`isEdgeValidAtTimestamp` at the estimate's asOf — point-in-time
      independence, INV-005), inclusion-probability weighted estimation
      (Horvitz–Thompson-style over the manifest's frozen
      `selectionProbabilities` for STRATIFIED_SAMPLED_UNIVERSE), retrospective
      classification consuming the proven `classifyRetrospectiveMiss` seam and
      extending it with inclusion-probability weighting (NOT_DISCOVERED only
      when evidence permits; retrospective evidence never enters the
      historical decision bundle — §63.9), and verdict records persisted to
      `disc.recall_estimates` with evidence refs. Depends on T001–T005, T007.
      Colocated suites authored by test-owned T027 (ownership law). Traces:
      FR-DISC-006, FR-DISC-009, FR-DISC-010, AC-111.
- [ ] T010 [serial-reason: SEMANTIC_DEPENDENCY] Implement
      `packages/discovery-universe/src/constraints.ts`: FR-DISC-013 —
      read-only resolution of the G0 constraint sources into versioned
      `disc.population_constraints` rows: collector gaps
      (`collector_gaps.recovery_status` OPEN/PARTIAL/UNRESOLVED →
      COLLECTOR_GAP, EXCLUDE_WINDOW over the gap window or BLOCK_CLAIM when
      beyond policy), decoder pauses (`col.collector_decode_pauses`
      non-REVALIDATED → DECODER_OUTAGE), unverified program versions
      (collector scope manifest program/version sets →
      UNVERIFIED_PROGRAM_VERSION), provider unavailability
      (`prov.prov_operations.health_status` degraded states →
      PROVIDER_UNAVAILABLE), rights exclusions and unresolved identities
      (RIGHTS_EXCLUSION / IDENTITY_UNRESOLVED per manifest fields); the
      report-gate predicate refusing publication while an unresolved
      BLOCK_CLAIM stands and attaching NARROW_CLAIM/EXCLUDE_WINDOW
      disclosures otherwise; constraints never counted as negative discovery
      outcomes (yield denominators exclude affected windows instead).
      Depends on T001–T005. Colocated suites authored by test-owned T027
      (ownership law). Traces: FR-DISC-013, FR-DISC-009, AC-224.
- [ ] T011 [P] Implement `packages/discovery-universe/src/claim-language.ts`:
      FR-DISC-014 — structured claim objects (scope adjectives
      FULL_MARKET/ALL_SOLANA/UNIVERSAL_RECALL evaluated against the cited
      manifest's population class and sampling contract; exhaustive
      selection probabilities required), typed `DISC_CLAIM_LANGUAGE_REFUSED`
      refusal, refusal recording for telemetry. Depends on T001–T003. Traces:
      FR-DISC-014, FR-DISC-009.
- [ ] T012 [P] Implement
      `packages/discovery-universe/src/chain-access-gate.ts`: FR-DISC-008 —
      declaration admission (purpose VERIFICATION or RETROSPECTIVE_BACKFILL,
      program scope, the four numeric bounds, FREE-only cost class,
      paid-fallback structurally false, protected-reserve compatibility),
      operation admission (a run declares the declaration it operates under;
      uncovered or over-bound operations refuse before any network call),
      consumption recording (slots/calls/candidates per run), tolerance-breach
      incident recording with effective-bound recomputation (no paid overage,
      no protected-reserve consumption — the proven reserve plane respected),
      and no silent widening (a changed bound is a NEW declaration version;
      in-place edits are unrepresentable). Depends on T001–T005. Traces:
      FR-DISC-008, AC-227, AC-229.
- [ ] T013 [P] Implement `packages/discovery-universe/src/read-only-guard.ts`:
      INV-001 structural surface asserting the package exposes no
      transaction-construction/submission/custody/signing surface and no
      model-provider/agent import; prohibited-capability scanner hook
      (`node scripts/scan-prohibited-capabilities/cli.mjs` clean on the
      package surface). Depends on T007–T012. Traces: FR-DISC-006,
      FR-DISC-007, FR-DISC-008, FR-DISC-009, FR-DISC-010, FR-DISC-011,
      FR-DISC-012, FR-DISC-013, FR-DISC-014.

## Phase 6 — Cheap-monitor population riders (blocks AC suites)

- [ ] T014 [serial-reason: SEMANTIC_DEPENDENCY] Implement
      `packages/cheap-monitor/src/population-riders.ts` + extend
      `packages/cheap-monitor/src/index.ts`: FR-DISC-009/011 — rider
      persistence linking `disc.cheap_monitor_rows` rows and
      `disc.promotion_decisions` to their population manifest and entry
      provenance; rider validation refusing nonexistent manifest refs and
      refusing rider-less promotion replay inputs; the existing batch
      scheduler and promotion state machines stay untouched (riders are
      additive reads/writes beside them). Depends on T001–T005. Colocated
      suites authored by test-owned T027 (ownership law). Traces: FR-DISC-009,
      FR-DISC-011, AC-112, AC-113.

## Phase 7 — Fixtures and acceptance/negative facet suites (blocks gates)

- [ ] T015 [P] [executor: TEST] Author `tests/fixtures/disc/source-profiles.ts` +
      `tests/fixtures/disc/entry-provenance.ts`: §63.2-classed profile vectors
      (all eight source classes; complete FR-DISC-011 field sets and
      incomplete refusals; versioned supersession chains) and per-entry
      provenance vectors (all eight entry reasons; complete and
      claim-breaking-incomplete variants; first-party vs non-first-party
      flags). Traces: FR-DISC-011, AC-110.
- [ ] T016 [P] [executor: TEST] Author `tests/fixtures/disc/metric-inputs.ts` +
      `tests/fixtures/disc/recall-samples.ts`: golden metric inputs (entries,
      dependence edges with proven multipliers, price observations, gap
      windows) covering every §63.8 metric bullet, and recall claim-basis
      vectors (independent first-party, independent lineage, valid inclusion
      probabilities, shared-lineage trap, self-recall trap, no-basis trap;
      NOT_DISCOVERED classification samples extending the existing
      retrospective fixture set). Traces: FR-DISC-006, FR-DISC-007,
      FR-DISC-010, FR-DISC-012.
- [ ] T017 [P] [executor: TEST] Author `tests/fixtures/disc/constraints.ts` +
      `tests/fixtures/disc/chain-access.ts`: collector-gap/decoder-pause/
      program-version/provider-health state vectors with expected constraint
      kinds and effects, and chain-access declaration/consumption vectors
      (bounded valid, unbounded refusal, paid-fallback refusal,
      reserve-incompatible refusal, tolerance-breach incident, silent-widening
      refusal). Traces: FR-DISC-008, FR-DISC-013.
- [ ] T018 [P] [executor: TEST] Author colocated product-side suites under
      `packages/discovery-universe/test/` (source-profiles.spec.ts,
      coverage-metrics.spec.ts, recall-estimator.spec.ts, constraints.spec.ts,
      claim-language.spec.ts, chain-access-gate.spec.ts,
      read-only-guard.spec.ts): profile additive-versioning law;
      provenance-completeness truth table; metric golden vectors (yield,
      overlap, effective independent yield, lead/lag, lateness bases,
      coverage loss, extended-at-first-seen, identity failures,
      unsupported-program exclusions, price extension at first availability);
      recall verdict truth table (all four verdicts reachable and
      deterministic; self-recall structurally refused with a persisted
      verdict); constraint kind × effect matrix and publication gate;
      claim-language refusals; chain-access bound/tolerance/incident law;
      no-execution/no-LLM structural scan. PGlite-backed suites classified
      DATABASE_PGLITE via the coordinator manifest (T022). Traces:
      FR-DISC-006, FR-DISC-007, FR-DISC-008, FR-DISC-009, FR-DISC-010,
      FR-DISC-011, FR-DISC-012, FR-DISC-013, FR-DISC-014.
- [ ] T019 [P] [executor: TEST] Author
      `packages/cheap-monitor/test/population-riders.spec.ts`: rider
      persistence and validation laws (rider-less promotion replay refusal,
      nonexistent manifest refusal, existing batch/promotion laws
      regression-locked). Traces: FR-DISC-009, FR-DISC-011, AC-112, AC-113.
- [ ] T020 [P] [executor: TEST] Extend shared AC suites IN PLACE (facet
      convention, spec file-ownership section — never rewrite or weaken
      existing cases): `tests/acceptance/AC-110.spec.ts` +
      `tests/negative/AC-110.negative.spec.ts` (per-source provenance
      facet, FR-DISC-011), `AC-111` pair (independent-universe classification
      facet, FR-DISC-006/010 — self-recall and shared-lineage refusals),
      `AC-112` pair (population-scoped bounded batches facet, FR-DISC-009),
      `AC-113` pair (replayable promotion with riders facet, FR-DISC-009/011),
      `AC-224` pair (constraint honesty facet, FR-DISC-013), `AC-225` pair
      (honest backfill availability facet, FR-DISC-011/012), `AC-226` pair
      (provider lateness decomposition facet, FR-DISC-007), `AC-227` pair
      (chain access inside capacity bounds facet, FR-DISC-008), `AC-228` pair
      (first-party continuity under exhaustion facet, FR-DISC-013/007),
      `AC-229` pair (consumption-tolerance incident facet, FR-DISC-008).
      Every pair gains at least one positive and one negative
      discovery-honesty case. Traces: FR-DISC-006, FR-DISC-007, FR-DISC-008,
      FR-DISC-009, FR-DISC-010, FR-DISC-011, FR-DISC-012, FR-DISC-013,
      FR-DISC-014, AC-110, AC-111, AC-112, AC-113, AC-224, AC-225, AC-226,
      AC-227, AC-228, AC-229.

## Phase 7b — Central registry extensions (blocks gates; plan-sanctioned scope exceptions)

- [ ] T021 [P] [executor: TEST] Extend `tests/telemetry-catalog.spec.ts` — the
      plan-sanctioned central-parity scope exception (milestone plan-level
      decision 4, exact path) — with the extended `telemetry/disc.catalog.json`
      assertions pinning every new event's fields to the authoritative shared
      schemas field-for-field. No product surface is authored here. Traces:
      FR-DISC-006, FR-DISC-007, FR-DISC-008, FR-DISC-009, FR-DISC-010,
      FR-DISC-011, FR-DISC-012, FR-DISC-013, FR-DISC-014.
- [ ] T022 [P] [executor: TEST] Extend the central expected-script registry
      `packages/persistence/test/migrator.spec.ts` — the plan-sanctioned
      scope exception (ADR-0019/0022 duty, exact path): add
      `g1_disc_0001_source_profiles` and `g1_disc_0002_constraints_gateways`
      in lexicographic position in ALL FOUR expected-script lists and update
      the applied-count assertions (58 → 60). No other
      `packages/persistence/**` write exists (ADR-5: the Drizzle mirror
      excludes the `disc` schema). Traces: FR-DISC-009, FR-DISC-011,
      FR-DISC-013 (persistence substrate for every assigned requirement).

- [ ] T027 [P] [executor: TEST] Author the colocated domain and
      shared-schema suites `packages/domain/test/disc.spec.ts` +
      `packages/shared-schemas/test/disc.spec.ts` named by T001-T014:
      the nine §63.12 vocabulary objects with fail-closed parse functions
      and stable `DiscErrorCode`s (unknown member refusal for every
      vocabulary), the pure laws (recallClaimBasisAdmissible truth table
      over the three admissible bases, selfRecallRefused, constraintBlocksPublication,
      fullMarketLanguageSubstantiated), the DISC_* error-code block and
      DiscError subclass export surface, and the shared-schema payload
      laws (DiscSourceProfileSchema supersession refinement,
      UniverseEntryProvenanceSchema completeness,
      PopulationConstraintSchema kind × effect vocabulary,
      ChainAccessDeclarationSchema bound/tolerance/cost-class law,
      RecallEstimateSchema estimate-requires-basis,
      CoverageMetricSetSchema null-metric-requires-quality-code, unknown
      enum refusal, strict unknown-key refusal, ISO-8601 timestamps,
      sha256 content addresses). Traces: FR-DISC-006, FR-DISC-007,
      FR-DISC-008, FR-DISC-009, FR-DISC-010, FR-DISC-011, FR-DISC-012,
      FR-DISC-013, FR-DISC-014.

## Phase 8 — Telemetry catalog, manifest regen, and gates

- [ ] T023 [P] Extend `telemetry/disc.catalog.json` (DECLARATIVE_CONTRACT_ONLY
      header preserved, fields mirroring `packages/shared-schemas/src/disc.ts`
      exactly, requirementRefs per event): `disc.profile_registered`
      (FR-DISC-011), `disc.provenance_recorded` (FR-DISC-011),
      `disc.coverage_measured_v2` (FR-DISC-007/012), `disc.constraint_recorded`
      (FR-DISC-013), `disc.recall_estimated` (FR-DISC-006/009/010),
      `disc.chain_access_admitted` (FR-DISC-008), `disc.chain_access_incident`
      (FR-DISC-008), `disc.claim_language_refused` (FR-DISC-014). The central
      telemetry parity suite is extended by the test-owned task T021 in the
      same package — the plan-sanctioned central-parity scope exception.
      Traces: FR-DISC-006, FR-DISC-007, FR-DISC-008, FR-DISC-009,
      FR-DISC-010, FR-DISC-011, FR-DISC-012, FR-DISC-013, FR-DISC-014.
- [ ] T024 [executor: COORDINATOR] [evidence: VERIFICATION_ONLY] Run the
      milestone verification commands on the canonical tree — the
      discovery-universe and cheap-monitor package suites plus the extended
      central suites (persistence migrator via the workspace filter, the
      telemetry parity spec) — and the authored/extended AC files
      (AC-110…113, AC-224…229 discovery facets). All green required. Traces:
      FR-DISC-006, FR-DISC-007, FR-DISC-008, FR-DISC-009, FR-DISC-010,
      FR-DISC-011, FR-DISC-012, FR-DISC-013, FR-DISC-014 (package-gate proof
      of every assigned requirement's substrate).
- [ ] T025 [executor: COORDINATOR] Regenerate the coordinator test manifest
      (`node scripts/automation/bun-migration-manifest.mjs --out
      evidence/bun-migration/bun-migration-manifest.json`) after all new test
      files exist so `pnpm test`/`test:all` collect and classify them
      (PGlite-backed suites → DATABASE_PGLITE; OOM-safe per the test runtime
      contract). Mechanical bookkeeping (ADR-0020: coordinator-owned,
      zero-AI). Traces: FR-DISC-006, FR-DISC-007, FR-DISC-008, FR-DISC-009,
      FR-DISC-010, FR-DISC-011, FR-DISC-012, FR-DISC-013, FR-DISC-014
      (verification substrate for every assigned requirement).
- [ ] T026 [executor: COORDINATOR] [evidence: VERIFICATION_ONLY] Run the full
      aggregate gate `pnpm verify` and the integrity gate `pnpm spec:verify`
      at the pushed HEAD; require green (the complete Bun suite runs ONLY
      through the coordinator — never a bare `bun test` over the tree). If
      anything turns red outside writeScopes, classify per governance, fix
      only in-scope failures, and record the rest in the run's out-of-scope
      notes. Traces: FR-DISC-006, FR-DISC-007, FR-DISC-008, FR-DISC-009,
      FR-DISC-010, FR-DISC-011, FR-DISC-012, FR-DISC-013, FR-DISC-014 (full
      suite + manifest integrity proof).

## Task → requirement coverage matrix

| Task | Requirements | ACs | Key files |
| ---- | ------------ | --- | --------- |
| T001 | FR-DISC-006, FR-DISC-008, FR-DISC-009, FR-DISC-010, FR-DISC-013, FR-DISC-014 | — | packages/domain/src/disc.ts (vocabulary law) |
| T002 | FR-DISC-006…014 | — | packages/domain/src/errors.ts, index.ts |
| T003 | FR-DISC-006…013 | — | packages/shared-schemas/src/disc.ts |
| T004 | FR-DISC-009, FR-DISC-011 | — | migrations/g1_disc_0001_source_profiles.sql |
| T005 | FR-DISC-006, FR-DISC-008, FR-DISC-010, FR-DISC-013, FR-DISC-014 | — | migrations/g1_disc_0002_constraints_gateways.sql |
| T006 | FR-DISC-009, FR-DISC-011, FR-DISC-013 | — | packages/*/test/migrations.spec.ts |
| T007 | FR-DISC-011, FR-DISC-009 | AC-110 | packages/discovery-universe/src/source-profiles.ts |
| T008 | FR-DISC-007, FR-DISC-012 | AC-225, AC-226 | packages/discovery-universe/src/coverage-metrics.ts |
| T009 | FR-DISC-006, FR-DISC-009, FR-DISC-010 | AC-111 | packages/discovery-universe/src/recall-estimator.ts |
| T010 | FR-DISC-013, FR-DISC-009 | AC-224 | packages/discovery-universe/src/constraints.ts |
| T011 | FR-DISC-014, FR-DISC-009 | — | packages/discovery-universe/src/claim-language.ts |
| T012 | FR-DISC-008 | AC-227, AC-229 | packages/discovery-universe/src/chain-access-gate.ts |
| T013 | FR-DISC-006…014 | — | packages/discovery-universe/src/read-only-guard.ts |
| T014 | FR-DISC-009, FR-DISC-011 | AC-112, AC-113 | packages/cheap-monitor/src/population-riders.ts |
| T015 | FR-DISC-011 | AC-110 | tests/fixtures/disc/source-profiles.ts, entry-provenance.ts |
| T016 | FR-DISC-006, FR-DISC-007, FR-DISC-010, FR-DISC-012 | AC-111, AC-225, AC-226 | tests/fixtures/disc/metric-inputs.ts, recall-samples.ts |
| T017 | FR-DISC-008, FR-DISC-013 | AC-224, AC-227, AC-229 | tests/fixtures/disc/constraints.ts, chain-access.ts |
| T018 | FR-DISC-006…014 | AC-110…113, AC-224…229 | packages/discovery-universe/test/*.spec.ts |
| T019 | FR-DISC-009, FR-DISC-011 | AC-112, AC-113 | packages/cheap-monitor/test/population-riders.spec.ts |
| T020 | FR-DISC-006…014 | AC-110…113, AC-224…229 | tests/acceptance/AC-*.spec.ts, tests/negative/AC-*.negative.spec.ts |
| T021 | FR-DISC-006…014 | — | tests/telemetry-catalog.spec.ts (sanctioned exception) |
| T022 | FR-DISC-009, FR-DISC-011, FR-DISC-013 | — | packages/persistence/test/migrator.spec.ts (sanctioned exception) |
| T023 | FR-DISC-006…014 | — | telemetry/disc.catalog.json |
| T024 | FR-DISC-006…014 | AC-110…113, AC-224…229 | — (verification) |
| T025 | FR-DISC-006…014 | — | evidence/bun-migration/bun-migration-manifest.json (coordinator) |
| T026 | FR-DISC-006…014 | — | — (verification) |

## Cross-artifact consistency analysis (speckit-analyze, completed at planning)

- **Coverage**: 9/9 assigned requirements traced (FR-DISC-006…014); every
  assigned AC has an explicit owner: all ten ACs (AC-110…113, AC-224…229)
  extended in place under the facet convention here (T020 positive+negative
  authorship, T018/T019 colocated suites); the collector-machinery facet of
  AC-224/225 stays with the collector owners and the cost-capacity facets
  with g1-capacity-contracts (PROVEN) — no case in this package duplicates
  those facets.
- **Traceability**: no task cites a requirement outside the package's
  assignment (validator-enforced: FR-COST/FR-COL/FR-SIG/FR-EVAL/FR-OBJ and
  every non-FR-DISC ID are absent from tasks.md); every task cites ≥1
  FR-DISC-006…014 ID or its AC.
- **Scope**: every predicted write lands inside writeScopes except the
  plan-sanctioned exceptions named by exact path (T022 central migration
  registry suite, test-owned; T021 central telemetry parity suite, test-owned;
  T025 mechanical manifest regen per ADR-0020 coordinator duty), consistent
  with the live g1-data-truth (#175) / g1-signal-registry (#245) precedent.
  Ownership routing per the 2026-09-07 admission law: all test/fixture/spec
  authorship lives in test-owned tasks (T015–T022), implementation lanes carry
  product code only (T001–T014); parallelism markers per the 2026-09-08
  directive: [P] on write-disjoint tasks (T011, T012, T013, T015–T019, T021,
  T023), exactly one six-vocabulary [serial-reason] on each truly-serial
  product task (ORDERED_MIGRATION for the g1_disc migration pair T004–T006;
  SEMANTIC_DEPENDENCY for the vocabulary → schema → metrics → honesty-layer
  chain T002/T007/T008/T009/T010/T014).
- **Ordering**: the deterministic pipeline staging order is enforced by phase
  structure and explicit dependency references: Phase 1 vocabularies → Phase 2
  schemas → Phase 3 persistence → Phase 4 profiles/metrics → Phase 5 honesty
  layers → Phase 6 riders → Phase 7 fixtures/suites → Phase 7b central
  extensions → Phase 8 telemetry + gates. `(blocks` headings in phases add
  the blocking-phase dependency edges the task-graph builder requires.
- **Read-only law**: no task introduces trading/custody/signing/transaction-
  submission capability or any model/LLM surface; T013 runs the structural
  scan and the prohibited-capability scanner as explicit gates; chain access
  is admitted only as bounded read-only verification/backfill (ADR-4).
- **No placeholders**: no template markers, no unresolved clarification
  blocks anywhere in the scoped artifacts.
