# g0-traceability-conformance — tasks

> Every task traces at least one assigned requirement (FR-TRACE-001…006) and the shared
> acceptance criteria it advances. [P] marks a task parallelizable once its phase predecessors
> complete. Checkbox format `- [ ] T###` is parsed by the implementation task-graph builder;
> predicted writes are the backticked repo-relative paths in each body.

## Phase 1 — Foundation: package scaffolds, schemas, migration registry (blocks later phases)

- [ ] T001 Scaffold the `packages/requirement-manifest` workspace package: `package.json`
      (`@foresift/requirement-manifest`, private, type module, `"test": "bun test"`, zero
      production dependencies), `tsconfig.json` (extends `../../tsconfig.base.json`, globs
      `src/**` + `test/**`), and `src/index.ts` entrypoint. Root `package.json` +
      `pnpm-lock.yaml` workspace linkage (mechanical bookkeeping per ADR-0020). —
      **FR-TRACE-001** — AC-265
- [ ] T002 [P] Scaffold the `packages/release-conformance` workspace package the same way:
      `package.json` (workspace deps on `@foresift/requirement-manifest`,
      `@foresift/shared-schemas`, `@foresift/persistence`, `@foresift/domain`), `tsconfig.json`,
      `src/index.ts`. — **FR-TRACE-006** — AC-269
- [x] T003 Add `migrations/g0_trace_0001_trace_schema.sql` (CREATE SCHEMA trace;
      `trace.id_supersessions` insert-only ledger with namespace CHECK + single-supersession PK;
      `trace.gate_evidence` insert-only evidence rows with gate_kind/scope/approver/hash/
      signature/expiry/revocation-ref columns; `trace.refuse_mutation()` trigger on UPDATE/
      DELETE; rollback comment per migration convention) and
      `migrations/g0_trace_0002_decision_traces.sql` (`trace.decision_traces` insert-only with
      jsonb version maps, manifest_sha256, release_report_id). Extend
      `packages/persistence/src/migrator.ts` `MIGRATION_FILE_PATTERN` with the `trace` family
      AND update the central expected-script registry in
      `packages/persistence/test/migrator.spec.ts` (all assertion sites) — the plan-sanctioned
      scope exception per ADR-0019. — **FR-TRACE-002**, **FR-TRACE-004** — AC-266, AC-268
- [x] T004 [P] Add `packages/shared-schemas/src/trace.ts`: `TRACE_SCHEMA_REGISTRY_VERSION`,
      `.strict()` Zod schemas — `RequirementRefSchema` (ID-shape grammar for
      requirement/acceptance/invariant/adr namespaces), `TraceIdPatternSchema` (runtime ID
      families: feature, schema, API, tool, policy, artifact, test IDs), `SupersessionLinkSchema`,
      `GateEvidenceRecordSchema` (payload, payloadSha256, signature, gateKind, scopeRefs,
      approver, expiresAt, revokedAt), `DecisionTraceRecordSchema` (every FR-TRACE-005 dimension
      required — no defaulting), `ReleaseReportRecordSchema` (every FR-TRACE-006 field), and a
      versioned `TRACE_SCHEMAS` registry (mcp.ts precedent). Unit suite
      `packages/shared-schemas/test/trace.spec.ts` with accept/refuse matrices. —
      **FR-TRACE-002**, **FR-TRACE-005** — AC-265, AC-267, AC-268

## Phase 2 — Manifest library: load, validate, IDs, query

- [x] T005 Implement `packages/requirement-manifest/src/load.ts` + `src/validate.ts`: load
      `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json` and the
      audit artifact; verify SHA256SUMS agreement, text hashes (FR/AC/INV recomputed; ADR format
      check), PRD line anchors resolving to lines containing each ID, reference integrity
      (AC→FR, FR→AC, FR→group, INV refs, orphan checks), dependency-group DAG acyclicity, and
      four-way count agreement (manifest ↔ audit inventory ↔ audit.manifest ↔
      releaseConformance). Typed refusals in `src/errors.ts` (ForesiftError-style, domain enum
      untouched). Suite `packages/requirement-manifest/test/validate.spec.ts`. —
      **FR-TRACE-001** — AC-265
- [x] T006 [P] Implement `packages/requirement-manifest/src/ids.ts`: global uniqueness across
      the FR/AC/INV/ADR union, stable ordering (lexicographic id arrays match document order),
      ID-shape grammar per namespace, and the supersession contract — a replaced ID MUST appear
      in the `trace.id_supersessions` ledger or validation refuses (`SUPERSESSION_LINK_REQUIRED`);
      re-use of a released ID is a failure. Suite
      `packages/requirement-manifest/test/ids.spec.ts`. — **FR-TRACE-002** — AC-265, AC-266
