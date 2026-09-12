/**
 * Trigger inbox pipeline (T013, FR-WF-001, FR-WF-002, AC-010; PRD §25.2/§25.3).
 *
 * The §25.3 pipeline in one database transaction:
 *   canonicalize external message id -> idempotent inbox insert
 *   -> resolve the ACTIVE schedule and its current immutable version
 *   -> evaluate the §25.6 concurrency policy
 *   -> create EXACTLY ONE run (guarded by `runs.inbox_id UNIQUE` plus the
 *      `(schedule, version, inbox)` dedupe key) -> record the inbox outcome.
 *
 * Duplicate deliveries collapse: the second delivery returns the EXISTING run
 * id and creates no second run — even when two deliveries race, because the
 * uniqueness is enforced at the storage layer, not in memory. A delivery whose
 * concurrency policy resolves to SKIP_IF_RUNNING still writes exactly one run
 * row (status CANCELLED, `concurrency_outcome = SKIP_IF_RUNNING`) so a policy
 * skip is recorded distinctly from a duplicate collapse.
 *
 * A nonexistent, DRAFT, PAUSED, or DISABLED schedule fails closed with a typed
 * refusal before any run exists.
 *
 * Strictly read-only: shipping a read-only trigger can never trade, custody,
 * sign, handle keys, or submit a transaction.
 */
import {
  ConcurrencyPolicy,
  ErrorCode,
  ForesiftError,
  ScheduleStatus,
  defaultConcurrencyFor,
  parseConcurrencyPolicy,
  type WorkflowWorkloadKind,
} from '@foresift/domain';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';

/** Terminal outcome of one trigger delivery. */
export const TriggerDeliveryOutcome = {
  RUN_STARTED: 'RUN_STARTED',
  POLICY_SKIPPED: 'POLICY_SKIPPED',
  DUPLICATE_COLLAPSED: 'DUPLICATE_COLLAPSED',
  REJECTED: 'REJECTED',
} as const;
export type TriggerDeliveryOutcome =
  (typeof TriggerDeliveryOutcome)[keyof typeof TriggerDeliveryOutcome];

export const ALL_TRIGGER_DELIVERY_OUTCOMES: readonly TriggerDeliveryOutcome[] =
  Object.values(TriggerDeliveryOutcome);

export interface RecordTriggerDeliveryInput {
  /** External scheduler name (for example `qstash`, `local`, `admin`). */
  readonly source: string;
  /** The scheduler's own message id, before canonicalization. */
  readonly externalMessageId: string;
  readonly scheduleId: string;
  /** The scheduler's intended trigger instant. */
  readonly scheduledFor: string;
  /** `sha256:<64hex>` over the delivered body. */
  readonly payloadHash: string;
  readonly receivedAt: string;
  readonly verifiedAt?: string | null;
  /** §25.6 workload kind used when neither the version nor the schedule pins a policy. */
  readonly workloadKind?: WorkflowWorkloadKind;
  /** Absolute run deadline budget from `receivedAt`. */
  readonly deadlineMs?: number;
  /** Deterministic id overrides (tests); derived content-addressed ids otherwise. */
  readonly inboxId?: string;
  readonly runId?: string;
}

export interface TriggerDeliveryResult {
  readonly statusCode: 202;
  readonly inboxId: string;
  readonly runId: string | null;
  readonly outcome: TriggerDeliveryOutcome;
  readonly duplicate: boolean;
  readonly concurrencyPolicy: ConcurrencyPolicy;
}

/** §33.2 default run deadline: a run must not live unbounded. */
export const DEFAULT_RUN_DEADLINE_MS = 15 * 60 * 1000;

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_DIGEST_PATTERN = /^[0-9a-f]{64}$/i;

interface ScheduleIdentityRow {
  readonly schedule_id: string;
  readonly status: string;
  readonly current_version_id: string | null;
  readonly concurrency_policy: string;
}

interface ScheduleVersionRow {
  readonly config_hash: string;
  readonly resolved_config: unknown;
  readonly shadow: boolean;
}

