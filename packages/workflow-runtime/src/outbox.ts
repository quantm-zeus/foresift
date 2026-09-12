/**
 * Transactional notification outbox: atomic commit boundary and crash-safe
 * delivery workers (T020, FR-WF-006, AC-011, AC-061; PRD §26.5).
 *
 * §26.5 requires the decision, the alert record, and the notification outbox
 * entry to commit in ONE database transaction — a notification can therefore
 * never be lost (no outbox row) and never be orphaned (outbox row without a
 * decision). Three functions own the boundary:
 *
 * - `commitDecisionWithOutbox` inserts `wf.decision_commits` +
 *   `wf.alert_records` + `wf.notification_outbox` inside one
 *   `engine.transaction`. Any failure rolls ALL of it back. A shadow run tags
 *   the row `SUPPRESSED_SHADOW` (never deliverable, kept for evaluation); a
 *   provider-outage classification tags it `SUPPRESSED_OUTAGE` while PRESERVING
 *   the decision and alert rows (AC-061).
 * - `claimOutboxBatch` claims PENDING rows and orphaned CLAIMED rows whose
 *   `claim_expires_at <= now`, allocating a fresh fencing token via
 *   `nextval('wf.wf_outbox_fencing_seq')`. The claim is atomic: two workers
 *   cannot hold the same row.
 * - `deliverClaimed` sends ONLY from rows this worker currently owns, using
 *   the outbox id as the channel idempotency key; on success it marks SENT, on
 *   a transient failure it increments attempts and returns the row to PENDING
 *   (or FAILED once the §25.8 outbox retry budget is exhausted). A stale claim
 *   refuses to send. A crash after send but before the SENT mark is covered by
 *   the channel's idempotency law: recovery re-claims with a fresh token and
 *   the replay collapses to exactly one delivered notification.
 *
 * Never sends from a shadow/SUPPRESSED row.
 *
 * Strictly read-only: this module delivers intelligence notifications; it can
 * never trade, custody, sign, handle keys, or submit a transaction.
 */
import { randomUUID } from 'node:crypto';
import {
  ErrorCode,
  ForesiftError,
  parseOutboxStatus,
  type OutboxStatus,
  type ShadowInfluenceKind,
} from '@foresift/domain';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import {
  NotificationChannelCrashError,
  isTransientChannelError,
  type NotificationChannelPort,
} from './channels.ts';
import { assertNoOpportunityInfluence, shadowSuppressionFor } from './shadow.ts';
import { planAttempt } from './retries.ts';

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_BATCH_LIMIT = 1_000;
/** §25.8 outbox retry accounting uses the NOTIFICATION_TRANSIENT class. */
const OUTBOX_ERROR_CLASS = 'NOTIFICATION_TRANSIENT' as const;

/** The classification the caller attaches to a decision commit. */
export const OutboxCommitOutcome = {
  NORMAL: 'NORMAL',
  PROVIDER_OUTAGE: 'PROVIDER_OUTAGE',
} as const;
export type OutboxCommitOutcome = (typeof OutboxCommitOutcome)[keyof typeof OutboxCommitOutcome];

/** A decision record to commit (FR-WF-006, INV-004 reconstruction). */
export interface DecisionCommitInput {
  readonly decisionId: string;
  readonly decisionKind: string;
  readonly payload: unknown;
  /** Optional caller-supplied `sha256:<64hex>`; computed when absent. */
  readonly payloadHash?: string;
}

/** The alert record that MUST commit in the same transaction as the decision. */
export interface AlertRecordInput {
  readonly alertId: string;
  readonly alertClass: string;
  readonly payload: unknown;
  /** Optional caller-supplied `sha256:<64hex>`; computed when absent. */
  readonly payloadHash?: string;
}

/** The outbox entry to commit alongside the decision and alert. */
export interface OutboxEntryInput {
  readonly outboxId?: string;
  readonly channel: string;
  /**
   * Hash of the notification payload. Defaults to the alert record's payload
   * hash (the alert payload is the delivered content); the caller may override
   * it when the rendered notification differs from the stored alert payload.
   */
  readonly payloadHash?: string;
  /** Optional override for `alert_ref`; defaults to `alert.alertId`. */
  readonly alertRef?: string | null;
}

