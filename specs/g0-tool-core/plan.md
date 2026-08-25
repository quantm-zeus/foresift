# Implementation Plan: g0-tool-core

**Input**: `specs/g0-tool-core/spec.md` (scoped derivative of PRD §16 + manifest
FR-CORE-001…008), `.specify/memory/constitution.md`,
`specs/implementation/current-milestone.json`.
**Authority**: PRD wins over every word below; material decisions are recorded
in the Material-decisions section and as proposed ADR texts.

## Summary

Deliver the Shared Tool Core as one new workspace package (`packages/tool-core`,
`@foresift/tool-core`) plus domain contracts, shared Zod schemas, SQL state
machines, fixtures, and acceptance/negative suites. The package is an engine,
not a policy: registry + exact 24-stage pipeline + envelope, with quota/cost
semantics and license policy behind stable dependency-injection seams that
`g0-cost-capacity` later implements outside this package without editing it.

## Technical Context

- Language/runtime: TypeScript (ESM) in the existing pnpm workspace;
  strict mode inherited from `tsconfig.base.json`; zero new runtime dependencies
  beyond workspace packages (zod already landed via ADR-0013).
- Storage: PostgreSQL via `@foresift/persistence` (`DatabaseEngine` seam);
  tests run on PGlite per ADR-0014. New migration family `g0_core_*`.
- Validation: Zod schemas authoritative in `packages/shared-schemas/src/core.ts`
  (ADR-0013); fail-closed on every validation failure.
- Audit: sole sink is `@foresift/security`'s hash-chained `AuditChain`
  (already PROVEN); tool-core never builds its own chain.
- Test stack: vitest; root config covers `tests/**`, colocated suites via a
  local `packages/tool-core/vitest.config.ts` (proven sibling arrangement).
- Existing code under writeScopes: `packages/domain` (16 modules — acquisition
  states, timestamps, quality, errors), `packages/shared-schemas`
  (data/dr/sec schema modules), shared AC suites for AC-020…023, AC-050…053,
  AC-240…259 already present from proven packages.

## Constitution Check

- **I. Product-Contract Authority**: every task traces to FR-CORE-* / shared
  ACs quoted in spec.md; no `docs/spec/**` edits.
- **II. Greenfield**: designed from PRD §16 only; predecessor repo not consulted.
- **III. Modular-monolith-first**: one engine package + schemas/domain modules;
  no broker, no service split, no speculative abstraction beyond the two seams
  the PRD itself demands (quota adapter, license source).
- **IV. Read-only boundary**: registration-time + execution-time prohibited-
  financial enforcement (FR-CORE-005) reuses the security perimeter's canary
  catalog; nothing here constructs transaction/signing/wallet types.
- **V/VI. PIT & event-time**: cache keys carry explicit as-of semantics; envelope
  distinguishes observedAt/availableAt/fetchedAt; stale tiers never backdate.
- **VII. Provenance/evidence**: stages 19/22 persist evidence IDs, source
  fingerprint, actual cost, decision impact (AC-242/243 substrate).
- **VIII. Fail-closed**: unknown license state, unknown cost class, unverifiable
  rights → refuse (default-deny reference adapters make this executable).
- **IX. Provider abstraction**: stage 14 dispatches through injected read-only
  operation adapters; no vendor SDK enters tool-core.
- **X. Traceability**: tasks.md cites only assigned requirement IDs; AC matrix
  in spec/tasks.
- **XI/XII. Deterministic + dual-path verification**: validator +
  `pnpm verify`; every AC gets positive AND negative specs at declared paths.
- **XIII. Idempotency/fencing**: lease release validates fencing tokens;
  reservation commit/release idempotent under retry (guarded SQL transitions).
- **XIV. Durable ops**: planning artifacts persisted (this loop); implementation
  commits additively on the package branch.
- **XV. Least privilege/secrets**: no secrets in code/tests/fixtures; egress
  only through perimeter allowlists.
- **XVI–XVIII. Agent governance**: completion decided by deterministic gates;
  commit discipline per git history contract.

## Project Structure

