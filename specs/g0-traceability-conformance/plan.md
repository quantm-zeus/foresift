# g0-traceability-conformance — implementation plan

> Subordinate to `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md` and
> `specs/g0-traceability-conformance/spec.md` (the scoped requirement derivative this plan
> implements).

## Summary

Build the traceability and release-conformance substrate that closes G0: a manifest library
(`@foresift/requirement-manifest`) that validates and queries the authoritative migrated
requirement manifest; a conformance library (`@foresift/release-conformance`) that implements
CI conformance verdicts, gate evidence artifacts, decision-trace records, release reports, and
the orphan/exception ledger; two zero-runtime-dependency CLIs
(`scripts/generate-requirement-manifest`, `scripts/verify-release-conformance`) that regenerate
`docs/generated/**` (requirements projection, all 58 `<family>-surfaces.json` mappings, release
report) and fail on conformance violations; the `trace` SQL schema (supersession ledger,
decision traces, gate evidence); and `telemetry/trace.catalog.json` as a declarative contract.
This package NEVER edits `docs/spec/**` — FR-TRACE-001 is satisfied by keeping the migrated,
SHA256SUMS-pinned manifest authoritative, integrity-checked, and machine-consumed.

## Technical context

- Runtime: Node ≥ 24 (v24.19.0, `.nvmrc`), TypeScript strict + `noUncheckedIndexedAccess`,
  NodeNext; Bun test runner (pinned 1.4.0).
- New workspace packages `packages/requirement-manifest` (`@foresift/requirement-manifest`) and
  `packages/release-conformance` (`@foresift/release-conformance`) — private, `"type": "module"`,
  per-package tsconfig extending `../../tsconfig.base.json` globbing `src/**` + `test/**`
  (zero root-config edits; the glob-driven root config from g0-contracts-data-truth already
  covers `packages/*/src/**`).
- Zero new runtime dependencies: manifest parsing, hashing, and validation use `node:crypto`,
  `node:fs`, `node:path` (the `scripts/spec-verify.mjs` zero-dependency precedent). Zod for the
  new `trace` schema family comes from `@foresift/shared-schemas` (ADR-0013).
- DB tests: PGlite (ADR-0014) — new suites importing PGlite classify as DATABASE_PGLITE by the
  coordinator's import sniffing and run ONLY through `pnpm test:all` / per-workload scripts;
  one PGlite instance per suite file (never a bare full-tree `bun test`).
- Canonical JSON: `canonicalJson` from `@foresift/persistence` is THE serializer for every
  generated artifact hash (the observation/evidence hashing substrate, byte-stable, key-sorted).
- Keyed hashes: HMAC-SHA256(pepper, payload) rendered `sha256:<hex>` — the proven
  `packages/security` pattern (`mcp-credentials.ts`) consumed as a pattern, not an import
  (release-conformance owns its own crypto code with no security-package dependency cycle).
- Package gate commands (from `specs/implementation/current-milestone.json`):
  `test -d packages/requirement-manifest && pnpm --filter @foresift/requirement-manifest test`,
  `test -d packages/release-conformance && pnpm --filter @foresift/release-conformance test`,
  `pnpm spec:verify`.

## Constitution check

| Principle                             | Status | Notes                                                                                                                                            |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product-contract authority (I)        | PASS   | `docs/spec/**` read-only; every task cites FR-TRACE-### / AC-265..269.                                                                           |
| Read-only perimeter (IV, INV-001)     | PASS   | Generator/verifier inspect and hash only; no trading/custody/signing path; package code itself passes the prohibited-capability scans unchanged. |
| Provenance and evidence (VII)         | PASS   | This package IS the evidence substrate: hashes, signatures, immutable reports.                                                                   |
| Deterministic verification (XI)       | PASS   | Gates are code: CLI `--check` mode, byte-identical regeneration, `pnpm spec:verify`, package gates.                                              |
| Positive + failure-path testing (XII) | PASS   | AC-265..269 each carry positive AND negative suites (manifest-declared).                                                                         |
| Replay/idempotency (XIII, INV-009)    | PASS   | Trace tables insert-only; regeneration deterministic; re-running verification is side-effect-free.                                               |
| Autonomous-agent governance (XVI)     | PASS   | AI completion claims never constitute proof — the validator, package gate, and CI decide.                                                        |
| Additive git history (XVII)           | PASS   | New files + additive exceptions; no amend/rebase/force.                                                                                          |

## Project structure (new files under writeScopes)

