/**
 * Activation readiness evaluator — the provider-side half of the AC-272
 * gate (T123). Workspace/public activation of an operation is ELIGIBLE only
 * when EVERY dimension passes; any failure yields a BLOCKED verdict with
 * typed reasons. The evaluator NEVER throws for expected refusal conditions
 * — it aggregates them fail-closed, because a gate that crashes open is
 * worse than a gate that refuses.
 *
 * Dimensions (all mandatory, both scopes):
 *   1. LIFECYCLE  — operation exists and sits in ACTIVE;
 *   2. EXPOSURE   — negative-capability metadata complete (read-only proof);
 *   3. VERIFICATION — the AC-270 pair rule holds per configured kind;
 *   4. RIGHTS     — a current declaration exists and its verification
 *                   window has not lapsed;
 *   5. DEPRECATION— a DEPRECATED operation carries a valid migration
 *                   exception.
 *
 * Scope ('WORKSPACE' | 'PUBLIC') is carried on the verdict for gate-side
 * policy; this evaluator applies the SAME evidence bar to both — no weaker
 * workspace path exists.
 */
import type { DatabaseEngine } from '@foresift/persistence';
import type { ClockPort, UtcTimestamp } from '@foresift/domain';
import {
  REQUIRED_NEGATIVE_CAPABILITIES,
  type ProviderVerificationKind,
} from './vocabulary.ts';
import { ProvErrorCode } from './errors.ts';
import type { OperationRegistry, OperationTarget, RegisteredOperation } from './operation-registry.ts';
import type { VerificationTtlEngine } from './verification-ttl.ts';
import type { RightsMatrixEngine } from './rights-matrix.ts';
import type { MigrationExceptions } from './migration-exceptions.ts';
import { isForesiftProviderError } from './errors.ts';

export type ReadinessScope = 'WORKSPACE' | 'PUBLIC';

export interface ReadinessBlockReason {
  /** Machine-readable dimension that refused. */
  readonly dimension: 'LIFECYCLE' | 'EXPOSURE' | 'VERIFICATION' | 'RIGHTS' | 'DEPRECATION';
  /** Stable provider-lifecycle error code describing the failure. */
  readonly code: string;
  readonly message: string;
}

export interface ReadinessEligible {
  readonly status: 'ELIGIBLE';
  readonly scope: ReadinessScope;
  readonly target: OperationTarget;
  readonly checkedAt: UtcTimestamp;
}

export interface ReadinessBlocked {
  readonly status: 'BLOCKED';
  readonly scope: ReadinessScope;
  readonly target: OperationTarget;
  readonly reasons: readonly ReadinessBlockReason[];
  readonly checkedAt: UtcTimestamp;
}

export type ReadinessEvaluation = ReadinessEligible | ReadinessBlocked;

export interface ReadinessEvaluatorOptions {
  readonly engine?: DatabaseEngine;
  readonly clock: ClockPort;
  readonly registry: OperationRegistry;
  readonly ttl?: VerificationTtlEngine | undefined;
  /**
   * Verification kinds enforced through the AC-270 pair rule. Default: the
   * activation-critical trio (documentation, pricing, rights).
   */
  readonly verificationKinds?: readonly ProviderVerificationKind[] | undefined;
  readonly rights?: RightsMatrixEngine | undefined;
  readonly exceptions?: MigrationExceptions | undefined;
}

/** Kinds whose AC-270 freshness gates activation when no override is given. */
const DEFAULT_VERIFICATION_KINDS: readonly ProviderVerificationKind[] = [
  'DOCUMENTATION',
  'PRICING_PLAN',
  'RIGHTS',
];

export class ReadinessEvaluator {
  private readonly clock: ClockPort;
  private readonly registry: OperationRegistry;
  private readonly ttl: VerificationTtlEngine | undefined;
  private readonly verificationKinds: readonly ProviderVerificationKind[];
  private readonly rights: RightsMatrixEngine | undefined;
  private readonly exceptions: MigrationExceptions | undefined;

  constructor(options: ReadinessEvaluatorOptions) {
    this.clock = options.clock;
    this.registry = options.registry;
    this.ttl = options.ttl;
    this.verificationKinds = options.verificationKinds ?? DEFAULT_VERIFICATION_KINDS;
    this.rights = options.rights;
    this.exceptions = options.exceptions;
  }

