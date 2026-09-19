# Implementation Plan: g2-durable-workflow

**Package**: `g2-durable-workflow` | **Date**: 2026-09-12 | **Spec**: `specs/g2-durable-workflow/spec.md` (scoped derivative of PRD §25 in full, §26.5, §9.2/§9.5/§9.6, §33–§34 envelopes + manifest FR-WF-001…008)
**Authority**: PRD wins over every word below; material decisions are recorded as proposed ADR texts in this file.

## Summary

Deliver the durable automation substrate as ONE new engine package plus
additive extensions, with no dependencies on other G2 packages (this
package is the substrate they build on):

1. **Trigger inbox + exactly-one-run (FR-WF-001, FR-WF-002)** — the §25.2
   `trigger_inbox` record with unique constraints on the canonicalized
   external message identity; the §25.3 endpoint
   `POST /api/v1/internal/schedules/trigger` (verify QStash signature →
   validate timestamp/replay window → canonicalize message ID → idempotent
   inbox insert → resolve active schedule/immutable version → start run
   iff not already started → 202 promptly); duplicate scheduler
   deliveries converge to exactly one logical run (AC-010).
2. **Steps, leases, fencing, bounded retries (FR-WF-001, FR-WF-003)** —
   §25.5 step durability fields with idempotency keys; §25.6 concurrency
   policies (SKIP_IF_RUNNING default for broad scans; candidate rechecks
   serialized by candidate/profile); §25.7 monotonically fenced leases
   mirroring the proven G0 `core_single_flight_leases` pattern (dedicated
   sequence, takeover always allocates a fresh token, stale commits
   refused — AC-012); §25.8 retry taxonomy encoded as a total pure
   function from error class to policy (no retry, bounded exponential
   backoff with jitter, retry-after-reset, single repair, transaction
   retry, outbox retry).
3. **Versioned schedules + reconciliation (FR-WF-004, FR-WF-005)** —
   §25.11 control actions (CREATE, EDIT_DRAFT, VALIDATE, ENABLE, PAUSE,
   RESUME, RUN_NOW, DRY_RUN, DUPLICATE, DISABLE, DELETE) over immutable
   configuration versions with active runs pinned to their resolved
   version (AC-013); AC-014 full lifecycle; AC-063 forecast-before-enable
   gate consuming the proven G1 capacity-forecast substrate; §25.10
   reconciliation job diffing database schedules against external
   scheduler state with incident + optional repair on drift.
4. **Atomic outbox + crash-safe delivery (FR-WF-006)** — §26.5
   decision/alert/outbox single-transaction commit boundary plus
   lease-claimed delivery workers that send exactly once across crashes
   (AC-011).
5. **Dead letters + safe retry (FR-WF-007)** — §25.9 DEAD_LETTERED state
   with actionable error context and retry-from-last-valid-checkpoint
   that re-executes (never rewrites history, per INV-005/INV-006).
6. **Shadow execution mechanism (FR-WF-008)** — per-version/per-run
   shadow flags; shadow runs execute fully but cannot exert opportunity
   influence (no confirmed-opportunity delivery, no policy write-back).

Plus additive extensions: `packages/domain/src/wf.ts` +
`packages/shared-schemas/src/wf.ts` vocabularies/schemas, migration
family `wf` (`migrations/g2_wf_*.sql` in a dedicated `wf` schema),
fixtures `tests/fixtures/wf/`, telemetry `telemetry/wf.catalog.json`,
and the manifest-owned AC-010…014 + AC-063 suites (positive and
negative), with wf-scoped extends of the shared AC-060/AC-061 suites.

Strictly read-only (INV-001): no trading, custody, wallet-signing,
private-key, or transaction-submission capability anywhere in the
engine, endpoint, migrations, or tests.

## Technical Context

- **Language/runtime**: TypeScript (ESM, strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) in the existing pnpm workspace; Bun Test is
  the repository test authority. New package `packages/workflow-runtime`
  (`@foresift/workflow-runtime`) follows the G0/G1 scaffold pattern:
  workspace `*` dependencies, `bun test` script, tsconfig extending
  `tsconfig.base.json`, no per-package runner config.
- **Storage**: PostgreSQL schema via `@foresift/persistence`
  (`DatabaseEngine` seam); tests run on PGlite per ADR-0014. Migrations are
  the SQL source of truth in a dedicated `wf` schema (mirroring the `core`
  schema precedent — this keeps the landed AC-261 `public`-schema absence
  probe green until the recovery package extends it to the real `wf`
  names). New migration family `wf` — `g2_wf_*.sql`, additive only; the
  fail-closed family list in `packages/persistence/src/migrator.ts` is
  extended with `wf` and the central expected-script registry
  (`packages/persistence/test/migrator.spec.ts`) is extended in the same
  package (plan-sanctioned scope exception, milestone plan-level
  decision 1 / ADR-0019·ADR-0022 duty). The hand-maintained ADR-001
  Drizzle mirror (`packages/persistence/src/generated/schema.ts`) catches
  up to SQL truth in the same package — the schema-parity gate enumerates
  tables and fails on any gap (precedent: g1-data-truth-extensions,
  g1-execution-simulation).
