# Tasks: g0-contracts-data-truth@g1

**Input**: `specs/g0-contracts-data-truth@g1/spec.md`, `specs/g0-contracts-data-truth@g1/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-DATA-001, FR-DATA-002, FR-DATA-003, FR-DATA-004, FR-DATA-005, FR-DATA-006,
FR-DR-001, FR-DR-002) or an acceptance criterion of those requirements.
Requirement IDs not assigned to this package never appear here.

Format: `- [ ] T### [P?]` — **[P]** = parallelizable with its neighbors (disjoint files).
Generation-1 context (re-baselined 2026-08-24 at HEAD `0adb46b`): Phase A below
is COMPLETE and committed on this branch as `0ee8f42` — root-config parity with
the review-repaired generation-0 tip (`3367821`) is restored (`tsconfig.json`,
`tsconfig.base.json`, `pnpm-workspace.yaml` byte-identical; `package.json`
differs only by three intentionally kept newer shared-automation scripts), plus
four package-local vitest runner configs enabling the milestone per-package
verification commands. A second automation-only absorb of main (`0adb46b`)
touched nothing inside this package's write scopes. Re-verified at that HEAD:
typecheck GREEN (zero errors), full suite GREEN (64 files / 448 tests). The
remaining work is the final gate re-run at whatever HEAD implementation finds,
plus any strictly in-scope regression fix it surfaces.
Tests are mandatory per PRD evidence rules: positive AND negative/failure-path
specs already exist for every acceptance criterion listed in spec.md §3 and
must stay green — never weakened.

## Phase A — Restore the remaining root-configuration deltas (COMPLETE — landed at commit `0ee8f42`)

- [x] T101 Verify root `tsconfig.json` retains the converged shape restored by
      main's absorbed commit `ac67972`: `"include": ["packages/*/src/**/*.ts",
