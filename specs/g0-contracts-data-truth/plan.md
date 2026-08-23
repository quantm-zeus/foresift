# Implementation Plan: g0-contracts-data-truth

**Branch**: `archon/task-foresift-g0-contracts-data-truth` | **Date**: 2026-08-22
**Spec**: `specs/g0-contracts-data-truth/spec.md` (scoped derivative; PRD-subordinate)
**Input**: Assigned requirements FR-DATA-001, FR-DATA-002, FR-DATA-003, FR-DATA-004,
FR-DATA-005, FR-DATA-006, FR-DR-001, FR-DR-002 from
`specs/implementation/current-milestone.json` (milestone G0, risk CRITICAL).

## Summary

Deliver the canonical data-truth foundation of the Foresift modular monolith:
pure domain contracts for identity/time/quality/lineage; versioned Zod schemas
mirroring them (`packages/shared-schemas/src/data.ts`, `src/dr.ts`); PostgreSQL
migrations as schema source of truth with a Drizzle mirror and repository layer;
an S3-compatible object-store adapter with the §14.8 staged cross-store commit
protocol; an evidence index enforcing point-in-time `available_at` replay,
acquisition states, and frozen historical counts; tiered recovery objectives with
backup policies, a deterministic restore-drill harness, and separated key
material handling — plus glob-driven root tooling configuration so later G0
packages require zero root-config edits.

## Technical Context

**Language/Version**: TypeScript 5.9 (NodeNext, `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`) on Node.js ≥24.19 — already pinned in root configs.

**Primary Dependencies**:

- `zod` — single runtime-validation schema library for `packages/shared-schemas`
  (proposed ADR-P1 below).
- `drizzle-orm` — typed access mirroring SQL migrations per ADR-001.
- `@electric-sql/pglite` — in-process PostgreSQL (WASM) as the deterministic test
  engine for migrations and repositories (proposed ADR-P2 below). Dev/test-only.
- `vitest` — existing repo test runner. Declared as devDependency in each new
  workspace package so `pnpm --filter <pkg> test` resolves deterministically.

**Storage**: PostgreSQL via migrations `migrations/g0_data_*.sql`,
`migrations/g0_dr_*.sql` (schema source of truth, ADR-001) + content-addressed
object storage behind the ADR-003 `ObjectStoreAdapter` interface (local
filesystem implementation shipped here; S3-compatible client later).

**Testing**: Vitest at three layers: package unit/integration tests colocated in
`packages/*/test/`; manifest-declared acceptance specs `tests/acceptance/AC-*.spec.ts`;
negative/failure-path specs `tests/negative/AC-*.negative.spec.ts`. Golden fixtures
under `tests/fixtures/data/` and `tests/fixtures/dr/`.

**Target Platform**: Linux CI + local dev (single deployable modular monolith;
Constitution III).

**Performance Goals**: persistence hot paths (canonical identity lookup, replay-
boundary reads) must support the §33 internal overhead budgets (<100 ms p95
internal authorization/validation overhead class); benchmark fixtures delivered
for AC-060 substrate.

**Constraints**: read-only product boundary (INV-001 / Constitution IV);
fail-closed external integrations (VIII); deterministic verification (XI); every
task traces to an assigned requirement ID or its acceptance criteria (X).

**Scale/Scope**: 5 new workspace packages, 7 migration files, ~44 manifest-declared
test files (22 ACs × positive+negative), fixture sets, telemetry catalogs. No app
surfaces; no network egress anywhere in this package.

## Constitution Check

_GATE: must pass before implementation. Re-checked after design._

