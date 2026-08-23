# Work-Package Specification: g0-contracts-data-truth

> **SUBORDINATION NOTICE**: This file is a **scoped Spec Kit derivative** of the
> authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md` and its
> machine-readable requirement manifest
> (`docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json`).
> It is subordinate to the PRD in all cases. Where this file and the PRD appear
> to conflict, the PRD wins and the conflict is recorded as an ADR. Nothing here
> edits, weakens, or reinterprets an authoritative requirement.

| Field | Value |
| --- | --- |
| Milestone | G0 (foundation) |
| Package id | `g0-contracts-data-truth` |
| Risk | CRITICAL |
| Dependencies | none (first package in the milestone) |
| Normative source | PRD §38.2 (FR-DATA family), §38.43 (FR-DR family), §39 acceptance criteria, §45 architecture invariants; the manifest entries for these requirements carry `line` anchors 5998–6003 (FR-DATA) and 6494–6495 (FR-DR) into that PRD file (the manifest itself is single-line JSON) |
| Package objective | Establish the canonical data-truth foundation: versioned chain/asset/pool/launch/migration identity, immutable observations with revisions, point-in-time `available_at` replay with no-backdating, field-level quality codes, online/offline feature consistency, source lineage and independence groups, and tiered backup/PITR durability with separately protected encryption keys and recovery credentials over the shared persistence, object-store, and schema layers — plus glob-driven root tooling configuration so later G0 packages need zero root-config edits. |

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
FR-DR recovery orchestration is delivered by this package through
`packages/persistence/**` (the manifest-declared owner); its
workflow-runtime and release-conformance implementation mappings are reconciled
by the traceability/conformance package at milestone convergence. All
`docs/generated/<family>-surfaces.json` artifacts are generated centrally by that
same package at convergence and are not produced here.

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
  backfill records carry the §13.6 fields and historical-query data cannot enter a
  simulated historical decision before its actual `available_at`; recovery MUST NOT
  backdate observations (§34.10).

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
  endpoint/region, and collection method), ADR-052 (declared upstream lineage
  combined with point-in-time empirical dependence from values/errors/timing/
  outages/fingerprints; acquisition policy state stored before retrieval), and
  INV-008 (provider count is not source independence).

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
  starts), and ADR-056 (tiered RPO/RTO applied with PostgreSQL PITR, object
  versioning/replication where required, clean-environment destructive restore drills,
  cross-store verification, collector replay/gap integrity, chained/signed audit
  checkpoints).

## 3. Acceptance criteria (quoted from the authoritative manifest §39)

The manifest assigns each requirement above to the family-level acceptance criteria
below. Each AC has both a positive test ref and a negative/failure-path test ref in
the manifest; both must exist as executable verification. Where full closure of an
AC depends on capabilities owned by later packages, this package delivers the
data-layer obligations listed under "scoped obligation" and the remainder is a
non-goal recorded in §6.

### 3.1 Data-integrity and temporal-evaluation criteria (FR-DATA family)

| ID | Normative text (§39) | testClass | Scoped obligation in this package |
| --- | --- | --- | --- |
| AC-020 | "Replay at time `T` cannot read evidence with `available_at > T`." | point-in-time-data | Fully owned here: replay query layer over observations/evidence enforcing the boundary, plus negative test attempting future-`available_at` reads. |
| AC-021 | "Revisions/reorgs do not erase original observations." | point-in-time-data | Fully owned here: append-only observation + revision storage with immutability enforcement and compensating-event model; negative tests attempt mutation/deletion. |
| AC-022 | "Asset/pool migration avoids double counting in fixture tests." | point-in-time-data | Owned here: migration-lineage edges and deduplicated aggregation helpers exercised by double-count fixtures. |
| AC-023 | "Decimals and address normalization pass chain-specific golden fixtures." | point-in-time-data | Fully owned here: chain-specific normalization (EVM checksum/case, Solana base58 validation, CAIP-2/CAIP-10 forms) and versioned decimals with golden fixtures under `tests/fixtures/data/`. |
| AC-240 | "…candidates use the same universal decision/action-time function; a non-delivered arm never receives an earlier entry than its counterfactual delivery time." | temporal-evaluation | Substrate owned here: the §13.7 decision/action timestamp fields and point-in-time evidence resolution consumed by the universal function; the function itself belongs to evaluation packages (non-goal). |
| AC-241 | "Replaying the same frozen candidate … differs only in registered policy components; hidden current-data calls fail the replay." | temporal-evaluation | Substrate owned here: frozen-replay read paths that resolve only `available_at <= T` records and expose no current-state bypass; policy-component machinery later. |
| AC-242 | "Evidence not requested by policy is stored as `NOT_REQUESTED_BY_POLICY`, not `RETURNED_EMPTY`, `PROVIDER_UNAVAILABLE`, or a negative feature value." | temporal-evaluation | Storage semantics fully owned here: acquisition-decision records (§13.8) with the exact state vocabulary persisted and queryable. |
| AC-243 | "Every randomized evidence probe stores eligibility stratum, nonzero assignment probability, seed provenance, selection timestamp, requested fields, and final decision impact before outcome maturity." | temporal-evaluation | Schema/storage obligations owned here: acquisition records persist those fields with write-before-retrieval ordering enforced at the storage contract level; the randomization engine itself later. |
| AC-244 | "A feature learned only from selectively deep-researched candidates cannot claim full-universe lift…" | temporal-evaluation | Minimal substrate: feature values carry feature version, computation code version, event time, and population/lineage provenance fields enabling later selection-adjustment checks; the lift-claim logic itself later. |
| AC-245 | "Provider pairs with strongly correlated timing, values/errors, outages, and first-seen behavior receive reduced empirical independence credit despite different provider IDs." | temporal-evaluation | Dependence-edge storage owned here: pairwise empirical-dependence edge records keyed by declared lineage + observed correlation inputs; credit computation later. |
| AC-246 | "Removing or collapsing each major upstream lineage is included in sensitivity analysis; a policy whose alert gate depends on duplicated evidence cannot be promoted…" | temporal-evaluation | Lineage-collapse substrate owned here: independence-group membership queries that collapse to upstream lineage; sensitivity analysis and promotion gates later. |
| AC-247 | "A retrospective provider-dependence estimate cannot alter a frozen historical evidence count in realizable replay; it is labeled diagnostic unless the estimate was available then." | temporal-evaluation | Frozen-count immutability owned here: historical evidence counts resolved through replay boundaries cannot be mutated by later estimates; estimate labeling via availability-provenance classes. |
| AC-248 | "Promotion fails below the registered mature success/failure/risk counts, cluster effective sample size, calendar/regime coverage, or interval precision…" | temporal-evaluation | Non-goal beyond substrate: promotion machinery later packages; this package guarantees the immutable, replay-correct counts they consume. |
| AC-249 | "Timestamp-shift, availability-backdating placebo, … controls show no unexplained material lift; any failure blocks promotion." | temporal-evaluation | The availability-backdating placebo control operates on this package's no-backdating rule: fixture-level placebo checks owned here; full promotion blocking later. |

### 3.2 Recovery criteria (FR-DR family)

| ID | Normative text (§39) | testClass | Scoped obligation in this package |
| --- | --- | --- | --- |
| AC-060 | "Internal overhead targets are met on benchmark workload." | operations-recovery | Benchmark fixtures for the persistence hot paths (identity lookup, replay reads) delivered here; end-to-end overhead targets close in later integration packages. |
| AC-061 | "Provider outage returns explicit partial/insufficient output and suppresses unsafe automated alerts." | operations-recovery | Vocabulary and state substrate owned here (quality codes, acquisition states, degradation states); provider outage handling and alert suppression wiring later. |
| AC-062 | "Backup restore meets configured RPO/RTO in a restore drill." | operations-recovery | Fully owned here for the persistence/object tiers: deterministic restore-drill harness measuring achieved RPO/RTO against configured tiers. |
| AC-260 | "A destructive restore drill recovers critical configuration, decisions, alerts, audit/evidence indexes within the declared 15-minute RPO and critical observations/checkpoints within the declared 60-minute RPO, or blocks active opportunity mode." | recovery-traceability | Owned here for database, evidence-index, observation, and checkpoint tiers including the degraded/blocked recovery-health state record that later packages consult; opportunity-mode gating integration later. |
| AC-261 | "Restore into a clean environment verifies database/object hashes, migrations, audit chain, cross-store references, workflow/inbox/outbox state, quota reservations, and collector checkpoint/gaps before automation resumes." | recovery-traceability | Verifier owned here for database hash/migration verification, object hashes, cross-store references, and checkpoint/gap integrity; audit-chain verification plugs in via interface from the security package; workflow/quota state checks land with their owning packages through the same verifier interface. |
| AC-262 | "Failure to meet a recovery tier automatically degrades the affected capability and prevents confirmed opportunity alerts while preserving safe deterministic risk monitoring." | recovery-traceability | Tier-violation detection → machine-readable degraded-capability state owned here; alert-policy wiring later. |
| AC-263 | "Collector recovery from backup plus live replay neither skips an unmarked gap nor duplicates a canonical event/first-seen record." | recovery-traceability | Storage-contract substrate owned here: fenced checkpoints, gap registry, and idempotent canonical-event constraints proving restore+replay correctness at the storage layer; collector behavior itself is another package. |
| AC-264 | "Backup retention, encryption, location, rights, legal hold, deletion, key access, and restore credentials are validated by policy tests." | recovery-traceability | Fully owned here: machine-readable backup policies plus policy tests validating retention, encryption, location, rights, legal hold, deletion, separated key access, and restore-credential handling. |

## 4. Applicable architecture invariants (manifest §45)

The manifest lists INV-001 through INV-010 as controls for every requirement in
this package. Their normative texts:

| ID | Text (PRD §45) |
| --- | --- |
| INV-001 | "The system is permanently read-only with respect to financial execution, custody, signing, and transaction construction." |
| INV-002 | "Agent intelligence never replaces deterministic identity, evidence, time, execution, risk, capability, rights, cost, quota, capacity, or policy controls." |
| INV-003 | "No automated external side effect occurs directly from model output." |
| INV-004 | "Every retained decision is reconstructable from frozen evidence, availability, acquisition state, configuration, code, adapter, and artifact versions." |
| INV-005 | "Historical replay uses only data and learned artifacts actually available to the system at the simulated time." |
| INV-006 | "Backfilled historical data is never backdated into production replay." |
| INV-007 | "Evaluation includes alerts, watches, ignores, rejects, below-cutoff cases, exploration/control cases, and missed opportunities under symmetric action-time semantics." |
| INV-008 | "Provider count is not source independence; declared lineage and empirical dependence both constrain effective confirmation." |
| INV-009 | "A durable workflow or collector may retry; every state transition and external side effect remains idempotent and fenced." |
| INV-010 | "The primary policy objective is conservative net shadow-portfolio utility under finite capital and hard constraints, not isolated price appreciation or alert win rate." |

Directly load-bearing for this package: INV-001 (nothing here may introduce any
prohibited capability), INV-004/INV-005 (reconstructability and replay purity),
INV-006 (no backdating), INV-008 (lineage constrains independence), INV-009
(idempotency and fencing). Each invariant has its own repository-level test ref;
this package contributes the substrate properties those tests exercise for data
truth (see tasks).

## 5. Accepted product ADRs directly binding this package

Quoted/summarized from Appendix D (all ACCEPTED):

- **ADR-001**: PostgreSQL is authoritative for operational state. SQL migrations
  are the schema source of truth; Drizzle mirrors them for typed access. Unique
  constraints, transactions, row/advisory locks, leases with fencing tokens,
  transactional outbox/inbox, and appropriate isolation levels enforce correctness.
- **ADR-003**: S3-compatible `ObjectStoreAdapter`; objects are content-addressed,
  rights-aware, encrypted, versioned where required, committed through the §14.8
  cross-store staged protocol.
- **ADR-049**: preserve chain `event_at`; set `available_at` to actual live
  receipt/commit or recovery time; symmetric decision/delivery timestamps; no arm
  receives an earlier executable entry.
- **ADR-052**: declared upstream lineage combined with point-in-time empirical
  dependence; acquisition policy state stored before retrieval.
- **ADR-056**: tiered RPO/RTO with PostgreSQL PITR, object versioning/replication
  where required, clean-environment destructive restore drills, cross-store
  verification, collector replay/gap integrity.
- **ADR-058**: release-blocking canonical machine-readable manifest (context for
  why IDs and hashes are preserved verbatim in schemas and migrations).

## 6. Explicit non-goals (everything else in milestone G0)

This package plans ONLY its eight assigned requirements. The following are out of
scope and belong to other G0 packages per
`specs/implementation/current-milestone.json`; their absence here is deliberate:

- Read-only security perimeter: hash-chained audit chain, step-up authentication,
  egress/SSRF controls, untrusted-content isolation, secrets/supply-chain policy,
  import gating, tenant isolation, prohibited-capability scanning
  (security-perimeter package; note: AC-261 audit-chain verification integrates
  with this package's restore verifier through an interface, but the chain itself
  is not built here).
- Shared Tool Core registry and pipeline, cache/single-flight, license policy
  extension points (tool-core package).
- Provider lifecycle truth, adapter auditing, quarantines, fingerprints
  (provider-lifecycle package).
- Cost/quota/capacity control plane (cost-capacity package).
- Solana collector, protocol decoders, discovery universe, cheap monitoring
  (first-party-observation package; this package supplies only the checkpoint/gap/
  first-seen storage contracts they will use).
- MCP surface, auth profiles, transport conformance (mcp-surface package).
- Requirement-manifest tooling, release conformance, surface-map generation,
  telemetry ownership reconciliation (traceability/conformance package).
- Production PostgreSQL cluster provisioning, WAL archiving infrastructure, and
  deployment topology (operations/deployment concerns outside these write scopes);
  this package delivers the recovery-tier registry, backup/restore mechanism
  interfaces with a deterministically tested equivalent mechanism, and drill
  harness that production infrastructure configures.
- Empirical dependence estimation algorithms, promotion/promotion-gate machinery,
  evaluation-integrity statistics (later milestones consume this package's
  lineage/dependence-edge substrate).
- Any trading execution, custody, wallet signing, private-key handling, or
  transaction submission capability — permanently prohibited
  (READ_ONLY_NO_TRADING_CUSTODY_SIGNING); nothing in this package designs,
  references, or permits such capability.

## 7. Package success criteria

1. All eight assigned requirements have executable positive AND negative/failure-
   path verification at the manifest-declared test paths, green in CI.
2. Migrations apply cleanly to empty databases and are re-runnable without damage;
   immutability, replay-boundary, no-backdating, and idempotency properties hold
   under adversarial (negative) tests, not only happy paths.
3. Root tooling configuration picks up later G0 package paths automatically
   (glob-driven tsconfig/eslint/workspace), verified by a config-shape test.
4. `pnpm verify` and `pnpm spec:verify` pass at the pushed HEAD.
5. No template placeholders remain in any scoped artifact; every task traces to an
   assigned requirement or its acceptance criteria.

## 8. Assumptions

- In-process Postgres (PGlite) serves as the deterministic migration/repository
  test engine; production remains real PostgreSQL per ADR-001 (recorded as a
  proposed ADR in plan.md).
- Telemetry definitions are machine-readable catalogs under `telemetry/data.*`
  and `telemetry/dr.*`; emission wiring lands with observability work in later
  packages.
- Golden fixtures use synthetic addresses/values constructed for this repository
  (no third-party dataset ingestion in this package).
