/**
 * Deprecation rules (FR-PROV-003, FR-PROV-007; §15.4 rules 1/2/6).
 *
 * Four fail-closed duties:
 *   * NEW-USE BLOCKING — once `deprecatedAt` is set, new feature-dependency
 *     registrations refuse unless a VALID (unexpired, unrevoked) migration
 *     exception exists for that operation;
 *   * SUNSET DUTY — sunset dates and official deprecation notices open
 *     incidents through the security incidents API carrying the migration
 *     deadline as preserved evidence; deterministic incident ids keep the
 *     duty idempotent;
 *   * SOLE-CRITICAL-SOURCE refusal — deprecating an operation that is the
 *     ONLY active source of a critical field refuses: consumers would be
 *     silently broken with no replacement path;
 *   * STRICT_FREE gating — strict-free availability requires CURRENT proven
 *     plan verification; plan-gated operations unavailable on free plans
 *     surface disabled metadata rather than pretending availability.
 */
import { fixedClock, utcTimestamp, type ClockPort } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import type { Incidents } from '@foresift/security';
import type { OperationDefinition } from './schemas.ts';
import { DeprecationError, ProvErrorCode, VerificationTtlError } from './errors.ts';
import type { MigrationExceptions } from './migration-exceptions.ts';
import type { VerificationTtlService } from './verification-ttl.ts';

export interface DeprecationRulesOptions {
  readonly engine: DatabaseEngine;
  /** Injected clock (Constitution XI) — never the wall clock. */
  readonly clock?: ClockPort;
  /** Validity checks for escape-hatch exceptions. */
  readonly exceptions?: MigrationExceptions;
  /** Security incident sink for sunset/deprecation duties. */
  readonly incidents?: Incidents;
  /** Plan-proof lookups for STRICT_FREE gating. */
  readonly verification?: VerificationTtlService;
}

interface DeprecatedRow {
  provider_id: string;
  operation_id: string;
  version: string;
  current_state: string;
  deprecated_at: Date | string | null;
}

/** Result of a STRICT_FREE availability evaluation (metadata, never silent). */
export interface StrictFreeAvailability {
  readonly allowed: boolean;
  readonly reason:
    | 'PLAN_VERIFIED'
    | 'PLAN_UNPROVEN'
    | 'NOT_ELIGIBLE'
    | 'PAID_ONLY'
    | 'COST_DISABLED';
  readonly detail: string;
}

export class DeprecationRules {
  private readonly engine: DatabaseEngine;
  private readonly clock: ClockPort;
  private readonly exceptions: MigrationExceptions | undefined;
  private readonly incidents: Incidents | undefined;
  private readonly verification: VerificationTtlService | undefined;

  constructor(options: DeprecationRulesOptions) {
    this.engine = options.engine;
    this.clock = options.clock ?? fixedClock(utcTimestamp('1970-01-01T00:00:00Z'));
    this.exceptions = options.exceptions;
    this.incidents = options.incidents;
    this.verification = options.verification;
  }

  /**
   * Gate for NEW dependency registrations against a deprecated operation.
   * Passes silently when the operation is not deprecated or a valid
   * exception covers it; refuses otherwise (fail-closed).
   */
  async assertNewUseAllowed(providerId: string, operationId: string): Promise<void> {
    const rows = await this.engine.query<DeprecatedRow>(
      `SELECT provider_id, operation_id, version, current_state, deprecated_at
       FROM prov.prov_operations
       WHERE provider_id = $1 AND operation_id = $2
       ORDER BY registered_at DESC LIMIT 1`,
      [providerId, operationId],
    );
    const op = rows.rows[0];
    if (op === undefined) {
      throw new DeprecationError(
        `operation not registered: ${providerId}/${operationId}`,
        {},
        ProvErrorCode.PROV_OPERATION_UNKNOWN,
      );
    }
    const deprecated = op.deprecated_at !== null || op.current_state === 'DEPRECATED';
    if (!deprecated) return;

    const exception = await this.exceptions?.findValid(providerId, operationId);
    if (exception === undefined) {
      throw new DeprecationError(
        `operation ${providerId}/${operationId} is deprecated — new use is blocked without a valid migration exception`,
        {
          providerId,
          operationId,
          version: op.version,
          deprecatedAt: op.deprecated_at === null ? '' : iso(op.deprecated_at),
        },
        ProvErrorCode.PROV_DEPRECATED_NEW_USE_BLOCKED,
      );
    }
  }

  /**
   * Sole-critical-source check: refuse retiring/deprecating an operation
   * while it is the ONLY active source registered for some critical field.
   * Returns the conflicting fields (empty when safe to proceed).
   */
  async soleCriticalFields(
    providerId: string,
    operationId: string,
  ): Promise<string[]> {
    const rows = await this.engine.query<{ critical_field: string }>(
      `SELECT d.critical_field
       FROM prov.prov_operation_dependencies d
       WHERE d.provider_id = $1 AND d.operation_id = $2 AND d.active
         AND d.critical_field IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM prov.prov_operation_dependencies other
           WHERE other.critical_field = d.critical_field
             AND other.active
             AND NOT (other.provider_id = d.provider_id AND other.operation_id = d.operation_id))
       GROUP BY d.critical_field
       ORDER BY d.critical_field`,
      [providerId, operationId],
    );
    return rows.rows.map((r) => r.critical_field);
  }

