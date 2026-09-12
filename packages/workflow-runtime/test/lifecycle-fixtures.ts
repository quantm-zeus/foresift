/**
 * Shared seed fixtures for the lifecycle suites (T026). These helpers build a
 * minimal but FK-complete `wf` graph (schedule -> version -> inbox -> run) on
 * the PGlite engine from `test/helpers.ts`.
 */
import { type DatabaseEngine } from '@foresift/persistence';

/** A literal-free `sha256:<64hex>` content address. */
export const LIFECYCLE_HASH_A = `sha256:${'a'.repeat(64)}`;
export const LIFECYCLE_HASH_B = `sha256:${'b'.repeat(64)}`;

let sequence = 0;

export interface SeededScheduleConfig {
  readonly name: string;
  readonly cron: string;
  readonly timezone: string;
  readonly destination: string;
  readonly concurrencyPolicy: 'SKIP_IF_RUNNING' | 'QUEUE_AFTER_RUNNING';
  readonly workloadKind: 'BROAD_SCAN' | 'CANDIDATE_RECHECK';
  readonly shadow: boolean;
}

export interface SeedScheduleInput {
  readonly scheduleId?: string;
  readonly status?: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'DISABLED';
  readonly cron?: string;
  readonly timezone?: string;
  readonly destination?: string;
  readonly shadow?: boolean;
}

export interface SeededSchedule {
  readonly scheduleId: string;
  readonly versionId: string;
  readonly config: SeededScheduleConfig;
}

/** Insert a schedule and its current immutable version; returns their ids. */
export async function seedSchedule(
  engine: DatabaseEngine,
  input: SeedScheduleInput = {},
): Promise<SeededSchedule> {
  sequence += 1;
  const tag = sequence;
  const scheduleId = input.scheduleId ?? `sched-fixture-${tag}`;
  const versionId = `version-fixture-${tag}`;
  const config: SeededScheduleConfig = {
    name: `fixture schedule ${tag}`,
    cron: input.cron ?? '*/5 * * * *',
    timezone: input.timezone ?? 'UTC',
    destination: input.destination ?? `local://internal/schedules/${scheduleId}`,
    concurrencyPolicy: 'SKIP_IF_RUNNING',
    workloadKind: 'BROAD_SCAN',
    shadow: input.shadow ?? false,
  };
  await engine.query(
    `INSERT INTO wf.schedules (schedule_id, name, concurrency_policy, status)
     VALUES ($1, $2, $3, $4)`,
    [scheduleId, config.name, config.concurrencyPolicy, input.status ?? 'ACTIVE'],
  );
  await engine.query(
    `INSERT INTO wf.schedule_versions
       (version_id, schedule_id, config_hash, resolved_config, shadow)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [versionId, scheduleId, LIFECYCLE_HASH_A, JSON.stringify(config), config.shadow],
  );
  await engine.query(`UPDATE wf.schedules SET current_version_id = $1 WHERE schedule_id = $2`, [
    versionId,
    scheduleId,
  ]);
  return { scheduleId, versionId, config };
}

/** Insert a VERIFIED trigger-inbox row for a schedule. */
export async function seedInbox(
  engine: DatabaseEngine,
  scheduleId: string,
  options: { readonly receivedAt?: string } = {},
): Promise<string> {
  sequence += 1;
  const inboxId = `inbox-fixture-${sequence}`;
  await engine.query(
    `INSERT INTO wf.trigger_inbox
       (inbox_id, source, external_message_id, canonical_external_message_id,
        schedule_id, scheduled_for, payload_hash, received_at, status)
     VALUES ($1, 'qstash', $2, $3, $4, $5, $6, $5, 'VERIFIED')`,
    [
      inboxId,
      `msg-fixture-${sequence}`,
      `qstash:fixture-${sequence}`,
      scheduleId,
      options.receivedAt ?? new Date().toISOString(),
      LIFECYCLE_HASH_A,
    ],
  );
  return inboxId;
}

export interface SeededRun {
  readonly runId: string;
  readonly scheduleId: string;
  readonly versionId: string;
  readonly inboxId: string;
}

/** Insert a FK-complete run (schedule + version + inbox + run). */
export async function seedRun(
  engine: DatabaseEngine,
  options: {
    readonly shadow?: boolean;
    readonly status?: string;
    readonly scheduleId?: string;
    readonly versionId?: string;
    readonly cron?: string;
    readonly timezone?: string;
    readonly destination?: string;
    /** Inbox `received_at`; defaults to the wall clock. */
    readonly receivedAt?: string;
  } = {},
): Promise<SeededRun> {
  const schedule = await seedSchedule(engine, {
    ...(options.scheduleId === undefined ? {} : { scheduleId: options.scheduleId }),
    ...(options.shadow === undefined ? {} : { shadow: options.shadow }),
    ...(options.cron === undefined ? {} : { cron: options.cron }),
    ...(options.timezone === undefined ? {} : { timezone: options.timezone }),
    ...(options.destination === undefined ? {} : { destination: options.destination }),
  });
  const inboxId = await seedInbox(engine, schedule.scheduleId, {
    ...(options.receivedAt === undefined ? {} : { receivedAt: options.receivedAt }),
  });
  sequence += 1;
  const runId = `run-fixture-${sequence}`;
  await engine.query(
    `INSERT INTO wf.runs
       (run_id, schedule_id, resolved_schedule_version, inbox_id,
        trigger_source, trigger_external_message_id,
        trigger_canonical_external_message_id, concurrency_policy,
        concurrency_outcome, shadow, status, deadline)
     VALUES ($1, $2, $3, $4, 'qstash', $5, $6,
             $7, $7, $8, $9, $10)`,
    [
      runId,
      schedule.scheduleId,
      schedule.versionId,
      inboxId,
      `msg-${runId}`,
      `qstash:${runId}`,
      schedule.config.concurrencyPolicy,
      schedule.config.shadow,
      options.status ?? 'RUNNING',
      new Date(Date.now() + 3_600_000).toISOString(),
    ],
  );
  return {
    runId,
    scheduleId: schedule.scheduleId,
    versionId: schedule.versionId,
    inboxId,
  };
}

export interface SeedStepInput {
  readonly runId: string;
  readonly stepType: string;
  readonly status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_EXHAUSTED';
  readonly outputHash?: string | null;
  readonly errorClass?: string | null;
  readonly attempt?: number;
  readonly stepId?: string;
}

/** Insert a step row for a run; returns its step id. */
export async function seedStep(engine: DatabaseEngine, input: SeedStepInput): Promise<string> {
  sequence += 1;
  const stepId = input.stepId ?? `wfs-fixture-${sequence}`;
  await engine.query(
    `INSERT INTO wf.steps
       (step_id, run_id, step_type, idempotency_key, attempt, input_hash, output_hash,
        status, error_class, retryable)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      stepId,
      input.runId,
      input.stepType,
      `orig-${input.stepType}-${input.runId}`,
      input.attempt ?? (input.status === 'SUCCEEDED' ? 1 : 2),
      LIFECYCLE_HASH_B,
      input.outputHash === undefined
        ? input.status === 'SUCCEEDED'
          ? LIFECYCLE_HASH_A
          : null
        : input.outputHash,
      input.status,
      input.errorClass ?? null,
      input.status === 'SUCCEEDED' ? true : null,
    ],
  );
  return stepId;
}