interface InboxRow {
  readonly inbox_id: string;
  readonly status: string;
  readonly processed_run_id: string | null;
}

function normalizeSource(source: unknown): string {
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new ForesiftError(ErrorCode.WF_TRIGGER_IDENTITY_INVALID, 'trigger source is required');
  }
  return source.trim().toLowerCase();
}

/**
 * Canonicalize an external message id so equivalent deliveries share one
 * identity (FR-WF-002, §25.3 step 3):
 * - surrounding whitespace and internal control characters are removed and
 *   internal whitespace runs collapse to a single space;
 * - an absolute URL is reduced to `origin + pathname` (query/fragment/trailing
 *   slash are not part of the identity);
 * - UUID shaped ids and 64-hex content digests are lowercased (they are
 *   case-insensitive by convention); every other id keeps its case, so two
 *   opaque ids differing only in case never collapse into one identity.
 *
 * The result is deterministic and never empty — an empty identity refuses
 * fail-closed rather than inventing one.
 */
export function canonicalizeExternalMessageId(source: string, externalMessageId: string): string {
  normalizeSource(source);
  if (typeof externalMessageId !== 'string') {
    throw new ForesiftError(
      ErrorCode.WF_TRIGGER_IDENTITY_INVALID,
      'external message id must be a string',
    );
  }
  // Control characters become separators (never invisible joins), then every
  // whitespace run collapses to a single space.
  let canonical = externalMessageId.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  canonical = canonical.replace(/\s+/g, ' ');
  if (canonical.length === 0) {
    throw new ForesiftError(ErrorCode.WF_TRIGGER_IDENTITY_INVALID, 'external message id is empty');
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(canonical)) {
    let url: URL;
    try {
      url = new URL(canonical);
    } catch {
      throw new ForesiftError(
        ErrorCode.WF_TRIGGER_IDENTITY_INVALID,
        'external message id looks like a URL but does not parse',
      );
    }
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
    return `${url.origin}${path}`;
  }

  if (UUID_PATTERN.test(canonical) || HEX_DIGEST_PATTERN.test(canonical)) {
    return canonical.toLowerCase();
  }
  return canonical;
}

function assertHash(value: unknown, field: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new ForesiftError(
      ErrorCode.WF_TRIGGER_PAYLOAD_HASH_INVALID,
      `${field} must be a sha256 content address`,
      { field },
    );
  }
  return value;
}

function assertTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || Number.isNaN(Date.parse(value))) {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULER_TIMESTAMP_INVALID,
      `${field} is not a timestamp`,
      {
        field,
      },
    );
  }
  return value;
}

function addMilliseconds(iso: string, milliseconds: number): string {
  return new Date(Date.parse(iso) + milliseconds).toISOString();
}

/** Content-addressed inbox id over the canonical delivery identity. */
export function deriveTriggerInboxId(source: string, canonicalExternalMessageId: string): string {
  return `wf_inbox_${sha256Text(canonicalJson([source, canonicalExternalMessageId])).slice(7, 39)}`;
}

/** Content-addressed run id over the run dedupe key. */
export function deriveTriggerRunId(
  scheduleId: string,
  resolvedScheduleVersion: string,
  inboxId: string,
): string {
  return `wf_run_${sha256Text(canonicalJson([scheduleId, resolvedScheduleVersion, inboxId])).slice(
    7,
    39,
  )}`;
}

/** Resolve the §25.6 policy: version config, then schedule row, then workload default. */
export function resolveConcurrencyPolicy(
  resolvedConfig: unknown,
  schedulePolicy: unknown,
  workloadKind: WorkflowWorkloadKind = 'BROAD_SCAN',
): ConcurrencyPolicy {
  if (resolvedConfig !== null && typeof resolvedConfig === 'object') {
    const fromConfig = (resolvedConfig as Record<string, unknown>).concurrencyPolicy;
    if (typeof fromConfig === 'string') return parseConcurrencyPolicy(fromConfig);
  }
  if (typeof schedulePolicy === 'string') return parseConcurrencyPolicy(schedulePolicy);
  return defaultConcurrencyFor(workloadKind);
}

