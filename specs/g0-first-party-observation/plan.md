# Implementation Plan: g0-first-party-observation

**Package**: `g0-first-party-observation` | **Date**: 2026-08-29 | **Spec**: `specs/g0-first-party-observation/spec.md` (scoped derivative of PRD §10.2, §12.7/12.9/12.10, §13.1–13.7, §14.7, §15.9, §18.4–18.5, §33.8, §34.7, §35.6–35.7, §36.6, §37.13–37.14, §38.14/38.38, §42.1, §62.5, §63.1–63.12 + manifest FR-COL-001…012, FR-DISC-001…005)
**Authority**: PRD wins over every word below; material decisions are recorded as proposed ADR texts in this file.

## Summary

Deliver bounded first-party observation as two coherent halves in one package: (1) the
Solana collector platform — an allowlist-driven long-running collector app plus six
packages (core stream framework, Solana transport + program registry, checkpoint
partition state machine, bounded gap recovery, program decoders) — and (2) the
discovery universe — a point-in-time first-seen registry plus a finite batch-oriented
cheap monitor and deterministic versioned promotion. All durable state machinery
(checkpoints with fencing, gap registry, exactly-once canonical keys, immutable
observations/revisions/compensating events, backfill receipts with structural
no-backdating, watermarks) is already PROVEN in `packages/persistence` and is
COMPOSED here, not reimplemented. Zero signing/wallet capability is enforced
structurally: read-only subscription ports, no key material anywhere in scope, and
the prohibited-capability scan must stay clean.

## Technical Context

- **Language/runtime**: TypeScript (ESM) in the pnpm workspace; strict mode via
  `tsconfig.base.json` extended by every new package config (glob-driven root config
  from g0-contracts-data-truth picks up `packages/*` and `apps/*` with zero root edits).
- **Storage**: PostgreSQL via `@foresift/persistence` (`DatabaseEngine`); tests on
  PGlite per ADR-0014. New migration families `g0_col_*` (collector) and
  `g0_disc_*` (discovery), additive only, schema-qualified (`col.`, `disc.`)
  following the proven `cost`/`sec`/`prov` pattern; registry rows never altered.
- **Validation**: authoritative Zod schemas in `packages/shared-schemas/src/col.ts`
  and `src/disc.ts` (ADR-0013), fail-closed everywhere; every external string
  (event family, capability state, monitor decision) is a strict enum or table lookup.
- **Egress**: every collector outbound connection goes through `@foresift/security`'s
  `EgressGuard` on the `COLLECTOR` plane; reconnect/backfill endpoints are fixed
  configuration, never event-provided URLs (§35.6); allowlist descriptor validated
  per operation like the proven provider adapters.
- **Audit**: sole sink is `@foresift/security`'s `AuditChain`; decode pauses, gap
  waivers, capacity pauses, and promotion decisions append audit records; this
  package never builds its own chain.
- **Quota admission**: every provider/RPC/backfill call passes the
  `CostQuotaAdapter` seams (g0-cost-capacity); backfill may debit the
  `EMERGENCY_BACKFILL` reserve only via declared eligibility (ADR-proven rule:
  eligibility is declaration-bound, never caller-asserted).
- **Test stack**: Bun Test (repository authority); suites colocated per package
  (`test/*.spec.ts`) plus acceptance/negative pairs under `tests/`; DB suites run
  on PGlite through `tests/acceptance/helpers.ts`; the coordinator manifest is
  regenerated mechanically whenever new test files land (established wave pattern).
- **Capacity contract**: collector ceilings are declared per the PRD §62.5
  Sustainable Capacity Contract shape and consumed by the proven
  `replayCapacity` (quota-forecast) so collector continuity participates in the
  30-day expected/stress replay (AC-227) and degrade-before-protected ordering
  (AC-228).

## Constitution Check

- **I. Product-Contract Authority**: every task traces to FR-COL-_/FR-DISC-_/AC-*
  quoted in spec.md; no `docs/spec/**` edits; PRD invariants INV-001…010 respected
  (cross-cut in spec.md).
- **II. Greenfield**: designed from PRD §10.2, §18.4, §34.7, §63.x directly; the
  predecessor repo was not consulted.
- **III. Modular-monolith-first**: one long-running app + six focused packages +
  two schema modules + two discovery packages; no broker, no microservice split.
  The collector app is the PRD's own "bounded collector deployment" (§10.2) inside
  the single deployable monolith topology.
- **IV. Read-only boundary (non-negotiable)**: no signing/key/wallet/submit surface
  anywhere in scope; Jupiter is route observation only and never pool-math
  authority; quote/observation paths discard transaction-construction fields;
  `node scripts/scan-prohibited-capabilities/cli.mjs` must stay CLEAN.
- **V/VI. PIT & event-time correctness**: replay resolves only observations with
  `available_at <= T` (proven `replayObservations`); backfilled events preserve
  chain `event_at` but never backdate `available_at` (structural in
  `BackfillReceiptSchema`); contiguous watermark advances only through observed
  events or explicit empty-range proofs (§18.4).
- **VII. Provenance/evidence**: every stream record carries the full FR-COL-003
  coordinate set + raw artifact hash + decoder version; every discovery entry is a
  `DiscoveryUniverseEntry` (§63.5) with source attribution retained for all
  subsequent sources.
- **VIII. Fail-closed**: unknown instruction variants/layout mismatch/parity failure
  pause affected decoding, create an incident, and prevent derived facts until
  revalidated (FR-COL-007); unsupported program versions remain explicit
  (FR-COL-002); missing stream-record fields refuse ingestion rather than default.