/**
 * Insert an outbox row directly (used by the verify-state and delivery suites
 * where the atomic commit path is not under test). Because
 * `g2_wf_0005_outbox_hardening.sql` constrains `decision_ref` with a foreign
 * key, a real `wf.decision_commits` row (and its owning run) is seeded first
 * unless the caller supplies `runId` for an existing one.
 */
export async function seedOutboxRow(
  engine: DatabaseEngine,
  input: {
    readonly outboxId: string;
    readonly decisionRef?: string;
    /** Owning run for the auto-seeded decision commit (defaults to a new run). */
    readonly runId?: string;
    readonly alertRef?: string | null;
    readonly channel?: string;
    readonly status:
      'PENDING' | 'CLAIMED' | 'SENT' | 'FAILED' | 'SUPPRESSED_SHADOW' | 'SUPPRESSED_OUTAGE';
    readonly enqueuedAt?: string;
    readonly claimOwner?: string | null;
    readonly claimFencingToken?: number | null;
    readonly claimExpiresAt?: string | null;
    readonly attempts?: number;
  },
): Promise<void> {
  const decisionRef = input.decisionRef ?? `decision-${input.outboxId}`;
  const existing = await engine.query<{ decision_id: string }>(
    `SELECT decision_id FROM wf.decision_commits WHERE decision_id = $1`,
    [decisionRef],
  );
  if (existing.rows.length === 0) {
    const runId = input.runId ?? (await seedRun(engine)).runId;
    await engine.query(
      `INSERT INTO wf.decision_commits
         (decision_id, run_id, decision_kind, payload, payload_hash, committed_at)
       VALUES ($1, $2, 'CANDIDATE_DECISION', '{}'::jsonb, $3, now())`,
      [decisionRef, runId, LIFECYCLE_HASH_A],
    );
  }
  await engine.query(
    `INSERT INTO wf.notification_outbox
       (outbox_id, decision_ref, alert_ref, channel, payload_hash, status,
        claim_owner, claim_fencing_token, claim_expires_at, attempts, enqueued_at, claimed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      input.outboxId,
      decisionRef,
      input.alertRef ?? null,
      input.channel ?? 'admin-inbox',
      LIFECYCLE_HASH_A,
      input.status,
      input.claimOwner ?? null,
      input.claimFencingToken ?? null,
      input.claimExpiresAt ?? null,
      input.attempts ?? 0,
      input.enqueuedAt ?? new Date().toISOString(),
      input.status === 'CLAIMED' ? (input.enqueuedAt ?? new Date().toISOString()) : null,
    ],
  );
}