| Principle                             | Verdict | Evidence                                                                                                                                        |
| ------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| I Product-Contract Authority          | PASS    | Every task cites FR-DATA-001 through FR-DATA-006 and FR-DR-001/FR-DR-002 or their ACs; `docs/spec/**` untouched; spec.md is marked subordinate. |
| II Greenfield Architecture            | PASS    | Designed from PRD §§11/13/14/30/34/45 + Appendix D ADRs; predecessor not consulted.                                                             |
| III Modular-Monolith-First Simplicity | PASS    | Five cohesive packages inside declared writeScopes; no brokers/services; PGlite is a test engine, not runtime infrastructure.                   |
| IV Read-Only Product Boundary         | PASS    | No execution/custody/signing/key-handling capability; key _material references_ only, never key material; negative tests assert absence.        |
| V Point-in-Time Correctness           | PASS    | Replay boundary enforced in storage contract and query layer (AC-020).                                                                          |
| VI Event-Time / Earliest-Availability | PASS    | `event_at` preserved, `available_at` = earliest proven availability (ADR-049), backfill receipts carry availability proofs.                     |
| VII Provenance & Evidence             | PASS    | Availability-provenance classes, source lineage records, content hashes on all artifacts.                                                       |
| VIII Fail-Closed Integrations         | PASS    | Unknown provenance class, missing quality code, unverified restore → refuse; no silent defaults.                                                |
| IX Provider/Capability Abstraction    | PASS    | Object store and clock behind internal interfaces; no vendor SDK in domain/persistence logic.                                                   |
| X Requirement Traceability            | PASS    | tasks.md maps each task to requirement IDs; validator-enforced.                                                                                 |
| XI Deterministic Verification         | PASS    | PGlite keeps migration/repository/drill tests hermetic; gates run identically locally and in CI.                                                |
| XII Positive AND Failure-Path Testing | PASS    | All 22 assigned ACs get acceptance + negative specs per manifest testRefs.                                                                      |
| XIII Replay/Recovery/Idempotency      | PASS    | Fenced checkpoints, idempotent canonical-event constraints, replay-safe drill harness.                                                          |
| XIV Durable Resumable Operations      | PASS    | Migration state persisted in `_foresift_schema_migrations`; drill state on disk; no conversational-only state.                                  |
| XV Security & Least Privilege         | PASS    | No secrets in code/tests/artifacts; `.env.example` placeholders only if needed; key separation enforced by policy tests.                        |
| XVI Autonomous-Agent Governance       | PASS    | Material decisions recorded as proposed ADR texts (§8); scope respected; out-of-scope gaps routed to notes file.                                |
| XVII Additive Git History             | PASS    | Work lands via PR from this branch; no amend/rebase/force.                                                                                      |
| XVIII No AI Claim Is Completion       | PASS    | Completion decided by `package-plan-complete.mjs` now and by `pnpm verify`/CI later.                                                            |

## Project Structure

### Documentation (this feature)

```text
specs/g0-contracts-data-truth/
  spec.md      # scoped derivative (PRD-subordinate)
  plan.md      # this file
  tasks.md     # ordered traceable breakdown
```

### Source code (all inside binding writeScopes)

```text
packages/domain/src/
  chain.ts            # CAIP-2 chain ids, mapping-quality states
  address.ts          # chain-specific normalization: EVM canonical lowercase hex
                      #   + EIP-55 checksum rendering, Solana base58 validation
  asset.ts            # AssetRepresentation identity, verified-equivalence grouping
  pool.ts             # PoolId = chain+DEX+address; pair identity
  launch.ts           # Launch + MigrationLineageEdge (launch_pool→migration→migrated_pool)
  quantity.ts         # raw-integer amounts + decimals; decimal-string policy; never JS number
  timestamps.ts       # §13.1 required timestamp set; UTC; precision retention
  availability.ts     # §13.2 provenance classes; replay-boundary predicate available_at<=T
  quality.ts          # full §13.9 quality-code vocabulary
  acquisition.ts      # §13.8 EvidenceAcquisitionDecision states
  source.ts           # SourceIdentity, upstream lineage, independence groups
  feature.ts          # FeatureValue record: version, event time, computation code version
  recovery.ts         # recovery tiers, RPO/RTO classes, degraded-capability states
  errors.ts           # typed error classes with stable machine codes
packages/shared-schemas/src/
  data.ts             # Zod schemas mirroring domain data contracts (manifest schemaRefs)
  dr.ts               # Zod schemas mirroring DR contracts (manifest schemaRefs)
packages/persistence/src/
  db.ts               # connection/port seam (PGlite for tests, pg Pool in prod later)
  migrator.ts         # ordered application of migrations/g0_(data|dr)_*.sql; state table
  generated/schema.ts # Drizzle table mirror (hand-maintained mirror of SQL truth)
  repos/identity.ts   # chains/dexes/assets/representations/pools/pairs/launches/migrations
  repos/observations.ts # append-only observations + revisions + compensating events
  repos/replay.ts     # point-in-time queries (available_at <= T), revision resolution
  repos/backfill.ts   # backfill receipts w/ availability proof; no-backdating guard
  repos/features.ts   # feature_definitions/feature_values online store
  repos/sources.ts    # source identities, lineage/independence groups, dependence edges
  repos/checkpoints.ts# fenced collector checkpoints + gap registry storage contract
  repos/acquisition.ts# evidence acquisition decisions (§13.8) write-before-retrieve
  drill/backup.ts     # backup policies/runs; snapshot mechanism interface
  drill/restore.ts    # clean-environment restore verifier (hash/migration/object refs)
  drill/rpo.ts        # measured-RPO/RTO evaluation vs configured tiers; health states
  sql/                # embedded SQL used by repos where Drizzle is insufficient
packages/object-store/src/
  adapter.ts          # ObjectStoreAdapter interface (ADR-003): put/get/version/delete-barring
  local.ts            # filesystem implementation (dev/test): content-addressed, versioned
  staged-commit.ts    # PENDING_UPLOAD→STORED_HASH_VERIFIED→INDEX_COMMITTED→AVAILABLE
  artifact-index.ts   # object_artifact index rows shared with persistence
packages/evidence/src/
  evidence-index.ts   # frozen evidence bundle manifests, content-addressed
  replay.ts           # replay-boundary resolver over evidence + observations
  counts.ts           # frozen historical evidence counts (replay-realizable only)
telemetry/data.catalog.json   # event names/fields for the data family
telemetry/dr.catalog.json     # event names/fields for the DR family
migrations/
  g0_data_0001_identity.sql
  g0_data_0002_observations_revisions.sql
  g0_data_0003_quality_sources.sql
  g0_data_0004_features_acquisition.sql
  g0_data_0005_object_artifact_index.sql
  g0_dr_0001_recovery_tiers.sql
  g0_dr_0002_backup_policy.sql
tests/
  fixtures/data/**    # golden normalization vectors, migration double-count scenarios,
                      # revision/reorg timelines, backdate attempts, dependence pairs
  fixtures/dr/**      # backup snapshots, tampered artifacts, tier-violation timelines
  acceptance/AC-020.spec.ts … AC-249.spec.ts, AC-060…062, AC-260…264
  negative/AC-020.negative.spec.ts … matching negatives
```

