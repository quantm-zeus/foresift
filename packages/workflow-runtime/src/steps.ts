/**
 * Step checkpoints with per-run idempotency keys (T015, FR-WF-001, FR-WF-003;
 * PRD §25.4/§25.5).
 *
 * Durable resumption rests on one rule: a step is identified by
 * `(run_id, idempotency_key)` and, once SUCCEEDED, replaying the same key
 * returns the RECORDED output hash without re-running the side effect. Every
 * write goes through the `wf.steps` unique constraint, so a crash between the
 * effect and the checkpoint is recoverable by replay and never silently
 * duplicates work.
 *
 * `WF_STANDARD_STEP_ORDER` transcribes the §25.4 discovery workflow and
 * `assertStepOrder` guards against executing steps out of order.
 *
 * Strictly read-only: checkpointing records progress; it can never trade,
 * custody, sign, handle keys, or submit a transaction.
 */
import {
  ErrorCode,
  ForesiftError,
  isRetryable,
  parseRetryErrorClass,
  parseStepStatus,
  retryPolicyFor,
  type RetryErrorClass,
  type StepStatus,
} from '@foresift/domain';
import { type DatabaseEngine } from '@foresift/persistence';
import { StepLeaseManager, StaleStepLeaseError } from './leases.ts';

/**
 * The fenced-lease identity a checkpoint must still own to commit (§25.7).
 * When supplied, the commit statement itself compares the current fencing
 * token, so a stale worker fails closed at the database even if it never calls
 * `assertLeaseCurrent` (AC-012).
 */
export interface StepLeaseFence {
  readonly resourceKey: string;
  readonly fencingToken: number;
}

/**
 * The §25.4 standard discovery workflow, in order. The executable deployment
 * may skip steps, but it may never reorder them.
 */
export const WF_STANDARD_STEP_ORDER = [
  'load_immutable_resolved_configuration',
  'discover_candidates',
  'canonicalize_and_deduplicate',
  'apply_eligibility_data_quality_gates',
  'fetch_cheap_required_evidence',
  'update_snapshots_and_features',
  'rank_and_select_candidates',
  'run_deep_research_within_budget',
  'validate_decision',
  'run_conditional_skeptic',
  'apply_lifecycle_risk_transitions',
  'apply_alert_policy',
  'commit_decision_and_outbox_atomically',
  'schedule_outcome_collection',
  'complete_run_summary',
] as const;

export type StandardStepType = (typeof WF_STANDARD_STEP_ORDER)[number];

const STEP_ORDER_INDEX: ReadonlyMap<string, number> = new Map(
  WF_STANDARD_STEP_ORDER.map((step, index) => [step, index]),
);

/** Position of a standard step, or -1 for a non-standard step type. */
export function stepOrderIndex(stepType: string): number {
  return STEP_ORDER_INDEX.get(stepType) ?? -1;
}

/**
 * Order guard: the requested step must be a known standard step and no
 * already-completed step may come AFTER it (§25.4). Non-standard step types
 * are refused rather than silently allowed.
 */
export function assertStepOrder(stepType: string, completedStepTypes: readonly string[]): void {
  const index = stepOrderIndex(stepType);
  if (index < 0) {
    throw new ForesiftError(ErrorCode.WF_STEP_ORDER_INVALID, 'unknown standard step type', {
      stepType,
    });
  }
  for (const completed of completedStepTypes) {
    const completedIndex = stepOrderIndex(completed);
    if (completedIndex < 0) {
      throw new ForesiftError(ErrorCode.WF_STEP_ORDER_INVALID, 'unknown completed step type', {
        completed,
      });
    }
    if (completedIndex > index) {
      throw new ForesiftError(
        ErrorCode.WF_STEP_ORDER_INVALID,
        'step would run after a later step already completed',
        { stepType, completed },
      );
    }
  }
}

const ALLOWED_STEP_TRANSITIONS: Readonly<Record<StepStatus, readonly StepStatus[]>> = {
  PENDING: ['RUNNING', 'SKIPPED_POLICY'],
  RUNNING: ['SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_EXHAUSTED', 'SKIPPED_POLICY'],
  SUCCEEDED: [],
  FAILED_RETRYABLE: ['RUNNING', 'FAILED_EXHAUSTED'],
  FAILED_EXHAUSTED: [],
  SKIPPED_POLICY: [],
};

