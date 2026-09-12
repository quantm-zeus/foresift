# Tasks: g2-durable-workflow

**Input**: `specs/g2-durable-workflow/spec.md`, `specs/g2-durable-workflow/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-WF-001…008) or an acceptance criterion of those requirements.
Requirement IDs not assigned to this package never appear here.

Format: `- [ ] T### [P?]` — **[P]** = parallelizable with its neighbors (disjoint files).
A PRODUCT task that must stay serial carries exactly one
`[serial-reason: SEMANTIC_DEPENDENCY|SHARED_FILE|ORDERED_MIGRATION|SHARED_INVARIANT|COORDINATOR_BOUNDARY|SAFETY_SERIALIZATION]`
marker (2026-09-08 maintainer directive; the parallelism audit refuses an
unjustified serial plan). Test-owned work carries `[executor: TEST]` and is
routed to the test-author lanes; implementation-dispatched product tasks
NEVER carry test/fixture/spec writes (2026-09-07 ownership admission law —
the graph builder refuses such plans before any provider spend).
Tests are mandatory per PRD evidence rules: positive AND negative/failure-path
specs for every acceptance criterion this package authors (AC-010, AC-011,
AC-012, AC-013, AC-014, AC-063) plus wf-scoped extends of the shared
AC-060/AC-061 suites (AC-062 and AC-260…264 stay owned by the recovery
package; this package guarantees the read-only state seam they will verify).
Plan-sanctioned scope exceptions recorded per the milestone plan-level
decisions (1 and 3) and ADR-0019/ADR-0022 duty, named by exact path:
`packages/persistence/src/migrator.ts` (family-list extension with `wf`,
product-owned T008), `packages/persistence/src/generated/schema.ts`
(ADR-001 mirror catch-up, product-owned T009),
`packages/persistence/test/migrator.spec.ts` (central expected-script
registry, test-owned T010), and the central telemetry parity suite
(test-owned T039) are extended by this package even though they sit outside
the listed writeScopes.

Staging order mirrors the PRD §25 pipeline: vocabularies and schemas first,
then persistence, then the engine core (inbox → schedules → steps/leases/
retries), then the commit boundary and lifecycle (outbox → dead letters →
reconciliation → shadow), then the internal HTTP surface, then fixtures and
AC suites, then telemetry and gates.

## Phase 1 — Foundations: domain vocabularies and shared schemas

- [ ] T001 [P] Create `packages/domain/src/wf.ts`: `TriggerStatus`
      (RECEIVED, VERIFIED, PROCESSED, DUPLICATE_COLLAPSED, REJECTED),
      `RunStatus` (PENDING, RUNNING, WAITING, SUCCEEDED, FAILED,
      CANCELLED, DEAD_LETTERED), `StepStatus` (PENDING, RUNNING, SUCCEEDED,
      FAILED_RETRYABLE, FAILED_EXHAUSTED, SKIPPED_POLICY),
      `ScheduleStatus` (DRAFT, ACTIVE, PAUSED, DISABLED),
      `ConcurrencyPolicy` (SKIP_IF_RUNNING, QUEUE_AFTER_RUNNING,
      CANCEL_PREVIOUS, ALLOW_PARALLEL — §25.6 order), `RetryErrorClass`
      (AUTH_INVALID_KEY, INVALID_INPUT, RATE_LIMITED, TIMEOUT_OR_5XX,
      SCHEMA_DRIFT, MODEL_FORMAT_ERROR, BUDGET_EXCEEDED,
      SERIALIZATION_CONFLICT, NOTIFICATION_TRANSIENT — §25.8 rows),
      `OutboxStatus` (PENDING, CLAIMED, SENT, FAILED, SUPPRESSED_SHADOW,
      SUPPRESSED_OUTAGE), `DeadLetterStatus` (OPEN, RETRIED, RESOLVED),
      `ScheduleControlAction` (§25.11 eleven actions) with fail-closed parse
      throwing typed errors with stable `WfErrorCode`s; plus the pure laws
      `retryPolicyFor(errorClass)` (total over all nine classes: none,
      retry-after-reset, bounded exponential backoff with jitter, single
      repair, transaction retry, outbox retry, disable-operation),
      `shadowSuppressesInfluence` (any opportunity-influence send from a
      shadow run is refused), and `defaultConcurrencyFor(kind)` (broad scan
      SKIP_IF_RUNNING; candidate recheck serialized by candidate/profile).
      Colocated unit tests are authored by the test-owned task T005
      (ownership law: implementation lanes carry product work only).
      Traces: FR-WF-001, FR-WF-002, FR-WF-003, FR-WF-004, FR-WF-005,
      FR-WF-006, FR-WF-007, FR-WF-008.
