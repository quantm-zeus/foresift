/**
 * Dead-letter suite (T026, FR-WF-007; PRD §25.9). Runs on PGlite.
 *
 * Proven here:
 * - retry exhaustion opens an ACTIONABLE dead letter (error class, attempt
 *   count, and human readable reason are mandatory);
 * - retry resumes after the last valid checkpoint under FRESH idempotency keys
 *   and never rewrites completed step history;
 * - a run with no valid checkpoint refuses with a typed error.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ErrorCode } from '@foresift/domain';
import {
  listDeadLetters,
  openDeadLetter,
  retryFromLastValidCheckpoint,
  type RetryResumePlan,
} from '../src/index.ts';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  type TestDatabase,
} from './helpers.ts';
import { LIFECYCLE_HASH_A, LIFECYCLE_HASH_B, seedRun, seedStep } from './lifecycle-fixtures.ts';

const T0 = '2026-06-01T12:00:00.000Z';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('§25.9 dead-letter management (FR-WF-007)', () => {
  it('opens an actionable dead letter and moves the run/step to exhausted', async () => {
    const run = await seedRun(tdb.engine);
    const stepId = await seedStep(tdb.engine, {
      runId: run.runId,
      stepType: 'discover_candidates',
      status: 'RUNNING',
    });

    const deadLetter = await openDeadLetter(tdb.engine, {
      runId: run.runId,
      stepId,
      errorClass: 'TIMEOUT_OR_5XX',
      context: {
        attempts: 5,
        reason: 'provider timeouts exhausted the bounded exponential retry budget',
        providerCallRef: 'op-123',
      },
      lastValidCheckpointRef: null,
      now: T0,
    });

    expect(deadLetter.status).toBe('OPEN');
    expect(deadLetter.errorClass).toBe('TIMEOUT_OR_5XX');
    expect(deadLetter.context.errorClass).toBe('TIMEOUT_OR_5XX');
    expect(deadLetter.context.attempts).toBe(5);
    expect(String(deadLetter.context.reason)).toContain('retry budget');

    const runRow = await tdb.engine.query<{ status: string }>(
      `SELECT status FROM wf.runs WHERE run_id = $1`,
      [run.runId],
    );
    expect(runRow.rows[0]?.status).toBe('DEAD_LETTERED');
    const stepRow = await tdb.engine.query<{ status: string; retryable: boolean }>(
      `SELECT status, retryable FROM wf.steps WHERE step_id = $1`,
      [stepId],
    );
    expect(stepRow.rows[0]?.status).toBe('FAILED_EXHAUSTED');
    expect(stepRow.rows[0]?.retryable).toBe(false);

    const open = await listDeadLetters(tdb.engine, { status: 'OPEN' });
    expect(open.map((d) => d.deadLetterId)).toContain(deadLetter.deadLetterId);
    const all = await listDeadLetters(tdb.engine);
    expect(all.length).toBeGreaterThanOrEqual(open.length);
  });

  it('refuses a dead letter without a mandatory actionable reason', async () => {
    const run = await seedRun(tdb.engine);
    await expectForesiftError(
      openDeadLetter(tdb.engine, {
        runId: run.runId,
        errorClass: 'INVALID_INPUT',
        context: { attempts: 1, reason: '' },
        now: T0,
      }),
      ErrorCode.WF_DEAD_LETTER_TRANSITION_INVALID,
    );
  });

  it('retries after the last valid checkpoint under fresh keys without rewriting history', async () => {
    const run = await seedRun(tdb.engine);
    const checkpointStepId = await seedStep(tdb.engine, {
      runId: run.runId,
      stepType: 'load_immutable_resolved_configuration',
      status: 'SUCCEEDED',
      outputHash: LIFECYCLE_HASH_A,
    });
    const exhaustedStepId = await seedStep(tdb.engine, {
      runId: run.runId,
      stepType: 'discover_candidates',
      status: 'RUNNING',
    });

    const deadLetter = await openDeadLetter(tdb.engine, {
      runId: run.runId,
      stepId: exhaustedStepId,
      errorClass: 'TIMEOUT_OR_5XX',
      context: { attempts: 5, reason: 'retry budget exhausted' },
      lastValidCheckpointRef: checkpointStepId,
      now: T0,
    });

    let captured: RetryResumePlan | null = null;
    const result = await retryFromLastValidCheckpoint(tdb.engine, {
      deadLetterId: deadLetter.deadLetterId,
      runId: run.runId,
      now: T0,
      resume: async (plan) => {
        captured = plan;
        for (const step of plan.steps) {
          await tdb.engine.query(
            `INSERT INTO wf.steps
               (step_id, run_id, step_type, idempotency_key, attempt,
                input_hash, output_hash, status, retryable)
             VALUES ($1, $2, $3, $4, 1, $5, $6, 'SUCCEEDED', true)`,
            [
              `wfs-retry-${plan.deadLetterId}-${step.stepType}`,
              plan.runId,
              step.stepType,
              step.idempotencyKey,
              LIFECYCLE_HASH_B,
              LIFECYCLE_HASH_A,
            ],
          );
        }
        return { completed: true };
      },
    });

    expect(captured).not.toBeNull();
    const plan = captured as unknown as RetryResumePlan;
    expect(plan.freshIdempotencyKeys).toBe(true);
    expect(plan.lastValidCheckpointRef).toBe(checkpointStepId);
    // Resume starts AFTER the checkpoint, not at it.
    expect(plan.steps[0]?.stepType).toBe('discover_candidates');
    expect(plan.steps.length).toBeGreaterThan(0);
    for (const step of plan.steps) {
      expect(step.idempotencyKey.startsWith(`wfr_${deadLetter.deadLetterId}_`)).toBe(true);
      expect(step.idempotencyKey).not.toContain(`orig-${step.stepType}`);
    }

    // Completed history is byte-identical.
    const checkpoint = await tdb.engine.query<{
      status: string;
      output_hash: string;
      idempotency_key: string;
    }>(`SELECT status, output_hash, idempotency_key FROM wf.steps WHERE step_id = $1`, [
      checkpointStepId,
    ]);
    expect(checkpoint.rows[0]?.status).toBe('SUCCEEDED');
    expect(checkpoint.rows[0]?.output_hash).toBe(LIFECYCLE_HASH_A);
    expect(checkpoint.rows[0]?.idempotency_key).toBe(
      `orig-load_immutable_resolved_configuration-${run.runId}`,
    );

    const retried = await listDeadLetters(tdb.engine, { status: 'RETRIED' });
    expect(retried.map((d) => d.deadLetterId)).toContain(deadLetter.deadLetterId);
    expect(result.resumedFrom).toBe(checkpointStepId);
    expect(result.reExecutedStepTypes).toEqual(plan.steps.map((s) => s.stepType));

    const runRow = await tdb.engine.query<{ status: string }>(
      `SELECT status FROM wf.runs WHERE run_id = $1`,
      [run.runId],
    );
    expect(runRow.rows[0]?.status).toBe('SUCCEEDED');

    // A second retry of the same dead letter is refused.
    await expectForesiftError(
      retryFromLastValidCheckpoint(tdb.engine, {
        deadLetterId: deadLetter.deadLetterId,
        runId: run.runId,
        now: T0,
        resume: () => undefined,
      }),
      ErrorCode.WF_DEAD_LETTER_TRANSITION_INVALID,
    );
  });

  it('refuses to retry when no valid checkpoint exists', async () => {
    const run = await seedRun(tdb.engine);
    const stepId = await seedStep(tdb.engine, {
      runId: run.runId,
      stepType: 'discover_candidates',
      status: 'RUNNING',
    });
    const deadLetter = await openDeadLetter(tdb.engine, {
      runId: run.runId,
      stepId,
      errorClass: 'TIMEOUT_OR_5XX',
      context: { attempts: 5, reason: 'retry budget exhausted' },
      now: T0,
    });

    await expectForesiftError(
      retryFromLastValidCheckpoint(tdb.engine, {
        deadLetterId: deadLetter.deadLetterId,
        runId: run.runId,
        now: T0,
        resume: () => undefined,
      }),
      ErrorCode.WF_DEAD_LETTER_NO_CHECKPOINT,
    );
    // The letter is still OPEN; a refused retry changes nothing.
    const still = await listDeadLetters(tdb.engine, { status: 'OPEN' });
    expect(still.map((d) => d.deadLetterId)).toContain(deadLetter.deadLetterId);
  });

  it('refuses a recorded checkpoint reference that is not a SUCCEEDED step', async () => {
    const run = await seedRun(tdb.engine);
    const notCheckpoint = await seedStep(tdb.engine, {
      runId: run.runId,
      stepType: 'discover_candidates',
      status: 'RUNNING',
    });
    const deadLetter = await openDeadLetter(tdb.engine, {
      runId: run.runId,
      stepId: notCheckpoint,
      errorClass: 'TIMEOUT_OR_5XX',
      context: { attempts: 5, reason: 'retry budget exhausted' },
      lastValidCheckpointRef: notCheckpoint,
      now: T0,
    });
    await expectForesiftError(
      retryFromLastValidCheckpoint(tdb.engine, {
        deadLetterId: deadLetter.deadLetterId,
        runId: run.runId,
        now: T0,
        resume: () => undefined,
      }),
      ErrorCode.WF_DEAD_LETTER_NO_CHECKPOINT,
    );
  });
});
