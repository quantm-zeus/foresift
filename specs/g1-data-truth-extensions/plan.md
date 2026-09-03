# Implementation Plan: g1-data-truth-extensions

**Package**: `g1-data-truth-extensions` | **Date**: 2026-09-03 | **Spec**: `specs/g1-data-truth-extensions/spec.md` (scoped derivative of PRD §38.40, §38.17, §13.6–13.10, §15.10, §65.6, §66, Appendix O.8/O.9, Appendix P + manifest FR-DATA-007…016, FR-TRD-001…004, FR-SUP-001…002)
**Authority**: PRD wins over every word below; material decisions are recorded as proposed ADR texts in this file.

## Summary

Extend the proven G0 data-truth foundation with decision-time semantics and
market-event truth along four seams, without rewriting any proven behavior:

1. **Decision-time truth (FR-DATA-007…012)** — backfill provenance fields on
   observations plus the replay-mode vocabulary; a decision-timeline repo
   (`g1_data_*` table + persistence repo) carrying the §13.7 field set with
   delivery timestamps; field-level availability through the existing
   revision resolver with two explicitly named query semantics
   (current-view vs historical-replay); the reconciled ten-state acquisition
   vocabulary and an extended acquisition record (requested fields, EVI,
   estimated/actual cost, candidate state, failure kind).
2. **Source-dependence and conflict truth (FR-DATA-013…016)** — dependence
   edges gain validity interval, method, evidence, confidence, and the
   effective-independence multiplier; an empirical-evaluation input record
   (correlated values/errors, update/first-seen timing, outages,
   schema/rounding fingerprints, common missingness, upstream relationships)
   computed strictly over data available at estimation time; provider
   conflict preservation with the four-way classification
   (BENIGN_VARIANCE / COMMON_UPSTREAM_DUPLICATION / MATERIAL_DISAGREEMENT /
   UNRESOLVED_DECISION_CRITICAL).
3. **Economic trade normalization (FR-TRD-001…004)** — a new
   `packages/economic-trade-normalizer` package normalizing raw swaps,
   transfer routes, and aggregator hops into economic trade events built on
   net actor deltas (§66.2 interface), with side classification
   (BUY/SELL/ROUND_TRIP/INVENTORY_NEUTRAL/UNKNOWN), no route/hop double
   counting, and the actor-uncertainty quality-reduction function that
   features will consume (INV-013).
4. **Supply confidence (FR-SUP-001…002)** — a new `packages/supply-confidence`
   package exposing the §65.6 `SupplyAssessment` (source, method, excluded
   supply, confidence) and the fallback predicate that forbids low-confidence
   market cap from being the sole hard-rejection reason when approved
   liquidity/activity fallbacks exist (AC-135).

New migrations `g1_data_*`, `g1_trd_*`, `g1_sup_*` (additive; family pattern
extended); new fixtures under `tests/fixtures/trd/` and `tests/fixtures/sup/`
(plus a G1 backfill fixture under `tests/fixtures/data/`); AC-133…136 and
AC-233 acceptance/negative files authored here; shared AC-020…023 and
AC-240…249 suites extended in place; telemetry catalogs `trd`/`sup` added and
`data` extended, with the central parity suite extended in the same package.

## Technical Context

- **Language/runtime**: TypeScript (ESM, strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) in the existing pnpm workspace; Bun Test is
  the repository test authority (100% cutover, `evidence/bun-migration/`).
- **Storage**: PostgreSQL schema via `@foresift/persistence`
  (`DatabaseEngine` seam); tests run on PGlite per ADR-0014. Migrations are
  the SQL source of truth with the Drizzle mirror parity-tested
  (`packages/persistence/test/schema-parity.spec.ts`); G1 adds tables and
  columns only — never alters tables owned by other packages' families.
- **Validation**: Zod schemas authoritative in `packages/shared-schemas`
  (ADR-0013). Closed vocabularies (replay modes, conflict classes, trade
  sides, supply methods, dependence methods, acquisition failure kinds) are
  declared in `packages/domain` and imported — never restated — by
  `packages/shared-schemas` (milestone plan-level decision 5, ADR-0018
  precedent). Unknown values fail closed with stable `ErrorCode`s.