- **IX. Provider abstraction**: all external access flows through adapter
  interfaces (`FetchPort`/`AdapterClient` and the collector's own subscription
  port); no vendor SDK in product modules.
- **X. Traceability**: tasks cite only FR-COL-001…012 and FR-DISC-001…005 (plus
  their ACs); AC matrix below maps every criterion.
- **XI/XII. Deterministic + dual-path verification**: each shared AC gets a
  positive AND a negative suite at manifest-declared paths; `pnpm verify` +
  `pnpm spec:verify` at pushed HEAD are the floor.
- **XIII. Idempotency/fencing**: fenced checkpoint upserts (stale instance cannot
  advance after newer fencing token), exactly-once canonical keys, idempotent gap
  registration, idempotent promotion decisions.
- **XIV. Durable ops**: all collector state (checkpoints, gaps, partitions,
  incidents, health) is durable; the collector is restartable from persisted state
  with no silent filter/version change after restart (§34.7).
- **XV. Least privilege/secrets**: no secrets in code/fixtures; collector
  credentials are read-only endpoint tokens referenced by config, never embedded.
- **XVI–XVIII. Agent governance**: completion decided by
  `scripts/automation/package-plan-complete.mjs` + package gate + `pnpm verify` +
  CI; no AI claim is completion.

## Project Structure

