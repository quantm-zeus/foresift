/**
 * Verification TTLs that fail closed (FR-PROV-002, §15.4 rules 3/4, §40,
 * AC-270; T111).
 *
 * Rules carried here:
 *   * nine verification kinds (the eight the requirement names plus the
 *     live-probe freshness FR-PROV-001 demands); per-kind TTL with optional
 *     per-provider override; a MISSING configuration is a refusal at
 *     evaluation time — freshness is never implicitly infinite.
 *   * use-time evaluation reads the injected ClockPort only.
 *   * AC-270 refresh pair rule: active decision use for a kind resumes ONLY
 *     after BOTH an OFFICIAL_DOC and a LIVE_CONTRACT verification of that kind
 *     are PASSED and inside their TTL windows.
 *   * expiry sweeps move expired operations out of ACTIVE with the §15.4
 *     health mapping (PRICING_PLAN|QUOTA → PLAN_UNVERIFIED; RIGHTS →
 *     RIGHTS_UNVERIFIED; every other kind → DEGRADED), effective at the
 *     lapsed instant so repeated sweeps dedupe to the SAME ledger events
 *     (INV-009) — stored historical evidence is never mutated.
 */
import { z } from 'zod';
import type { DatabaseEngine } from '@foresift/persistence';
import { sha256Text } from '@foresift/persistence';
import type { ClockPort, UtcTimestamp } from '@foresift/domain';
import { utcTimestamp } from '@foresift/domain';
import {
  VerificationOutcomeSchema,
  VerificationSourceSchema,
  ProviderVerificationKindSchema,
  VERIFICATION_SOURCES,
  type ProviderHealthStatus,
  type ProviderVerificationKind,
  type VerificationSource,
} from './vocabulary.ts';
import { ProvErrorCode, VerificationTtlError } from './errors.ts';
import type {
  LifecycleMachine,
  OperationTarget,
  TransitionResult,
} from './lifecycle-machine.ts';

export interface VerificationTtlEngineOptions {
  readonly engine: DatabaseEngine;
  readonly clock: ClockPort;
  /** Sweep transitions and gated reactivations run through this machine. */
  readonly machine: LifecycleMachine;
}

export interface ConfigureTtlInput {
  readonly kind: ProviderVerificationKind;
  readonly ttlSeconds: number;
  /** Per-provider override when present; otherwise the global default. */
  readonly providerId?: string;
}

export interface RecordVerificationInput {
  readonly target: OperationTarget;
  readonly kind: ProviderVerificationKind;
  readonly source: VerificationSource;
  readonly outcome: z.infer<typeof VerificationOutcomeSchema>;
  readonly verifiedAt?: UtcTimestamp;
  readonly expiresAt?: UtcTimestamp;
  readonly evidenceRefs: readonly string[];
  readonly notes?: string;
}

export interface KindFreshness {
  readonly kind: ProviderVerificationKind;
  readonly officialDoc: {
    readonly fresh: boolean;
    /** Window end of the latest PASSED record (null when none exists). */
    readonly lastExpiresAt: string | null;
  };
  readonly liveContract: {
    readonly fresh: boolean;
    readonly lastExpiresAt: string | null;
  };
  /** AC-270 pair rule: BOTH sources fresh. */
  readonly pairFresh: boolean;
}

export interface SweepReport {
  readonly examinedOperations: number;
  readonly transitions: TransitionResult[];
}

interface TtlConfigRow {
  config_id: string;
  provider_id: string | null;
  kind: string;
  ttl_seconds: number;
}

interface LatestRecordRow {
  verification_id: string;
  source: string;
  outcome: string;
  verified_at: Date | string;
  expires_at: Date | string;
}

function iso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}

/** §15.4 rule-3 health outcome for an expired kind. */
export function expiryHealthFor(kind: ProviderVerificationKind): ProviderHealthStatus {
  switch (kind) {
    case 'PRICING_PLAN':
    case 'QUOTA':
      return 'PLAN_UNVERIFIED';
    case 'RIGHTS':
      return 'RIGHTS_UNVERIFIED';
    default:
      return 'DEGRADED';
  }
}

export class VerificationTtlEngine {
  private readonly engine: DatabaseEngine;
  private readonly clock: ClockPort;
  private readonly machine: LifecycleMachine;