/** Fail-closed step status transition (§25.5 vocabulary). */
export function assertStepTransition(from: StepStatus, to: StepStatus): void {
  if (!ALLOWED_STEP_TRANSITIONS[from].includes(to)) {
    throw new ForesiftError(
      ErrorCode.WF_STEP_TRANSITION_INVALID,
      `step status cannot move from ${from} to ${to}`,
      { from, to },
    );
  }
}

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function assertHash(value: unknown, field: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new ForesiftError(
      ErrorCode.WF_STEP_TRANSITION_INVALID,
      `${field} must be a sha256 content address`,
      { field },
    );
  }
  return value;
}

function nowIso(input?: string): string {
  const now = input ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(now))) {
    throw new ForesiftError(ErrorCode.WF_STEP_TRANSITION_INVALID, 'now is not a timestamp', {
      now,
    });
  }
  return now;
}

export interface StepCheckpointRecord {
  readonly stepId: string;
  readonly runId: string;
  readonly stepType: string;
  readonly idempotencyKey: string;
  readonly attempt: number;
  readonly inputHash: string | null;
  readonly outputHash: string | null;
  readonly status: StepStatus;
  readonly leaseOwner: string | null;
  readonly leaseVersion: number;
  readonly leaseExpiresAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly errorClass: RetryErrorClass | null;
  readonly retryable: boolean | null;
}

interface StepRow {
  readonly step_id: string;
  readonly run_id: string;
  readonly step_type: string;
  readonly idempotency_key: string;
  readonly attempt: number;
  readonly input_hash: string | null;
  readonly output_hash: string | null;
  readonly status: string;
  readonly lease_owner: string | null;
  readonly lease_version: number;
  readonly lease_expires_at: string | null;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly error_class: string | null;
  readonly retryable: boolean | null;
}

function mapRow(row: StepRow): StepCheckpointRecord {
  return {
    stepId: row.step_id,
    runId: row.run_id,
    stepType: row.step_type,
    idempotencyKey: row.idempotency_key,
    attempt: row.attempt,
    inputHash: row.input_hash,
    outputHash: row.output_hash,
    status: parseStepStatus(row.status),
    leaseOwner: row.lease_owner,
    leaseVersion: row.lease_version,
    leaseExpiresAt: row.lease_expires_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorClass: row.error_class === null ? null : parseRetryErrorClass(row.error_class),
    retryable: row.retryable,
  };
}

const STEP_COLUMNS = `step_id, run_id, step_type, idempotency_key, attempt,
  input_hash, output_hash, status, lease_owner, lease_version, lease_expires_at,
  started_at, completed_at, error_class, retryable`;

/**
 * Commit-time fence predicate (§25.7, AC-012): `$9` is the caller's fencing
 * token (NULL means "no explicit fence was presented") and `$10` the step's
 * lease resource key; `$11` is the commit instant used for the live-lease probe.
 *
 * Fencing is REQUIRED whenever the step is lease-owned, never opt-in:
 * - with a token, the referenced lease row must still be the caller's live,
 *   unreleased token (an expired-but-not-taken-over lease still passes: expiry
 *   alone is not fencing, only a takeover is);
 * - WITHOUT a token, the commit is allowed only when NO live (unreleased,
 *   unexpired) lease exists for the step's resource key. If one does, the
 *   caller omitted a fence that the step's lease requires, so the write matches
 *   zero rows and fails closed instead of letting a stale worker commit.
 */
const STEP_LEASE_FENCE_PREDICATE = `(CASE
        WHEN $9::bigint IS NOT NULL THEN EXISTS (
            SELECT 1 FROM wf.step_leases
             WHERE resource_key = $10 AND fencing_token = $9 AND released_at IS NULL)
        ELSE NOT EXISTS (
            SELECT 1 FROM wf.step_leases
             WHERE resource_key = $10 AND released_at IS NULL AND expires_at > $11)
    END)`;