- [ ] T002 [serial-reason: SHARED_FILE] Extend
      `packages/domain/src/index.ts` exports for the new wf module.
      Traces: FR-WF-001…008.
- [ ] T003 [P] Create `packages/shared-schemas/src/wf.ts`: Zod mirrors
      of every T001 vocabulary (compile-linked domain enums, never
      restated), all envelope objects `.strict()`, plus row schemas for the
      §25.2 inbox record, the §25.5 step record (idempotency_key,
      lease_owner, lease_version, lease_expires_at, error_class,
      retryable), schedule/version rows (config_hash `sha256:<hex>`,
      shadow flag), outbox rows (claim lease + fencing token), dead-letter
      rows (actionable context + last-valid-checkpoint ref), and the §33.6
      forecast payload shape consumed by the enable gate. Refinements:
      inbox unique-identity fields non-empty; hashes match the
      `sha256:<64hex>` shape; version rows immutable by construction (no
      update schema exported — only insert). Colocated schema tests are
      authored by T005. Traces: FR-WF-001…008, AC-010, AC-012, AC-013,
      AC-063.
- [ ] T004 [serial-reason: SHARED_FILE] Extend
      `packages/shared-schemas/src/index.ts` exports for the new wf module.
      Traces: FR-WF-001…008.
- [ ] T005 [executor: TEST] [P] Colocated unit tests for T001 pure laws
      (retry taxonomy totality over all nine classes; shadow suppression;
      concurrency defaults; fail-closed parse on every unknown literal) and
      T003 schema round-trips (accept exact §25.2/§25.5 shapes; refuse
      unknown keys, malformed hashes, version-update payloads).
      Traces: FR-WF-001, FR-WF-002, FR-WF-003, FR-WF-004, FR-WF-006,
      FR-WF-008.

## Phase 2 — Persistence: wf schema migrations and registry duty

- [ ] T006 [serial-reason: ORDERED_MIGRATION] Write
      `migrations/g2_wf_0001_schedules_runs.sql`: `wf` schema; `wf.schedules`
  - `wf.schedule_versions` (immutable — no UPDATE path; supersede via
    new row); `wf.trigger_inbox` (§25.2 fields; unique on
    `(source, canonical_external_message_id)`); `wf.runs` (resolved
    version pin, inbox ref unique, concurrency-policy outcome, shadow
    flag, absolute deadline); `wf.steps` (§25.5 fields; idempotency_key
    unique per run); `wf.step_leases` (key PK, fencing sequence
    `wf_lease_fencing_seq`, G0-mirrored takeover/refusal law). All tables
    live under `wf`, never `public` (ADR-G2WF-1 proposal keeps the landed
    AC-261 `public`-schema probe green).
    Traces: FR-WF-001, FR-WF-002, FR-WF-003, FR-WF-004, FR-WF-008.
- [ ] T007 [serial-reason: ORDERED_MIGRATION] Write
      `migrations/g2_wf_0002_outbox_deadletter.sql`:
      `wf.notification_outbox` (decision/alert refs, channel, payload hash,
      status vocabulary, claim lease + fencing token, attempts,
      timestamps); `wf.dead_letters` (run/step refs, error class,
      actionable context JSONB, last-valid-checkpoint ref, status);
      `wf.reconciliation_reports` (checked_at, structured diff JSONB,
      incident refs). Numbers after T006; additive only, no ALTER of
      foreign families. Traces: FR-WF-005, FR-WF-006, FR-WF-007.
- [ ] T008 [serial-reason: SHARED_FILE] Extend the fail-closed family
      list in `packages/persistence/src/migrator.ts` with `wf`
      (plan-sanctioned scope exception, exact path). Traces: FR-WF-001.
- [ ] T009 [serial-reason: SHARED_FILE] Catch the hand-maintained
      ADR-001 Drizzle mirror
      (`packages/persistence/src/generated/schema.ts`) up to the T006/T007
      SQL truth (plan-sanctioned scope exception, exact path) so the
      schema-parity gate passes. Traces: FR-WF-001.
- [ ] T010 [executor: TEST] [P] Extend the central expected-script
      registry (`packages/persistence/test/migrator.spec.ts`, exact path —
      plan-sanctioned scope exception) with the two `g2_wf_*` scripts in
      lexicographic order. Traces: FR-WF-001.
