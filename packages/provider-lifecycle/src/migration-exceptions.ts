/**
 * Time-bounded migration exceptions (FR-PROV-003; §15.4 rule 1 escape hatch).
 *
 * An exception re-permits NEW use of a deprecated operation while a recorded
 * replacement plan is executed. Fail-closed rules:
 *   * grants are bounded: exception_expires_at must be strictly after the
 *     grant instant (SQL CHECK) and after the injected-clock NOW at grant
 *     time — a backdated exception is nonsense and refuses;
 *   * validity is evaluated AT USE TIME against the injected clock only;
 *     the moment an exception lapses it authorizes nothing again (no grace
 *     windows anywhere);
 *   * revocation is an explicit column write; revoked exceptions authorize
 *     nothing regardless of their window.
 */
import { fixedClock, utcTimestamp, type ClockPort } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import { randomUUID } from 'node:crypto';
import {
  MigrationExceptionRecordSchema,
  type MigrationExceptionRecord,
} from './schemas.ts';
import { MigrationExceptionError, ProvErrorCode } from './errors.ts';

export interface MigrationExceptionsOptions {
  readonly engine: DatabaseEngine;
  /** Injected clock (Constitution XI) — never the wall clock. */
  readonly clock?: ClockPort;
}

export interface GrantExceptionInput {
  readonly providerId: string;
  readonly operationId: string;
  /** Named human/accountable approver — anonymous grants refuse. */
  readonly approver: string;
  /** Reference to the recorded replacement/migration plan. */
  readonly replacementPlanRef: string;
  readonly replacementOperationId?: string;
  /** Hard expiry; must be strictly after the grant instant. */
  readonly exceptionExpiresAt: string;
  /** At least one preserved evidence reference (SQL CHECK enforces >= 1). */
  readonly evidenceRefs: readonly string[];
}

interface ExceptionRow {
  exception_id: string;
  provider_id: string;
  operation_id: string;
  approver: string;
  replacement_plan_ref: string;
  replacement_operation_id: string | null;
  granted_at: Date | string;
  exception_expires_at: Date | string;
  revoked_at: Date | string | null;
  evidence_refs: unknown;
}

function iso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().replace('.000Z', 'Z');
}

function rowToRecord(row: ExceptionRow): MigrationExceptionRecord {
  return MigrationExceptionRecordSchema.parse({
    exceptionId: row.exception_id,
    providerId: row.provider_id,
    operationId: row.operation_id,
    approver: row.approver,
    replacementPlanRef: row.replacement_plan_ref,
    replacementOperationId: row.replacement_operation_id,
    grantedAt: iso(row.granted_at),
    exceptionExpiresAt: iso(row.exception_expires_at),
    revokedAt: row.revoked_at === null ? null : iso(row.revoked_at),
    evidenceRefs: row.evidence_refs,
  });
}

export class MigrationExceptions {
  private readonly engine: DatabaseEngine;
  private readonly clock: ClockPort;

  constructor(options: MigrationExceptionsOptions) {
    this.engine = options.engine;
    this.clock = options.clock ?? fixedClock(utcTimestamp('1970-01-01T00:00:00Z'));
  }

  /** Grant a bounded exception. Backdated or evidence-free grants refuse. */
  async grant(input: GrantExceptionInput): Promise<MigrationExceptionRecord> {
    if (input.evidenceRefs.length === 0 || input.evidenceRefs.some((r) => r.trim() === '')) {
      throw new MigrationExceptionError(
        'an exception grant requires at least one non-empty evidence reference',
        {},
        ProvErrorCode.PROV_EXCEPTION_WINDOW_INVALID,
      );
    }
    const now = this.clock.now();
    const expiresAt = utcTimestamp(input.exceptionExpiresAt);
    if (expiresAt <= now) {
      throw new MigrationExceptionError(
        'exception expiry must be strictly after the grant instant',
        { exceptionExpiresAt: expiresAt, grantedAt: now },
        ProvErrorCode.PROV_EXCEPTION_WINDOW_INVALID,
      );
    }
    const exceptionId = `exc-${randomUUID()}`;
    const inserted = await this.engine.query<ExceptionRow>(
      `INSERT INTO prov.prov_migration_exceptions (
         exception_id, provider_id, operation_id, approver,
         replacement_plan_ref, replacement_operation_id,
         granted_at, exception_expires_at, evidence_refs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       RETURNING *`,
      [
        exceptionId,
        input.providerId,
        input.operationId,
        input.approver,
        input.replacementPlanRef,
        input.replacementOperationId ?? null,
        now,
        expiresAt,
        JSON.stringify([...input.evidenceRefs]),
      ],
    );
    const row = inserted.rows[0];
    if (row === undefined) {
      throw new MigrationExceptionError('exception grant returned no row', {});
    }
    return rowToRecord(row);
  }

  /** Revoke immediately: the exception authorizes nothing from this instant. */
  async revoke(exceptionId: string): Promise<MigrationExceptionRecord> {
    const updated = await this.engine.query<ExceptionRow>(
      `UPDATE prov.prov_migration_exceptions SET revoked_at = $2
       WHERE exception_id = $1 RETURNING *`,
      [exceptionId, this.clock.now()],
    );
    const row = updated.rows[0];
    if (row === undefined) {
      throw new MigrationExceptionError(
        `exception not found: ${exceptionId}`,
        { exceptionId },
        ProvErrorCode.PROV_EXCEPTION_UNKNOWN,
      );
    }
    return rowToRecord(row);
  }

  /**
   * Use-time validity evaluation (the ONLY question consumers may ask):
   * un-revoked AND strictly unexpired at the injected-clock instant. There
   * is deliberately no method that returns "how long is left".
   */
  async findValid(
    providerId: string,
    operationId: string,
  ): Promise<MigrationExceptionRecord | undefined> {
    const rows = await this.engine.query<ExceptionRow>(
      `SELECT * FROM prov.prov_migration_exceptions
       WHERE provider_id = $1 AND operation_id = $2
         AND revoked_at IS NULL
         AND exception_expires_at > $3
       ORDER BY exception_expires_at DESC`,
      [providerId, operationId, this.clock.now()],
    );
    const row = rows.rows[0];
    return row === undefined ? undefined : rowToRecord(row);
  }

  /** Full history for audit reads (including lapsed and revoked rows). */
  async list(providerId: string, operationId: string): Promise<MigrationExceptionRecord[]> {
    const rows = await this.engine.query<ExceptionRow>(
      `SELECT * FROM prov.prov_migration_exceptions
       WHERE provider_id = $1 AND operation_id = $2
       ORDER BY granted_at ASC`,
      [providerId, operationId],
    );
    return rows.rows.map(rowToRecord);
  }
}