- **Replay law**: THE single domain predicate `visibleAt` (available_at ≤ T)
  stays the only visibility definition (FR-DATA-010's historical-replay
  semantics ride it); the current view stays the separately named
  current-state read (proven G0 pattern in `packages/persistence/src/repos/replay.ts`).
- **Test stack**: Bun Test; new suites colocated per package
  (`packages/*/test/*.spec.ts`, `bun test` script) plus root
  `tests/acceptance`/`tests/negative` files; the coordinator manifest
  (`evidence/bun-migration/bun-migration-manifest.json`) is regenerated after
  new test files exist so `test:all` workloads classify them (PGlite suites →
  DATABASE_PGLITE).
- **Telemetry**: declarative catalogs only (`telemetry/data.*` extended,
  `telemetry/trd.*`/`telemetry/sup.*` new) — emitter wiring is G2 (dependency
  group G2), never in this package's verification.

## Constitution Check

- **I. Product-Contract Authority**: scope limited to the sixteen assigned
  requirements; `docs/spec/**` untouched; spec.md marked subordinate; seeded
  normative content preserved verbatim.
- **II. Greenfield**: the two new packages are designed from PRD §66 and
  §65.6 directly; the predecessor repository is not consulted.
- **III. Modular-monolith-first**: exactly two focused new packages plus
  extensions of proven ones — no brokers, no service splits; the normalizer
  is a pure library over persisted observations, the supply package a pure
  library over persisted supply observations.
- **IV. Read-only boundary (NON-NEGOTIABLE)**: the normalizer CONSUMES swap
  events; it never constructs, signs, or submits anything. No code path in
  this package names a transaction-building/signing/custody capability.
  `scripts/scan-prohibited-capabilities/cli.mjs` stays green.
- **V. Point-in-time correctness**: FR-DATA-010 current/replay split,
  FR-DATA-015 point-in-time independence, and replay-mode labeling
  (FR-DATA-008) all resolve through `visibleAt` and availability-provenance
  classes.
- **VI. Event-time / earliest-availability**: backfilled observations keep
  original event coordinates; `available_at` is the actual earliest system
  availability, never derived from event time (§13.6 rules 1–5); the normalizer
  emits `eventAt`/`availableAt` per event.
- **VII. Provenance & evidence**: every G1 record carries source, method,
  confidence, evidence IDs, and timestamps; conflict records preserve all raw
  observations (FR-DATA-016).
- **VIII. Fail-closed**: unknown states/classes/methods refuse with typed
  errors; unresolved decision-critical conflict blocks rather than guessing;
  missing actor identity degrades quality codes instead of assuming.
- **IX. Provider abstraction**: dependence and conflict logic operate on
  registered `SourceIdentity` rows; no vendor SDK enters any G1 module.
- **X. Traceability**: tasks.md cites only FR-DATA-007…016, FR-TRD-001…004,
  FR-SUP-001…002 and their ACs; the validator rejects out-of-scope IDs.
- **XI/XII. Deterministic + dual-path verification**: every assigned AC has
  positive AND negative specs at manifest-declared paths; `pnpm verify` +
  `pnpm spec:verify` at the pushed HEAD.
- **XIII. Replay/Recovery/Idempotency**: migration runner idempotence and
  fencing carry over; economic normalization is deterministic (same inputs →
  same events, content-hashed); conflict/acquisition records are append-only.
- **XIV. Durable operations**: planning artifacts persisted to the run
  directory; migration state in `_foresift_schema_migrations`.
- **XV. Security & least privilege**: no secrets; seed provenance stays
  provenance (never raw seed material, keeping the G0
  `probe_assignments_seed_not_raw_material` shape).
- **XVI–XVIII. Agent governance**: completion decided by
  `package-plan-complete.mjs`, package gates, and CI; commits additive.

## Data model (SQL truth under `migrations/`)

### `g1_data_0001_decision_semantics.sql` (family `data`)

