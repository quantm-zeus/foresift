# Tasks: g0-contracts-data-truth@g1

**Input**: `specs/g0-contracts-data-truth@g1/spec.md`, `specs/g0-contracts-data-truth@g1/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-DATA-001, FR-DATA-002, FR-DATA-003, FR-DATA-004, FR-DATA-005, FR-DATA-006,
FR-DR-001, FR-DR-002) or an acceptance criterion of those requirements.
Requirement IDs not assigned to this package never appear here.

Format: `- [ ] T### [P?]` — **[P]** = parallelizable with its neighbors (disjoint files).
Generation-1 context: the generation-0 implementation is present as the adopted
seed and is byte-identical to its review-repaired tip everywhere except four root
configuration files; these tasks converge the tree to green without regenerating
any correct existing work. Tests are mandatory per PRD evidence rules: positive
AND negative/failure-path specs already exist for every acceptance criterion
listed in spec.md §3 and must stay green — never weakened.

## Phase A — Restore glob-driven root configuration (the lost convergence deltas)

- [ ] T101 Rewrite root `tsconfig.json` to the converged shape: `"include":
["packages/*/src/**/*.ts", "packages/*/test/**/*.ts", "tests/**/*.ts"]` and
      `"exclude": ["node_modules", "dist"]`, keeping `rootDir: "."`, `noEmit: true`,
      and the existing types array. This restores the config-shape contract proven by
      `tests/acceptance/tooling-globs.spec.ts` (synthetic future-package paths must be
      covered). Traces: foundation enabling FR-DATA-001, FR-DATA-002, FR-DATA-003,
      FR-DATA-004, FR-DATA-005, FR-DATA-006, FR-DR-001, FR-DR-002 verification
      (package objective: glob-driven root tooling).
- [ ] T102 Add `"allowImportingTsExtensions": true` to `tsconfig.base.json`
      compilerOptions (valid because every tsconfig in the repo sets `noEmit:
true`). This resolves all 105 TS5097 errors against the repository's
      consistent `.ts`-extension import convention. Do not rewrite any import
      statements. Traces: FR-DATA-001 through FR-DATA-006 and FR-DR-001,
      FR-DR-002 (their suites must compile).
- [ ] T103 [P] Add to `pnpm-workspace.yaml`:
      `minimumReleaseAgeExclude:` list containing `'@electric-sql/pglite@0.5.6'`
      (mechanically emitted pnpm entry; keeps deterministic test-engine installs
      resolvable under the release-age policy). Traces: FR-DR-001, FR-DR-002
      (deterministic drill/test engine availability).
- [ ] T104 Align root `package.json` devDependencies ordering with the converged
      state and run `pnpm install` so `pnpm-lock.yaml` regenerates mechanically
      (no hand edits to the lockfile). KEEP the newer main-postdating scripts
      (`autopilot:restart-package`, `test:unit`, `test:integration`) — they are
      shared automation, not this package's delta; removing them is forbidden.
      Traces: FR-DATA-001 through FR-DATA-006, FR-DR-001, FR-DR-002
      (workspace resolution for their five packages).

## Phase B — Deterministic convergence verification

- [ ] T105 Run `pnpm typecheck`; require exactly zero errors. If any non-TS5097
      error appears, stop and classify before proceeding (it indicates a defect
      beyond the restored configs). Traces: FR-DATA-001, FR-DATA-002, FR-DATA-003,
      FR-DATA-004, FR-DATA-005, FR-DATA-006, FR-DR-001, FR-DR-002 (compile
      integrity of every requirement's code and tests).
- [ ] T106 Run the config-shape acceptance suite (`npx vitest run
tests/acceptance/tooling-globs.spec.ts`) and require all four assertions
      green (future-package include globs, exclude array, workspace globs,
      eslint flat-config globs). Traces: FR-DATA-001 through FR-DATA-006,
      FR-DR-001, FR-DR-002 (glob-driven tooling objective).
- [ ] T107 Run the package verification commands from
      `specs/implementation/current-milestone.json`: `test -d packages/shared-schemas &&
pnpm --filter @foresift/shared-schemas test`, and the same for
      `@foresift/persistence`, `@foresift/evidence`, `@foresift/object-store`.
      All green required. Traces: FR-DATA-001, FR-DATA-002, FR-DATA-005,
      FR-DATA-006 (identity/observation/quality/source repos), FR-DATA-003,
      FR-DATA-004 (replay/features), FR-DR-001, FR-DR-002 (drill harness),
      including acceptance criteria AC-020…AC-023, AC-240…AC-249, AC-060…AC-062,
      AC-260…AC-264 exercised by those suites.
- [ ] T108 Run the full aggregate gate `pnpm verify` (= spec:verify, format:check,
      lint, typecheck, all tests) and require green at HEAD. The three previously
      failing automation e2e specs (`tests/automation/targeted-router-e2e.spec.ts`,
      `tests/automation/gate-e2e-green.spec.ts`, `tests/automation/gate-e2e-red.spec.ts`)
      are expected to return green because their child processes run
      `pnpm typecheck`; if any stays red after Phases A–B, do NOT edit it
      (`tests/automation/**` is outside writeScopes): classify the failure per
      governance, record it in the run's out-of-scope notes, and report honestly.
      Traces: FR-DATA-001 through FR-DATA-006, FR-DR-001, FR-DR-002 (full-suite
      proof of all their acceptance criteria).
- [ ] T109 Divergence guard: `git diff` between this branch HEAD and generation-0
      review-repaired tip `3367821` restricted to the package write scopes must
      show ONLY the intended Phase-A deltas plus mechanical lockfile changes;
      verify all 44 manifest-declared test files for the eight requirements still
      exist on disk. Traces: FR-DATA-001, FR-DATA-002, FR-DATA-003, FR-DATA-004,
      FR-DATA-005, FR-DATA-006, FR-DR-001, FR-DR-002 (no silent loss of reviewed
      implementation).
- [ ] T110 Cross-artifact consistency sweep: scoped artifacts free of template
      placeholders; every task above traces only assigned requirement IDs;
      working tree left UNCOMMITTED for review (landing happens via PR after
      machine gates). Traces: FR-DATA-001, FR-DATA-002, FR-DATA-003, FR-DATA-004,
      FR-DATA-005, FR-DATA-006, FR-DR-001, FR-DR-002.

## Traceability matrix (AC → tasks)

| AC     | Tasks            |
| ------ | ---------------- |
| AC-020 | T105–T108        |
| AC-021 | T105–T108        |
| AC-022 | T105–T108        |
| AC-023 | T105–T108        |
| AC-240 | T105, T107, T108 |
| AC-241 | T105, T107, T108 |
| AC-242 | T105, T107, T108 |
| AC-243 | T105, T107, T108 |
| AC-244 | T105, T107, T108 |
| AC-245 | T105, T107, T108 |
| AC-246 | T105, T107, T108 |
| AC-247 | T105, T107, T108 |
| AC-248 | T105, T107, T108 |
| AC-249 | T105, T107, T108 |
| AC-060 | T105, T107, T108 |
| AC-061 | T105, T107, T108 |
| AC-062 | T105, T107, T108 |
| AC-260 | T105, T107, T108 |
| AC-261 | T105, T107, T108 |
| AC-262 | T105, T107, T108 |
| AC-263 | T105, T107, T108 |
| AC-264 | T105, T107, T108 |

Every phase closes with its checks green before later phases begin. No task
creates trading, custody, signing, private-key, or transaction-submission
capability anywhere (INV-001); no task edits anything outside the binding
writeScopes except the justified mechanical lockfile regeneration recorded in
plan.md.
