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

/**
 * Quarantine emitter (FR-PROV-008 / AC-271; T119): every rejected response is
 * audited with its detection classes and metadata ONLY — the hazardous
 * payload material never enters the audit chain either.
 */
export class ResponseQuarantineAuditBridge {
  constructor(private readonly chain: AuditChain) {}

  async responseQuarantined(input: {
    readonly target: OperationTarget;
    readonly quarantineId: string;
    readonly detectedClasses: readonly string[];
    readonly fieldPaths: readonly string[];
    readonly payloadSha256: string;
    readonly byteSize: number;
    readonly quarantinedAt: UtcTimestamp;
  }): Promise<void> {
    await this.chain.append({
      occurredAt: input.quarantinedAt,
      actor: 'response-quarantine',
      actionClass: 'BLOCKED_OPERATION',
      subject: subjectOf(input.target),
      payload: {
        kind: 'RESPONSE_QUARANTINED',
        quarantineId: input.quarantineId,
        detectedClasses: [...input.detectedClasses],
        fieldPaths: [...input.fieldPaths],
        payloadSha256: input.payloadSha256,
        byteSize: input.byteSize,
        modelContextExclusion: 'ENFORCED',
      },
    });
  }
}

/**
 * Rights-change emitter (FR-PROV-009 / AC-273; T120): tightening changes are
 * audited with their newly-prohibited paths so downstream gates can prove
 * WHEN each path closed.
 */
export class RightsChangeAuditBridge {
  constructor(private readonly chain: AuditChain) {}

  async rightsChanged(input: {
    readonly providerId: string;
    readonly operationId: string;
    readonly changeId: string;
    readonly fromRightsVersion: number;
    readonly toRightsVersion: number;
    readonly newlyProhibitedUses: readonly string[];
    readonly tightened: boolean;
    readonly actor: string;
    readonly changedAt: UtcTimestamp;
  }): Promise<void> {
    await this.chain.append({
      occurredAt: input.changedAt,
      actor: input.actor,
      actionClass: 'BLOCKED_OPERATION',
      subject: `${input.providerId}/${input.operationId}@rights-v${String(input.fromRightsVersion)}→v${String(input.toRightsVersion)}`,
      payload: {
        kind: 'RIGHTS_CHANGE',
        changeId: input.changeId,
        newlyProhibitedUses: [...input.newlyProhibitedUses],
        tightened: input.tightened,
      },
    });
  }
}
