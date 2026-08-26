/**
 * Verification TTLs (FR-PROV-002, §15.4 rule 3; AC-270; plan material
 * decision 5).
 *
 * Nine verification kinds, per-kind/per-provider TTL configuration with
 * fail-closed defaults (no configured TTL ⇒ refusal, never "unlimited"),
 * use-time freshness evaluation against the INJECTED clock only, sweep
 * transitions mapping expired kinds to their §15.4 health outcomes, and the
 * AC-270 refresh-pair rule: active decision use resumes ONLY after BOTH an
 * OFFICIAL_DOC and a LIVE_CONTRACT PASS verification of every lapsed kind
 * succeeds within its TTL.
 */
import type { DatabaseEngine } from '@foresift/persistence';
import type { ClockPort, UtcTimestamp } from '@foresift/domain';
import {
  DECISION_CRITICAL_VERIFICATION_KINDS,
  EXPIRY_HEALTH_OUTCOMES,
  VERIFICATION_KINDS,
  VERIFICATION_SOURCES,
  type VerificationKind,
  type VerificationSource,
} from './vocabularies.ts';
import { VerificationTtlError, ProvErrorCode } from './errors.ts';
import type { LifecycleMachine } from './lifecycle-machine.ts';
import { TRANSITION_REASON_CLASSES } from './lifecycle-machine.ts';
import type { OperationRef } from './operation-registry.ts';

export interface VerificationRecordInput {
  readonly ref: OperationRef;
  readonly kind: VerificationKind;
  readonly source: VerificationSource;
  readonly outcome: 'PASS' | 'FAIL';
  readonly verifiedAt: UtcTimestamp;
  readonly evidenceRefs: readonly string[];
  readonly recordedBy: string;
  readonly idempotencyKey: string;
}

export interface VerificationRecord {
  readonly recordId: string;
  readonly kind: VerificationKind;
  readonly source: VerificationSource;
  readonly outcome: 'PASS' | 'FAIL';
  readonly verifiedAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
}

export interface FreshnessEvaluation {
  readonly kind: VerificationKind;
  /** FRESH = an in-TTL PASS exists; EXPIRED = only lapsed PASSes; NEVER = none. */
  readonly status: 'FRESH' | 'EXPIRED' | 'NEVER_VERIFIED';
  /** Latest PASS per source, so callers can see the pair state. */
  readonly officialDoc: VerificationRecord | null;
  readonly liveContract: VerificationRecord | null;
}

const WILDCARD_PROVIDER = '*';

export class VerificationTtlEngine {
  private readonly engine: DatabaseEngine;
  private readonly machine: LifecycleMachine;

  constructor(engine: DatabaseEngine, machine: LifecycleMachine) {
    this.engine = engine;
    this.machine = machine;
  }

