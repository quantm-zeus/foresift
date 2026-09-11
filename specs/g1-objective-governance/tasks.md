# Tasks: g1-objective-governance

**Input**: `specs/g1-objective-governance/spec.md`, `specs/g1-objective-governance/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-OBJ-001…010) or an acceptance criterion of those requirements. Requirement
IDs not assigned to this package never appear here.

Format: `- [ ] T### [P?]` — **[P]** = parallelizable with its neighbors
(disjoint files). A task that must stay serial carries exactly one
`[serial-reason: SEMANTIC_DEPENDENCY|SHARED_FILE|ORDERED_MIGRATION|SHARED_INVARIANT|COORDINATOR_BOUNDARY|SAFETY_SERIALIZATION]`
marker (2026-09-08 maintainer directive; the parallelism audit refuses an
unjustified serial plan). Test-owned work carries `[executor: TEST]` and is
routed to the test-author lanes; implementation-dispatched product tasks NEVER
carry test/fixture/spec writes (2026-09-07 ownership admission law — the graph
builder refuses such plans before any provider spend). Tests are mandatory per
PRD evidence rules: positive AND negative/failure-path specs for every AC this
package authors (AC-220…223 — 8 files) plus additive obj-facet extends of the
shared AC-245…249 suites (existing content untouched).