/**
 * The lease resource key the step lease helpers use for a step: derived from
 * `(runId, stepType)` exactly as `StepLeaseManager.acquire` callers derive it,
 * so omitting `lease` can never choose a different (unfenced) key.
 */
function stepLeaseResourceKey(runId: string, stepType: string): string {
  return StepLeaseManager.resourceKeyHash({ runId, stepType });
}

function fenceParams(
  fence: StepLeaseFence | undefined,
  resourceKey: string,
): readonly [number | null, string] {
  return fence === undefined ? [null, resourceKey] : [fence.fencingToken, fence.resourceKey];
}

/**
 * Classify a zero-rows step write into the typed refusal the caller throws.
 * When the presented fence is no longer current — or a fence was required but
 * omitted while a live lease exists — the typed refusal is
 * `LEASE_FENCING_TOKEN_STALE` (the stale worker's commit lost a fencing race);
 * otherwise the step row itself changed (`WF_STEP_NOT_FOUND`).
 */
async function stepWriteRefusal(
  tx: DatabaseEngine,
  fence: StepLeaseFence | undefined,
  resourceKey: string,
  now: string,
  message: string,
  detail: Record<string, string | number | boolean | null>,
): Promise<ForesiftError> {
  let stale: boolean;
  if (fence === undefined) {
    // No fence presented: stale iff a live lease exists for the step key.
    const live = await tx.query<{ fencing_token: string }>(
      `SELECT fencing_token FROM wf.step_leases
        WHERE resource_key = $1 AND released_at IS NULL AND expires_at > $2`,
      [resourceKey, now],
    );
    stale = live.rows.length > 0;
  } else {
    // A fence presented: stale iff its token no longer owns the lease.
    const held = await tx.query<{ fencing_token: string }>(
      `SELECT fencing_token FROM wf.step_leases
        WHERE resource_key = $1 AND fencing_token = $2 AND released_at IS NULL`,
      [resourceKey, fence.fencingToken],
    );
    stale = held.rows.length === 0;
  }
  if (stale) {
    const staleDetail: Record<string, string | number | boolean | null> = {
      ...detail,
      resourceKey,
    };
    if (fence !== undefined) staleDetail.fencingToken = fence.fencingToken;
    return new StaleStepLeaseError(message, staleDetail);
  }
  return new ForesiftError(ErrorCode.WF_STEP_NOT_FOUND, message, detail);
}

export interface BeginStepInput {
  readonly runId: string;
  readonly stepType: string;
  readonly idempotencyKey: string;
  readonly inputHash?: string | null;
  readonly leaseOwner?: string | null;
  readonly leaseVersion?: number;
  readonly leaseExpiresAt?: string | null;
  readonly now?: string;
  readonly stepId?: string;
  /**
   * The lease fence. Optional in shape, but REQUIRED whenever a live
   * (unreleased, unexpired) lease exists for the step's `(runId, stepType)`
   * resource key: the re-claim of an EXISTING step row and every checkpoint
   * commit fail closed with `LEASE_FENCING_TOKEN_STALE` when it is omitted
   * (AC-012). The first INSERT of a brand-new `(runId, idempotencyKey)` is not
   * lease-fenced — there is no prior step state to protect and the caller
   * acquires the lease before beginning the work — but the later checkpoint of
   * that step is fenced. It may be omitted only when no live lease exists.
   */
  readonly lease?: StepLeaseFence;
}

export interface StepReplayResult {
  readonly stepId: string;
  readonly status: StepStatus;
  readonly attempt: number;
  readonly inputHash: string | null;
  readonly outputHash: string | null;
  /** True when a previously SUCCEEDED step was replayed from its checkpoint. */
  readonly replayed: boolean;
  /** True when this call claimed a fresh attempt the caller must execute. */
  readonly executed: boolean;
}