- [x] T007 [P] Implement `packages/requirement-manifest/src/query.ts`: queries by family,
      dependency group, owner, status; AC reverse lookup; and mapping resolution for
      implementationRefs/schemaRefs/persistenceRefs/apiToolUiRefs/telemetryRefs/fixtureRefs —
      the single mapping resolver the generators and conformance checks both consume. Suite
      `packages/requirement-manifest/test/query.spec.ts`. — **FR-TRACE-001** — AC-265

## Phase 3 — Conformance library: verdicts, evidence, traces, reports, SBOM

- [x] T008 Implement `packages/release-conformance/src/conformance.ts`: FR-TRACE-003 verdicts —
      (a) every normative item has non-empty implementation/test/owner mapping;
      (b) every implementationRef whose dependency group is ACTIVE (from
      `specs/implementation/current-milestone.json`) resolves to an existing code path;
      (c) no product path of a later dependency group exists before its group gate opens;
      (d) `docs/generated/**` matches deterministic regeneration (byte comparison). Each finding
      carries the requirement id, the failing rule, and the exact path. Suite
      `packages/release-conformance/test/conformance.spec.ts`. — **FR-TRACE-003** — AC-266
- [x] T009 Implement `packages/release-conformance/src/orphans.ts`: orphan detection (product
      sources matched by no implementationRef) evaluated against the requirement-traced
      exception ledger `packages/release-conformance/src/orphan-exceptions.json` — initial
      entries for `packages/object-store/src/**` (serves the data-truth artifact/object
      substrate of the g0-contracts-data-truth package), `packages/collector-checkpoints/src/**` + `packages/collector-gap-recovery/src/**` (serve collector continuity per the
      g0-first-party-observation plan §continuity), and `apps/api` wiring files (`src/main.ts`,
      `src/index.ts`, `src/config.ts`, `src/auth/bearer.ts`, `src/auth/client-context.ts` —
      compose the g0-mcp-surface MCP surfaces declared at `apps/api/src/mcp/**`). Entries are
      additive-only; every entry names its serving requirement IDs (referenced in the ledger
      FILE, not in this task text) and a justification. Suite
      `packages/release-conformance/test/orphans.spec.ts`. — **FR-TRACE-003** — AC-266
- [x] T010 Implement `packages/release-conformance/src/gate-evidence.ts`: FR-TRACE-004
      evidence artifacts — canonical-JSON payload (approver, gateKind, scopeRefs, subject,
      issuedAt, expiresAt), SHA-256 artifact hash, HMAC-SHA256 signature under an injected
      server-side pepper, verify/evaluate API (`evaluateGateEvidence`) accepting ONLY valid
      records (unexpired against an INJECTED clock, unrevoked, scope-covering, hash- and
      signature-verifying) and refusing everything else with typed reasons; the evaluator's
      input type is the evidence record — no boolean path exists. Persistence through
      `trace.gate_evidence` (insert-only). Suite
      `packages/release-conformance/test/gate-evidence.spec.ts`. — **FR-TRACE-004** — AC-268
- [x] T011 Implement `packages/release-conformance/src/decision-trace.ts`: FR-TRACE-005 store —
      assemble a `DecisionTraceRecord` fail-closed (a record missing requirement ids, policy/
      feature/provider/adapter/artifact version maps, tool name+version, manifest hash, or
      release id is REFUSED with the missing dimension named, never defaulted), content-
      addressed `trace_id` via `canonicalJson` hashing, insert-only persistence through
      `trace.decision_traces`, and point-in-time fetch by decision_ref. Suite
      `packages/release-conformance/test/decision-trace.spec.ts` (DATABASE_PGLITE via
      coordinator). — **FR-TRACE-005** — AC-267
- [x] T012 Implement `packages/release-conformance/src/sbom.ts` +
      `src/release-report.ts`: deterministic CycloneDX-shaped SBOM projection of
      `pnpm-lock.yaml` (component name/version/hash list, sorted, no timestamps) with a
      component-inventory hash; the FR-TRACE-006 report builder recording document hash, manifest
      hash, normalized-hash CONSISTENCY check (manifest ↔ audit, provenance per plan ADR-0023),
      per-migration/schema hashes, SBOM/dependency hash, conformance results, unresolved
      deviations (exception ledger + expiring evidence), activation state (from evaluated gate
      evidence), and the tested rollback target (previous approved report reference). Byte-
      identical rebuild from identical inputs; a report verifier refuses any report with a
      missing field or disagreeing hash. Suite
      `packages/release-conformance/test/release-report.spec.ts`. — **FR-TRACE-006** — AC-269