Root config changes (glob-driven so later packages need zero edits):

```text
tsconfig.json   # include packages/*/src, packages/*/test alongside tests/**
```

`pnpm-workspace.yaml` (`apps/*`, `packages/*`) and flat `eslint.config.js` already
pick up new paths automatically — verified by a config-shape test rather than edited.
`package.json` needs no change beyond what exists (`pnpm verify` already aggregates).
`pnpm-lock.yaml` updates mechanically from new devDependencies (justified supporting
change, §9).

## Data Model

Authoritative DDL lives in the SQL migrations; Drizzle mirrors for typed access.
Key tables (naming follows §30 catalogue where the section lists the entity):

- **Identity**: `chains` (CAIP-2 pk, mapping-quality state), `dexes`,
  `asset_representations` (unique `(chain_id, canonical_address)`; decimals state),
  `assets` + `asset_representation_memberships` (verified equivalence only),
  `pools` (unique `(chain_id, dex_id, pool_address)`), `pairs`, `launches`,
  `migrations` (edge `launch_pool_id → migrated_pool_id` + event timestamps +
  lineage status). Symbols/names carry no unique constraint — they cannot be
  identifiers. Decimals live in versioned `token_decimal_observations`
  (source, value, observed_at, status: sourced/cross-checked/conflicting).
- **Observations**: `observations` append-only (subject ref, content-addressed
  payload hash, §13.1 timestamps incl. `available_at` + provenance-class CHECK,
  §13.3 chain coordinates, `confirmation_level`, `reorg_version`); BEFORE
  UPDATE/DELETE triggers raise exceptions (immutability). `observation_revisions`
  (revision_no, supersedes, revised_at, available_at, reason). Reorg corrections
  are compensating/superseding rows, never rewrites. `backfill_receipts` carries
  the §13.6 field set incl. `retrospective_only`, `availability_proof`.
  `watermarks` per provider/op/shard/program/chain with §13.5 fields.
- **Quality**: `observation_field_quality` (observation_id, field_path, codes[]
  against the §13.9 vocabulary; nullable fields MUST carry ≥1 code — enforced by
  check + repository invariant "`null` alone is insufficient").
- **Sources**: `source_identities` (brand/provider, operation, upstream_lineage_key,
  endpoint_region, collection_method), `independence_groups` +
  `source_group_memberships`, `source_dependence_edges` (pairwise, declared lineage
  - observed-correlation inputs, diagnostic-vs-available labeling).
- **Features/evidence**: `feature_definitions` (versioned), `feature_values`
  (feature version, event time, raw decimal-string value, quality codes,
  computation_code_version, population/lineage provenance, store_class ONLINE),
  `evidence_acquisition_decisions` (§13.8 state vocabulary; assignment probability
  and seed provenance columns constrained non-null-before-retrieval ordering),
  `evidence_bundles` (content-addressed manifests).
- **Checkpoints**: `collector_checkpoints` (shard, fencing_token, monotonic cursor),
  `collector_gaps` (explicit gap registry: bounds, recovery_status),
  `canonical_event_keys` (unique keys making duplicate first-seen/event inserts
  impossible at the storage layer).