```text
packages/requirement-manifest/
  package.json                      @foresift/requirement-manifest, zero runtime deps
  tsconfig.json                     extends ../../tsconfig.base.json (src/** + test/**)
  src/index.ts                      package entrypoint
  src/load.ts                       manifest loader: path → parsed JSON + integrity verdicts
  src/validate.ts                   structural validation (hashes, anchors, refs, DAG, counts)
  src/ids.ts                        ID-shape grammar + uniqueness/stability checks (FR-TRACE-002)
  src/query.ts                      typed queries: by family/group/owner, AC reverse lookup,
                                    surface/telemetry/schema/fixture resolution
  src/errors.ts                     typed ForesiftError-style refusals (domain-enum untouched)
packages/release-conformance/
  package.json                      @foresift/release-conformance, workspace deps on
                                    requirement-manifest, shared-schemas, persistence, domain
  tsconfig.json
  src/index.ts
  src/conformance.ts                FR-TRACE-003 verdicts: unmapped items, missing code paths,
                                    dependency-gate bypass, generated-doc drift
  src/orphans.ts                    orphan detection + exception-ledger evaluation
  src/gate-evidence.ts              FR-TRACE-004 evidence artifacts: payload canonicalization,
                                    sha256 artifact hash, HMAC signature, scope, expiry, revoke
  src/decision-trace.ts             FR-TRACE-005 trace store: fail-closed record assembly,
                                    point-in-time fetch
  src/release-report.ts             FR-TRACE-006 report builder: hashes, SBOM projection,
                                    conformance results, deviations, activation, rollback target
  src/sbom.ts                       deterministic CycloneDX-shaped projection of pnpm-lock.yaml
packages/shared-schemas/
  src/trace.ts                      NEW family: RequirementRef, GateEvidenceRecord,
                                    DecisionTraceRecord, ReleaseReportRecord,
                                    SupersessionLink, ID-pattern schemas, registry
  (src/index.ts untouched — consumers import '../src/trace.ts' directly, mcp.ts precedent)
migrations/
  g0_trace_0001_trace_schema.sql    CREATE SCHEMA trace; id_supersessions + gate_evidence
                                    (insert-only; CHECK constraints; rollback: DROP SCHEMA)
  g0_trace_0002_decision_traces.sql decision_traces (insert-only, jsonb payload, hash column)
scripts/generate-requirement-manifest/
  cli.mjs                           zero-dep CLI: generate | --check; emits docs/generated/**
scripts/verify-release-conformance/
  cli.mjs                           zero-dep CLI: conformance verdicts; exit 1 fail-closed
docs/generated/                    ALL generated by the CLI (hand edits prohibited, §42.3):
  requirements.json                 canonical manifest projection
  <family>-surfaces.json            58 family→surface mapping files
  release-conformance.json          FR-TRACE-006 release report
  requirement-manifest.integrity.json  load/validate verdict snapshot
telemetry/trace.catalog.json       declarative trace.* event contract (requirementRefs)
tests/fixtures/trace/
  manifest-excerpt.ts               pinned FR/AC/INV text + hash fixtures
  gate-evidence.ts                  deterministic HMAC test peppers + evidence payloads
  decision-traces.ts                complete/incomplete trace records
  surfaces.ts                       expected surfaces-file shapes for drift fixtures
  release-report.ts                 hash-input fixtures (PRD bytes, manifest bytes, lockfile)
tests/acceptance/
  AC-265.spec.ts                    manifest completeness + integrity
  AC-266.spec.ts                    CI failure on normative-item drift (each mutation class)
  AC-267.spec.ts                    decision/alert → exact versions traceability
  AC-268.spec.ts                    gate evidence acceptance; boolean rejection
  AC-269.spec.ts                    release report content + reproducibility
tests/negative/
  AC-265.negative.spec.ts           corrupted/duplicated/renumbered manifest refused
  AC-266.negative.spec.ts           silent drift NOT caught when verifier absent → gate must fail
  AC-267.negative.spec.ts           incomplete decision trace refused (each missing dimension)
  AC-268.negative.spec.ts           expired/revoked/out-of-scope/bad-signature evidence refused
  AC-269.negative.spec.ts           report with missing field / drifting hash refused
packages/requirement-manifest/test/*.spec.ts   loader, validator, ids, query suites
packages/release-conformance/test/*.spec.ts    conformance, evidence, traces, report suites
packages/release-conformance/test/trace-schema-parity.spec.ts  trace-schema parity (sec precedent)
```

Supporting (outside writeScopes, plan-sanctioned exceptions):

- `packages/persistence/src/migrator.ts` — add `trace` to `MIGRATION_FILE_PATTERN` family list.
- `packages/persistence/test/migrator.spec.ts` — central expected-script registry extended with
  the two `g0_trace_*` ids (all assertion sites) — ADR-0019 duty, named in T003.
- Root `package.json` / `pnpm-lock.yaml` — workspace linkage of the two new packages
  (mechanical bookkeeping, ADR-0020; collectible at repo root per task-graph rules).

## Data model

