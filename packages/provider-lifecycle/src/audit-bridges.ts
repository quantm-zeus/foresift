/**
 * Bridges from provider-lifecycle decisions into the landed hash-chained
 * security AuditChain (AC-259; T110). Every critical lifecycle transition is
 * audited under the provider/blocked-operation action classes; quarantine and
 * rights-change emitters land with their phases (T119/T123) in this same file
 * so ALL provider-domain audit traffic crosses one reviewed seam.
 */
import type { UtcTimestamp } from '@foresift/domain';
import type { AuditChain } from '@foresift/security';
import type { OperationTarget } from './operation-registry.ts';

/** The AuditChain action classes this domain may emit (AC-259 mapping). */
export type ProviderAuditActionClass = 'PROVIDER_COLLECTOR_ACCESS' | 'BLOCKED_OPERATION';

function subjectOf(target: OperationTarget): string {
  return `${target.providerId}/${target.operationId}@${target.version}`;
}

export class LifecycleAuditBridge {
  constructor(private readonly chain: AuditChain) {}

  /**
   * Emits one audit entry for an appended lifecycle event. BLOCKED exits use
   * the BLOCKED_OPERATION class; every other transition uses
   * PROVIDER_COLLECTOR_ACCESS. The payload carries the ledger event id so the
   * chain and the SQL ledger can be cross-referenced during verification.
   */
  async transitionAppended(input: {
    readonly target: OperationTarget;
    readonly eventId: string;
    readonly fromState: string;
    readonly toState: string;
    readonly reasonClass: string;
    readonly actor: string;
    readonly occurredAt: UtcTimestamp;
    readonly effectiveAt: UtcTimestamp;
  }): Promise<void> {
    const actionClass: ProviderAuditActionClass =
      input.toState === 'BLOCKED' ? 'BLOCKED_OPERATION' : 'PROVIDER_COLLECTOR_ACCESS';
    await this.chain.append({
      occurredAt: input.occurredAt,
      actor: input.actor,
      actionClass,
      subject: subjectOf(input.target),
      payload: {
        kind: 'LIFECYCLE_TRANSITION',
        eventId: input.eventId,
        fromState: input.fromState,
        toState: input.toState,
        reasonClass: input.reasonClass,
        effectiveAt: input.effectiveAt,
      },
    });
  }
}
