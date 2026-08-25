# Tasks: g0-tool-core

**Input**: `specs/g0-tool-core/spec.md`, `specs/g0-tool-core/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-CORE-001 through FR-CORE-008) or a shared acceptance criterion of those
requirements (spec.md §Shared-acceptance-criteria). Requirement IDs belonging
to other packages never appear here. Tests are mandatory per the PRD evidence
rules: every shared acceptance criterion gets BOTH its manifest-declared
positive spec (`tests/acceptance/AC-*.spec.ts`) AND failure-path spec
(`tests/negative/AC-*.negative.spec.ts`) — created where absent, extended with
a clearly-headed tool-core substrate block where proven packages already own
the file. No task creates, simulates as real, or exposes any prohibited
financial capability.

Format: `- [ ] T### [P?]` — **[P]** = parallelizable with its neighbors
(disjoint files).

## Phase A — Enabling change and contracts foundation (blocks everything)

- [x] T101 Extend the migration filename-family pattern in
      `packages/persistence/src/migrator.ts` from `(data|dr|sec)` to
      `(data|dr|sec|core)` and update its header/doc comments (plan material
      decision 3; the ONLY content edit outside binding writeScopes). Land
      FIRST with `pnpm --filter @foresift/persistence test` green untouched.
      Traces: FR-CORE-001…FR-CORE-008 (their declared `migrations/g0_core_*.sql`
      persistence refs are otherwise unapplyable).
- [x] T102 Scaffold `packages/tool-core` (`@foresift/tool-core`): package.json
      (workspace deps: domain, shared-schemas, persistence, security, evidence,
      object-store), tsconfig extending `tsconfig.base.json`, local
      `vitest.config.ts` mirroring root timeout budgets (plan decision 7 of the
      proven sibling arrangement), `src/index.ts`. Run `pnpm install` so the
      lockfile regenerates mechanically. Verify
      `pnpm --filter @foresift/tool-core test` runs (empty suite acceptable at
      this step). Traces: FR-CORE-001…FR-CORE-008 (carrier package for all
      eight).
- [x] T103 [P] Add `packages/domain/src/tool.ts` with pure contracts:
      `ActionClass` (read-only classes only), `WorkloadClass`
      (INTERACTIVE_HIGH | RISK_MONITOR_HIGH | SCHEDULED_NORMAL |
      EVALUATION_LOW | BACKFILL_LOW), `CacheOutcome` (MISS | HIT_FRESH |
      HIT_STALE | REFRESHED), `QuotaModel` (RATE_ONLY | REQUESTS_PER_PERIOD |
      COMPUTE_UNITS_PER_PERIOD | WEIGHTED_BUCKET | CREDIT_BALANCE |
      UNKNOWN_CONFIGURABLE), `ReservationState` (PENDING | RESERVED |
      COMMITTED | RELEASED | EXPIRED), `BackpressureAction`, `ToolProfileId`
      (the eight §16.9 profiles), freshness-TTL policy table type, pipeline
      stage identifier enum; export from `packages/domain/src/index.ts`.
      Fail-closed resolution helpers following the existing
      `acquisitionState()` style. Unit tests colocated in
      `packages/domain/test/`. Traces: FR-CORE-001, FR-CORE-002, FR-CORE-004,
      FR-CORE-006, FR-CORE-007.
- [x] T104 [P] Add `packages/shared-schemas/src/core.ts`: authoritative Zod
      mirrors of ToolDefinition metadata, ToolResult envelope + meta, cache-key
      components, lease records, reservation records + lifecycle states,
      license verdicts, workload/backpressure enums, blocked-state payloads —
      field lists exactly matching `packages/domain/src/tool.ts`; export from
      `packages/shared-schemas/src/index.ts`. Round-trip schema tests in
      `packages/shared-schemas/test/`. Traces: FR-CORE-002, FR-CORE-003,
      FR-CORE-006, FR-CORE-007, FR-CORE-008.

## Phase B — SQL state machines (g0_core_* family)

- [x] T201 Author `migrations/g0_core_0001_tool_registry.sql`: registry table
      with `(tool_name, tool_version)` uniqueness, definition hash, action
      class, profile list, policy-id references, registered/retired columns;
      immutability triggers over normative fields consistent with the landed
      data-truth migration style. PGlite migration-applies tests.
      Traces: FR-CORE-001, FR-CORE-005.
