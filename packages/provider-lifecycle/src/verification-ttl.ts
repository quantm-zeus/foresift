/**
 * Verification TTL enforcement (FR-PROV-002; §15.4 rules 3/4, AC-270;
 * plan material decision 5).
 *
 * Nine verification kinds (eight requirement-named plus LIVE_PROBE), each
 * with an EXPLICIT per-(provider, kind) TTL configuration. Fail-closed
 * rules:
 *   * freshness is evaluated AT USE TIME against the injected clock only —
 *     stored rows are never mutated by expiry (append-only history);
 *   * the ABSENCE of a TTL configuration row refuses evaluation outright —
 *     there is no implicit default TTL anywhere;
 *   * the AC-270 refresh-pair rule: after a verification lapse, active
 *     decision use resumes ONLY after BOTH an OFFICIAL_DOC and a
 *     LIVE_CONTRACT verification of the lapsed kind succeed within TTL —
 *     one source alone never re-arms an operation;
 *   * sweeps map lapsed kinds onto the §15.4 outcomes (PLAN_UNVERIFIED /
 *     RIGHTS_UNVERIFIED / DEGRADED) and drive exits from ACTIVE through the
 *     lifecycle machine using `*_EXPIRED` reason classes.
 */
import { fixedClock, utcTimestamp, type ClockPort } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import {
  VerificationKindSchema,
  type HealthStatus,
  type VerificationKind,
  type VerificationRecord,
} from './schemas.ts';
import { ProvErrorCode, VerificationTtlError } from './errors.ts';
import type { LifecycleMachine } from './lifecycle-machine.ts';

export interface VerificationTtlOptions {
  readonly engine: DatabaseEngine;
  /** Injected clock (Constitution XI) — never the wall clock. */
  readonly clock?: ClockPort;
  /** Optional machine used by sweepExpiries() to apply out-of-ACTIVE moves. */
  readonly machine?: LifecycleMachine;
}

/** §15.4 health outcome per lapsed kind (rule 3 mapping). */
export const KIND_HEALTH_OUTCOME: Record<VerificationKind, HealthStatus> = {
  PRICING_PLAN: 'PLAN_UNVERIFIED',
  QUOTA: 'PLAN_UNVERIFIED',
  RIGHTS: 'RIGHTS_UNVERIFIED',
  DOCUMENTATION: 'DEGRADED',
  SCHEMA: 'DEGRADED',
  ENDPOINT: 'DEGRADED',
  AUTHENTICATION: 'DEGRADED',
  DEPRECATION: 'DEGRADED',
  LIVE_PROBE: 'DEGRADED',
};

/** Canonical evaluation order keeps multi-lapse sweeps deterministic. */
export const VERIFICATION_KIND_ORDER: readonly VerificationKind[] =
  VerificationKindSchema.options;

function reasonClassFor(kind: VerificationKind): string {
  return kind === 'QUOTA' ? 'QUOTA_VERIFICATION_EXPIRED' : `${kind}_EXPIRED`;
}

export interface TtlEvaluation {
  readonly kind: VerificationKind;
  readonly status: 'FRESH' | 'EXPIRED' | 'MISSING';
  readonly record?: VerificationRecord;
}

interface RecordRow {
  provider_id: string;
  operation_id: string;
  operation_version: string;
  kind: string;
  source: string;
  outcome: string;
  verified_at: Date | string;
  expires_at: Date | string;
  evidence_refs: unknown;
}

function iso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().replace('.000Z', 'Z');
}

function rowToRecord(row: RecordRow): VerificationRecord {
  return {
    providerId: row.provider_id,
    operationId: row.operation_id,
    operationVersion: row.operation_version,
    kind: row.kind as VerificationKind,
    source: row.source as VerificationRecord['source'],
    outcome: row.outcome as VerificationRecord['outcome'],
    verifiedAt: iso(row.verified_at),
    expiresAt: iso(row.expires_at),
    evidenceRefs: row.evidence_refs as string[],
  };
}

export class VerificationTtlService {
  private readonly engine: DatabaseEngine;
  private readonly clock: ClockPort;
  private readonly machine: LifecycleMachine | undefined;

  constructor(options: VerificationTtlOptions) {
    this.engine = options.engine;
    this.clock = options.clock ?? fixedClock(utcTimestamp('1970-01-01T00:00:00Z'));
    this.machine = options.machine;
  }