- **Object store index**: `object_artifacts` (artifact_id, content_hash sha256,
  storage_uri, content_type, compression, encryption_status, license_policy_id,
  retention_expires_at, stage enum per §14.8, created_at). Content-addressed dedup
  never merges rows differing in rights/tenant/encryption/retention metadata.
- **DR**: `recovery_tiers` (tier keys with RPO/RTO ceilings: critical-metadata ≤15
  min, critical-observations/checkpoints ≤60 min, raw payloads ≤24 h when rights
  permit; stricter §34.4 defaults recorded where applicable),
  `protected_asset_registry` (table/store → tier), `backup_policies` (retention,
  encryption, location, rights ref, legal_hold, deletion policy, separated
  key_reference — never key material), `backup_runs` (kind, hashes, verification),
  `restore_drills` (per-tier measured RPO/RTO, pass/fail, incident ref),
  `recovery_health_states` (degraded capability flags incl.
  confirmed-opportunity-influence-blocked boolean that later packages consult).

## Verification Strategy (per acceptance criterion)

Deterministic engine: PGlite in-process Postgres; migrator applies real SQL files;
repos exercise real constraints/triggers. Clock injection (`ClockPort`) makes
availability/RPO measurement deterministic. Each AC gets the manifest-declared
positive spec under `tests/acceptance/` and negative spec under `tests/negative/`.

| AC     | Positive proof                                                                                                 | Negative/failure proof                                                                                               |
| ------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| AC-020 | Replay at T returns exactly the revisions visible at T across a fixture timeline.                              | Query attempting to observe `available_at > T` records fails/returns nothing; hidden current-data bypass call fails. |
| AC-021 | Revision + compensating-reorg timeline preserves original receipt bytes/hashes.                                | UPDATE/DELETE on immutable tables rejected by triggers; revision that would rewrite history rejected.                |
| AC-022 | Migration-edge fixture aggregation counts liquidity/volume once across launch→pool boundary.                   | Naive double-count aggregation over same fixture produces mismatch, demonstrating the fixture detects regression.    |
| AC-023 | Golden vectors: EVM checksum/lowercase, Solana base58 validation, CAIP forms, decimals resolution.             | Invalid addresses/decimals rejected; conflicting decimals yield explicit quality state, not a guess.                 |
| AC-240 | §13.7 timestamp fields persist and resolve symmetrically for delivered/non-delivered arms in fixture.          | Non-delivered arm receiving earlier entry than counterfactual delivery is rejected by resolver.                      |
| AC-241 | Frozen-candidate replay twice differs nowhere except injected registered-policy component.                     | Replay harness detecting a current-data read fails closed.                                                           |
| AC-242 | Acquisition record stored as NOT_REQUESTED_BY_POLICY renders exactly that state.                               | Storing it as RETURNED_EMPTY/PROVIDER_UNAVAILABLE/negative feature violates schema/repository invariant.             |
| AC-243 | Probe record persists stratum/probability/seed/timestamps/fields/impact before retrieval.                      | Retrieval without prior assignment-probability persistence rejected.                                                 |
| AC-244 | Feature values expose version/code-version/population provenance consumed by selection checks.                 | Feature row lacking provenance cannot back a lift claim query (substrate-level refusal).                             |
| AC-245 | Correlated-pair fixture stores reduced-independence edge despite distinct provider IDs.                        | Edge asserting independence for correlated pair contradicts stored inputs → rejected.                                |
| AC-246 | Independence-group collapse-by-lineage query removes duplicated evidence credit.                               | Alert-gate-style query relying on collapsed lineage returns insufficient-independent-evidence, not confirmation.     |
| AC-247 | Retrospective estimate inserted post-hoc cannot change replay-resolved historical count.                       | Mutation attempt on frozen count window rejected; estimate labeled diagnostic.                                       |
| AC-248 | Immutable, replay-correct matured-count projections served to gate consumers.                                  | Count projection below registered thresholds is reported as failing (substrate honesty).                             |
| AC-249 | Availability-backdating placebo fixture: attempted backdate leaves replay results unchanged.                   | Backdated insert without independent receipt violates no-backdating guard.                                           |
| AC-060 | Benchmark fixtures measure identity-lookup and replay-read latency; budgets asserted with headroom.            | Benchmark harness fails when artificial delay exceeds budget (guard against vacuous pass).                           |
| AC-061 | Quality/acquisition/degradation vocabularies render explicit partial/insufficient output states.               | Missing required evidence yields suppressed-state record, never fabricated success.                                  |
| AC-062 | Drill: backup → mutate → restore → measured RPO/RTO within configured tiers.                                   | Tier-violation scenario reports failure and flips health state to degraded.                                          |
| AC-260 | Destructive drill restores metadata ≤15 min, observations/checkpoints ≤60 min tiers on fixture workloads.      | Missed-tier drill blocks confirmed-opportunity influence flag and creates incident record.                           |
| AC-261 | Clean-environment verifier validates DB/migration state, object hashes, cross-store refs, checkpoints/gaps.    | Tampered object hash / orphan upload / stale checkpoint causes verifier refusal.                                     |
| AC-262 | Tier violation flips machine-readable degraded-capability state preserving risk-monitoring allowance.          | Suppression of safe deterministic risk monitoring along with opportunity alerts fails review assertion.              |
| AC-263 | Restore+replay fixture replays events exactly once against canonical-event keys; gaps stay explicit.           | Duplicate first-seen insert rejected; unmarked-gap replay refused until gap registered.                              |
| AC-264 | Policy tests validate retention/encryption/location/rights/legal-hold/deletion/key-access/restore credentials. | Backup containing key material, or restore without separated credential provider, fails closed.                      |

