/**
 * Deprecation rules (FR-PROV-003, FR-PROV-007; §15.4 lifecycle rules
 * 1/2/4/6; AC-272 negative paths).
 *
 *   rule 1 — deprecatedAt blocks NEW feature-dependency registration unless
 *            a valid time-bounded migration exception exists at use time;
 *   rule 2 — a sunset date or official deprecation notice opens an incident
 *            carrying the migration deadline;
 *   rule 4 — STRICT_FREE availability requires current proven plan
 *            verification; plan-gated ops surface disabled metadata;
 *   rule 6 — a deprecated operation cannot remain the SOLE source for a
 *            critical field.
 */
import type { UtcTimestamp } from '@foresift/domain';
import { Incidents } from '@foresift/security';
import type { OperationRef, OperationRegistry } from './operation-registry.ts';
import { DeprecationError, ProvErrorCode } from './errors.ts';
import type { MigrationExceptions } from './migration-exceptions.ts';

export interface StrictFreeAvailability {
  readonly available: boolean;
  readonly disabledMetadata:
    | { readonly reason: 'NOT_DECLARED_STRICT_FREE' | 'PLAN_VERIFICATION_NOT_PROVEN'; readonly detail: string }
    | null;
}

export class DeprecationRules {
  private readonly registry: OperationRegistry;
  private readonly exceptions: MigrationExceptions;
  private readonly incidents: Incidents | undefined;

  constructor(
    registry: OperationRegistry,
    exceptions: MigrationExceptions,
    incidents?: Incidents,
  ) {
    this.registry = registry;
    this.exceptions = exceptions;
    this.incidents = incidents;
  }

  /**
   * Rule 1: registering a NEW dependency on a deprecated operation requires
   * a valid (unexpired, unrevoked) migration exception AT THIS INSTANT.
   */
  async assertDependencyRegistrationAllowed(
    target: OperationRef,
    at: UtcTimestamp,
    options: { readonly exceptionId?: string } = {},
  ): Promise<void> {
    const op = await this.registry.getOperation(target);
    if (op.deprecatedAt === null) return;
    const valid =
      options.exceptionId !== undefined
        ? await this.exceptions.assertValid(options.exceptionId, at)
        : await this.exceptions.findValidForOperation(target, at);
    if (valid === undefined) {
      throw new DeprecationError(
        `operation ${target.providerId}/${target.operationId}@${target.version} is deprecated ` +
          'and no valid migration exception exists at this instant',
        {
          providerId: target.providerId,
          operationId: target.operationId,
          version: target.version,
        },
        ProvErrorCode.PROV_DEPRECATED_REGISTRATION_REFUSED,
      );
    }
  }

  /**
   * Rule 2: sunset dates and official deprecation notices raise an incident
   * through the security incidents API carrying the migration deadline as
   * evidence. Idempotent per (op, deadline): re-evaluation returns the same
   * incident id instead of duplicating.
   */
  async evaluateSunset(input: {
    readonly ref: OperationRef;
    readonly at: UtcTimestamp;
    /** Official notice reference when the trigger is a notice, not the date. */
    readonly officialNoticeRef?: string;
    readonly severity?: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
  }): Promise<{ incidentId: string; migrationDeadline: UtcTimestamp }> {
    const op = await this.registry.getOperation(input.ref);
    if (op.sunsetAt === null && input.officialNoticeRef === undefined) {
      throw new DeprecationError(
        'no sunset date and no official deprecation notice to evaluate',
        { ref: JSON.stringify(input.ref) },
        ProvErrorCode.PROV_SUNSET_INCIDENT_REQUIRED,
      );
    }
    const deadline = op.sunsetAt ?? input.at;
    const incidentId = `prov-sunset-${input.ref.providerId}-${input.ref.operationId}-${input.ref.version}`
      // keep ids filesystem/SQL friendly
      .toLowerCase();
    if (this.incidents !== undefined) {
      try {
        await this.incidents.open({
          incidentId,
          kind: 'OTHER',
          severity: input.severity ?? 'SEV3',
          owner: 'provider-lifecycle',
          openedAt: input.at,
          evidenceRefs: [
            ...(op.sunsetAt !== null ? [`sunset-at:${op.sunsetAt}`] : []),
            ...(input.officialNoticeRef !== undefined
              ? [`deprecation-notice:${input.officialNoticeRef}`]
              : []),
            `migration-deadline:${deadline}`,
          ],
        });
      } catch (error) {
        // Idempotent open: the deterministic id colliding means the incident
        // already exists for exactly this sunset — that IS the desired outcome.
        const code = (error as { code?: string }).code;
        if (
          code !== undefined &&
          code !== 'SEC_INCIDENT_STATE_TRANSITION_INVALID' &&
          code !== '23505'
        ) {
          throw error;
        }
      }
    }
    return { incidentId, migrationDeadline: deadline };
  }

  /**
   * Rule 6: refusing when the deprecated operation is the sole registered
   * source of a critical field.
   */
  async assertNotSoleCriticalSource(target: OperationRef, criticalField: string): Promise<void> {
    const deps = await this.registry.listActiveDependenciesForCriticalField(criticalField);
    const others = deps.filter(
      (d) =>
        !(
          d.target.providerId === target.providerId &&
          d.target.operationId === target.operationId &&
          d.target.version === target.version
        ),
    );
    const servesField = deps.some(
      (d) =>
        d.target.providerId === target.providerId &&
        d.target.operationId === target.operationId &&
        d.target.version === target.version,
    );
    if (servesField && others.length === 0) {
      throw new DeprecationError(
        `operation ${target.providerId}/${target.operationId}@${target.version} is the sole ` +
          `registered source of critical field '${criticalField}'`,
        { criticalField, ref: JSON.stringify(target) },
        ProvErrorCode.PROV_SOLE_CRITICAL_SOURCE_REFUSED,
      );
    }
  }

  /**
   * Rule 4: STRICT_FREE availability needs BOTH the declaration flag and a
   * CURRENT proven plan verification. Callers pass the freshness verdict from
   * the VerificationTtlEngine; unavailable ops surface disabled metadata.
   */
  strictFreeAvailability(
    op: { readonly allowedInStrictFree: boolean; readonly providerId: string; readonly operationId: string; readonly version: string },
    planVerificationProven: boolean,
  ): StrictFreeAvailability {
    if (!op.allowedInStrictFree) {
      return {
        available: false,
        disabledMetadata: {
          reason: 'NOT_DECLARED_STRICT_FREE',
          detail: `${op.providerId}/${op.operationId}@${op.version} is not declared available on free plans`,
        },
      };
    }
    if (!planVerificationProven) {
      return {
        available: false,
        disabledMetadata: {
          reason: 'PLAN_VERIFICATION_NOT_PROVEN',
          detail: 'current pricing/quota plan verification is missing or expired',
        },
      };
    }
    return { available: true, disabledMetadata: null };
  }
}