```text
packages/shared-schemas/src/col.ts        # NEW — authoritative Zod schemas:
                                          # CollectorScopeDeclaration, CollectorStreamRecord,
                                          # ProgramSupportManifest (§63.3.1), CollectorPartitionState,
                                          # CollectorHealth, CollectorIncident, DecoderDescriptor,
                                          # CollectorCeilingSet (Sustainable Capacity Contract slice),
                                          # FirstSeenLatencySpans; fail-closed parse helpers
packages/shared-schemas/src/disc.ts       # NEW — DiscoveryUniverseEntry (§63.5), DiscoverySourceClass,
                                          # CheapMonitorRow, CheapMonitorDecision, MonitorBatchDescriptor,
                                          # PromotionDecision, CoveragePopulationManifest (§63.7)
packages/shared-schemas/src/index.ts      # extend exports (+col, +disc)

packages/collector-core/                  # stream framework, transport-agnostic
  package.json  tsconfig.json
  src/
    index.ts
    scope.ts                # versioned allowlist: chains, programs, program versions,
                            # accounts, event families, finality policies (FR-COL-001);
                            # coverage cannot be implied outside scope
    stream-record.ts        # FR-COL-003 full record assembly + receipt-hash stamping;
                            # refuses records missing required coordinates (fail-closed)
    subscription-port.ts    # read-only subscription/polling port interface; fixed
                            # configuration endpoints; no arbitrary-subscription capability
    connection-lifecycle.ts # deterministic bounded failover/reconnect: endpoint selection,
                            # exponential backoff + jitter, connection generation counters
                            # (FR-COL-009); fenced checkpoint advance on each generation
    duplicate-absorber.ts   # chain-coordinate + normalized-event-hash dedupe through
                            # canonical_event_keys (FR-COL-009 idempotence; INV-009)
    capacity-governor.ts    # FR-COL-010 ceilings (cpu/memory/network/subscription/event-rate/
                            # raw-storage/retry/monthly-credit) checked against the active
                            # Sustainable Capacity Contract; ceiling reached → safe pause
                            # (durable PAUSED partition state), never silent overage
    health.ts               # FR-COL-008 health snapshot assembly (connected state, endpoint
                            # generation, head/finalized slot, checkpoint lag, gap count/
                            # duration, backfill status, decode-failure rate, streamed bytes,
                            # event rate, dedup rate, resource consumption)
    first-seen.ts           # FR-COL-011 first-seen latency span recording (source event →
                            # receipt → availability; later spans joined by feature/decision/
                            # delivery owners)
  test/
    scope.spec.ts  stream-record.spec.ts  connection-lifecycle.spec.ts
    duplicate-absorber.spec.ts  capacity-governor.spec.ts  health.spec.ts
    first-seen.spec.ts  migrations.spec.ts

packages/collector-solana/                # Solana transport + protocol registry
  package.json  tsconfig.json
  src/
    index.ts
    transport.ts            # persistent outbound WebSocket/RPC + bounded high-frequency
                            # polling port impl; EgressGuard COLLECTOR-plane bound;
                            # message validation per §35.6 (chain, program/version, slot,
                            # account layout, size, decoder contract); malformed event
                            # cannot advance the durable checkpoint
    program-registry.ts     # protocol registry + ProgramSupportManifest loading/verification
                            # (signed, content-hashed, official-source + live-chain verified);
                            # unsupported/upgraded programs → UNSUPPORTED_PROGRAM_VERSION
                            # (FR-COL-002); coverage never inherited from similar names
    endpoint-plan.ts        # deterministic endpoint/sharding plan: subscription sharding,
                            # per-partition program/account assignment, bounded replay
    jupiter-observation.ts  # Jupiter route observation/reconciliation ONLY; routes reconciled
                            # to underlying venue adapters; never pool-math authority; no
                            # quote/build/swap/sign/submit operation exists
  test/
    transport.spec.ts  program-registry.spec.ts  endpoint-plan.spec.ts
    jupiter-observation.spec.ts  migrations.spec.ts

packages/program-decoders/                # versioned decoder + adapter registry
  package.json  tsconfig.json
  src/
    index.ts
    decoder-registry.ts     # decoder resolution strictly by (program, version, layout hash)
                            # against signed support manifests; mismatch/unknown → explicit
                            # UNSUPPORTED/degraded, never generic constant-product output (AC-230)
    decoders/
      pump.ts               # Pump bonding-curve lifecycle + PumpSwap migration/AMM state
      raydium.ts            # AMM v4/CPMM/CLMM/Stable AMM/LaunchLab lifecycle/migration state
      orca-whirlpools.ts    # Whirlpools concentrated liquidity + tick-array state
      meteora.ts            # DLMM/DAMM v1-v2/Dynamic Bonding Curve launch/migration state
    parity.ts               # golden vectors + adversarial-layout property harness; historical
                            # observed-trade parity where claimed; upgrade-change detection
                            # (decoder hash/IDL mismatch → drift incident)
    drift-detector.ts       # FR-COL-007: unknown instruction variants, layout drift, parity
                            # failure → pause ONLY affected scope, preserve raw events,
                            # create incident, prevent derived facts until revalidated
  test/
    decoder-registry.spec.ts  pump.spec.ts  raydium.spec.ts  orca-whirlpools.spec.ts
    meteora.spec.ts  parity.spec.ts  drift-detector.spec.ts  migrations.spec.ts

packages/collector-checkpoints/           # durable continuity state machine
  package.json  tsconfig.json
  src/
    index.ts
    partition-state.ts      # §12.9 partition machine (DISABLED→STARTING→SYNCING→LIVE;
                            # DEGRADED/GAP_DETECTED/BACKFILLING/PAUSED/FAILED); LIVE only
                            # when connection+decoder+finality+contiguous checkpoint+
                            # capacity+rights checks pass
    checkpoint-store.ts     # durable monotonic per-partition checkpoints over the fenced
                            # persistence helpers; reconnect detects missing slot/sequence
                            # ranges, records a gap BEFORE backfill, resumes from last
                            # committed checkpoint (FR-COL-004)
    watermark-coordinator.ts# §13.5 watermark state per shard/program-version/chain;
                            # contiguous advance requires observed events or explicit
                            # empty-range proof (§18.4); non-contiguous cannot claim coverage
  test/
    partition-state.spec.ts  checkpoint-store.spec.ts  watermark-coordinator.spec.ts
    migrations.spec.ts

packages/collector-gap-recovery/          # bounded non-backdating backfill
  package.json  tsconfig.json
  src/
    index.ts
    gap-registry-bridge.ts  # §12.10 gap lifecycle (OPEN→BACKFILL_QUEUED→BACKFILLING→
                            # RESOLVED_COMPLETE|RESOLVED_EMPTY_PROOF|PARTIAL|UNRESOLVED|
                            # WAIVED_FOR_NARROW_SCOPE) over the persistence gap registry;
                            # waiver is scoped/signed/expiring and never supports
                            # contiguous claims
    backfill-planner.ts     # independent bounded RPC/indexer operations where available;
                            # backfill_limit respected; cost-admitted (reserve-eligible
                            # EMERGENCY_BACKFILL only per declaration); FAILED/UNRESOLVED
                            # gaps explicitly downgrade coverage + population claims
                            # (FR-COL-005, §63.12)
    retrieval-clock.ts      # preserves actual retrieval time; available_at = recovery
                            # fetch/commit time unless a persisted live receipt proves
                            # earlier (§13.6 rule 5); no backdating, ever (AC-225)
  test/
    gap-registry-bridge.spec.ts  backfill-planner.spec.ts  retrieval-clock.spec.ts
    migrations.spec.ts

packages/discovery-universe/              # point-in-time first-seen registry
  package.json  tsconfig.json
  src/
    index.ts
    universe-registry.ts    # FR-DISC-003 point-in-time registry: source populations,
                            # inclusion windows, collector coverage manifests; supports
                            # source-overlap, unique-yield, and NOT_DISCOVERED miss
                            # measurement (§63.7 populations, §31.10 misses)
    first-seen-attribution.ts # FR-DISC-002: every first-seen records source, source
                            # timestamp, system timestamp, source rank, and ALL subsequent
                            # discovery sources (append-only attribution list)
    aggregate-path.ts       # FR-DISC-001: free aggregate discovery is the DEFAULT
                            # broad-universe path (policy constant + admission wiring;
                            # cannot call paid operations, §42.1)
    retrospective-classifier.ts # AC-111: a token meeting an outcome profile but absent
                            # from all live sources classifies NOT_DISCOVERED through the
                            # retrospective universe path when evidence permits
  test/
    universe-registry.spec.ts  first-seen-attribution.spec.ts  aggregate-path.spec.ts
    retrospective-classifier.spec.ts  migrations.spec.ts

packages/cheap-monitor/                   # finite batch monitoring + versioned promotion
  package.json  tsconfig.json
  src/
    index.ts
    monitor-store.ts        # bounded cheap-monitor table rows (NEW/MONITORING_CHEAP/
                            # PROMOTED_TO_VERIFY/REJECTED_CHEAP/EXPIRED_CHEAP, §12.7);
                            # finite checks, expiry, backoff, max staleness (§63.6)
    batch-scheduler.ts      # FR-DISC-004: one scheduled run selects next_check_at <= now,
                            # groups provider-compatible calls, consumes first-party deltas
                            # first, writes one point-in-time observation per returned
                            # entity; NEVER one scheduler message/workflow per candidate
    promotion.ts            # FR-DISC-005: deterministic + versioned promotion to free-quota
                            # verification; decision freezes feature + policy versions so
                            # replay is bit-identical (AC-113); persistence/change +
                            # execution/security eligibility inputs, never magnitude alone
  test/
    monitor-store.spec.ts  batch-scheduler.spec.ts  promotion.spec.ts  migrations.spec.ts

apps/collector/                           # long-running collector composition root
  package.json  tsconfig.json
  src/
    index.ts                # durable process (NOT request-bound serverless, §10.2):
                            # declares collector_instance_id/version/chain/allowlist/
                            # filters/start checkpoint/finality/max lag/gap age/backfill
                            # limit/byte+credit ceilings/backoff/retention-rights policy
    leader-lease.ts         # leader lease / deterministic shard ownership; stale instance
                            # cannot advance checkpoint after newer fencing token (§10.2)
    main.ts                 # composition: scope → transport → decoders → checkpoints →
                            # gap recovery → observations → first-seen → health
  test/
    boot.spec.ts  leader-lease.spec.ts  ingest-path.spec.ts

migrations/
  g0_col_0001_scopes_partitions.sql      # collector_scopes (versioned allowlist), collector_partitions (§12.9 state)
  g0_col_0002_stream_receipts.sql        # stream receipt coordinates (FR-COL-003) + raw artifact refs
  g0_col_0003_incidents_decodescope.sql  # collector decode-scope pauses + incidents (FR-COL-007)
  g0_col_0004_health_ceiling.sql         # collector_health snapshots + ceiling counters (FR-COL-008/010)
  g0_disc_0001_universe_entries.sql      # discovery universe entries + first-seen attribution (FR-DISC-002/003)
  g0_disc_0002_cheap_monitor.sql         # cheap-monitor rows + finite-check accounting (FR-DISC-004)
  g0_disc_0003_promotions.sql            # versioned promotion decisions (FR-DISC-005)

tests/fixtures/col/                       # allowlist scopes, stream records, adversarial
                                          # layouts, reorg/duplicate/out-of-order sequences,
                                          # gap sequences, support manifests, capacity ceilings
tests/fixtures/disc/                      # discovery entries, monitor rows, promotion
                                          # policy versions, retrospective universe samples
tests/acceptance/AC-110/111/112/113/230/231/237.spec.ts        # NEW positive pairs
tests/acceptance/AC-224…229.spec.ts                            # EXTEND additively (collector facet)
tests/negative/AC-*.negative.spec.ts                           # mirror pairs (13 ACs total)
telemetry/col.catalog.json                # declarative catalog (events mirror col.ts fields)
telemetry/disc.catalog.json               # declarative catalog (events mirror disc.ts fields)
```