- [x] T202 [P] Author `migrations/g0_core_0002_single_flight_leases.sql`:
      resource key, monotonic fencing token, holder mode, acquired/expires/
      released timestamps; release guarded to matching token; expired-reacquire
      bumps fence. PGlite tests covering grant/expire/refuse-stale-release.
      Traces: FR-CORE-006.
- [x] T203 [P] Author `migrations/g0_core_0003_quota_reservations.sql`:
      reservation rows with dimension columns, estimated/actual units, state
      machine PENDING→RESERVED→COMMITTED, PENDING|RESERVED→RELEASED,
      RESERVED→EXPIRED enforced via CHECK + guarded UPDATEs; idempotency key on
      (pipeline run, stage). PGlite transition-matrix tests including
      concurrent reserve/commit/release races and retry replays.
      Traces: FR-CORE-007.
- [x] T204 [P] Author `migrations/g0_core_0004_exact_cache.sql`: cache entries
      keyed by canonical-key hash with payload reference, stored/fresh/stale
      windows, license-policy version, rights-permitted flag; point-in-time
      lookup predicate tests. Traces: FR-CORE-006.

## Phase C — Registry and narrow profiles

- [x] T301 Implement `packages/tool-core/src/registry.ts` (FR-CORE-001):
      register/resolve/list-by-profile over immutable `(name, version)`
      entries, sha256 definition-hash pinning over canonical JSON (execute
      excluded), snapshot versioning, additive retirement; persistence wiring
      to the Phase-B table. Registration refuses duplicate version with
      differing hash. Unit suites in `packages/tool-core/test/`.
      Traces: FR-CORE-001.
- [x] T302 [P] Implement `packages/tool-core/src/prohibited.ts` registration
      screen: name/description/schema/action-class screening against the
      security perimeter canary catalog fixtures; refuse trading/signing/
      custody/private-key/transaction-shaped definitions with typed errors;
      audited refusal events. Fixtures under `tests/fixtures/core/` include a
      prohibited-definition corpus (inert data only). Positive refusals +
      clean-pass units. Traces: FR-CORE-005.
- [x] T303 [P] Implement `packages/tool-core/src/profiles.ts` (FR-CORE-004):
      actor→profile→tool-set binding over the eight §16.9 profiles; headless
      agent receives a strict subset of the catalog; provider-specific atomic
      tools visible only to adapter-test/admin-diagnostic/expert-scoped
      profiles; domain tool names from §16.9 seeded as fixture definitions for
      tests. Units assert subset relations and exclusion rules.
      Traces: FR-CORE-004.

## Phase D — Exact caching and cross-mode single-flight

- [x] T401 Implement `packages/tool-core/src/cache-key.ts` (§16.4): exact key =
      canonical JSON over provider, operation, operation_version, chain,
      canonical entity identity, normalized arguments, field projection,
      as-of semantics, license policy; golden-vector fixtures pinning hashes;
      explicit refusal path for financial/identity data classes offered a
      semantic cache (never admitted). Traces: FR-CORE-006.
- [x] T402 [P] Implement `packages/tool-core/src/freshness.ts` (§16.5): typed
      fresh/stale TTL table with the PRD example defaults, per-deployment
      override at composition time, boundary units (fresh-until vs
      stale-until edges). Traces: FR-CORE-006.
- [ ] T403 Implement the cache stage chain in
      `packages/tool-core/src/stages/cache.ts` (stages 6–11): request-local
      memoization → fresh → acceptable-stale → post-lease re-check; store-side
      write only when rights and cache policy permit (stage 20); PIT-safe
      lookups. Units cover order short-circuiting and stale admission rules.
      Traces: FR-CORE-006.
- [ ] T404 Implement `packages/tool-core/src/single-flight.ts` (FR-CORE-006):
      database lease acquisition with fencing token across MCP-manual /
      ChatGPT / admin-chat / automation holder modes; expiry handling;
      release-with-fence-validation refusing stale holders (INV-009);
      concurrency race units on PGlite. Traces: FR-CORE-006.

## Phase E — Extension-point seams (quota + license)