  /** Configure one (provider|wildcard, kind) TTL. Absence later REFUSES. */
  async configureTtl(input: {
    readonly configId: string;
    /** Provider id, or '*' for the global default row. */
    readonly providerId?: string;
    readonly kind: VerificationKind;
    readonly ttlSeconds: number;
  }): Promise<void> {
    if (!(VERIFICATION_KINDS as readonly string[]).includes(input.kind)) {
      throw new VerificationTtlError(
        `verification kind '${String(input.kind)}' is not part of the nine-kind alphabet`,
        { kind: String(input.kind) },
        ProvErrorCode.PROV_VERIFICATION_RECORD_INVALID,
      );
    }
    if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds <= 0) {
      throw new VerificationTtlError('TTL must be a positive integer number of seconds', {
        ttlSeconds: input.ttlSeconds,
      });
    }
    await this.engine.query(
      `INSERT INTO prov.prov_verification_ttl_config (config_id, provider_id, kind, ttl_seconds)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider_id, kind) DO UPDATE SET ttl_seconds = EXCLUDED.ttl_seconds`,
      [input.configId, input.providerId ?? WILDCARD_PROVIDER, input.kind, input.ttlSeconds],
    );
  }

  /**
   * Resolve the effective TTL seconds: exact provider row first, then the
   * '*' wildcard. NO row anywhere ⇒ typed refusal (fail-closed default).
   */
  async ttlSecondsFor(providerId: string, kind: VerificationKind): Promise<number> {
    const rows = await this.engine.query<{ ttl_seconds: number }>(
      `SELECT ttl_seconds FROM prov.prov_verification_ttl_config
       WHERE (provider_id = $1 OR provider_id = '*') AND kind = $2
       ORDER BY CASE WHEN provider_id = $1 THEN 0 ELSE 1 END
       LIMIT 1`,
      [providerId, kind],
    );
    const ttl = rows.rows[0]?.ttl_seconds;
    if (ttl === undefined) {
      throw new VerificationTtlError(
        `no TTL is configured for provider ${providerId} / kind ${kind}; ` +
          'absence of configuration refuses instead of trusting forever',
        { providerId, kind },
        ProvErrorCode.PROV_VERIFICATION_TTL_UNCONFIGURED,
      );
    }
    return Number(ttl);
  }

  async recordVerification(input: VerificationRecordInput): Promise<VerificationRecord> {
    if (
      !(VERIFICATION_KINDS as readonly string[]).includes(input.kind) ||
      !(VERIFICATION_SOURCES as readonly string[]).includes(input.source)
    ) {
      throw new VerificationTtlError(
        'verification kind or source outside the stable alphabets',
        { kind: input.kind, source: input.source },
        ProvErrorCode.PROV_VERIFICATION_RECORD_INVALID,
      );
    }
    const ttlSeconds = await this.ttlSecondsFor(input.ref.providerId, input.kind);
    const expiresAtMs =
      new Date(input.verifiedAt).getTime() + ttlSeconds * 1000;
    const expiresAt = new Date(expiresAtMs).toISOString().replace('.000Z', 'Z') as UtcTimestamp;

    // Idempotent on the caller's key: replays return the recorded row.
    const existing = await this.engine.query<{
      record_id: string;
      kind: string;
      source: string;
      outcome: string;
      verified_at: Date | string;
      expires_at: Date | string;
    }>(
      'SELECT record_id, kind, source, outcome, verified_at, expires_at FROM prov.prov_verification_records WHERE idempotency_key = $1',
      [input.idempotencyKey],
    );
    const prior = existing.rows[0];
    if (prior !== undefined) {
      return {
        recordId: prior.record_id,
        kind: prior.kind as VerificationKind,
        source: prior.source as VerificationSource,
        outcome: prior.outcome as 'PASS' | 'FAIL',
        verifiedAt: normalize(prior.verified_at),
        expiresAt: normalize(prior.expires_at),
      };
    }

    const inserted = await this.engine.query<{ record_id: string }>(
      `INSERT INTO prov.prov_verification_records (
         record_id, provider_id, operation_id, operation_version, kind, source,
         outcome, verified_at, expires_at, evidence_refs, recorded_by, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
       RETURNING record_id`,
      [
        `${input.idempotencyKey}`,
        input.ref.providerId,
        input.ref.operationId,
        input.ref.version,
        input.kind,
        input.source,
        input.outcome,
        input.verifiedAt,
        expiresAt,
        JSON.stringify([...input.evidenceRefs]),
        input.recordedBy,
        input.idempotencyKey,
      ],
    );
    const row = inserted.rows[0];
    if (row === undefined) {
      throw new VerificationTtlError(
        'verification record insert returned no row',
        { idempotencyKey: input.idempotencyKey },
        ProvErrorCode.PROV_VERIFICATION_RECORD_INVALID,
      );
    }
    return {
      recordId: row.record_id,
      kind: input.kind,
      source: input.source,
      outcome: input.outcome,
      verifiedAt: input.verifiedAt,
      expiresAt,
    };
  }

  /** Use-time freshness of one kind at instant `at` (latest PASS governs). */
  async freshness(ref: OperationRef, kind: VerificationKind, at: UtcTimestamp): Promise<FreshnessEvaluation> {
    const rows = await this.engine.query<{
      record_id: string;
      source: string;
      outcome: string;
      verified_at: Date | string;
      expires_at: Date | string;
    }>(
      `SELECT record_id, source, outcome, verified_at, expires_at
       FROM prov.prov_verification_records
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
         AND kind = $4 AND outcome = 'PASS'
       ORDER BY verified_at DESC`,
      [ref.providerId, ref.operationId, ref.version, kind],
    );
    let officialDoc: VerificationRecord | null = null;
    let liveContract: VerificationRecord | null = null;
    for (const row of rows.rows) {
      const record: VerificationRecord = {
        recordId: row.record_id,
        kind,
        source: row.source as VerificationSource,
        outcome: 'PASS',
        verifiedAt: normalize(row.verified_at),
        expiresAt: normalize(row.expires_at),
      };
      if (officialDoc === null && record.source === 'OFFICIAL_DOC') officialDoc = record;
      if (liveContract === null && record.source === 'LIVE_CONTRACT') liveContract = record;
      if (officialDoc !== null && liveContract !== null) break;
    }
    const candidates = [officialDoc, liveContract].filter(
      (r): r is VerificationRecord => r !== null,
    );
    const freshestExpiresAt = candidates.reduce<string | null>((max, r) => {
      return max === null || r.expiresAt > max ? r.expiresAt : max;
    }, null);
    const status: FreshnessEvaluation['status'] =
      candidates.length === 0
        ? 'NEVER_VERIFIED'
        : freshestExpiresAt !== null && freshestExpiresAt > at
          ? 'FRESH'
          : 'EXPIRED';
    return { kind, status, officialDoc, liveContract };
  }

  /**
   * The AC-270 gate: active decision-critical use requires EVERY critical
   * kind fresh via BOTH sources (the pair rule applies universally — the
   * stricter coherent reading, so a single-source history can never satisfy
   * a lapse after the fact either).
   */
  async assertUsableForActiveDecisions(
    ref: OperationRef,
    clock: ClockPort,
    kinds: readonly VerificationKind[] = DECISION_CRITICAL_VERIFICATION_KINDS,
  ): Promise<void> {
    const at = clock.now();
    const expired: VerificationKind[] = [];
    const incompletePairs: VerificationKind[] = [];
    for (const kind of kinds) {
      const evaluation = await this.freshness(ref, kind, at);
      if (evaluation.status !== 'FRESH') {
        expired.push(kind);
        continue;
      }
      if (evaluation.officialDoc === null || evaluation.liveContract === null) {
        incompletePairs.push(kind);
      }
    }
    if (expired.length > 0 || incompletePairs.length > 0) {
      throw new VerificationTtlError(
        `active decision-critical use refused: expired kinds [${expired.join(', ')}], ` +
          `incomplete OFFICIAL_DOC+LIVE_CONTRACT pairs [${incompletePairs.join(', ')}]`,
        {
          providerId: ref.providerId,
          operationId: ref.operationId,
          version: ref.version,
          expiredKinds: expired.join(','),
          pairIncompleteKinds: incompletePairs.join(','),
        },
        expired.length > 0
          ? ProvErrorCode.PROV_VERIFICATION_EXPIRED
          : ProvErrorCode.PROV_REFRESH_PAIR_INCOMPLETE,
      );
    }
  }

  /**
   * AC-270 resume path: transition back into active service ONLY when every
   * requested lapsed kind now satisfies the full OFFICIAL_DOC+LIVE_CONTRACT
   * pair within TTL. Anything less refuses (fail-closed, no grace windows).
   */
  async resumeAfterRefresh(
    ref: OperationRef,
    clock: ClockPort,
    options: {
      readonly actor: string;
      readonly occurredAt: UtcTimestamp;
      readonly idempotencyKey: string;
      readonly kinds?: readonly VerificationKind[];
    },
  ): Promise<{ resumed: true }> {
    const at = clock.now();
    const kinds = options.kinds ?? DECISION_CRITICAL_VERIFICATION_KINDS;
    for (const kind of kinds) {
      const evaluation = await this.freshness(ref, kind, at);
      const pairComplete =
        evaluation.status === 'FRESH' &&
        evaluation.officialDoc !== null &&
        evaluation.liveContract !== null &&
        evaluation.officialDoc.expiresAt > at &&
        evaluation.liveContract.expiresAt > at;
      if (!pairComplete) {
        throw new VerificationTtlError(
          `refresh pair for ${kind} is not satisfied within TTL; active use stays suspended`,
          {
            kind,
            status: evaluation.status,
            hasOfficialDoc: evaluation.officialDoc !== null,
            hasLiveContract: evaluation.liveContract !== null,
          },
          ProvErrorCode.PROV_REFRESH_PAIR_INCOMPLETE,
        );
      }
    }
    const current = await this.machine.currentState(ref);
    if (current === 'DEGRADED') {
      await this.machine.transition({
        ref,
        to: 'ACTIVE',
        reasonClass: 'VERIFICATION_REFRESHED',
        actor: options.actor,
        occurredAt: options.occurredAt,
        effectiveAt: at,
        evidenceRefs: [`verification-refresh:${options.idempotencyKey}`],
        idempotencyKey: options.idempotencyKey,
        projectHealthStatus: 'HEALTHY',
      });
    }
    return { resumed: true };
  }

  /**
   * Sweep ACTIVE operations whose decision-critical verifications lapsed by
   * instant `at`: each maps its FIRST lapsed kind to the §15.4 health
   * outcome, transitions ACTIVE→DEGRADED with a stable expiry reason class,
   * and appends ledger evidence. Historical records are never touched.
   */
  async sweepExpired(clock: ClockPort, options: {
    readonly actor: string;
    readonly occurredAt: UtcTimestamp;
    readonly sweepRunId: string;
  }): Promise<
    readonly { ref: OperationRef; kind: VerificationKind; healthOutcome: string }[]
  > {
    const at = clock.now();
    const actives = await this.engine.query<{
      provider_id: string;
      operation_id: string;
      version: string;
    }>(
      "SELECT provider_id, operation_id, version FROM prov.prov_operations WHERE current_state = 'ACTIVE' ORDER BY provider_id, operation_id",
    );
    const swept: { ref: OperationRef; kind: VerificationKind; healthOutcome: string }[] = [];
    for (const row of actives.rows) {
      const ref: OperationRef = {
        providerId: row.provider_id,
        operationId: row.operation_id,
        version: row.version,
      };
      for (const kind of DECISION_CRITICAL_VERIFICATION_KINDS) {
        const evaluation = await this.freshness(ref, kind, at);
        if (evaluation.status === 'FRESH') continue;
        const reasonClass = `VERIFICATION_EXPIRED_${kind}`;
        if (!(TRANSITION_REASON_CLASSES as readonly string[]).includes(reasonClass)) {
          throw new VerificationTtlError(
            `expiry reason class missing for kind ${kind}`,
            { kind },
            ProvErrorCode.PROV_VERIFICATION_RECORD_INVALID,
          );
        }
        const healthOutcome = EXPIRY_HEALTH_OUTCOMES[kind];
        await this.machine.transition({
          ref,
          to: 'DEGRADED',
          reasonClass: reasonClass as never,
          actor: options.actor,
          occurredAt: options.occurredAt,
          effectiveAt: at,
          evidenceRefs: [`sweep:${options.sweepRunId}`, `kind:${kind}`],
          idempotencyKey: `${options.sweepRunId}:${row.provider_id}:${row.operation_id}:${row.version}`,
          projectHealthStatus: healthOutcome,
        });
        swept.push({ ref, kind, healthOutcome });
        break; // first lapsed kind drives this sweep's exit; later sweeps catch more
      }
    }
    return swept;
  }
}

function normalize(value: Date | string): UtcTimestamp {
  if (typeof value === 'string') return value as UtcTimestamp;
  return value.toISOString().replace('.000Z', 'Z') as UtcTimestamp;
}
