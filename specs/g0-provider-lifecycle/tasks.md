# Tasks: g0-provider-lifecycle

**Input**: `specs/g0-provider-lifecycle/spec.md`, `specs/g0-provider-lifecycle/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-PROV-001 through FR-PROV-010) or an acceptance criterion of those
requirements. Requirement IDs not assigned to this package never appear here.

Format: `- [ ] T### [P?]` — **[P]** = parallelizable with its neighbors
(disjoint files). Tests are mandatory per PRD evidence rules: every acceptance
criterion listed in spec.md gets BOTH its manifest-declared positive spec
(`tests/acceptance/AC-*.spec.ts`) AND failure-path spec
(`tests/negative/AC-*.negative.spec.ts`). No task creates a real prohibited
capability anywhere outside the inert forbidden-fixture corpus under
`tests/fixtures/prov/`.

## Phase A — Enabling change and foundation (blocks everything)

- [ ] T101 Extend the migration filename-family pattern in
      `packages/persistence/src/migrator.ts` from `(data|dr|sec)` to
      `(data|dr|sec|prov)` and update its header/doc comments (plan.md material
      decision 1; content edits outside binding writeScopes are recorded as
      explicit scope exceptions at the end of this unit). Land FIRST, run
      `pnpm --filter @foresift/persistence test` and require the migrator
      suite green — including its inventory assertions updated to track the
      manifest-declared `g0_prov_*.sql` scripts this package adds.
      Planning-conflict resolution (recorded 2026-08-25): the earlier mandate
      "existing migrator suite green untouched" is unsatisfiable together with
      the product-mandated prov family extension, because
      `packages/persistence/test/migrator.spec.ts` asserts EXACTLY the set of
      discovered migration scripts; the product contract wins (FR-PROV-*), so
      that test's enumerations MUST be updated by this unit rather than left
      untouched. Out-of-scope writes REQUIRED by this unit and recorded as
      scope exceptions: `packages/persistence/test/migrator.spec.ts`
      (migration-inventory assertions), `pnpm-lock.yaml` (workspace
      lockfile mechanically follows every package scaffold, T102 included),
      and `package.json` (recorded 2026-08-26 from live guard evidence: the
      T126–T129 acceptance/negative suites run under the root unit project,
      whose devDependencies must link `@foresift/provider-lifecycle` and
      `@foresift/security` exactly like every prior G0 package's links —
      a two-line mechanical mirror, observed in run f9ed4de6 core commit
      91b9c8c), and `tests/helpers/prov.ts` (recorded 2026-08-26 from live
      guard evidence: the T126–T129 suites share prov-specific test helpers —
      injected-clock engines and fixture loaders — placed beside the already
      declared tests/acceptance/, tests/negative/, and tests/fixtures/prov/
      surfaces; observed as the sole residual violation in run ff96e2d0,
      whose full 90-path write-set was otherwise covered).
      Traces: FR-PROV-001, FR-PROV-002, FR-PROV-003, FR-PROV-008, FR-PROV-009,
      FR-PROV-010 (their declared `g0_prov_*.sql` persistence refs are
      otherwise unapplyable).
- [ ] T102 Scaffold `packages/provider-lifecycle`
      (`@foresift/provider-lifecycle`): package.json (workspace deps on
      domain/persistence/shared-schemas/security), tsconfig extending
      `tsconfig.base.json`, local `vitest.config.ts` mirroring root timeout
      budgets (plan material decision 10), `src/index.ts`. Verify that a
      workspace install regenerates the lockfile mechanically and that
      `pnpm --filter @foresift/provider-lifecycle test` runs (empty suite OK).
      Traces: FR-PROV-001…FR-PROV-010 (carrier package for the truth engine).
- [ ] T103 [P] Scaffold `packages/providers` (`@foresift/providers`)
      identically (deps: provider-lifecycle/shared-schemas/security/domain).
      Traces: FR-PROV-004, FR-PROV-005, FR-PROV-006, FR-PROV-007,
      FR-PROV-008 (adapter-layer carrier).
