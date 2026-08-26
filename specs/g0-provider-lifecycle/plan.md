# Implementation Plan: g0-provider-lifecycle

**Branch**: `archon/task-foresift-g0-provider-lifecycle` | **Date**: 2026-08-25
**Spec**: `specs/g0-provider-lifecycle/spec.md` (scoped derivative; PRD-subordinate)
**Input**: Assigned requirements FR-PROV-001 through FR-PROV-010 from
`specs/implementation/current-milestone.json` (milestone G0, risk HIGH,
generation 0). Dependencies `g0-contracts-data-truth` and `g0-security-perimeter`
are PROVEN and merged: persistence engine, migrator, object store, shared
schemas, domain substrate, audit chain, egress guard, untrusted-content
envelope, negative-capability scanners, decoder-authority validator, incidents,
and gate-pause machinery exist and are green.

## Summary

This is a **build-out generation**: neither `packages/provider-lifecycle` nor
`packages/providers` exists yet (`migrations/g0_prov_*`, `tests/fixtures/prov`,
`telemetry/prov.*`, `docs/provider-rights/**`, and schemas `packages/shared-
schemas/src/prov.ts` are all absent from the tree today). The package delivers:

1. **Two new workspace packages** — `@foresift/provider-lifecycle` (the truth
   and policy engine: versioned operation registry, seven-state lifecycle
   machine over an append-only transition ledger, verification-TTL engine,
   deprecation/migration-exception rules, response-quarantine pipeline,
   rights-matrix change engine with fail-closed use decisions, source
   fingerprints) and `@foresift/providers` (the audited read-only adapter
   framework bound to exact allowlists plus the two safety-critical reference
   families: GMGN strictly query-only, Helius supported raw/history operations
   with local decoding separation).
2. **Authoritative schemas** — `packages/shared-schemas/src/prov.ts` (Zod,
   repository ADR-0013): operation definitions, lifecycle states/transitions,
   verification kinds/records, health statuses, migration exceptions,
   quarantine findings, rights matrices/changes/actions, source fingerprints.
3. **Five SQL migrations** (`g0_prov_0001..0005`) — registry + append-only
   lifecycle events, verification records, migration exceptions, response
   quarantine (metadata-only persistence), rights declarations/changes/
   artifact registry/action ledger, source fingerprints.
4. **Declarative telemetry contract** — `telemetry/prov.catalog.json` in the
   established catalog format (emitter wiring is a later milestone).
5. **Provider-rights documentation** — rights matrix register, rights-change
   runbook, adapter onboarding/verification procedure under
   `docs/provider-rights/`.
6. **The manifest-declared evidence delta** — four NEW acceptance suites +
   four NEW negative suites (AC-270…273, both directions — the ten shared
   AC-250…259 suites already exist and pass) plus sanitized/malicious fixture
   corpora under `tests/fixtures/prov/`.

One supporting change outside write scopes is required and justified below
(migrator filename-family extension, same precedent as the security package).

## Technical Context

