# Tasks: g0-contracts-data-truth

**Input**: `specs/g0-contracts-data-truth/spec.md`, `specs/g0-contracts-data-truth/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-DATA-001, FR-DATA-002, FR-DATA-003, FR-DATA-004, FR-DATA-005, FR-DATA-006,
FR-DR-001, FR-DR-002) or an acceptance criterion of
those requirements. Requirement IDs not assigned to this package never appear here.

Format: `- [ ] T### [P?]` — **[P]** = parallelizable with its neighbors (disjoint files).
Tests are mandatory per PRD evidence rules: positive AND negative/failure-path specs
exist for every acceptance criterion listed in spec.md §3.

## Phase 1 — Root tooling configuration (glob-driven foundation)

- [x] T001 Rewrite root `tsconfig.json` to glob-include `packages/*/src/**/*.ts`,
      `packages/*/test/**/*.ts`, and `tests/**/*.ts` (excluding `node_modules`, `dist`)
      so later G0 packages are picked up with zero root edits; add per-package tsconfig
      convention note in the package scaffolds. Traces: foundation for FR-DATA-001 through FR-DATA-006.
- [x] T002 Add a config-shape test (`tests/acceptance/tooling-globs.spec.ts`) asserting
      tsconfig include patterns match a synthetic future package path and that
      eslint flat config + pnpm-workspace globs already cover new package dirs.
      Traces: foundation for FR-DATA-001 through FR-DATA-006.
- [x] T003 Scaffold workspace packages `packages/domain`, `packages/shared-schemas`,
      `packages/persistence`, `packages/evidence`, `packages/object-store`: each with
      `package.json` (`@foresift/<name>`, ESM, `test: vitest run`, devDependency vitest),
      `tsconfig.json` extending base, `src/index.ts`. Regenerate lockfile.
      Traces: foundation for FR-DATA-001, FR-DATA-002, FR-DATA-003, FR-DATA-004,
      FR-DATA-005, FR-DATA-006, FR-DR-001, FR-DR-002.

## Phase 2 — Domain contracts (pure TypeScript, zero dependencies)

- [x] T004 Implement `packages/domain/src/chain.ts` + `address.ts`: CAIP-2 chain-id
      parsing with mapping-quality state; chain-specific normalization — EVM canonical
      lowercase hex + EIP-55 checksum rendering, Solana base58 validation; typed errors.
      Traces: FR-DATA-001.
- [x] T005 Implement `packages/domain/src/quantity.ts`: raw-integer amounts + decimals,
      decimal-string policy, conversion helpers that never use JS number for quantities;
      documented scale semantics. Traces: FR-DATA-001.
- [x] T006 Implement `packages/domain/src/timestamps.ts` + `availability.ts`: §13.1
      required timestamp record, UTC policy, provenance-class enum (§13.2), replay-boundary
      predicate `available_at <= T` as pure function, deterministic tie-breaking.
      Traces: FR-DATA-003.
- [x] T007 Implement `packages/domain/src/quality.ts` + `acquisition.ts`: full §13.9
      quality-code vocabulary and §13.8 acquisition-state vocabulary incl.
      NOT_REQUESTED_BY_POLICY semantics helpers. Traces: FR-DATA-005, FR-DATA-003,
      FR-DR-001 (vocabulary substrate of AC-061 per spec §3.2).
- [x] T008 [P] Implement `packages/domain/src/asset.ts`, `pool.ts`, `launch.ts`:
      representation identity `(chain_id, canonical_address)`, verified-equivalence asset
      grouping types, pool identity chain+DEX+address, migration lineage edge types with
      double-count-safe aggregation interfaces. Traces: FR-DATA-001.
- [x] T009 [P] Implement `packages/domain/src/source.ts`: SourceIdentity fields
      (brand/provider, operation, upstream lineage key, endpoint/region, collection
      method), independence-group membership, dependence-edge record types with
      diagnostic-vs-available labeling. Traces: FR-DATA-006.
- [x] T010 Implement `packages/domain/src/feature.ts` + `recovery.ts` + `errors.ts`:
      FeatureValue record (feature version, event time, computation code version,
      population/lineage provenance), recovery-tier/RPO-RTO/degraded-capability types,
      stable machine error codes. Traces: FR-DATA-004, FR-DR-001.