```text
ALTER TABLE observations ADD COLUMN retrieved_as_backfill boolean NOT NULL DEFAULT false;
ALTER TABLE observations ADD COLUMN unavailability_reason text;      -- why not earlier (§13.6)
  + CHECK: unavailability_reason IS NULL OR retrieved_as_backfill
  + CHECK: retrieved_as_backfill => availability_provenance IN
           ('HISTORICAL_QUERY_FETCHED_LATER','MANUAL_IMPORT_AVAILABLE')
           (event time never substitutes for availability time)

CREATE TABLE candidate_decision_timelines (     -- FR-DATA-009, §13.7 + delivery fields
    candidate_id         text NOT NULL,
    policy_version       text NOT NULL,
    decision_ready_at    timestamptz NOT NULL,
    policy_decided_at    timestamptz NOT NULL,
    workflow_completed_at timestamptz NOT NULL,
    delivery_eligible_at timestamptz NOT NULL,     -- max(decision_ready_at, policy_decided_at), App. P
    delivered_at         timestamptz,              -- when applicable; NULL = non-delivered arm
    counterfactual_delivery_version text NOT NULL,  -- versioned delivery policy id
    counterfactual_delivery_at timestamptz NOT NULL, -- required for non-delivered arms (AC-240)
    valid_until          timestamptz NOT NULL,
    expired_at           timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (candidate_id, policy_version, decision_ready_at),
    CONSTRAINT cdt_monotonic CHECK (decision_ready_at <= policy_decided_at
        AND policy_decided_at <= delivery_eligible_at
        AND delivery_eligible_at <= counterfactual_delivery_at),
    CONSTRAINT cdt_delivery_symmetry CHECK (delivered_at IS NULL
        OR (delivered_at >= delivery_eligible_at))
);
-- append-only trigger (G0 pattern)

ALTER TABLE evidence_acquisition_decisions      -- FR-DATA-011/012 extension
    ADD COLUMN candidate_state_at_request text,
    ADD COLUMN requested_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
    ADD COLUMN expected_value_of_information double precision
        CHECK (… BETWEEN 0 AND 1),
    ADD COLUMN estimated_cost numeric,
    ADD COLUMN actual_cost numeric,
    ADD COLUMN failure_kind text CHECK (failure_kind IN ('TIMED_OUT','INVALID_RESPONSE')),
    ADD COLUMN acquisition_seed text,           -- provenance, never raw material
  + state CHECK rebuilt to the reconciled ten-state vocabulary (ADR-1):
    NOT_REQUESTED_BY_POLICY, REQUESTED, COST_BLOCKED, QUOTA_BLOCKED,
    RIGHTS_BLOCKED, UNSUPPORTED, PROVIDER_UNAVAILABLE, FAILED, RETURNED_EMPTY,
    RETURNED
```

Note on the state CHECK rebuild: the G0 CHECK constraint is dropped and
re-created in the same migration (additive migration file, idempotent apply;
no stored row uses the three renamed members because G0 rows predate them —
asserted by a pre-migration guard `SELECT` that aborts the migration if any
row holds `CAPABILITY_UNAVAILABLE`/`TIMED_OUT`/`INVALID_RESPONSE`).

### `g1_data_0002_dependence_conflicts.sql`

```text
ALTER TABLE source_dependence_edges             -- FR-DATA-013 extension
    ADD COLUMN valid_from timestamptz NOT NULL,
    ADD COLUMN valid_until timestamptz,
    ADD COLUMN method text NOT NULL,            -- DependenceMethod vocabulary
    ADD COLUMN evidence_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
    ADD COLUMN confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    ADD COLUMN effective_independence_multiplier double precision NOT NULL
        CHECK (effective_independence_multiplier BETWEEN 0 AND 1);

CREATE TABLE empirical_dependence_observations (  -- FR-DATA-014 inputs (App. O.8)
    observation_id   text PRIMARY KEY,
    source_a         text NOT NULL REFERENCES source_identities(source_id),
    source_b         text NOT NULL REFERENCES source_identities(source_id),
    correlated_values double precision NOT NULL CHECK (… BETWEEN -1 AND 1),
    correlated_errors double precision NOT NULL CHECK (… BETWEEN -1 AND 1),
    update_timing_sync double precision NOT NULL CHECK (… BETWEEN 0 AND 1),
    first_seen_sync   double precision NOT NULL CHECK (… BETWEEN 0 AND 1),
    outage_overlap    double precision NOT NULL CHECK (… BETWEEN 0 AND 1),
    schema_fingerprint_similarity double precision NOT NULL CHECK (… BETWEEN 0 AND 1),
    common_missingness double precision NOT NULL CHECK (… BETWEEN 0 AND 1),
    declared_upstream_relationship text NOT NULL,   -- shared lineage keys, JSON
    estimated_at    timestamptz NOT NULL,           -- estimation-time wall (App. O.8 scope rule)
    estimated_from  timestamptz NOT NULL,           -- data-window start
    estimated_to    timestamptz NOT NULL
);

CREATE TABLE provider_conflicts (                 -- FR-DATA-016, §15.10
    conflict_id       text PRIMARY KEY,
    subject_observation_ids text[] NOT NULL,        -- ALL raw observations preserved
    conflict_class    text NOT NULL CHECK (conflict_class IN (
        'BENIGN_LATENCY_ROUNDING_VARIANCE',
        'COMMON_UPSTREAM_DUPLICATION',
        'MATERIAL_DISAGREEMENT',
        'UNRESOLVED_DECISION_CRITICAL')),
    field_path        text NOT NULL,
    resolved_by_rule  text,                         -- versioned deterministic rule or NULL
    quality_code      text NOT NULL DEFAULT 'CONFLICTING',
    available_at      timestamptz NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now()
);
-- append-only triggers (G0 pattern)
```