**Language/Version**: TypeScript 5.9.x (NodeNext, `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) on Node.js ≥24;
pnpm workspace.

**Primary Dependencies** (all already installed and locked):

- `zod` — authoritative schemas in `packages/shared-schemas` (ADR-0013).
- `drizzle-orm` — typed mirror of SQL migrations per product ADR-001.
- `@electric-sql/pglite` — deterministic in-process PostgreSQL test engine
  (repository ADR-0014).
- `vitest` — repo test runner; new packages get local vitest runner configs
  exactly like the proven packages (material decision 10).
- Existing workspace substrate: `@foresift/domain` (ClockPort/fixedClock,
  ForesiftError), `@foresift/persistence` (DatabaseEngine, applyMigrations,
  canonical JSON serializer), `@foresift/shared-schemas`,
  `@foresift/security` (EgressGuard, AuditChain, incidents API,
  untrusted-content envelope, decoder-authority validator,
  negative-capability catalog seams).

**Storage**: PostgreSQL schema via `migrations/g0_prov_0001..0005_*.sql`
(source of truth, applied by the existing deterministic migrator) with Drizzle
mirrors parity-tested like the proven migrations. The acceptance helper
(`tests/acceptance/helpers.ts`) applies ALL migrations in `MIGRATIONS_DIR`, so
the prov set integrates automatically once the migrator accepts the family.

**Testing**: Vitest three layers — colocated package suites under
`packages/*/test/`; acceptance specs `tests/acceptance/AC-*.spec.ts`; negative
specs `tests/negative/AC-*.negative.spec.ts`. No suite performs live network
access: HTTP transport sits behind an injectable `FetchPort` seam served from
sanitized recorded fixtures; time comes exclusively from the injected
ClockPort. Forbidden fixtures (malicious-response corpus, GMGN-style trading
variants) are inert structured data under `tests/fixtures/prov/` excluded from
production scans by the established fixture-corpus rule.

**Target Platform**: Linux CI + local dev; single deployable modular monolith
(Constitution III). No new services, queues, or brokers.

**Constraints**: read-only product boundary (INV-001 / Constitution IV);
deterministic verification (XI); positive AND failure-path testing (XII);
fail-closed external integrations (VIII); least privilege, no secret material
(XV); every task traces to an assigned requirement or its acceptance criteria
(X).

## Constitution Check

_GATE: must pass before implementation. Re-checked after design._

| Principle                             | Verdict | Evidence                                                                                                                             |
| ------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| I Product-Contract Authority          | PASS    | Scope limited to the ten assigned requirements; `docs/spec/**` untouched; spec.md marked subordinate.                                |
| II Greenfield Architecture            | PASS    | Design derived from PRD §§12.11/15/35/39/40 + Appendix D ADR-054; predecessor repo never consulted.                                  |
| III Modular-Monolith-First Simplicity | PASS    | Two library packages inside one deployable; no services, brokers, or speculative abstractions.                                       |
| IV Read-Only Product Boundary         | PASS    | Adapter framework structurally forbids prohibited capability classes; quarantine strips transaction-building fields; fixtures inert. |
| V Point-in-Time Correctness           | PASS    | Lifecycle transitions carry occurrence instants; replay resolves original operation/version (§15.4 rule 5); no retroactive mutation. |
| VI Event-Time / Earliest-Availability | PASS    | Not primary here; no availability semantics redefined; verification timestamps are control-plane facts with provenance.              |
| VII Provenance & Evidence             | PASS    | Every verification record, transition, quarantine, and rights change carries evidence references and hashes.                         |
| VIII Fail-Closed Integrations         | PASS    | Expiry, unknown states, schema drift, ambiguous responses, missing verification — all typed refusals; deny-by-default allowlists.    |
| IX Provider/Capability Abstraction    | PASS    | Operations are declarative data behind internal interfaces; concrete vendors appear only in leaf adapter modules.                    |
| X Requirement Traceability            | PASS    | tasks.md maps each task to FR-PROV IDs; validator-enforced; no foreign requirement ID appears there.                                 |
| XI Deterministic Verification         | PASS    | Gates are code: vitest suites, contract-test enumerations, `pnpm verify` — identical locally and in CI.                              |
| XII Positive AND Failure-Path Testing | PASS    | All fourteen assigned ACs ship acceptance AND negative specs; malicious-response/TTL-expiry/rights-tightening batteries included.    |
| XIII Replay/Recovery/Idempotency      | PASS    | Idempotency keys fence lifecycle transitions and verification records; replays produce identical outcomes.                           |
| XIV Durable Resumable Operations      | PASS    | Work persists on disk/git additively; continuation state lives in these artifacts, not conversational memory.                        |
| XV Security & Least Privilege         | PASS    | Quarantine persists hashes/paths/sizes, never payload or key material; credentials only via configuration seams.                     |
| XVI Autonomous-Agent Governance       | PASS    | Material decisions recorded here; out-of-scope gaps routed to the run's notes file, never fixed out of scope.                        |
| XVII Additive Git History             | PASS    | Coherent units committed additively on the package branch during implementation; main reached only through CI-gated PRs.             |
| XVIII No AI Claim Is Completion       | PASS    | Completion decided by `package-plan-complete.mjs` now and by `pnpm verify`/CI later.                                                 |

## Project Structure

### Documentation (this feature)

```text
specs/g0-provider-lifecycle/
  spec.md      # scoped derivative (PRD-subordinate)
  plan.md      # this file
  tasks.md     # ordered traceable breakdown
```

Generation 0 uses the bare package id only — the deterministic guards resolve
`specs/g0-provider-lifecycle/` directly; no mirrored `@g<N>` directory exists
for this package.

### Source deltas (all inside binding writeScopes)

```text
packages/provider-lifecycle/
  package.json  tsconfig.json  vitest.config.ts     # @foresift/provider-lifecycle scaffold
  src/errors.ts                # ProvErrorCode vocabulary (typed, stable codes)
  src/lifecycle-states.ts      # §12.11 state alphabet + legal-transition graph
  src/operation-registry.ts    # versioned operation definitions (§15.3) over DatabaseEngine
  src/lifecycle-machine.ts     # guarded, idempotent, fenced transitions; append-only event ledger
  src/verification-ttl.ts      # eight verification kinds + live probe; expiry evaluation; AC-270 refresh pair rule
  src/deprecation-rules.ts     # deprecatedAt blocks, sunset→incident+deadline, sole-critical-source refusal
  src/migration-exceptions.ts  # time-bounded exceptions with replacement plans; expiry re-blocks
  src/response-quarantine.ts   # malicious-response scanner: five detection classes; reject/quarantine/audit/exclude
  src/rights-matrix.ts         # sixteen-field declarations; change diff; fail-closed use decisions (AC-273)
  src/artifact-registry.ts     # provider-artifact registration + rights-change quarantine/retire actions
  src/source-fingerprints.ts   # lineage/value/timing/outage/schema/first-seen capture (§15.7 inputs)
  src/readiness.ts             # AC-272 provider-side activation-readiness evaluator
  src/audit-bridges.ts         # maps lifecycle events onto the security AuditChain action classes
  src/index.ts                 # public surface
  test/*.spec.ts               # colocated unit/integration suites
  src/generated/               # Drizzle mirrors of g0_prov_* (parity-tested)

packages/providers/
  package.json  tsconfig.json  vitest.config.ts     # @foresift/providers scaffold
  src/fetch-port.ts            # injectable HTTP transport seam (no global fetch in decision paths)
  src/adapter-contract.ts      # exact per-adapter allowlist descriptor + request/response enforcement layering
  src/registration.ts          # adapter registration validating capability classes; refuses PROHIBITED_* outright
  src/operation-catalogs/      # declarative per-provider operation catalogs (pure data)
    gmgn.catalog.ts            #   query-only operation set (FR-PROV-006)
    helius.catalog.ts          #   raw/history + deprecated enhanced-parser entries (FR-PROV-007)
  src/adapters/
    gmgn-adapter.ts            # GMGN read-only adapter over adapter-contract + EgressGuard + FetchPort
    helius-adapter.ts          # Helius raw getTransaction / signature history adapters
  src/helius-decoding.ts       # LOCAL supported-program decoding separated from provider parsing
  src/index.ts                 # public surface
  test/*.spec.ts               # colocated suites incl. exposed-operation enumeration contracts

packages/shared-schemas/
  src/prov.ts                  # authoritative Zod schemas (schemaRefs target)
  src/index.ts                 # + export * from './prov.ts'
  test/prov.spec.ts            # schema accept/refuse matrices (.strict() included)

migrations/
  g0_prov_0001_provider_operations.sql   # providers, operations (versioned), dependencies, lifecycle events
  g0_prov_0002_verification_ttl.sql      # verification records + per-kind/provider TTL config
  g0_prov_0003_migration_exceptions.sql  # time-bounded exceptions w/ replacement plans
  g0_prov_0004_quarantine.sql            # metadata-only response quarantine records
  g0_prov_0005_rights_fingerprints.sql   # rights declarations/changes, artifact registry, actions, fingerprints

telemetry/prov.catalog.json              # declarative event contracts (established catalog format)

docs/provider-rights/
  rights-matrix-register.md               # declared matrices per provider family + change procedure
  rights-change-runbook.md                # tightening drill: block paths, enumerate artifacts, act
  adapter-onboarding-and-verification.md  # definition → verification → activation checklist (fail-closed)

tests/fixtures/prov/                      # sanitized recorded responses + inert forbidden-fixture corpus
tests/acceptance/AC-{270,271,272,273}.spec.ts
tests/negative/AC-{270,271,272,273}.negative.spec.ts
```

## Data Model

Five migrations extend the proven schema (lexicographically sorting AFTER all
applied `g0_data_*`/`g0_dr_*`/`g0_sec_*` ids, so the out-of-order defense stays
silent):

1. **`g0_prov_0001_provider_operations`** — `prov_providers`: provider identity
   and group, disabled-by-default flag. `prov_operations`: `(provider_id,
operation_id, version)` primary key carrying every §15.3 definition field;
   `capability_class` CHECK against the §15.2 vocabulary with prohibited values
   unrepresentable at registration time (API-level refusal, DB-level CHECK);
   `cost_class` CHECK; `current_state` CHECK against the seven §12.11 states;
   `health_status` CHECK against the twelve §15.4 values; deprecation fields
   (`deprecated_at`, `sunset_at`, replacement pointers);
   `forbidden_output_fields`/`negative_capabilities`/`upstream_lineage` JSONB.
   `prov_operation_dependencies`: first-class affected-features registry
   (consumer kind FEATURE|TOOL|EXPORT|ALERT_DERIVATIVE, consumer key, operation
   reference, active flag). `prov_lifecycle_events`: APPEND-ONLY transition
   ledger (`from_state`, `to_state`, `reason_class`, `actor`, `occurred_at`,
   evidence references, `idempotency_key` UNIQUE) protected by BEFORE
   UPDATE/DELETE immutability triggers like the audit chain.
2. **`g0_prov_0002_verification_ttl`** — `prov_verification_records`:
   `(operation ref, kind, verified_at)` with `kind` CHECK across the nine
   kinds (DOCUMENTATION, PRICING_PLAN, QUOTA, RIGHTS, SCHEMA, ENDPOINT,
   AUTHENTICATION, DEPRECATION, LIVE_PROBE), `source` CHECK (OFFICIAL_DOC |
   LIVE_CONTRACT), outcome, evidence references, `expires_at`. Per-kind/per-
   provider TTL configuration rows (seconds, fail-closed defaults).
3. **`g0_prov_0003_migration_exceptions`** — `prov_migration_exceptions`:
   exception identity, operation reference, approver, replacement-plan
   reference, `exception_expires_at` (CHECK > created_at), `revoked_at`;
   expired or revoked exceptions cannot authorize anything (evaluated at use
   time against the injected clock).
4. **`g0_prov_0004_quarantine`** — `prov_response_quarantine`: quarantine
   identity, operation reference, `detected_classes` CHECK against the five
   FR-PROV-008 classes, `field_paths` JSONB, `payload_sha256`, `byte_size`,
   disposition (always REJECTED), audit-chain reference, model-context
   exclusion constant CHECKed to `ENFORCED`. NO payload-body column exists —
   hazardous material is structurally unpersistable.
5. **`g0_prov_0005_rights_fingerprints`** — `prov_rights_declarations`
   (sixteen §15.6 fields, `rights_version`, terms_version, verified/expires);
   `prov_rights_changes` (from/to versions, `newly_prohibited_uses`);
   `prov_provider_artifacts` (object ref, operation ref, rights version at
   capture, state ACTIVE|QUARANTINED|RETIRED); `prov_rights_change_actions`
   (change FK, artifact FK, QUARANTINE|RETIRE, executed_at);
   `prov_source_fingerprints` (fingerprint kind CHECK: UPSTREAM_LINEAGE,
   VALUE_CORRELATION, TIMING_BEHAVIOR, OUTAGE_CORRELATION,
   SCHEMA_CHARACTERISTICS, FIRST_SEEN_BEHAVIOR; canonical JSON payload;
   computed_at; estimator-input references).

Drizzle mirrors live in `packages/provider-lifecycle/src/generated/`
parity-tested against information_schema like the proven packages.

## Verification Strategy (per acceptance criterion)

All fourteen ACs have manifest-declared positive and negative spec paths — the
ten existing suites must remain green untouched; the four NEW pairs land here.
Engines: PGlite via existing helpers; injected clocks for every TTL/expiry/
exception-window decision; the FetchPort seam serving recorded fixtures; the
security EgressGuard/AuditChain composed for integration proofs.

| AC group                           | Positive proof                                                                                                                                                                                                       | Negative/failure-path proof                                                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-250…253 (shared primitives)     | Existing suites green untouched (regression guard in convergence task)                                                                                                                                               | n/a — no provider-side delta; any accidental breakage fails the guard                                                                                                                                                          |
| AC-254 (absence scans)             | Scan CLI + runtime canary stay green over both new packages; every registered operation carries negativeCapabilities metadata                                                                                        | Registration refusing each PROHIBITED_* class with typed error (package suite); tree scans still detect the sanctioned fixture corpus                                                                                          |
| AC-255 (GMGN pair)                 | Real GMGN adapter's exposed-operation enumeration contains ONLY query operations; clean query fixture flows end-to-end                                                                                               | Trading-shaped operation definitions refused at registration; swap/private-key/transaction variants rejected at runtime validation layer                                                                                       |
| AC-256 (decoder authority)         | Landed decoder-authority validator passes against THIS package's real Helius registry entries (raw/history + local decoding authoritative)                                                                           | Enhanced-parser-as-sole/authoritative configuration refused with the real registry entry marked deprecated; retention without valid migration exception refused                                                                |
| AC-257 (allowlists/SSRF)           | Clean allowlisted request passes EgressGuard + adapter contract layer end-to-end                                                                                                                                     | Wrong method/path template/content type/undeclared request field/oversized response/blocked IP/redirect-to-unapproved-origin each fail closed with typed reasons                                                               |
| AC-258 (injection containment)     | Provider text reaches the landed untrusted-content envelope labeled as provider class                                                                                                                                | Quarantined content provably absent from every envelope/context write (exclusion assertion battery)                                                                                                                            |
| AC-259 (audit integrity)           | Transition → verification → quarantine → rights-change events all appear as chained audit entries verifiable end-to-end                                                                                              | Existing chain-corruption suites stay green; bridge refuses unaudited critical transitions                                                                                                                                     |
| AC-270 (TTL expiry, NEW)           | Active operation → documentation/rights/schema verification expires under injected clock → new active decision-critical use refused → official-doc + live-contract refresh restores use                              | Partial refresh (only one of the pair) does NOT restore use; expired exception windows do not extend; wrong-kind refresh does not satisfy                                                                                      |
| AC-271 (quarantine, NEW)           | Sanitized clean responses flow to evidence envelopes; audit entry written                                                                                                                                            | Each malicious class (transaction payload, signing request, executable instruction, private-key field, unexpected write capability) rejected + quarantined + audited + excluded from model context; no payload bytes persisted |
| AC-272 (activation readiness, NEW) | Fully verified rights + healthy lifecycle + zero prohibited exposure yields readiness=ELIGIBLE for the future gate                                                                                                   | Rights-unverified, expired-verification, deprecated-without-valid-exception, or prohibited-exposure state each keeps readiness BLOCKED with typed reason                                                                       |
| AC-273 (rights change, NEW)        | Rights tightening immediately flips use decisions to REFUSE for newly prohibited cache/raw-retention/export/redistribution/model-use paths and enumerates affected artifacts with quarantine/retire actions recorded | Pre-change artifacts attempted on now-prohibited paths refused; enumeration complete (no silent retention); loosening does NOT silently reactivate without reverification                                                      |

Cross-cutting: the milestone verification commands (`test -d
packages/provider-lifecycle && pnpm --filter @foresift/provider-lifecycle
test`, `test -d packages/providers && pnpm --filter @foresift/providers test`)
plus `pnpm verify` (spec:verify, format:check, lint, typecheck, full tests)
green at HEAD.

## Risks

| Risk                                                                                                                                 | Mitigation                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrator refuses `g0_prov_*` filenames (`MIGRATION_FILENAME_UNKNOWN`), breaking EVERY migration-running suite including proven ones. | One-line family-pattern extension in `packages/persistence/src/migrator.ts` (justified supporting change, material decision 1) landed FIRST, before any prov migration exists; additive, fail-closed direction unchanged. |
| Adapter tests accidentally perform real network access in CI.                                                                        | All transport goes through the injectable FetchPort; no suite configures a real transport; fixtures serve every wire body.                                                                                                |
| Forbidden fixtures (trading-shaped definitions, malicious-response corpus) trip the repo-wide prohibited-capability scanner.         | Fixtures are inert declarative data (no imports, no code) under `tests/fixtures/prov/`; the scanner's documented fixture-corpus exclusion covers them; convergence task proves the scan green over the delivered tree.    |
| Quarantine accidentally persists key material or executable content.                                                                 | Metadata-only schema (hashes, paths, sizes, classes) — no payload column exists; negative test asserts absence of payload bytes for a private-key-field fixture.                                                          |
| TTL/expiry logic becomes nondeterministic or timezone-broken.                                                                        | Injected ClockPort exclusively; UTC timestamps; fixed-clock tests for every window boundary (fresh, stale, boundary instant).                                                                                             |
| Rights-change engine reaching into other packages' storage.                                                                          | Artifact registry owned HERE; capture-time registration through this package's API is the integration contract; consumers enumerate via returned criteria, never cross-package SQL.                                       |
| Scope creep into tool-core/cost-capacity consumer wiring (quota arithmetic, STRICT_FREE budgets).                                    | Declaration fields exported; budget semantics belong to cost-capacity via tool-core extension points (boundary in spec §"Explicit scope boundaries"); discovered gaps go to out-of-scope notes.                           |
| Lifecycle state drift between SQL CHECKs and TS graph.                                                                               | Single Zod schema source in shared-schemas; parity tests assert the transition graph, CHECK constraints, and Drizzle mirrors agree.                                                                                       |
| Complete state left uncommitted blocks landing (create-pr refuses dirty trees).                                                      | Implementation commits coherent units additively as they converge; never ends the stage with a dirty tracked tree.                                                                                                        |

## Material decisions

1. **Migrator filename-family extension (supporting change outside
   writeScopes)**: the manifest's persistenceRefs declare
   `migrations/g0_prov_*.sql`, but the delivered migrator accepts only
   `(data|dr|sec)` families and REFUSES anything else fail-closed
   (`MIGRATION_FILENAME_UNKNOWN`). Extending its regex to
   `/^g\d+_(data\|dr\|sec\|prov)_\d{4}_[a-z0-9_]+\.sql$/` (+ doc comment) is the
   minimal enabling change: purely additive, preserves every defense (unknown
   families still refused; checksum/out-of-order/vanished-file defenses
   untouched). Landed as the FIRST implementation commit with the existing
   migrator suite kept green. Recorded here because `packages/persistence/**`
   is outside this package's writeScopes; renaming prov migrations to another
   prefix would falsify manifest-declared persistence refs and is rejected.
2. **Two-package split with strict dependency direction**:
   `providers → provider-lifecycle → {shared-schemas, domain, persistence,
security}`. The lifecycle/truth engine holds NO transport code and no vendor
   knowledge; adapters hold no policy logic beyond composing the engine's
   decisions with the security perimeter. This mirrors the manifest implRefs
   (`packages/provider-lifecycle/**`, `packages/providers/**`) and keeps both
   packages independently testable (Constitution IX abstraction without
   speculative generality).
3. **Injectable FetchPort instead of global fetch**: adapters receive an
   injected transport (`(request) => Promise<Response>`); production wiring
   supplies the real fetch THROUGH the security EgressGuard; tests supply
   fixture transports. Decision paths contain no direct network access, giving
   deterministic offline suites and a single choke point where egress
   enforcement is structurally unavoidable (FR-PROV-005).
4. **Event-sourced lifecycle with idempotent fenced transitions**: the
   seven-state lifecycle is an append-only `prov_lifecycle_events` ledger plus
   a projected current-state column. Transitions validate against the legal
   transition graph, require a reason class, and dedupe on
   `(operation, from, to, reason_class, effective_at)` uniqueness so retries
   (INV-009) cannot double-append. Historical evidence is never mutated
   (§12.11; INV-005/INV-006).
5. **AC-270 refresh pair rule**: re-verification restores active decision use
   ONLY when BOTH an OFFICIAL_DOC verification and a LIVE_CONTRACT verification
   of the expired kind succeed within their TTLs. Either alone leaves the
   operation out of active decision use — the stricter coherent reading of
   "successful official-doc and live-contract verification".
6. **Metadata-only quarantine persistence**: quarantine records store
   detection class, field paths, sha256, byte size, and audit reference — no
   payload column exists in the schema, making persistence of transaction
   payloads/key material structurally impossible rather than merely discouraged
   (Constitution XV; FR-PROV-008 "excluded from model context" extends to
   durable storage).
7. **Provider-artifact registry owned here**: rights-change impact needs to
   name previously stored restricted artifacts. Rather than reading other
   packages' tables, adapters/consumers REGISTER every persisted
   provider-derived artifact reference at capture time (object ref, operation
   version, rights version); the rights engine enumerates and acts on its own
   registry (AC-273), exporting criteria for consumers' own stores. This keeps
   writeScopes honest and defines the integration contract for tool-core /
   evidence consumers landing later.
8. **Declarative operation catalogs as data**: per-provider operation sets are
   pure Zod-validated data modules (`src/operation-catalogs/*.ts`). Adding a
   future §15.1 provider group (Alchemy, DefiLlama, collector sources…) is a
   new data file + leaf adapter, zero engine edits — Constitution IX rotation
   without product-code rewrites.
9. **Package-local error vocabulary**: `ProvErrorCode` stable string codes live
   in `packages/provider-lifecycle/src/errors.ts` (precedent:
   `SecErrorCode`; `packages/domain` is outside writeScopes). Audit bridges map
   lifecycle facts onto the security AuditChain's action-class vocabulary
   rather than inventing a second chain.
10. **Per-package vitest runner configs + declarative-only telemetry**: each
    new package gets a local `vitest.config.ts` mirroring root timeout budgets
    so the milestone-declared `pnpm --filter <pkg> test` commands collect
    colocated suites (proven sibling arrangement); `telemetry/prov.catalog.json`
    defines event contracts only — emitter wiring lands with observability in a
    later milestone.

## Supporting changes outside writeScopes (justified)

1. `packages/persistence/src/migrator.ts` — the family-pattern extension of
   material decision 1 (regex + comment lines only; no behavioral change for
   existing families). Its existing test suite must stay green untouched.
2. `pnpm-lock.yaml` — mechanical regeneration via `pnpm install` after adding
   the two new workspace packages; no hand edits.
3. None otherwise planned. Anything discovered mid-implementation goes to the
   run's `out-of-scope-notes.md` instead of being fixed out of scope.