  constructor(options: VerificationTtlEngineOptions) {
    this.engine = options.engine;
    this.clock = options.clock;
    this.machine = options.machine;
  }

  /**
   * Upserts a TTL configuration (config rows are control-plane settings, not
   * evidence — mutable by design). Deterministic ids make retries idempotent.
   */
  async configureTtl(input: ConfigureTtlInput): Promise<{ configId: string }> {
    const kind = ProviderVerificationKindSchema.parse(input.kind);
    if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds <= 0) {
      throw new VerificationTtlError(
        `TTL for ${kind} must be a positive integer number of seconds`,
        { kind, ttlSeconds: input.ttlSeconds },
        ProvErrorCode.PROV_VERIFICATION_RECORD_INVALID,
      );
    }
    const configId = `vtc:${input.providerId ?? 'GLOBAL'}:${kind}`;
    await this.engine.query(
      `INSERT INTO prov.prov_verification_ttl_configs
         (config_id, provider_id, kind, ttl_seconds, updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (config_id)
       DO UPDATE SET ttl_seconds = EXCLUDED.ttl_seconds, updated_at = EXCLUDED.updated_at`,
      [configId, input.providerId ?? null, kind, input.ttlSeconds, this.clock.now()],
    );
    return { configId };
  }

  /**
   * Resolves the effective TTL: the per-provider override wins over the
   * global default; NO configuration refuses (fail-closed).
   */
  async ttlSecondsFor(kind: ProviderVerificationKind, providerId: string): Promise<number> {
    const rows = await this.engine.query<TtlConfigRow>(
      `SELECT config_id, provider_id, kind, ttl_seconds
       FROM prov.prov_verification_ttl_configs
       WHERE kind = $1 AND (provider_id = $2 OR provider_id IS NULL)
       ORDER BY (provider_id IS NULL) ASC
       LIMIT 1`,
      [kind, providerId],
    );
    const row = rows.rows[0];
    if (row === undefined) {
      throw new VerificationTtlError(
        `no TTL configured for kind ${kind} (provider ${providerId}); refusing fail-closed`,
        { kind, providerId },
        ProvErrorCode.PROV_VERIFICATION_TTL_UNCONFIGURED,
      );
    }
    return row.ttl_seconds;
  }

  /**
   * Appends one verification record (append-only SQL truth). Retries of the
   * same semantic record resolve to the SAME row via the INV-009 fence.
   * Landing a PASSED DOCUMENTATION/LIVE_PROBE record also advances the
   * registry's last-verification/probe projection instants.
   */
  async recordVerification(
    input: RecordVerificationInput,
  ): Promise<{ verificationId: string; created: boolean }> {
    const kind = ProviderVerificationKindSchema.parse(input.kind);
    const source = VerificationSourceSchema.parse(input.source);
    const outcome = VerificationOutcomeSchema.parse(input.outcome);
    const evidence = [...input.evidenceRefs];
    if (evidence.length < 1 || evidence.some((e) => e.trim().length === 0)) {
      throw new VerificationTtlError(
        'a verification record requires at least one non-empty evidence reference',
        { kind, source },
        ProvErrorCode.PROV_VERIFICATION_RECORD_INVALID,
      );
    }
    const verifiedAt = input.verifiedAt ?? this.clock.now();
    const ttlSeconds = await this.ttlSecondsFor(kind, input.target.providerId);
    const expiresAt =
      input.expiresAt ??
      utcTimestamp(new Date(utcToEpochMs(verifiedAt) + ttlSeconds * 1000).toISOString());
    if (new Date(iso(expiresAt)).getTime() <= new Date(iso(verifiedAt)).getTime()) {
      throw new VerificationTtlError(
        'verification expiry must lie strictly after its verification instant',
        {},
        ProvErrorCode.PROV_VERIFICATION_RECORD_INVALID,
      );
    }
    const verificationId = `ver:sha256:${sha256Text(
      [
        input.target.providerId,
        input.target.operationId,
        input.target.version,
        kind,
        source,
        outcome,
        iso(verifiedAt),
      ].join('|'),
    )}`;

    const inserted = await this.engine.query<{ seq: number }>(
      `INSERT INTO prov.prov_verification_records (
         verification_id, provider_id, operation_id, operation_version,
         kind, source, outcome, verified_at, expires_at, evidence_refs, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
       ON CONFLICT ON CONSTRAINT prov_verification_records_retry_fenced
       DO NOTHING
       RETURNING seq`,
      [
        verificationId,
        input.target.providerId,
        input.target.operationId,
        input.target.version,
        kind,
        source,
        outcome,
        verifiedAt,
        expiresAt,
        JSON.stringify(evidence),
        input.notes ?? null,
      ],
    );
    const created = inserted.rows.length === 1;

    // Control-plane projection instants (the ONLY mutable surface besides
    // state/health): last documentation verification / last live probe.
    if (created && outcome === 'PASSED') {
      if (kind === 'DOCUMENTATION') {
        await this.engine.query(
          `UPDATE prov.prov_operations SET last_documentation_verification_at = $4, updated_at = $4
           WHERE provider_id = $1 AND operation_id = $2 AND version = $3`,
          [
            input.target.providerId,
            input.target.operationId,
            input.target.version,
            verifiedAt,
          ],
        );
      } else if (kind === 'LIVE_PROBE') {
        await this.engine.query(
          `UPDATE prov.prov_operations SET last_live_probe_at = $4, updated_at = $4
           WHERE provider_id = $1 AND operation_id = $2 AND version = $3`,
          [
            input.target.providerId,
            input.target.operationId,
            input.target.version,
            verifiedAt,
          ],
        );
      }
      // Advance the blanket window to cover the freshest PASSED evidence.
      await this.refreshProjectionWindow(input.target);
    }
    return { verificationId, created };
  }

  /**
   * AC-270 freshness evaluation for ONE kind against the injected clock:
   * latest PASSED record per source whose window covers now; the pair rule
   * requires BOTH sources fresh.
   */
  async evaluateKind(target: OperationTarget, kind: ProviderVerificationKind): Promise<KindFreshness> {
    // Fail-closed: even evaluating freshness requires a configured TTL.
    await this.ttlSecondsFor(kind, target.providerId);
    const perSource = await Promise.all(
      VERIFICATION_SOURCES.map(async (source) => {
        const rows = await this.engine.query<LatestRecordRow>(
          `SELECT verification_id, source, outcome, verified_at, expires_at
           FROM prov.prov_verification_records
           WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
             AND kind = $4 AND source = $5 AND outcome = 'PASSED'
           ORDER BY verified_at DESC LIMIT 1`,
          [target.providerId, target.operationId, target.version, kind, source],
        );
        const row = rows.rows[0];
        const nowMs = this.clock.nowEpochMs();
        const fresh =
          row !== undefined &&
          new Date(iso(row.verified_at)).getTime() <= nowMs &&
          new Date(iso(row.expires_at)).getTime() > nowMs;
        return {
          source,
          fresh,
          // Reported even when STALE — it IS the instant the source lapsed.
          lastExpiresAt: row !== undefined ? iso(row.expires_at) : null,
        };
      }),
    );
    const officialDoc = perSource.find((s) => s.source === 'OFFICIAL_DOC') ?? {
      source: 'OFFICIAL_DOC' as const,
      fresh: false,
      lastExpiresAt: null,
    };
    const liveContract = perSource.find((s) => s.source === 'LIVE_CONTRACT') ?? {
      source: 'LIVE_CONTRACT' as const,
      fresh: false,
      lastExpiresAt: null,
    };
    return {
      kind,
      officialDoc: { fresh: officialDoc.fresh, lastExpiresAt: officialDoc.lastExpiresAt },
      liveContract: { fresh: liveContract.fresh, lastExpiresAt: liveContract.lastExpiresAt },
      pairFresh: officialDoc.fresh && liveContract.fresh,
    };
  }

  /**
   * AC-270 gate: active DECISION USE of a kind requires BOTH sources fresh.
   * Refuses with REFRESH_INCOMPLETE when either source is missing/stale.
   */
  async assertActiveUseAllowed(
    target: OperationTarget,
    kind: ProviderVerificationKind,
  ): Promise<KindFreshness> {
    const freshness = await this.evaluateKind(target, kind);
    if (!freshness.pairFresh) {
      throw new VerificationTtlError(
        `active decision use blocked: ${kind} lacks the AC-270 refresh pair (OFFICIAL_DOC=${freshness.officialDoc.fresh ? 'fresh' : 'stale'}, LIVE_CONTRACT=${freshness.liveContract.fresh ? 'fresh' : 'stale'})`,
        {
          kind,
          officialDocFresh: freshness.officialDoc.fresh,
          liveContractFresh: freshness.liveContract.fresh,
        },
        ProvErrorCode.PROV_VERIFICATION_REFRESH_INCOMPLETE,
      );
    }
    return freshness;
  }

  /**
   * Builds a LifecycleMachine activation gate enforcing the AC-270 pair rule
   * over the supplied kinds (policy choice stays with the caller).
   */
  activationGate(kinds: readonly ProviderVerificationKind[]): (target: OperationTarget) => Promise<void> {
    return async (target: OperationTarget) => {
      for (const kind of kinds) {
        await this.assertActiveUseAllowed(target, kind);
      }
    };
  }

  /**
   * Sweeps ACTIVE operations whose verification lapsed: exits ACTIVE toward
   * DEGRADED with the §15.4 health mapping, effective at the LAPSED instant
   * so repeated sweeps produce identical idempotency keys and dedupe.
   */
  async sweepExpired(options?: { actor?: string }): Promise<SweepReport> {
    const actor = options?.actor ?? 'verification-ttl-sweep';
    interface ActiveOpRow {
      provider_id: string;
      operation_id: string;
      version: string;
      verification_expires_at: Date | string;
    }
    const targets: (OperationTarget & { windowExpiresAt: string })[] = (
      await this.engine.query<ActiveOpRow>(
        `SELECT provider_id, operation_id, version, verification_expires_at
         FROM prov.prov_operations WHERE current_state = 'ACTIVE'
         ORDER BY provider_id, operation_id, version`,
      )
    ).rows.map((r) => ({
      providerId: r.provider_id,
      operationId: r.operation_id,
      version: r.version,
      windowExpiresAt: iso(r.verification_expires_at),
    }));

    const transitions: TransitionResult[] = [];
    let examined = 0;
    for (const target of targets) {
      examined += 1;
      const kindsWithRecords = await this.engine.query<{ kind: string }>(
        `SELECT DISTINCT kind FROM prov.prov_verification_records
         WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3`,
        [target.providerId, target.operationId, target.version],
      );
      const kinds = kindsWithRecords.rows
        .map((r) => ProviderVerificationKindSchema.parse(r.kind))
        .sort();

      for (const kind of kinds) {
        const freshness = await this.evaluateKind(target, kind);
        if (freshness.pairFresh) continue;
        // The pair broke at the EARLIEST source window end; that instant —
        // stable across sweeps — is the event's effective_at so repeated
        // sweeps dedupe to the same idempotency key.
        const candidates = [freshness.officialDoc.lastExpiresAt, freshness.liveContract.lastExpiresAt]
          .filter((v): v is string => v !== null)
          .sort();
        const lapsedAt = candidates[0] ?? target.windowExpiresAt ?? this.clock.now();
        transitions.push(
          await this.machine.transition({
            target,
            toState: 'DEGRADED',
            reasonClass: `VERIFICATION_EXPIRED:${kind}`,
            actor,
            effectiveAt: utcTimestamp(lapsedAt),
            projectHealthStatus: expiryHealthFor(kind),
          }),
        );
        break; // one exit event per sweep per op; next sweep catches more
      }
    }
    return { examinedOperations: examined, transitions };
  }

  /**
   * Advances the registry's blanket verification_expires_at projection to the
   * freshest PASSED evidence end across all kinds/sources (monotone upward).
   */
  private async refreshProjectionWindow(target: OperationTarget): Promise<void> {
    await this.engine.query(
      `UPDATE prov.prov_operations op
       SET verification_expires_at = COALESCE(
             (SELECT MAX(r.expires_at) FROM prov.prov_verification_records r
              WHERE r.provider_id = op.provider_id AND r.operation_id = op.operation_id
                AND r.operation_version = op.version AND r.outcome = 'PASSED'
                AND r.expires_at > op.verification_expires_at),
             op.verification_expires_at),
           updated_at = $4
       WHERE op.provider_id = $1 AND op.operation_id = $2 AND op.version = $3`,
      [target.providerId, target.operationId, target.version, this.clock.now()],
    );
  }
}

function utcToEpochMs(value: UtcTimestamp): number {
  return new Date(value).getTime();
}
