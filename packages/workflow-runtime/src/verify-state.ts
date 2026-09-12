/**
 * Read-only workflow state verification — the recovery drill seam (T025,
 * FR-WF-002/003/006/007; PRD §34, AC-062, AC-260…264).
 *
 * RECOVERY-PACKAGE CONTRACT NOTE: this module ships NO drill tests. It exposes
 * the exact, read-only consistency queries the `g2-recovery-continuity` package
 * will wire into its AC-062 / AC-260…264 post-recovery drills. `WF_STATE_CHECKS`
 * below is the authoritative list of check names and `wf`-qualified table names;
 * the recovery planner may rely on those names and MUST NOT re-implement the
 * queries against a different table.
 *
 * Checks (each returns a count and is `ok` exactly when the count is zero):
 * - `orphaned_outbox_claims`  — `wf.notification_outbox` rows left CLAIMED past
 *   `claim_expires_at` (a crashed delivery worker);
 * - `unprocessed_trigger_inbox` — `wf.trigger_inbox` rows still RECEIVED/VERIFIED
 *   after the threshold (a stalled inbox consumer);
 * - `outbox_lag` — `wf.notification_outbox` PENDING rows older than the lag
 *   threshold (delivery falling behind the decision commit);
 * - `dead_letter_backlog` — OPEN `wf.dead_letters` rows requiring operator action;
 * - `orphaned_step_leases` — `wf.step_leases` rows unreleased past `expires_at`.
 *
 * Every query is read-only (`SELECT`/`COUNT`): the recovery package can run them
 * against a restored database without mutating it.
 *
 * Strictly read-only: this module observes durable workflow state; it can never
 * trade, custody, sign, handle keys, or submit a transaction.
 */
import { ErrorCode, ForesiftError } from '@foresift/domain';
import { type DatabaseEngine } from '@foresift/persistence';

/** Documented default: an inbox row older than this is "unprocessed". */
export const DEFAULT_INBOX_MAX_AGE_MS = 5 * 60 * 1000;
/** Documented default: a PENDING outbox row older than this is "lagging". */
export const DEFAULT_OUTBOX_MAX_LAG_MS = 5 * 60 * 1000;
/** Documented default: cap on returned sample rows per check. */
export const DEFAULT_WF_STATE_CHECK_LIMIT = 100;

export const WF_STATE_CHECKS = [
  {
    name: 'orphaned_outbox_claims',
    tables: ['wf.notification_outbox'],
    description: 'CLAIMED outbox rows whose claim lease expired without a SENT/FAILED mark',
  },
  {
    name: 'unprocessed_trigger_inbox',
    tables: ['wf.trigger_inbox'],
    description: 'RECEIVED/VERIFIED inbox rows older than the configured threshold',
  },
  {
    name: 'outbox_lag',
    tables: ['wf.notification_outbox'],
    description: 'PENDING outbox rows older than the configured lag threshold',
  },
  {
    name: 'dead_letter_backlog',
    tables: ['wf.dead_letters'],
    description: 'OPEN dead letters awaiting operator action',
  },
  {
    name: 'orphaned_step_leases',
    tables: ['wf.step_leases'],
    description: 'unreleased step leases past their expiry',
  },
] as const;

export type WfStateCheckName = (typeof WF_STATE_CHECKS)[number]['name'];

export interface WfStateCheckOptions {
  readonly now?: string;
  /** Inbox age threshold in milliseconds (default 5 min). */
  readonly inboxMaxAgeMs?: number;
  /** Outbox lag threshold in milliseconds (default 5 min). */
  readonly outboxMaxLagMs?: number;
  /** Maximum sample rows returned per check (default 100). */
  readonly limit?: number;
}

export interface WfStateFinding {
  readonly check: WfStateCheckName;
  /** True exactly when `count` is zero. */
  readonly ok: boolean;
  readonly count: number;
  readonly tables: readonly string[];
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface OrphanedOutboxClaim {
  readonly outboxId: string;
  readonly claimOwner: string | null;
  readonly claimExpiresAt: string | null;
  readonly attempts: number;
}

export interface UnprocessedInboxRow {
  readonly inboxId: string;
  readonly scheduleId: string;
  readonly status: string;
  readonly receivedAt: string;
}

export interface OutboxLagRow {
  readonly outboxId: string;
  readonly status: string;
  readonly enqueuedAt: string;
  readonly attempts: number;
}

export interface OpenDeadLetterRow {
  readonly deadLetterId: string;
  readonly runId: string;
  readonly errorClass: string;
  readonly openedAt: string;
}

export interface OrphanedStepLease {
  readonly resourceKey: string;
  readonly owner: string;
  readonly expiresAt: string;
}

function resolveOptions(options: WfStateCheckOptions): {
  now: string;
  inboxMaxAgeMs: number;
  outboxMaxLagMs: number;
  limit: number;
} {
  const now = options.now ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(now))) {
    throw new ForesiftError(ErrorCode.WF_STATE_CHECK_UNKNOWN, 'now is not a timestamp', { now });
  }
  const inboxMaxAgeMs = options.inboxMaxAgeMs ?? DEFAULT_INBOX_MAX_AGE_MS;
  const outboxMaxLagMs = options.outboxMaxLagMs ?? DEFAULT_OUTBOX_MAX_LAG_MS;
  const limit = options.limit ?? DEFAULT_WF_STATE_CHECK_LIMIT;
  if (!Number.isFinite(inboxMaxAgeMs) || inboxMaxAgeMs < 0) {
    throw new ForesiftError(
      ErrorCode.WF_STATE_CHECK_UNKNOWN,
      'inboxMaxAgeMs must be a non-negative duration',
      { inboxMaxAgeMs: Number.isFinite(inboxMaxAgeMs) ? inboxMaxAgeMs : null },
    );
  }
  if (!Number.isFinite(outboxMaxLagMs) || outboxMaxLagMs < 0) {
    throw new ForesiftError(
      ErrorCode.WF_STATE_CHECK_UNKNOWN,
      'outboxMaxLagMs must be a non-negative duration',
      { outboxMaxLagMs: Number.isFinite(outboxMaxLagMs) ? outboxMaxLagMs : null },
    );
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ForesiftError(ErrorCode.WF_STATE_CHECK_UNKNOWN, 'limit must be a positive integer', {
      limit: Number.isInteger(limit) ? limit : null,
    });
  }
  return { now, inboxMaxAgeMs, outboxMaxLagMs, limit };
}