Plan-sanctioned scope exceptions recorded per ADR-0019/0022 duty and milestone
plan-level decisions 1 and 4, named by exact path:
`packages/persistence/src/migrator.ts` (family-list extension with `obj`,
product-owned T005 — exact g1-outcome-evaluation T005 precedent),
`packages/persistence/src/generated/schema.ts` (ADR-001 mirror catch-up,
product-owned T006 — the #175/#208/#245 precedent),
`packages/persistence/test/migrator.spec.ts` (central expected-script
registry, test-owned T027), and the central telemetry parity suite
`tests/telemetry-catalog.spec.ts` (test-owned T026). No other out-of-scope
write exists. `docs/generated/obj-surfaces.json` already exists from the G0
central generation and is untouched; `scripts/scan-prohibited-capabilities/**`
is G0-owned and untouched (FR-OBJ-010 decision-6 boundary).

**Vocabulary law (binding)**: the SQL CHECK/ENUM literal lists in plan.md's
data model are THE vocabulary authority. Every task below transcribes them
verbatim; no writer or test author may invent, rename, or omit members:

- ComparisonDimension (8): `CANDIDATE_UNIVERSE`, `POPULATION_CLAIM`,
  `CAPITAL`, `TIME_WINDOW`, `EXECUTION_SCENARIO`, `DELAY_POLICY`,
  `DATA_CUTOFF`, `CORRELATED_EXPOSURE`
- RunComparability (2): `COMPARABLE`, `EXPLORATORY_ONLY`
- HardConstraintKind (7): `SECURITY`, `EXECUTION`, `RIGHTS`, `LEAKAGE`,
  `PUBLIC_CLAIM`, `CAPACITY`, `TAIL_RISK`
- HardConstraintVerdict (2): `PASS`, `FAIL`
- UtilityLineKind (12): `GROSS_RETURN`, `EXECUTION_COSTS`,
  `FAILED_PARTIAL_FILLS`, `DRAWDOWN`, `CVAR`, `CAPITAL_UTILIZATION`,
  `TURNOVER`, `OPPORTUNITY_COST`, `CONCENTRATION`,
  `SHARED_LIQUIDITY_IMPACT`, `PROVIDER_MODEL_INFRA_COST`, `UNCERTAINTY`
- DiagnosticKind (4): `PER_ALERT_PRECISION`, `TRADABLE_SUCCESS_RATE`,
  `RECALL`, `ALERTS_PER_RESEARCHED_CANDIDATE`
- IntegritySignalKind (7): `DENOMINATOR_GAMING`,
  `SELECTIVE_UNIVERSE_CHANGE`, `REDUCED_EXPLORATION`,
  `DELAYED_OUTCOME_OMISSION`, `HORIZON_SWITCHING`,
  `SCENARIO_CHERRY_PICKING`, `REPEATED_HOLDOUT_INSPECTION`
- IntegrityVerdict (2): `PASS`, `FAIL_BLOCKS_PROMOTION`
- ClaimScopeField (11): `SUPPORTED_POPULATION`, `PROFILE`, `POLICY`,
  `EXECUTION_SCENARIO`, `DELAY_DISTRIBUTION`, `CALENDAR_INTERVAL`,
  `MARKET_REGIMES`, `CAPABILITY_STATE`, `SAMPLE_SIZE`,
  `CLUSTER_EFFECTIVE_SAMPLE_SIZE`, `UNCERTAINTY_METHOD`
- DelayScenario (3): `P50`, `P90`, `CONSERVATIVE_TAIL`
- SensitivityDimension (7): `CAPITAL`, `NOTIONAL`, `CONCURRENCY`,
  `ROUTE_CAPACITY`, `ALERT_LATENCY`, `EXIT_POLICY`, `RISK_AVERSION`
- ProhibitedClaimKind (4): `GUARANTEED_PROFIT`, `ASSURED_RETURN`,
  `RISK_FREE_PROFIT`, `CERTAIN_GAIN`
- PromotionVerdict (3): `PROMOTE`, `HOLD_EXPLORATORY_ONLY`, `BLOCK`

Staging order mirrors the deterministic pipeline: vocabularies/laws first,
then shared schemas, then scaffolds and persistence (migrations + registry +
mirror), then the utility ledger, then the governance gates, then fixtures
and AC suites, then telemetry and gates.

## Phase 1 — Domain vocabularies and pure laws (blocks later phases)

- [x] T001 [P] Create `packages/domain/src/obj.ts`: all fourteen const
      vocabularies above with fail-closed parse functions throwing typed
      `ObjError`s with stable `ObjErrorCode`s (OBJ_DIMENSION_UNKNOWN,
      OBJ_COMPARABILITY_UNKNOWN, OBJ_CONSTRAINT_KIND_UNKNOWN,
      OBJ_CONSTRAINT_VERDICT_UNKNOWN, OBJ_LINE_KIND_UNKNOWN,
      OBJ_DIAGNOSTIC_KIND_UNKNOWN, OBJ_INTEGRITY_SIGNAL_UNKNOWN,
      OBJ_CLAIM_FIELD_UNKNOWN, OBJ_DELAY_SCENARIO_UNKNOWN,
      OBJ_SENSITIVITY_DIMENSION_UNKNOWN, OBJ_PROHIBITED_CLAIM_UNKNOWN,
      OBJ_PROMOTION_VERDICT_UNKNOWN, OBJ_INCOMPARABLE_PROMOTION_REFUSED,
      OBJ_HARD_CONSTRAINT_FAILED, OBJ_DIAGNOSTIC_AS_OBJECTIVE_REFUSED,
      OBJ_INTEGRITY_FAILURE_BLOCKS_PROMOTION, OBJ_CLAIM_SCOPE_INCOMPLETE,
      OBJ_SINGLE_DELAY_EVIDENCE_REFUSED,
      OBJ_FROZEN_EXPERIMENT_REWRITE_REFUSED, OBJ_GUARANTEED_LANGUAGE_REFUSED,
      OBJ_UNCERTAINTY_DISCLOSURE_MISSING, OBJ_FLOAT_ARITHMETIC_REFUSED);
      plus the pure laws `comparabilityRequiresAllDimensions` (exact pairwise
      equality on all eight dimensions; missing record refuses),
      `hardConstraintsPrecedeUtility` (any FAIL or unevaluated kind refuses
      before utility is consulted), `lowerBoundUtility` (pinned
      `Z_ONE_SIDED_95_MICROS = 1644854` at 1e6 scale, ceiling division,
      integer micro-units only), `decompositionReconciles` (twelve lines sum
      exactly to net), `diagnosticsExcludedByConstruction`
      (promotion-verdict input type carries no diagnostic fields),
      `integrityFailureBlocksPromotion` (any firing signal blocks),
      `claimScopeComplete` (eleven-for-eleven or refusal),
      `robustDelayRequired` (all three scenarios evidenced, declared gate
      passed), `frozenRecordImmutable` (sensitivity derives, never mutates),
      and `uncertaintyDisclosureRequired` (every screened output carries the
      research-signal disclosure). Colocated unit tests are authored by the
      test-owned task T013 (2026-09-07 ownership law). Traces: FR-OBJ-001,
      FR-OBJ-002, FR-OBJ-003, FR-OBJ-004, FR-OBJ-005, FR-OBJ-006, FR-OBJ-007,
      FR-OBJ-008, FR-OBJ-009, FR-OBJ-010.
- [x] T002 [P] Create `packages/shared-schemas/src/obj.ts`: Zod runtime
      mirrors importing every `ALL_*` list from `@foresift/domain`
      (compile-parity law; never restated), `OBJ_SCHEMA_REGISTRY_VERSION`,
      strict objects with `signedDecimal`/`unsignedDecimal` money conventions
      at the boundary, and `superRefine` cross-field rules (verdict/reason
      coupling on integrity records, twelve-line reconciliation on reports,
      eleven-field completeness on claim scopes, three-scenario presence on
      delay evidence). Uncertainty-method and cluster-definition fields reuse
      the eval-proven schemas by import. Colocated tests by test-owned T014.
      Traces: FR-OBJ-001, FR-OBJ-002, FR-OBJ-003, FR-OBJ-004, FR-OBJ-005,
      FR-OBJ-006, FR-OBJ-007, FR-OBJ-008, FR-OBJ-009, FR-OBJ-010.

## Phase 2 — Scaffolds and persistence

- [x] T003 [P] Create package scaffolds `packages/objective-governance/` and
      `packages/shadow-portfolio/` (`package.json` with workspace `*`
      dependencies and `bun test` script, `tsconfig.json` extending
      `tsconfig.base.json`, stub `src/index.ts` barrels). No other files.
      Traces: FR-OBJ-001, FR-OBJ-004.
- [x] T004 [P] Create `migrations/g1_obj_0001_objective_runs.sql`,
      `migrations/g1_obj_0002_utility_ledger.sql`, and
      `migrations/g1_obj_0003_integrity_claims.sql` per plan.md's data model
      (frozen `objective_runs` with eight dimension columns and
      append-only semantics; `capital_day_utility` with twelve micro-unit
      line columns plus reconciliation CHECK; `integrity_incidents`,
      `claim_scope_records`, `promotion_decisions`, and
      `output_language_screens` with CHECK-pinned enum literals from the
      vocabulary law). Migration tests by test-owned T018. Traces:
      FR-OBJ-001, FR-OBJ-002, FR-OBJ-004, FR-OBJ-006, FR-OBJ-007.
- [ ] T005 [P] Extend the fail-closed family list in
      `packages/persistence/src/migrator.ts` (`MIGRATION_FAMILIES` regex)
      with `obj` (plan-sanctioned scope exception 1; ADR-0019/0022 duty).
      Traces: FR-OBJ-001.
- [ ] T006 [serial-reason: SEMANTIC_DEPENDENCY] Catch the hand-maintained
      ADR-001 Drizzle mirror
      `packages/persistence/src/generated/schema.ts` up to the three new SQL
      files (plan-sanctioned scope exception 2; content depends on T004).
      Traces: FR-OBJ-001.
- [x] T007 [serial-reason: SHARED_FILE] Export the new modules from the
      existing barrels `packages/domain/src/index.ts` and
      `packages/shared-schemas/src/index.ts` (additive export lines only;
      shared files). Traces: FR-OBJ-001, FR-OBJ-002, FR-OBJ-003, FR-OBJ-004,
      FR-OBJ-005, FR-OBJ-006, FR-OBJ-007, FR-OBJ-008, FR-OBJ-009, FR-OBJ-010.

## Phase 3 — Utility ledger and governance gates (product)

- [x] T008 [P] Create `packages/shadow-portfolio/src/utility-ledger.ts`,
      `capital-day.ts`, and `read-only-guard.ts` (outcome-maturity scanner
      precedent: prohibited-import/identifier lists plus binary-float
      detection on the aggregation path): versioned fills fold into
      per-capital-day net utility with the twelve decomposition lines,
      idempotent natural-key upserts, fixed-capital denominators. No
      allocation policy, no portfolio comparison, no engine semantics beyond
      the twelve lines (G7 boundary stated in the module header). Unit tests
      by test-owned T015. Traces: FR-OBJ-001, FR-OBJ-004.
- [x] T009 [P] Create `packages/objective-governance/src/objective-function.ts`,
      `comparability.ts`, and `hard-constraints.ts` per plan.md (float-free
      LCB core; eight-dimension pairwise equality with refusal on missing
      records; total seven-kind evaluation before utility). Unit tests by
      test-owned T016. Traces: FR-OBJ-001, FR-OBJ-002, FR-OBJ-003.
- [x] T010 [P] Create `packages/objective-governance/src/decomposition.ts`,
      `diagnostics.ts`, and `claim-scope.ts` per plan.md (reconciling
      twelve-line reports; diagnostic computation with diagnostic-only
      labeling and verdict-type exclusion; eleven-field completeness with
      refusal). Unit tests by test-owned T016. Traces: FR-OBJ-004,
      FR-OBJ-005, FR-OBJ-007.
- [x] T011 [P] Create `packages/objective-governance/src/integrity.ts`,
      `delay-gate.ts`, and `sensitivity.ts` per plan.md (seven detectors over
      consumed frozen-run evidence; three-scenario distribution with declared
      robust-delay gate; seven-dimension grids derived from the frozen record
      with parent-hash references and mutation refusal). Unit tests by
      test-owned T016. Traces: FR-OBJ-006, FR-OBJ-008, FR-OBJ-009.
- [x] T012 [serial-reason: SEMANTIC_DEPENDENCY] Create
      `packages/objective-governance/src/prohibited-language.ts`,
      `promotion-gate.ts`, and the full `src/index.ts` barrel per plan.md
      (four-kind deterministic screen with mandatory disclosure attachment
      inside the decision-6 G1 boundary; nine-stage gate composition in the
      normative order with no diagnostic inputs in the signature; composes
      T009–T011 outputs). Unit tests by test-owned T017. Traces: FR-OBJ-010,
      FR-OBJ-001, FR-OBJ-002, FR-OBJ-003, FR-OBJ-004, FR-OBJ-005, FR-OBJ-006,
      FR-OBJ-007, FR-OBJ-008, FR-OBJ-009.

## Phase 4 — Unit and migration tests (test-owned)

- [ ] T013 [P] [executor: TEST] Colocated unit tests for
      `packages/domain/src/obj.ts`: every parse function accepts each listed
      member and rejects unknowns with the stable code; every pure law holds
      on representative inputs (incomparable promotion refused, unevaluated
      constraint refused, lines reconcile, single-delay evidence refused,
      frozen rewrite refused). Traces: FR-OBJ-001, FR-OBJ-002, FR-OBJ-003,
      FR-OBJ-004, FR-OBJ-005, FR-OBJ-006, FR-OBJ-007, FR-OBJ-008, FR-OBJ-009,
      FR-OBJ-010.
- [ ] T014 [P] [executor: TEST] Colocated tests for
      `packages/shared-schemas/src/obj.ts`: valid records parse; each
      cross-field rule rejects its violation class (verdict/reason mismatch,
      non-reconciling lines, ten-of-eleven scope, two-of-three delay
      scenarios). Traces: FR-OBJ-001, FR-OBJ-004, FR-OBJ-006, FR-OBJ-007,
      FR-OBJ-008.
- [ ] T015 [P] [executor: TEST] Unit tests for `packages/shadow-portfolio`
      (fold determinism, idempotent re-insert, capital-day denominators,
      twelve-line reconciliation) and both `read-only-guard.ts` scanners
      (prohibited import/identifier detection, float detection on the
      objective path). Traces: FR-OBJ-001, FR-OBJ-004.
- [ ] T016 [P] [executor: TEST] Unit tests for governance gates A–C
      (LCB bit-determinism across repeated runs with pinned constant;
      comparability matrix over all eight dimensions; seven-kind hard-fail
      matrix with strongly positive scores; decomposition reconciliation;
      diagnostics labeling; eleven-field refusal matrix). Traces: FR-OBJ-001,
      FR-OBJ-002, FR-OBJ-003, FR-OBJ-004, FR-OBJ-005, FR-OBJ-006, FR-OBJ-007,
      FR-OBJ-008, FR-OBJ-009.
- [ ] T017 [serial-reason: SEMANTIC_DEPENDENCY] [executor: TEST] Unit tests
      for part D (every `ProhibitedClaimKind` pattern screened, disclosure
      present on all opportunity outputs, G1-boundary surfaces only;
      promotion-gate nine-stage order, full verdict matrix incl.
      `HOLD_EXPLORATORY_ONLY` for incomparable runs and `BLOCK` on any
      integrity failure). Depends on T012. Traces: FR-OBJ-010, FR-OBJ-001,
      FR-OBJ-002, FR-OBJ-003, FR-OBJ-006.
- [ ] T018 [P] [executor: TEST] PGlite-backed migration tests for the three
      `g1_obj_*` files (CHECK enforcement per enum list, run immutability
      with new-run corrections, reconciliation CHECK, append-only incident
      table). Traces: FR-OBJ-001, FR-OBJ-002, FR-OBJ-004, FR-OBJ-006,
      FR-OBJ-007.

## Phase 5 — Fixtures and AC suites (test-owned)

- [ ] T019 [P] [executor: TEST] Fixtures under `tests/fixtures/obj/`:
      utility series with a win-rate-vs-utility inversion pair; comparable
      and incomparable run pairs per dimension; seven-kind constraint
      matrices; one integrity case per signal kind; complete and
      field-dropped claim scopes; three-scenario delay distributions;
      seven-dimension sensitivity grids; prohibited-language samples per
      claim kind. Traces: FR-OBJ-001, FR-OBJ-002, FR-OBJ-003, FR-OBJ-004,
      FR-OBJ-005, FR-OBJ-006, FR-OBJ-007, FR-OBJ-008, FR-OBJ-009, FR-OBJ-010.
- [x] T020 [P] [executor: TEST] Author the four positive suites
      `tests/acceptance/AC-220.spec.ts`, `AC-221.spec.ts`, `AC-222.spec.ts`,
      and `AC-223.spec.ts` per plan.md's verification strategy (utility
      beats win rate; post-hoc change invalidates with incident; eleven-field
      views accepted; seven-kind hard fails refuse despite positive scores).
      Traces: FR-OBJ-001, FR-OBJ-002, FR-OBJ-003, FR-OBJ-005, FR-OBJ-006,
      FR-OBJ-007, FR-OBJ-009, FR-OBJ-010.