### Why this split

The manifest's `implementationRefs` pin every FR-COL-* to
`apps/collector` + `collector-core` + `collector-solana` + `program-decoders`, and
every FR-DISC-* to `discovery-universe` + `cheap-monitor`. Within that pin, the
package-scoped additions (`collector-checkpoints`, `collector-gap-recovery`) isolate
the two stateful continuities the PRD treats as first-class state machines (§12.9/§12.10)
from the stateless decode layer, so decoder drift can never corrupt continuity state
and vice versa. `packages/shared-schemas` hosts the vocabularies because
`packages/domain/**` is outside this package's writeScopes (see Resolved ambiguities
in spec.md — the ADR-0018 consequence).

## Data Model

### CollectorScopeDeclaration (g0_col_0001; FR-COL-001, §10.2, §63.3)

One versioned row per active scope: `scopeId`, `chainId`, `programId`,
`programVersion/accountLayoutVersion`, `eventFamilies[]`, `accountFilters[]`,
`coverageStartSlot`, `finalityPolicy`, `decoderVersion`, `quotaByteEnvelope`,
`maxLag`, `maxGapAge`, `rightsRef`, `retentionPolicy`, `active bool`. Scope
activation requires a verified `ProgramSupportManifest` reference. Coverage is
declared, never inferred: anything outside active scope rows is not covered, and
health/telemetry never implies otherwise.

### ProgramSupportManifest (content-addressed; §63.3.1, FR-COL-002)

Stored as canonical-JSON rows with `contentHash` (sha256 over the canonical form)
and `approvalArtifactId`; carries `upgradeAuthorityState`, `idlOrLayoutSha256`,
`decoderVersion`, `capabilityState` (`UNAVAILABLE|DEGRADED|SHADOW|ACTIVE|RETIRED`),
`officialReferencesVerifiedAt`, `liveChainVerificationSlot/Hash`, `validFrom/Until`.
A stale or mismatched manifest degrades the family automatically; mutable program
identifiers are never copied into business logic.

### Stream receipts (g0_col_0002; FR-COL-003)

One row per accepted stream event keyed by `receiptHash` (content hash): endpoint,
subscription/filter version, connection generation, slot, block hash,
transaction/signature, instruction/log/account coordinates, receivedAt,
earliestSystemAvailability, finality, rawArtifactHash (object-store reference,
§14.7), decoderVersion, rightsPolicy. Nullability mirrors the proven
`observations` coordinate columns; the producer-side obligation to keep
coordinates coherent per event family is enforced in `stream-record.ts`.

### Partition state + incidents (g0_col_0001/g0_col_0003; §12.9, FR-COL-007)

`collector_partitions` holds the §12.9 machine with monotonic transition
enforcement; `collector_decode_pauses` (scope: decoder/program/version — never
global) and `collector_incidents` (kind, affected scope, evidence refs,
audit-chain ref, revalidation state) record drift. Paused scope preserves raw
events and blocks derived facts until explicit revalidation.

### Health + ceilings (g0_col_0004; FR-COL-008/010)

`collector_health` snapshots (the full FR-COL-008 field list) append-only;
`collector_ceiling_counters` track the eight FR-COL-010 dimensions against the
active Sustainable Capacity Contract slice (CPU, memory, network, subscription,
event-rate, raw-storage, retry, monthly-credit). Ceiling exhaustion → durable
PAUSED partition + incident, never silent overage or reserve invasion.

### Discovery universe entries (g0_disc_0001; FR-DISC-002/003, §63.5)