- [x] T011 Unit tests for domain modules incl. property test: replay predicate is
      anti-monotone in T (earlier boundary results ⊆ later). Traces: FR-DATA-003.

## Phase 3 — Shared schemas (manifest schemaRefs)

- [x] T012 Add zod dependency; implement `packages/shared-schemas/src/data.ts`
      mirroring identity, observation/revision, backfill-receipt, quality, source,
      feature, acquisition, checkpoint schemas; export versioned schema registry.
      Traces: FR-DATA-001, FR-DATA-002, FR-DATA-005, FR-DATA-006.
- [x] T013 Implement `packages/shared-schemas/src/dr.ts`: recovery-tier, backup-policy,
      backup-run, restore-drill, recovery-health-state schemas. Traces: FR-DR-001, FR-DR-002.
- [x] T014 Schema round-trip tests: every domain fixture validates against its schema;
      negative fixtures (bad provenance class, missing quality code on nullable field,
      unknown acquisition state) fail validation. Traces: FR-DATA-002, FR-DATA-005, FR-DR-002.

## Phase 4 — Migrations + persistence core

- [x] T015 Write `migrations/g0_data_0001_identity.sql`: chains, dexes,
      asset_representations (unique chain+address), assets + memberships, pools, pairs,
      launches, migrations edges, token_decimal_observations; no unique constraint on
      symbols/names. Traces: FR-DATA-001.
- [x] T016 Write `migrations/g0_data_0002_observations_revisions.sql`: append-only
      observations (§13.1 timestamps, provenance CHECK, §13.3 chain coordinates,
      confirmation_level, reorg_version) with BEFORE UPDATE/DELETE immutability triggers,
      observation_revisions, compensating events, backfill_receipts (§13.6 fields),
      watermarks (§13.5 fields). Traces: FR-DATA-002, FR-DATA-003.
- [x] T017 Write `migrations/g0_data_0003_quality_sources.sql`:
      observation_field_quality (codes[] vs §13.9 vocabulary), source_identities,
      independence_groups + memberships, source_dependence_edges. Traces:
      FR-DATA-005, FR-DATA-006.
- [x] T018 [P] Write `migrations/g0_data_0004_features_acquisition.sql`:
      feature_definitions, feature_values (decimal-string values, quality codes,
      code-version + population provenance), evidence_acquisition_decisions with
      write-before-retrieval ordering constraints, evidence_bundles content-addressed.
      Traces: FR-DATA-004, FR-DATA-002, FR-DATA-003.
- [x] T019 [P] Write `migrations/g0_data_0005_object_artifact_index.sql` +
      `migrations/g0_dr_0001_recovery_tiers.sql` + `migrations/g0_dr_0002_backup_policy.sql`:
      object_artifacts staged-commit states; recovery_tiers with ≤15/≤60 min/≤24 h
      ceilings; protected_asset_registry; backup_policies (separated key references);
      backup_runs; restore_drills; recovery_health_states; collector_checkpoints with
      fencing tokens; collector_gaps; canonical_event_keys unique constraints.
      Traces: FR-DR-001, FR-DR-002, FR-DATA-002.
- [x] T020 Implement `packages/persistence/src/db.ts` (engine port seam) +
      `migrator.ts` applying `migrations/g0_(data|dr)_*.sql` in lexicographic order with
      `_foresift_schema_migrations` state; PGlite engine for tests. Traces:
      FR-DATA-001, FR-DATA-002, FR-DATA-003, FR-DATA-004, FR-DATA-005, FR-DATA-006,
      FR-DR-001, FR-DR-002 (foundation for all).
- [x] T021 Migration tests: apply to empty database, apply twice without damage,
      failure aborts cleanly leaving recorded state; immutability triggers fire.
      Traces: FR-DATA-002, FR-DR-002.
- [x] T022 Drizzle mirror (`generated/schema.ts`) matching SQL truth + parity test
      enumerating columns/constraints from information_schema against the mirror.
      Traces: FR-DATA-001 through FR-DATA-006 and FR-DR-001/FR-DR-002
      (ADR-001 conformance).

## Phase 5 — Repositories: identity, observations, replay

- [x] T023 `repos/identity.ts`: insert-only identity writes, verified-equivalence
      membership enforcement, decimals sourced→cross-checked→conflicting state machine,
      migration-edge registration with cycle/ambiguity refusal. Traces: FR-DATA-001.