### `g1_trd_0001_economic_trade_events.sql`

```text
CREATE TABLE economic_trade_events (              -- §66.2 exact interface
    event_id               text PRIMARY KEY,
    chain_id               text NOT NULL,
    transaction_hash       text NOT NULL,
    actor_entity_id        text,
    asset_representation_id text NOT NULL REFERENCES assets(asset_representation_id?),
    net_asset_delta_raw    text NOT NULL CHECK (net_asset_delta_raw ~ '^-?[0-9]+$'),
    net_quote_delta_usd    text,
    side                   text NOT NULL CHECK (side IN
        ('BUY','SELL','ROUND_TRIP','INVENTORY_NEUTRAL','UNKNOWN')),
    route_leg_ids          text[] NOT NULL DEFAULT ARRAY[]::text[],
    classification_confidence double precision NOT NULL CHECK (… BETWEEN 0 AND 1),
    event_at               timestamptz NOT NULL,
    available_at           timestamptz NOT NULL,
    quality_codes          text[] NOT NULL DEFAULT ARRAY[]::text[],
    actor_resolution_state text NOT NULL CHECK (actor_resolution_state IN
        ('RESOLVED','PARTIAL','UNRESOLVED')),       -- FR-TRD-004 input
    UNIQUE (chain_id, transaction_hash, event_id)
);
CREATE TABLE economic_route_legs (                -- raw legs preserved for audit (§66.3)
    leg_id          text PRIMARY KEY,
    event_id        text REFERENCES economic_trade_events(event_id),
    pool_id         text,
    raw_amount      text NOT NULL,
    leg_index       integer NOT NULL
);
```

### `g1_sup_0001_supply_assessments.sql`

```text
CREATE TABLE supply_assessments (                 -- §65.6 exact interface
    assessment_id           text PRIMARY KEY,
    asset_representation_id text NOT NULL,
    as_of                   timestamptz NOT NULL,
    total_supply_raw        text NOT NULL CHECK (total_supply_raw ~ '^[0-9]+$'),
    estimated_circulating_supply_raw text,
    excluded_supply_raw     text,
    method                  text NOT NULL,          -- SupplyMethod vocabulary
    confidence              double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    exclusion_evidence_ids  text[] NOT NULL DEFAULT ARRAY[]::text[],
    quality_codes           text[] NOT NULL DEFAULT ARRAY[]::text[],
    market_cap_basis        text NOT NULL CHECK (market_cap_basis IN
        ('TOTAL','PROVIDER_CIRCULATING','ESTIMATED_CIRCULATING')),  -- §65.6 rule
    available_at            timestamptz NOT NULL
);
CREATE TABLE market_cap_fallback_decisions (      -- FR-SUP-002 evidence trail
    decision_id      text PRIMARY KEY,
    candidate_id     text NOT NULL,
    supply_confidence double precision NOT NULL,
    fallback_approved boolean NOT NULL,
    hard_rejected_on_market_cap_alone boolean NOT NULL
        CHECK (hard_rejected_on_market_cap_alone = false OR fallback_approved = false),
    decided_at       timestamptz NOT NULL
);
```

## Module layout (inside writeScopes)