  async evaluate(
    target: OperationTarget,
    scope: ReadinessScope = 'PUBLIC',
  ): Promise<ReadinessEvaluation> {
    const checkedAt = this.clock.now();
    const reasons: ReadinessBlockReason[] = [];

    let operation: RegisteredOperation | null = null;
    try {
      operation = await this.registry.getOperation(target);
    } catch (error) {
      reasons.push({
        dimension: 'LIFECYCLE',
        code: isForesiftProviderError(error)
          ? String(error.code)
          : ProvErrorCode.PROV_OPERATION_UNKNOWN,
        message: `operation ${target.providerId}/${target.operationId}@${target.version} unknown to the registry`,
      });
    }

    if (operation !== null) {
      // 1. Lifecycle state.
      if (operation.currentState !== 'ACTIVE') {
        reasons.push({
          dimension: 'LIFECYCLE',
          code: ProvErrorCode.PROV_LIFECYCLE_STATE_CONFLICT,
          message: `activation requires ACTIVE state; operation is ${operation.currentState}`,
        });
      }
      // 2. Exposure completeness (read-only proof metadata).
      const negatives = new Set(operation.negativeCapabilities);
      const missing = REQUIRED_NEGATIVE_CAPABILITIES.filter((c) => !negatives.has(c));
      if (missing.length > 0) {
        reasons.push({
          dimension: 'EXPOSURE',
          code: ProvErrorCode.PROV_CAPABILITY_CLASS_PROHIBITED,
          message: `negative-capability metadata incomplete; missing ${missing.join(', ')}`,
        });
      }
      // 5. Deprecation: DEPRECATED operations need a live migration exception.
      if (operation.currentState === 'DEPRECATED' && this.exceptions !== undefined) {
        try {
          await this.exceptions.assertValidForUse(target);
        } catch (error) {
          reasons.push({
            dimension: 'DEPRECATION',
            code: isForesiftProviderError(error)
              ? String(error.code)
              : ProvErrorCode.PROV_MIGRATION_EXCEPTION_EXPIRED,
            message: `deprecated operation lacks a valid migration exception${
              isForesiftProviderError(error) ? ` (${String(error.code)})` : ''
            }`,
          });
        }
      }
    }

    // 3. AC-270 verification pair per configured kind.
    if (this.ttl !== undefined && operation !== null) {
      for (const kind of this.verificationKinds) {
        try {
          const freshness = await this.ttl.evaluateKind(target, kind);
          if (!freshness.pairFresh) {
            reasons.push({
              dimension: 'VERIFICATION',
              code: ProvErrorCode.PROV_VERIFICATION_REFRESH_INCOMPLETE,
              message: `${kind} refresh pair incomplete (OFFICIAL_DOC=${
                freshness.officialDoc.fresh ? 'fresh' : 'stale'
              }, LIVE_CONTRACT=${freshness.liveContract.fresh ? 'fresh' : 'stale'})`,
            });
          }
        } catch (error) {
          reasons.push({
            dimension: 'VERIFICATION',
            code: isForesiftProviderError(error)
              ? String(error.code)
              : ProvErrorCode.PROV_VERIFICATION_TTL_UNCONFIGURED,
            message: `${kind} verification could not be evaluated: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      }
    }

    // 4. Rights declaration presence + window freshness.
    if (this.rights !== undefined) {
      try {
        await this.rights.decideForNewCapture({
          providerId: target.providerId,
          operationId: target.operationId,
          path: 'STORAGE',
        });
      } catch (error) {
        reasons.push({
          dimension: 'RIGHTS',
          code: isForesiftProviderError(error) ? String(error.code) : ProvErrorCode.PROV_RIGHTS_VERSION_UNKNOWN,
          message: `no admissible current rights declaration${
            isForesiftProviderError(error) ? ` (${String(error.code)})` : ''
          }`,
        });
      }
    }

    if (reasons.length > 0) {
      return { status: 'BLOCKED', scope, target, reasons, checkedAt };
    }
    return { status: 'ELIGIBLE', scope, target, checkedAt };
  }
}
