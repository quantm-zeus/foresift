/**
 * Activation readiness evaluation (FR-PROV-001…007; AC-272).
 *
 * An operation is ELIGIBLE for active decision use only when EVERY gate
 * agrees at the injected instant: registered and in a service-capable
 * lifecycle state, every decision-critical verification kind fresh with a
 * complete OFFICIAL_DOC+LIVE_CONTRACT pair (AC-270), rights declared with an
 * unexpired verification, and — when deprecated — covered by a currently
 * valid migration exception. Anything less is BLOCKED with typed,
 * machine-readable reasons; there is no partial eligibility.
 */
import type { ClockPort } from '@foresift/domain';
import type { OperationRef } from './operation-registry.ts';
import type { OperationRegistry } from './operation-registry.ts';
import type { LifecycleMachine } from './lifecycle-machine.ts';
import type { VerificationTtlEngine } from './verification-ttl.ts';
import type { RightsMatrix } from './rights-matrix.ts';
import type { MigrationExceptions } from './migration-exceptions.ts';
import type { LifecycleState } from './lifecycle-states.ts';
import {
  DECISION_CRITICAL_VERIFICATION_KINDS,
} from './vocabularies.ts';
import { ReadinessRefusalError, ProvErrorCode } from './errors.ts';

export interface ReadinessReason {
  readonly code: string;
  readonly detail: string;
}

export type ReadinessEvaluation =
  | { readonly status: 'ELIGIBLE'; readonly ref: OperationRef; readonly evaluatedAt: string }
  | {
      readonly status: 'BLOCKED';
      readonly ref: OperationRef;
      readonly evaluatedAt: string;
      readonly reasons: readonly ReadinessReason[];
    };

/** States from which ACTIVE decision use can be (re)entered. */
const READY_STATES: readonly LifecycleState[] = ['DISCOVERED', 'VERIFIED', 'DEGRADED', 'ACTIVE'];

export class ReadinessEvaluator {
  private readonly registry: OperationRegistry;
  private readonly machine: LifecycleMachine;
  private readonly verifications: VerificationTtlEngine;
  private readonly rights: RightsMatrix;
  private readonly exceptions: MigrationExceptions;

  constructor(deps: {
    readonly registry: OperationRegistry;
    readonly machine: LifecycleMachine;
    readonly verifications: VerificationTtlEngine;
    readonly rights: RightsMatrix;
    readonly exceptions: MigrationExceptions;
  }) {
    this.registry = deps.registry;
    this.machine = deps.machine;
    this.verifications = deps.verifications;
    this.rights = deps.rights;
    this.exceptions = deps.exceptions;
  }

  async evaluate(ref: OperationRef, clock: ClockPort): Promise<ReadinessEvaluation> {
    const evaluatedAt = clock.now();
    const reasons: ReadinessReason[] = [];

    // 1. Registered?
    let deprecatedAt: string | null = null;
    try {
      const op = await this.registry.getOperation(ref);
      deprecatedAt = op.deprecatedAt;
    } catch {
      return {
        status: 'BLOCKED',
        ref,
        evaluatedAt,
        reasons: [{ code: ProvErrorCode.PROV_OPERATION_UNKNOWN, detail: 'operation is not registered' }],
      };
    }

    // 2. Lifecycle state capable of active use?
    const state = await this.machine.currentState(ref);
    if (!READY_STATES.includes(state)) {
      reasons.push({
        code: ProvErrorCode.PROV_LIFECYCLE_TRANSITION_ILLEGAL,
        detail: `lifecycle state ${state} cannot carry active decision use`,
      });
    }

    // 3. AC-270 verification freshness + refresh pairs.
    for (const kind of DECISION_CRITICAL_VERIFICATION_KINDS) {
      try {
        await this.verifications.assertUsableForActiveDecisions(ref, clock, [kind]);
      } catch (error) {
        reasons.push({
          code: (error as { code?: string }).code ?? ProvErrorCode.PROV_VERIFICATION_EXPIRED,
          detail:
            `verification kind ${kind}: ${(error as Error).message.replace(/^[\w]+: /, '')}`,
        });
      }
    }

    // 4. Rights declared and unexpired.
    const rights = await this.rights.currentDeclaration(ref);
    if (rights === undefined) {
      reasons.push({
        code: ProvErrorCode.PROV_RIGHTS_VERSION_UNKNOWN,
        detail: 'no rights declaration exists; every use path refuses',
      });
    } else if (!(rights.verificationExpiresAt > evaluatedAt)) {
      reasons.push({
        code: ProvErrorCode.PROV_RIGHTS_VERIFICATION_EXPIRED,
        detail: `rights verification lapsed at ${rights.verificationExpiresAt}`,
      });
    }

    // 5. Deprecated operations need a valid migration exception RIGHT NOW.
    if (deprecatedAt !== null) {
      try {
        const exception = await this.exceptions.findValidForOperation(ref, evaluatedAt);
        if (exception === undefined) {
          reasons.push({
            code: ProvErrorCode.PROV_MIGRATION_EXCEPTION_EXPIRED,
            detail: 'operation is deprecated and no unexpired migration exception covers it',
          });
        }
      } catch (error) {
        reasons.push({
          code: (error as { code?: string }).code ?? ProvErrorCode.PROV_MIGRATION_EXCEPTION_EXPIRED,
          detail: (error as Error).message,
        });
      }
    }

    if (reasons.length === 0) {
      return { status: 'ELIGIBLE', ref, evaluatedAt };
    }
    return { status: 'BLOCKED', ref, evaluatedAt, reasons };
  }

  /** Loud path: BLOCKED evaluations refuse with the typed readiness code. */
  async assertEligible(ref: OperationRef, clock: ClockPort): Promise<void> {
    const evaluation = await this.evaluate(ref, clock);
    if (evaluation.status === 'BLOCKED') {
      throw new ReadinessRefusalError(
        `activation readiness blocked: ${evaluation.reasons.map((r) => r.code).join(', ')}`,
        { reasonCount: evaluation.reasons.length },
        ProvErrorCode.PROV_READINESS_BLOCKED,
      );
    }
  }
}