```text
packages/domain/src/tool.ts            # NEW: ActionClass, WorkloadClass,
                                       # CacheOutcome, QuotaModel,
                                       # ReservationState, BackpressureAction,
                                       # ToolProfileId, freshness-TTL table type,
                                       # pipeline-stage enum (pure contracts)
packages/domain/src/index.ts           # extend exports (+1 line)
packages/shared-schemas/src/core.ts    # NEW: authoritative Zod mirrors of every
                                       # boundary type below (manifest schemaRefs)
packages/shared-schemas/src/index.ts   # extend exports (+1 line)
packages/tool-core/
  package.json  tsconfig.json  vitest.config.ts
  src/
    index.ts            # public surface: createToolCore(...) composition root
    errors.ts           # CoreErrorCode typed-error vocabulary (stable codes)
    registry.ts         # versioned tool registry (FR-CORE-001): immutable
                        # (name,version) entries, definition-hash pinning,
                        # profile-scoped listing, registration-time
                        # prohibited screening, snapshot versioning
    profiles.ts         # narrow actor/tool profiles (FR-CORE-004):
                        # actor→profile→tool-set binding; headless agent never
                        # receives the full catalog; atomic provider tools
                        # excluded from normal profiles
    pipeline.ts         # the EXACT §16.2 24-stage orchestrator (FR-CORE-002);
                        # fixed stage order; every exit audited
    stages/authn.ts     # stage 1–2 adapters (delegating to perimeter primitives)
    stages/validate.ts  # stages 3–4: zod validate + canonicalize input;
                        # acquisition-decision + authorization-envelope check
    stages/acquisition.ts # stage 5: persist REQUESTED / blocked /
                        # NOT_REQUESTED_BY_POLICY BEFORE any external request
    stages/cache.ts     # stages 6–11: key calc, memo, fresh, stale, lease,
                        # post-lease recheck
    stages/quota.ts     # stages 12–13, 18: estimate/admit/reserve via injected
                        # QuotaReservationAdapter; commit/release on outcome
    stages/dispatch.ts  # stages 14–17: allowlisted adapter call with deadline,
                        # byte limit, egress policy; raw schema validation;
                        # normalization; semantic invariant validation
    stages/persist.ts   # stages 19, 22: evidence metadata + source fingerprint;
                        # acquisition outcome + actual cost + decision impact
    stages/audit.ts     # stage 23: AuditChain append for success AND every
                        # failure/blocked exit
    cache-key.ts        # §16.4 exact-key canonicalization (canonical JSON of
                        # the nine mandated components); NO semantic caching
                        # for financial/identity data classes
    freshness.ts        # §16.5 TTL table (fresh vs acceptable-stale windows)
    single-flight.ts    # §16.6 DB lease + fencing token, cross-mode
    quota-contract.ts   # FR-CORE-007 SEAM: QuotaReservationAdapter interface +
                        # reservation record lifecycle enforcement + default
                        # deny-closed test adapter (NOT production cost logic)
    license-contract.ts # FR-CORE-008 SEAM: LicensePolicySource interface +
                        # verdict types + default fail-closed source that
                        # refuses when rights status cannot be verified
    prohibited.ts       # FR-CORE-005: registration-time screen (name/description/
                        # schema/action-class against canary catalog) +
                        # execution-time action-class gate
    envelope.ts         # FR-CORE-003: ToolResult assembly (data + meta with
                        # evidenceIds, observedAt/availableAt/fetchedAt, cache
                        # outcome, freshnessSeconds, qualityCodes, conflicts,
                        # quota summary, partial, nextCursor, resourceUris)
  test/                 # colocated unit + contract suites (vitest)
migrations/
  g0_core_0001_tool_registry.sql        # registry table: (name,version) unique,
                                        # definition_hash, action_class,
                                        # profiles[], registered_at, retired_at
  g0_core_0002_single_flight_leases.sql # leases: resource_key, fencing_token,
                                        # holder_mode, expires_at, released_at;
                                        # guarded release transition
  g0_core_0003_quota_reservations.sql   # reservations: estimated units, dims,
                                        # PENDING→RESERVED→COMMITTED /
                                        # PENDING|RESERVED→RELEASED /
                                        # RESERVED→EXPIRED as SQL-guarded
                                        # transitions (idempotent retries)
  g0_core_0004_exact_cache.sql          # cache entries: key hash, payload ref,
                                        # stored_at, fresh_until, stale_until,
                                        # license_policy_version, rights_ok
tests/fixtures/core/                   # tool definitions (clean + prohibited),
                                       # canned provider payloads, clock/lease
                                       # fixtures
tests/acceptance/AC-001.spec.ts        # NEW + AC-002..004 (+ .negative.spec.ts)
tests/acceptance/AC-020.spec.ts        # EXTEND with tool-core substrate blocks
…                                      # (AC-021..023, AC-050..053, AC-240..259)
telemetry/core.catalog.json            # declarative event-contract catalog
```

## Data Model

1. **ToolRegistryEntry** — `(toolName, toolVersion)` unique; `definitionHash`
   (sha256 over canonical JSON of the definition sans execute); action class;
   required scopes; profile list; cachePolicyId / quotaPolicyId /
   licensePolicyId references; `registeredAt`, optional `retiredAt`. Versions
   are immutable; retirement is additive (new row state), never mutation of
   normative fields.