Additional mandatory suites: migration apply-twice idempotency; immutability
trigger fuzz; watermark non-contiguity blocking coverage claims; property test
that replay predicate is anti-monotone in T (earlier T ⊆ later T results).

## Risks

| Risk                                                                                                     | Mitigation                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PGlite diverges from real PostgreSQL semantics (triggers, checks, domains).                              | Migrations restricted to widely-supported core SQL; a documented conformance note per feature used; CI runs same suite; production parity re-verified when a real cluster exists (ops milestone). |
| Scope creep into evaluation/promotion machinery (AC-240…249 temptation).                                 | Scoped-obligation column in spec.md §3; reviewer-visible non-goals; tasks cite substrate obligations only.                                                                                        |
| Over-building DR infrastructure outside writeScopes (real PITR clusters, scripts/run-restore-drill CLI). | Interface + tested equivalent mechanism inside `packages/persistence`; production wiring deferred; noted in out-of-scope notes.                                                                   |
| Root tsconfig glob loosening breaks typecheck isolation between packages.                                | Per-package tsconfigs extend base; dependency-boundary enforced by imports of `@foresift/*` workspace links only; lint `no-restricted-imports` guards relative cross-package imports.             |
| Lockfile churn from new devDependencies destabilizing other packages.                                    | Minimal, pinned-range deps (zod, drizzle-orm, pglite, vitest) justified in §9; single lockfile commit within the package PR.                                                                      |

## Proposed ADR texts (record under docs/adr/ at implementation time)

- **P1 — Runtime schema validation library**: "Foresift uses Zod as the single
  approved runtime-validation schema library. Authoritative schemas live in
  `packages/shared-schemas`; external SDK types are never trusted without passing
  these schemas (PRD §37.5). Adding further ad-hoc validation libraries requires a
  superseding ADR."
- **P2 — Deterministic database test engine**: "Migration and repository tests run
  against in-process PostgreSQL (PGlite). Production remains real PostgreSQL per
  product ADR-001; PGlite is a test engine only, never normative for production
  state. Migrations must restrict themselves to SQL constructs supported by both
  engines; any divergence requires a documented conformance note and a CI-followup
  issue."
- **P3 — Recovery mechanism for pre-infrastructure milestones**: "Until production
  PostgreSQL/object-store infrastructure exists (deployment-topology milestone),
  FR-DR-002's 'equivalent tested mechanism' is the deterministic snapshot-and-replay
  restore harness in `packages/persistence/drill/`. It measures RPO/RTO against the
  §34.4 tier registry and enforces key-material separation. Production WAL-based
  PITR configuration implements the same interface and inherits the same drill
  verification."

## Supporting changes outside writeScopes (justified)

1. `pnpm-lock.yaml` — mechanical regeneration from the devDependencies above;
   unavoidable consequence of declaring dependencies in scoped `package.json`
   files; no hand edits.
2. `docs/adr/0005-runtime-schema-validation-zod.md`,
   `docs/adr/0006-pglite-deterministic-db-test-engine.md`,
   `docs/adr/0007-pre-infrastructure-recovery-mechanism.md` — recording ADRs P1–P3
   above at implementation time (next free numbers after existing 0001–0004;
   CLAUDE.md mandates ADRs for material decisions; `docs/adr/` is the mandated
   location and is not enumerated in this package's writeScopes).

No other out-of-scope writes are planned; anything discovered mid-implementation
goes to the run's out-of-scope notes instead.