- **Validation**: Zod schemas authoritative in `packages/shared-schemas`
  (ADR-0013). Closed vocabularies (workflow/step/lease/dead-letter/
  schedule/outbox/shadow states, concurrency policies, retry error
  classes) live in `packages/domain` and are imported, never restated, by
  `packages/shared-schemas` (milestone plan-level decision 3). Every
  envelope object is `.strict()`.
- **External scheduler**: QStash behind a `SchedulerPort` interface
  (constitution IX — product code depends on the capability interface,
  never the vendor SDK). A local in-process adapter serves development
  and PGlite tests; signature verification and replay-window validation
  are adapter-level and fail closed (trust boundary §9.3: scheduler
  callbacks are untrusted until signature, origin, replay, and payload
  validation pass).
- **Test runtime**: PGlite-backed suites only; the full Bun suite runs
  exclusively through the coordinator (`pnpm test:all` or per-workload
  scripts) per the test-runtime contract — never a bare full-tree run.

## Constitution check

- **I (contract authority)**: every task traces to FR-WF-001…008 or one
  of the 14 attached ACs; `docs/spec/**` untouched; spec.md keeps seeded
  normative quotes intact.
- **III (simplicity)**: one engine package + thin internal HTTP handlers;
  no orchestration framework beyond the adopted stack; no separate
  services or brokers (would require an ADR nobody has written).
- **IV (read-only)**: engine has no execution/custody/signing surface;
  negative suites assert its absence (AC-050 family remains green;
  wf-scoped negative tests assert no such route/tool/schema is added).
- **V/VI (time correctness)**: runs pin immutable resolved versions;
  checkpoints record event-time bounds; retry-from-checkpoint
  re-executes, never backdates.
- **VII (provenance)**: steps carry input/output hashes; inbox rows carry
  payload hashes; outbox rows link decision/evidence refs.
- **VIII (fail-closed)**: signature/replay failures, schema drift,
  provider outage, and missing forecasts refuse or degrade explicitly
  (AC-061 wf-scoped extend: outage → explicit partial/insufficient output
  and suppression of unsafe automated sends at the outbox gate).
- **IX (abstraction)**: `SchedulerPort`; delivery-channel send behind a
  `NotificationChannelPort` so Telegram/admin-inbox are swappable and the
  crash test can use a fake channel.
- **XII (positive + failure-path)**: every authored AC gets both suites;
  fencing, crash, drift, and exhaustion paths are failure-path tested.
- **XIII/XIV (replay, durability)**: idempotent consumers, fenced
  commits, persisted progress; planning state itself lives on disk/git.
- **XV (least privilege)**: internal trigger route is authenticated
  service surface; secrets never in git/logs/artifacts.

## Project structure (files inside writeScopes)

```text
packages/domain/src/wf.ts                # closed vocabularies + pure laws (NEW)
packages/shared-schemas/src/wf.ts        # Zod mirrors + row envelopes (NEW)
packages/shared-schemas/src/index.ts     # barrel export (EXTEND)
packages/workflow-runtime/               # engine package (NEW)
  src/trigger-inbox.ts                   # canonicalize, idempotent insert, resolve, exactly-one-run
  src/schedules.ts                       # versioned CRUD + §25.11 control actions + forecast gate
  src/steps.ts                           # checkpoint read/write, idempotency-key enforcement
  src/leases.ts                          # fencing-token acquire/release/compare (G0-mirrored law)
  src/retries.ts                         # §25.8 taxonomy as total pure function + backoff
  src/outbox.ts                          # atomic commit helper + lease-claimed delivery worker
  src/dead-letters.ts                    # exhaustion, context, retry-from-checkpoint
  src/reconciliation.ts                  # DB-vs-scheduler diff, incidents, optional repair
  src/shadow.ts                          # shadow-run guard (no opportunity influence)
  src/scheduler-port.ts                  # SchedulerPort + local adapter (+ QStash adapter)
  src/channels.ts                        # NotificationChannelPort + fake/test channel
  src/verify-state.ts                    # read-only state-verification queries (recovery seam)
  src/index.ts
migrations/g2_wf_0001_schedules_runs.sql # wf schema: schedules, versions, inbox, runs, steps, leases
migrations/g2_wf_0002_outbox_deadletter.sql # outbox, dead letters, reconciliation reports
apps/api/src/internal/                   # trigger endpoint + schedule internal handlers (NEW)
telemetry/wf.catalog.json                # declarative event catalog mirroring wf.ts (NEW)
tests/fixtures/wf/                       # trigger/schedule/outbox/crash fixtures (NEW)
tests/acceptance/AC-010..014, AC-063     # authored positive suites (NEW)
tests/negative/AC-010..014, AC-063       # authored negative suites (NEW)
tests/acceptance + negative AC-060/061   # wf-scoped extends of shared suites (EXTEND)
```

