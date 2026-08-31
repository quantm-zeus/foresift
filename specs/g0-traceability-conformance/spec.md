# g0-traceability-conformance — scoped specification

> This file is a SUBORDINATE DERIVATIVE of the authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`. It was seeded mechanically from
> the requirement manifest by `scripts/automation/bootstrap-package-spec.mjs` (builder v1). The PRD
> always wins over any wording below.

## Authority binding

- Milestone: `G0` (ACTIVE)
- Objective: Close the milestone with release-blocking traceability: the machine-readable
  requirement manifest kept authoritative and integrity-checked, globally unique and stable
  requirement/acceptance/invariant/artifact IDs with explicit supersession links, CI conformance
  that fails on unmapped normative items, orphaned code paths, or implementations outside their
  dependency gate, signed and hashed evidence artifacts for manual/legal/rights/approval gates,
  per-decision requirement/policy/model/tool/version traceability, and reproducible release reports
  with document, manifest, migration, SBOM hashes, conformance results, activation state, and
  rollback target. This package is also the central generator of all
  docs/generated/<family>-surfaces.json surface mappings and reconciles telemetry/surface mapping
  ownership across the milestone at convergence.
- Risk: HIGH · writeScopes: `packages/requirement-manifest/**`, `packages/release-conformance/**`,
  `packages/shared-schemas/**`, `scripts/generate-requirement-manifest/**`,
  `scripts/verify-release-conformance/**`, `docs/generated/**`, `migrations/g0_trace_*.sql`,
  `tests/fixtures/trace/**`, `tests/acceptance/**`, `tests/negative/**`, `telemetry/**`
- Dependencies: `g0-contracts-data-truth` PROVEN, `g0-security-perimeter` PROVEN, `g0-tool-core`
  PROVEN, `g0-provider-lifecycle` PROVEN, `g0-cost-capacity` PROVEN, `g0-first-party-observation`
  PROVEN, `g0-mcp-surface` PROVEN
- Bound inputs at seed time: main `d7f8f02287f7`, manifest `e0f9f1284473`, PRD `baa521d9c67e`

## Assigned requirements (normative text quoted verbatim)

### FR-TRACE-001 — 38. Functional requirements catalogue (PRD line 6506)

> A machine-readable requirement manifest is generated from this PRD and is the release-blocking
> source for every requirement, acceptance criterion, invariant, ADR, dependency group,
> implementation owner, schema, test, surface, telemetry, and activation/rollback mapping.

Normative level: MUST. Acceptance criteria: all 5 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/trace.ts`
- Fixture refs: `tests/fixtures/trace/`
- Telemetry refs: `telemetry/trace.*`

### FR-TRACE-002 — 38. Functional requirements catalogue (PRD line 6507)

> Requirement, acceptance, invariant, ADR, feature, schema, API, tool, policy, artifact, and test
> IDs are globally unique, stable, immutable once released, and replaced only through explicit
> deprecation/supersession links.

Normative level: MUST. Acceptance criteria: all 5 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/trace.ts`
- Fixture refs: `tests/fixtures/trace/`
- Telemetry refs: `telemetry/trace.*`

### FR-TRACE-003 — 38. Functional requirements catalogue (PRD line 6508)

> CI fails when a normative item lacks implementation/test/owner mapping, a mapped code path no
> longer exists, a requirement is implemented outside its dependency gate, or generated
> documentation differs from the manifest.

Normative level: MUST. Acceptance criteria: all 5 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/trace.ts`
- Fixture refs: `tests/fixtures/trace/`
- Telemetry refs: `telemetry/trace.*`

### FR-TRACE-004 — 38. Functional requirements catalogue (PRD line 6509)

> Manual, legal, rights, statistical, and owner-approval gates produce signed/hashed evidence
> artifacts with approver, scope, expiration, and revocation semantics rather than unchecked
> booleans.

Normative level: MUST. Acceptance criteria: all 5 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/trace.ts`
- Fixture refs: `tests/fixtures/trace/`
- Telemetry refs: `telemetry/trace.*`

### FR-TRACE-005 — 38. Functional requirements catalogue (PRD line 6510)

> Every production decision and alert stores the exact
> requirement/policy/feature/model/tool/provider/adapter/artifact versions and test/conformance
> release that authorized its behavior.

Normative level: MUST. Acceptance criteria: all 5 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/trace.ts`
- Fixture refs: `tests/fixtures/trace/`
- Telemetry refs: `telemetry/trace.*`

### FR-TRACE-006 — 38. Functional requirements catalogue (PRD line 6511)

> Release reports include document hash, manifest hash, migration/schema hashes, dependency/SBOM
> hash, conformance results, unresolved deviations, activation state, and rollback target.

Normative level: MUST. Acceptance criteria: all 5 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/trace.ts`
- Fixture refs: `tests/fixtures/trace/`
- Telemetry refs: `telemetry/trace.*`

## Shared acceptance criteria

Attached to more than one requirement of this package — implement once, satisfy everywhere:

- **AC-265** · positive: `tests/acceptance/AC-265.spec.ts` · negative/failure:
  `tests/negative/AC-265.negative.spec.ts` — attached to 6 requirements
- **AC-266** · positive: `tests/acceptance/AC-266.spec.ts` · negative/failure:
  `tests/negative/AC-266.negative.spec.ts` — attached to 6 requirements
- **AC-267** · positive: `tests/acceptance/AC-267.spec.ts` · negative/failure:
  `tests/negative/AC-267.negative.spec.ts` — attached to 6 requirements
- **AC-268** · positive: `tests/acceptance/AC-268.spec.ts` · negative/failure:
  `tests/negative/AC-268.negative.spec.ts` — attached to 6 requirements
- **AC-269** · positive: `tests/acceptance/AC-269.spec.ts` · negative/failure:
  `tests/negative/AC-269.negative.spec.ts` — attached to 6 requirements

## Non-goals

Everything below is OUT OF SCOPE for this package:

- `g0-contracts-data-truth`: Establish the canonical data-truth foundation: versioned
  chain/asset/pool/launch/migration identity, immutable observations with revisions, point-in-time
  available_at replay with no-backdating, field-level quality codes, online/offline feature
  consistency, source lineage and independence groups, and tiered backup/PITR durability with
  separately protected encryption keys and recovery credentials over the shared persistence,
  object-store, and schema layers. This package also lands glob-driven root
  tsconfig/eslint/package/workspace configuration that picks up every later G0 package path
  automatically so subsequent packages need zero root-config edits. FR-DR recovery orchestration is
  delivered in G0 through packages/persistence/** (the manifest-declared owner); its
  workflow-runtime and release-conformance implementation mappings are reconciled by
  g0-traceability-conformance at milestone convergence.
- `g0-security-perimeter`: Stand up the permanent read-only security perimeter: append-only
  hash-chained audit chain with continuous verification, phishing-resistant step-up authentication
  primitives, deny-by-default egress/SSRF controls with rebinding tests, untrusted-content
  isolation, secrets and supply-chain policy, Alpha Lab import gating (approved non-executable
  schemas only, signature/hash/producer-trust verification, quarantine and content scanning, no
  direct policy activation), tenant-isolation and abuse-control primitives, incident process, and
  automated static/runtime proofs that no trading, custody, wallet-signing, private-key, or
  transaction-submission capability exists anywhere in the codebase.
- `g0-tool-core`: Implement the Shared Tool Core: a central versioned tool registry driving the
  exact authenticate-authorize-validate-cache-single-flight-quota-reserve-execute-audit pipeline
  with provenance, event-time, quality, and evidence envelopes; narrow actor/tool profiles; cache
  and cross-mode single-flight semantics; atomic quota reservation/commit/release; license-policy
  enforcement; and permanent prohibited-financial enforcement. The quota reservation/commit/release
  stage and the license-policy source land as stable extension-point interfaces (contracts plus
  dependency-injection seams) so later packages implement cost and quota semantics entirely outside
  packages/tool-core/** without editing it.
- `g0-provider-lifecycle`: Deliver provider operation lifecycle truth: stateful lifecycle
  (DISCOVERED through REMOVED) with documentation/pricing/rights verification TTLs that fail closed,
  deprecation rules for new implementations, audited read-only adapters bound to exact egress
  allowlists (GMGN strictly query-only, Helius supported raw/history operations), quarantine of
  responses carrying transaction payloads or key material, rights-change fail-closed handling, and
  source fingerprints for empirical dependence analysis.
- `g0-cost-capacity`: Operate the free-first cost, quota, and sustainable-capacity control plane:
  declared cost classes, quota units, reset policies, and STRICT_FREE permission for every provider
  operation; STRICT_FREE blocking of paid, unknown-cost, and fallback operations with audited
  denials; protected reserves; degrade-breadth/depth-before-protected-quota; batch coalescing and
  exact-cache/single-flight ahead of reservation; verified-plan cost forecasts; separately activated
  paid-provider mode; and independently capped
  scheduler/workflow/database/object-store/notification/model resource budgets with data-provider
  STRICT_FREE independent from any configured BYOK model budget. Cost and quota semantics implement
  the tool-core extension-point interfaces without editing packages/tool-core/**.
- `g0-first-party-observation`: Provide bounded first-party observation: the versioned allowlisted
  Solana collector and protocol registry (Pump bonding curve/PumpSwap, Raydium AMM
  v4/CPMM/CLMM/Stable AMM/LaunchLab, Orca Whirlpools, Meteora DLMM/DAMM v1-v2/DBC, Jupiter route
  observation) with durable monotonic checkpoints, gap detection and non-backdating backfill,
  reorg-safe immutable revisions, decode-drift incident pausing, deterministic bounded failover,
  Sustainable Capacity Contract ceilings, health and first-seen timing metrics, and zero
  signing/wallet capability; plus the point-in-time discovery-universe registry making free
  aggregate discovery the default broad-universe path, with complete first-seen attribution, finite
  batch-oriented monitoring, and deterministic versioned candidate promotion. External collector
  access flows through the security perimeter's egress controls and audited read-only adapter layer.
- `g0-mcp-surface`: Expose the MCP Streamable HTTP surface: tools, resources, and prompts served
  from the Shared Tool Core registry with structured output and pagination; per-client
  authentication, profiles, quotas, and revocation plus personal bearer mode; exact scheme-host-port
  Origin allowlist rejection (HTTP 403) before session creation or any side effect; mutually tested
  transport protocol versions, content types, session identifiers, resumable-event ownership,
  message size limits, and per-client rate/concurrency limits; and authorization re-evaluated on
  every call and resource fetch - strictly read-only with no trading, custody, or signing capability
  exposed to any client.

<!-- Seeded normative content ends here. Planner-owned sections (integration notes,
     invariants, open points resolved from authoritative sources) go below this line. -->

## Scoped interpretation (planner-owned)

This package is the **traceability and release-conformance substrate**: it builds the two new
workspace packages (`packages/requirement-manifest`, `packages/release-conformance`), the two
zero-dependency CLI tools (`scripts/generate-requirement-manifest`, `scripts/verify-release-conformance`),
the `docs/generated/**` projection layer, the `trace` SQL schema, and the `telemetry/trace.*`
declarative catalog — and it is the milestone-convergence authority for surface-mapping and
telemetry ownership reconciliation. It NEVER edits `docs/spec/**`; the migrated, hash-pinned
requirement manifest stays byte-identical (FR-TRACE-001 is satisfied by keeping it authoritative,
integrity-checked, and machine-consumed — not by rewriting it).

### What is built here

1. **Manifest library (FR-TRACE-001)** — `packages/requirement-manifest` loads
   `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json`, validates it
   structurally (SHA-256 text hashes, PRD line anchors, ID shape, reference integrity, dependency
   DAG, `releaseConformance` count agreement), and exposes typed queries (by family, dependency
   group, owner, AC reverse lookup, surface/telemetry/schema/fixture mapping resolution). The
   four-artifact integrity contract (`SHA256SUMS`, audit hashes, counts) already enforced by
   `pnpm spec:verify` is re-verified from this library so every consumer shares one validator.
2. **ID stability and supersession (FR-TRACE-002)** — uniqueness and stability validation across
   the FR/AC/INV/ADR namespaces (no duplicate ID anywhere in the manifest union, stable
   lexicographic ordering, ID-shape grammar); `trace.ts` carries ID-pattern schemas for the
   runtime ID families (feature, schema, API, tool, policy, artifact, test IDs) so registries
   downstream cannot mint malformed or colliding identifiers; a `trace.id_supersessions`
   insert-only ledger records explicit deprecation/supersession links — replacement without a
   recorded link is refused, and re-numbering or re-using a released ID is a validator failure.
3. **CI conformance (FR-TRACE-003)** — `scripts/verify-release-conformance` fails CI on:
   (a) a normative item lacking non-empty implementation/test/owner mapping;
   (b) an active-group `implementationRef` whose code path does not exist on disk;
   (c) a product path of a LATER dependency group existing before its group gate opens;
   (d) `docs/generated/**` differing from a deterministic regeneration (hand-edit prohibition,
   PRD §42.3).
   Scope bounding: (a) applies to every normative item; (b)–(c) are evaluated against the ACTIVE
   milestone's dependency group (G0) read from
   `specs/implementation/current-milestone.json` — later-group obligations stay
   `NOT_IMPLEMENTED` and produce no product paths until their gate opens. Orphan detection
   (product sources matched by no `implementationRef`) runs against a reviewed exception ledger
   (T007): each exception names the requirement IDs the path serves and a justification, so the
   ledger itself stays traceable and the gate stays fail-closed.
4. **Gate evidence (FR-TRACE-004)** — `packages/release-conformance` implements signed/hashed
   evidence artifacts for MANUAL/LEGAL/RIGHTS/STATISTICAL/OWNER_APPROVAL gates: canonical-JSON
   payload, SHA-256 artifact hash, HMAC-SHA256 signature under a server-side pepper (the proven
   `packages/security` keyed-hash pattern), approver identity, explicit scope (requirement/AC
   IDs the approval covers), expiration instant, and revocation reference. The gate evaluator
   accepts ONLY a valid evidence record — unexpired, unrevoked, scope-covering, hash- and
   signature-verifying — and refuses any unchecked boolean: the negative suite proves that a
   plain boolean column can never satisfy a gate evaluation.
5. **Decision traceability (FR-TRACE-005)** — a `DecisionTrace` record (Zod schema in
   `trace.ts`, insert-only rows in `trace.decision_traces`) captures the exact
   requirement set, policy versions, feature versions, model version, tool name+version,
   provider versions, adapter versions, artifact versions, and the authorizing
   test/conformance release (manifest hash + release report id) for every production decision
   and alert. G0 delivers the complete record contract, the fail-closed store (a trace missing
   any required dimension is refused, never defaulted), and the point-in-time fetch; G1+
   packages write their decisions through it.
6. **Release reports (FR-TRACE-006)** — `packages/release-conformance` + the CLI emit
   `docs/generated/release-conformance.json`: exact document hash, normalized-hash consistency
   (see provenance note below), manifest hash, per-migration/schema hashes, dependency hash and
   a deterministic SBOM component inventory hash (CycloneDX-shaped projection of the pnpm
   lockfile), conformance results (counts, unmapped/orphan/gate findings), unresolved deviations
   (the exception ledger plus any expiring waivers), current activation state (from gate
   evidence), and the tested rollback target (previous approved release-report reference; the
   rollback semantics of the product's rollback requirement and its acceptance criterion are
   honored without widening this package's requirement assignment). Rebuilding from identical
   inputs is byte-identical (canonical JSON).
7. **Surface mapping generation (central convergence duty)** —
   `scripts/generate-requirement-manifest` deterministically regenerates
   `docs/generated/requirements.json` (canonical manifest projection), all
   `docs/generated/<family>-surfaces.json` mappings for the 58 `apiToolUiRef` families, and
   `docs/generated/requirement-manifest.integrity.json`. Each surfaces file maps the family's
   requirements to their surface refs, resolved implementation paths, test refs, telemetry
   catalog, and schema refs, with reconciliation gaps recorded through the exception ledger.
   `--check` mode fails on drift.

### Provenance note carried into release reports

The normalized document hash (`1f9b6590…`) is preserved **as provenance** exactly as recorded in
`docs/migration/SPEC_MIGRATION.md` (the original generator's sentinel scheme is not recoverable):
release reports carry the exact PRD SHA-256, the manifest SHA-256, and the normalized hash, and
verify the recorded normalized hash for cross-artifact CONSISTENCY (manifest ↔ audit) rather than
recomputing it with an unverifiable algorithm. Fabricating a recomputation would be a
verification-integrity violation.

## Planner-owned integration points (proven seams consumed read-only — never edited)

- **`docs/spec/**` (authoritative)** — read-only inputs: PRD, requirements manifest, audit
  artifact, `SHA256SUMS`. Verified through the same checks `scripts/spec-verify.mjs` runs; never
  edited by any task of this package.
- **`packages/persistence`** — `applyMigrations`/`discoverMigrations` (the `trace` migration
  family must be ADDED to `MIGRATION_FILE_PATTERN` and the central expected-script registry —
  the ADR-0019 plan-sanctioned scope exception, `g0_mcp` precedent), `createEngine`,
  `canonicalJson` (the single canonical serializer all trace hashing goes through),
  `PRECISION_RETAINING_TIMESTAMP_PARSERS`. The `public`-schema parity contract of
  `packages/persistence/test/schema-parity.spec.ts` is untouched: `trace` tables live in a
  dedicated `trace` schema with a package-local parity test (the `packages/security` `sec`
  precedent).
- **`packages/security`** — the keyed-hash-at-rest pattern
  (`HMAC-SHA256(pepper, secret)` → `sha256:<hex>`, `packages/security/src/mcp-credentials.ts`)
  reused for gate-evidence signatures; `KeyedHashSchema` from `shared-schemas/src/sec.ts` for
  hash fields; no security module is modified.
- **`packages/domain`** — `ForesiftError`/`ErrorCode` typed-refusal vocabulary; new trace error
  codes are NOT added to the domain enum (that file is outside writeScopes): the two packages
  carry their own typed error hierarchies following the `packages/security/src/errors.ts`
  precedent.
- **`packages/shared-schemas`** — this package ADDS `src/trace.ts` and registers it in
  `src/index.ts`; the nine existing family files are untouched (they are other packages' schema
  territory, already PROVEN).
- **`scripts/spec-verify.mjs`** — consumed as the integrity floor; this package's CLI tools
  ADD conformance checks, never weaken or replace the existing verifier.

## Explicit scope boundaries within the milestone

Beyond the seeded per-package non-goals above, these boundaries are recorded so review cannot
misread them as gaps:

- `docs/spec/**` is never written by this package — including the manifest itself
  (FR-TRACE-001 makes the migrated manifest authoritative and checked; it does not authorize
  regeneration of a file whose bytes are pinned by `SHA256SUMS`).
- Telemetry catalogs of the other nine families (`telemetry/core.catalog.json` …) are owned by
  their PROVEN packages; this package adds ONLY `telemetry/trace.catalog.json`. The root
  `tests/telemetry-catalog.spec.ts` parity suite is outside this package's writeScopes, so
  trace-catalog parity is proven by a package-local test instead of extending that file.
- The remaining §42.3 generated artifacts (`openapi.json`, `mcp-tool-catalog.json`,
  `provider-capability-matrix.json`, `pool-adapter-matrix.json`, `data-rights-matrix.json`)
  need producing packages' runtime inventories (MCP tool catalog, provider registry states) and
  are later-milestone obligations; `requirements.json`, `release-conformance.json`, and the
  58 family-surfaces files are the G0 set this package delivers.
- Activation-gate MACHINERY (module lifecycle transitions, step-up-gated activation flows) is
  the FR-PROD family's territory in later groups; this package supplies the immutable evidence
  and report substrate those flows will consume, and implements none of the lifecycle engine.
- No invariant test files under `tests/invariants/**` are created: that directory is outside
  writeScopes, and invariant proof for G0 already exists through the landed prohibited-
  capability, audit, recovery, and point-in-time suites that reference the same invariant IDs.

## Applicable invariants (manifest securityRightsCostControls, binding here)

- **INV-001** — the traceability substrate is permanently read-only: it inspects, hashes, and
  reports; it never trades, signs, holds custody, or submits transactions (its own code is
  subject to the prohibited-capability scans it does not weaken).
- **INV-002** — the conformance gates are deterministic controls; no agent judgment replaces a
  gate verdict (completion is decided by `package-plan-complete.mjs`, the package gate, and CI —
  never by an AI claim).
- **INV-004** — decision reconstructability is FR-TRACE-005's direct obligation: every retained
  decision carries the exact versions it was authorized by.
- **INV-009** — trace state transitions are insert-only or idempotent: evidence, decision
  traces, release reports, and supersession records never mutate; re-running a report or
  evidence verification produces identical outcomes.
- Sections 9.5 (dependency direction), 33 (performance: generators bounded and deterministic),
  34 (recovery: trace metadata is CRITICAL_METADATA class), 35 (supply-chain: hashes, pinned
  tooling), and 37 (testing: positive + failure-path evidence per the shared acceptance
  criteria) apply as quoted in the seeded control list.

## Risks and mitigations

- **Scope-guard failures from predicted writes** — every task names only writeScope paths plus
  the two ADR-0019/ADR-0020 exceptions (`packages/persistence/src/migrator.ts`,
  `packages/persistence/test/migrator.spec.ts`, `pnpm-lock.yaml`); the central-migration-suite
  duty is named in the migration task so the graph builder accepts it up front (the
  g0-cost-capacity non-convergence lesson).
- **Conformance gate cannot pass before this package lands** — `implementationRefs` pointing at
  `packages/requirement-manifest/**` resolve only after T002; the gate is intentionally
  release-blocking for this package's own completion and the task order makes that
  deterministic (foundation before generators before convergence).
- **Orphan ledger over-reach** — the exception ledger starts minimal (the
  `packages/collector-checkpoints/**`, `packages/collector-gap-recovery/**`, and
  `apps/api` wiring paths observed at convergence), each entry requirement-traced; entries are
  additive-only and every future package lands with its mappings already in the manifest.
- **Fixture-corpus scanner findings** — trace fixtures contain manifest excerpts, hashes, and
  HMAC test keys only; no prohibited-pattern text is needed, so the scanner's exclusion list
  stays untouched (unlike the `sec`/`mcp` fixture precedent).
- **OOM hazard** — new PGlite suites join the DATABASE_PGLITE workload and run only through the
  coordinator (`pnpm test:all` / per-workload scripts); one PGlite instance per suite file, as
  in the existing acceptance helpers.
- **Reproducibility drift** — every generated artifact sorts keys and lines deterministically,
  embeds no timestamps that cannot be injected, and the CLI `--check` mode compares bytes, so CI
  drift failures name the exact file and diff.
