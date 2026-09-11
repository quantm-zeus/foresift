# Implementation Plan: g1-objective-governance

**Package**: `g1-objective-governance` | **Date**: 2026-09-11 | **Spec**: `specs/g1-objective-governance/spec.md` (scoped derivative of PRD §38.37 in full, §38.32 as consumed boundary, §39.21 AC-220…223, §39.23 AC-245…249 as shared facets, §§9.5/40/46 activation gates, §§33–35/37 control planes, INV-001…010, inline milestone plan-level decisions 1/2/4/6 + manifest FR-OBJ-001…010)
**Authority**: PRD wins over every word below; material decisions are recorded as proposed ADR texts in this file.

## Summary

Govern the primary production objective and every performance claim as TWO
new packages over the proven G1 substrate, with no model anywhere in the
deterministic path and no trading, custody, wallet-signing, private-key, or
transaction-submission capability anywhere in the design:

1. **Objective governance (`packages/objective-governance`, FR-OBJ-001…010)**
   — the conservative lower confidence bound of net shadow-portfolio utility
   per capital-day as the single governing objective, computed with a pinned
   one-sided-95% z constant over integer micro-unit arithmetic (no binary
   floating point in the objective path); pairwise comparability over all
   eight dimensions with incomparable runs labeled exploratory and barred
   from promotion; the seven hard constraints evaluated totally before any
   utility optimization with no weighted-score compensation; twelve-line
   decomposition reports that reconcile exactly to net; the four diagnostic
   metrics computed but excluded from the promotion verdict by construction
   (the verdict input type carries no diagnostic fields); seven deterministic
   objective-integrity detectors whose failure blocks promotion; eleven-field
   claim-scope completeness on every performance view; the three-scenario
   action-delay distribution with a declared robust-delay gate; frozen-record
   sensitivity analysis across seven dimensions; and the G1-scoped
   prohibited-claim screen with mandatory uncertainty disclosure on
   opportunity outputs.
2. **Shadow-portfolio utility ledger (`packages/shadow-portfolio`,
   FR-OBJ-001/004 substrate)** — G1-scoped aggregation only: versioned
   execution fills (consumed from the proven simulator) fold
   deterministically into per-capital-day net utility with the twelve
   decomposition lines. Allocation policies, top-K / all-confirmed /
   pattern-only / baseline / control comparison, and metric breadth beyond
   the objective lines are an explicit non-goal owned by the later milestone
   that owns the shadow-portfolio engine requirements.

Plus additive extensions: `packages/domain/src/obj.ts` vocabularies/laws,
`packages/shared-schemas/src/obj.ts` Zod schemas, migration family `obj`
(`migrations/g1_obj_*.sql`), fixtures `tests/fixtures/obj/`, telemetry
`telemetry/obj.catalog.json`, four authored AC suites (AC-220…223, eight
files), and additive obj-facet extends of the shared AC-245…249 suites
(existing content untouched).

Strictly read-only (INV-001): structural proof via `read-only-guard.ts`
scanner modules in both new packages, mirroring the outcome-maturity /
evaluation precedent.

## Technical Context

- **Language/runtime**: TypeScript (ESM, strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) in the existing pnpm workspace; Bun Test is
  the repository test authority. New packages `packages/objective-governance`
  (`@foresift/objective-governance`) and `packages/shadow-portfolio`
  (`@foresift/shadow-portfolio`) follow the G0/G1 scaffold pattern:
  workspace `*` dependencies, `bun test` script, tsconfig extending
  `tsconfig.base.json`, no per-package runner config.
- **Storage**: PostgreSQL schema via `@foresift/persistence` (`DatabaseEngine`
  seam); tests run on PGlite per ADR-0014. Migrations are the SQL source of
  truth. ONE new migration family `obj` (`g1_obj_*.sql`), additive only; the
  fail-closed family list in `packages/persistence/src/migrator.ts`
  (`MIGRATION_FAMILIES` regex) is extended with `obj` and the central
  expected-script registry (`packages/persistence/test/migrator.spec.ts`) is
  extended in the same package — the plan-sanctioned scope exception
  (milestone plan-level decision 1; ADR-0019/0022 duty; the exact
  g1-execution-simulation / g1-outcome-evaluation precedent). Tables live in
  the `public` schema, so the hand-maintained ADR-001 Drizzle mirror
  (`packages/persistence/src/generated/schema.ts`) catches up to SQL truth in
  the same package — the schema-parity gate fails on any gap (same precedent
  as #175 / #208 / #245).
- **Validation**: Zod schemas authoritative in `packages/shared-schemas`
  (ADR-0013). New closed vocabularies live in `packages/domain/src/obj.ts`
  (zero runtime deps) and are imported, not restated, by
  `packages/shared-schemas/src/obj.ts` (compile-parity law precedent).
  Uncertainty methods and cluster definitions reuse the eval-proven
  vocabularies by import; horizon/maturity states reuse the mat/exec-proven
  vocabularies by import.
- **Arithmetic determinism**: all utility arithmetic in integer micro-units
  of capital (1 unit = 1e-6 of configured capital) with ceiling division at
  the single LCB step. Decimal-string parsing/formatting follows the shared
  `signedDecimal` convention at the schema boundary only. No binary floating
  point in either package's source (enforced by the read-only-guard
  identifier scan extended with float-literal detection in the objective
  path — see module list).