`g0_trace_0001_trace_schema.sql` (schema `trace`):

- `trace.id_supersessions` — FR-TRACE-002 ledger: `superseded_id` (text), `superseding_id`
  (text), `namespace` (CHECK: requirement|acceptance|invariant|adr|feature|schema|api|tool|
  policy|artifact|test), `reason` (text), `recorded_at` (timestamptz). INSERT-only enforced by
  trigger refusal (`trace.refuse_mutation()` — the `disc.refuse_mutation()` precedent).
  PK `(namespace, superseded_id)` — an ID can be superseded exactly once.
- `trace.gate_evidence` — FR-TRACE-004: `evidence_id` (text PK, content-addressed from payload
  hash), `gate_kind` (CHECK: MANUAL|LEGAL|RIGHTS|STATISTICAL|OWNER_APPROVAL), `scope_refs`
  (text[] NOT NULL, requirement/AC IDs), `approver` (text NOT NULL), `payload_sha256`
  (`sha256:<hex>`), `signature` (`sha256:<hex>` HMAC), `expires_at` (timestamptz NOT NULL),
  `revoked_at` (timestamptz NULL), `created_at`. UPDATE/DELETE refused by trigger — revocation
  is a NEW row referencing `evidence_id`, never a mutation.

`g0_trace_0002_decision_traces.sql`:

- `trace.decision_traces` — FR-TRACE-005: `trace_id` (text PK, content-addressed),
  `decision_ref` (text NOT NULL — production decision/alert identifier),
  `requirement_ids` (text[] NOT NULL), `policy_versions` (jsonb NOT NULL), `feature_versions`
  (jsonb NOT NULL), `model_version` (text), `tool_name` (text NOT NULL), `tool_version`
  (text NOT NULL), `provider_versions` (jsonb NOT NULL), `adapter_versions` (jsonb NOT NULL),
  `artifact_versions` (jsonb NOT NULL), `manifest_sha256` (text NOT NULL), `release_report_id`
  (text NOT NULL), `recorded_at`. Insert-only trigger. A trace missing any REQUIRED dimension
  is refused at the store layer (fail-closed) — SQL CHECKs add the last line of defense.

All trace hashing goes through `canonicalJson`; hashes stored `sha256:<hex>` matching
`KeyedHashSchema` shape. The `trace` schema keeps `packages/persistence`'s public-schema parity
contract untouched; a package-local parity test enumerates `information_schema` for
`table_schema = 'trace'` (the `packages/security` `sec`-schema precedent).

## Verification strategy (per shared AC)

| AC     | Strategy                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-265 | Positive: fixture manifest containing every normative FR/AC/INV/ADR exactly once validates — text hashes, line anchors resolving into the PRD, dependency group, owner, code/schema/surface/test/telemetry mapping, activation gate, rollback target all present and referenced. Negative: corrupted text (hash mismatch), duplicated ID, renumbered/misordered ID, dangling reference, and unresolvable line anchor each fail with a typed verdict. |
| AC-266 | Positive: a fixture tree where a normative item is added/deleted/duplicated/renumbered/changed WITH matching manifest/test updates passes the conformance CLI. Negative: each mutation class WITHOUT a matching update fails the CLI (exit 1) with the specific finding — and the acceptance suite asserts the finding names the drifted item.                                                                                                       |
| AC-267 | Positive: decision-trace records seeded with complete requirement/policy/feature/model/tool/provider/adapter/artifact versions plus manifest hash and release id round-trip through the store and point-in-time fetch. Negative: a trace missing each individual dimension (and one with a wrong-format hash) is refused; refusal names the missing dimension.                                                                                       |
| AC-268 | Positive: valid evidence (fresh, in-scope, unrevoked, signature- and hash-verifying) satisfies the gate evaluator for each of the five gate kinds. Negative: expired, revoked, scope-mismatched, tampered-payload, and wrong-key evidence each refuse; and a raw boolean (true) presented as approval is refused BY TYPE — the evaluator has no boolean input path at all.                                                                           |
| AC-269 | Positive: release report built from fixture inputs contains every required field (document hash, manifest hash, SBOM/dependency hash, migration/schema hashes, conformance results, deviations, activation scope, tested rollback target) and rebuilds byte-identically. Negative: a report missing a field, or one whose recorded hash disagrees with recomputation, is refused by the report verifier.                                             |

Milestone verification: the three package `verificationCommands`; plus `pnpm verify` and
`pnpm spec:verify` at pushed HEAD. The full suite runs only through the coordinator.

## Risks and mitigations

- **Central migration registry breakage** — the two new `g0_trace_*.sql` scripts REQUIRE the
  `MIGRATION_FILE_PATTERN` extension and the registry update in
  `packages/persistence/test/migrator.spec.ts` in the same package; T003 names the file
  explicitly (ADR-0019 plan-sanctioned exception) so the graph builder accepts it up front
  instead of burning the repair budget (g0-cost-capacity lesson).