  /** Configure (or tighten) the TTL for one provider/kind pair. */
  async configureTtl(
    providerId: string,
    kind: VerificationKind,
    ttlSeconds: number,
  ): Promise<void> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new VerificationTtlError(
        `ttl_seconds must be a positive integer, got ${ttlSeconds}`,
        { ttlSeconds },
        ProvErrorCode.PROV_VERIFICATION_RECORD_INVALID,
      );
    }
    await this.engine.query(
      `INSERT INTO prov.prov_verification_ttl_config (provider_id, kind, ttl_seconds, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider_id, kind)
       DO UPDATE SET ttl_seconds = EXCLUDED.ttl_seconds, updated_at = EXCLUDED.updated_at`,
      [providerId, kind, ttlSeconds, this.clock.now()],
    );
  }

  /**
   * Append one verification outcome. expiry derives from the configured TTL
   * at RECORD time; an unconfigured kind refuses rather than guessing.
   */
  async record(input: {
    readonly providerId: string;
    readonly operationId: string;
    readonly operationVersion: string;
    readonly kind: VerificationKind;
    readonly source: VerificationRecord['source'];
    readonly outcome: VerificationRecord['outcome'];
    readonly verifiedAt?: string;
    readonly evidenceRefs: readonly string[];
  }): Promise<VerificationRecord> {
    if (input.evidenceRefs.length === 0 || input.evidenceRefs.some((r) => r.trim() === '')) {
      throw new VerificationTtlError(
        'a verification record requires at least one non-empty evidence reference',
        {},
        ProvErrorCode.PROV_VERIFICATION_RECORD_INVALID,
      );
    }
    const verifiedAt = input.verifiedAt !== undefined ? utcTimestamp(input.verifiedAt) : this.clock.now();
    const ttl = await this.engine.query<{ ttl_seconds: number }>(
      'SELECT ttl_seconds FROM prov.prov_verification_ttl_config WHERE provider_id = $1 AND kind = $2',
      [input.providerId, input.kind],
    );
    const ttlSeconds = ttl.rows[0]?.ttl_seconds;
    if (ttlSeconds === undefined) {
      throw new VerificationTtlError(
        `no TTL configured for ${input.providerId}/${input.kind} — refusing to record without an explicit bound`,
        {},
        ProvErrorCode.PROV_VERIFICATION_TTL_UNCONFIGURED,
      );
    }
    const expiresAt = new Date(
      Date.parse(verifiedAt) + ttlSeconds * 1000,
    )
      .toISOString()
      .replace('.000Z', 'Z');
    const inserted = await this.engine.query<RecordRow>(
      `INSERT INTO prov.prov_verification_records (
         provider_id, operation_id, operation_version, kind, source,
         outcome, verified_at, expires_at, evidence_refs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       RETURNING *`,
      [
        input.providerId,
        input.operationId,
        input.operationVersion,
        input.kind,
        input.source,
        input.outcome,
        verifiedAt,
        expiresAt,
        JSON.stringify([...input.evidenceRefs]),
      ],
    );
    return rowToRecord(inserted.rows[0]!);
  }

  /**
   * Use-time freshness for one kind: FRESH (latest success inside TTL),
   * EXPIRED (success exists but its window closed), MISSING (no success).
   * A missing configuration THROWS — absence of policy is not freshness.
   */
  async evaluate(
    providerId: string,
    operationId: string,
    operationVersion: string,
    kind: VerificationKind,
  ): Promise<TtlEvaluation> {
    const config = await this.engine.query<{ ttl_seconds: number }>(
      'SELECT ttl_seconds FROM prov.prov_verification_ttl_config WHERE provider_id = $1 AND kind = $2',
      [providerId, kind],
    );
    if (config.rows[0] === undefined) {
      throw new VerificationTtlError(
        `no TTL configured for ${providerId}/${kind} — refusing fail-closed`,
        { providerId, kind },
        ProvErrorCode.PROV_VERIFICATION_TTL_UNCONFIGURED,
      );
    }
    const latest = await this.engine.query<RecordRow>(
      `SELECT * FROM prov.prov_verification_records
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
         AND kind = $4 AND outcome = 'SUCCEEDED'
       ORDER BY verified_at DESC LIMIT 1`,
      [providerId, operationId, operationVersion, kind],
    );
    const row = latest.rows[0];
    if (row === undefined) {
      return { kind, status: 'MISSING' };
    }
    const record = rowToRecord(row);
    if (Date.parse(record.expiresAt) <= this.clock.nowEpochMs()) {
      return { kind, status: 'EXPIRED', record };
    }
    return { kind, status: 'FRESH', record };
  }

  /**
   * AC-270 refresh-pair rule: after `lapsedAt`, BOTH sources must have
   * SUCCEEDED again and each refresh itself must still be inside its TTL
   * window at the current instant. One-sided refreshes never re-arm.
   */
  async resumeAllowedAfterLapse(
    providerId: string,
    operationId: string,
    operationVersion: string,
    kind: VerificationKind,
    lapsedAt: string,
  ): Promise<{ allowed: boolean; missingSources: VerificationRecord['source'][] }> {
    const missing: VerificationRecord['source'][] = [];
    for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
      const rows = await this.engine.query<RecordRow>(
        `SELECT * FROM prov.prov_verification_records
         WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
           AND kind = $4 AND source = $5 AND outcome = 'SUCCEEDED'
           AND verified_at >= $6
         ORDER BY verified_at DESC LIMIT 1`,
        [providerId, operationId, operationVersion, kind, source, lapsedAt],
      );
      const row = rows.rows[0];
      if (
        row === undefined ||
        Date.parse(iso(row.expires_at)) <= this.clock.nowEpochMs()
      ) {
        missing.push(source);
      }
    }
    return { allowed: missing.length === 0, missingSources: missing };
  }

  /**
   * Sweep all ACTIVE operation versions against every configured kind.
   * Deterministic order: operations by identity, kinds in canonical order.
   * The FIRST lapsed kind drives the exit event; remaining lapses are
   * reported too. Only operations currently ACTIVE can exit (the machine's
   * edge-coherence rules enforce the same invariant).
   */
  async sweepExpiries(): Promise<{
    swept: Array<{
      providerId: string;
      operationId: string;
      operationVersion: string;
      lapsedKinds: VerificationKind[];
      healthOutcome: HealthStatus;
    }>;
    evaluations: TtlEvaluation[];
  }> {
    const activeOps = await this.engine.query<{
      provider_id: string;
      operation_id: string;
      operation_version: string;
    }>(
      `SELECT provider_id, operation_id, version AS operation_version
       FROM prov.prov_operations WHERE current_state = 'ACTIVE'
       ORDER BY provider_id, operation_id, operation_version`,
    );

    const swept: Awaited<ReturnType<VerificationTtlService['sweepExpiries']>>['swept'] = [];
    const allEvaluations: TtlEvaluation[] = [];

    for (const op of activeOps.rows) {
      const lapsed: VerificationKind[] = [];
      let healthOutcome: HealthStatus | undefined;
      for (const kind of VERIFICATION_KIND_ORDER) {
        const hasConfig = await this.engine.query<{ ttl_seconds: number }>(
          'SELECT ttl_seconds FROM prov.prov_verification_ttl_config WHERE provider_id = $1 AND kind = $2',
          [op.provider_id, kind],
        );
        // Unconfigured kinds are NOT auto-lapses here: evaluate() refuses
        // them loudly at USE time; sweeps only act on explicit policy.
        if (hasConfig.rows[0] === undefined) continue;
        const evaluation = await this.evaluate(
          op.provider_id,
          op.operation_id,
          op.operation_version,
          kind,
        );
        allEvaluations.push(evaluation);
        if (evaluation.status === 'EXPIRED') {
          lapsed.push(kind);
          healthOutcome ??= KIND_HEALTH_OUTCOME[kind];
        }
      }
      if (lapsed.length > 0 && this.machine !== undefined && healthOutcome !== undefined) {
        // Deterministic key: the same lapse never double-appends, and a
        // re-sweep after transition is a no-op (the op left ACTIVE).
        await this.machine.transition({
          providerId: op.provider_id,
          operationId: op.operation_id,
          operationVersion: op.operation_version,
          toState: 'DEGRADED',
          reasonClass: reasonClassFor(lapsed[0]!) as never,
          actor: 'verification-ttl-sweep',
          nextHealthStatus: healthOutcome,
          evidenceRefs: lapsed.map((k) => `verification/lapsed/${k}`),
          idempotencyKey: `prov-sweep:${op.provider_id}:${op.operation_id}:${op.operation_version}:${lapsed[0]!}`,
        });
      }
      if (lapsed.length > 0) {
        swept.push({
          providerId: op.provider_id,
          operationId: op.operation_id,
          operationVersion: op.operation_version,
          lapsedKinds: lapsed,
          healthOutcome: healthOutcome!,
        });
      }
    }
    return { swept, evaluations: allEvaluations };
  }
}