`discovery_universe_entries` mirrors the PRD `DiscoveryUniverseEntry` interface
exactly (assetRepresentationId, sourceId, sourceClass, sourceObservedAt/
sourcePublishedAt/sourceAvailableAt, firstFetchedAt/firstReceivedAt/firstIngestedAt,
chainCoordinates, sourceRank, sourceMetadataHash, discoveryPolicyVersion,
collectorCoverageManifestId, qualityCodes). `discovery_attribution` appends every
subsequent source sighting (candidate, sourceId, seenAt, sourceRank) — the
append-only list that makes overlap/dependence measurable. Population manifests
(§63.7) reference scope, windows, gaps, rights exclusions, and selection
probabilities.

### Cheap monitor + promotions (g0_disc_0002/g0_disc_0003; FR-DISC-004/005, §12.7/§63.6)

`cheap_monitor_rows` (§12.7 states, next_check_at, finite check counter, expiry,
backoff state, max staleness, budget class) is the ONLY monitor state;
`monitor_observations` stores one point-in-time snapshot per batch-returned
entity; `promotion_decisions` freezes (candidate, featureVersions, policyVersion,
inputs hash, decision, decidedAt, decisionVersion) — replaying the same frozen
inputs yields the identical decision (AC-113).

### Reuse of proven substrate (no re-creation)

Checkpoints/gaps/canonical keys/observations/revisions/compensating
events/backfill receipts/watermarks live in the g0-contracts-data-truth tables and
persistence repos listed under Integration points in spec.md. This package's
migrations only ADD tables and reference those keys; nothing existing is altered.

## Component Behaviors

### collector-core: scope, stream records, lifecycle

- **scope.ts** — loads active CollectorScopeDeclaration rows; the subscription
  builder may express ONLY what the scopes declare; a request for anything else
  refuses at construction (FR-COL-001). Scope version increments are explicit
  rows; filters/program versions never silently change after restart (§34.7).
- **stream-record.ts** — assembles the FR-COL-003 record per event; missing
  required coordinate/timestamp/rights fields refuse (typed code, no default);
  receipt hash computed over canonical JSON.
- **connection-lifecycle.ts** — deterministic endpoint ordering (health-weighted
  but tie-broken by stable endpoint id), bounded exponential backoff with jitter,
  connection-generation counters; failover replays from the last committed
  checkpoint; duplicates absorbed downstream — failover cannot create duplicate
  externally visible state or erase first-seen attribution (FR-COL-009).
- **duplicate-absorber.ts** — insert-if-absent through `recordCanonicalEvent`;
  second receipt of the same canonical key updates nothing visible and increments
  the dedup-rate counters.
- **capacity-governor.ts** — evaluates the eight ceilings per tick; crossing any
  ceiling sets partition PAUSED with reason, opens an incident, and stops intake
  before violation; resume is an explicit audited step (no auto-reactivation).
- **health.ts / first-seen.ts** — pure assemblers over counters; first-seen spans
  are recorded at each boundary the collector owns (source event → receipt →
  availability) with later spans (feature/decision/delivery) joined by their
  owners for the AC-226 decomposition.

### collector-solana: transport, registry, Jupiter

- **transport.ts** — persistent WebSocket/RPC and bounded polling behind one
  interface; all endpoints fixed configuration validated against the COLLECTOR
  egress allowlist; §35.6 message validation before anything durable: a malformed
  event cannot advance the durable checkpoint.
- **program-registry.ts** — verifies support manifests (content hash, validity
  window, live-chain verification slot); an upgraded program with no passing
  manifest transitions to `UNSUPPORTED_PROGRAM_VERSION` and its families report
  degraded — explicit, never generic (FR-COL-002, AC-231 verification surface).
- **jupiter-observation.ts** — normalizes observed routes and reconciles them to
  underlying venue adapters' decoded swaps; Jupiter output is evidence about
  routing, never a pool-math authority; the module contains no quote/build/swap/
  sign/submit code (structurally scan-clean).

### program-decoders: registry, families, drift

- **decoder-registry.ts** — resolution key is (programId, programVersion,
  layoutHash); lookup failure returns a typed UNSUPPORTED/degraded result — the
  AC-230 negative surface. Family decoders emit normalized events + quality codes
  only after full decode success; partial decodes flag `SCHEMA_DEGRADED`/
  `UNSUPPORTED_PROGRAM_VERSION` per the proven quality-code vocabulary.
- **parity.ts / drift-detector.ts** — golden-vector + adversarial-layout harness
  per family (AC-231); on unknown variant/layout mismatch/parity failure the
  drift-detector pauses ONLY the affected decoder scope (g0_col_0003), keeps raw
  events flowing to storage, opens the incident, and blocks derived facts until
  revalidation passes (FR-COL-007, AC-237).

### collector-checkpoints + collector-gap-recovery: continuity

- **partition-state.ts** — the §12.9 machine with monotonic transitions; LIVE
  requires all six checks; GAP_DETECTED/BACKFILLING interplay with the gap
  registry bridge; PAUSED is durable and reason-carrying.
- **checkpoint-store.ts** — per-partition monotonic checkpoints through the fenced
  persistence helpers; on reconnect the store compares observed ranges against the
  last committed checkpoint, registers every missing range as a gap BEFORE any
  backfill work, and resumes exactly from the committed position (FR-COL-004,
  AC-224 core path).
- **watermark-coordinator.ts** — advances `highest_contiguous_slot` only across
  observed ranges or explicit empty-range proofs; unresolved gaps block
  contiguous-coverage claims but never erase valid observations outside the gap
  (§18.4).