```text
packages/domain/src/
  replay-modes.ts        # NEW — ReplayMode vocabulary: REALIZABLE_REPLAY, ORACLE,
                         #   HINDSIGHT, COUNTERFACTUAL_DATA_AVAILABILITY_RESEARCH
                         #   (§13.6 rule 2 label; FR-DATA-008), fail-closed parse
  acquisition.ts         # EXTEND — reconciled ten-state vocabulary (ADR-1):
                         #   UNSUPPORTED/FAILED/RETURNED_EMPTY replace
                         #   CAPABILITY_UNAVAILABLE/TIMED_OUT/INVALID_RESPONSE;
                         #   AcquisitionFailureKind; RETRIEVAL_FAILED/terminal
                         #   helpers updated in place; ErrorCode additions
  dependence.ts          # NEW — DependenceMethod (DECLARED, EMPIRICAL),
                         #   EffectiveIndependencePolicy (threshold table +
                         #   automatic credit reduction, App. O.8 monotonic
                         #   function, point-in-time scope rule FR-DATA-015)
  conflicts.ts           # NEW — ProviderConflictClass vocabulary +
                         #   classifyConflict(values, lateness, rounding,
                         #   shared lineage, decisionCriticality) deterministic
                         #   classifier
  trades.ts              # NEW — TradeSide, ActorResolutionState,
                         #   actorUncertaintyFactor(state, confidence) — the
                         #   FR-TRD-004 reduction function (pure, deterministic)
  supply.ts              # NEW — SupplyMethod vocabulary,
                         #   marketCapMayHardReject(assessment, fallbackApproved)
                         #   predicate (FR-SUP-002)
  timeline.ts            # NEW — delivery-timeline monotonicity predicates
                         #   (deliveryEligibleAt = max(decision_ready, policy_decided))
  index.ts               # extend exports

packages/shared-schemas/src/
  data.ts                # EXTEND — BackfillObservation fields into
                         #   ObservationRecordSchema context (or sibling
                         #   BackfilledObservationSchema), CandidateDecisionTimeline
                         #   schema, extended EvidenceAcquisitionDecisionSchema
                         #   (reconciled states + FR-DATA-012 fields),
                         #   EmpiricalDependenceObservation, ProviderConflict,
                         #   ReplayMode-labeled ReplayQuerySemantics schema;
                         #   registry version bump 1→2 (breaking shape changes)
  trd.ts                 # NEW — EconomicTradeEvent, EconomicRouteLeg schemas (§66.2)
  sup.ts                 # NEW — SupplyAssessment schema (§65.6)
  index.ts               # export trd.ts, sup.ts

packages/persistence/src/repos/
  timeline.ts            # NEW — candidate decision timeline CRUD with
                         #   monotonicity + counterfactual enforcement (AC-240)
  backfill.ts            # EXTEND — retrieved_as_backfill/unavailability_reason
                         #   writes; refuses event-time substitution
  acquisition.ts         # EXTEND — reconciled states, requested fields, EVI,
                         #   costs, failure kinds; write-before-retrieval
                         #   ordering preserved (AC-243 regression-locked)
  dependence.ts          # NEW — edge validity-interval writes, empirical
                         #   observation records, effective-credit resolution
                         #   point-in-time scoped (AC-245/247)
  conflicts.ts           # NEW — append-only conflict records + classification
  migrations family      # migrator.ts: MIGRATION_FILE_PATTERN extended with
                         #   `trd|sup` families (fail-closed discovery of the
                         #   new families)

packages/evidence/src/
  replay-modes.ts        # NEW — replay-mode resolution helper: a realizable
                         #   replay refuses retrospective-only entries; oracle/
                         #   hindsight/research modes are separate labeled
                         #   result shapes, never silently mixed (FR-DATA-008)

packages/economic-trade-normalizer/          # NEW package (@foresift/economic-trade-normalizer)
  src/
    index.ts
    legs.ts               # transaction leg grouping (swaps + transfers within
                          #   one economic transaction; §66.3 rule 1)
    actor-resolution.ts   # token-account owner + known router/program account
                          #   resolution; downgrade path (§66.3 rule 2, FR-TRD-004)
    net-delta.ts          # net actor delta computation (§66.3 rule 3 — never
                          #   route-volume summation; FR-TRD-002)
    classification.ts     # same-transaction round trips, arbitrage patterns,
                          #   inventory-neutral detection (§66.3 rule 4, FR-TRD-003)
    normalize.ts          # orchestrator: legs → events with deterministic
                          #   event identity + double-count guards
                          #   (migration-aware, §66.3 rule 5)
  test/                   # colocated suites (PGlite-backed where persistence needed)

packages/supply-confidence/                  # NEW package (@foresift/supply-confidence)
  src/
    index.ts
    assessment.ts          # SupplyAssessment persistence + §65.6 exposure
    fallback.ts            # market-cap hard-rejection gate: refuses when
                           # confidence low AND approved fallback exists
                           # (FR-SUP-002, AC-135)
  test/

tests/fixtures/
  data/g1-backfill-provenance.json     # FR-DATA-007 vectors (no event-time
                                       # substitution; backdating refusals)
  data/g1-replay-modes.json            # FR-DATA-008 mode-labeling vectors
  trd/route-hop-double-count.json      # AC-133: multi-pool routed swap → one
                                       # economic trade, no hop inflation
  trd/arbitrage-inventory-neutral.json # AC-134 + FR-TRD-003 vectors
  trd/actor-uncertainty.json           # FR-TRD-004 reduction vectors
  sup/supply-confidence.json           # FR-SUP-001 + AC-135 fallback vectors

tests/acceptance/  — AC-133, AC-134, AC-135, AC-136, AC-233 authored here
                     (scoped to FR-TRD/FR-SUP obligations per spec I4);
                     AC-020…023 + AC-240…249 extended with G1 cases
tests/negative/    — matching AC-133.negative … AC-233.negative authored here;
                     shared negatives extended in place
telemetry/
  data.catalog.json  — extended: backfill.provenance_recorded,
                       decision.timeline_recorded, dependence.edge_validity,
                       conflict.classified (+ requirementRefs FR-DATA-007…016)
  trd.catalog.json   — NEW: trade.normalized, trade.side_classified,
                       trade.actor_downgraded, trade.double_count_blocked
  sup.catalog.json   — NEW: supply.assessed, supply.fallback_decided
tests/telemetry-catalog.spec.ts — extended in place (plan-sanctioned exception,
                     milestone plan-level decision 4) pinning the new catalogs
                     to the authoritative schemas
packages/persistence/test/migrator.spec.ts — extended in place (plan-sanctioned
                     exception, milestone plan-level decision 1 / ADR-0019·0022
                     duty) with the new g1_* script registry entries
evidence/bun-migration/bun-migration-manifest.json — regenerated after new
                     suites exist (mechanical, per g0-first-party-observation
                     T063 precedent)
```