- **Telemetry**: one new declarative catalog `telemetry/obj.catalog.json`
  pinned to the new shared schemas; the central parity suite
  `tests/telemetry-catalog.spec.ts` is extended in place (milestone
  plan-level decision 4; test-owned task; exact path only).
- **`docs/generated/obj-surfaces.json`** already exists from the G0 central
  generation; this package does not touch `docs/generated/**` (milestone
  plan-level decision 2; reconciliation stays with
  `packages/release-conformance/**`).

## Constitution check

- **I (contract authority)**: every task traces to FR-OBJ-001…010 or their
  AC-220…223 / AC-245…249 evidence refs; no requirement invented.
- **III (simplicity)**: two packages, no services, no brokers, no new
  frameworks; the promotion gate is a pure composed function.
- **IV (read-only)**: INV-001 structural scanners in both packages; the G1
  prohibited-language work never touches the G0-owned enforcement scanner.
- **V/VI (point-in-time, event-time)**: consumed from proven availability and
  execution laws; the comparability data-cutoff dimension and frozen-record
  sensitivity enforce them at the objective layer.
- **VII (provenance)**: frozen run records carry config hash, code/adapter/
  artifact versions, and evidence refs; sensitivity derivatives reference the
  parent hash.
- **VIII (fail-closed)**: unevaluated constraint blocks; missing dimension
  refuses comparison; incomplete claim scope refuses the view; single-delay
  evidence is refused; integrity failure blocks promotion.
- **X/XI/XII**: traceability matrix in tasks.md; deterministic gates;
  positive AND negative suites for all four authored ACs plus negative facets
  on the five shared suites.
- **XIII/XIV**: idempotent ledger inserts; promotion decisions append-only;
  all planning state on disk/git.
- **XVI/XVII/XVIII**: no new agent capabilities; additive git history; no
  AI-claim completion — the deterministic validator plus `pnpm verify` and
  `pnpm spec:verify` decide.

## Architecture

### Module layout

`packages/objective-governance/src/` (all pure except the guard):

- `objective-function.ts` — LCB of mean daily net utility per capital-day
  from the frozen utility series + consumed cluster ESS; pinned
  `Z_ONE_SIDED_95_MICROS = 1644854` (scale 1e6) with ceiling division; the
  single float-free arithmetic core (FR-OBJ-001).
- `comparability.ts` — pairwise equality over the eight
  `ComparisonDimension` values incl. data-cutoff timestamp and
  correlated-exposure constraint-set equality; verdict `COMPARABLE` or
  `EXPLORATORY_ONLY`; missing dimension record returns a refusal error, never
  a verdict (FR-OBJ-002).
- `hard-constraints.ts` — total evaluation over all seven
  `HardConstraintKind` values; any `FAIL` (or unevaluated kind) refuses
  activation/promotion before utility is consulted; weighted scores are not
  inputs to this module (FR-OBJ-003).
- `decomposition.ts` — twelve-line report builder with the reconciliation
  law (lines sum exactly to reported net in micro-units) plus uncertainty,
  ESS, and method fields (FR-OBJ-004).
- `diagnostics.ts` — the four diagnostic metrics with
  diagnostic-only labeling; the promotion verdict input type excludes these
  fields structurally (FR-OBJ-005).
- `integrity.ts` — seven deterministic detectors (one per
  `IntegritySignalKind`) over frozen-run evidence consumed from the maturity
  ledger, experiment registry, and holdout states; any firing signal yields
  `FAIL_BLOCKS_PROMOTION` (FR-OBJ-006).