- [ ] T104 [P] Add `packages/shared-schemas/src/prov.ts` with the authoritative
      Zod schemas for: §15.3 operation definitions, §12.11 lifecycle states and
      legal transitions, §15.4 health statuses, verification kinds/records/TTL
      configs, migration exceptions with replacement plans, quarantine classes
      and findings, sixteen-field rights matrices + changes + artifact states +
      actions, six fingerprint kinds. Export from `src/index.ts`; add
      `test/prov.spec.ts` covering accept/refuse matrices per schema
      (`.strict()` unknown-key refusals included). Traces: FR-PROV-001,
      FR-PROV-002, FR-PROV-003, FR-PROV-008, FR-PROV-009, FR-PROV-010 (manifest
      schemaRefs target `packages/shared-schemas/src/prov.ts`).
- [ ] T105 Define `ProvErrorCode` stable machine codes in
      `packages/provider-lifecycle/src/errors.ts` following the repository
      typed-error style (precedent: security error vocabulary): registry,
      lifecycle-transition, verification-TTL, deprecation,
      migration-exception, adapter-registration, allowlist-enforcement,
      response-quarantine, rights-change, fingerprint, and readiness refusal
      classes. Traces: FR-PROV-001 through FR-PROV-010 (typed fail-closed
      error contract for every gate; Constitution VIII/XII).
- [ ] T106 Write the five migrations `g0_prov_0001_provider_operations.sql`,
      `g0_prov_0002_verification_ttl.sql`,
      `g0_prov_0003_migration_exceptions.sql`, `g0_prov_0004_quarantine.sql`,
      `g0_prov_0005_rights_fingerprints.sql` exactly per plan.md Data Model
      (SQL immutability triggers on the append-only transition ledger,
      CHECK-constrained state/capability/cost/quarantine/rights alphabets with
      prohibited capability values unrepresentable, idempotency unique indexes,
      no payload-body column in quarantine), plus their Drizzle mirrors under
      `packages/provider-lifecycle/src/generated/` parity-tested against
      information_schema. Migrations must apply cleanly over a fully migrated
      PGlite database containing all proven data/dr/sec sets. Traces:
      FR-PROV-001, FR-PROV-002, FR-PROV-003, FR-PROV-008, FR-PROV-009,
      FR-PROV-010 (table owners).
- [ ] T107 [P] Write `telemetry/prov.catalog.json` in the established
      declarative catalog format: events for operation registered, lifecycle
      transitioned/refused, verification expired/refreshed, deprecation
      detected/sunset incident raised, migration exception granted/expired,
      response quarantined, rights changed/use blocked/action executed,
      readiness blocked, fingerprint captured — each with requirementRefs into
      this package and field lists mirroring the prov schemas exactly.
      Traces: FR-PROV-001, FR-PROV-002, FR-PROV-003, FR-PROV-008, FR-PROV-009,
      FR-PROV-010 (manifest telemetryRefs `telemetry/prov.*`).

## Phase B — Registry and lifecycle core

- [ ] T108 Implement `src/lifecycle-states.ts`: the seven-state alphabet as
      types plus the legal-transition graph (DISCOVERED→VERIFIED→ACTIVE;
      ACTIVE⇄DEGRADED; →DEPRECATED/BLOCKED/REMOVED terminal semantics) with a
      completeness test asserting graph, SQL CHECK constraints, and Zod schema
      agree exactly. Traces: FR-PROV-001.
- [ ] T109 Implement `src/operation-registry.ts`: versioned definition storage
      over `prov_operations` (every §15.3 field), affected-feature dependency
      registration over `prov_operation_dependencies`, and registration-time
      validation refusing prohibited capability classes outright.
      Traces: FR-PROV-001, FR-PROV-004.
- [ ] T110 Implement `src/lifecycle-machine.ts` + `src/audit-bridges.ts`:
      guarded transitions validating the legal graph, requiring reason classes,
      appending to the immutable `prov_lifecycle_events` ledger with
      idempotency-key dedupe so retries cannot double-append, projecting
      current state, and emitting every critical transition through the
      security AuditChain bridge (provider/blocked-operation action classes);
      expiry-driven exits from ACTIVE never mutate stored historical evidence.
      Traces: FR-PROV-001.

