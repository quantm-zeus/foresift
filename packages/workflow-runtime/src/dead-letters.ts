/**
 * Dead-letter management (T021, FR-WF-007; PRD §25.9).
 *
 * After retry exhaustion a workflow or step enters `DEAD_LETTERED`. This module
 * owns the three operations admin/recovery need:
 *
 * - `openDeadLetter` consumes the `DeadLetterHandoffInput` from `retries.ts`
 *   and persists an actionable context — the error class, the attempt count,
 *   and a human-actionable reason are MANDATORY, so a dead letter is never an
 *   opaque failure.
 * - `listDeadLetters` is the queryable listing the admin package renders.
 * - `retryFromLastValidCheckpoint` re-executes the steps AFTER the last valid
 *   checkpoint under FRESH idempotency keys. It reads completed history but
 *   never rewrites it (INV-005/INV-006: replay re-executes, never backdates),
 *   verifies the completed rows are byte-identical afterwards, and refuses with
 *   a typed error when no valid checkpoint exists.
 *
 * Strictly read-only: this module manages durable failure records; it can never
 * trade, custody, sign, handle keys, or submit a transaction.
 */
import { randomUUID } from 'node:crypto';
import {
  ErrorCode,
  ForesiftError,
  parseDeadLetterStatus,
  parseRetryErrorClass,
  type DeadLetterStatus,
  type RetryErrorClass,
} from '@foresift/domain';
import { type DatabaseEngine } from '@foresift/persistence';
import { WF_STANDARD_STEP_ORDER, stepOrderIndex } from './steps.ts';

/** Actionable context: the attempt count and reason are mandatory. */
export interface DeadLetterActionableContext {
  readonly attempts: number;
  readonly reason: string;
  readonly [key: string]: unknown;
}

export interface OpenDeadLetterInput {
  readonly runId: string;
  /** The exhausted step, when exhaustion is step-scoped. */
  readonly stepId?: string | null;
  readonly errorClass: RetryErrorClass;
  readonly context: DeadLetterActionableContext;
  readonly lastValidCheckpointRef?: string | null;
  readonly now?: string;
  readonly deadLetterId?: string;
}

export interface DeadLetterRecord {
  readonly deadLetterId: string;
  readonly runId: string;
  readonly stepId: string | null;
  readonly errorClass: RetryErrorClass;
  readonly context: Readonly<Record<string, unknown>>;
  readonly lastValidCheckpointRef: string | null;
  readonly status: DeadLetterStatus;
  readonly openedAt: string;
  readonly resolvedAt: string | null;
}

export interface ListDeadLettersQuery {
  readonly status?: DeadLetterStatus;
}

/** One step to re-execute, with its fresh idempotency key. */
export interface RetryStepPlan {
  readonly stepType: string;
  readonly idempotencyKey: string;
  readonly attempt: number;
}

/** The plan handed to the caller's `resume` callback. */
export interface RetryResumePlan {
  readonly runId: string;
  readonly deadLetterId: string;
  readonly lastValidCheckpointRef: string;
  readonly errorClass: RetryErrorClass;
  readonly steps: readonly RetryStepPlan[];
  /** Always true: recovery never replays the original keys (§25.9). */
  readonly freshIdempotencyKeys: true;
}

export interface RetryResumeOutcome {
  /** When true the run is marked SUCCEEDED after the resumed steps complete. */
  readonly completed?: boolean;
}

export interface RetryFromLastValidCheckpointInput {
  readonly deadLetterId: string;
  readonly runId: string;
  readonly now?: string;
  readonly resume: (
    plan: RetryResumePlan,
  ) => Promise<RetryResumeOutcome | void> | RetryResumeOutcome | void;
}

export interface RetryFromLastValidCheckpointResult {
  readonly deadLetterId: string;
  readonly runId: string;
  readonly status: DeadLetterStatus;
  readonly resumedFrom: string;
  readonly reExecutedStepTypes: readonly string[];
}

interface DeadLetterRow {
  readonly dead_letter_id: string;
  readonly run_id: string;
  readonly step_id: string | null;
  readonly error_class: string;
  readonly context: unknown;
  readonly last_valid_checkpoint_ref: string | null;
  readonly status: string;
  readonly opened_at: string;
  readonly resolved_at: string | null;
}