- [x] T024 Golden-fixture suite `tests/fixtures/data/` + package integration tests:
      EVM/Solana address vectors, decimals resolution vectors, CAIP forms. Traces:
      FR-DATA-001.
- [x] T025 `repos/observations.ts`: append-only writes, revision chains, reorg
      compensating events preserving original receipt hashes. Traces: FR-DATA-002.
- [x] T026 Revision/reorg timeline fixtures + tests: original observations survive
      revisions/reorgs byte-for-byte; current view resolves latest valid revision.
      Traces: FR-DATA-002.
- [x] T027 `repos/replay.ts`: point-in-time queries resolving latest revision with
      `available_at <= T`; current-view vs replay-view separation; no current-state
      bypass path exposed. Traces: FR-DATA-003.
- [x] T028 `repos/backfill.ts`: backfill receipts with availability proof; guard
      rejecting historical-query rows whose `available_at` precedes retrieval commit
      unless an independently persisted live receipt exists. Traces: FR-DATA-003.
- [x] T029 Watermark store honoring §13.5: non-contiguous watermark refuses
      complete-coverage claims for the gap interval. Traces: FR-DATA-003, FR-DATA-002.

## Phase 6 — Quality codes, sources, features, acquisition

- [x] T030 Field-quality writer/reader enforcing "null alone is insufficient":
      nullable stored field ⇒ ≥1 explicit code; query API filtering by quality state.
      Traces: FR-DATA-005, FR-DR-001 (quality-code substrate of AC-061 per spec §3.2).
- [x] T031 `repos/sources.ts`: source identities, independence groups with
      collapse-by-upstream-lineage query, dependence edges storing correlation inputs
      with available-at-the-time vs diagnostic labeling. Traces: FR-DATA-006.
- [x] T032 Correlated-provider fixture pair + tests: strongly correlated timing/
      values/outages recorded as reduced-independence edge despite distinct provider ids.
      Traces: FR-DATA-006.
- [x] T033 `repos/features.ts`: online feature-value store indexed by subject,
      feature version, event time; single shared deterministic computation module used
      by both online writer and offline batch recomputation path. Traces: FR-DATA-004.
- [x] T034 Online/offline parity tests: batch recomputation over identical inputs
      yields identical values within declared tolerance; divergence fails with diff.
      Traces: FR-DATA-004.
- [x] T035 `repos/acquisition.ts`: §13.8 records persisting eligibility stratum,
      nonzero assignment probability, seed provenance, selection timestamp, requested
      fields, decision impact BEFORE retrieval completion; retrieval without prior
      assignment rejected. Traces: FR-DATA-003, FR-DATA-005.
- [x] T036 Frozen-count resolver: historical evidence counts resolved through replay
      boundaries cannot be altered by later dependence estimates; post-hoc estimates are
      stored diagnostic-only. Traces: FR-DATA-006, FR-DATA-003.
- [x] T037 Implement `packages/evidence/src/counts.ts`: immutable matured-count
      projections over frozen bundles served only through replay-realizable windows;
      below-threshold honesty (never inflate counts toward promotion gates).
      Traces: FR-DATA-006, FR-DATA-004.

## Phase 7 — Object store + evidence index

- [x] T038 `packages/object-store/src/adapter.ts` + `local.ts`: ObjectStoreAdapter
      interface (content-addressed, rights-aware metadata, encryption status, retention,
      versioning); filesystem implementation for dev/test. Traces: FR-DR-002, FR-DATA-002.
- [x] T039 Staged cross-store commit protocol PENDING_UPLOAD → STORED_HASH_VERIFIED
      → INDEX_COMMITTED → AVAILABLE with reconciler job for orphan uploads/hash mismatch;
      decision-critical evidence cannot become AVAILABLE until both sides verified.
      Traces: FR-DR-002, FR-DATA-003.
- [x] T040 `packages/evidence/src/evidence-index.ts` + `replay.ts`: frozen evidence
      bundle manifests, replay-boundary resolver over bundles + observations sharing the
      same predicate as repos/replay. Traces: FR-DATA-003, FR-DATA-002.
- [x] T041 Negative tests: tampered object hash, rights-metadata-mismatched dedup
      attempt, orphan upload, retention drift → explicit failures, no silent repair.
      Traces: FR-DR-002, FR-DATA-002.