## Verification strategy per acceptance criterion

| AC             | Surface                        | Positive proof                                                                                                                                          | Negative proof                                                                                       |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| AC-020         | replay boundary                | existing suite + G1 case: backfilled row (retrieved_as_backfill) invisible before its actual available_at in realizable replay                          | negative: replay T < available_at returns nothing; no event-time substitution path                   |
| AC-021         | immutability                   | existing suite + G1 case: ALTER-added backfill columns set only at insert                                                                               | negative: UPDATE/DELETE on observation rows still refused                                            |
| AC-022         | migration double-count         | existing suite + G1 case: economic events across a migration boundary don't double-count (normalizer dedupe)                                            | negative: feeding migration-pair legs yields one event per economic transaction                      |
| AC-023         | decimals/normalization         | existing golden fixtures stay green; normalizer consumes identity-backed representations                                                                | negative: malformed raw amounts refused by schema                                                    |
| AC-130/131/132 | solsec family                  | AUTHORED by g1-solana-security — not this package (spec I4)                                                                                             | same                                                                                                 |
| AC-133         | route/hop dedup                | fixture `trd/route-hop-double-count.json`: 3-pool route → exactly 1 economic event, net actor delta = −in +out                                          | negative: leg-summing implementation would double-count — test asserts the emitted volume ≠ leg sums |
| AC-134         | arbitrage neutrality           | fixture `arbitrage-inventory-neutral.json`: arbitrage round trips classified INVENTORY_NEUTRAL, excluded from organic unique-buyer/demand inputs        | negative: organic-demand aggregation over misclassified sides is refused/mismatched                  |
| AC-135         | market-cap fallback            | fixture `supply-confidence.json`: low-confidence supply + approved liquidity fallback → no hard rejection, fallback decision row records it             | negative: hard-reject-on-market-cap-alone with fallback available is refused by the gate predicate   |
| AC-136         | bounded deterministic features | authored here scoped to FR-TRD-004: actor-uncertainty factor reduces feature quality codes/contribution monotonically; fixture `actor-uncertainty.json` | negative: unresolved actor state cannot yield full-quality contribution                              |
| AC-233         | cost composition               | scoped here to the economic-event side: net deltas include fee legs (transfer fees/rent/program fees as delta components)                               | negative: events omitting fee legs fail the parity fixture                                           |
| AC-240         | symmetric action time          | existing suite + G1 timeline case: non-delivered arm enters comparisons via counterfactual_delivery_at, never earlier entry                             | negative: timeline violating monotonicity refused by repo + SQL CHECK                                |
| AC-241         | frozen replay                  | existing suite + G1 case: realizable replay labels differ from oracle/hindsight/research modes (FR-DATA-008)                                            | negative: hidden current-data call in realizable mode fails                                          |
| AC-242         | NOT_REQUESTED semantics        | existing suite green under reconciled vocabulary (regression lock)                                                                                      | negative: lifecycle fields on NOT_REQUESTED still refused; unknown states fail closed                |
| AC-243         | probe write-before-retrieval   | existing suite + G1 case: requestedFields/seed persisted before completion                                                                              | negative: completion without prior probe assignment still refused                                    |
| AC-244         | population provenance          | substrate untouched; feature population fields unchanged                                                                                                | existing negatives stay green                                                                        |
| AC-245         | reduced independence credit    | G1: threshold-crossing empirical observation → edge multiplier < 1 automatically (App. O.8)                                                             | negative: distinct provider IDs with correlated inputs still reduced                                 |
| AC-246         | lineage collapse sensitivity   | G1: independence-group collapse queries honor validity intervals                                                                                        | negative: expired-interval edge cannot raise current credit                                          |
| AC-247         | frozen historical counts       | existing suite + G1 case: retrospective estimate stores DIAGNOSTIC_RETROSPECTIVE, never alters frozen counts                                            | negative: later estimate attempting count mutation refused                                           |
| AC-248/249     | promotion gates/controls       | machinery later; this package keeps immutable counts + availability-backdating placebo fixtures green                                                   | existing negatives stay green                                                                        |