## Phase C — Verification TTLs, deprecation, exceptions

- [ ] T111 Implement `src/verification-ttl.ts`: the nine verification kinds,
      per-kind/per-provider TTL configuration, use-time freshness evaluation
      (injected ClockPort only), sweep transitions mapping expired kinds to the
      §15.4 health outcomes (PLAN_UNVERIFIED / RIGHTS_UNVERIFIED / DEGRADED)
      and out-of-ACTIVE lifecycle events, and the AC-270 refresh pair rule:
      active decision use resumes ONLY after BOTH an OFFICIAL_DOC and a
      LIVE_CONTRACT verification of the lapsed kind succeed within TTL.
      Traces: FR-PROV-002, FR-PROV-001 (expiry transitions).
- [ ] T112 Implement `src/deprecation-rules.ts`: `deprecatedAt` blocks new
      feature-dependency registration unless a valid exception exists; sunset
      dates and official deprecation notices raise incidents through the
      security incidents API with migration deadlines; refusal when a
      deprecated operation is the sole registered source for a critical field;
      STRICT_FREE availability requires current proven plan verification
      (plan-gated ops unavailable on free plans surface disabled metadata).
      Traces: FR-PROV-003, FR-PROV-007.
- [ ] T113 Implement `src/migration-exceptions.ts`: grant/revoke time-bounded
      exceptions bound to replacement-plan references and approvers; use-time
      expiry evaluation re-blocks automatically the moment an exception lapses
      (fail-closed; no grace windows). Traces: FR-PROV-003.

## Phase D — Adapter framework and reference adapters

- [ ] T114 Implement `packages/providers/src/fetch-port.ts` +
      `src/adapter-contract.ts`: injectable HTTP transport seam (no global
      fetch in decision paths), exact per-adapter allowlist descriptors
      enforcing scheme/host/port/path template/method/content types/request
      fields/response schema/redirect policy/max bytes/DNS+IP policy by
      composing the security EgressGuard with an adapter-level
      request/response validation layer — deny-by-default typed refusals on
      every undeclared dimension. Traces: FR-PROV-005.
- [ ] T115 Implement `src/registration.ts`: adapter registration validates
      declared operations against the capability-class vocabulary, REFUSES
      prohibited classes and wholesale multi-operation bundle exposure,
      attaches negativeCapabilities metadata to every registered operation for
      the scan surfaces, and refuses adapters whose catalog entries lack
      allowlist descriptors. Traces: FR-PROV-004.
- [ ] T116 Write `src/operation-catalogs/gmgn.catalog.ts` +
      `src/adapters/gmgn-adapter.ts`: the strictly query-only GMGN operation
      set with an exposed-operation enumeration contract test that FAILS if
      any trading-related operation ever appears; clean recorded query
      fixtures flow end-to-end through allowlist + validation layers.
      Traces: FR-PROV-006.
- [ ] T117 Write `src/operation-catalogs/helius.catalog.ts` +
      `src/adapters/helius-adapter.ts` + `src/helius-decoding.ts`: raw
      getTransaction and standard signature-history operations separated from
      LOCAL supported-program decoding; the deprecated enhanced-parser entry
      marked DEPRECATED/non-authoritative and usable only under a valid
      migration exception; plan-gated history operation flagged unavailable on
      free plans (disabled for STRICT_FREE consumption). Traces: FR-PROV-007.
- [ ] T118 Wire the landed decoder-authority validator to THIS package's real
      registry entries and prove both directions in a package suite: the
      normative raw/history-plus-local-decoding configuration passes against
      real catalog data; enhanced-parser-as-sole/authoritative configurations
      are refused using the actual deprecated entry. Traces: FR-PROV-007.

## Phase E — Quarantine, rights, fingerprints, readiness

- [ ] T119 Implement `src/response-quarantine.ts`: content scanner detecting
      all five malicious-response classes (transaction payload, signing
      request, executable instruction, private-key field, unexpected write
      capability); rejected responses produce metadata-only quarantine records
      (classes, field paths, sha256, byte size — never payload material),
      audited through the chain bridge, and hard-excluded from model-context
      envelopes via the untrusted-content integration hook; transaction-building
      output fields stripped before any persistence. Traces: FR-PROV-008.
