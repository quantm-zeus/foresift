/**
 * Deprecation rules (FR-PROV-003, FR-PROV-007, §15.4 rules 1/2/6; T112).
 *
 *   * Rule 1: `deprecatedAt` blocks NEW feature-dependency registration
 *     unless a currently-valid migration exception exists.
 *   * Rule 2: a sunset date or an official deprecation notice raises an
 *     incident through the security package's incident API carrying the
 *     migration deadline — opened ONCE (deterministic id), never re-opened.
 *   * Rule 6: a deprecated operation cannot remain the SOLE registered source
 *     for a consumer unless a valid exception covers it.
 *   * §15.4 rule 4 / FR-PROV-007: STRICT_FREE availability requires CURRENT
 *     proven plan verification (AC-270 pair on PRICING_PLAN); plan-gated
 *     operations unavailable on free plans surface DISABLED metadata instead
 *     of pretending availability.
 */
import type { DatabaseEngine } from '@foresift/persistence';
import { sha256Text } from '@foresift/persistence';
import type { ClockPort, UtcTimestamp } from '@foresift/domain';
import type { IncidentSeverity } from '@foresift/shared-schemas';
import { Incidents } from '@foresift/security';
import type { LifecycleMachine, OperationTarget } from './lifecycle-machine.ts';
import type { MigrationExceptions } from './migration-exceptions.ts';
import type { OperationRegistry } from './operation-registry.ts';
import type { VerificationTtlEngine } from './verification-ttl.ts';
import { DeprecationRuleError, ProvErrorCode } from './errors.ts';

export interface DeprecateInput {
  readonly target: OperationTarget;
  readonly actor: string;
  /** Sunset instant → incident with the migration deadline (rule 2). */
  readonly sunsetAt?: UtcTimestamp;
  /** Official deprecation notice reference → incident (rule 2). */
  readonly officialNoticeRef?: string;
  readonly replacementOperationId?: string;
  readonly severity?: IncidentSeverity;
}

export interface StrictFreeAvailability {
  readonly available: boolean;
  /** Disabled metadata surfaced when unavailable (never fabricated access). */
  readonly reason: 'ALLOWED' | 'NOT_ALLOWED' | 'PLAN_UNVERIFIED';
}

interface SoleSourceRow {
  readonly consumerKind: string;
  readonly consumerKey: string;
}

function opKey(target: OperationTarget): string {
  return `${target.providerId}/${target.operationId}@${target.version}`;
}

export class DeprecationRules {
  private readonly engine: DatabaseEngine;
  private readonly clock: ClockPort;
  private readonly machine: LifecycleMachine;
  private readonly registry: OperationRegistry;
  private readonly exceptions: MigrationExceptions;
  private readonly ttl: VerificationTtlEngine;
  private readonly incidents: Incidents;

  constructor(deps: {
    engine: DatabaseEngine;
    clock: ClockPort;
    machine: LifecycleMachine;
    registry: OperationRegistry;
    exceptions: MigrationExceptions;
    ttl: VerificationTtlEngine;
    incidents?: Incidents;
  }) {
    this.engine = deps.engine;
    this.clock = deps.clock;
    this.machine = deps.machine;
    this.registry = deps.registry;
    this.exceptions = deps.exceptions;
    this.ttl = deps.ttl;
    // Degrades to SQL-absent behavior only when no incident sink is wired;
    // production wires the security package's Incidents.
    this.incidents =
      deps.incidents ??
      new Incidents(deps.engine);
  }