interface CompletedStepRow {
  readonly step_id: string;
  readonly step_type: string;
  readonly idempotency_key: string;
  readonly output_hash: string | null;
  readonly status: string;
}

const DEAD_LETTER_COLUMNS = `dead_letter_id, run_id, step_id, error_class, context,
  last_valid_checkpoint_ref, status, opened_at, resolved_at`;

function nowIso(input?: string): string {
  const now = input ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(now))) {
    throw new ForesiftError(ErrorCode.WF_DEAD_LETTER_TRANSITION_INVALID, 'now is not a timestamp', {
      now,
    });
  }
  return now;
}

function mapDeadLetterRow(row: DeadLetterRow): DeadLetterRecord {
  return {
    deadLetterId: row.dead_letter_id,
    runId: row.run_id,
    stepId: row.step_id,
    errorClass: parseRetryErrorClass(row.error_class),
    context:
      row.context !== null && typeof row.context === 'object'
        ? (row.context as Readonly<Record<string, unknown>>)
        : {},
    lastValidCheckpointRef: row.last_valid_checkpoint_ref,
    status: parseDeadLetterStatus(row.status),
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at,
  };
}

/** Validate the mandatory actionable context fields; fail closed otherwise. */
function assertActionableContext(context: DeadLetterActionableContext): void {
  if (typeof context !== 'object' || context === null) {
    throw new ForesiftError(
      ErrorCode.WF_DEAD_LETTER_TRANSITION_INVALID,
      'dead-letter context must be an object',
    );
  }
  if (!Number.isInteger(context.attempts) || context.attempts < 0) {
    throw new ForesiftError(
      ErrorCode.WF_DEAD_LETTER_TRANSITION_INVALID,
      'dead-letter context must carry a non-negative integer attempt count',
      {
        attempts: Number.isInteger(context.attempts) ? context.attempts : null,
      },
    );
  }
  if (typeof context.reason !== 'string' || context.reason.trim().length === 0) {
    throw new ForesiftError(
      ErrorCode.WF_DEAD_LETTER_TRANSITION_INVALID,
      'dead-letter context must carry a human-actionable reason',
    );
  }
}