Plan-sanctioned scope exceptions (exact paths only, named so the
task-graph builder records them): `packages/persistence/src/migrator.ts`
(family-list extension with `wf`), `packages/persistence/src/generated/
schema.ts` (ADR-001 mirror catch-up), `packages/persistence/test/
migrator.spec.ts` (central expected-script registry), and
`tests/telemetry-catalog.spec.ts` (central telemetry parity suite).

`docs/generated/wf-surfaces.json` already exists from the G0 central
generation and is deliberately excluded from writeScopes; implementation-
mapping reconciliation stays with g2-production-readiness (milestone
plan-level decision 2).

## Architecture decisions

**D1. Engine owns the commit boundary; alert content stays out.**
`commitDecisionWithOutbox` takes an already-classified decision record
(shape validated by Zod) and commits decision + alert record + outbox
entry in one transaction. The alert package later defines what a valid
classification is; the engine guarantees atomicity and delivery
regardless of classification rules. This is why FR-WF-006 lives here
while classification lives there (milestone plan-level decision 6).

**D2. Fencing mirrors G0 exactly.** One CURRENT lease row per resource
key, tokens from a dedicated `wf_lease_fencing_seq` sequence, takeover
always `nextval`s, guarded-UPSERT release, zero-rows-updated means
refusal. Stale holders fail closed at commit time, not at check time
(AC-012 proves the interleaving, not just the comparison function).

**D3. Exactly-one-run via inbox uniqueness + run dedupe key.**
`trigger_inbox` unique on `(source, canonical_external_message_id)`;
run creation unique on `(schedule_id, schedule_version, inbox_id)` so a
duplicate delivery that reaches run creation still converges. Concurrency
policy (default SKIP_IF_RUNNING) is evaluated after dedupe, so a policy
skip and a duplicate collapse are distinguishable in telemetry.

**D4. Immutable versions, pinned runs.** Every configuration mutation
writes a new `schedule_versions` row; `runs` stores
`resolved_schedule_version`. Deployment of new engine code never rewrites
a running run's version (AC-013 proven by starting a run on version N,
deploying version N+1 in-test, and asserting the run completes on N).

**D5. Shadow is a run-scoped execution flag with a single choke point.**
`shadow.ts` exposes `assertNoOpportunityInfluence(run)` called by the
outbox commit path and the delivery worker: shadow runs may write
decisions and shadow-tagged outbox rows for evaluation, but any attempt
to enqueue a deliverable opportunity notification throws a typed error.
Governance (which versions are shadow) is consumed as flags, never
decided here.

**D6. Reconciliation is a diff report first, repair second.**
`reconciliation.ts` returns a structured diff (missing-external,
missing-database, cron/timezone skew, paused-state skew, destination/
external-ID skew); incidents are always raised; repair is opt-in per
call. Tests prove each skew class is detected; repair is proven only for
the safe direction (database-paused → external-paused propagation never
unpauses anything by itself).

**D7. Forecast-before-enable is a gate, not a computation.**
ENABLE requires a fresh capacity-forecast payload (runs/day, provider
calls/day, model tokens/day, spend/day, quota-exhaustion date,
storage/month — §33.6 shape) attached to the enable request; absent or
stale forecasts refuse with a typed error (AC-063). Forecast
computation itself is G1-proven substrate and is not reimplemented.

## Data model (wf schema; additive tables only)

- `wf.schedules` (schedule_id PK, name, concurrency_policy, active flag,
  current_version_id, created/updated bounds) and
  `wf.schedule_versions` (immutable: version_id PK, schedule_id,
  config_hash `sha256:<hex>`, resolved config JSONB, shadow flag,
  superseded_by, created_at).
- `wf.trigger_inbox` (§25.2 exact fields + canonical message ID unique
  constraint + status CHECK vocabulary).
- `wf.runs` (run_id PK, schedule_id, resolved_schedule_version,
  inbox_id unique, trigger identity, concurrency-policy outcome,
  shadow flag, status, deadline per §33.2, started/completed bounds).
- `wf.steps` (§25.5 exact fields + idempotency_key unique per run +
  input/output `sha256:<hex>` hashes).
- `wf.step_leases` (resource key PK, fencing token from dedicated
  sequence, holder, expiry, release — G0-mirrored law).
- `wf.notification_outbox` (decision ref, alert ref, channel, payload
  hash, status vocabulary PENDING/CLAIMED/SENT/FAILED/SUPPRESSED,
  claim lease + fencing token, attempt count, timestamps).