## Phase 8 — Recovery tiers, backup, restore drills

- [x] T042 Recovery-tier registry seeding §34.4 defaults under FR-DR-001 ceilings
      (critical metadata ≤15 min RPO, critical observations/checkpoints ≤60 min, raw
      payloads ≤24 h when rights permit reconstruction) + protected-asset registry
      mapping every table/store created by this package's migrations. Traces: FR-DR-001.
- [x] T043 Backup policy records (retention, encryption, location, rights ref,
      legal hold, deletion policy, separated key_reference) + `drill/backup.ts`
      snapshot mechanism interface with deterministic snapshot implementation.
      Traces: FR-DR-002, FR-DR-001.
- [x] T044 `drill/restore.ts` clean-environment verifier: database/migration state,
      object hashes, cross-store references, collector checkpoints/gaps validated before
      resumption is permitted; pluggable check interface so audit-chain, workflow, quota
      verifications attach later. Traces: FR-DR-002.
- [x] T045 `drill/rpo.ts`: measured RPO/RTO evaluation against configured tiers;
      ClockPort-injected timelines prove ≤15 min / ≤60 min tier measurement; missed-tier
      outcome flips recovery_health_states to degraded incl. confirmed-opportunity-
      influence-blocked flag while preserving risk-monitoring allowance; incident record
      written. Traces: FR-DR-001, FR-DR-002.
- [x] T046 Key-separation tests: backup artifacts scanned assert no key material
      present (key references only); restore refuses to run without separately provided
      credential provider; missing provider fails closed. Traces: FR-DR-002.
- [x] T047 Checkpoint/gap storage-contract tests: fenced checkpoint rejects stale
      token commits; restore+replay fixture inserts each canonical event exactly once;
      unmarked-gap replay refused until gap registered explicitly. Traces: FR-DR-002.
- [x] T048 Policy-test battery for backup governance: retention windows, encryption
      status, location allowlist, rights references, legal-hold blocking deletion,
      deletion execution, key-access separation, restore credentials — positive and
      violation paths. Traces: FR-DR-002, FR-DR-001.

## Phase 9 — Manifest-declared acceptance + negative suites

- [x] T049 `tests/acceptance/AC-020.spec.ts` + `tests/negative/AC-020.negative.spec.ts`:
      replay at T excludes `available_at > T`; attempted future-evidence read fails.
      Traces: FR-DATA-003.
- [x] T050 AC-021 pair: revisions/reorgs preserve originals; mutation attempts
      rejected by triggers. Traces: FR-DATA-002.
- [x] T051 AC-022 pair: migration aggregation avoids double counting on fixture;
      naive aggregation demonstrably diverges. Traces: FR-DATA-001.
- [x] T052 AC-023 pair: decimals/address golden fixtures pass; invalid inputs yield
      explicit quality states/refusals. Traces: FR-DATA-001.
- [x] T053 AC-240 pair + AC-241 pair: §13.7 timestamp substrate resolves symmetric
      action-time inputs; frozen replay differs only via registered component; hidden
      current-data call fails replay. Traces: FR-DATA-003.
- [x] T054 AC-242 pair + AC-243 pair: acquisition-state vocabulary storage semantics;
      probe metadata completeness + write-before-retrieval ordering. Traces:
      FR-DATA-005, FR-DATA-003.
- [x] T055 AC-244 pair: feature provenance fields present; lift claim without valid
      provenance refused at substrate level. Traces: FR-DATA-004.
- [x] T056 AC-245 pair + AC-246 pair + AC-247 pair: dependence-edge credit reduction,
      lineage collapse removing duplicated credit, retrospective estimate cannot alter
      frozen counts. Traces: FR-DATA-006.
- [x] T057 AC-248 pair + AC-249 pair: immutable matured-count projections reported
      honestly below thresholds; availability-backdating placebo leaves replay unchanged.
      Traces: FR-DATA-003, FR-DATA-004.
- [x] T058 AC-060 pair: persistence benchmark fixtures (identity lookup, replay read)
      with budget assertions; harness fails under artificial over-budget delay. Traces:
      FR-DATA-001, FR-DATA-003, FR-DR-001 (internal-overhead benchmark substrate of
      AC-060 per spec §3.2).
