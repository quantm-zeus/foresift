# g2-durable-workflow — scoped specification

> This file is a SUBORDINATE DERIVATIVE of the authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`. It was seeded mechanically from
> the requirement manifest by `scripts/automation/bootstrap-package-spec.mjs` (builder v1). The PRD
> always wins over any wording below.

## Authority binding

- Milestone: `G2` (ACTIVE)
- Objective: Deliver the durable automation substrate: external triggers enter through an idempotent
  trigger inbox resolving to an immutable schedule/version and starting exactly one logical run,
  every step checkpoints with idempotency keys, monotonically fenced leases and a bounded retry
  taxonomy, schedules are versioned CRUD with validation, pause/resume, dry-run and run-now
  semantics plus a reconciliation job that diffs database schedules against the external scheduler
  and raises incidents on drift, decision/alert/outbox entries commit atomically with crash-safe
  exactly-once delivery workers, exhausted steps land in manageable dead-letters with safe retry
  from the last valid checkpoint, and new versions can run in shadow mode without opportunity
  influence. Strictly read-only: no trading, custody, wallet-signing, private-key, or
  transaction-submission capability.
- Risk: HIGH · writeScopes: `apps/api/src/internal/**`, `migrations/g2_wf_*.sql`,
  `packages/domain/**`, `packages/shared-schemas/**`, `packages/workflow-runtime/**`,
  `telemetry/wf.*`, `tests/acceptance/**`, `tests/fixtures/wf/**`, `tests/negative/**`
- Dependencies: none
- Bound inputs at seed time: main `8b898ad7b8aa`, manifest `e0f9f1284473`, PRD `baa521d9c67e`

## Assigned requirements (normative text quoted verbatim)

### FR-WF-001 — 38. Functional requirements catalogue (PRD line 6017)

> Durable resumable workflow.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/wf.ts`
- Fixture refs: `tests/fixtures/wf/`
- Telemetry refs: `telemetry/wf.*`

### FR-WF-002 — 38. Functional requirements catalogue (PRD line 6018)

> Trigger inbox and at-least-once idempotency.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/wf.ts`
- Fixture refs: `tests/fixtures/wf/`
- Telemetry refs: `telemetry/wf.*`

### FR-WF-003 — 38. Functional requirements catalogue (PRD line 6019)

> Step checkpoint, lease, fencing, and retries.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/wf.ts`
- Fixture refs: `tests/fixtures/wf/`
- Telemetry refs: `telemetry/wf.*`

### FR-WF-004 — 38. Functional requirements catalogue (PRD line 6020)

> Schedule CRUD, validation, pause/resume, dry-run, run-now.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/wf.ts`
- Fixture refs: `tests/fixtures/wf/`
- Telemetry refs: `telemetry/wf.*`

### FR-WF-005 — 38. Functional requirements catalogue (PRD line 6021)

> Schedule reconciliation.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/wf.ts`
- Fixture refs: `tests/fixtures/wf/`
- Telemetry refs: `telemetry/wf.*`

### FR-WF-006 — 38. Functional requirements catalogue (PRD line 6022)

> Transactional notification outbox.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/wf.ts`
- Fixture refs: `tests/fixtures/wf/`
- Telemetry refs: `telemetry/wf.*`

### FR-WF-007 — 38. Functional requirements catalogue (PRD line 6023)

> Dead-letter management.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/wf.ts`
- Fixture refs: `tests/fixtures/wf/`
- Telemetry refs: `telemetry/wf.*`

### FR-WF-008 — 38. Functional requirements catalogue (PRD line 6024)

> Shadow mode.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/wf.ts`
- Fixture refs: `tests/fixtures/wf/`
- Telemetry refs: `telemetry/wf.*`

## Shared acceptance criteria

Attached to more than one requirement of this package — implement once, satisfy everywhere:

- **AC-010** · positive: `tests/acceptance/AC-010.spec.ts` · negative/failure:
  `tests/negative/AC-010.negative.spec.ts` — attached to 8 requirements
- **AC-011** · positive: `tests/acceptance/AC-011.spec.ts` · negative/failure:
  `tests/negative/AC-011.negative.spec.ts` — attached to 8 requirements
- **AC-012** · positive: `tests/acceptance/AC-012.spec.ts` · negative/failure:
  `tests/negative/AC-012.negative.spec.ts` — attached to 8 requirements
- **AC-013** · positive: `tests/acceptance/AC-013.spec.ts` · negative/failure:
  `tests/negative/AC-013.negative.spec.ts` — attached to 8 requirements
- **AC-014** · positive: `tests/acceptance/AC-014.spec.ts` · negative/failure:
  `tests/negative/AC-014.negative.spec.ts` — attached to 8 requirements
- **AC-060** · positive: `tests/acceptance/AC-060.spec.ts` · negative/failure:
  `tests/negative/AC-060.negative.spec.ts` — attached to 8 requirements
- **AC-061** · positive: `tests/acceptance/AC-061.spec.ts` · negative/failure:
  `tests/negative/AC-061.negative.spec.ts` — attached to 8 requirements
- **AC-062** · positive: `tests/acceptance/AC-062.spec.ts` · negative/failure:
  `tests/negative/AC-062.negative.spec.ts` — attached to 8 requirements
- **AC-063** · positive: `tests/acceptance/AC-063.spec.ts` · negative/failure:
  `tests/negative/AC-063.negative.spec.ts` — attached to 8 requirements
- **AC-260** · positive: `tests/acceptance/AC-260.spec.ts` · negative/failure:
  `tests/negative/AC-260.negative.spec.ts` — attached to 8 requirements
- **AC-261** · positive: `tests/acceptance/AC-261.spec.ts` · negative/failure:
  `tests/negative/AC-261.negative.spec.ts` — attached to 8 requirements
- **AC-262** · positive: `tests/acceptance/AC-262.spec.ts` · negative/failure:
  `tests/negative/AC-262.negative.spec.ts` — attached to 8 requirements
- **AC-263** · positive: `tests/acceptance/AC-263.spec.ts` · negative/failure:
  `tests/negative/AC-263.negative.spec.ts` — attached to 8 requirements
- **AC-264** · positive: `tests/acceptance/AC-264.spec.ts` · negative/failure:
  `tests/negative/AC-264.negative.spec.ts` — attached to 8 requirements

## Non-goals

Everything below is OUT OF SCOPE for this package:

- `g2-alert-lifecycle`: Deliver the alert lifecycle on top of the durable substrate: notifications
  distinguish EARLY_WATCH, CONFIRMED_OPPORTUNITY, thesis strengthening/weakening, expiry and risk
  with separate policies, content, TTL and per-class metrics/denominators, EARLY_WATCH carries short
  TTL with explicit missing data and no high-conviction language, CONFIRMED_OPPORTUNITY requires the
  full deterministic gate set including tradability, security, cost, freshness and expiry, material
  deterioration/cancellation/expiry of actionable prior alerts produces idempotent update
  notifications under fingerprint/cooldown rules, and every opportunity notification embeds
  validity, actionability, execution assumptions and evidence links. Strictly read-only: no trading,
  custody, wallet-signing, private-key, or transaction-submission capability.
- `g2-admin-control`: Deliver the admin control plane over the proven workflow and alert state: an
  overview showing system mode, global kill-switch state, provider incidents, quota forecasts,
  schedule drift, workflow/run/dead-letter counts, candidate lifecycle/risk counts, alert
  precision/recall with sample size, missed gems, cost and storage/backup status without triggering
  provider calls, a schedule/configuration control plane with immutable-version lifecycle,
  resolved-config preview and validate/forecast/dry-run/enable/pause/resume/run-now/disable actions,
  and prominent global kill switches including full-automation, model-call, provider-call,
  notification, MCP-client and emergency-read-only controls. Strictly read-only: no trading,
  custody, wallet-signing, private-key, or transaction-submission capability.
- `g2-production-readiness`: Deliver production-readiness governance: IMPLEMENTED, AVAILABLE,
  SHADOW, PROVEN, ACTIVE, DEGRADED, PAUSED, RETIRED and DISABLED as independent governed module
  states with an explicit activation gate so the full codebase can deploy while insufficient modules
  stay disabled, partial or shadow-only, dependency groups as build/test ordering without throwaway
  MVP architecture, declared best-effort free-tier operation unless every critical external
  dependency carries an applicable SLA, an MCP protocol-revision/target-client compatibility matrix
  with conformance tests, and bounded precomputed alpha matching on live paths with heavy Alpha Lab
  jobs and artifact imports confined to the isolated export/import trust boundary. Strictly
  read-only: no trading, custody, wallet-signing, private-key, or transaction-submission capability.
- `g2-recovery-continuity`: Deliver recovery and continuity proof against the G0-PROVEN tiered RPO
  targets and point-in-time-recovery mechanisms: destructive restore drills that rebuild a clean
  environment verifying hashes, chains, migrations, cross-store references, collector checkpoints
  without hidden gaps and measured RPO/RTO, post-recovery reconciliation of provider calls, quota
  reservations, workflows, inbox/outbox, alerts, collector gaps, artifacts and audit checkpoints
  before automation resumes, automatic capability degradation with confirmed-opportunity alerts
  disabled when a tier misses its declared objective while safe deterministic risk monitoring
  continues, and versioned audited governance of backup retention, deletion, legal hold, geography,
  encryption, rights constraints and restore access. Strictly read-only: no trading, custody,
  wallet-signing, private-key, or transaction-submission capability.

<!-- Seeded normative content ends here. Planner-owned sections (integration notes,
     invariants, open points resolved from authoritative sources) go below this line. -->

## Planner-owned integration notes (subordinate; PRD wins on any conflict)

### S1. Normative elaboration per requirement (PRD §25–§26 shows the working)

The one-line catalogue entries above are elaborated by the following
authoritative sections, read at their capsule anchors during planning:

- FR-WF-001 (durable resumable workflow): PRD §25.4 (standard discovery
  workflow step order), §25.5 (per-step durability fields), §9.2 (Durable
  Workflow Plane owns trigger inbox, run creation, step checkpointing,
  retries, leases, waits, rechecks, cancellation, dead letters, batch
  monitoring, notification outbox), INV-009 (a durable workflow may retry;
  every state transition and external side effect remains idempotent and
  fenced).
- FR-WF-002 (trigger inbox, at-least-once idempotency): PRD §25.2
  (`trigger_inbox` record shape: source, external_message_id, schedule_id,
  scheduled_for, payload_hash, received_at, verified_at, processed_run_id,
  status; unique constraints prevent duplicate run creation) and §25.3
  (trigger endpoint steps: verify QStash signature → validate timestamp and
  replay window → canonicalize external message ID → insert inbox
  idempotently → resolve active schedule/version → start workflow iff not
  already started → return 202 promptly). Architecture table (§10):
  QStash creates recurring triggers only and delivers at-least-once with
  signed delivery; the application owns trigger idempotency and workflow
  state.
- FR-WF-003 (step checkpoint, lease, fencing, retries): PRD §25.5 (step
  fields incl. idempotency_key, lease_owner, lease_version,
  lease_expires_at, error_class, retryable), §25.6 (concurrency policies
  SKIP_IF_RUNNING, QUEUE_AFTER_RUNNING, CANCEL_PREVIOUS, ALLOW_PARALLEL;
  default broad scan SKIP_IF_RUNNING; candidate recheck serialized by
  candidate/profile), §25.7 (leases use monotonically increasing fencing
  tokens; a stale worker MUST NOT commit after a newer worker acquires the
  lease), §25.8 (retry taxonomy: auth/invalid-key no retry + disable;
  invalid input no retry; rate limit retry-after-reset within budget;
  timeout/5xx bounded exponential retry with jitter; schema drift no
  automated repeated retry + mark degraded; model format error one repair;
  budget exceeded no retry; DB serialization conflict retry transaction;
  notification transient retry from outbox).
- FR-WF-004 (schedule CRUD, validation, pause/resume, dry-run, run-now):
  PRD §25.11 (admin actions CREATE, EDIT_DRAFT, VALIDATE, ENABLE, PAUSE,
  RESUME, RUN_NOW, DRY_RUN, DUPLICATE, DISABLE, DELETE; configuration
  changes create a new immutable version; active runs retain their resolved
  version), §25.10 (CRUD updates both database and QStash), §33.6 (before
  enable, admin shows projected runs/day, provider calls/day, model
  tokens/day, estimated model spend/day, quota exhaustion date, storage
  growth/month).
- FR-WF-005 (schedule reconciliation): PRD §25.10 (reconciliation job
  compares active database schedules, external QStash schedules,
  cron/timezone, paused state, destination and external ID; mismatches
  produce incidents and optional repair).
- FR-WF-006 (transactional notification outbox): PRD §26.5 (decision,
  alert record, and notification outbox entry MUST commit in one database
  transaction; delivery workers send from the outbox and update state —
  no duplicate or lost notifications across crashes). Classification,
  gating, rendering, and per-class metrics on top of this boundary belong
  to g2-alert-lifecycle; this package owns the atomic commit boundary and
  the crash-safe delivery workers.
- FR-WF-007 (dead-letter management): PRD §25.9 (after retry exhaustion
  the workflow or step enters DEAD_LETTERED; admin shows actionable error
  context and provides safe retry from last valid checkpoint).
- FR-WF-008 (shadow mode): product-wide law (PRD line 12 and §9.6) that a
  module may remain disabled or shadow-only until gates pass, progressing
  IMPLEMENTED → AVAILABLE → SHADOW → PROVEN → ACTIVE only on evidence.
  This package provides the per-run/per-version shadow execution
  mechanism: shadow runs execute the full pipeline but MUST NOT exert
  opportunity influence (no confirm-opportunity notification delivery, no
  policy promotion input). The governance lifecycle itself (states,
  activation gate, promotion evidence) belongs to
  g2-production-readiness; this package consumes its verdicts as flags.

### S2. Applicable invariants (manifest securityRightsCostControls)

INV-001 (permanent read-only: no trading, custody, signing, private-key,
transaction submission) binds every module, test, and fixture in this
package. INV-002 (agent intelligence never replaces deterministic
identity, evidence, time, execution, risk, capability, rights, cost,
quota, capacity, or policy controls) is why version resolution, fencing
comparison, retry classification, and the atomic commit boundary are pure
deterministic functions, never model judgments. INV-004 (every retained
decision reconstructable from frozen evidence, configuration, code, and
artifact versions) is why runs pin the immutable resolved
configuration/workflow version. INV-009 governs all retry and side-effect
paths. INV-005/INV-006 (point-in-time honesty; no backdating) bind the
retry-from-checkpoint path: replay re-executes steps, never rewrites
history. Section 9.5 (dependency direction) binds stage ordering: the
workflow consumes proven capability/capacity/policy inputs and MUST NOT
write back into active policies (evaluation and learning services never
write directly to active policies). Sections 33/34/35/37 bind the
performance envelope (§33.1: schedule trigger acknowledgement < 2 s;
alert delivery after decision commit p95 < 30 s), deadline propagation
(§33.2: a child call MUST NOT exceed the parent deadline), bounded
concurrency (§33.3: no unbounded fan-out; candidate monitoring is batch
oriented — one scheduler message per cheap-monitor candidate is
prohibited), fail-closed degradation (§34.3), and the tiered RPO/RTO
ceilings (§34.4, consumed as inputs, not re-proven here).

### S3. Explicit non-goal boundaries (beyond the milestone non-goals above)

- Alert classification, deterministic gating, fingerprint/cooldown,
  per-class TTL/metrics, and rendering on top of the outbox: owned by
  g2-alert-lifecycle, which consumes this package's atomic commit
  boundary and delivery workers.
- Dashboard/overview rendering, resolved-config preview UI, and kill
  switches: owned by g2-admin-control, which renders and invokes this
  package's schedule/version/run/dead-letter state and control actions
  without reimplementing schedule domain logic.
- Module lifecycle states, activation gates, MCP compatibility matrix,
  and implementation-mapping reconciliation
  (docs/generated/wf-surfaces.json): owned by g2-production-readiness.
- Restore drills, post-recovery reconciliation, capability degradation,
  and backup governance: owned by g2-recovery-continuity, which consumes
  this package's persisted inbox/outbox/lease state through the
  read-only verification seam defined in plan.md.
- Cost-forecast computation and sustainable-capacity contracts: proven
  G1 substrate consumed as inputs; this package enforces the
  forecast-before-enable gate (AC-063) without recomputing forecasts.
- Single-flight semantics for provider calls (G0-PROVEN
  core_single_flight_leases) are consumed as the fencing pattern
  precedent, not re-proven; workflow/step leases are a separate table
  family in the `wf` schema.

### S4. Interface contracts this package guarantees to sibling packages

- SchedulerPort (QStash vs local/test adapters) with signed-delivery
  verification and replay-window validation; the reconciliation job
  diffs database schedules against SchedulerPort state and raises
  incidents on drift (FR-WF-005).
- Atomic `commitDecisionWithOutbox` boundary (FR-WF-006) and
  exactly-once delivery-worker claim protocol (AC-011).
- Read-only workflow/inbox/outbox/lease state verification queries for
  the recovery drill path (AC-261 seam): tables live in the dedicated
  `wf` schema so the landed AC-261 `public`-schema absence probe stays
  green until g2-recovery-continuity extends it to the real names.
- Schedule/version/run/dead-letter state plus the §25.11 control-action
  surface for the admin package; per-version shadow flags for the
  governance package; outbox + classification hooks for the alert
  package. None of those packages' domain logic is implemented here.

### S5. Risks

HIGH risk (per milestone): first durable-execution substrate in the
codebase; exactly-once and fencing claims are easy to assert and hard to
prove — hence crash-resumption and stale-worker tests per AC, the
monotonic-token law mirrored from the proven G0 lease precedent, and
delivery workers that only send from claimed outbox rows. QStash is an
untrusted external scheduler (signature/replay validation fail-closed).
Schema risk is contained by the additive-only `wf` schema and the
central migration-registry duty (ADR-0019/ADR-0022).