- [ ] T011 [executor: TEST] [P] PGlite migration-shape tests for the
      `wf` family: both scripts apply cleanly on a fresh database; SQL
      CHECKs refuse an in-place version mutation, a duplicate inbox
      identity, a duplicate run dedupe key, and a stale lease release
      (zero-rows refusal); `wf` tables are absent from `public`.
      Traces: FR-WF-001, FR-WF-002, FR-WF-003, FR-WF-004, AC-010, AC-012,
      AC-013.

## Phase 3 — Engine core: inbox, schedules, steps, leases, retries

- [ ] T012 [P] Create
      `packages/workflow-runtime/src/scheduler-port.ts`: `SchedulerPort`
      (create/update/delete/list/get schedule; external-ID mapping);
      signature verification + timestamp/replay-window validation at the
      adapter boundary, fail-closed on forged/expired/replayed deliveries;
      local in-process adapter for development and PGlite tests; thin
      production adapter over the vendor SDK with no product logic inside
      (ADR-G2WF-2 proposal). Traces: FR-WF-002, FR-WF-005.
- [ ] T013 [P] Create
      `packages/workflow-runtime/src/trigger-inbox.ts`: external-message-ID
      canonicalization; idempotent inbox insert resolving to
      DUPLICATE_COLLAPSED; active schedule + current immutable version
      resolution; exactly-one-run creation guarded by the
      `(schedule, version, inbox)` dedupe key with concurrency-policy
      evaluation recorded distinctly from dedupe collapse; prompt-202
      return shape for the HTTP layer. Traces: FR-WF-001, FR-WF-002,
      AC-010.
- [ ] T014 [P] Create
      `packages/workflow-runtime/src/schedules.ts`: versioned CRUD
      (mutations write new immutable versions, never UPDATE); the §25.11
      control actions VALIDATE, ENABLE (refuses without a fresh §33.6
      forecast payload — AC-063 gate), PAUSE, RESUME, RUN_NOW (refused on
      DISABLED), DRY_RUN (executes without outbox commit or opportunity
      influence), DISABLE, plus CREATE/EDIT_DRAFT/DUPLICATE/DELETE;
      cron/timezone validation; cost-forecast persistence with the version.
      Traces: FR-WF-004, AC-013, AC-014, AC-063.
- [ ] T015 [P] Create `packages/workflow-runtime/src/steps.ts`:
      checkpoint write/read for the §25.4 standard step order; per-run
      idempotency-key enforcement (replayed step with the same key returns
      the recorded output hash, never re-executes the side effect);
      attempt/input/output hash bookkeeping. Traces: FR-WF-001, FR-WF-003.
- [ ] T016 [P] Create `packages/workflow-runtime/src/leases.ts`:
      acquire/release/compare over `wf.step_leases` with monotonically
      increasing fencing tokens; takeover always allocates a fresh token;
      commit-time guarded compare so a stale holder fails closed even when
      expiry alone has not fired. Traces: FR-WF-003, AC-012.
- [ ] T017 [P] Create `packages/workflow-runtime/src/retries.ts`:
      executable retry policy from the T001 pure law (bounded exponential
      backoff with jitter, retry-after-reset within budget, single repair,
      transaction retry, outbox retry, no-retry classes); exhaustion
      transitions to dead-letter handoff input. Traces: FR-WF-003,
      FR-WF-007.
- [ ] T018 [serial-reason: SHARED_FILE] Create
      `packages/workflow-runtime/src/index.ts` barrel plus package
      scaffold (`package.json` `@foresift/workflow-runtime`, tsconfig
      extending the base, `bun test` script) following the G0/G1 package
      pattern. Traces: FR-WF-001.
- [ ] T019 [executor: TEST] [P] Engine-core unit tests on PGlite:
      inbox canonicalization + duplicate-collapse races; version-pin
      retention across a simulated deploy; fencing compare under
      acquire/takeover/stale-commit interleavings; retry-policy totality
      incl. jitter bounds and budget-exceeded refusal; dry-run leaving no
      outbox row. Traces: FR-WF-001, FR-WF-002, FR-WF-003, FR-WF-004,
      AC-010, AC-012, AC-013, AC-014.

## Phase 4 — Commit boundary and lifecycle: outbox, dead letters, reconciliation, shadow

- [ ] T020 [serial-reason: SEMANTIC_DEPENDENCY] Create
      `packages/workflow-runtime/src/outbox.ts`: `commitDecisionWithOutbox`
      (decision + alert record + outbox entry in ONE transaction — §26.5);
      lease-claimed delivery workers (`NotificationChannelPort` in T024)
      that send only from CLAIMED rows they own and update state after
      send; crash recovery re-claims orphaned CLAIMED rows after lease
      expiry and completes exactly-once delivery (AC-011); outage error
      class routes to SUPPRESSED_OUTAGE with the decision record preserved
      (AC-061 wf contribution). Traces: FR-WF-006, AC-011, AC-061.