- [x] T059 AC-061 pair: explicit partial/insufficient output states rendered from
      quality/acquisition/degradation vocabularies; unsafe automated-alert success
      fabrication impossible. Traces: FR-DATA-005, FR-DR-001 (explicit-degraded-output
      substrate of AC-061 per spec §3.2).
- [x] T060 AC-062 pair + AC-260 pair: destructive drill meets declared tiers on
      fixture workloads or blocks opportunity-mode flag; missed-tier creates incident.
      Traces: FR-DR-001, FR-DR-002.
- [x] T061 AC-261 pair + AC-262 pair + AC-263 pair: clean-environment verification
      catches tampering; tier violation degrades capability machine-readably; restore+
      replay neither duplicates canonical events nor skips unmarked gaps. Traces:
      FR-DR-002, FR-DR-001.
- [x] T062 AC-264 pair: backup governance policy tests (retention/encryption/location/
      rights/legal-hold/deletion/key access/restore credentials). Traces: FR-DR-002.

## Phase 10 — Telemetry catalogs + convergence

- [x] T063 Write `telemetry/data.catalog.json` (observation.committed,
      revision.created, replay.served, backfill.completed, quality.flagged,
      acquisition.recorded, dependence.edge.updated) and `telemetry/dr.catalog.json`
      (backup.completed, restore.drill.finished, tier.violation.detected,
      degradation.changed): event names, field lists, tier/requirement annotations.
      Traces: FR-DATA-002, FR-DATA-003, FR-DATA-006, FR-DR-001, FR-DR-002.
- [x] T064 Cross-artifact consistency sweep: every manifest-declared test ref for the
      eight requirements exists as a file; every scoped artifact free of placeholder
      markers; every task above traces only assigned IDs. Traces: FR-DATA-001,
      FR-DATA-002, FR-DATA-003, FR-DATA-004, FR-DATA-005, FR-DATA-006, FR-DR-001,
      FR-DR-002.
- [x] T065 Run `pnpm verify` (spec:verify, format, lint, typecheck, tests) and the
      package verification commands (`pnpm --filter @foresift/shared-schemas|persistence|
evidence|object-store test`); fix findings until green; leave work uncommitted
      for review. Traces: FR-DATA-001, FR-DATA-002, FR-DATA-003, FR-DATA-004,
      FR-DATA-005, FR-DATA-006, FR-DR-001, FR-DR-002.

## Convergence addendum (2026-08-23) — unresolved items carried explicitly

- [ ] T066 Wire `PRECISION_RETAINING_TIMESTAMP_PARSERS` into the production
      PostgreSQL pool at the moment one is first constructed (node-pg
      `types.setTypeParser` for OIDs 1114/1184), per the engine contract in
      ADR-0009. Driver-default parsers truncate sub-millisecond precision on
      read-back, which silently breaks byte-for-byte receipt-hash round-trips
      (PR review H-2). No production pool exists inside this package's G0
      write scope — the requirement stays open until the deployment-facing
      package constructs its first pool. Traces: FR-DATA-002.

## Traceability matrix (AC → tasks)

| AC     | Tasks                        |
| ------ | ---------------------------- |
| AC-020 | T006, T011, T027, T049       |
| AC-021 | T016, T021, T025, T026, T050 |
| AC-022 | T008, T023, T024, T051       |
| AC-023 | T004, T005, T024, T052       |
| AC-240 | T010, T053                   |
| AC-241 | T027, T040, T053             |
| AC-242 | T007, T018, T035, T054       |
| AC-243 | T035, T054                   |
| AC-244 | T010, T033, T055             |
| AC-245 | T009, T031, T032, T056       |
| AC-246 | T031, T056                   |
| AC-247 | T036, T056                   |
| AC-248 | T036, T037, T057             |
| AC-249 | T028, T057                   |
| AC-060 | T058                         |
| AC-061 | T007, T030, T059             |
| AC-062 | T042–T045, T060              |
| AC-260 | T045, T060                   |
| AC-261 | T044, T061                   |
| AC-262 | T045, T061                   |
| AC-263 | T019, T047, T061             |
| AC-264 | T043, T046, T048, T062       |

Every phase closes with its tests green before later phases begin. No task
creates trading, custody, signing, private-key, or transaction-submission
capability anywhere (INV-001).