- [x] T013 Add `packages/release-conformance/test/trace-schema-parity.spec.ts`: the Drizzle-free
      parity check enumerating `information_schema` for `table_schema = 'trace'` against a
      package-local table-shape inventory (columns, nullability, type classes, PKs) — the
      `packages/security` sec-schema precedent; `packages/persistence`'s public-schema parity
      contract untouched. — **FR-TRACE-002** — AC-266

## Phase 4 — Generators and CLIs: docs/generated/** + conformance entrypoints

- [x] T014 Implement `scripts/generate-requirement-manifest/cli.mjs` (zero runtime deps,
      plain node): `generate` writes `docs/generated/requirements.json` (canonical manifest
      projection — every requirement/AC/invariant/ADR exactly once with anchor, group, owner,
      mappings, activation gate, rollback target), all 58 `docs/generated/<family>-surfaces.json`
      files (family → surface refs, resolved implementation paths, test refs, telemetry catalog,
      schema refs; deterministic ordering, no timestamps), and
      `docs/generated/requirement-manifest.integrity.json` (load/validate verdict snapshot);
      `--check` mode regenerates in-memory and fails (exit 1) on any byte difference. Suite
      `packages/requirement-manifest/test/cli-contract.spec.ts` drives the CLI as a child
      process against fixture trees. — **FR-TRACE-001**, **FR-TRACE-003** — AC-265, AC-266
- [x] T015 Implement `scripts/verify-release-conformance/cli.mjs` (zero runtime deps): runs the
      conformance verdicts (T008/T009) + `docs/generated` drift check + release-report
      verification against the live tree; exit 0 green / exit 1 with a findings JSON naming
      requirement, rule, and path. Suite
      `packages/release-conformance/test/cli-contract.spec.ts`. — **FR-TRACE-003** — AC-266
- [x] T016 Run `scripts/generate-requirement-manifest/cli.mjs generate` to produce the real
      `docs/generated/**` set (requirements.json, 58 surfaces files, integrity snapshot) and
      verify `--check` is green on the committed output. — **FR-TRACE-001** — AC-265

## Phase 5 — Telemetry catalog + fixtures

- [x] T017 [P] Add `telemetry/trace.catalog.json` (declarative catalog: `trace.*` events —
      manifest.integrity_checked, ids.superseded, conformance.finding, gate.evidence_recorded,
      gate.evidence_refused, decision.trace_recorded, release.report_emitted — with
      requirementRefs to the FR-TRACE assignments, `contractStatus` declaring
      DECLARATIVE_CONTRACT_ONLY with G2 emitter wiring, recoveryDataClass CRITICAL_METADATA);
      package-local parity test asserting trace-catalog field names mirror
      `packages/shared-schemas/src/trace.ts` (root telemetry-catalog suite is outside this
      package's writeScopes). — **FR-TRACE-004**, **FR-TRACE-005** — AC-268, AC-267
- [x] T018 [P] Create `tests/fixtures/trace/`: `manifest-excerpt.ts` (pinned FR/AC/INV text +
      textSha256 fixtures copied from the authoritative manifest), `gate-evidence.ts`
      (deterministic HMAC test peppers, complete/incomplete evidence payloads), `decision-traces.ts`
      (complete trace + one fixture per missing dimension), `surfaces.ts` (expected surfaces-file
      shapes for drift fixtures), `release-report.ts` (PRD/manifest/lockfile hash-input
      fixtures). — **FR-TRACE-001**, **FR-TRACE-004** — AC-265, AC-268

## Phase 6 — Acceptance and negative suites (AC-265..269)

- [x] T019 [P] Author `tests/acceptance/AC-265.spec.ts` + `tests/negative/AC-265.negative.spec.ts`:
      the manifest contains every normative FR/AC/INV/ADR exactly once with document anchor,
      dependency group, owner, code/schema/surface/test/telemetry mapping, activation gate, and
      rollback target (positive, through the loader+validator against the REAL artifacts);
      negative — corrupted text hash, duplicated id, renumbered order, dangling ref, unresolved
      anchor each produce a typed refusal. — **FR-TRACE-001**, **FR-TRACE-002** — AC-265
- [x] T020 [P] Author `tests/acceptance/AC-266.spec.ts` + `tests/negative/AC-266.negative.spec.ts`:
      adding/deleting/duplicating/renumbering/changing a normative item WITH matching
      manifest/test updates passes the verifier against a fixture tree; each mutation class
      WITHOUT the matching update fails CI (exit 1) naming the drifted item and the missing
      counterpart. — **FR-TRACE-003** — AC-266
- [x] T021 [P] Author `tests/acceptance/AC-267.spec.ts` + `tests/negative/AC-267.negative.spec.ts`:
      every seeded decision/alert trace resolves to exact document/manifest hash, release,
      migration, policy, feature, model, tool, provider, pool adapter, evidence, and artifact
      versions through the store's point-in-time fetch; negative — each missing dimension (and a
      wrong-format hash) refuses with the dimension named. — **FR-TRACE-005** — AC-267