  /**
   * Deprecates an operation version through the guarded machine and records
   * its deprecation metadata. Rule 6 refuses when the operation is the sole
   * active source of any registered consumer WITHOUT a valid exception.
   */
  async deprecate(input: DeprecateInput): Promise<{ deprecated: true }> {
    const op = await this.registry.getOperation(input.target);
    if (op.deprecatedAt === null) {
      // Rule 6 first: sole-source consumers need either alternatives or a
      // valid exception before deprecation may proceed.
      const sole = await this.soleSourceConsumers(input.target);
      if (sole.length > 0) {
        const exception = await this.exceptions.findActive(input.target).catch(() => null);
        if (exception === null) {
          throw new DeprecationRuleError(
            `${opKey(input.target)} is the sole active source for ${sole.length} consumer(s); migrate them or grant a migration exception`,
            {
              consumers: sole.map((s) => `${s.consumerKind}:${s.consumerKey}`).join(','),
              consumerCount: sole.length,
            },
            ProvErrorCode.PROV_DEPRECATED_SOLE_CRITICAL_SOURCE,
          );
        }
      }
    }

    const now = this.clock.now();
    await this.engine.query(
      `UPDATE prov.prov_operations
       SET deprecated_at = COALESCE($4, deprecated_at),
           sunset_at = COALESCE($5, sunset_at),
           replacement_operation_id = COALESCE($6, replacement_operation_id),
           updated_at = $7
       WHERE provider_id = $1 AND operation_id = $2 AND version = $3`,
      [
        input.target.providerId,
        input.target.operationId,
        input.target.version,
        now,
        input.sunsetAt ?? null,
        input.replacementOperationId ?? null,
        now,
      ],
    );

    await this.machine.transition({
      target: input.target,
      toState: 'DEPRECATED',
      reasonClass:
        input.officialNoticeRef !== undefined
          ? `DEPRECATION_NOTICE:${input.officialNoticeRef}`
          : 'DEPRECATION_RULE',
      actor: input.actor,
    });

    // Rule 2: sunset date or official notice raises ONE incident carrying the
    // migration deadline. Deterministic id keeps retries single-incident.
    if (input.sunsetAt !== undefined || input.officialNoticeRef !== undefined) {
      const incidentId = `prov-dep:${sha256Text(opKey(input.target)).slice(0, 32)}`;
      const evidenceRefs = [
        ...(input.officialNoticeRef !== undefined ? [input.officialNoticeRef] : []),
        `lifecycle:${opKey(input.target)}`,
      ];
      try {
        await this.incidents.open({
          incidentId,
          kind: 'OTHER',
          severity: input.severity ?? 'SEV3',
          owner: input.actor,
          openedAt: this.clock.now(),
          evidenceRefs,
        });
        if (input.sunsetAt !== undefined) {
          await this.incidents.attachEvidence(incidentId, [
            `migration-deadline:${input.sunsetAt}`,
          ]);
        }
      } catch (error) {
        // A replayed deprecation must not fail because its incident exists.
        const existing = await this.incidents.get(incidentId).catch(() => null);
        if (existing === null) throw error;
      }
    }
    return { deprecated: true as const };
  }

  /**
   * Rule 1 gate for NEW dependency registrations against a target.
   */
  async assertDependencyRegistrationAllowed(target: OperationTarget): Promise<void> {
    const op = await this.registry.getOperation(target);
    if (op.deprecatedAt === null) return;
    const exception = await this.exceptions.findActive(target);
    if (exception === null) {
      throw new DeprecationRuleError(
        `${opKey(target)} is deprecated; new feature dependencies are blocked without a valid migration exception`,
        { ...target },
        ProvErrorCode.PROV_DEPRECATED_DEPENDENCY_BLOCKED,
      );
    }
  }

  /**
   * Registered consumers whose ONLY active source is this operation — the
   * rule-6 blast radius.
   */
  async soleSourceConsumers(target: OperationTarget): Promise<SoleSourceRow[]> {
    const rows = await this.engine.query<SoleSourceRow>(
      `SELECT d.consumer_kind, d.consumer_key
       FROM prov.prov_operation_dependencies d
       WHERE d.active = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM prov.prov_operation_dependencies alt
           WHERE alt.consumer_kind = d.consumer_kind
             AND alt.consumer_key = d.consumer_key
             AND alt.active = TRUE
             AND NOT (alt.provider_id = $1 AND alt.operation_id = $2 AND alt.operation_version = $3))
         AND EXISTS (
           SELECT 1 FROM prov.prov_operation_dependencies self
           WHERE self.consumer_kind = d.consumer_kind
             AND self.consumer_key = d.consumer_key
             AND self.active = TRUE
             AND self.provider_id = $1 AND self.operation_id = $2 AND self.operation_version = $3)
       GROUP BY d.consumer_kind, d.consumer_key
       ORDER BY d.consumer_kind, d.consumer_key`,
      [target.providerId, target.operationId, target.version],
    );
    return rows.rows;
  }

  /**
   * §15.4 rule 4 / FR-PROV-007: STRICT_FREE requires current proven plan
   * verification. Unavailable operations surface disabled metadata — callers
   * get a VERDICT, never fabricated availability.
   */
  async strictFreeAvailability(target: OperationTarget): Promise<StrictFreeAvailability> {
    const op = await this.registry.getOperation(target);
    if (!op.allowedInStrictFree) {
      return { available: false, reason: 'NOT_ALLOWED' };
    }
    try {
      await this.ttl.assertActiveUseAllowed(target, 'PRICING_PLAN');
    } catch {
      return { available: false, reason: 'PLAN_UNVERIFIED' };
    }
    return { available: true, reason: 'ALLOWED' };
  }

  /** Asserting variant used by decision paths that must refuse loudly. */
  async assertStrictFreeAllowed(target: OperationTarget): Promise<void> {
    const verdict = await this.strictFreeAvailability(target);
    if (!verdict.available) {
      throw new DeprecationRuleError(
        `${opKey(target)} is unavailable on STRICT_FREE plans (${verdict.reason})`,
        { ...target, reason: verdict.reason },
        ProvErrorCode.PROV_STRICT_FREE_PLAN_UNVERIFIED,
      );
    }
  }
}
