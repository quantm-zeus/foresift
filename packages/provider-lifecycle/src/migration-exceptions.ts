/**
 * Time-bounded migration exceptions (FR-PROV-003; T113) — the narrow,
 * explicit escape hatch around the deprecation rules.
 *
 * Fail-closed semantics:
 *   * an exception exists only WITH an approver, a reason, and an APPROVED
 *     replacement plan (validated shape; plan id stored alongside);
 *   * expiry is evaluated at USE time against the injected clock — a lapsed
 *     exception authorizes nothing from that instant on, with NO grace
 *     window and no sweep dependency;
 *   * at most ONE active exception per operation version (partial unique
 *     index in g0_prov_0003); revocation completes with actor + instant.
 */
import type { DatabaseEngine } from '@foresift/persistence';
import type { ClockPort, UtcTimestamp } from '@foresift/domain';
import { ReplacementPlanSchema, type ReplacementPlan } from './vocabulary.ts';
import { MigrationExceptionError, ProvErrorCode } from './errors.ts';
import type { OperationTarget } from './lifecycle-machine.ts';

export interface GrantExceptionInput {
  readonly target: OperationTarget;
  readonly approver: string;
  readonly reason: string;
  /** APPROVED replacement plan bound to the exception (FR-PROV-003). */
  readonly replacementPlan: ReplacementPlan;
  readonly expiresAt: UtcTimestamp;
}

export interface MigrationExceptionRecord {
  readonly exceptionId: string;
  readonly target: OperationTarget;
  readonly approver: string;
  readonly reason: string;
  readonly replacementPlanId: string;
  readonly replacementPlan: ReplacementPlan | null;
  readonly createdAt: string;
  readonly exceptionExpiresAt: string;
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
}

interface ExceptionRow {
  exception_id: string;
  provider_id: string;
  operation_id: string;
  operation_version: string;
  approver: string;
  reason: string;
  replacement_plan_id: string;
  replacement_plan: unknown;
  created_at: Date | string;
  exception_expires_at: Date | string;
  revoked_at: Date | string | null;
  revoked_by: string | null;
}

function iso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}

function rowToRecord(row: ExceptionRow): MigrationExceptionRecord {
  const planParsed = ReplacementPlanSchema.safeParse(row.replacement_plan);
  return {
    exceptionId: row.exception_id,
    target: {
      providerId: row.provider_id,
      operationId: row.operation_id,
      version: row.operation_version,
    },
    approver: row.approver,
    reason: row.reason,
    replacementPlanId: row.replacement_plan_id,
    replacementPlan: planParsed.success ? planParsed.data : null,
    createdAt: iso(row.created_at),
    exceptionExpiresAt: iso(row.exception_expires_at),
    revokedAt: row.revoked_at === null ? null : iso(row.revoked_at),
    revokedBy: row.revoked_by,
  };
}