function cutoff(now: string, ageMs: number): string {
  return new Date(Date.parse(now) - ageMs).toISOString();
}

async function countRows(engine: DatabaseEngine, sql: string, params: readonly unknown[]) {
  const result = await engine.query<{ count: string | number }>(sql, params);
  return Number(result.rows[0]?.count ?? 0);
}

/** CLAIMED outbox rows whose claim lease expired at or before `now`. */
export async function findOrphanedOutboxClaims(
  engine: DatabaseEngine,
  options: WfStateCheckOptions = {},
): Promise<readonly OrphanedOutboxClaim[]> {
  const { now, limit } = resolveOptions(options);
  const result = await engine.query<{
    outbox_id: string;
    claim_owner: string | null;
    claim_expires_at: string | null;
    attempts: number;
  }>(
    `SELECT outbox_id, claim_owner, claim_expires_at, attempts
       FROM wf.notification_outbox
      WHERE status = 'CLAIMED' AND claim_expires_at IS NOT NULL AND claim_expires_at <= $1
      ORDER BY claim_expires_at, outbox_id
      LIMIT $2`,
    [now, limit],
  );
  return result.rows.map((row) => ({
    outboxId: row.outbox_id,
    claimOwner: row.claim_owner,
    claimExpiresAt: row.claim_expires_at,
    attempts: row.attempts,
  }));
}

/** RECEIVED/VERIFIED inbox rows older than the threshold. */
export async function findUnprocessedTriggerInbox(
  engine: DatabaseEngine,
  options: WfStateCheckOptions = {},
): Promise<readonly UnprocessedInboxRow[]> {
  const { now, inboxMaxAgeMs, limit } = resolveOptions(options);
  const receivedBefore = cutoff(now, inboxMaxAgeMs);
  const result = await engine.query<{
    inbox_id: string;
    schedule_id: string;
    status: string;
    received_at: string;
  }>(
    `SELECT inbox_id, schedule_id, status, received_at
       FROM wf.trigger_inbox
      WHERE status IN ('RECEIVED', 'VERIFIED') AND received_at <= $1
      ORDER BY received_at, inbox_id
      LIMIT $2`,
    [receivedBefore, limit],
  );
  return result.rows.map((row) => ({
    inboxId: row.inbox_id,
    scheduleId: row.schedule_id,
    status: row.status,
    receivedAt: row.received_at,
  }));
}

/** PENDING outbox rows older than the lag threshold. */
export async function findOutboxLag(
  engine: DatabaseEngine,
  options: WfStateCheckOptions = {},
): Promise<readonly OutboxLagRow[]> {
  const { now, outboxMaxLagMs, limit } = resolveOptions(options);
  const enqueuedBefore = cutoff(now, outboxMaxLagMs);
  const result = await engine.query<{
    outbox_id: string;
    status: string;
    enqueued_at: string;
    attempts: number;
  }>(
    `SELECT outbox_id, status, enqueued_at, attempts
       FROM wf.notification_outbox
      WHERE status = 'PENDING' AND enqueued_at <= $1
      ORDER BY enqueued_at, outbox_id
      LIMIT $2`,
    [enqueuedBefore, limit],
  );
  return result.rows.map((row) => ({
    outboxId: row.outbox_id,
    status: row.status,
    enqueuedAt: row.enqueued_at,
    attempts: row.attempts,
  }));
}