- [ ] T501 Define `packages/tool-core/src/quota-contract.ts` (FR-CORE-007):
      `QuotaReservationAdapter` interface (estimate/admission/reserve/commit/
      release against reservation records), lifecycle enforcement helpers over
      the Phase-B state machine, and composition-root injection seam. The
      shipped default adapter is an explicitly deny-closed TEST double living
      outside `src/` (fixture module) — no production cost semantics here.
      Contract unit tests incl. unknown-cost refusal. Traces: FR-CORE-007.
- [ ] T502 [P] Define `packages/tool-core/src/license-contract.ts`
      (FR-CORE-008): `LicensePolicySource` interface returning typed verdicts
      {allowed, policyVersion, reason}; default fail-closed source that
      refuses any call whose rights status cannot be verified; verdict feeds
      both execution admission and cache-key license component. Units:
      unverifiable-rights refusal, version-pinned allow.
      Traces: FR-CORE-008.
- [ ] T503 Prove seam stability (milestone objective): a reference adapter
      pair DEFINED OUTSIDE `packages/tool-core/src/**` (test-fixture module)
      implements both interfaces and drives the full pipeline without any edit
      to tool-core sources; CI grep asserts tool-core src contains no cost-
      table vocabulary. Traces: FR-CORE-007, FR-CORE-008.

## Phase F — The exact 24-stage execution pipeline

- [ ] T601 Implement `packages/tool-core/src/pipeline.ts` orchestrator
      (FR-CORE-002): stage sequence held as an ordered constant mirroring
      PRD §16.2 stages 1–24 verbatim; pinned-order unit test diffs the runtime
      sequence against the authoritative list; no configuration may skip or
      reorder stages. Traces: FR-CORE-002.
- [ ] T602 Implement `src/stages/authn.ts` + `src/stages/validate.ts`
      (stages 1–4): authenticate via injected perimeter primitive; authorize
      scope/action class/profile/tenant-entity/rights; Zod validate +
      canonicalize input; deterministic acquisition-decision and exact
      authorization-envelope validation. Failure exits produce typed blocked
      states. Traces: FR-CORE-002, FR-CORE-004.
- [ ] T603 Implement `src/stages/acquisition.ts` (stage 5): persist REQUESTED
      or the applicable pre-execution blocked/not-requested state through the
      landed acquisition repo BEFORE any external request, keeping
      NOT_REQUESTED_BY_POLICY / COST_BLOCKED / QUOTA_BLOCKED /
      CAPABILITY_UNAVAILABLE / RIGHTS_BLOCKED distinguishable from retrieval
      failures (AC-242 substrate). Traces: FR-CORE-002, FR-CORE-003.
- [ ] T604 Wire cache + single-flight stages into the pipeline (stages 6–13):
      key calc → memo → fresh → stale → lease → recheck → quota estimate /
      capacity admission → atomic reserve, all via the Phase-D/E seams;
      backpressure outcomes (queue | return-cache | downgrade | skip |
      QUOTA_EXHAUSTED) are explicit typed exits; protected-reserve admission is
      delegated through the quota seam. Traces: FR-CORE-002, FR-CORE-006,
      FR-CORE-007.
- [ ] T605 Implement `src/stages/dispatch.ts` (stages 14–17): call injected
      allowlisted read-only operation adapters with deadline, byte limit, and
      egress-policy enforcement wrapping the perimeter controls; validate
      content type + raw schema (shared-schemas); normalize identity/units/
      timestamps/availability/lineage/quality codes; validate normalized schema
      and semantic invariants. Provider-failure paths map to TIMED_OUT /
      PROVIDER_UNAVAILABLE / INVALID_RESPONSE. Traces: FR-CORE-002, FR-CORE-003.
- [ ] T606 Implement `src/stages/persist.ts` + quota settle (stages 18–22):
      commit or release actual quota/cost per provider semantics through the
      adapter; persist evidence/artifact metadata + source fingerprint;
      update exact cache only when rights and policy permit; release lease with
      fencing validation; persist acquisition outcome, cache/provider source,
      actual cost, evidence IDs, decision impact. Idempotent under retry.
      Traces: FR-CORE-002, FR-CORE-007.
- [ ] T607 Implement `src/stages/audit.ts` (stage 23): append audit + trace for
      success AND every failure/blocked exit through the injected AuditChain;
      event payload carries actor, tool name/version, action class, outcome,
      machine-readable reason; never secret material. Tamper-evident chain
      verification stays owned by the security suite — asserted green here.
      Traces: FR-CORE-002, FR-CORE-005.
