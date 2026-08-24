# Tasks: g0-contracts-data-truth (generation 1 mirror)

**Input**: `specs/g0-contracts-data-truth/spec.md`, `specs/g0-contracts-data-truth/plan.md`
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

## Convergence iteration g1 (2026-08-24) — PR #46 comprehensive-review repair

Review verdict was REQUEST_CHANGES (3 CRITICAL / 15 HIGH / 37 MEDIUM / 54 LOW).
Every CRITICAL and HIGH item with a recommended fix option is addressed below;
behavior-change MEDIUMs marked "fix now recommended" by the review are also
implemented. All work is additive conventional commits inside the binding
writeScopes; focused verification ran after every change (typecheck zero
errors; domain 47, shared-schemas 24, object-store 21, persistence 157,
evidence 9, acceptance+negative 180 tests green).

Completed this iteration:

- [x] T111 C1 — `packages/domain/vitest.config.ts` added so
      `pnpm --filter @foresift/domain test` collects `test/**/*.spec.ts`
      (44 existing + 3 new tests now execute under a runner); plus the
      typecheck repairs its first run surfaced (branded `ChainId` construction
      in the new identity spec; pad-index writes made `noUncheckedIndexedAccess`-
      safe via the module's own `byteAt` guard). Traces: FR-DATA-001,
      FR-DATA-002, FR-DATA-003, FR-DATA-004, FR-DATA-005, FR-DATA-006,
      FR-DR-001, FR-DR-002 (their foundation layer is regression-covered).
- [x] T112 C2 — revision no-backdating enforced at BOTH layers: BEFORE INSERT
      trigger `observation_revisions_no_backdating` (migration
      `g0_data_0002`) refusing `available_at < anchor.available_at`, typed
      app guard `REVISION_BACKDATING_REJECTED` in `appendRevision`, and
      violation tests at each layer including the boundary-equal instant.
      Traces: FR-DATA-002, FR-DATA-003 (§13.6 provenance corruption guard).
- [x] T113 C3 — insert-or-verify identity semantics asserted: identical chain
      re-registration reports `inserted:false`; conflicting re-registration
      refuses `CONTRACT_INVARIANT_VIOLATED`; launch instants compare by epoch,
      not ISO text shape (`…00Z` ≡ `…00.000Z`). Traces: FR-DATA-001.
- [x] T114 H1 — Keccak-256 final-block padding XOR-merges domain byte and
      closing bit (lengths ≡ 135 mod 136 previously diverged); regression
      vectors at lengths 0/134/135/136/271/272 against an independently
      validated reference. Traces: FR-DATA-001 (EIP-55 checksum substrate).
- [x] T115 H2 — object-store metadata reads narrow absence to `ENOENT` only;
      corrupt meta JSON now surfaces as a fault (with test) instead of
      fabricating MISSING for intact bytes. Traces: FR-DR-002.
- [x] T116 H3 — `attachMembership` routes through `insertOrVerify`: identical
      re-attach is a no-op reporting honestly; re-pointing a representation
      between asset groupings refuses as a typed conflict (test asserts the
      original membership survives). Traces: FR-DATA-001.
- [x] T117 remaining HIGH schema/test gaps — `.strict()` unknown-key sweep
      over every registered DATA_SCHEMAS fixture; `ChainIdSchema`
      accept/refuse matrix plus unknown-namespace fail-closed witness;
      `DigitStringSchema` refusal battery; BackfillReceiptSchema §13.6
      three-conjunct coverage incl. live-receipt-reference admission;
      deterministic replay tie-break exercised through the persistence
      consumer (equal availability resolves highest revision, insertion order
      irrelevant); `multiplyDecimalStrings` explicit-truncation and signed-
      rendering coverage. Traces: FR-DATA-002, FR-DATA-003, FR-DATA-001
      (§11.5 quantity policy).
- [x] T118 documentation rot — stale ADR citations renumbered to their true
      targets (ADR-0014 PGlite engine, ADR-0015 recovery mechanism) across
      db.ts/drill specs/helpers comments; ADR-0016 self-title fixed; README
      status block and layout refreshed to match repository reality. Traces:
      FR-DR-001, FR-DR-002 (accurate decision records), all FRs (honest docs).
- [x] T119 fail-closed behavior repairs (review MEDIUMs marked fix-now) —
      acquisition completion-vs-request ordering compares epoch ms, not ISO
      text (mixed sub-second precision accepted/refused correctly; both
      directions pinned by tests); drill `achievedMinutes` REFUSES
      negative/non-finite timeline deltas (`DRILL_TIMELINE_INVALID`, new code)
      instead of clamping impossible timelines to HEALTHY (+tests);
      `advanceWatermark` gains a monotonicity guard over the three slot
      high-water marks (`WATERMARK_REGRESSION_REJECTED`, new code, row locked
      FOR UPDATE; gap windows excluded since they legitimately open/close)
      with regression-refusal + state-intact + idempotent-re-advance tests.
      Traces: FR-DATA-005 (acquisition §13.8), FR-DR-001 (§34.9 measurement
      honesty), FR-DATA-002 (watermarks §13.5 truthfulness).
- [x] T120 remaining HIGH test-presence gaps — snapshot bytes re-imported
      into a fresh migrated database replay byte-for-byte (manifest hash AND
      bytes identical; PITR-style replica-role replay documented in-test);
      TransactionalEngine depth-0 atomicity and savepoint-scoped nesting now
      violation-tested (`engine-transactions.spec.ts`); `recordPair` +
      `pairs` table presence incl. `pairs_distinct_sides` CHECK witness and
      insert-or-verify conflict semantics. Traces: FR-DR-002 (restore
      fidelity), FR-DATA-001..FR-DATA-006 (engine substrate integrity).

Unresolved, recorded explicitly for follow-up iterations:

- [x] T121 Migrator defenses remain unimplemented (missing-file detection,
      out-of-order application refusal, concurrent-run fencing, `g1_*`
      filename support currently silently ignored). The review itself files
      this as a P1 follow-up design decision rather than a convergence
      repair; deferring keeps this iteration inside review-repair scope.
      Traces: FR-DATA-001…FR-DATA-006, FR-DR-001, FR-DR-002 (migration
      integrity substrate they run on).
- [x] T122 Comment-level MEDIUM/LOW catalog from the consolidated review
      artifacts (decision-needed items such as recovery_health_states.incident
      FK enforcement, red-gate header wording, correlated-providers fixture
      consumption, ~50 further single-line comment corrections). None affects
      behavior or weakens verification; recorded so nothing is silently lost.
      Traces: FR-DATA-001…FR-DATA-006, FR-DR-001, FR-DR-002 (documentation
      accuracy for their implemented behavior).