/**
 * Claim the next attempt of `(runId, idempotencyKey)`.
 *
 * - SUCCEEDED → replay: the recorded output hash is returned and the caller
 *   MUST NOT re-run the side effect (`replayed: true`, `executed: false`).
 * - FAILED_RETRYABLE / RUNNING / PENDING → a new attempt is claimed
 *   (`executed: true`, attempt incremented).
 * - FAILED_EXHAUSTED / SKIPPED_POLICY → refused: recovery uses FRESH
 *   idempotency keys (§25.9), it never rewrites completed history.
 * - a reused key with a different `input_hash` → refused.
 */
export async function beginStep(
  engine: DatabaseEngine,
  input: BeginStepInput,
): Promise<StepReplayResult> {
  const now = nowIso(input.now);
  const inputHash =
    input.inputHash === undefined || input.inputHash === null
      ? null
      : assertHash(input.inputHash, 'inputHash');
  const leaseVersion = input.leaseVersion ?? 0;
  const leaseOwner = input.leaseOwner ?? null;
  const leaseExpiresAt = input.leaseExpiresAt ?? null;

  return engine.transaction(async (tx) => {
    const existingResult = await tx.query<StepRow>(
      `SELECT ${STEP_COLUMNS} FROM wf.steps WHERE run_id = $1 AND idempotency_key = $2`,
      [input.runId, input.idempotencyKey],
    );
    let existing = existingResult.rows[0];

    if (existing === undefined) {
      const stepId = input.stepId ?? `wfs_${input.runId}_${input.idempotencyKey}`;
      const inserted = await tx.query<StepRow>(
        `INSERT INTO wf.steps
           (step_id, run_id, step_type, idempotency_key, attempt, input_hash, status,
            lease_owner, lease_version, lease_expires_at, started_at)
         VALUES ($1, $2, $3, $4, 1, $5, 'RUNNING', $6, $7, $8, $9)
         ON CONFLICT (run_id, idempotency_key) DO NOTHING
         RETURNING ${STEP_COLUMNS}`,
        [
          stepId,
          input.runId,
          input.stepType,
          input.idempotencyKey,
          inputHash,
          leaseOwner,
          leaseVersion,
          leaseExpiresAt,
          now,
        ],
      );
      const insertedRow = inserted.rows[0];
      if (insertedRow !== undefined) {
        return {
          stepId: insertedRow.step_id,
          status: parseStepStatus(insertedRow.status),
          attempt: insertedRow.attempt,
          inputHash: insertedRow.input_hash,
          outputHash: insertedRow.output_hash,
          replayed: false,
          executed: true,
        };
      }
      // Lost a concurrent claim: fall through and handle the winner's row.
      const claimed = await tx.query<StepRow>(
        `SELECT ${STEP_COLUMNS} FROM wf.steps WHERE run_id = $1 AND idempotency_key = $2`,
        [input.runId, input.idempotencyKey],
      );
      existing = claimed.rows[0];
      if (existing === undefined) {
        throw new ForesiftError(
          ErrorCode.CONTRACT_INVARIANT_VIOLATED,
          'step insert did not produce a row',
          { runId: input.runId, idempotencyKey: input.idempotencyKey },
        );
      }
    }

    const currentStatus = parseStepStatus(existing.status);
    if (inputHash !== null && existing.input_hash !== null && existing.input_hash !== inputHash) {
      throw new ForesiftError(
        ErrorCode.WF_STEP_INPUT_HASH_MISMATCH,
        'idempotency key was reused with a different input hash',
        { runId: input.runId, idempotencyKey: input.idempotencyKey },
      );
    }
    if (currentStatus === 'SUCCEEDED') {
      return {
        stepId: existing.step_id,
        status: currentStatus,
        attempt: existing.attempt,
        inputHash: existing.input_hash,
        outputHash: existing.output_hash,
        replayed: true,
        executed: false,
      };
    }
    if (currentStatus === 'FAILED_EXHAUSTED' || currentStatus === 'SKIPPED_POLICY') {
      throw new ForesiftError(
        ErrorCode.WF_STEP_TRANSITION_INVALID,
        `a ${currentStatus} step cannot be re-run under the same idempotency key`,
        { runId: input.runId, idempotencyKey: input.idempotencyKey, status: currentStatus },
      );
    }
    // A crash-orphaned RUNNING row is reclaimed as a NEW attempt (durable
    // resumption, §25.5); every other claimable status must transition legally.
    if (currentStatus !== 'RUNNING') {
      assertStepTransition(currentStatus, 'RUNNING');
    }
    const [fenceToken, fenceResourceKey] = fenceParams(
      input.lease,
      input.lease?.resourceKey ?? stepLeaseResourceKey(input.runId, input.stepType),
    );
    const updated = await tx.query<StepRow>(
      `UPDATE wf.steps
          SET status = 'RUNNING',
              attempt = attempt + 1,
              input_hash = COALESCE($1, input_hash),
              lease_owner = COALESCE($2, lease_owner),
              lease_version = $3,
              lease_expires_at = $4,
              started_at = $5,
              completed_at = NULL,
              error_class = NULL,
              retryable = NULL
        WHERE run_id = $6 AND idempotency_key = $7 AND status = $8
          AND ${STEP_LEASE_FENCE_PREDICATE}
        RETURNING ${STEP_COLUMNS}`,
      [
        inputHash,
        leaseOwner,
        leaseVersion,
        leaseExpiresAt,
        now,
        input.runId,
        input.idempotencyKey,
        currentStatus,
        fenceToken,
        fenceResourceKey,
        now,
      ],
    );
    const claimed = updated.rows[0];
    if (claimed === undefined) {
      throw await stepWriteRefusal(
        tx,
        input.lease,
        fenceResourceKey,
        now,
        'step attempt was claimed by a concurrent worker',
        {
          runId: input.runId,
          idempotencyKey: input.idempotencyKey,
        },
      );
    }
    return {
      stepId: claimed.step_id,
      status: parseStepStatus(claimed.status),
      attempt: claimed.attempt,
      inputHash: claimed.input_hash,
      outputHash: claimed.output_hash,
      replayed: false,
      executed: true,
    };
  });
}