- [ ] T608 Implement `src/envelope.ts` assembly (stage 24, FR-CORE-003):
      structured result with data + meta carrying toolName/version, optional
      provider/operation, evidenceIds, observedAt/availableAt/fetchedAt, cache
      outcome, freshnessSeconds, qualityCodes, conflicts, quota summary,
      partial flag, nextCursor/resourceUris; degraded results mark missing
      capabilities explicitly instead of silent gaps. Round-trip schema tests.
      Traces: FR-CORE-003.
- [ ] T609 Implement the execution-time prohibited-financial gate inside the
      pipeline (FR-CORE-005): action-class re-check before dispatch; refuse
      and audit any call whose resolved operation expresses trading/signing/
      custody/transaction construction regardless of registration state.
      Negative-path units with prohibited-call fixtures (inert).
      Traces: FR-CORE-005.

## Phase G — Composition root and telemetry contract

- [ ] T701 Implement `src/index.ts` `createToolCore(...)` composition root:
      injects AuditChain instance, egress enforcer, authn/authz primitives,
      QuotaReservationAdapter, LicensePolicySource, clock; deny-closed defaults
      wherever an adapter is unbound; exports the public surface only.
      Composition tests prove unbound-seam fail-closed behavior.
      Traces: FR-CORE-001…FR-CORE-008.
- [ ] T702 [P] Write `telemetry/core.catalog.json` as the declarative
      event-contract catalog (registry.registered/rejected,
      pipeline.stage/blocked, cache.outcome, singleflight.lease/fence-refused,
      quota.reserved/committed/released/expired, license.verdict,
      prohibited.refused, envelope.degraded) with field lists mirroring
      `packages/shared-schemas/src/core.ts` exactly, marked
      DECLARATIVE_CONTRACT_ONLY per the proven sec-catalog convention (emitter
      wiring belongs to the observability milestone). Catalog-vs-schema parity
      test. Traces: FR-CORE-001, FR-CORE-002, FR-CORE-005, FR-CORE-006,
      FR-CORE-007, FR-CORE-008.

## Phase H — Fixture corpus and manifest-declared suites

- [ ] T801 Build `tests/fixtures/core/`: clean + prohibited tool-definition
      corpora, canned provider payloads (valid/malformed/truncated/slow),
      cache-key golden vectors, clock/lease/race fixtures, profile bindings.
      All inert data; no credentials, no real endpoints.
      Traces: FR-CORE-001, FR-CORE-005, FR-CORE-006.
- [ ] T802 Create `tests/acceptance/AC-001.spec.ts` +
      `tests/negative/AC-001.negative.spec.ts` scoped to the tool-core facet:
      registry lists a scoped domain-tool profile; stubbed free-discovery call
      executes end-to-end through all 24 stages; unavailable optional sources
      degrade explicitly in the envelope; negative asserts no silent gap and
      no out-of-profile tool exposure. Header comments name which facets later
      packages add. Traces: FR-CORE-001, FR-CORE-002, FR-CORE-003, FR-CORE-004.
- [ ] T803 Create AC-002 pos+neg suites (envelope completeness: quality, time,
      provenance, evidence references on every important field; negative:
      result lacking them refused). Traces: FR-CORE-003.
- [ ] T804 Create AC-003 pos+neg suites (cross-mode single-flight: two
      concurrent simulated modes, one provider call within dedupe window;
      negative: stale-holder fencing violation refused). Traces: FR-CORE-006.
- [ ] T805 Create AC-004 pos+neg suites (conflicting provider data preserved in
      conflicts[]; unsupported capability explicit CAPABILITY_UNAVAILABLE;
      negative: silent replacement attempts fail the suite). Traces:
      FR-CORE-002, FR-CORE-003.
- [ ] T806 Extend the AC-020, AC-021, AC-022, and AC-023 suites (+negatives
      already present) with tool-core substrate blocks: as-of cache reads
      cannot see available_at > T (AC-020); revisions leave original
      observations reachable via envelope evidence refs (AC-021); migration
      identity keys avoid double counting (AC-022); normalization goldens flow
      unchanged through stage 16 (AC-023). Traces: FR-CORE-003, FR-CORE-006.