- **backfill-planner.ts / retrieval-clock.ts** — bounded backfill jobs (backfill
  limit, per-job budget, cost-admitted); each recovered event keeps its original
  chain `event_at`, receives `available_at = recovery fetch/commit time` (live
  receipt proof may move it earlier — never inferred), records a full backfill
  receipt, and replay before `available_at` cannot observe it (FR-COL-005,
  AC-225). `PARTIAL`/`UNRESOLVED` outcomes downgrade coverage and population
  claims explicitly.

### discovery-universe + cheap-monitor: discovery

- **universe-registry.ts** — point-in-time queries: which sources were live over
  which populations/windows; sufficient to measure source overlap, unique yield,
  and `NOT_DISCOVERED` misses against any reference time (FR-DISC-003).
- **first-seen-attribution.ts** — the earliest valid system-available entry
  becomes candidate first-seen; every later sighting appends (never updates) the
  attribution list; source rank retained as observation, not quality (§63.10).
- **aggregate-path.ts** — encodes free-aggregate as the default broad-universe
  path: admission wiring binds discovery calls to the STRICT_FREE cost plane, and
  the module refuses any operation declaration not allowed in STRICT_FREE
  (FR-DISC-001 + §42.1 no-paid-operations rule).
- **batch-scheduler.ts** — the single batch worker: selects due rows
  (`next_check_at <= now`) with a hard bound per run, groups compatible provider
  calls (coalescing window respected), consumes first-party collector deltas
  first, writes one snapshot per entity, advances finite-check counters; the
  scheduler message count is O(batches), never O(candidates) (FR-DISC-004,
  AC-112 measured surface).
- **promotion.ts** — deterministic, versioned: given frozen inputs
  (snapshots + feature versions + policy version) the decision function is pure;
  promotion creates/advances the candidate through a versioned deterministic
  decision (§12.7); expiry/rejection rows remain for missed-opportunity evaluation
  (INV-007).

## Verification Strategy (per acceptance criterion)

Every AC carries a positive suite at `tests/acceptance/AC-*.spec.ts` and a
negative/failure suite at `tests/negative/AC-*.negative.spec.ts` per the
manifest's declared refs. AC-224…229 files exist from g0-cost-capacity with
"collector substrate owned elsewhere" headers — this package appends collector-
facet describe blocks additively (never rewriting cost-facet content) and updates
each file's header trace list. All DB suites run on PGlite.

| AC         | Text (short)                                                                                                                                                                                      | Positive coverage                                                                                                                                                                                                                                                                                | Negative/failure                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC-110** | Deterministic first-seen source/system timestamps + attribution                                                                                                                                   | Two sources see the same asset; earliest valid system-available entry wins deterministically; both + all subsequent sightings recorded (FR-COL-011, FR-DISC-002)                                                                                                                                 | Attribution append refused for unknown source class; missing system timestamp refuses; replay yields identical attribution                                   |
| **AC-111** | Absent-from-live-sources token → `NOT_DISCOVERED` via retrospective path                                                                                                                          | Retrospective enumeration establishes existence + outcome; classifier emits `NOT_DISCOVERED` with evidence refs; retrospective evidence never enters historical decision bundle                                                                                                                  | Classification refused when retrospective source shares live upstream lineage without disclosure; no universe evidence → no classification                   |
| **AC-112** | 1,000 candidates → bounded batches, not 1,000 messages/workflows                                                                                                                                  | Batch scheduler over 1,000 monitor rows produces bounded batch count; scheduler-message counter O(batches); one snapshot per returned entity                                                                                                                                                     | A per-candidate workflow/message attempt is structurally refused; unbounded due-set without batch grouping refuses                                           |
| **AC-113** | Promotion replayable from frozen feature + policy versions                                                                                                                                        | Promote with frozen inputs; replay same inputs → identical decision record (idempotent); different policy version → different decisionVersion, auditable                                                                                                                                         | Promotion with unfrozen/stale feature versions refuses; replay after policy bump yields new version, never mutates original decision                         |
| **AC-224** | Reconnect from killed connection: checkpoint resume, gap detect, no duplicate canonical event                                                                                                     | Kill/reconnect against persistent transport fixture; resume from committed checkpoint; induced slot gap registered BEFORE backfill; backfilled or marked unresolved; exactly one canonical event per key (FR-COL-004/005/006/009)                                                                | Malformed event cannot advance durable checkpoint; stale fencing token cannot advance after takeover; duplicate replay absorbed with zero new canonical rows |
| **AC-225** | Backfilled event: original chain time, `available_at >= retrieval`, invisible to pre-retrieval replay                                                                                             | Backfill a gap; assertion that event_at preserved; available_at = retrieval commit; replay at earlier T does not resolve the event (FR-COL-005)                                                                                                                                                  | Attempted backdated available_at refused structurally; live-receipt proof without persisted receipt ref refuses                                              |
| **AC-226** | First-seen latency decomposition spans for verified collector scope                                                                                                                               | Produce spans event→collector→(feature→decision→delivery joined) + provider comparison for verified scope; each span individually queryable (FR-COL-011)                                                                                                                                         | Spans for scope outside verified collector scope refused/unlabeled — cannot masquerade as first-party                                                        |
| **AC-227** | 30-day expected+stress capacity replay blocks on any verified ceiling                                                                                                                             | Collector ceilings participate in replay via ceiling counters; activation blocked when any ceiling exceeded in replay (FR-COL-010 + quota-forecast)                                                                                                                                              | Collector ceiling counters excluded from replay (mutation) → replay refuses rather than passes silently                                                      |
| **AC-228** | Degrade order protects collector continuity before others                                                                                                                                         | Under simulated exhaustion, collector continuity remains while exploration/broad-scan depth degrades first; EMERGENCY_BACKFILL reserve not consumed by broad scans                                                                                                                               | Attempt to route broad-scan workloads into EMERGENCY_BACKFILL refused (declaration-bound eligibility)                                                        |
| **AC-229** | Usage over forecast tolerance → incident + recomputed limits, no silent overage                                                                                                                   | Collector monthly-credit usage over tolerance raises incident, recomputes admission, never silently consumes paid overage or protected reserve (FR-COL-010)                                                                                                                                      | Second overage in same period incidents again; pause resume without audit ref refused                                                                        |
| **AC-230** | Fixtures resolve only to matching versioned decoders/adapters + signed manifests; unknown → explicit unsupported                                                                                  | Full fixture sweep across all 10 named designs (Pump/PumpSwap, Raydium ×5, Orca, Meteora ×4 groups, Jupiter route, constant-product, concentrated-liquidity, bin-based, bonding-curve, dynamic-fee, unknown); each resolves to its versioned decoder with signed manifest (FR-COL-002)           | Unknown/mismatched design returns explicit UNSUPPORTED/degraded — never generic constant-product output; manifest without signature/hash refuses             |
| **AC-231** | Every active decoder/adapter passes layout + live-chain verification, deterministic vectors, adversarial/boundary tests, upgrade detection, parity within tolerance; Jupiter reconciled to venues | Per-family: official-layout + live-chain verification records, deterministic vectors, valid/adversarial property + boundary tests, upgrade-change detection, observed-trade parity where claimed, reference-quote parity within versioned tolerance; Jupiter routes reconciled to venue adapters | Parity beyond tolerance fails the family; upgrade with undetected layout change refuses activation; Jupiter treated as pool-math authority is a test failure |
| **AC-237** | Parity drift/upgrade degrades only affected scope, re-evaluates candidates, preserves history, blocks new confirmed alerts until revalidated                                                      | Inject drift → only affected scope paused; raw events preserved; historical results intact; new confirmed alerts blocked; candidate re-evaluation triggered; revalidation restores (FR-COL-007)                                                                                                  | Unaffected scope continues producing derived facts (assertion that degradation did NOT leak); auto-reactivation refused                                      |