- `claim-scope.ts` — eleven-field completeness validation; incomplete scope
  refuses the performance view (FR-OBJ-007).
- `delay-gate.ts` — three-scenario distribution config plus the declared
  robust-delay gate; verdict requires evidence for all three scenarios and a
  pass on the declared set (FR-OBJ-008).
- `sensitivity.ts` — seven-dimension sensitivity grids recomputed from the
  frozen record; derived records carry the parent content hash; frozen-record
  mutation is refused (FR-OBJ-009).
- `prohibited-language.ts` — G1-scoped deterministic screen over the four
  `ProhibitedClaimKind` patterns plus mandatory uncertainty-disclosure
  attachment on opportunity outputs (FR-OBJ-010 within decision-6 boundary).
- `promotion-gate.ts` — deterministic composition in fixed order: hard
  constraints → comparability → consumed maturity/ESS minimums → consumed
  negative-control outcomes → integrity → LCB comparison → robust-delay gate
  → claim-scope validation → `PromotionVerdict`. No diagnostic inputs in the
  signature.
- `read-only-guard.ts` — prohibited-import/identifier scanner mirroring the
  outcome-maturity precedent, extended with binary-float detection for the
  objective path.
- `index.ts` — barrel export only.

`packages/shadow-portfolio/src/` (G1-scoped aggregation substrate):

- `utility-ledger.ts` — versioned fills fold into per-capital-day net
  utility with the twelve decomposition lines; idempotent natural-key
  upserts; no allocation policy, no portfolio comparison, no engine
  semantics (FR-OBJ-001/004 substrate).
- `capital-day.ts` — capital-day coordinates (fixed capital × calendar day)
  and denominator arithmetic.
- `read-only-guard.ts` — same scanner precedent.
- `index.ts` — barrel export only.

### Data model (`migrations/g1_obj_*.sql`, `public` schema)

- `g1_obj_0001_objective_runs.sql` — `objective_runs`: run id, frozen config
  content hash, the eight comparability dimension values (universe id/hash,
  population-claim id, capital micro-units, window bounds, execution
  scenario id/version, delay-policy id/version, data-cutoff timestamp,
  correlated-exposure constraint set), comparability verdict with CHECK, and
  exploratory labeling; immutable after insert (no UPDATE path; corrections
  are new runs).
- `g1_obj_0002_utility_ledger.sql` — `capital_day_utility`: one row per
  (run, capital-day) with the twelve decomposition-line columns as integer
  micro-units, daily net, running mean inputs, consumed ESS reference, and
  computed LCB; CHECK constraints pin every enum literal in the vocabulary
  law below; reconciliation CHECK (lines sum to net).
- `g1_obj_0003_integrity_claims.sql` — `integrity_incidents` (seven signal
  kinds, verdict, evidence refs, append-only), `claim_scope_records`
  (eleven fields, completeness enforced NOT NULL), `promotion_decisions`
  (verdict plus ordered gate-trail refs), `output_language_screens`
  (prohibited-claim screen outcome + disclosure attachment per screened
  output).

### Vocabulary law (binding)

The SQL CHECK literal lists and the domain const objects transcribe these
verbatim; no writer or test author may invent, rename, or omit members.
Uncertainty methods reuse eval-proven `IntervalMethod` by import; cluster
definitions reuse eval-proven `ClusterDefinition` by import.

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

## Verification strategy per acceptance criterion

- **AC-220** (utility governs, not win rate): positive suite builds two
  policies over identical frozen assumptions where the higher per-alert
  success policy has the lower LCB net utility and asserts the gate promotes
  the higher-utility policy and not the other. Negative suite asserts a
  verdict function offered only diagnostic inputs refuses, and that a
  higher-win-rate/lower-utility promotion attempt is blocked. Traces
  FR-OBJ-001, FR-OBJ-005.
- **AC-221** (post-hoc change invalidates): positive suite mutates each of
  denominator, execution scenario, horizon, and delay policy after outcomes
  are visible and asserts the comparison is invalidated with an integrity
  incident. Negative suite asserts silent mutation (no incident) is
  impossible through the frozen-record API and that backdated edits are
  refused. Traces FR-OBJ-002, FR-OBJ-006, FR-OBJ-009.
- **AC-222** (claim scope): positive suite renders a performance view
  carrying all eleven fields and asserts acceptance. Negative suite drops
  each field in turn and asserts refusal. Traces FR-OBJ-007.