## Material decisions (proposed ADR texts — bind future packages)

### ADR-1 — Acquisition-state vocabulary reconciliation (FR-DATA-011 × §13.8)

**Decision**: FR-DATA-011's normative ten-state list is THE decision-plane
vocabulary from G1 onward. The three differing §13.8 interface members map
member-for-member: `CAPABILITY_UNAVAILABLE` ≡ `UNSUPPORTED` (identical
pre-flight refusal semantics); `TIMED_OUT` and `INVALID_RESPONSE` become
`FAILED` carrying a required `failure_kind` (`TIMED_OUT` |
`INVALID_RESPONSE`); `INVALID_RESPONSE`-shaped ingestion outcomes surface on
the §18.5 plane as `SCHEMA_REJECTED`. `RETURNED_EMPTY` joins the decision
plane as a genuine provider result and remains distinct from
`NOT_REQUESTED_BY_POLICY` (planner result, never an ingestion outcome).
`packages/shared-schemas` imports the domain declaration — the divergent
lists are never restated side-by-side. G0 rows cannot contain the retired
members (pre-migration guard aborts if any exist).

**Why binding**: every later package persisting acquisition decisions (signal
registry probes, outcome evaluation) must use the reconciled states; the
failure-kind channel preserves the diagnostic fidelity the retired members
carried.

### ADR-2 — Economic-trade determinism and event identity

**Decision**: economic trade events are computed deterministically from
persisted raw legs: identity = canonical hash over
(chain, transaction, ordered leg set, actor resolution inputs); identical
inputs always emit identical events (idempotent replay, Constitution XIII).
Side classification is a pure function of the leg graph + resolved actors —
no LLM and no probabilistic classifier in the path (§19/Appendix H law).
Raw legs are always preserved (`economic_route_legs`) so any later
reclassification re-runs from truth (§66.3 rule 6).

### ADR-3 — Point-in-time dependence-credit scope