- [ ] T021 [P] Create
      `packages/workflow-runtime/src/dead-letters.ts`: retry-exhaustion
      entry to DEAD_LETTERED with actionable error context; queryable
      dead-letter listing inputs for the admin package; safe
      retry-from-last-valid-checkpoint that re-executes subsequent steps
      under fresh idempotency keys without rewriting completed history.
      Traces: FR-WF-007.
- [ ] T022 [P] Create
      `packages/workflow-runtime/src/reconciliation.ts`: scheduled diff of
      database schedules vs `SchedulerPort.list()` over the five §25.10
      dimensions (presence both ways, cron/timezone, paused state,
      destination, external ID); incidents always raised on mismatch;
      opt-in repair limited to the safe direction (never unpauses by
      itself). Traces: FR-WF-005.
- [ ] T023 [P] Create `packages/workflow-runtime/src/shadow.ts`:
      per-version/per-run shadow flags; single choke point
      `assertNoOpportunityInfluence` invoked by the T020 commit path and
      delivery workers (shadow opportunity sends throw typed errors;
      shadow-tagged rows remain available for evaluation reads).
      Traces: FR-WF-008.
- [ ] T024 [P] Create `packages/workflow-runtime/src/channels.ts`:
      `NotificationChannelPort` (enqueue/send/ack timestamp retention per
      §26.9 sampling needs) plus a fake channel for crash/interleaving
      tests; no production credential handling in the engine.
      Traces: FR-WF-006, AC-011.
- [ ] T025 [P] Create
      `packages/workflow-runtime/src/verify-state.ts`: read-only
      inbox/outbox/lease/dead-letter consistency queries (orphaned claims,
      unprocessed inbox beyond threshold, outbox lag, dead-letter counts)
      forming the recovery drill seam — documents the exact check names and
      `wf`-qualified table names the recovery package will wire into its
      AC-062/AC-260…264 drills (those suites stay owned there; this task
      ships the seam plus a contract note, no drill tests).
      Traces: FR-WF-002, FR-WF-003, FR-WF-006, FR-WF-007, AC-062, AC-261.
- [ ] T026 [executor: TEST] [P] Lifecycle unit tests on PGlite with the
      fake channel: atomic-commit rollback on outbox failure; claim,
      crash, re-claim, exactly-once send; stale-claim send refusal;
      dead-letter context completeness + checkpoint retry resuming from
      the last valid step; all five reconciliation skew classes detected;
      shadow send attempts refused while shadow reads succeed.
      Traces: FR-WF-005, FR-WF-006, FR-WF-007, FR-WF-008, AC-011.

## Phase 5 — Internal HTTP surface

- [ ] T027 [P] Create the §25.3 trigger endpoint under
      `apps/api/src/internal/` (`POST
/api/v1/internal/schedules/trigger` over the T012/T013 engine
      functions; authenticated service surface; returns 202 promptly after
      inbox insert + run start). Traces: FR-WF-002, AC-010.
- [ ] T028 [P] Create schedule internal handlers under
      `apps/api/src/internal/` exposing the T014 control actions and the
      T022 reconciliation trigger plus read handlers for runs, steps,
      dead letters, and outbox state backing the admin package (rendering
      stays with that package; these handlers implement and validate).
      Traces: FR-WF-004, FR-WF-005, FR-WF-007, AC-014.
- [ ] T029 [executor: TEST] [P] Endpoint tests: valid signed delivery
      → 202 + one run; forged signature, expired timestamp, and replayed
      envelope refused before any state write; duplicate delivery →
      single run; control-action handler matrix incl. forecast-less enable
      refusal and disabled-schedule run-now refusal.
      Traces: FR-WF-002, FR-WF-004, AC-010, AC-014, AC-063.

## Phase 6 — Fixtures and acceptance suites

- [ ] T030 [executor: TEST] [P] Create `tests/fixtures/wf/`:
      canonical trigger envelopes (valid/forged/expired/replayed/
      duplicate), schedule drafts (valid + invalid cron/timezone), forecast
      payloads (fresh/stale/absent), crash-recovery outbox fixtures, and
      scheduler-drift fixtures covering all five §25.10 skew classes.
      Traces: FR-WF-002, FR-WF-004, FR-WF-005, FR-WF-006.