- [ ] T120 Implement `src/rights-matrix.ts`: sixteen-field versioned rights
      declarations, change-diff engine producing newly-prohibited-use sets
      across cache/raw-retention/export/redistribution/model-use/storage/
      derived paths, and the immediate fail-closed decision API evaluated
      against the rights version captured at artifact ingestion.
      Traces: FR-PROV-009.
- [ ] T121 Implement `src/artifact-registry.ts`: capture-time registration of
      persisted provider-derived artifacts (object ref, operation version,
      rights version); on a tightening change, enumeration of affected
      artifacts into QUARANTINE|RETIRE actions recorded durably; loosening a
      right never silently reactivates paths without reverification.
      Traces: FR-PROV-009.
- [ ] T122 Implement `src/source-fingerprints.ts`: capture and versioned
      storage of the six fingerprint kinds (upstream lineage, value
      correlation, timing behavior, outage correlation, schema
      characteristics, first-seen behavior) as canonical JSON with
      estimator-input references for the future dependence estimator.
      Traces: FR-PROV-010.
- [ ] T123 Implement `src/readiness.ts`: the AC-272 provider-side activation-
      readiness evaluator aggregating rights verification state, lifecycle
      state, verification freshness, migration-exception validity, and
      prohibited-operation exposure into ELIGIBLE or BLOCKED-with-typed-reasons
      consumed by the future workspace/public gate. Traces: FR-PROV-009,
      FR-PROV-002, FR-PROV-003, FR-PROV-004.

## Phase F — Documentation and fixture corpus

- [ ] T124 Write `docs/provider-rights/rights-matrix-register.md` (declared
      matrices per provider family, field semantics, terms-version tracking),
      `rights-change-runbook.md` (tightening drill: block paths, enumerate
      artifacts, execute actions, verify), and
      `adapter-onboarding-and-verification.md` (definition → verification →
      activation checklist with every fail-closed gate). Traces: FR-PROV-009
      (register/runbook), FR-PROV-002, FR-PROV-005 (onboarding gates).
- [ ] T125 Create `tests/fixtures/prov/`: sanitized recorded responses per
      adapter operation (positive controls) and the inert forbidden corpus —
      malicious-response class samples (fake private-key marker, transaction-
      payload skeleton, signing-request skeleton, executable-instruction
      sample, write-capability indicator), GMGN trading-shaped definition
      variants, Helius enhanced-parser fixtures, TTL-expiry and rights-change
      scenario data. All inert by construction (declarative data only, no
      imports, no executable content) and covered by the documented
      fixture-corpus exclusion from production scans. Traces: FR-PROV-006,
      FR-PROV-007, FR-PROV-008, FR-PROV-002, FR-PROV-009.

## Phase G — Manifest-declared acceptance suites (NEW pairs)

- [ ] T126 Write `tests/acceptance/AC-270.spec.ts` (active operation →
      injected-clock expiry of documentation/rights/schema verification moves
      it out of active decision-critical use → official-doc AND live-contract
      refresh restores use) and `tests/negative/AC-270.negative.spec.ts`
      (partial single-source refresh refused; wrong-kind refresh refused;
      stale pre-expiry verification does not satisfy; lapsed migration
      exceptions re-block). Traces: FR-PROV-002, FR-PROV-003, FR-PROV-001.
- [ ] T127 Write `tests/acceptance/AC-271.spec.ts` (sanitized clean responses
      flow to evidence envelopes with audit entries) and
      `tests/negative/AC-271.negative.spec.ts` (each malicious-response class
      rejected + quarantined + audited + excluded from model context;
      payload-byte absence assertion for the private-key-field fixture;
      stripped transaction-building fields never persist). Traces:
      FR-PROV-008.