- [x] T021 [P] [executor: TEST] Author the four negative suites
      `tests/negative/AC-220.negative.spec.ts`,
      `AC-221.negative.spec.ts`, `AC-222.negative.spec.ts`, and
      `AC-223.negative.spec.ts` (diagnostic-only promotion attempt blocked;
      silent mutation impossible, backdated edits refused; each dropped scope
      field refused; six-of-seven evaluation still refuses, score inputs
      unreachable). Traces: FR-OBJ-001, FR-OBJ-002, FR-OBJ-003, FR-OBJ-005,
      FR-OBJ-006, FR-OBJ-007, FR-OBJ-009, FR-OBJ-010.
- [x] T022 [serial-reason: SHARED_FILE] [executor: TEST] Additive obj-facet
      `describe` blocks in `tests/acceptance/AC-245.spec.ts`,
      `AC-246.spec.ts`, and `AC-247.spec.ts` (existing content untouched):
      lineage-collapse sensitivity present; duplicated evidence cannot
      support independent confirmation; retrospective estimates never alter
      frozen utility counts. Traces: FR-OBJ-006, FR-OBJ-007, FR-OBJ-009.
- [x] T023 [serial-reason: SHARED_FILE] [executor: TEST] Additive obj-facet
      `describe` blocks in `tests/negative/AC-245.negative.spec.ts`,
      `AC-246.negative.spec.ts`, and `AC-247.negative.spec.ts` (existing
      content untouched): collapsed-lineage confirmation refused; frozen
      counts immutable under retrospective estimates. Traces: FR-OBJ-006,
      FR-OBJ-007, FR-OBJ-009.