- [ ] T807 Extend AC-050 and AC-254 suites with registry/execution refusal
      substrate blocks (prohibited definitions rejected at registration;
      prohibited calls rejected at dispatch; tree scans stay green); keep the
      security-owned scan blocks untouched. Extend AC-255 with query-fixture
      pass vs prohibited-shape registration failure.
      Traces: FR-CORE-005.
- [ ] T808 Extend AC-051/AC-052/AC-053 suites with tool-core blocks: untrusted
      provider text enters envelopes as content-only; emitted artifacts swept
      for secret material; profile binding rejects out-of-scope tools.
      Traces: FR-CORE-004, FR-CORE-002.
- [ ] T809 Extend the AC-240, AC-241, AC-242, and AC-243 suites with pipeline
      substrate blocks: symmetric action-time fields across workload classes
      incl. EVALUATION_LOW and BACKFILL_LOW (AC-240); replay reads only
      as-of-permitted entries with policy-component-only divergence (AC-241);
      NOT_REQUESTED_BY_POLICY persisted distinctly from empty/unavailable/
      negative values (AC-242); probe metadata persisted before maturity
      (AC-243). Traces: FR-CORE-002, FR-CORE-003.
- [ ] T810 Extend the AC-244, AC-245, AC-246, AC-247, AC-248, and AC-249
      suites minimally: envelope lineage/conflict round-trips these criteria
      consume; no promotion logic lands here. Keep the upstream-owned facets of
      AC-250, AC-251, AC-252, AC-253, AC-256, AC-257, and AC-258 green;
      extend AC-259 with every-exit-audited substrate assertions.
      Traces: FR-CORE-002, FR-CORE-003, FR-CORE-005.
- [ ] T811 Engine unit suites in `packages/tool-core/test/` (see plan Verification
      strategy): pinned stage-order property test; lease fencing matrix;
      reservation transition matrix incl. races; cache-key stability vectors;
      TTL boundaries; profile narrowing subset proofs; deny-closed defaults;
      retry-idempotency of commit/release/audit paths.
      Traces: FR-CORE-002, FR-CORE-006, FR-CORE-007.

## Phase I — Convergence verification

- [ ] T901 Run the milestone-declared verification commands verbatim:
      `test -d packages/domain && pnpm --filter @foresift/domain test`;
      `test -d packages/tool-core && pnpm --filter @foresift/tool-core test`.
      Then the shared aggregate gate `pnpm verify` and `pnpm spec:verify` at
      the pushed HEAD; fix anything they surface before completion is claimed.
      Traces: FR-CORE-001…FR-CORE-008.
- [ ] T902 Confirm extension-point boundary holds: reference adapters from
      outside tool-core drive the pipeline (T503) with zero edits to
      `packages/tool-core/src/**`; record the evidence output in the package's
      verification notes for review. Traces: FR-CORE-007, FR-CORE-008.

## Traceability matrix (requirement → tasks)

| Requirement | Primary tasks                                                         |
| ----------- | --------------------------------------------------------------------- |
| FR-CORE-001 | T101 T102 T103 T201 T301 T302 T303 T701 T702 T801 T802 T901           |
| FR-CORE-002 | T102 T103 T104 T601–T609 T701 T702 T802 T805 T808 T809 T810 T811 T901 |
| FR-CORE-003 | T104 T603 T605 T608 T802 T803 T805 T806 T809 T810 T901                |
| FR-CORE-004 | T103 T303 T602 T802 T808                                              |
| FR-CORE-005 | T201 T302 T607 T609 T702 T801 T807 T810                               |
| FR-CORE-006 | T103 T104 T202 T204 T401–T404 T604 T702 T801 T804 T806 T811           |
| FR-CORE-007 | T101 T103 T104 T203 T501 T503 T604 T606 T702 T811 T902                |
| FR-CORE-008 | T104 T101 T502 T503 T702 T902                                         |

## Milestone verification commands (referenced by T901; run verbatim)

```bash
test -d packages/domain && pnpm --filter @foresift/domain test
test -d packages/tool-core && pnpm --filter @foresift/tool-core test
```

Aggregate gate at convergence: `pnpm verify` and `pnpm spec:verify`.