- [ ] T128 Write `tests/acceptance/AC-272.spec.ts` (fully verified rights +
      healthy lifecycle + zero prohibited exposure yields ELIGIBLE readiness
      for the future workspace/public gate) and
      `tests/negative/AC-272.negative.spec.ts` (rights-unverified,
      expired-verification, deprecated-without-valid-exception, and
      prohibited-exposure states each hold BLOCKED with typed reasons).
      Traces: FR-PROV-009, FR-PROV-002, FR-PROV-003, FR-PROV-004.
- [ ] T129 Write `tests/acceptance/AC-273.spec.ts` (rights tightening
      immediately flips use decisions to refuse for newly prohibited
      cache/raw-retention/export/redistribution/model-use paths and enumerates
      existing affected artifacts into quarantine/retire actions) and
      `tests/negative/AC-273.negative.spec.ts` (post-change attempts on now-
      prohibited paths refused; enumeration complete with no silent retention;
      loosening does not reactivate without reverification). Traces:
      FR-PROV-009.

## Phase H — Convergence verification

- [ ] T130 Run the two milestone verification commands declared for this
      package in `specs/implementation/current-milestone.json` (the
      provider-lifecycle package suite and the providers package suite) — all
      green at HEAD. The exact command strings are reproduced in the fenced
      block at the end of this file; run them verbatim from the repository
      root. Traces: FR-PROV-001 through FR-PROV-010 (package-wide proof).
- [ ] T131 Run `pnpm verify` (= spec:verify, format:check, lint, typecheck,
      full tests) and require green at HEAD; prove the fourteen
      manifest-declared AC test files exist and pass — including the four NEW
      pairs landed here — with the ten shared suites (AC-250…259) untouched
      and still green as the regression guard; confirm migrations apply over
      the full proven migration set. Anything red is classified per
      governance and fixed ONLY within writeScopes (plus the single justified
      migrator change); everything else goes to out-of-scope notes. Traces:
      FR-PROV-001 through FR-PROV-010.
- [ ] T132 Scope-and-boundary guard: `git status`/`git diff` versus base shows
      changes ONLY inside binding writeScopes plus the justified
      `packages/persistence/src/migrator.ts` pattern extension and mechanical
      lockfile regeneration; grep the delivered tree (excluding sanctioned
      fixture corpora) with the project's own prohibited-capability scanner
      and require clean; confirm no payload/key material exists in quarantine
      storage paths or fixtures. Traces: FR-PROV-001 through FR-PROV-010
      (read-only boundary permanence).
- [ ] T133 Cross-artifact consistency sweep: scoped artifacts free of template
      placeholders; every task above traces only assigned requirements of this
      package; work committed additively in coherent units so the stage never
      ends on a dirty tracked tree; corrections land as new commits; product
      source reaches main only via CI-gated PRs. Traces: FR-PROV-001 through
      FR-PROV-010.

## Traceability matrix (AC → tasks)

| AC     | Tasks                              |
| ------ | ---------------------------------- |
| AC-250 | T131 (regression guard)            |
| AC-251 | T131 (regression guard)            |
| AC-252 | T131 (regression guard)            |
| AC-253 | T131 (regression guard)            |
| AC-254 | T109, T115, T125, T131             |
| AC-255 | T116, T125, T131                   |
| AC-256 | T112, T117, T118, T125, T131       |
| AC-257 | T114, T116, T117, T125, T131       |
| AC-258 | T119, T131                         |
| AC-259 | T106, T110, T119, T120, T121, T131 |
| AC-270 | T106, T107, T111, T126, T131       |
| AC-271 | T106, T119, T125, T127, T131       |
| AC-272 | T123, T128, T131                   |
| AC-273 | T106, T120, T121, T129, T131       |

Every phase closes with its focused checks green before later phases begin.
No task creates trading, custody, signing, private-key, or
transaction-submission capability anywhere (permanent read-only boundary);
no task edits anything outside the binding writeScopes except the single
justified migrator pattern extension recorded in plan.md material decision 1
and the mechanical lockfile regeneration.

## Milestone verification commands (referenced by T130; run verbatim)

```sh
test -d packages/provider-lifecycle && pnpm --filter @foresift/provider-lifecycle test
test -d packages/providers && pnpm --filter @foresift/providers test
```