- [x] T024 [serial-reason: SHARED_FILE] [executor: TEST] Additive obj-facet
      `describe` blocks in `tests/acceptance/AC-248.spec.ts`,
      `AC-249.spec.ts`, `tests/negative/AC-248.negative.spec.ts`, and
      `AC-249.negative.spec.ts` (existing content untouched): promotion fails
      below mature counts / ESS / coverage / precision despite favorable
      point estimates; consumed control failures block promotion. Traces:
      FR-OBJ-001, FR-OBJ-006.

## Phase 6 — Telemetry, registry, and verification (test-owned)

- [ ] T025 [P] [executor: TEST] Create `telemetry/obj.catalog.json`
      (declarative event contract pinned to the new shared schemas:
      objective-run recorded, utility published, integrity incident raised,
      claim scope validated, promotion decided, output screened).
      Parity tests by T026. Traces: FR-OBJ-001, FR-OBJ-002, FR-OBJ-003,
      FR-OBJ-004, FR-OBJ-005, FR-OBJ-006, FR-OBJ-007, FR-OBJ-008, FR-OBJ-009,
      FR-OBJ-010.
- [ ] T026 [serial-reason: SHARED_FILE] [executor: TEST] Extend the central
      parity suite `tests/telemetry-catalog.spec.ts` with the obj catalog
      (plan-sanctioned scope exception 4; exact path only). Traces:
      FR-OBJ-001, FR-OBJ-002, FR-OBJ-003, FR-OBJ-004, FR-OBJ-005, FR-OBJ-006,
      FR-OBJ-007, FR-OBJ-008, FR-OBJ-009, FR-OBJ-010.
- [ ] T027 [serial-reason: SHARED_FILE] [executor: TEST] Extend the central
      expected-script registry `packages/persistence/test/migrator.spec.ts`
      with the three `g1_obj_*` scripts (plan-sanctioned scope exception 3;
      exact path only). Traces: FR-OBJ-001.
- [ ] T028 [serial-reason: COORDINATOR_BOUNDARY] [executor: TEST] Run the
      milestone `verificationCommands` for both packages, the four authored
      AC suites with their negatives, and the five extended shared suites;
      report green results as implementation handoff evidence. Traces:
      FR-OBJ-001, FR-OBJ-002, FR-OBJ-003, FR-OBJ-004, FR-OBJ-005, FR-OBJ-006,
      FR-OBJ-007, FR-OBJ-008, FR-OBJ-009, FR-OBJ-010.