/** OPEN dead letters awaiting operator action. */
export async function findOpenDeadLetters(
  engine: DatabaseEngine,
  options: WfStateCheckOptions = {},
): Promise<readonly OpenDeadLetterRow[]> {
  const { limit } = resolveOptions(options);
  const result = await engine.query<{
    dead_letter_id: string;
    run_id: string;
    error_class: string;
    opened_at: string;
  }>(
    `SELECT dead_letter_id, run_id, error_class, opened_at
       FROM wf.dead_letters
      WHERE status = 'OPEN'
      ORDER BY opened_at, dead_letter_id
      LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    deadLetterId: row.dead_letter_id,
    runId: row.run_id,
    errorClass: row.error_class,
    openedAt: row.opened_at,
  }));
}

/** Unreleased step leases past their expiry. */
export async function findOrphanedStepLeases(
  engine: DatabaseEngine,
  options: WfStateCheckOptions = {},
): Promise<readonly OrphanedStepLease[]> {
  const { now, limit } = resolveOptions(options);
  const result = await engine.query<{
    resource_key: string;
    owner: string;
    expires_at: string;
  }>(
    `SELECT resource_key, owner, expires_at
       FROM wf.step_leases
      WHERE released_at IS NULL AND expires_at <= $1
      ORDER BY expires_at, resource_key
      LIMIT $2`,
    [now, limit],
  );
  return result.rows.map((row) => ({
    resourceKey: row.resource_key,
    owner: row.owner,
    expiresAt: row.expires_at,
  }));
}

function checkMeta(name: WfStateCheckName): { tables: readonly string[]; description: string } {
  const meta = WF_STATE_CHECKS.find((c) => c.name === name);
  if (meta === undefined) {
    throw new ForesiftError(ErrorCode.WF_STATE_CHECK_UNKNOWN, 'unknown wf state check', { name });
  }
  return { tables: meta.tables, description: meta.description };
}

/**
 * Run one documented check. Each check returns a sample of the offending rows
 * (capped by `limit`) plus the exact count of offending rows.
 */
export async function runWfStateCheck(
  engine: DatabaseEngine,
  name: WfStateCheckName,
  options: WfStateCheckOptions = {},
): Promise<WfStateFinding> {
  const meta = checkMeta(name);
  const { now, inboxMaxAgeMs, outboxMaxLagMs, limit } = resolveOptions(options);
  switch (name) {
    case 'orphaned_outbox_claims': {
      const samples = await findOrphanedOutboxClaims(engine, options);
      const count = await countRows(
        engine,
        `SELECT count(*) AS count FROM wf.notification_outbox
          WHERE status = 'CLAIMED' AND claim_expires_at IS NOT NULL AND claim_expires_at <= $1`,
        [now],
      );
      return {
        check: name,
        ok: count === 0,
        count,
        tables: meta.tables,
        detail: { description: meta.description, limit, samples },
      };
    }
    case 'unprocessed_trigger_inbox': {
      const samples = await findUnprocessedTriggerInbox(engine, options);
      const count = await countRows(
        engine,
        `SELECT count(*) AS count FROM wf.trigger_inbox
          WHERE status IN ('RECEIVED', 'VERIFIED') AND received_at <= $1`,
        [cutoff(now, inboxMaxAgeMs)],
      );
      return {
        check: name,
        ok: count === 0,
        count,
        tables: meta.tables,
        detail: { description: meta.description, limit, inboxMaxAgeMs, samples },
      };
    }
    case 'outbox_lag': {
      const samples = await findOutboxLag(engine, options);
      const count = await countRows(
        engine,
        `SELECT count(*) AS count FROM wf.notification_outbox
          WHERE status = 'PENDING' AND enqueued_at <= $1`,
        [cutoff(now, outboxMaxLagMs)],
      );
      return {
        check: name,
        ok: count === 0,
        count,
        tables: meta.tables,
        detail: { description: meta.description, limit, outboxMaxLagMs, samples },
      };
    }
    case 'dead_letter_backlog': {
      const samples = await findOpenDeadLetters(engine, options);
      const count = await countRows(
        engine,
        `SELECT count(*) AS count FROM wf.dead_letters WHERE status = 'OPEN'`,
        [],
      );
      return {
        check: name,
        ok: count === 0,
        count,
        tables: meta.tables,
        detail: { description: meta.description, limit, samples },
      };
    }
    case 'orphaned_step_leases': {
      const samples = await findOrphanedStepLeases(engine, options);
      const count = await countRows(
        engine,
        `SELECT count(*) AS count FROM wf.step_leases
          WHERE released_at IS NULL AND expires_at <= $1`,
        [now],
      );
      return {
        check: name,
        ok: count === 0,
        count,
        tables: meta.tables,
        detail: { description: meta.description, limit, samples },
      };
    }
    default: {
      throw new ForesiftError(ErrorCode.WF_STATE_CHECK_UNKNOWN, 'unknown wf state check', {
        name: String(name),
      });
    }
  }
}

/** Run every documented check, in `WF_STATE_CHECKS` order. */
export async function runAllWfStateChecks(
  engine: DatabaseEngine,
  options: WfStateCheckOptions = {},
): Promise<readonly WfStateFinding[]> {
  const findings: WfStateFinding[] = [];
  for (const check of WF_STATE_CHECKS) {
    findings.push(await runWfStateCheck(engine, check.name, options));
  }
  return findings;
}