- `wf.dead_letters` (run/step ref, error class, actionable context
  JSONB, last valid checkpoint ref, status OPEN/RETRIED/RESOLVED).
- `wf.reconciliation_reports` (checked_at, diff JSONB, incident refs).

## Verification strategy per acceptance criterion

- **AC-010** (duplicate deliveries → one run): positive — double/triple
  delivery incl. concurrent race converges to one run, one inbox
  processed_run_id; negative — distinct message IDs still create
  distinct runs; replay outside the window is refused, not deduped.
- **AC-011** (crash after commit, before send → exactly one
  notification): positive — commit, kill delivery mid-flight (fake
  channel fault injection), recover, worker claims and sends exactly
  once; negative — a second worker holding a stale claim cannot send.
- **AC-012** (stale worker cannot commit after fencing change):
  positive — lease takeover then stale commit refused (zero rows);
  negative — expired-but-not-taken-over lease still permits the holder
  (expiry alone is not fencing).
- **AC-013** (runs keep immutable version): positive — run completes on
  version N after N+1 exists; negative — mutating version N in place is
  refused at the SQL CHECK level.
- **AC-014** (full schedule lifecycle): positive — validate → enable →
  pause → resume → run-now → dry-run (no outbox commit, no influence) →
  disable; negative — enable with invalid cron/timezone refused; run-now
  on a disabled schedule refused; dry-run proven to leave no outbox row.
- **AC-063** (forecast before enable): positive — enable with fresh
  forecast succeeds and the forecast is persisted with the version;
  negative — enable without forecast, or with a stale forecast, is
  refused with a typed error.
- **AC-060** (overhead): wf-scoped extend — trigger acknowledgement p95
  < 2 s on the benchmark workload; internal overhead budgets asserted on
  the inbox→run→checkpoint hot path (existing suite stays green).
- **AC-061** (outage → explicit partial + suppression): wf-scoped
  extend — provider-outage error class marks the step degraded and the
  outbox gate suppresses opportunity sends while preserving the decision
  record (fail-closed, observable).
- **AC-062 / AC-260…264**: not authored here (recovery-owned suites
  already exist and stay green); this package guarantees the seam —
  `wf`-schema tables plus `verify-state.ts` read-only queries covering
  inbox/outbox/lease/dead-letter consistency that the recovery package
  will wire into its drills. A cross-package contract note (not a test)
  records the table/check names for the recovery planner.

## Risks and mitigations

- Exactly-once overclaim: mitigated by proving interleavings (stale
  claim, crashed sender, duplicate delivery race), never just the happy
  path; delivery sends only from CLAIMED rows the worker owns.
- QStash trust: adapter validates signature + replay window before any
  state write; unsigned/forged/expired deliveries are refused and
  metered (SSRF/forgery posture per AC-051 stays green).
- Scope bleed into alert/admin/governance/recovery logic: each engine
  module documents its consumer seam and refuses foreign domain logic
  (scheduler D4/D5/D7); out-of-scope gaps go to `out-of-scope-notes.md`.

## Proposed ADR texts (bind future packages if accepted)

**ADR-G2WF-1 — `wf`-schema table home for workflow state.**
Workflow/inbox/outbox/lease/dead-letter tables live in a dedicated
`wf` PostgreSQL schema (not `public`), mirroring the `core` schema
precedent. Rationale: the landed AC-261 probe asserts absence of
`public.outbox_events`/`public.workflow_inbox` on clean restores; the
`wf` home keeps that probe green and gives the recovery package stable
qualified names to verify. Future packages MUST NOT create unqualified
workflow tables in `public`.

**ADR-G2WF-2 — SchedulerPort is the only scheduler seam.**
All schedule↔scheduler interaction (create/update/delete/list/get)
passes through `SchedulerPort`; QStash specifics (signatures, replay
windows, external IDs) live in the adapter. The reconciliation job
diffs `wf.schedules` against `SchedulerPort.list()`. Rationale:
constitution IX and the §25.10 drift surface; lets tests and the local
adapter prove reconciliation without vendor access.

## Verification commands (package scope)

```bash
test -d packages/workflow-runtime && pnpm --filter @foresift/workflow-runtime test
bun test tests/acceptance/AC-010.spec.ts tests/acceptance/AC-011.spec.ts tests/acceptance/AC-012.spec.ts tests/acceptance/AC-013.spec.ts tests/acceptance/AC-014.spec.ts
bun test tests/negative/AC-010.negative.spec.ts tests/negative/AC-011.negative.spec.ts tests/negative/AC-012.negative.spec.ts tests/negative/AC-013.negative.spec.ts tests/negative/AC-014.negative.spec.ts
```

plus `pnpm verify` and `pnpm spec:verify` at the pushed HEAD per the
completion standard (run by the implementation loop, not this plan).