export interface CheckpointStepInput {
  readonly runId: string;
  readonly idempotencyKey: string;
  /** SUCCEEDED, FAILED_RETRYABLE, FAILED_EXHAUSTED, or SKIPPED_POLICY. */
  readonly status: StepStatus;
  readonly outputHash?: string | null;
  readonly errorClass?: RetryErrorClass | null;
  readonly retryable?: boolean | null;
  readonly now?: string;
  /**
   * The lease fence. Optional in shape, but the commit is REQUIRED to present
   * it whenever a live (unreleased, unexpired) lease exists for the step's
   * `(runId, stepType)` resource key — otherwise the commit fails closed with
   * `LEASE_FENCING_TOKEN_STALE` (AC-012). A lease-less commit is allowed only
   * when no live lease exists (the step never took one).
   */
  readonly lease?: StepLeaseFence;
}

/**
 * Record the outcome of the claimed attempt. Only a RUNNING step may be
 * checkpointed, and SUCCEEDED requires an `outputHash` — the recorded value
 * every later replay returns. With a `lease` fence the commit statement itself
 * compares the current fencing token, so a stale holder cannot commit.
 */
export async function checkpointStep(
  engine: DatabaseEngine,
  input: CheckpointStepInput,
): Promise<StepCheckpointRecord> {
  const target = parseStepStatus(input.status);
  if (target === 'PENDING' || target === 'RUNNING') {
    throw new ForesiftError(
      ErrorCode.WF_STEP_TRANSITION_INVALID,
      'checkpointStep records a completed attempt, not PENDING/RUNNING',
      { status: target },
    );
  }
  const now = nowIso(input.now);
  const outputHash =
    input.outputHash === undefined || input.outputHash === null
      ? null
      : assertHash(input.outputHash, 'outputHash');
  if (target === 'SUCCEEDED' && outputHash === null) {
    throw new ForesiftError(
      ErrorCode.WF_STEP_TRANSITION_INVALID,
      'a SUCCEEDED step must record its output hash',
      { runId: input.runId, idempotencyKey: input.idempotencyKey },
    );
  }
  const errorClass = input.errorClass ?? null;
  const retryable =
    input.retryable ?? (errorClass === null ? null : isRetryable(retryPolicyFor(errorClass)));

  return engine.transaction(async (tx) => {
    const existingResult = await tx.query<StepRow>(
      `SELECT ${STEP_COLUMNS} FROM wf.steps WHERE run_id = $1 AND idempotency_key = $2`,
      [input.runId, input.idempotencyKey],
    );
    const existing = existingResult.rows[0];
    if (existing === undefined) {
      throw new ForesiftError(ErrorCode.WF_STEP_NOT_FOUND, 'unknown step checkpoint', {
        runId: input.runId,
        idempotencyKey: input.idempotencyKey,
      });
    }
    assertStepTransition(parseStepStatus(existing.status), target);
    // The fence is keyed to the STEP's lease resource key even when the caller
    // omits `lease`, so a live lease always demands the matching token.
    const resourceKey =
      input.lease?.resourceKey ?? stepLeaseResourceKey(input.runId, existing.step_type);
    const [fenceToken, fenceResourceKey] = fenceParams(input.lease, resourceKey);
    const updated = await tx.query<StepRow>(
      `UPDATE wf.steps
          SET status = $1, output_hash = $2, error_class = $3, retryable = $4, completed_at = $5
        WHERE run_id = $6 AND idempotency_key = $7 AND status = $8
          AND ${STEP_LEASE_FENCE_PREDICATE}
        RETURNING ${STEP_COLUMNS}`,
      [
        target,
        outputHash,
        errorClass,
        retryable,
        now,
        input.runId,
        input.idempotencyKey,
        existing.status,
        fenceToken,
        fenceResourceKey,
        now,
      ],
    );
    const row = updated.rows[0];
    if (row === undefined) {
      throw await stepWriteRefusal(
        tx,
        input.lease,
        fenceResourceKey,
        now,
        'step checkpoint is no longer RUNNING',
        {
          runId: input.runId,
          idempotencyKey: input.idempotencyKey,
        },
      );
    }
    return mapRow(row);
  });
}