### Unit + contract tests (colocated, gate-required)

- `packages/collector-core/test/**` — scope cannot imply outside coverage; stream
  record fail-closed fields; backoff determinism; dedupe idempotence; ceiling
  pause; health field completeness (every FR-COL-008 field present).
- `packages/collector-solana/test/**` — transport §35.6 validation matrix;
  registry manifest verification; sharding determinism; Jupiter surface
  (no prohibited operations; reconciliation correctness).
- `packages/program-decoders/test/**` — per-family golden vectors + adversarial
  layouts; registry mismatch; drift scope containment.
- `packages/collector-checkpoints/test/**` — partition machine transition table;
  fenced checkpoint semantics; watermark contiguity rules.
- `packages/collector-gap-recovery/test/**` — gap lifecycle; backfill bounds;
  no-backdating clock; waiver scope/expiry.
- `packages/discovery-universe/test/**`, `packages/cheap-monitor/test/**` —
  registry point-in-time queries; attribution append-only; batch bounds;
  promotion determinism.
- `apps/collector/test/**` — boot declaration completeness; leader-lease fencing;
  end-to-end ingest path over PGlite.
- `migrations.spec.ts` (each package) — ordering, checksums, idempotent apply on
  PGlite; AND the central registry duty: `packages/persistence/test/migrator.spec.ts`
  extended with the seven `g0_col_*`/`g0_disc_*` scripts in lexicographic position
  (ADR-0019 plan-sanctioned scope exception — named per task).

## Migrations

Naming per the proven pattern: `g0_col_0001`…`g0_col_0004`, `g0_disc_0001`…`g0_disc_0003`,
lexicographic merge with existing families via the ordered runner. Each file is one
transaction; `CREATE SCHEMA IF NOT EXISTS col/disc`; rollback header per file.
Additive only — no existing table altered (observations/checkpoints/gaps/canonical
keys are referenced by key, never redefined).

| File                                    | Tables                                                                                                | Invariant                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `g0_col_0001_scopes_partitions.sql`     | `col.collector_scopes`, `col.collector_partitions`                                                    | §12.9 state CHECK; scope version monotonic; partition→scope FK                                                  |
| `g0_col_0002_stream_receipts.sql`       | `col.collector_stream_receipts`                                                                       | receipt_hash UNIQUE; coordinate completeness per family enforced producer-side + NOT NULL on required stamps    |
| `g0_col_0003_incidents_decodescope.sql` | `col.collector_decode_pauses`, `col.collector_incidents`                                              | pause scope non-global; incident requires ≥1 evidence ref + audit ref; resolution requires revalidation instant |
| `g0_col_0004_health_ceiling.sql`        | `col.collector_health`, `col.collector_ceiling_counters`                                              | health snapshot append-only; used ≤ cap per dimension                                                           |
| `g0_disc_0001_universe_entries.sql`     | `disc.discovery_universe_entries`, `disc.discovery_attribution`, `disc.coverage_population_manifests` | firstIngestedAt NOT NULL; attribution append-only (trigger); entry unique per (asset, source, sighting)         |
| `g0_disc_0002_cheap_monitor.sql`        | `disc.cheap_monitor_rows`, `disc.monitor_observations`                                                | §12.7 state CHECK; finite check counter ≥ 0 with expiry; one observation per (row, batch)                       |
| `g0_disc_0003_promotions.sql`           | `disc.promotion_decisions`                                                                            | inputs-hash UNIQUE (idempotent replay); decisionVersion required; frozen feature versions NOT NULL              |