**Decision**: effective-independence credit used by any decision/replay at
time T is resolved ONLY from edges whose inputs were
`AVAILABLE_AT_THE_TIME` and whose validity interval contains T (FR-DATA-015,
AC-247, App. O.8 scope rule: estimation over only data available at
estimation time). `DIAGNOSTIC_RETROSPECTIVE` edges never alter a historical
count; they are queryable exclusively under explicitly labeled retrospective
diagnostic modes. Future packages (signal registry, objective governance)
consume credit through this resolver, never by raw provider counting (INV-008).

### ADR-4 — Market-cap fallback gate shape

**Decision**: the FR-SUP-002 gate is a pure predicate over
(assessment.confidence, policy-declared approved fallback availability):
hard rejection on market cap alone is structurally representable only when
no approved fallback exists — the SQL CHECK on
`market_cap_fallback_decisions` makes the violation unrecordable. The gate
does not raise a candidate's score; it only refuses one rejection path, so
fallback evidence still flows through normal opportunity evaluation.

### ADR-5 — New migration families `trd` and `sup`

**Decision**: FR-TRD uses `g1_trd_*.sql` and FR-SUP uses `g1_sup_*.sql` per
the milestone writeScopes; the migrator's fail-closed filename pattern is
extended with the two families in the same package that introduces them
(ADR-0019/0022 central-registry duty: `packages/persistence/test/migrator.spec.ts`
extended in the same package, plan-sanctioned scope exception). Migration
files stay additive — no G0 table is altered except the two documented
`ALTER TABLE` extensions on `observations` and `evidence_acquisition_decisions`,
which live in `g1_data_*` and carry the pre-migration guards.

## Risks and mitigations (planning-level)

| Risk                                                                                    | Likelihood | Impact | Mitigation                                                                                                                                 |
| --------------------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Reconciling the acquisition-state CHECK breaks G0 suites                                | Medium     | HIGH   | pre-migration guard + AC-242 regression lock in the same PR; G0 tests pin behavior, not the three renamed literals — verified before merge |
| `**` write-scope glob requires new packages to exist before task-graph shard validation | High       | MEDIUM | packages scaffolded in the first tasks (T0xx) so predicted writes resolve inside scopes                                                    |
| Route/hop dedup ambiguity on partial routes                                             | Medium     | MEDIUM | unresolved actor/route legs degrade to `UNKNOWN` side + quality codes (fail-closed, §66.3 rule 7), never guessed                           |
| Point-in-time credit resolver reused with future edges                                  | Low        | HIGH   | ADR-3 resolver is the only consumption path; AC-247 negative test blocks future-edge leakage                                               |
| Migration CHECK rebuild on non-empty DB                                                 | Low        | MEDIUM | guard aborts when retired members present; G1 lands on G0-clean data                                                                       |
| Telemetry parity suite drift for new catalogs                                           | Medium     | LOW    | catalogs mirror authoritative schemas exactly; parity tests authored in same package                                                       |

## Non-goals reaffirmed (must not creep into tasks.md)

No trading/custody/signing surfaces (permanent); no Solana program/authority
analysis (g1-solana-security — including AC-130…132 file authorship); no
feature-registry formulas or ranking machinery (g1-signal-registry consumes
our outputs); no execution simulator/adapters (g1-execution-simulation); no
outcome maturity/evaluation statistics (g1-outcome-evaluation); no objective
constraints (g1-objective-governance); no capacity admission control
(g1-capacity-contracts — but the G1 acquisition record's cost fields are
declared here as data, cost COMPUTATION stays there); no discovery coverage
claims (g1-discovery-coverage); no telemetry emitter wiring (G2); no
`docs/generated/**` regeneration (milestone plan-level decision 2).

## Validation

```bash
node scripts/automation/package-plan-complete.mjs \
  --package g1-data-truth-extensions \
  --artifacts-dir /home/minhquan_eth/.archon/workspaces/quantm-zeus/foresift/artifacts/runs/261d7fb71cf46098aa81c024700230d5

# Package gates at the pushed HEAD (milestone verificationCommands):
test -d packages/persistence && pnpm --filter @foresift/persistence test
test -d packages/evidence && pnpm --filter @foresift/evidence test
test -d packages/economic-trade-normalizer && pnpm --filter @foresift/economic-trade-normalizer test
test -d packages/supply-confidence && pnpm --filter @foresift/supply-confidence test

# Overall gates at the pushed HEAD (not planning-only):
pnpm verify
pnpm spec:verify
```