export class MigrationExceptions {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly clock: ClockPort,
  ) {}

  /**
   * Grants one time-bounded exception. Refuses when the window does not lie
   * strictly in the future, the plan is not APPROVED, or another active
   * exception already covers this operation version.
   */
  async grant(input: GrantExceptionInput): Promise<{ exceptionId: string }> {
    const plan = ReplacementPlanSchema.parse(input.replacementPlan);
    if (plan.status !== 'APPROVED') {
      throw new MigrationExceptionError(
        `replacement plan ${plan.planId} is ${plan.status}; exceptions require an APPROVED plan`,
        { planId: plan.planId, status: plan.status },
        ProvErrorCode.PROV_MIGRATION_EXCEPTION_WINDOW_INVALID,
      );
    }
    if (input.approver.trim().length === 0 || input.reason.trim().length === 0) {
      throw new MigrationExceptionError(
        'an exception requires a named approver and a non-empty reason',
        {},
        ProvErrorCode.PROV_MIGRATION_EXCEPTION_WINDOW_INVALID,
      );
    }
    if (new Date(input.expiresAt).getTime() <= this.clock.nowEpochMs()) {
      throw new MigrationExceptionError(
        `exception window invalid: expiresAt ${input.expiresAt} must lie strictly after the current instant`,
        { expiresAt: input.expiresAt },
        ProvErrorCode.PROV_MIGRATION_EXCEPTION_WINDOW_INVALID,
      );
    }

    // Deterministic id → grant retries resolve to the SAME row.
    const exceptionId = Buffer.from(
      [
        input.target.providerId,
        input.target.operationId,
        input.target.version,
        plan.planId,
        input.expiresAt,
      ].join('|'),
      'utf8',
    ).toString('base64url');

    try {
      await this.engine.query(
        `INSERT INTO prov.prov_migration_exceptions (
           exception_id, provider_id, operation_id, operation_version,
           approver, reason, replacement_plan_id, replacement_plan,
           created_at, exception_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
        [
          exceptionId,
          input.target.providerId,
          input.target.operationId,
          input.target.version,
          input.approver,
          input.reason,
          plan.planId,
          JSON.stringify(plan),
          this.clock.now(),
          input.expiresAt,
        ],
      );
    } catch (error) {
      // Only a UNIQUE violation can mean one of the two fences: duplicate
      // deterministic id (identical retry — allowed) or the single-active
      // partial index for this version (refusal). Any other failure (FK,
      // CHECK, connectivity) is genuine and must surface as itself.
      const pgCode = (error as { code?: string }).code;
      const isUniqueViolation = pgCode === '23505' || /duplicate key value/i.test(String(error));
      if (!isUniqueViolation) throw error;
      const existing = await this.engine.query<ExceptionRow>(
        'SELECT * FROM prov.prov_migration_exceptions WHERE exception_id = $1',
        [exceptionId],
      );
      if (existing.rows.length === 1) {
        return { exceptionId };
      }
      throw new MigrationExceptionError(
        `${input.target.providerId}/${input.target.operationId}@${input.target.version} already has an active migration exception`,
        { ...input.target },
        ProvErrorCode.PROV_MIGRATION_EXCEPTION_CONFLICT,
      );
    }
    return { exceptionId };
  }

  /**
   * Revokes an exception. Revoking an already-revoked exception with the same
   * actor resolves idempotently; a DIFFERENT actor refuses (fail-closed).
   */
  async revoke(exceptionId: string, revokedBy: string): Promise<void> {
    const rows = await this.engine.query<ExceptionRow>(
      'SELECT * FROM prov.prov_migration_exceptions WHERE exception_id = $1',
      [exceptionId],
    );
    const row = rows.rows[0];
    if (row === undefined) {
      throw new MigrationExceptionError(
        `migration exception ${exceptionId} is unknown`,
        { exceptionId },
        ProvErrorCode.PROV_MIGRATION_EXCEPTION_UNKNOWN,
      );
    }
    if (row.revoked_at !== null) {
      if (row.revoked_by === revokedBy) return; // same revocation replayed
      throw new MigrationExceptionError(
        `migration exception ${exceptionId} was already revoked by ${row.revoked_by}`,
        { exceptionId, revokedBy: row.revoked_by },
        ProvErrorCode.PROV_MIGRATION_EXCEPTION_REVOKED,
      );
    }
    await this.engine.query(
      'UPDATE prov.prov_migration_exceptions SET revoked_at = $2, revoked_by = $3 WHERE exception_id = $1',
      [exceptionId, this.clock.now(), revokedBy],
    );
  }

  /**
   * The active exception for an operation version, evaluated AT USE TIME:
   * never-revoked AND not yet lapsed against the injected clock. Lapsed or
   * revoked rows are invisible here — callers cannot accidentally rely on them.
   */
  async findActive(target: OperationTarget): Promise<MigrationExceptionRecord | null> {
    const rows = await this.engine.query<ExceptionRow>(
      `SELECT * FROM prov.prov_migration_exceptions
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
         AND revoked_at IS NULL AND exception_expires_at > $4
       ORDER BY created_at DESC LIMIT 1`,
      [target.providerId, target.operationId, target.version, this.clock.now()],
    );
    const row = rows.rows[0];
    return row === undefined ? null : rowToRecord(row);
  }

  /** Use-time gate: throws unless a currently-valid exception exists. */
  async assertValidForUse(target: OperationTarget): Promise<MigrationExceptionRecord> {
    const active = await this.findActive(target);
    if (active === null) {
      throw new MigrationExceptionError(
        `no valid migration exception covers ${target.providerId}/${target.operationId}@${target.version} at the current instant (lapsed or absent — fail-closed)`,
        { ...target },
        ProvErrorCode.PROV_MIGRATION_EXCEPTION_EXPIRED,
      );
    }
    return active;
  }
}