- [ ] T031 [executor: TEST] [P] Author `tests/acceptance/AC-010.spec.ts`
  - `tests/negative/AC-010.negative.spec.ts`: duplicate (incl.
    concurrent-race) deliveries create exactly one logical run / distinct
    message IDs still create distinct runs; out-of-window replays refused.
    Traces: FR-WF-001, FR-WF-002, AC-010.
- [ ] T032 [executor: TEST] [P] Author `tests/acceptance/AC-011.spec.ts`
  - `tests/negative/AC-011.negative.spec.ts`: crash after decision
    commit but before send yields exactly one notification after recovery
    / stale-claim second send refused; lost-send (no commit) never
    notifies. Traces: FR-WF-001, FR-WF-006, AC-011.
- [ ] T033 [executor: TEST] [P] Author `tests/acceptance/AC-012.spec.ts`
  - `tests/negative/AC-012.negative.spec.ts`: stale worker commit
    after lease fencing change refused / expiry-without-takeover still
    permits the holder; fencing tokens strictly increase across
    takeovers. Traces: FR-WF-001, FR-WF-003, AC-012.
- [ ] T034 [executor: TEST] [P] Author `tests/acceptance/AC-013.spec.ts`
  - `tests/negative/AC-013.negative.spec.ts`: active runs complete on
    their original immutable version after a new version deploys /
    in-place version mutation refused. Traces: FR-WF-001, FR-WF-004,
    AC-013.
- [ ] T035 [executor: TEST] [P] Author `tests/acceptance/AC-014.spec.ts`
  - `tests/negative/AC-014.negative.spec.ts`: full
    validate/enable/pause/resume/run-now/dry-run/disable lifecycle /
    invalid cron, forecast-less enable, and disabled run-now refused;
    dry-run leaves no outbox row and exerts no opportunity influence.
    Traces: FR-WF-004, FR-WF-008, AC-014.
- [ ] T036 [executor: TEST] [P] Author `tests/acceptance/AC-063.spec.ts`
  - `tests/negative/AC-063.negative.spec.ts`: forecast displayed and
    persisted at enable / enable without forecast or with a stale
    forecast refused with a typed error. Traces: FR-WF-004, AC-063.
- [ ] T037 [executor: TEST] [P] Wf-scoped extends of the shared
      AC-060/AC-061 suites (existing files stay green): trigger
      acknowledgement p95 < 2 s on the benchmark workload and inbox→run→
      checkpoint overhead budgets (AC-060 contribution); provider-outage
      error class producing explicit partial/insufficient output with
      opportunity sends suppressed at the outbox gate while the decision
      record is preserved (AC-061 contribution). Traces: FR-WF-001,
      FR-WF-002, FR-WF-003, FR-WF-006, AC-060, AC-061.

## Phase 7 — Telemetry, parity gates, and convergence

- [ ] T038 [P] Create `telemetry/wf.catalog.json`: declarative event
      catalog mirroring `packages/shared-schemas/src/wf.ts` exactly
      (trigger received/verified/duplicate-collapsed; run started/
      policy-skipped/completed; step checkpointed/retry/exhausted; lease
      acquired/fenced/refused; outbox committed/claimed/sent/suppressed;
      dead-letter opened/retried/resolved; reconciliation diff/incident;
      schedule version created/enabled/paused/dry-run) with per-event
      requirement refs and the critical-metadata tier. Traces: FR-WF-001,
      FR-WF-002, FR-WF-003, FR-WF-004, FR-WF-005, FR-WF-006, FR-WF-007,
      FR-WF-008.
- [ ] T039 [executor: TEST] [serial-reason: SHARED_FILE] Extend the
      central telemetry parity suite (`tests/telemetry-catalog.spec.ts`,
      exact path — plan-sanctioned scope exception) with the `wf` catalog.
      Traces: FR-WF-001.
- [ ] T040 [serial-reason: COORDINATOR_BOUNDARY] Run cross-artifact
      consistency analysis per the speckit-analyze methodology across
      spec.md, plan.md, and tasks.md (requirement coverage of all eight
      FR-WF IDs and all fourteen ACs; no out-of-scope requirement tracing;
      no orphaned modules; interface-seam alignment with the four sibling
      packages documented without implementing their logic) and repair
      every finding inside this package's scope; record anything outside
      scope in the run's out-of-scope notes instead of planning it.
      Traces: FR-WF-001, FR-WF-002, FR-WF-003, FR-WF-004, FR-WF-005,
      FR-WF-006, FR-WF-007, FR-WF-008.