"packages/*/test/**/*.ts", "tests/**/*.ts"]`, `"exclude": ["node_modules",
"dist"]`, keeping `rootDir: "."`, `noEmit: true`, and the existing types
      array. Restore only if drifted; do not redesign. This preserves the
      config-shape contract proven by `tests/acceptance/tooling-globs.spec.ts`
      (synthetic future-package paths must be covered). Traces: foundation
      enabling FR-DATA-001, FR-DATA-002, FR-DATA-003, FR-DATA-004, FR-DATA-005,
      FR-DATA-006, FR-DR-001, FR-DR-002 verification (package objective:
      glob-driven root tooling).
- [x] T102 Verify `"allowImportingTsExtensions": true` is present in
      `tsconfig.base.json` compilerOptions (valid because every tsconfig sets
      `noEmit: true`) and align its position with the reviewed tip (immediately
      after `moduleResolution`; cosmetic ordering only). Never rewrite any
      import statement — the `.ts`-extension convention is repository style.
      Traces: FR-DATA-001 through FR-DATA-006 and FR-DR-001, FR-DR-002 (their
      suites must compile).
- [x] T103 [P] Add to `pnpm-workspace.yaml`:
      `minimumReleaseAgeExclude:` list containing `'@electric-sql/pglite@0.5.6'`
      (mechanically emitted pnpm entry restoring byte-parity with the reviewed
      tip; keeps deterministic test-engine installs resolvable under a release-
      age policy). Traces: FR-DR-001, FR-DR-002 (deterministic drill/test
      engine availability).
- [x] T104 Align root `package.json` devDependencies ordering with the reviewed
      tip (workspace packages before `@types/*`) and run `pnpm install` so
      `pnpm-lock.yaml` regenerates mechanically (no hand edits to the lockfile).
      KEEP the newer main-postdating scripts (`autopilot:restart-package`,
      `test:unit`, `test:integration`) — they are shared automation, not this
      package's delta; removing them is forbidden. Traces: FR-DATA-001 through
      FR-DATA-006, FR-DR-001, FR-DR-002 (workspace resolution for their five
      packages).

## Phase B — Deterministic convergence verification

- [x] T105 Run `pnpm typecheck`; require exactly zero errors at the current
      HEAD (green at the re-baselined HEAD `0adb46b`). If any new error class
      appears, stop and classify before proceeding. Traces: FR-DATA-001,
      FR-DATA-002, FR-DATA-003, FR-DATA-004, FR-DATA-005, FR-DATA-006,
      FR-DR-001, FR-DR-002 (compile integrity of every requirement's code and
      tests).
- [x] T106 Run the config-shape acceptance suite (`npx vitest run
tests/acceptance/tooling-globs.spec.ts`) and require all four assertions
      green (future-package include globs, exclude array, workspace globs,
      eslint flat-config globs). Traces: FR-DATA-001 through FR-DATA-006,
      FR-DR-001, FR-DR-002 (glob-driven tooling objective).
- [x] T107 Run the package verification commands from
      `specs/implementation/current-milestone.json`: `test -d packages/shared-schemas &&
pnpm --filter @foresift/shared-schemas test`, and the same for
      `@foresift/persistence`, `@foresift/evidence`, `@foresift/object-store`.
      All green required. Traces: FR-DATA-001, FR-DATA-002, FR-DATA-005,
      FR-DATA-006 (identity/observation/quality/source repos), FR-DATA-003,
      FR-DATA-004 (replay/features), FR-DR-001, FR-DR-002 (drill harness),
      including acceptance criteria AC-020…AC-023, AC-240…AC-249, AC-060…AC-062,
      AC-260…AC-264 exercised by those suites.
- [x] T108 Run the full aggregate gate `pnpm verify` (= spec:verify, format:check,
      lint, typecheck, all tests) and require green at HEAD (64 files / 448
      tests at the re-baselined HEAD `0adb46b`, including
      `tests/automation/targeted-router-e2e.spec.ts`,
      `tests/automation/gate-e2e-green.spec.ts`,
      `tests/automation/gate-e2e-red.spec.ts`; counts may grow if main's
      absorbed tooling adds suites — growth alone is not a failure). If
      anything turns red, do NOT edit `tests/automation/**` (outside
      writeScopes): classify the failure per governance, fix only what falls
      inside writeScopes, record the rest in the run's out-of-scope notes, and
      report honestly. Traces: FR-DATA-001 through FR-DATA-006,
      FR-DR-001, FR-DR-002 (full-suite proof of all their acceptance criteria).
- [x] T109 Divergence guard: within package content scopes (`packages`,
      `migrations`, `telemetry`, `tests/fixtures`, `tests/acceptance`,
      `tests/negative`) `git diff` versus generation-0 review-repaired tip
      `3367821` may show ONLY the four documented per-package vitest runner
      configs added by `0ee8f42`; within root-config scopes it must show ONLY
      the three intentionally kept newer shared-automation scripts in
      `package.json` plus mechanical lockfile changes (differences elsewhere
      are main's shared tooling absorbed onto this branch, not this package's
      delta); verify all 44 manifest-declared test files for the eight
      requirements still exist on disk. Traces: FR-DATA-001, FR-DATA-002,
      FR-DATA-003, FR-DATA-004, FR-DATA-005, FR-DATA-006, FR-DR-001, FR-DR-002
      (no silent loss of reviewed implementation).
- [x] T110 Cross-artifact consistency sweep: scoped artifacts free of template
      placeholders; every task above traces only assigned requirement IDs;
      both scoped-artifact directories (`specs/g0-contracts-data-truth/`,
      `specs/g0-contracts-data-truth@g1/`) carry identical trios per plan.md
      material decision 4; converged work is committed additively on the
      package branch so the stage never ends on a dirty tracked tree —
      `create-pr` refuses a dirty tree and the implementation completion gate
      requires a committed one (plan.md material decision 6); corrections are
      new commits, never amend/rebase/force, and product source reaches main
      only via CI-gated PRs. Traces: FR-DATA-001, FR-DATA-002,
      FR-DATA-003, FR-DATA-004, FR-DATA-005, FR-DATA-006, FR-DR-001, FR-DR-002.

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