2. **SingleFlightLease** — `resourceKey` (= cache key), `fencingToken`
   (monotonic per key), `holderMode` (MCP_MANUAL | CHATGPT | ADMIN_CHAT |
   AUTOMATION), `acquiredAt/expiresAt/releasedAt`. Release requires token
   match; expired lease reacquire bumps the fence.
3. **QuotaReservationRecord** — `reservationId`, dimension columns
   (actor, provider, operation, workloadClass), `estimatedUnits`,
   `actualUnits` nullable, `state` ∈ {PENDING, RESERVED, COMMITTED, RELEASED,
   EXPIRED} enforced by SQL CHECK + transition guards; unique idempotency key
   per (pipelineRunId, stage) so retries converge.
4. **ExactCacheEntry** — `cacheKeyHash` (sha256 over canonical nine-component
   key), payload object-store/artifact ref, `storedAt`, `freshUntil`,
   `staleUntil`, `licensePolicyVersion`, `rightsPermitted` boolean. Lookups
   respect point-in-time reads (as-of component inside the key).
5. **AcquisitionState rows** reuse the data-truth acquisition repo — the
   pipeline writes REQUESTED or the applicable blocked/not-requested state at
   stage 5 and the final outcome at stage 22; states come verbatim from
   `@foresift/domain`.

## Verification Strategy (per acceptance criterion)

Strategy shape mirrors the proven packages: each shared AC suite gains an
explicitly-headed "tool-core substrate" describe block; suites absent today
(AC-001…004) are created now with that scope, headed by comments stating which
facet converges where. Unit suites in `packages/tool-core/test/` cover engine
internals exhaustively (stage order, fencing, transitions).

- **AC-001** (create pos+neg): registry lists a scoped profile's domain tools;
  pipeline executes a stub free-discovery call end-to-end; unavailable optional
  providers produce explicit degraded envelope entries, never silent gaps.
- **AC-002** (extend): envelope meta carries quality codes, observedAt/
  availableAt/fetchedAt, provenance refs, evidenceIds for every important
  field; negative asserts refusal when a result would lack them.
- **AC-003** (extend): two concurrent simulated modes (MCP_MANUAL + AUTOMATION)
  on one cache key → exactly one dispatch within dedupe window; negative:
  fencing violation after forced expiry is refused.
- **AC-004** (extend): conflicting provider results preserved as conflicts[],
  unsupported capability → CAPABILITY_UNAVAILABLE state, never silent replace.
- **AC-020/021/022/023** (extend): as-of cache lookups cannot read
  available_at > T; revisions keep original observations reachable through
  envelope evidence refs; migration identity avoids double counting via
  canonical entity identity in keys; decimals/address normalization golden
  fixtures flow through stage 16 unchanged.
- **AC-050** (extend): registry refuses prohibited definitions (fixtures:
  trading/signing/wallet-shaped tool definitions); tree scan stays green.
- **AC-051/052/053** (extend): untrusted provider text passes isolation
  envelope into model context only as content, never as instructions; no
  secret material in envelope/logs (assertion sweep over emitted artifacts);
  credential-scoping substrate: actor profile binding rejects out-of-scope
  tools.
