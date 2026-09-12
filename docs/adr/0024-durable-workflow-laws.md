# ADR-0024: Durable-workflow storage and execution laws (G2)

Status: accepted (2026-09-12).

## Context

`g2-durable-workflow` (FR-WF-001…008, PRD §25/§26.5) introduces the durable
automation substrate: a trigger inbox, immutable schedule versions, checkpointed
steps, fenced leases, a retry taxonomy, a transactional notification outbox,
dead letters, schedule reconciliation, and shadow runs. Several of those laws are
storage- or delivery-level guarantees that later packages (alerts, admin,
production readiness, recovery) build on, so they are recorded here rather than
left implicit in code comments. The milestone plan proposed two ADR texts
(ADR-G2WF-1, ADR-G2WF-2); this ADR accepts them and adds the laws discovered
during implementation and adversarial review.

## Decision

1. **`wf`-schema table home (accepts ADR-G2WF-1).** All workflow state —
   `wf.schedules`, `wf.schedule_versions`, `wf.trigger_inbox`, `wf.runs`,
   `wf.steps`, `wf.step_leases`, `wf.notification_outbox`, `wf.dead_letters`,
   `wf.reconciliation_reports`, `wf.schedule_forecasts`, `wf.decision_commits`,
   `wf.alert_records` — lives in a dedicated `wf` PostgreSQL schema, never
   `public`. The recovery probe that asserts the absence of unqualified
   workflow tables keeps its meaning; recovery packages verify qualified `wf`
   names.
2. **`SchedulerPort` is the only scheduler seam (accepts ADR-G2WF-2).** Every
   schedule↔scheduler interaction passes through `SchedulerPort`; QStash
   specifics (signatures, replay windows, external ids) live in the adapter.
   Deliveries are untrusted until signature, timestamp/replay-window, and
   payload validation pass, and validation happens **before any state write**.
3. **Immutable versions, pinned runs.** Every configuration mutation inserts a
   new `wf.schedule_versions` row; the previous row's `superseded_by` may be set
   exactly once (NULL→non-null) and the row is otherwise byte-immutable
   (a trigger refuses UPDATE/DELETE/TRUNCATE). A run pins
   `resolved_schedule_version`, and a composite foreign key
   `(schedule_id, resolved_schedule_version) → schedule_versions(schedule_id,
version_id)` makes a cross-schedule pin impossible. Deploying new
   configuration never rewrites a running run's version (AC-013).
4. **Exactly-one logical run.** `wf.trigger_inbox` is unique on
   `(source, canonical_external_message_id)`, `wf.runs.inbox_id` is unique, and a
   run may only consume an inbox row addressed to **its own** schedule
   (composite `(schedule_id, inbox_id)` foreign key). Duplicate deliveries
   collapse; a delivery that reuses another schedule's external message id is
   refused typed and writes nothing. The §25.6 concurrency policy is evaluated
   after dedupe so a policy skip and a duplicate collapse stay distinguishable.
   In-process admissions are serialized per schedule so SKIP_IF_RUNNING is
   deterministic even on a single-connection engine.
5. **Monotonic fencing.** `wf.step_leases` allocates tokens from a dedicated
   sequence; a takeover always allocates a strictly larger token, and a
   storage-level trigger refuses any UPDATE that changes the resource key or
   **decreases** the token. An unchanged token stays legal so a holder can
   release or extend expiry; a stale holder fails closed at commit time through
   the `fencing_token = $n` predicate. A checkpoint commit is fenced whenever a
   live lease exists for the step's `(runId, stepType)` key — omitting the fence
   then fails closed (AC-012).
6. **Bounded retry taxonomy.** The §25.8 taxonomy is a total pure law
   (`retryPolicyFor`) plus an executable planner. Rate-limited retries require a
   declared budget or are bounded by a documented default attempt cap; nothing
   retries without a bound.
7. **Atomic commit boundary and exactly-once delivery.** Decision, alert record,
   and notification outbox entry commit in ONE transaction (§26.5); any failure
   rolls all three back. A provider outage suppresses the notification
   (`SUPPRESSED_OUTAGE`) while preserving the decision and alert records. A
   shadow run always produces `SUPPRESSED_SHADOW` — the notification itself is
   opportunity-influencing — and the delivery worker independently re-checks the
   run's shadow flag, so there are two gates and no shadow→channel path. Exactly
   once is achieved by at-least-once claim/re-claim plus a channel contract that
   is **idempotent by key** (the outbox id); the send-versus-mark-SENT window is
   covered by that idempotency, not by pretending the window does not exist.
8. **Forecast before enable.** `ENABLE` and `RESUME` require a fresh §33.6
   forecast bound to the schedule's CURRENT version; the payload carries
   `computedAt` so staleness is decidable, and absent/stale/superseded-version
   forecasts are refused typed (AC-063). Forecast rows are frozen artifacts:
   corrections are new rows.
9. **Shadow isolation.** A shadow run executes fully and its records remain
   readable for evaluation, but it can never send a confirmed-opportunity
   notification or write policy back.

## Consequences

- Later G2 packages consume these laws instead of restating them; alert
  classification, admin controls, and recovery drills operate on the qualified
  `wf` names.
- PGlite is a single-connection test engine: it does not isolate concurrent
  transactions, so DB-level concurrency guarantees are proven by constraint
  design and by the in-process admission chain; a multi-connection PostgreSQL
  concurrency test remains an integration-tier obligation.
- The `wf` schema and its triggers are additive migration families
  (`g2_wf_*`); an applied migration is never edited — new laws land as new
  ordered scripts (0005 onward).