function refuseInactiveSchedule(scheduleId: string, status: string): never {
  if (status === ScheduleStatus.PAUSED) {
    throw new ForesiftError(ErrorCode.WF_SCHEDULE_PAUSED, 'schedule is paused', { scheduleId });
  }
  if (status === ScheduleStatus.DISABLED) {
    throw new ForesiftError(ErrorCode.WF_SCHEDULE_DISABLED, 'schedule is disabled', { scheduleId });
  }
  throw new ForesiftError(
    ErrorCode.WF_SCHEDULE_NOT_ACTIVE,
    'schedule is not ACTIVE, so a trigger cannot start a run',
    { scheduleId, status },
  );
}

/**
 * Run the §25.3 pipeline. The entire pipeline is one transaction: a refusal
 * rolls back every write, and two concurrent deliveries can never produce two
 * runs (the inbox unique constraint plus `runs.inbox_id UNIQUE` serialize them
 * at the database). The schedule row is locked `FOR UPDATE`, which serializes
 * the §25.6 active-run probe across database connections.
 */
async function recordTriggerDeliveryInner(
  engine: DatabaseEngine,
  input: RecordTriggerDeliveryInput,
): Promise<TriggerDeliveryResult> {
  const source = normalizeSource(input.source);
  const canonical = canonicalizeExternalMessageId(source, input.externalMessageId);
  const payloadHash = assertHash(input.payloadHash, 'payloadHash');
  const scheduledFor = assertTimestamp(input.scheduledFor, 'scheduledFor');
  const receivedAt = assertTimestamp(input.receivedAt, 'receivedAt');
  const verifiedAt =
    input.verifiedAt === undefined || input.verifiedAt === null
      ? receivedAt
      : assertTimestamp(input.verifiedAt, 'verifiedAt');
  const deadlineMs = input.deadlineMs ?? DEFAULT_RUN_DEADLINE_MS;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new ForesiftError(ErrorCode.WF_TRIGGER_IDENTITY_INVALID, 'deadlineMs must be positive', {
      deadlineMs,
    });
  }

  return engine.transaction(async (tx) => {
    // Resolve the target schedule first so a nonexistent schedule is a typed
    // refusal instead of a raw foreign-key violation (no write yet). The row is
    // locked FOR UPDATE for the rest of the transaction, which serializes the
    // §25.6 active-run probe per schedule: two concurrent deliveries with
    // DISTINCT identities can therefore never both observe "no active run" and
    // both start under SKIP_IF_RUNNING.
    const scheduleResult = await tx.query<ScheduleIdentityRow>(
      `SELECT schedule_id, status, current_version_id, concurrency_policy
         FROM wf.schedules WHERE schedule_id = $1 FOR UPDATE`,
      [input.scheduleId],
    );
    const schedule = scheduleResult.rows[0];
    if (schedule === undefined) {
      throw new ForesiftError(ErrorCode.WF_SCHEDULE_NOT_FOUND, 'unknown schedule', {
        scheduleId: input.scheduleId,
      });
    }
    const schedulePolicy = parseConcurrencyPolicy(schedule.concurrency_policy);

    // Idempotent inbox insert: the unique `(source, canonical_external_message_id)`
    // identity makes redelivery a no-op at the storage layer.
    const inboxId = input.inboxId ?? deriveTriggerInboxId(source, canonical);
    const inserted = await tx.query<{ inbox_id: string }>(
      `INSERT INTO wf.trigger_inbox
         (inbox_id, source, external_message_id, canonical_external_message_id,
          schedule_id, scheduled_for, payload_hash, received_at, verified_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'VERIFIED')
       ON CONFLICT (source, canonical_external_message_id) DO NOTHING
       RETURNING inbox_id`,
      [
        inboxId,
        source,
        input.externalMessageId,
        canonical,
        input.scheduleId,
        scheduledFor,
        payloadHash,
        receivedAt,
        verifiedAt,
      ],
    );

    let resolvedInboxId = inboxId;
    if (inserted.rows.length === 0) {
      const existingResult = await tx.query<InboxRow>(
        `SELECT inbox_id, status, processed_run_id FROM wf.trigger_inbox
          WHERE source = $1 AND canonical_external_message_id = $2`,
        [source, canonical],
      );
      const existing = existingResult.rows[0];
      if (existing === undefined) {
        throw new ForesiftError(
          ErrorCode.CONTRACT_INVARIANT_VIOLATED,
          'inbox insert reported a conflict but no row exists',
          { source, canonicalExternalMessageId: canonical },
        );
      }
      resolvedInboxId = existing.inbox_id;
      if (existing.status === 'REJECTED') {
        throw new ForesiftError(
          ErrorCode.WF_TRIGGER_DELIVERY_REJECTED,
          'this delivery identity was previously rejected',
          { inboxId: existing.inbox_id },
        );
      }
      if (existing.processed_run_id !== null || existing.status === 'PROCESSED') {
        // Mark the collapsed redelivery on the shared identity, then return the
        // existing run: never a second run.
        await tx.query(
          `UPDATE wf.trigger_inbox SET status = 'DUPLICATE_COLLAPSED'
            WHERE inbox_id = $1 AND status = 'PROCESSED'`,
          [existing.inbox_id],
        );
        return {
          statusCode: 202,
          inboxId: existing.inbox_id,
          runId: existing.processed_run_id,
          outcome: TriggerDeliveryOutcome.DUPLICATE_COLLAPSED,
          duplicate: true,
          concurrencyPolicy: schedulePolicy,
        };
      }
      // A non-terminal row (a crash between inbox insert and run creation):
      // fall through and finish the pipeline for the same identity.
    }

    if (schedule.status !== ScheduleStatus.ACTIVE) {
      refuseInactiveSchedule(schedule.schedule_id, schedule.status);
    }
    if (schedule.current_version_id === null) {
      throw new ForesiftError(
        ErrorCode.WF_SCHEDULE_VERSION_NOT_FOUND,
        'active schedule has no current immutable version',
        { scheduleId: schedule.schedule_id },
      );
    }
    const versionResult = await tx.query<ScheduleVersionRow>(
      `SELECT config_hash, resolved_config, shadow FROM wf.schedule_versions
        WHERE version_id = $1 AND schedule_id = $2`,
      [schedule.current_version_id, schedule.schedule_id],
    );
    const version = versionResult.rows[0];
    if (version === undefined) {
      throw new ForesiftError(
        ErrorCode.WF_SCHEDULE_VERSION_NOT_FOUND,
        'current schedule version row is missing',
        { scheduleId: schedule.schedule_id, versionId: schedule.current_version_id },
      );
    }

    const policy = resolveConcurrencyPolicy(
      version.resolved_config,
      schedule.concurrency_policy,
      input.workloadKind,
    );

    const activeResult = await tx.query<{ run_id: string }>(
      `SELECT run_id FROM wf.runs
        WHERE schedule_id = $1 AND status IN ('PENDING', 'RUNNING', 'WAITING')
        ORDER BY run_id LIMIT 1`,
      [schedule.schedule_id],
    );
    const hasActiveRun = activeResult.rows.length > 0;

    let runStatus = 'PENDING';
    let completedAt: string | null = null;
    let outcome: TriggerDeliveryOutcome = TriggerDeliveryOutcome.RUN_STARTED;
    if (hasActiveRun && policy === ConcurrencyPolicy.SKIP_IF_RUNNING) {
      // The run row still exists so the policy decision is auditable; it never
      // started and is terminal from birth.
      runStatus = 'CANCELLED';
      completedAt = receivedAt;
      outcome = TriggerDeliveryOutcome.POLICY_SKIPPED;
    } else if (hasActiveRun && policy === ConcurrencyPolicy.CANCEL_PREVIOUS) {
      await tx.query(
        `UPDATE wf.runs SET status = 'CANCELLED', completed_at = $2
          WHERE schedule_id = $1 AND status IN ('PENDING', 'RUNNING', 'WAITING')`,
        [schedule.schedule_id, receivedAt],
      );
    }

    const runId =
      input.runId ??
      deriveTriggerRunId(schedule.schedule_id, schedule.current_version_id, resolvedInboxId);
    const deadline = addMilliseconds(receivedAt, deadlineMs);
    const created = await tx.query<{ run_id: string }>(
      `INSERT INTO wf.runs
         (run_id, schedule_id, resolved_schedule_version, inbox_id,
          trigger_source, trigger_external_message_id,
          trigger_canonical_external_message_id, concurrency_policy,
          concurrency_outcome, shadow, status, deadline, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT DO NOTHING
       RETURNING run_id`,
      [
        runId,
        schedule.schedule_id,
        schedule.current_version_id,
        resolvedInboxId,
        source,
        input.externalMessageId,
        canonical,
        policy,
        policy,
        version.shadow,
        runStatus,
        deadline,
        completedAt,
      ],
    );

    if (created.rows.length === 0) {
      const existingRun = await tx.query<{ run_id: string }>(
        `SELECT run_id FROM wf.runs WHERE inbox_id = $1`,
        [resolvedInboxId],
      );
      const existingRunId = existingRun.rows[0]?.run_id ?? null;
      if (existingRunId === null) {
        throw new ForesiftError(
          ErrorCode.CONTRACT_INVARIANT_VIOLATED,
          'run insert reported a conflict but no run exists for the inbox',
          { inboxId: resolvedInboxId },
        );
      }
      return {
        statusCode: 202,
        inboxId: resolvedInboxId,
        runId: existingRunId,
        outcome: TriggerDeliveryOutcome.DUPLICATE_COLLAPSED,
        duplicate: true,
        concurrencyPolicy: policy,
      };
    }

    await tx.query(
      `UPDATE wf.trigger_inbox
          SET status = 'PROCESSED', processed_run_id = $1, verified_at = COALESCE(verified_at, $2)
        WHERE inbox_id = $3`,
      [runId, verifiedAt, resolvedInboxId],
    );

    return {
      statusCode: 202,
      inboxId: resolvedInboxId,
      runId,
      outcome,
      duplicate: false,
      concurrencyPolicy: policy,
    };
  });
}