- **AC-223** (hard constraints precede scores): positive suite fails each of
  the seven constraint kinds while weighted features are strongly positive
  and asserts activation refusal in all seven cases. Negative suite asserts
  partial evaluation (six of seven) still refuses and that no score input
  reaches the constraint module. Traces FR-OBJ-003, FR-OBJ-010
  (public-claim kind).
- **AC-245…247** (dependence facets): additive obj-facet extends asserting
  lineage-collapse sensitivity is present in the sensitivity grid, duplicated
  evidence cannot support independent confirmation in claim scope, and
  retrospective dependence estimates never alter frozen utility counts.
  Existing suite content untouched. Trace FR-OBJ-009, FR-OBJ-006,
  FR-OBJ-007.
- **AC-248** (promotion minimums): additive obj-facet extends asserting
  promotion fails below registered mature counts, cluster ESS, coverage, or
  interval precision even with a favorable point estimate, via the consumed
  mat/eval minimums. Existing content untouched. Traces FR-OBJ-001,
  FR-OBJ-006.
- **AC-249** (negative controls): additive obj-facet extends asserting the
  promotion gate honors consumed control failures (any control failure blocks
  promotion). Existing content untouched. Traces FR-OBJ-006.
- **Unit/colocated**: every domain law, schema, gate module, ledger fold,
  and guard scanner carries colocated unit tests authored by test-owned
  tasks; PGlite-backed migration tests cover the three SQL files plus the
  registry duty.
- **Gates**: milestone `verificationCommands` for both packages, the four
  authored AC suites plus five extended shared suites, `pnpm verify`, and
  `pnpm spec:verify` at the pushed head.

## Risks

- **Shared-suite collision**: AC-245…249 files are extended by several
  packages across the milestone. Mitigation: strictly additive facet
  describes, existing content untouched, obj-facet naming (`OBJ …` describe
  blocks) that cannot collide with other families' blocks.
- **ESS/interval double-ownership**: the objective layer must consume, never
  recompute, clustered uncertainty. Mitigation: types imported from proven
  packages; a dedicated negative test refuses promotion when the ESS
  reference is absent or stale.
- **G7 engine creep**: implementers may read `packages/shadow-portfolio` as
  license to build allocation/comparison engines. Mitigation: the non-goal
  is stated in spec, plan, and the ledger module header; tasks carry no
  engine work; review checks for engine semantics.
- **FR-OBJ-010 over-claim**: full cross-surface enforcement does not exist
  in G1. Mitigation: the decision-6 boundary is stated in spec/plan/tasks;
  tests cover G1-owned surfaces only; no task touches product surfaces or
  the G0-owned scanner.
- **Float leakage**: transitive numeric helpers could introduce binary
  floats. Mitigation: guard-scanner float detection on the objective path
  plus a determinism test asserting identical LCB bytes across repeated runs.

## Proposed ADR texts (material decisions for future packages)

- **ADR-OBJ-01 — Integer micro-unit objective arithmetic**: all G1 objective
  utility arithmetic uses integer micro-units of capital with a single
  pinned z constant and ceiling division at the LCB step; binary floating
  point is prohibited in the objective path. Rationale: bit-determinism
  across runtimes for the governing production objective.
- **ADR-OBJ-02 — G1 utility-ledger vs later engine boundary**: the G1
  `packages/shadow-portfolio` module is aggregation substrate only; the
  later milestone owning the shadow-portfolio engine requirements extends
  (never rewrites) the ledger tables for allocation and comparison engines.
- **ADR-OBJ-03 — Promotion-gate order**: the nine-stage gate order fixed in
  `promotion-gate.ts` is normative for G1; later milestones adding stages
  (e.g. product-surface claim enforcement) append stages with their own ADRs
  and never reorder existing ones silently.

## Plan-sanctioned scope exceptions (exact paths only)

1. `packages/persistence/src/migrator.ts` — family-list extension with `obj`
   (product-owned task; ADR-0019/0022 duty; milestone decision 1).
2. `packages/persistence/src/generated/schema.ts` — ADR-001 Drizzle mirror
   catch-up (product-owned task; #175/#208/#245 precedent).
3. `packages/persistence/test/migrator.spec.ts` — central expected-script
   registry (test-owned task; milestone decision 1).
4. `tests/telemetry-catalog.spec.ts` — central parity extension for the obj
   catalog (test-owned task; milestone decision 4).

No other out-of-scope write exists. `docs/generated/**` is untouched
(decision 2). `scripts/scan-prohibited-capabilities/**` is untouched
(G0-owned; decision-6 boundary).