export interface CommitDecisionWithOutboxInput {
  readonly runId: string;
  readonly decision: DecisionCommitInput;
  readonly alert: AlertRecordInput;
  readonly outbox: OutboxEntryInput;
  /** Commit classification; `PROVIDER_OUTAGE` suppresses delivery (AC-061). */
  readonly outcome?: OutboxCommitOutcome;
  /** Influence this commit would exert; defaults to OPPORTUNITY_NOTIFICATION. */
  readonly influence?: ShadowInfluenceKind;
  /** Injected clock; defaults to wall clock. */
  readonly now?: string;
}

export interface CommitDecisionWithOutboxResult {
  readonly outboxId: string;
  readonly status: OutboxStatus;
  readonly decisionId: string;
  readonly alertId: string;
  /** True when the row is never deliverable (shadow/outage suppression). */
  readonly suppressed: boolean;
}

/** A claimed outbox row, carrying its fencing token and lease bounds. */
export interface OutboxClaim {
  readonly outboxId: string;
  readonly decisionRef: string;
  readonly alertRef: string | null;
  readonly channel: string;
  readonly payloadHash: string;
  readonly fencingToken: number;
  readonly claimedAt: string;
  readonly claimExpiresAt: string;
  readonly attempts: number;
  readonly enqueuedAt: string;
}

export interface ClaimOutboxBatchInput {
  readonly workerId: string;
  readonly now?: string;
  /** Claim lease duration in milliseconds. */
  readonly leaseMs?: number;
  readonly limit?: number;
}

export interface DeliverClaimedInput {
  readonly workerId: string;
  readonly now?: string;
  /** Claims from `claimOutboxBatch`; omitted = every CLAIMED row this worker owns. */
  readonly claims?: readonly OutboxClaim[];
  /** Resolves the delivered payload; defaults to the alert/decision payload. */
  readonly resolvePayload?: (claim: OutboxClaim) => unknown | Promise<unknown>;
  /** Injected jitter source for the outbox retry backoff. */
  readonly random?: () => number;
  /** Attempt cap override for tests; defaults to the §25.8 outbox budget. */
  readonly maxAttempts?: number;
}

/** Per-row delivery outcome. `STALE` and `REFUSED_SUPPRESSED` never send. */
export type OutboxDeliveryOutcome =
  'SENT' | 'RETRY_SCHEDULED' | 'FAILED' | 'STALE' | 'REFUSED_SUPPRESSED' | 'NOT_FOUND';

export interface OutboxDeliveryOutcomeRow {
  readonly outboxId: string;
  readonly outcome: OutboxDeliveryOutcome;
  readonly attempts: number;
  /** Short diagnostic (error name/code only — never a payload or credential). */
  readonly detail: string | null;
}

export interface DeliverClaimedReport {
  readonly outcomes: readonly OutboxDeliveryOutcomeRow[];
  readonly sent: readonly string[];
  readonly retried: readonly string[];
  readonly failed: readonly string[];
  readonly stale: readonly string[];
  readonly refusedSuppressed: readonly string[];
}

interface OutboxRow {
  readonly outbox_id: string;
  readonly decision_ref: string;
  readonly alert_ref: string | null;
  readonly channel: string;
  readonly payload_hash: string;
  readonly status: string;
  readonly claim_owner: string | null;
  readonly claim_fencing_token: string | number | null;
  readonly claim_expires_at: string | null;
  readonly attempts: number;
  readonly enqueued_at: string;
  readonly claimed_at: string | null;
  readonly sent_at: string | null;
  readonly last_error: string | null;
}

interface RunShadowRow {
  readonly run_id: string;
  readonly shadow: boolean;
  readonly status: string;
}

function nowIso(input?: string): string {
  const now = input ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(now))) {
    throw new ForesiftError(ErrorCode.WF_OUTBOX_PAYLOAD_INVALID, 'now is not a timestamp', {
      now,
    });
  }
  return now;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ForesiftError(
      ErrorCode.WF_OUTBOX_PAYLOAD_INVALID,
      `outbox commit ${field} is required`,
      { field },
    );
  }
  return value;
}

function contentHash(payload: unknown, provided: string | undefined, field: string): string {
  if (payload === undefined) {
    throw new ForesiftError(
      ErrorCode.WF_OUTBOX_PAYLOAD_INVALID,
      `outbox commit ${field} payload is required`,
      { field },
    );
  }
  if (provided === undefined) return sha256Text(canonicalJson(payload));
  if (typeof provided !== 'string' || !HASH_PATTERN.test(provided)) {
    throw new ForesiftError(
      ErrorCode.WF_OUTBOX_PAYLOAD_INVALID,
      `outbox commit ${field} payloadHash must be a sha256 content address`,
      { field },
    );
  }
  return provided;
}

function addMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

function serialisePayload(payload: unknown): string {
  return JSON.stringify(payload);
}

async function readOutboxRow(
  engine: DatabaseEngine,
  outboxId: string,
): Promise<OutboxRow | undefined> {
  const result = await engine.query<OutboxRow>(
    `SELECT outbox_id, decision_ref, alert_ref, channel, payload_hash, status,
            claim_owner, claim_fencing_token, claim_expires_at, attempts,
            enqueued_at, claimed_at, sent_at, last_error
       FROM wf.notification_outbox WHERE outbox_id = $1`,
    [outboxId],
  );
  return result.rows[0];
}

/**
 * §26.5 commit boundary: decision + alert + outbox entry in ONE transaction.
 * Any failure rolls the whole unit back, so a committed outbox row always has
 * its decision and alert records.
 */
export async function commitDecisionWithOutbox(
  engine: DatabaseEngine,
  input: CommitDecisionWithOutboxInput,
): Promise<CommitDecisionWithOutboxResult> {
  const now = nowIso(input.now);
  const runId = requireText(input.runId, 'runId');
  const decisionId = requireText(input.decision.decisionId, 'decisionId');
  const decisionKind = requireText(input.decision.decisionKind, 'decisionKind');
  const alertId = requireText(input.alert.alertId, 'alertId');
  const alertClass = requireText(input.alert.alertClass, 'alertClass');
  const channel = requireText(input.outbox.channel, 'channel');
  const influence = input.influence ?? 'OPPORTUNITY_NOTIFICATION';
  const outcome = input.outcome ?? OutboxCommitOutcome.NORMAL;
  if (outcome !== OutboxCommitOutcome.NORMAL && outcome !== OutboxCommitOutcome.PROVIDER_OUTAGE) {
    throw new ForesiftError(ErrorCode.WF_OUTBOX_PAYLOAD_INVALID, 'unknown outbox commit outcome', {
      outcome: String(outcome),
    });
  }
  const decisionHash = contentHash(input.decision.payload, input.decision.payloadHash, 'decision');
  const alertHash = contentHash(input.alert.payload, input.alert.payloadHash, 'alert');
  const outboxId = input.outbox.outboxId ?? `wfo_${randomUUID()}`;
  const alertRef = input.outbox.alertRef === undefined ? alertId : input.outbox.alertRef;
  const outboxPayloadHash = input.outbox.payloadHash ?? alertHash;
  if (!HASH_PATTERN.test(outboxPayloadHash)) {
    throw new ForesiftError(
      ErrorCode.WF_OUTBOX_PAYLOAD_INVALID,
      'outbox payloadHash must be a sha256 content address',
      { field: 'outbox.payloadHash' },
    );
  }

  return engine.transaction(async (tx) => {
    const runResult = await tx.query<RunShadowRow>(
      `SELECT run_id, shadow, status FROM wf.runs WHERE run_id = $1`,
      [runId],
    );
    const run = runResult.rows[0];
    if (run === undefined) {
      throw new ForesiftError(ErrorCode.WF_RUN_NOT_FOUND, 'unknown run for decision commit', {
        runId,
      });
    }

    // Policy write-back is refused outright for a shadow run (FR-WF-008). An
    // opportunity notification is TAGGED, not refused: shadow-tagged rows are
    // evaluation data and are never deliverable.
    if (influence === 'POLICY_WRITE_BACK') {
      assertNoOpportunityInfluence({ runId, shadow: run.shadow }, influence);
    }
    let status: OutboxStatus = 'PENDING';
    if (shadowSuppressionFor({ runId, shadow: run.shadow }, influence) !== null) {
      status = 'SUPPRESSED_SHADOW';
    } else if (outcome === OutboxCommitOutcome.PROVIDER_OUTAGE) {
      status = 'SUPPRESSED_OUTAGE';
    }

    await tx.query(
      `INSERT INTO wf.decision_commits
         (decision_id, run_id, decision_kind, payload, payload_hash, committed_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [
        decisionId,
        runId,
        decisionKind,
        serialisePayload(input.decision.payload),
        decisionHash,
        now,
      ],
    );
    await tx.query(
      `INSERT INTO wf.alert_records
         (alert_id, decision_id, alert_class, payload, payload_hash, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [alertId, decisionId, alertClass, serialisePayload(input.alert.payload), alertHash, now],
    );
    await tx.query(
      `INSERT INTO wf.notification_outbox
         (outbox_id, decision_ref, alert_ref, channel, payload_hash, status, enqueued_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [outboxId, decisionId, alertRef, channel, outboxPayloadHash, status, now],
    );

    return {
      outboxId,
      status,
      decisionId,
      alertId,
      suppressed: status !== 'PENDING',
    };
  });
}

const CLAIM_OUTBOX_BATCH = `
    WITH candidates AS (
        SELECT outbox_id
          FROM wf.notification_outbox
         WHERE status = 'PENDING'
            OR (status = 'CLAIMED' AND claim_expires_at <= $2)
         ORDER BY enqueued_at, outbox_id
         LIMIT $4
         FOR UPDATE SKIP LOCKED
    )
    UPDATE wf.notification_outbox o
       SET status = 'CLAIMED',
           claim_owner = $1,
           claim_fencing_token = nextval('wf.wf_outbox_fencing_seq'),
           claimed_at = $2,
           claim_expires_at = $3
      FROM candidates c
     WHERE o.outbox_id = c.outbox_id
       AND (o.status = 'PENDING'
            OR (o.status = 'CLAIMED' AND o.claim_expires_at <= $2))
    RETURNING o.outbox_id, o.decision_ref, o.alert_ref, o.channel, o.payload_hash,
              o.claim_fencing_token, o.claimed_at, o.claim_expires_at, o.attempts,
              o.enqueued_at`;

/**
 * Atomically claim up to `limit` deliverable rows for `workerId`. PENDING rows
 * and orphaned CLAIMED rows (lease expired) are eligible; suppressed rows are
 * never eligible. Each claim allocates a fresh fencing token, so a previous
 * holder's token can never match again.
 */
export async function claimOutboxBatch(
  engine: DatabaseEngine,
  input: ClaimOutboxBatchInput,
): Promise<readonly OutboxClaim[]> {
  const workerId = requireText(input.workerId, 'workerId');
  const now = nowIso(input.now);
  const leaseMs = input.leaseMs ?? 30_000;
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new ForesiftError(
      ErrorCode.WF_OUTBOX_TRANSITION_INVALID,
      'claim lease must be a positive duration in milliseconds',
      { leaseMs: Number.isFinite(leaseMs) ? leaseMs : null },
    );
  }
  const limit = input.limit ?? 10;
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_BATCH_LIMIT) {
    throw new ForesiftError(
      ErrorCode.WF_OUTBOX_TRANSITION_INVALID,
      `claim limit must be an integer in 1..${MAX_BATCH_LIMIT}`,
      { limit: Number.isInteger(limit) ? limit : null },
    );
  }
  const claimExpiresAt = addMs(now, leaseMs);
  const result = await engine.query<{
    outbox_id: string;
    decision_ref: string;
    alert_ref: string | null;
    channel: string;
    payload_hash: string;
    claim_fencing_token: string | number;
    claimed_at: string;
    claim_expires_at: string;
    attempts: number;
    enqueued_at: string;
  }>(CLAIM_OUTBOX_BATCH, [workerId, now, claimExpiresAt, limit]);
  return result.rows.map((row) => ({
    outboxId: row.outbox_id,
    decisionRef: row.decision_ref,
    alertRef: row.alert_ref,
    channel: row.channel,
    payloadHash: row.payload_hash,
    fencingToken: Number(row.claim_fencing_token),
    claimedAt: row.claimed_at,
    claimExpiresAt: row.claim_expires_at,
    attempts: row.attempts,
    enqueuedAt: row.enqueued_at,
  }));
}

/** The default payload resolver: the alert payload, else the decision payload. */
async function defaultResolvePayload(engine: DatabaseEngine, claim: OutboxClaim): Promise<unknown> {
  if (claim.alertRef !== null) {
    const alert = await engine.query<{ payload: unknown }>(
      `SELECT payload FROM wf.alert_records WHERE alert_id = $1`,
      [claim.alertRef],
    );
    if (alert.rows[0] !== undefined) return alert.rows[0].payload;
  }
  const decision = await engine.query<{ payload: unknown }>(
    `SELECT payload FROM wf.decision_commits WHERE decision_id = $1`,
    [claim.decisionRef],
  );
  if (decision.rows[0] !== undefined) return decision.rows[0].payload;
  throw new ForesiftError(
    ErrorCode.WF_OUTBOX_PAYLOAD_INVALID,
    'outbox row references no resolvable payload',
    { outboxId: claim.outboxId, decisionRef: claim.decisionRef, alertRef: claim.alertRef },
  );
}

/**
 * True when the claim's owner AND fencing token are still the current, live
 * claim. A stale claim must never send.
 */
async function isClaimCurrent(
  engine: DatabaseEngine,
  claim: OutboxClaim,
  workerId: string,
  now: string,
): Promise<boolean> {
  const row = await readOutboxRow(engine, claim.outboxId);
  if (row === undefined) return false;
  if (row.status !== 'CLAIMED') return false;
  if (row.claim_owner !== workerId) return false;
  if (Number(row.claim_fencing_token) !== claim.fencingToken) return false;
  if (row.claim_expires_at === null) return false;
  return Date.parse(row.claim_expires_at) > Date.parse(now);
}

const MARK_SENT = `
    UPDATE wf.notification_outbox
       SET status = 'SENT', sent_at = $2, last_error = NULL
     WHERE outbox_id = $1
       AND status = 'CLAIMED'
       AND claim_owner = $3
       AND claim_fencing_token = $4
    RETURNING outbox_id`;

const MARK_RETRY = `
    UPDATE wf.notification_outbox
       SET status = $1,
           attempts = $2,
           claim_owner = NULL,
           claim_fencing_token = NULL,
           claim_expires_at = NULL,
           last_error = $3
     WHERE outbox_id = $4
       AND status = 'CLAIMED'
       AND claim_owner = $5
       AND claim_fencing_token = $6
    RETURNING outbox_id`;

/** Short, payload-free diagnostic text for the `last_error` column. */
function errorDiagnostic(error: unknown): string {
  // Only the error CLASS is retained: a channel adapter's message could echo a
  // provider response body, and credentials/provider payloads are never logged.
  if (error instanceof ForesiftError) return `${error.name}:${error.code}`;
  if (error instanceof Error) return error.name;
  return 'unknown channel failure';
}

/**
 * Deliver every claim this worker currently owns. Sends only from a current
 * CLAIMED row, with the outbox id as the channel idempotency key. A stale
 * claim, a suppressed row, or a missing row refuses to send.
 */
export async function deliverClaimed(
  engine: DatabaseEngine,
  channel: NotificationChannelPort,
  input: DeliverClaimedInput,
): Promise<DeliverClaimedReport> {
  const workerId = requireText(input.workerId, 'workerId');
  const now = nowIso(input.now);
  const random = input.random ?? Math.random;
  const resolvePayload =
    input.resolvePayload ?? ((claim: OutboxClaim) => defaultResolvePayload(engine, claim));

  let claims = input.claims;
  if (claims === undefined) {
    const result = await engine.query<{
      outbox_id: string;
      decision_ref: string;
      alert_ref: string | null;
      channel: string;
      payload_hash: string;
      claim_fencing_token: string | number;
      claimed_at: string;
      claim_expires_at: string;
      attempts: number;
      enqueued_at: string;
    }>(
      `SELECT outbox_id, decision_ref, alert_ref, channel, payload_hash,
              claim_fencing_token, claimed_at, claim_expires_at, attempts, enqueued_at
         FROM wf.notification_outbox
        WHERE status = 'CLAIMED' AND claim_owner = $1
        ORDER BY claimed_at, outbox_id`,
      [workerId],
    );
    claims = result.rows.map((row) => ({
      outboxId: row.outbox_id,
      decisionRef: row.decision_ref,
      alertRef: row.alert_ref,
      channel: row.channel,
      payloadHash: row.payload_hash,
      fencingToken: Number(row.claim_fencing_token),
      claimedAt: row.claimed_at,
      claimExpiresAt: row.claim_expires_at,
      attempts: row.attempts,
      enqueuedAt: row.enqueued_at,
    }));
  }

  const outcomes: OutboxDeliveryOutcomeRow[] = [];
  const sent: string[] = [];
  const retried: string[] = [];
  const failed: string[] = [];
  const stale: string[] = [];
  const refusedSuppressed: string[] = [];

  for (const claim of claims) {
    const row = await readOutboxRow(engine, claim.outboxId);
    if (row === undefined) {
      stale.push(claim.outboxId);
      outcomes.push({
        outboxId: claim.outboxId,
        outcome: 'NOT_FOUND',
        attempts: claim.attempts,
        detail: 'outbox row no longer exists',
      });
      continue;
    }
    const status = parseOutboxStatus(row.status);
    if (status === 'SUPPRESSED_SHADOW' || status === 'SUPPRESSED_OUTAGE') {
      // Never send from a suppressed row (FR-WF-008, AC-061).
      refusedSuppressed.push(claim.outboxId);
      outcomes.push({
        outboxId: claim.outboxId,
        outcome: 'REFUSED_SUPPRESSED',
        attempts: row.attempts,
        detail: `suppressed row status ${status} is never deliverable`,
      });
      continue;
    }
    if (!(await isClaimCurrent(engine, claim, workerId, now))) {
      // The owner/token is no longer current: refuse to send (AC-011).
      stale.push(claim.outboxId);
      outcomes.push({
        outboxId: claim.outboxId,
        outcome: 'STALE',
        attempts: row.attempts,
        detail: 'claim owner/token is no longer current',
      });
      continue;
    }

    let payload: unknown;
    try {
      payload = await resolvePayload(claim);
    } catch (error) {
      if (error instanceof NotificationChannelCrashError) throw error;
      const diagnostic = errorDiagnostic(error);
      const attempts = row.attempts + 1;
      const plan = planAttempt(OUTBOX_ERROR_CLASS, attempts, random);
      const nextStatus: OutboxStatus = plan.action === 'RETRY' ? 'PENDING' : 'FAILED';
      await engine.query(MARK_RETRY, [
        nextStatus,
        attempts,
        diagnostic,
        claim.outboxId,
        workerId,
        claim.fencingToken,
      ]);
      if (nextStatus === 'PENDING') {
        retried.push(claim.outboxId);
        outcomes.push({
          outboxId: claim.outboxId,
          outcome: 'RETRY_SCHEDULED',
          attempts,
          detail: diagnostic,
        });
      } else {
        failed.push(claim.outboxId);
        outcomes.push({
          outboxId: claim.outboxId,
          outcome: 'FAILED',
          attempts,
          detail: diagnostic,
        });
      }
      continue;
    }

    try {
      await channel.send({
        idempotencyKey: claim.outboxId,
        channel: row.channel,
        payload,
        payloadHash: row.payload_hash,
      });
    } catch (error) {
      if (error instanceof NotificationChannelCrashError) {
        // Simulated process death: leave the row CLAIMED so lease expiry makes
        // it re-claimable; the channel's idempotency collapses the replay.
        throw error;
      }
      const attempts = row.attempts + 1;
      const transient = isTransientChannelError(error);
      const plan = planAttempt(OUTBOX_ERROR_CLASS, attempts, random);
      const nextStatus: OutboxStatus =
        transient && (input.maxAttempts === undefined || attempts < input.maxAttempts)
          ? plan.action === 'RETRY'
            ? 'PENDING'
            : 'FAILED'
          : 'FAILED';
      const diagnostic = errorDiagnostic(error);
      const updated = await engine.query(MARK_RETRY, [
        nextStatus,
        attempts,
        diagnostic,
        claim.outboxId,
        workerId,
        claim.fencingToken,
      ]);
      if (updated.rows.length === 0) {
        stale.push(claim.outboxId);
        outcomes.push({
          outboxId: claim.outboxId,
          outcome: 'STALE',
          attempts,
          detail: 'claim changed while the send was failing',
        });
      } else if (nextStatus === 'PENDING') {
        retried.push(claim.outboxId);
        outcomes.push({
          outboxId: claim.outboxId,
          outcome: 'RETRY_SCHEDULED',
          attempts,
          detail: diagnostic,
        });
      } else {
        failed.push(claim.outboxId);
        outcomes.push({
          outboxId: claim.outboxId,
          outcome: 'FAILED',
          attempts,
          detail: diagnostic,
        });
      }
      continue;
    }

    const marked = await engine.query(MARK_SENT, [
      claim.outboxId,
      now,
      workerId,
      claim.fencingToken,
    ]);
    if (marked.rows.length === 0) {
      // The claim moved between verification and the SENT mark. The send may
      // have happened; the channel idempotency law keeps delivery exactly-once.
      stale.push(claim.outboxId);
      outcomes.push({
        outboxId: claim.outboxId,
        outcome: 'STALE',
        attempts: row.attempts,
        detail: 'claim changed before the SENT mark',
      });
      continue;
    }
    sent.push(claim.outboxId);
    outcomes.push({
      outboxId: claim.outboxId,
      outcome: 'SENT',
      attempts: row.attempts,
      detail: null,
    });
  }

  return {
    outcomes,
    sent,
    retried,
    failed,
    stale,
    refusedSuppressed,
  };
}
