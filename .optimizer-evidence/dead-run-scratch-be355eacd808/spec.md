# Work-Package Specification: g0-contracts-data-truth@g1

> **SUBORDINATION NOTICE**: This file is a **scoped Spec Kit derivative** of the
> authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md` and its
> machine-readable requirement manifest
> (`docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json`).
> It is subordinate to the PRD in all cases. Where this file and the PRD appear
> to conflict, the PRD wins and the conflict is recorded as an ADR. Nothing here
> edits, weakens, or reinterprets an authoritative requirement.

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Milestone         | G0 (foundation)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Package id        | `g0-contracts-data-truth@g1` (execution generation 1 of `g0-contracts-data-truth`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Risk              | CRITICAL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Dependencies      | none (first package in the milestone)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Normative source  | PRD §38.2 (FR-DATA family), §38.43 (FR-DR family), §39 acceptance criteria, §45 architecture invariants; the manifest entries carry `line` anchors 5998–6003 (FR-DATA) and 6494–6495 (FR-DR) into that PRD file                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Package objective | Establish the canonical data-truth foundation: versioned chain/asset/pool/launch/migration identity, immutable observations with revisions, point-in-time `available_at` replay with no-backdating, field-level quality codes, online/offline feature consistency, source lineage and independence groups, and tiered backup/PITR durability with separately protected encryption keys and recovery credentials over the shared persistence, object-store, and schema layers. This package also lands glob-driven root tsconfig/eslint/package/workspace configuration that picks up every later G0 package path automatically so subsequent packages need zero root-config edits. |

## 0. Generation context — what already exists at this HEAD

Generation 0 of this package produced a reviewed, CI-verified product
implementation (migrations, five workspace packages, all manifest-declared
acceptance/negative suites, telemetry catalogs) that was transplanted onto this
generation branch as a salvage seed and merged with current main. This
generation's planning therefore starts from a **verified current-state
assessment** (probe-executed on the working tree at planning time):

Present and intact:

- `packages/domain`, `packages/shared-schemas`, `packages/persistence`,
  `packages/evidence`, `packages/object-store` with their test suites;
- `migrations/g0_data_0001..0007_*.sql`, `migrations/g0_dr_0001..0004_*.sql`
  applied deterministically by `packages/persistence/src/migrator.ts`;
- all 44 manifest-declared test files (22 acceptance criteria × positive +
  negative) under `tests/acceptance/` and `tests/negative/`;
- golden fixtures under `tests/fixtures/data/` and `tests/fixtures/dr/`;
- telemetry catalogs `telemetry/data.catalog.json`, `telemetry/dr.catalog.json`;
- accepted ADRs recording generation-0 material decisions (Zod validation,
  PGlite test engine, pre-infrastructure recovery mechanism, decimals
  cross-check independence);
- generation-0 scoped artifacts preserved at `specs/g0-contracts-data-truth/`
  (historical record; this directory supersedes them for execution).

Broken at this exact HEAD (the generation-1 delta, each probe-proven):

1. **Root tooling configuration lost in transplant.** The salvaged branch kept
   the bootstrap `tsconfig.json` (includes only `tests/**/*.ts`) and a base
   config without `allowImportingTsExtensions`. Consequence measured at this
   HEAD: `pnpm typecheck` fails with 105 TS5097 errors (`.ts`-extension imports
   are repo style under NodeNext); the glob-driven-tooling acceptance suite
   (`tests/acceptance/tooling-globs.spec.ts`) fails its two tsconfig assertions.
   Probe proof: restoring the generation-0 shape of both root configs (both are
   enumerated writeScopes of this package) flips typecheck to exit 0 and flips
   those assertions green. The package objective explicitly assigns
   glob-driven root configuration to THIS package, so restoring it here is
   in-scope core work, not a workaround.
2. **Verification-infrastructure headroom.** With configs restored,
   `tests/automation/gate-e2e-green|red` fail because the nested FULL gate they
   spawn executes the salvaged PGlite-heavy suites, whose `beforeAll`
   database-bootstrap hooks exceed Vitest's default 10-second hook timeout
   under nested-suite load (observed on `AC-260` inside both nested runs).
   These hooks live in `tests/acceptance/**` / `tests/negative/**` — in-scope
   files. Fix direction: explicit generous timeout declarations on those
   bootstrap hooks (repo precedent: the same load-dependent false-red class was
   already fixed for `testTimeout` in `vitest.config.ts` with a documented
   rationale). Probe proof: after both repairs, only these two suites remain
   red; everything else (432 tests) passes.

Everything else required by the assigned requirements is already delivered and
green at this HEAD once the two gaps close; this generation converges the
package rather than re-implementing it.

## 1. Scope statement

This package owns the data-truth substrate of the system: canonical identity,
immutable observations, point-in-time replay semantics, quality codes, source
lineage, feature-value storage with online/offline parity, and the recovery-tier
(backup / point-in-time recovery) foundation. It is implemented inside the
package's binding write scopes:

```text
package.json  pnpm-workspace.yaml  tsconfig.json  tsconfig.base.json  eslint.config.js
packages/shared-schemas/**   packages/domain/**      packages/persistence/**
packages/evidence/**         packages/object-store/**
migrations/g0_data_*.sql     migrations/g0_dr_*.sql
tests/fixtures/data/**       tests/fixtures/dr/**
tests/acceptance/**          tests/negative/**
telemetry/data.*             telemetry/dr.*
```

Per the milestone decomposition record (`specs/implementation/current-milestone.json`),
recovery orchestration mappings outside `packages/persistence/**`
(workflow-runtime, release-conformance) are reconciled by the
traceability/conformance package at milestone convergence. All
`docs/generated/<family>-surfaces.json` artifacts are generated centrally by
that same package at convergence and are not produced here.

## 2. Assigned requirements (normative text quoted from the authoritative manifest)

All eight assigned requirements are normative level **MUST**, dependency group
**G0**, subsection 38.2 "Data and signal" for the FR-DATA family and 38.43
"MCP, security, recovery, public release, and conformance" for the FR-DR family.

### FR-DATA-001 — Canonical asset/pool/migration identity

- **Normative text (manifest, PRD line 5998)**: "Canonical asset/pool/migration identity."
- **Owner**: `packages/persistence`. **Schema ref**: `packages/shared-schemas/src/data.ts`.
  **Persistence refs**: `migrations/g0_data_*.sql`. **Implementation refs**:
  `packages/persistence/**`, `packages/evidence/**`.
- Binding elaboration from the authoritative contract: identity rules of §11.2
  (`chain_id + canonical_contract_address` identifies an asset representation;
  `asset_id` groups equivalent representations only when equivalence is verified;
  `pool_id` uses chain + DEX + pool address; symbols and names MUST NOT be used as
  identifiers; address normalization MUST be chain-specific; token decimals MUST be
  sourced, cross-checked, and versioned), §11.5 numeric precision (token quantities
  stored as raw integer amounts plus decimals, never only as JavaScript `number`;
  CAIP-2/CAIP-10-compatible canonical identifiers with mapping-quality state), and
  §11.6 migration lineage (`launch_pool -> migration_event -> migrated_pool` edges;
  features MUST avoid double counting liquidity, volume, and holders across
  migration boundaries).

### FR-DATA-002 — Immutable observations and revisions

- **Normative text (manifest, PRD line 5999)**: "Immutable observations and revisions."
- Same owner/schema/persistence/implementation refs as FR-DATA-001.
- Binding elaboration from §13.4: original observations are immutable; provider
  corrections create a new revision; reorg/finality corrections create compensating
  or superseding events without rewriting the original receipt history; current views
  resolve the latest valid revision; replay views resolve the latest revision whose
  `available_at` is within the replay boundary.

### FR-DATA-003 — Point-in-time `available_at` replay

- **Normative text (manifest, PRD line 6000)**: "Point-in-time `available_at` replay."
- Same owner/schema/persistence/implementation refs as FR-DATA-001.
- Binding elaboration from §13.1–13.2 and §13.6: replay at decision time `T` uses
  only records where `available_at <= T`; every `available_at` carries a provenance
  class (`FIRST_PARTY_LIVE_OBSERVED`, `PROVIDER_LIVE_RESPONSE`,
  `AUTHORIZED_PUSH_RECEIVED`, `HISTORICAL_QUERY_FETCHED_LATER`,
  `MANUAL_IMPORT_AVAILABLE`, `DERIVED_FROM_AVAILABLE_INPUTS`,
  `LEARNED_ARTIFACT_PUBLISHED`); `available_at` is never inferred from `event_at`;
  backfill records carry the §13.6 field set and historical-query data cannot enter
  a simulated historical decision before its actual `available_at`; recovery MUST
  NOT backdate observations (§34.10).

### FR-DATA-004 — Online/offline feature consistency

- **Normative text (manifest, PRD line 6001)**: "Online/offline feature consistency."
- Same owner/schema/persistence/implementation refs as FR-DATA-001.
- Binding elaboration from §14.3 (current/recent feature values stored in PostgreSQL
  indexed by asset, profile, feature version, and event time), §14.4 (offline store =
  exported normalized events/features/outcomes), and Constitution principle VI
  (backfills and replays produce results consistent with what live computation would
  have produced at the same event times, within required tolerances).

### FR-DATA-005 — Field-level data-quality codes

- **Normative text (manifest, PRD line 6002)**: "Field-level data-quality codes."
- Same owner/schema/persistence/implementation refs as FR-DATA-001.
- Binding elaboration from §13.9: every normalized field carries one or more explicit
  quality statuses from the §13.9 vocabulary (`VALID`, `MISSING_PROVIDER`,
  `NOT_REQUESTED_BY_POLICY`, …, `RETROSPECTIVE_ONLY`); "`null` alone is insufficient."

### FR-DATA-006 — Source lineage and independence groups

- **Normative text (manifest, PRD line 6003)**: "Source lineage and independence groups."
- Same owner/schema/persistence/implementation refs as FR-DATA-001.
- Binding elaboration from §11.7 (`SourceIdentity`, `SourceDependenceEdge`: a source
  identity distinguishes brand/provider, operation, upstream lineage,
  endpoint/region, and collection method), product ADR-052 (declared upstream lineage
  combined with point-in-time empirical dependence from values/errors/timing/
  outages/fingerprints; acquisition policy state stored before retrieval), and the
  provider-count-is-not-independence invariant (§45 item 8).

### FR-DR-001 — Tiered recovery objectives

- **Normative text (manifest, PRD line 6494)**: "Recovery objectives are tiered:
  critical configuration/decision/alert/audit/evidence-index metadata target RPO at
  most 15 minutes; critical observations/checkpoints target at most 60 minutes;
  replayable raw payloads may target at most 24 hours when rights permit reconstruction."
- **Owner**: `packages/persistence`. **Schema ref**: `packages/shared-schemas/src/dr.ts`.
  **Persistence refs**: `migrations/g0_dr_*.sql`. Implementation mappings outside
  `packages/persistence/**` are reconciled at milestone convergence by the
  traceability/conformance package (see §1).
- Binding elaboration from §34.4 (tiered RPO/RTO table — the strictest applicable
  default governs; deployments may configure stricter targets), §34.9–34.10 (a
  recovery that misses the critical RPO creates an incident and disables affected
  confirmed-opportunity claims until repaired; recovery MUST NOT backdate
  observations or learned artifacts), and §14.9 (storage objects and tables are
  assigned recovery tiers from Section 34).

### FR-DR-002 — PITR or equivalent tested mechanism; object versioning; key separation

- **Normative text (manifest, PRD line 6495)**: "PostgreSQL uses point-in-time recovery
  or an equivalent tested mechanism, object storage uses versioning/immutability where
  supported, and encryption keys/recovery credentials are separately protected and tested."
- Same owner/schema/persistence refs as FR-DR-001.
- Binding elaboration from §34.5 (PostgreSQL with PITR/WAL or equivalent; backups are
  encrypted, access controlled, retention tested, stored in an appropriate failure
  domain; encrypted secret metadata backed up, not plaintext keys unless managed backup
  is supported), §34.6 (restore testing cadence; a restore is successful only when
  hashes, migrations, configuration versions, evidence links, decisions, alerts,
  collector checkpoints, and replay fixtures validate — not merely when the database
  starts), and product ADR-056 (tiered RPO/RTO applied with PostgreSQL PITR, object
  versioning/replication where required, clean-environment destructive restore drills,
  cross-store verification, collector replay/gap integrity, chained/signed audit
  checkpoints).

## 3. Acceptance criteria (quoted from the authoritative manifest §39)

The manifest assigns each requirement above to the family-level acceptance criteria
below. Each AC has both a positive test ref and a negative/failure-path test ref in
the manifest; both exist as executable verification files at this HEAD and must be
green at the converged HEAD. Where full closure of an AC depends on capabilities
owned by later packages, this package delivers the data-layer obligations listed
under "generation-1 obligation" and the remainder is a non-goal recorded in §6.

### 3.1 Data-integrity and temporal-evaluation criteria (FR-DATA family)

| ID     | Normative text (§39)                                                                                                                                                                                     | testClass           | Generation-1 obligation                                                                                                                                                |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-020 | "Replay at time `T` cannot read evidence with `available_at > T`."                                                                                                                                       | point-in-time-data  | Delivered (salvage): replay query layer + negative future-read test. Keep green at converged HEAD.                                                                     |
| AC-021 | "Revisions/reorgs do not erase original observations."                                                                                                                                                   | point-in-time-data  | Delivered (salvage): append-only storage with immutability triggers + mutation/deletion negatives. Keep green; suite bootstrap hooks get explicit timeouts (§0 gap 2). |
| AC-022 | "Asset/pool migration avoids double counting in fixture tests."                                                                                                                                          | point-in-time-data  | Delivered (salvage): migration-lineage edges + deduplicated aggregation fixtures. Keep green.                                                                          |
| AC-023 | "Decimals and address normalization pass chain-specific golden fixtures."                                                                                                                                | point-in-time-data  | Delivered (salvage): chain-specific normalization golden fixtures. Keep green.                                                                                         |
| AC-240 | "…candidates use the same universal decision/action-time function; a non-delivered arm never receives an earlier entry than its counterfactual delivery time."                                           | temporal-evaluation | Substrate delivered (salvage): §13.7 timestamp fields + point-in-time resolution. The universal function itself belongs to evaluation packages (non-goal).             |
| AC-241 | "Replaying the same frozen candidate … differs only in registered policy components; hidden current-data calls fail the replay."                                                                         | temporal-evaluation | Substrate delivered (salvage): frozen-replay read paths with no current-state bypass. Policy-component machinery later.                                                |
| AC-242 | "Evidence not requested by policy is stored as `NOT_REQUESTED_BY_POLICY`, not `RETURNED_EMPTY`, `PROVIDER_UNAVAILABLE`, or a negative feature value."                                                    | temporal-evaluation | Storage semantics delivered (salvage): acquisition-decision records with the exact state vocabulary persisted and queryable.                                           |
| AC-243 | "Every randomized evidence probe stores eligibility stratum, nonzero assignment probability, seed provenance, selection timestamp, requested fields, and final decision impact before outcome maturity." | temporal-evaluation | Schema/storage obligations delivered (salvage): write-before-retrieval ordering enforced at the storage contract level. Randomization engine later.                    |
| AC-244 | "A feature learned only from selectively deep-researched candidates cannot claim full-universe lift…"                                                                                                    | temporal-evaluation | Minimal substrate delivered (salvage): feature values carry version/code-version/event-time/population provenance fields. Lift-claim logic later.                      |
| AC-245 | "Provider pairs with strongly correlated timing, values/errors, outages, and first-seen behavior receive reduced empirical independence credit despite different provider IDs."                          | temporal-evaluation | Dependence-edge storage delivered (salvage). Credit computation later.                                                                                                 |
| AC-246 | "Removing or collapsing each major upstream lineage is included in sensitivity analysis; a policy whose alert gate depends on duplicated evidence cannot be promoted…"                                   | temporal-evaluation | Lineage-collapse substrate delivered (salvage): independence-group membership queries collapse to upstream lineage. Sensitivity/promotion gates later.                 |
| AC-247 | "A retrospective provider-dependence estimate cannot alter a frozen historical evidence count in realizable replay; it is labeled diagnostic unless the estimate was available then."                    | temporal-evaluation | Frozen-count immutability delivered (salvage); estimate labeling via availability-provenance classes.                                                                  |
| AC-248 | "Promotion fails below the registered mature success/failure/risk counts, cluster effective sample size, calendar/regime coverage, or interval precision even when point estimate is favorable."         | temporal-evaluation | Non-goal beyond substrate: promotion machinery later packages; this package guarantees the immutable, replay-correct counts they consume.                              |
| AC-249 | "Timestamp-shift, availability-backdating placebo, … controls show no unexplained material lift; any failure blocks promotion."                                                                          | temporal-evaluation | Availability-backdating placebo fixture delivered (salvage) against the no-backdating rule; full promotion blocking later.                                             |

### 3.2 Recovery criteria (FR-DR family)

| ID     | Normative text (§39)                                                                                                                                                                                                                                   | testClass             | Generation-1 obligation                                                                                                                                                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-060 | "Internal overhead targets are met on benchmark workload."                                                                                                                                                                                             | operations-recovery   | Benchmark fixtures delivered (salvage) for persistence hot paths; end-to-end overhead targets close in later integration packages. Keep green.                                                                                                                                                                      |
| AC-061 | "Provider outage returns explicit partial/insufficient output and suppresses unsafe automated alerts."                                                                                                                                                 | operations-recovery   | Vocabulary/state substrate delivered (salvage); outage wiring and alert suppression later. Keep green.                                                                                                                                                                                                              |
| AC-062 | "Backup restore meets configured RPO/RTO in a restore drill."                                                                                                                                                                                          | operations-recovery   | Delivered (salvage) for persistence/object tiers: deterministic restore-drill harness measuring achieved RPO/RTO against configured tiers. Keep green.                                                                                                                                                              |
| AC-260 | "A destructive restore drill recovers critical configuration, decisions, alerts, audit/evidence indexes within the declared 15-minute RPO and critical observations/checkpoints within the declared 60-minute RPO, or blocks active opportunity mode." | recovery-traceability | Delivered (salvage) for database/evidence-index/observation/checkpoint tiers including the degraded/blocked recovery-health state record. NOTE: this suite's DB-bootstrap hook is the observed 10-second-default victim (§0 gap 2) and gets the explicit-timeout repair. Opportunity-mode gating integration later. |
| AC-261 | "Restore into a clean environment verifies database/object hashes, migrations, audit chain, cross-store references, workflow/inbox/outbox state, quota reservations, and collector checkpoint/gaps before automation resumes."                         | recovery-traceability | Verifier delivered (salvage) for DB hash/migration/object/cross-store/checkpoint checks; audit-chain verification attaches via interface from the security package; workflow/quota checks land with their owning packages through the same verifier interface.                                                      |
| AC-262 | "Failure to meet a recovery tier automatically degrades the affected capability and prevents confirmed opportunity alerts while preserving safe deterministic risk monitoring."                                                                        | recovery-traceability | Tier-violation detection → machine-readable degraded-capability state delivered (salvage); alert-policy wiring later.                                                                                                                                                                                               |
| AC-263 | "Collector recovery from backup plus live replay neither skips an unmarked gap nor duplicates a canonical event/first-seen record."                                                                                                                    | recovery-traceability | Storage-contract substrate delivered (salvage): fenced checkpoints, gap registry, idempotent canonical-event constraints. Collector behavior itself is another package.                                                                                                                                             |
| AC-264 | "Backup retention, encryption, location, rights, legal hold, deletion, key access, and restore credentials are validated by policy tests."                                                                                                             | recovery-traceability | Delivered (salvage): machine-readable backup policies plus the policy-test battery across all eight dimensions. Keep green.                                                                                                                                                                                         |

## 4. Applicable architecture invariants (PRD §45)

The manifest lists the first ten §45 invariants as controls for every requirement in
this package. Their normative texts:

| ID      | Text (PRD §45)                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-001 | "The system is permanently read-only with respect to financial execution, custody, signing, and transaction construction."                                                |
| INV-002 | "Agent intelligence never replaces deterministic identity, evidence, time, execution, risk, capability, rights, cost, quota, capacity, or policy controls."               |
| INV-003 | "No automated external side effect occurs directly from model output."                                                                                                    |
| INV-004 | "Every retained decision is reconstructable from frozen evidence, availability, acquisition state, configuration, code, adapter, and artifact versions."                  |
| INV-005 | "Historical replay uses only data and learned artifacts actually available to the system at the simulated time."                                                          |
| INV-006 | "Backfilled historical data is never backdated into production replay."                                                                                                   |
| INV-007 | "Evaluation includes alerts, watches, ignores, rejects, below-cutoff cases, exploration/control cases, and missed opportunities under symmetric action-time semantics."   |
| INV-008 | "Provider count is not source independence; declared lineage and empirical dependence both constrain effective confirmation."                                             |
| INV-009 | "A durable workflow or collector may retry; every state transition and external side effect remains idempotent and fenced."                                               |
| INV-010 | "The primary policy objective is conservative net shadow-portfolio utility under finite capital and hard constraints, not isolated price appreciation or alert win rate." |

Directly load-bearing for this generation: INV-001 (nothing here introduces any
prohibited capability), INV-004/INV-005 (reconstructability and replay purity),
INV-006 (no backdating), INV-008 (lineage constrains independence), INV-009
(idempotency and fencing). The salvaged implementation carries their substrate
properties; generation 1 must not weaken any of them while repairing §0 gaps.

## 5. Accepted ADRs directly binding this package

Repository ADRs (all ACCEPTED under `docs/adr/`): 0013 (Zod single validation
library, authoritative schemas in `packages/shared-schemas`), 0014 (PGlite
in-process PostgreSQL as TEST engine only; production pools exclusively via
`createProductionPgPool` with precision-retaining timestamp parsers), 0015
(pre-infrastructure recovery mechanism: the deterministic snapshot-and-replay
restore harness implements FR-DR-002's "equivalent tested mechanism" until
production infrastructure exists), 0016 (decimals CROSS_CHECKED independence is
best-effort over registered identities). Product-contract ADRs binding the data
and recovery families: ADR-001 (PostgreSQL authoritative, migrations are schema
truth), ADR-003 (S3-compatible object adapter, staged cross-store commit),
ADR-049 (preserve event time; availability = earliest proven system
availability), ADR-052 (declared lineage + empirical dependence), ADR-056
(tiered RPO/RTO, PITR, destructive drills), ADR-058 (release-blocking machine-
readable manifest).

## 6. Explicit non-goals (everything else in milestone G0)

This package plans ONLY its eight assigned requirements. The following are out
of scope and belong to other G0 packages per
`specs/implementation/current-milestone.json`; their absence here is deliberate:

- Read-only security perimeter: hash-chained audit chain, step-up authentication,
  egress/SSRF controls, untrusted-content isolation, secrets/supply-chain policy,
  import gating, tenant isolation, prohibited-capability scanning
  (security-perimeter package; AC-261 audit-chain verification integrates with
  this package's restore verifier through an interface, but the chain itself is
  not built here).
- Shared Tool Core registry and pipeline, cache/single-flight, license-policy
  extension points (tool-core package).
- Provider lifecycle truth, adapter auditing, quarantines, fingerprints
  (provider-lifecycle package).
- Cost/quota/capacity control plane (cost-capacity package).
- Solana collector, protocol decoders, discovery universe, cheap monitoring
  (first-party-observation package; this package supplies only the checkpoint/
  gap/first-seen storage contracts they use).
- MCP surface, auth profiles, transport conformance (mcp-surface package).
- Requirement-manifest tooling, release conformance, surface-map generation,
  telemetry ownership reconciliation (traceability/conformance package).
- Production PostgreSQL cluster provisioning, WAL archiving infrastructure, and
  deployment topology (operations/deployment concerns outside these write
  scopes); this package delivers the recovery-tier registry, backup/restore
  mechanism interfaces with a deterministically tested equivalent mechanism,
  and drill harness that production infrastructure configures.
- Control-plane/automation scripts (`scripts/automation/**`, root
  `vitest.config.ts`) are NOT written by this package: the §0 gap-2 repair is
  implemented entirely inside in-scope `tests/acceptance/**` /
  `tests/negative/**` files. Any global-config headroom improvement remains
  control-plane ownership (recorded in the run's out-of-scope notes).
- Empirical dependence estimation algorithms, promotion-gate machinery,
  evaluation-integrity statistics (later milestones consume this package's
  lineage/dependence-edge substrate).
- Any trading execution, custody, wallet signing, private-key handling, or
  transaction submission capability — permanently prohibited
  (READ_ONLY_NO_TRADING_CUSTODY_SIGNING); nothing in this package designs,
  references, or permits such capability.

## 7. Package success criteria

1. All eight assigned requirements keep executable positive AND negative/
   failure-path verification at the manifest-declared test paths, green at the
   converged HEAD.
2. The two probe-diagnosed generation gaps are closed: (a) glob-driven root
   TypeScript configuration restored so typecheck covers packages and tests and
   later G0 packages need zero root edits — proven by
   `tests/acceptance/tooling-globs.spec.ts`; (b) DB-bootstrap hooks in salvaged
   suites declare explicit generous timeouts so nested full-gate runs are free
   of load-dependent false reds.
3. `pnpm verify` and `pnpm spec:verify` pass at the pushed HEAD, plus the four
   package verification commands from the milestone record.
4. Migrations continue to apply cleanly to empty databases; immutability,
   replay-boundary, no-backdating, and idempotency properties hold under the
   adversarial (negative) suites, unchanged in strength.
5. No template placeholders remain in any scoped artifact; every task traces to
   an assigned requirement or its acceptance criteria.

## 8. Assumptions

- PGlite remains the deterministic test engine (ADR-0014); production remains
  real PostgreSQL per product ADR-001.
- Telemetry catalogs stay declarative; emission wiring lands with observability
  work in later packages.
- Golden fixtures remain synthetic vectors constructed for this repository.
- The generation-0 artifact set under `specs/g0-contracts-data-truth/` is
  retained untouched as historical provenance; this `@g1` directory is
  authoritative for the current execution.