/** Read a recorded checkpoint without changing it. */
export async function readStepCheckpoint(
  engine: DatabaseEngine,
  input: { readonly runId: string; readonly idempotencyKey: string },
): Promise<StepCheckpointRecord | null> {
  const result = await engine.query<StepRow>(
    `SELECT ${STEP_COLUMNS} FROM wf.steps WHERE run_id = $1 AND idempotency_key = $2`,
    [input.runId, input.idempotencyKey],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapRow(row);
}

export interface RunStepOnceInput extends BeginStepInput {
  /** Error class recorded if the effect throws (default TIMEOUT_OR_5XX). */
  readonly errorClassOnFailure?: RetryErrorClass;
}

/**
 * Idempotent step execution: claim the attempt, run the effect ONLY when this
 * call actually claimed a fresh attempt, and checkpoint the result. A replayed
 * SUCCEEDED step returns the recorded output hash and never invokes `effect`.
 */
export async function runStepOnce(
  engine: DatabaseEngine,
  input: RunStepOnceInput,
  effect: () => Promise<{ readonly outputHash: string }>,
): Promise<StepReplayResult> {
  const begun = await beginStep(engine, input);
  if (!begun.executed) return begun;
  const leaseFields = input.lease === undefined ? {} : { lease: input.lease };
  try {
    const { outputHash } = await effect();
    await checkpointStep(engine, {
      runId: input.runId,
      idempotencyKey: input.idempotencyKey,
      status: 'SUCCEEDED',
      outputHash,
      ...leaseFields,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    return {
      stepId: begun.stepId,
      status: 'SUCCEEDED',
      attempt: begun.attempt,
      inputHash: begun.inputHash,
      outputHash,
      replayed: false,
      executed: true,
    };
  } catch (error) {
    const errorClass = input.errorClassOnFailure ?? 'TIMEOUT_OR_5XX';
    await checkpointStep(engine, {
      runId: input.runId,
      idempotencyKey: input.idempotencyKey,
      status: 'FAILED_RETRYABLE',
      errorClass,
      retryable: isRetryable(retryPolicyFor(errorClass)),
      ...leaseFields,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    throw error;
  }
}
