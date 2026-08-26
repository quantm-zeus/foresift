/**
 * Time-bounded migration exceptions (FR-PROV-003; AC-270 negative paths).
 *
 * An exception authorizes a deprecated operation ONLY while BOTH hold at the
 * use-time injected instant: not revoked, and `exception_expires_at > now`.
 * There are NO grace windows — the moment an exception lapses it re-blocks,
 * automatically, because validity is always evaluated against the clock.
 */
import type { DatabaseEngine } from '@foresift/persistence';
import type { UtcTimestamp } from '@foresift/domain';
import { MigrationExceptionError, ProvErrorCode } from './errors.ts';
import type { OperationRef } from './operation-registry.ts';

export interface MigrationException {
  readonly exceptionId: string;
  readonly ref: OperationRef;
  readonly approver: string;
  readonly replacementPlanRef: string;
  readonly reason: string;
  readonly createdAt: UtcTimestamp;
  readonly exceptionExpiresAt: UtcTimestamp;
  readonly revokedAt: UtcTimestamp | null;
}

interface ExceptionRow {
  exception_id: string;
  provider_id: string;
  operation_id: string;
  operation_version: string;
  approver: string;
  replacement_plan_ref: string;
  reason: string;
  created_at: Date | string;
  exception_expires_at: Date | string;
  revoked_at: Date | string | null;
}

function normalize(value: Date | string | null): UtcTimestamp | null {
  if (value === null) return null;
  if (typeof value === 'string') return value as UtcTimestamp;
  return value.toISOString().replace('.000Z', 'Z') as UtcTimestamp;
}

export class MigrationExceptions {
  private readonly engine: DatabaseEngine;

  constructor(engine: DatabaseEngine) {
    this.engine = engine;
  }

  async grant(input: {
    readonly exceptionId: string;
    readonly ref: OperationRef;
    readonly approver: string;
    readonly replacementPlanRef: string;
    readonly reason: string;
    readonly createdAt: UtcTimestamp;
    readonly expiresAt: UtcTimestamp;
  }): Promise<MigrationException> {
    if (!(input.expiresAt > input.createdAt)) {
      throw new MigrationExceptionError(
        'exception window invalid: expiry must be strictly after creation',
        { exceptionId: input.exceptionId },
        ProvErrorCode.PROV_MIGRATION_EXCEPTION_WINDOW_INVALID,
      );
    }
    await this.engine.query(
      `INSERT INTO prov.prov_migration_exceptions (
         exception_id, provider_id, operation_id, operation_version, approver,
         replacement_plan_ref, reason, created_at, exception_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.exceptionId,
        input.ref.providerId,
        input.ref.operationId,
        input.ref.version,
        input.approver,
        input.replacementPlanRef,
        input.reason,
        input.createdAt,
        input.expiresAt,
      ],
    );
    return {
      exceptionId: input.exceptionId,
      ref: input.ref,
      approver: input.approver,
      replacementPlanRef: input.replacementPlanRef,
      reason: input.reason,
      createdAt: input.createdAt,
      exceptionExpiresAt: input.expiresAt,
      revokedAt: null,
    };
  }

  async revoke(exceptionId: string, revokedAt: UtcTimestamp, revokedBy: string): Promise<void> {
    const updated = await this.engine.query<{ exception_id: string }>(
      'UPDATE prov.prov_migration_exceptions SET revoked_at = $2, revoked_by = $3 WHERE exception_id = $1 AND revoked_at IS NULL RETURNING exception_id',
      [exceptionId, revokedAt, revokedBy],
    );
    if (updated.rows.length === 0) {
      throw new MigrationExceptionError(
        `exception ${exceptionId} is unknown or already revoked`,
        { exceptionId },
        ProvErrorCode.PROV_MIGRATION_EXCEPTION_UNKNOWN,
      );
    }
  }

  /**
   * Use-time validity. Unknown / revoked / expired all refuse with distinct
   * typed codes; the boundary is strict (`expires_at > now`) — fail closed.
   */
  async assertValid(exceptionId: string, at: UtcTimestamp): Promise<MigrationException> {
    const rows = await this.engine.query<ExceptionRow>(
      'SELECT * FROM prov.prov_migration_exceptions WHERE exception_id = $1',
      [exceptionId],
    );
    const row = rows.rows[0];
    if (row === undefined) {
      throw new MigrationExceptionError(
        `migration exception ${exceptionId} does not exist`,
        { exceptionId },
        ProvErrorCode.PROV_MIGRATION_EXCEPTION_UNKNOWN,
      );
    }
    if (row.revoked_at !== null) {
      throw new MigrationExceptionError(
        `migration exception ${exceptionId} was revoked and can authorize nothing`,
        { exceptionId },
        ProvErrorCode.PROV_MIGRATION_EXCEPTION_REVOKED,
      );
    }
    const expiresAt = normalize(row.exception_expires_at)!;
    if (!(expiresAt > at)) {
      throw new MigrationExceptionError(
        `migration exception ${exceptionId} lapsed at ${expiresAt} (now ${at}); no grace window exists`,
        { exceptionId, expiresAt },
        ProvErrorCode.PROV_MIGRATION_EXCEPTION_EXPIRED,
      );
    }
    return {
      exceptionId: row.exception_id,
      ref: {
        providerId: row.provider_id,
        operationId: row.operation_id,
        version: row.operation_version,
      },
      approver: row.approver,
      replacementPlanRef: row.replacement_plan_ref,
      reason: row.reason,
      createdAt: normalize(row.created_at)!,
      exceptionExpiresAt: expiresAt,
      revokedAt: normalize(row.revoked_at),
    };
  }

  /** Any UNREVOKED, unexpired exception for this exact operation version? */
  async findValidForOperation(
    ref: OperationRef,
    at: UtcTimestamp,
  ): Promise<MigrationException | undefined> {
    const rows = await this.engine.query<{ exception_id: string }>(
      `SELECT exception_id FROM prov.prov_migration_exceptions
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
         AND revoked_at IS NULL AND exception_expires_at > $4`,
      [ref.providerId, ref.operationId, ref.version, at],
    );
    const id = rows.rows[0]?.exception_id;
    return id === undefined ? undefined : this.assertValid(id, at);
  }
}