- [x] T022 [P] Author `tests/acceptance/AC-268.spec.ts` + `tests/negative/AC-268.negative.spec.ts`:
      manual/legal/rights/statistical/owner approvals accepted only from signed-or-hashed
      evidence carrying scope, approver, expiry, and revocation (all five gate kinds); negative —
      expired/revoked/out-of-scope/tampered/wrong-key evidence refuse AND an unchecked boolean
      cannot be presented to the evaluator at all (no boolean input path; type-level and
      runtime-level proof). — **FR-TRACE-004** — AC-268
- [x] T023 [P] Author `tests/acceptance/AC-269.spec.ts` + `tests/negative/AC-269.negative.spec.ts`:
      the release report documents hash, manifest hash, SBOM/dependency hash, migration/schema
      hashes, all test results, deviations, current activation scope, and tested rollback target,
      and rebuilds byte-identically; negative — missing field or drifting recorded hash refuses
      report verification. — **FR-TRACE-006** — AC-269

## Phase 7 — Convergence: full gate + traceability matrix

- [x] T024 [evidence: VERIFICATION_ONLY] [verification: TRACEABILITY_FULL_CONVERGENCE] Run the full gate: `pnpm --filter @foresift/requirement-manifest test`,
      `pnpm --filter @foresift/release-conformance test`,
      `packages/persistence/test/migrator.spec.ts` green with the extended registry,
      `scripts/verify-release-conformance/cli.mjs` exit 0, `docs/generated` `--check` green,
      then `pnpm verify` and `pnpm spec:verify` at HEAD; fix all findings additively (no amend,
      no rebase). — **FR-TRACE-001**, **FR-TRACE-003** — AC-265, AC-266
- [x] T025 [executor: COORDINATOR] [evidence: COORDINATOR_ARTIFACT] Close the traceability matrix below; confirm the material decisions of this plan
      (proposed ADR texts: read-only manifest consumption, keyed-hash gate evidence with
      structurally inexpressible booleans, normalized-hash provenance) are carried into the ADR
      process through convergence review, not as predicted writes of this package. —
      **FR-TRACE-001** — AC-265

## Traceability matrix

| Task      | Requirements                                                         | Acceptance criteria                    |
| --------- | -------------------------------------------------------------------- | -------------------------------------- |
| T001–T003 | FR-TRACE-001, FR-TRACE-002, FR-TRACE-004                             | AC-265, AC-266, AC-268                 |
| T004–T007 | FR-TRACE-001, FR-TRACE-002, FR-TRACE-005                             | AC-265, AC-266, AC-267, AC-268         |
| T008–T013 | FR-TRACE-002, FR-TRACE-003, FR-TRACE-004, FR-TRACE-005, FR-TRACE-006 | AC-266, AC-267, AC-268, AC-269         |
| T014–T018 | FR-TRACE-001, FR-TRACE-003, FR-TRACE-004, FR-TRACE-005               | AC-265, AC-266, AC-267, AC-268         |
| T019–T023 | FR-TRACE-001…FR-TRACE-006                                            | AC-265, AC-266, AC-267, AC-268, AC-269 |
| T024–T025 | FR-TRACE-001, FR-TRACE-003                                           | AC-265, AC-266                         |

## Scope exceptions (plan-sanctioned)

- `packages/persistence/src/migrator.ts` + `packages/persistence/test/migrator.spec.ts`
  (T003): ADR-0019 central migration registry duty — must be edited in the same package that
  adds `g0_trace_*.sql` scripts.
- Root `package.json` / `pnpm-lock.yaml` (T001, T002): mechanical workspace linkage of the two
  new packages (ADR-0020 bookkeeping precedent; collectible at the repo root per task-graph
  linker rules).