- **AC-240…243** (extend): workload classes carry symmetric action-time fields;
  replay path uses only as-of-permitted cache/evidence; NOT_REQUESTED_BY_POLICY
  persisted distinctly from RETURNED_EMPTY/PROVIDER_UNAVAILABLE/negative values
  (AC-242 is the pipeline's headline negative); probe metadata persisted before
  maturity at stage 22 (AC-243).
- **AC-244…249** (extend minimally): envelope preserves lineage/conflict refs
  these criteria consume; no promotion logic lives here — asserted via schema
  round-trip tests only.
- **AC-250…253** (no change or minimal extend): transport/OAuth facets belong to
  mcp-surface/security; keep suites green.
- **AC-254/255** (extend): prohibited-financial execution gate refuses
  transaction-shaped calls; GMGN-style query fixtures pass while prohibited
  shapes fail registration.
- **AC-257/258** (keep green; egress/isolation owned upstream).
- **AC-259** (extend): every blocked/successful pipeline exit appends an audit
  event; tamper fixtures still detected (chain owned by security suite).
- **Engine units**: stage-order property test (no permutation executes);
  lease fencing matrix; reservation transition matrix incl. concurrent
  reserve/commit/release races on PGlite; cache-key stability vectors
  (fixture JSON → expected hash); TTL table boundaries; profile narrowing
  (headless profile ⊊ full catalog); deny-closed default adapters.

Commands: `pnpm --filter @foresift/domain test`,
`pnpm --filter @foresift/shared-schemas test`,
`pnpm --filter @foresift/tool-core test`, then aggregate `pnpm verify` and
`pnpm spec:verify` at convergence.

## Risks

1. **Seam leakage** — quota/license seams accreting policy semantics would
   violate the milestone boundary. Mitigation: contract tests inject adapters
   DEFINED OUTSIDE packages/tool-core/test-adjacent fixture modules; CI grep
   keeps tool-core free of cost-table vocabulary.
2. **Stage-order drift** — future edits reordering §16.2 silently. Mitigation:
   stage sequence is data (ordered const array) with a pinned-order unit test
   diffing against the PRD-derived list.
3. **Shared-suite merge friction** — extending 20+ existing AC files can
   collide with concurrently RUNNING provider-lifecycle work. Mitigation:
   concurrency policy allows one coding package in flight; additions are
   append-only describe blocks with distinct headers.
4. **PGlite/Postgres divergence** in transition guards. Mitigation: plain SQL
   CHECK/WHERE-guarded UPDATEs only (ADR-0014 constraint).
5. **Cache-key instability** breaking exactness. Mitigation: canonical JSON
   utility reused from persistence; golden-vector fixtures pin the serializer.

## Material decisions

1. **Engine home = packages/tool-core despite manifest owner packages/domain**
   (mirrors the milestone's FR-DR precedent): manifest implRefs name
   `packages/domain/**` + `packages/shared-schemas/**`; the milestone objective
   explicitly adds `packages/tool-core/**` and routes reconciliation to
   `g0-traceability-conformance` at convergence. Domain-level enums/types land
   in the manifest-named paths so the mapping stays truthful; the orchestrator
   lands in tool-core. No manifest edit anywhere.
2. **Two seams only** — QuotaReservationAdapter (estimate/admit/reserve/commit/
   release) and LicensePolicySource (verdict per call). Everything else
   (provider selection inputs, capacity ceilings, protected-reserve sizing) is
   DATA passed through the seams, keeping cost semantics wholly in
   g0-cost-capacity. Default implementations shipped here are deny-closed test
   doubles only, documented as such.
3. **Migrator family extension (supporting change)** — identical precedent to
   the sec package: `(data|dr|sec)` → `(data|dr|sec|core)` regex + comment;
   purely additive, all defenses preserved; without it this package's declared
   `g0_core_*.sql` refs are unapplyable.
4. **Audit via injection, not import-cycle risk**: pipeline takes the AuditChain
   instance through the composition root; tool-core depends on
   `@foresift/security` types only where the perimeter already exports them.
5. **Freshness TTL defaults as data** — §16.5 example table encoded as a typed
   constant in domain + overridable per deployment via configuration object at
   composition-root time; not a schema/migration concern.
6. **AC-001…004 created scoped, not stubbed** — these milestone E2E suites
   start life owning exactly the tool-core facet (registry listing, envelope
   completeness, cross-mode dedupe, explicit-conflict handling) with header
   comments naming the facets other packages add later; nothing is faked to
   look like full E2E coverage.
7. **Committed-tree completion** — coherent units committed additively on the
   package branch as they converge; main reached only via CI-gated PR.

### Proposed ADR text (records the binding extension-point decision)

> **ADR-0018 (proposed): Tool-core quota and license extension points are
> load-bearing contracts.** The Shared Tool Core's quota
> reservation/commit/release stage and its license-policy source are stable,
> versioned interfaces (`QuotaReservationAdapter`, `LicensePolicySource`) owned
> by `packages/tool-core`. Cost, quota, capacity, and license-policy
> implementations MUST live outside `packages/tool-core/**` and MUST NOT edit
> tool-core sources; they plug in at the composition root. Breaking either
> interface requires a superseding ADR and a synchronized migration of every
> implementation. Rationale: the milestone decomposition makes cost semantics a
> separate package precisely so budget policy can evolve without touching the
> execution choke point; the read-only guarantee additionally requires that the
> pipeline's deny-closed defaults remain the fallback whenever no adapter is
> bound.

## Supporting changes outside writeScopes (justified)

1. `packages/persistence/src/migrator.ts` — filename-family regex
   `(data|dr|sec)` → `(data|dr|sec|core)` plus doc-comment lines (material
   decision 3). Existing migrator suite must stay green untouched.
2. `pnpm-lock.yaml` — mechanical regeneration after adding the
   `@foresift/tool-core` workspace package; no hand edits.