## Telemetry

Two declarative catalogs following the proven `telemetry/*.catalog.json` pattern
(declarative contract only; emitter wiring lands with G2 observability):

- `telemetry/col.catalog.json` — `col.scope_activated`, `col.stream_receipt_committed`,
  `col.checkpoint_advanced`, `col.gap_registered`, `col.gap_resolved`,
  `col.backfill_completed`, `col.decode_paused`, `col.incident_opened`,
  `col.health_snapshot`, `col.capacity_paused`, `col.reconnected`,
  `col.first_seen_recorded`. Fields mirror `col.ts` schemas exactly; no event
  carries secret material or raw payloads (hashes and ids only).
- `telemetry/disc.catalog.json` — `disc.entry_recorded`, `disc.attribution_appended`,
  `disc.batch_executed`, `disc.monitor_decision`, `disc.promoted`,
  `disc.monitor_expired`, `disc.coverage_measured`. Fields mirror `disc.ts`.

## Material decisions (proposed ADR texts — bind future packages)

### ADR — Collector vocabulary lives in shared-schemas, not domain

**Decision**: The col/disc enums and fail-closed parse helpers live in
`packages/shared-schemas/src/{col,disc}.ts`, importing existing domain/schema
types. `packages/domain/**` is not in this package's writeScopes; per ADR-0018,
vocabulary homes must be declared in writeScopes at milestone planning time, and
this one was not. Future packages needing these vocabularies import from
`@foresift/shared-schemas`.

### ADR — Collector transport is an internal read-only port, not a vendor SDK

**Decision**: Solana subscription/stream access is implemented as an internal
read-only port inside `packages/collector-solana`, bound to the security
EgressGuard COLLECTOR plane and fixed configured endpoints, with the proven
provider adapter layer used for HTTP backfill/RPC operations. No vendor
WebSocket/SDK bundle is wholesale-installed (§35.7); the transport contains no
message-signing or submission code by construction.

### ADR — Collector facets extend shared AC files additively

**Decision**: Where acceptance files are shared across packages (AC-224…229,
previously landed as cost facets), later facets APPEND describe blocks and update
header trace lists; rewriting or deleting earlier facets is forbidden. This keeps
multi-package AC evidence convergent without cross-package file ownership
conflicts, and applies to every future shared-AC package.

### ADR — Coverage claims are gap-bounded

**Decision**: Every coverage/population claim computed from collector state is
gated by watermark contiguity + open-gap state (unresolved gaps force
`GAP_AFFECTED`/downgraded claims, §63.12). Health telemetry reports coverage
limitations alongside numbers, so no consumer can read a gap-affected count as a
full-universe figure (INV-010).

## Risks and mitigations (planning-level)

| Risk                                                        | Likelihood | Impact | Mitigation                                                                                                                                   |
| ----------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Generic-AMM behavior leaking to unknown designs             | Medium     | HIGH   | Versioned decoder registry keyed by layout hash; UNSUPPORTED is the default resolution; AC-230 fixture sweep incl. unknown designs           |
| WebSocket transport complexity destabilizing suite runtime  | Medium     | MEDIUM | Transport behind an interface; fixtures replay recorded frames; no live network in tests; bounded reconnect loops                            |
| Backfill accidentally backdating available_at               | Low        | HIGH   | Structural no-backdating in proven schemas + retrieval-clock module; AC-225 negative asserts refusal                                         |
| Cheap-monitor scheduler exploding per-candidate             | Low        | HIGH   | Single bounded batch worker; AC-112 counts scheduler messages over 1,000 candidates                                                          |
| Migration registry drift (ADR-0019 failure chain)           | Medium     | HIGH   | Central-registry duty named explicitly in tasks.md (T-registry task); graph-build guard `CENTRAL_MIGRATION_SUITE_UNREFERENCED` also enforces |
| Scope creep into pool math / execution                      | Low        | HIGH   | Pool-math adapters are NOT in this package's implementationRefs; Jupiter observation reconciles only; prohibited scan gate                   |
| AC-224…229 facet extension conflicts with cost-facet owners | Low        | MEDIUM | ADR forbids rewriting earlier facets; append-only + header trace updates                                                                     |

## Non-goals reaffirmed (must not creep into tasks.md)

No trading/custody/signing/wallet/submit surfaces (permanent); no pool-math
execution adapters (FR-EXEC owners); no retrospective/prospective universe
enumeration estimation logic beyond the registry + classifier surface
(FR-DISC-006…014 belong to later packages — noted in out-of-scope-notes); no
provider adapter catalogs beyond observation use (provider-lifecycle owns); no
telemetry emitter wiring (G2); no MCP tool exposure (mcp-surface owns); no
pipeline-stage or tool-core edits; no Alpha Lab logic.

## Validation

```bash
node scripts/automation/package-plan-complete.mjs \
  --package g0-first-party-observation \
  --artifacts-dir /home/minhquan_eth/.archon/workspaces/quantm-zeus/foresift/artifacts/runs/ce42a6ee146fe551ab4c6143b3d70c11

# Package-level verification commands (milestone-declared):
test -d packages/collector-core && pnpm --filter @foresift/collector-core test
test -d packages/collector-solana && pnpm --filter @foresift/collector-solana test
test -d packages/program-decoders && pnpm --filter @foresift/program-decoders test
test -d packages/discovery-universe && pnpm --filter @foresift/discovery-universe test
test -d packages/cheap-monitor && pnpm --filter @foresift/cheap-monitor test

# Overall gates at the pushed HEAD (not planning-only):
pnpm verify
pnpm spec:verify
node scripts/scan-prohibited-capabilities/cli.mjs   # must stay CLEAN
```