/**
 * Per-schedule admission chains (FR-WF-002, §25.6). The database row lock
 * (`SELECT … FOR UPDATE`) serializes admissions across connections, but a
 * single engine process shares one connection: two `Promise.all` deliveries
 * would otherwise interleave inside one transaction and both observe "no
 * active run". Chaining admissions keyed by schedule makes the SKIP_IF_RUNNING
 * decision deterministic in-process as well, so a second distinct delivery
 * always sees the first run and is recorded as `POLICY_SKIPPED` rather than
 * starting a concurrent run. A rejection never poisons later admissions.
 */
const admissionChains = new Map<string, Promise<void>>();

export async function recordTriggerDelivery(
  engine: DatabaseEngine,
  input: RecordTriggerDeliveryInput,
): Promise<TriggerDeliveryResult> {
  const scheduleId = input.scheduleId;
  if (typeof scheduleId !== 'string' || scheduleId.length === 0) {
    // Invalid identity; the inner pipeline refuses fail-closed.
    return recordTriggerDeliveryInner(engine, input);
  }
  const previous = admissionChains.get(scheduleId) ?? Promise.resolve();
  const admission = previous.then(() => recordTriggerDeliveryInner(engine, input));
  const tail = admission.then(
    () => undefined,
    () => undefined,
  );
  admissionChains.set(scheduleId, tail);
  void tail.then(() => {
    if (admissionChains.get(scheduleId) === tail) admissionChains.delete(scheduleId);
  });
  return admission;
}