- **Conformance gate ordering** — the FR-TRACE-003 checks necessarily run against a tree that
  contains this package's own output; the CLI evaluates the ACTIVE dependency group (G0) from
  `specs/implementation/current-milestone.json`, so later-group obligations
  (`packages/agent-runtime/**` et al.) produce no product paths and no findings until their
  group gate opens.
- **Orphan-ledger scope creep** — the ledger ships minimal (19 observed product paths:
  `packages/object-store/src/**`, `packages/collector-checkpoints/src/**`,
  `packages/collector-gap-recovery/src/**`, `apps/api` wiring files), each entry requirement-
  traced and justified; entries are additive-only and reviewed at convergence.
- **Fixture-corpus scanner findings** — trace fixtures carry manifest excerpts, hashes, and
  deterministic HMAC test peppers only; no prohibited-pattern text, so the scanner exclusion
  list stays untouched (unlike the `sec`/`mcp` fixture precedents).
- **Reproducibility drift** — generated artifacts contain no wall-clock timestamps (inputs
  provide all hashes); key-sorted canonical JSON + `--check` byte comparison make drift
  failures name the exact file.
- **OOM hazard** — DATABASE_PGLITE suites run only through the coordinator; no bare
  full-tree `bun test`.
- **Scope-guard failures** — every task names only writeScope paths plus the two sanctioned
  exceptions; root `package.json`/`pnpm-lock.yaml` are mechanically collectible at the repo
  root per the task-graph linker rules.

## Material decisions (proposed ADR texts)

### ADR-0021 (proposed): The migrated requirement manifest is consumed read-only; conformance derives FROM it, never rewrites it

**Status**: Proposed · **Context**: FR-TRACE-001 requires a machine-readable requirement
manifest "generated from this PRD" as the release-blocking source. Foresift inherited that
manifest byte-for-byte (PRD `baa521d9…`, manifest `e0f9f128…`, pinned in `SHA256SUMS` and
verified by `pnpm spec:verify`), and its bytes are normative. **Decision**:
`packages/requirement-manifest` LOADS and validates the migrated manifest;
`scripts/generate-requirement-manifest` regenerates only `docs/generated/**` projections of it.
Nothing regenerates `docs/spec/**` artifacts. Gaps between the manifest and the tree are
resolved through the conformance gate and its requirement-traced exception ledger — never by
editing the authoritative file. **Consequences**: the four-artifact integrity contract stays
intact; manifest evolution happens only through the PRD's own supersession process
(FR-TRACE-002's ledger); conformance work can never silently "fix" product truth.

### ADR-0022 (proposed): Release gate evidence is keyed-hash signed with server-side pepper; booleans are structurally inexpressible

**Status**: Proposed · **Context**: FR-TRACE-004 / AC-268 require signed/hashed evidence with
approver, scope, expiration, and revocation "rather than unchecked booleans". Foresift has no
PKI at G0. **Decision**: evidence artifacts are canonical-JSON payloads carrying an artifact
SHA-256 and an HMAC-SHA256 signature under a server-side pepper (the proven
`packages/security` keyed-hash pattern, reused as a pattern not an import); the gate evaluator's
input TYPE is the evidence record — a boolean cannot be presented, so an unchecked boolean
cannot satisfy a gate by construction, not by convention. **Consequences**: pepper management
becomes an operational duty (documented runbook entry); upgrading to asymmetric signatures is a
format version bump without changing evaluator semantics; revocation is append-only.

### ADR-0023 (proposed): Normalized document hash is carried as provenance, verified for consistency, never recomputed

**Status**: Proposed · **Context**: PRD Appendix V.2 defines the normalized document hash via a
sentinel-substitution algorithm whose exact scheme is not recoverable (recorded honestly in
`docs/migration/SPEC_MIGRATION.md`). **Decision**: `docs/generated/release-conformance.json`
records the exact PRD SHA-256, manifest SHA-256, and the historical normalized hash; the CLI
verifies cross-artifact consistency (manifest ↔ audit) exactly as `pnpm spec:verify` does, and
does NOT recompute the normalized hash with an invented algorithm. **Consequences**: release
reports never embed a fabricated integrity value; if the original scheme is ever recovered, a
superseding ADR upgrades the check from consistency to recomputation.

## Task sequencing overview

Foundation (packages, schemas, migration registry) → manifest library + validators →
conformance library (verdicts, evidence, traces, reports, SBOM) → generators/CLIs +
`docs/generated/**` → exception ledger + telemetry catalog → acceptance + negative suites →
full-gate convergence. Details and ordering in `tasks.md`.