  async assertNotSoleCriticalSource(providerId: string, operationId: string): Promise<void> {
    const fields = await this.soleCriticalFields(providerId, operationId);
    if (fields.length > 0) {
      throw new DeprecationError(
        `refusing deprecation: ${providerId}/${operationId} is the sole active source for critical fields ${fields.join(', ')}`,
        { providerId, operationId, criticalFields: fields.join(', ') },
        ProvErrorCode.PROV_SOLE_CRITICAL_SOURCE_REFUSED,
      );
    }
  }

  /**
   * Sunset duty sweep: every ACTIVE/DEGRADED operation whose sunset date has
   * PASSED (or an official deprecation notice is recorded) gets ONE security
   * incident carrying the migration deadline as preserved evidence.
   * Deterministic incident ids make re-runs idempotent at the SQL layer.
   */
  async raiseSunsetIncidents(): Promise<
    Array<{ providerId: string; operationId: string; incidentId: string; deadline: string }>
  > {
    if (this.incidents === undefined) {
      throw new DeprecationError(
        'sunset duty requires a wired security Incidents sink',
        {},
        ProvErrorCode.PROV_EXCEPTION_WINDOW_INVALID,
      );
    }
    const now = this.clock.now();
    const rows = await this.engine.query<{
      provider_id: string;
      operation_id: string;
      version: string;
      sunset_at: Date | string | null;
      deprecated_at: Date | string | null;
    }>(
      `SELECT provider_id, operation_id, version, sunset_at, deprecated_at
       FROM prov.prov_operations
       WHERE current_state IN ('ACTIVE', 'DEGRADED')
         AND (sunset_at IS NOT NULL OR deprecated_at IS NOT NULL)
       ORDER BY provider_id, operation_id, version`,
    );

    const raised: Array<{
      providerId: string;
      operationId: string;
      incidentId: string;
      deadline: string;
    }> = [];
    for (const op of rows.rows) {
      const sunset = op.sunset_at === null ? null : iso(op.sunset_at);
      // Duty fires when the sunset instant exists and has passed.
      if (sunset === null || Date.parse(sunset) > this.clock.nowEpochMs()) continue;
      const incidentId = `prov-sunset:${op.provider_id}:${op.operation_id}:${op.version}`;
      try {
        await this.incidents.open({
          incidentId,
          kind: 'OTHER',
          severity: 'SEV2',
          owner: 'provider-lifecycle',
          openedAt: utcTimestamp(now),
          evidenceRefs: [
            `provider/${op.provider_id}/operation/${op.operation_id}@${op.version}`,
            `sunset-at/${sunset}`,
            `migration-deadline/${sunset}`,
          ],
        });
      } catch (error) {
        // Deterministic id already opened → duty already discharged.
        if (!(error instanceof Error && /duplicate key/i.test(error.message))) throw error;
      }
      raised.push({
        providerId: op.provider_id,
        operationId: op.operation_id,
        incidentId,
        deadline: sunset,
      });
    }
    return raised;
  }

  /**
   * STRICT_FREE availability metadata (FR-PROV-007): eligibility requires
   * allowed_in_strict_free=true AND non-deprecated AND CURRENT proven plan
   * verification. Unproven plans surface DISABLED metadata — never silent
   * availability, never a guessed default.
   */
  async strictFreeAvailability(
    definition: Pick<
      OperationDefinition,
      'providerId' | 'operationId' | 'version' | 'allowedInStrictFree' | 'costClass' | 'paidFallbackAllowed'
    >,
  ): Promise<StrictFreeAvailability> {
    const identity = {
      providerId: definition.providerId,
      operationId: definition.operationId,
      version: definition.version,
    };
    if (definition.costClass === 'DISABLED') {
      return {
        allowed: false,
        reason: 'COST_DISABLED',
        detail: 'operation cost class DISABLED',
      };
    }
    if (!definition.allowedInStrictFree) {
      return {
        allowed: false,
        reason: definition.paidFallbackAllowed ? 'PAID_ONLY' : 'NOT_ELIGIBLE',
        detail: 'operator flag allows_in_strict_free=false',
      };
    }
    if (this.verification === undefined) {
      // No verifier wired → cannot PROVE the plan → fail closed to disabled.
      return {
        allowed: false,
        reason: 'PLAN_UNPROVEN',
        detail: 'no verification service wired; plan proof impossible',
      };
    }
    try {
      const pricing = await this.verification.evaluate(
        identity.providerId,
        identity.operationId,
        identity.version,
        'PRICING_PLAN',
      );
      if (pricing.status !== 'FRESH') {
        return {
          allowed: false,
          reason: 'PLAN_UNPROVEN',
          detail: `pricing-plan verification ${pricing.status}`,
        };
      }
      return { allowed: true, reason: 'PLAN_VERIFIED', detail: 'pricing-plan verification fresh' };
    } catch (error) {
      // Unconfigured verification POLICY means plan proof is impossible →
      // disabled metadata (fail-closed), never a crash of catalog assembly.
      if (
        error instanceof VerificationTtlError &&
        error.code === ProvErrorCode.PROV_VERIFICATION_TTL_UNCONFIGURED
      ) {
        return {
          allowed: false,
          reason: 'PLAN_UNPROVEN',
          detail: 'no pricing-plan TTL policy configured; proof impossible',
        };
      }
      throw error;
    }
  }
}

function iso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().replace('.000Z', 'Z');
}
