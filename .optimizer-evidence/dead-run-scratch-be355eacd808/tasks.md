# Tasks: g0-contracts-data-truth@g1

**Input**: `specs/g0-contracts-data-truth@g1/spec.md`, `specs/g0-contracts-data-truth@g1/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-DATA-001, FR-DATA-002, FR-DATA-003, FR-DATA-004, FR-DATA-005, FR-DATA-006,
FR-DR-001, FR-DR-002) or an acceptance criterion of those requirements. No
other requirement-family identifiers appear in this file by design.

Format: `- [ ] T1xx [P?]` — **[P]** = parallelizable with its neighbors
(disjoint files). Tests are mandatory per PRD evidence rules: positive AND
negative/failure-path specs exist for every acceptance criterion listed in
spec.md §3 and must be GREEN at the converged HEAD. The salvaged implementation
is a frozen input: tasks repair configuration/verification infrastructure only;
product logic, migrations, and schemas are not rewritten.

## Phase 1 — Root tooling restoration (generation-gap repair)

- [ ] T101 Restore the glob-driven root TypeScript configuration to its proven
      shape: `tsconfig.json` includes `packages/*/src/**/*.ts`,
      `packages/*/test/**/*.ts`, `tests/**/*.ts` and excludes `node_modules`/
      `dist`; `tsconfig.base.json` enables `allowImportingTsExtensions` (safe:
      every project compiles with `noEmit`). Copy the exact probe-verified
      shapes recorded in plan.md §Current-State Assessment; both files are
      enumerated writeScopes of this package and carry the objective's
      "zero root-config edits for later packages" obligation.
      Traces: foundation enabling executable verification of FR-DATA-001,
      FR-DATA-002, FR-DATA-003, FR-DATA-004, FR-DATA-005, FR-DATA-006,
      FR-DR-001, FR-DR-002.
- [ ] T102 [P] Add a shared constant (`DB_HOOK_TIMEOUT_MS`, generous and finite,
      e.g. 30_000 matching project test timeout precedent) plus a short
      rationale note to `tests/acceptance/helpers.ts`, so DB-bootstrap hooks in
      manifest-declared suites declare their bounded wait explicitly instead of
      relying on runner defaults. Traces: verification-infrastructure
      reliability serving FR-DATA-001, FR-DATA-002, FR-DATA-003, FR-DATA-004,
      FR-DATA-005, FR-DATA-006, FR-DR-001, FR-DR-002.
- [ ] T103 Apply explicit timeout declarations (per-hook argument or per-file
      config using T102's constant — pick ONE style and apply uniformly) to
      every lifecycle hook in `tests/acceptance/*.spec.ts` and
      `tests/negative/*.negative.spec.ts` that bootstraps a PGlite database
      (42 files reference the shared bootstrap helper); while editing, correct
      the helpers' stale hard-coded migration-count wording to reference the
      migrator's discovered list instead, and make `closeTestDatabase` tolerant
      of a failed bootstrap (null-guard) so teardown never masks the real
      failure with a secondary TypeError. Failure on timeout expiry stays loud —
      no silent retries are added anywhere. Traces: FR-DATA-002, FR-DATA-003,
      FR-DATA-004, FR-DATA-005, FR-DATA-006, FR-DR-001, FR-DR-002 (suite
      bootstrap headroom for the nested full-gate execution profile).

## Phase 2 — Layered verification (each layer green before the next)

- [ ] T104 Verify the tooling layer: `pnpm typecheck` exits 0 over packages AND
      tests; `tests/acceptance/tooling-globs.spec.ts` passes all four assertions
      (glob pickup of a synthetic future package path; correct exclusions;
      eslint flat-config and pnpm-workspace globs already cover new dirs).
      Traces: FR-DATA-001, FR-DATA-006 (identity/source contract compilation)
      and FR-DR-001, FR-DR-002 (recovery schema compilation).
- [ ] T105 Run the FULL aggregate gate `pnpm verify` (spec integrity, format,
      lint, typecheck, complete two-tier test suite) and require exit 0,
      specifically confirming: the previously red
      `tests/automation/targeted-router-e2e.spec.ts` and BOTH nested-gate
      end-to-end suites now pass; no salvaged product suite regressed versus
      the 432-test baseline recorded in plan.md. Traces: FR-DATA-001 through
      FR-DATA-006 and FR-DR-001, FR-DR-002 (whole-assignment aggregate proof).
- [ ] T106 Run the milestone-declared package verification commands and require
      exit 0 from each: `pnpm --filter @foresift/shared-schemas test`,
      `pnpm --filter @foresift/persistence test`,
      `pnpm --filter @foresift/evidence test`,
      `pnpm --filter @foresift/object-store test`. Traces: FR-DATA-002,
      FR-DATA-003 (persistence/evidence cores), FR-DATA-001, FR-DATA-005
      (schemas), FR-DR-001, FR-DR-002 (drill/recovery suites).

## Phase 3 — Convergence sweeps

- [ ] T107 Manifest test-ref sweep: enumerate the test references declared for
      the eight assigned requirements in the machine-readable requirement
      manifest and assert every referenced file exists and executes under
      `vitest run` (22 acceptance criteria × positive + negative = 44 files);
      record the mapping table in the run artifacts. Traces: FR-DATA-001,
      FR-DATA-002, FR-DATA-003, FR-DATA-004, FR-DATA-005, FR-DATA-006,
      FR-DR-001, FR-DR-002.
- [ ] T108 Durability re-proof on the frozen migrations: migrator suite
      demonstrates apply-to-empty, apply-twice idempotency, checksum-drift
      refusal, clean rollback on failure; immutability-trigger negatives still
      reject UPDATE/DELETE; replay predicate property test (anti-monotone in
      the boundary) still passes. Traces: FR-DATA-002, FR-DATA-003, FR-DR-002.
- [ ] T109 Telemetry catalog check: `telemetry/data.catalog.json` and
      `telemetry/dr.catalog.json` parse as JSON, their event/field names match
      the implementations they annotate, and no catalog entry references a
      surface outside the data/recovery families owned here. Traces:
      FR-DATA-002, FR-DATA-003, FR-DATA-006, FR-DR-001, FR-DR-002.
- [ ] T110 Boundary audit of the generation delta: diff review confirms the
      changed file set touches ONLY enumerated writeScopes (two root configs +
      tests/acceptance/** + tests/negative/**), introduces no dependency
      changes (lockfile byte-identical), adds no network egress, and preserves
      the permanent read-only boundary — nothing capable of trading, custody,
      signing, private-key handling, or transaction submission exists in the
      delta. Traces: FR-DATA-001 through FR-DATA-006, FR-DR-001, FR-DR-002.
- [ ] T111 Cross-artifact consistency pass (speckit-analyze methodology):
      spec.md quotes all eight assigned normative texts; every task above
      traces only assigned requirement IDs; no placeholder/marker patterns
      remain in any scoped artifact; the generation-0 directory
      `specs/g0-contracts-data-truth/` remains byte-identical (historical
      record untouched). Fix any finding, then leave ALL work uncommitted in
      the working tree for review as the planning stage requires.
      Traces: FR-DATA-001, FR-DATA-002, FR-DATA-003, FR-DATA-004, FR-DATA-005,
      FR-DATA-006, FR-DR-001, FR-DR-002.

## Traceability matrix (acceptance criterion → tasks)

| Criterion | Tasks                 | Criterion  | Tasks            |
| --------- | --------------------- | ---------- | ---------------- |
| AC-020    | T105–T107             | AC-245     | T105–T107        |
| AC-021    | T103, T105–T107, T108 | AC-246     | T105–T107        |
| AC-022    | T105–T107             | AC-247     | T103, T105–T107  |
| AC-023    | T105–T107             | AC-248     | T105–T107        |
| AC-240    | T105–T107             | AC-249     | T105–T107        |
| AC-241    | T103, T105–T107       | AC-060     | T105, T106       |
| AC-242    | T105–T107             | AC-061     | T105, T106       |
| AC-243    | T103, T105–T107       | AC-062     | T105, T106       |
| AC-244    | T105–T107             | AC-260–264 | T103, T105, T106 |

Every task above cites only the eight assigned requirements or their
acceptance criteria; no task creates trading, custody, signing, private-key,
or transaction-submission capability anywhere.
