/**
 * Security incident records over sec.security_incidents (FR-SEC-011, §34,
 * §35.9/§35.11 duties; AC-259 coupling).
 *
 * Containment advances monotonically OPEN → CONTAINED → RECOVERY_VERIFIED →
 * RESOLVED. Resolution is fail-closed: it requires the resolution instant AND
 * recovery verification AND a postmortem reference AND a regression-test
 * reference — an incident cannot quietly disappear without its evidence trail.
 * Evidence references are preserved verbatim (append-only jsonb merge).
 */
import type { UtcTimestamp } from '@foresift/domain';
import {
  IncidentContainmentStateSchema,
  SecurityIncidentRecordSchema,
  type IncidentContainmentState,
  type IncidentSeverity,
} from '@foresift/shared-schemas';
import { IncidentError, SecErrorCode } from './errors.ts';

export interface OpenIncidentInput {
  readonly incidentId: string;
  readonly kind:
    | 'AUDIT_CHAIN_FAILURE'
    | 'CREDENTIAL_COMPROMISE'
    | 'INTRUSION_SUSPECTED'
    | 'DATA_LEAKAGE'
    | 'DEPENDENCY_COMPROMISE'
    | 'ABUSE_CAMPAIGN'
    | 'OTHER';
  readonly severity: IncidentSeverity;
  readonly owner: string;
  readonly openedAt: UtcTimestamp;
  /** At least one preserved evidence reference (SQL CHECK enforces >= 1). */
  readonly evidenceRefs: readonly string[];
  readonly notificationFlags?: {
    readonly ownerNotified?: boolean;
    readonly customersNotified?: boolean;
    readonly providerReviewRequested?: boolean;
  };
}

interface IncidentRow {
  incident_id: string;
  kind: string;
  severity: string;
  owner: string;
  opened_at: Date | string;
  containment: string;
  evidence_refs: unknown;
  notification_flags: unknown;
  recovery_verified_at: Date | string | null;
  postmortem_ref: string | null;
  regression_test_ref: string | null;
  resolved_at: Date | string | null;
}

function normalize(value: Date | string | null): UtcTimestamp | null {
  if (value === null) return null;
  if (typeof value === 'string') return value as UtcTimestamp;
  return value.toISOString().replace('.000Z', 'Z') as UtcTimestamp;
}

function rowToRecord(row: IncidentRow) {
  return SecurityIncidentRecordSchema.parse({
    incidentId: row.incident_id,
    kind: row.kind,
    severity: row.severity,
    owner: row.owner,
    openedAt: normalize(row.opened_at),
    containment: row.containment,
    evidenceRefs: row.evidence_refs,
    notificationPolicyFlags: row.notification_flags,
    recoveryVerifiedAt: normalize(row.recovery_verified_at),
    postmortemRef: row.postmortem_ref,
    regressionTestRef: row.regression_test_ref,
    resolvedAt: normalize(row.resolved_at),
  });
}

export class Incidents {
  private readonly engine: import('@foresift/persistence').DatabaseEngine;

  constructor(engine: import('@foresift/persistence').DatabaseEngine) {
    this.engine = engine;
  }

  async open(input: OpenIncidentInput) {
    if (input.evidenceRefs.length === 0) {
      throw new IncidentError(
        'an incident requires at least one evidence reference',
        {},
        SecErrorCode.SEC_INCIDENT_EVIDENCE_REQUIRED,
      );
    }
    const inserted = await this.engine.query<IncidentRow>(
      `INSERT INTO sec.security_incidents
         (incident_id, kind, severity, owner, opened_at, containment,
          evidence_refs, notification_flags)
       VALUES ($1, $2, $3, $4, $5, 'OPEN', $6::jsonb, $7::jsonb)
       RETURNING *`,
      [
        input.incidentId,
        input.kind,
        input.severity,
        input.owner,
        input.openedAt,
        JSON.stringify([...input.evidenceRefs]),
        JSON.stringify({
          ownerNotified: input.notificationFlags?.ownerNotified ?? false,
          customersNotified: input.notificationFlags?.customersNotified ?? false,
          providerReviewRequested: input.notificationFlags?.providerReviewRequested ?? false,
        }),
      ],
    );
    return rowToRecord(inserted.rows[0] as IncidentRow);
  }