async function loadDeadLetter(
  engine: DatabaseEngine,
  deadLetterId: string,
): Promise<DeadLetterRecord | null> {
  const result = await engine.query<DeadLetterRow>(
    `SELECT ${DEAD_LETTER_COLUMNS} FROM wf.dead_letters WHERE dead_letter_id = $1`,
    [deadLetterId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapDeadLetterRow(row);
}

/**
 * Open an actionable dead letter for an exhausted run/step. The run moves to
 * `DEAD_LETTERED`; the step (when given) moves to `FAILED_EXHAUSTED`.
 */
export async function openDeadLetter(
  engine: DatabaseEngine,
  input: OpenDeadLetterInput,
): Promise<DeadLetterRecord> {
  const now = nowIso(input.now);
  const runId = input.runId;
  if (typeof runId !== 'string' || runId.trim().length === 0) {
    throw new ForesiftError(
      ErrorCode.WF_DEAD_LETTER_TRANSITION_INVALID,
      'dead letter requires a runId',
    );
  }
  const errorClass = parseRetryErrorClass(input.errorClass);
  assertActionableContext(input.context);
  const context = {
    ...input.context,
    errorClass,
    attempts: input.context.attempts,
    reason: input.context.reason,
  };
  const deadLetterId = input.deadLetterId ?? `wfd_${randomUUID()}`;
  const stepId = input.stepId ?? null;
  const lastValidCheckpointRef = input.lastValidCheckpointRef ?? null;

  return engine.transaction(async (tx) => {
    const run = await tx.query<{ status: string }>(`SELECT status FROM wf.runs WHERE run_id = $1`, [
      runId,
    ]);
    const runStatus = run.rows[0]?.status;
    if (runStatus === undefined) {
      throw new ForesiftError(ErrorCode.WF_RUN_NOT_FOUND, 'unknown run for dead letter', {
        runId,
      });
    }
    if (runStatus === 'SUCCEEDED' || runStatus === 'CANCELLED') {
      throw new ForesiftError(
        ErrorCode.WF_DEAD_LETTER_TRANSITION_INVALID,
        `a ${runStatus} run cannot be dead-lettered`,
        { runId, status: runStatus },
      );
    }

    if (stepId !== null) {
      const step = await tx.query<{ status: string }>(
        `SELECT status FROM wf.steps WHERE step_id = $1 AND run_id = $2`,
        [stepId, runId],
      );
      const stepStatus = step.rows[0]?.status;
      if (stepStatus === undefined) {
        throw new ForesiftError(ErrorCode.WF_STEP_NOT_FOUND, 'unknown step for dead letter', {
          runId,
          stepId,
        });
      }
      if (stepStatus !== 'FAILED_EXHAUSTED') {
        await tx.query(
          `UPDATE wf.steps
              SET status = 'FAILED_EXHAUSTED', error_class = $1, retryable = false,
                  completed_at = $2
            WHERE step_id = $3 AND run_id = $4
              AND status IN ('PENDING', 'RUNNING', 'FAILED_RETRYABLE')`,
          [errorClass, now, stepId, runId],
        );
      }
    }

    await tx.query(
      `INSERT INTO wf.dead_letters
         (dead_letter_id, run_id, step_id, error_class, context,
          last_valid_checkpoint_ref, status, opened_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'OPEN', $7)`,
      [
        deadLetterId,
        runId,
        stepId,
        errorClass,
        JSON.stringify(context),
        lastValidCheckpointRef,
        now,
      ],
    );
    await tx.query(`UPDATE wf.runs SET status = 'DEAD_LETTERED' WHERE run_id = $1`, [runId]);

    return {
      deadLetterId,
      runId,
      stepId,
      errorClass,
      context,
      lastValidCheckpointRef,
      status: 'OPEN',
      openedAt: now,
      resolvedAt: null,
    };
  });
}

/** Queryable dead-letter listing (optionally filtered by status). */
export async function listDeadLetters(
  engine: DatabaseEngine,
  query: ListDeadLettersQuery = {},
): Promise<readonly DeadLetterRecord[]> {
  if (query.status !== undefined) {
    parseDeadLetterStatus(query.status);
  }
  const result = await engine.query<DeadLetterRow>(
    `SELECT ${DEAD_LETTER_COLUMNS} FROM wf.dead_letters
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY opened_at, dead_letter_id`,
    [query.status ?? null],
  );
  return result.rows.map(mapDeadLetterRow);
}

/** The highest standard-order completed step, or null when none exists. */
function latestCompletedStep(completed: readonly CompletedStepRow[]): CompletedStepRow | null {
  let best: CompletedStepRow | null = null;
  let bestIndex = -1;
  for (const step of completed) {
    const index = stepOrderIndex(step.step_type);
    if (index > bestIndex) {
      bestIndex = index;
      best = step;
    }
  }
  return best;
}

/**
 * Re-execute every step AFTER the last valid checkpoint under fresh
 * idempotency keys. Completed history is read, never rewritten; the dead letter
 * becomes `RETRIED`. Refuses (`WF_DEAD_LETTER_NO_CHECKPOINT`) when no valid
 * checkpoint exists and (`WF_DEAD_LETTER_TRANSITION_INVALID`) when the letter
 * is no longer OPEN.
 */
export async function retryFromLastValidCheckpoint(
  engine: DatabaseEngine,
  input: RetryFromLastValidCheckpointInput,
): Promise<RetryFromLastValidCheckpointResult> {
  const now = nowIso(input.now);
  if (typeof input.resume !== 'function') {
    throw new ForesiftError(
      ErrorCode.WF_DEAD_LETTER_TRANSITION_INVALID,
      'retry-from-checkpoint requires a resume callback',
    );
  }
  const deadLetter = await loadDeadLetter(engine, input.deadLetterId);
  if (deadLetter === null || deadLetter.runId !== input.runId) {
    throw new ForesiftError(
      ErrorCode.WF_DEAD_LETTER_NOT_FOUND,
      'unknown dead letter for this run',
      { deadLetterId: input.deadLetterId, runId: input.runId },
    );
  }
  if (deadLetter.status !== 'OPEN') {
    throw new ForesiftError(
      ErrorCode.WF_DEAD_LETTER_TRANSITION_INVALID,
      `dead letter is ${deadLetter.status}; only an OPEN dead letter may be retried`,
      { deadLetterId: deadLetter.deadLetterId, status: deadLetter.status },
    );
  }

  const completedResult = await engine.query<CompletedStepRow>(
    `SELECT step_id, step_type, idempotency_key, output_hash, status
       FROM wf.steps WHERE run_id = $1 AND status = 'SUCCEEDED'`,
    [input.runId],
  );
  const completed = completedResult.rows;

  let checkpoint: CompletedStepRow | null;
  if (deadLetter.lastValidCheckpointRef !== null) {
    const ref = deadLetter.lastValidCheckpointRef;
    checkpoint = completed.find((s) => s.step_id === ref || s.idempotency_key === ref) ?? null;
    if (checkpoint === null) {
      throw new ForesiftError(
        ErrorCode.WF_DEAD_LETTER_NO_CHECKPOINT,
        'the recorded last-valid-checkpoint reference is not a SUCCEEDED step',
        { deadLetterId: deadLetter.deadLetterId, lastValidCheckpointRef: ref },
      );
    }
  } else {
    checkpoint = latestCompletedStep(completed);
  }
  if (checkpoint === null) {
    throw new ForesiftError(
      ErrorCode.WF_DEAD_LETTER_NO_CHECKPOINT,
      'no valid checkpoint exists to resume from',
      { deadLetterId: deadLetter.deadLetterId, runId: input.runId },
    );
  }
  const checkpointIndex = stepOrderIndex(checkpoint.step_type);
  if (checkpointIndex < 0) {
    throw new ForesiftError(
      ErrorCode.WF_DEAD_LETTER_NO_CHECKPOINT,
      'the checkpoint is not a standard workflow step',
      { deadLetterId: deadLetter.deadLetterId, stepType: checkpoint.step_type },
    );
  }

  const completedTypes = new Set(completed.map((s) => s.step_type));
  const steps: RetryStepPlan[] = WF_STANDARD_STEP_ORDER.filter(
    (stepType, index) => index > checkpointIndex && !completedTypes.has(stepType),
  ).map((stepType) => ({
    stepType,
    // FRESH keys: recovery never replays the original idempotency keys.
    idempotencyKey: `wfr_${deadLetter.deadLetterId}_${stepType}`,
    attempt: 1,
  }));

  const plan: RetryResumePlan = {
    runId: input.runId,
    deadLetterId: deadLetter.deadLetterId,
    lastValidCheckpointRef: checkpoint.step_id,
    errorClass: deadLetter.errorClass,
    steps,
    freshIdempotencyKeys: true,
  };

  await engine.query(
    `UPDATE wf.runs SET status = 'RUNNING'
      WHERE run_id = $1 AND status = 'DEAD_LETTERED'`,
    [input.runId],
  );

  const outcome = (await input.resume(plan)) ?? {};

  // INV-005/INV-006: completed history must be byte-identical after a resume.
  for (const before of completed) {
    const after = await engine.query<CompletedStepRow>(
      `SELECT step_id, step_type, idempotency_key, output_hash, status
         FROM wf.steps WHERE step_id = $1`,
      [before.step_id],
    );
    const row = after.rows[0];
    if (
      row === undefined ||
      row.idempotency_key !== before.idempotency_key ||
      row.output_hash !== before.output_hash ||
      row.status !== 'SUCCEEDED'
    ) {
      throw new ForesiftError(
        ErrorCode.WF_DEAD_LETTER_TRANSITION_INVALID,
        'retry rewrote completed step history; recovery must re-execute under fresh keys',
        { deadLetterId: deadLetter.deadLetterId, stepId: before.step_id },
      );
    }
  }

  const retried = await engine.query(
    `UPDATE wf.dead_letters SET status = 'RETRIED'
      WHERE dead_letter_id = $1 AND status = 'OPEN' RETURNING dead_letter_id`,
    [deadLetter.deadLetterId],
  );
  if (retried.rows.length === 0) {
    throw new ForesiftError(
      ErrorCode.WF_DEAD_LETTER_TRANSITION_INVALID,
      'dead letter changed while the retry was running',
      { deadLetterId: deadLetter.deadLetterId },
    );
  }
  if (outcome.completed === true) {
    await engine.query(
      `UPDATE wf.runs SET status = 'SUCCEEDED', completed_at = $2
        WHERE run_id = $1 AND status NOT IN ('SUCCEEDED', 'CANCELLED')`,
      [input.runId, now],
    );
  }

  return {
    deadLetterId: deadLetter.deadLetterId,
    runId: input.runId,
    status: 'RETRIED',
    resumedFrom: checkpoint.step_id,
    reExecutedStepTypes: steps.map((s) => s.stepType),
  };
}