  /**
   * Advance containment monotonically. RESOLVED additionally demands the
   * recovery-verification instant, postmortem link, and regression-test link.
   */
  async transition(
    incidentId: string,
    next: IncidentContainmentState,
    opts: { at: UtcTimestamp } & (
      | { recoveryVerifiedAt?: undefined; postmortemRef?: undefined; regressionTestRef?: undefined }
      | { recoveryVerifiedAt: UtcTimestamp; postmortemRef: string; regressionTestRef: string }
    ),
  ) {
    IncidentContainmentStateSchema.parse(next);
    const current = await this.engine.query<IncidentRow>(
      'SELECT * FROM sec.security_incidents WHERE incident_id = $1',
      [incidentId],
    );
    const row = current.rows[0];
    if (row === undefined) {
      throw new IncidentError(`incident ${incidentId} not found`, { incidentId });
    }
    if (!isAdvancement(row.containment as IncidentContainmentState, next)) {
      throw new IncidentError(
        `illegal containment transition ${row.containment} -> ${next}`,
        { incidentId, from: row.containment, to: next },
        SecErrorCode.SEC_INCIDENT_STATE_TRANSITION_INVALID,
      );
    }
    if (next === 'RESOLVED') {
      const complete =
        opts.recoveryVerifiedAt !== undefined &&
        opts.postmortemRef !== undefined &&
        opts.regressionTestRef !== undefined;
      if (!complete) {
        throw new IncidentError(
          'resolution requires recovery verification, postmortem link, and regression-test link',
          { incidentId },
          SecErrorCode.SEC_INCIDENT_EVIDENCE_REQUIRED,
        );
      }
      const updated = await this.engine.query<IncidentRow>(
        `UPDATE sec.security_incidents SET containment = 'RESOLVED', resolved_at = $2,
           recovery_verified_at = $3, postmortem_ref = $4, regression_test_ref = $5
         WHERE incident_id = $1 RETURNING *`,
        [incidentId, opts.at, opts.recoveryVerifiedAt, opts.postmortemRef, opts.regressionTestRef],
      );
      return rowToRecord(updated.rows[0] as IncidentRow);
    }
    const updated = await this.engine.query<IncidentRow>(
      `UPDATE sec.security_incidents SET containment = $2 WHERE incident_id = $1 RETURNING *`,
      [incidentId, next],
    );
    return rowToRecord(updated.rows[0] as IncidentRow);
  }

  /** Append further evidence references to an open incident (preservation). */
  async attachEvidence(incidentId: string, refs: readonly string[]) {
    if (refs.length === 0) return;
    await this.engine.query(
      `UPDATE sec.security_incidents SET evidence_refs = evidence_refs || $2::jsonb
       WHERE incident_id = $1`,
      [incidentId, JSON.stringify(refs)],
    );
  }

  /**
   * §35.9 block rule: whether any critical AUDIT_CHAIN_FAILURE incident is
   * still open — while true, high-impact activation actions refuse (T114).
   */
  async isOpenAuditChainFailure(): Promise<boolean> {
    const rows = await this.engine.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sec.security_incidents
       WHERE kind = 'AUDIT_CHAIN_FAILURE' AND severity = 'SEV1'
         AND containment <> 'RESOLVED'`,
    );
    return Number(rows.rows[0]?.n ?? '0') > 0;
  }

  async get(incidentId: string) {
    const rows = await this.engine.query<IncidentRow>(
      'SELECT * FROM sec.security_incidents WHERE incident_id = $1',
      [incidentId],
    );
    const row = rows.rows[0];
    return row === undefined ? null : rowToRecord(row);
  }
}

const RANK: Record<IncidentContainmentState, number> = {
  OPEN: 0,
  CONTAINED: 1,
  RECOVERY_VERIFIED: 2,
  RESOLVED: 3,
};

function isAdvancement(from: IncidentContainmentState, to: IncidentContainmentState): boolean {
  return RANK[to] === RANK[from] + 1;
}
