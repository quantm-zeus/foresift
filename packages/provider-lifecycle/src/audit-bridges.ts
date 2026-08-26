/**
 * Bridges from provider-lifecycle facts onto the security AuditChain
 * (FR-PROV-001/008/009; AC-259 regression guard). This package NEVER invents
 * a second chain (plan material decision 9): every critical transition,
 * quarantine, and rights change is appended to THE security chain under its
 * §35.9 action-class vocabulary:
 *
 *   lifecycle transitions            → PROVIDER_COLLECTOR_ACCESS
 *   transitions INTO BLOCKED         → BLOCKED_OPERATION
 *   response quarantines             → BLOCKED_OPERATION
 *   rights changes + artifact actions → RIGHTS_CHANGE
 */
import type { AuditActionClass, AuditEventRecord } from '@foresift/shared-schemas';
import { AuditChain, type AuditAppendInput } from '@foresift/security';

export class LifecycleAuditBridge {
  private readonly chain: AuditChain;

  constructor(chain: AuditChain) {
    this.chain = chain;
  }

  async append(input: AuditAppendInput): Promise<AuditEventRecord> {
    return this.chain.append(input);
  }

  /** One lifecycle ledger transition, mapped to its §35.9 action class. */
  recordTransition(input: {
    readonly occurredAt: import('@foresift/domain').UtcTimestamp;
    readonly actor: string;
    readonly ref: {
      readonly providerId: string;
      readonly operationId: string;
      readonly version: string;
    };
    readonly fromState: string;
    readonly toState: string;
    readonly reasonClass: string;
    readonly evidenceRefs: readonly string[];
  }): Promise<AuditEventRecord> {
    const actionClass: AuditActionClass =
      input.toState === 'BLOCKED' ? 'BLOCKED_OPERATION' : 'PROVIDER_COLLECTOR_ACCESS';
    return this.append({
      occurredAt: input.occurredAt,
      actor: input.actor,
      actionClass,
      subject: `provider-operation:${input.ref.providerId}/${input.ref.operationId}@${input.ref.version}`,
      payload: {
        kind: 'PROVIDER_LIFECYCLE_TRANSITION',
        providerId: input.ref.providerId,
        operationId: input.ref.operationId,
        version: input.ref.version,
        fromState: input.fromState,
        toState: input.toState,
        reasonClass: input.reasonClass,
        evidenceRefs: [...input.evidenceRefs],
      },
    });
  }

  /** One response quarantine — always a BLOCKED_OPERATION entry. */
  recordQuarantine(input: {
    readonly detectedAt: import('@foresift/domain').UtcTimestamp;
    readonly actor: string;
    readonly ref: {
      readonly providerId: string;
      readonly operationId: string;
      readonly version: string;
    };
    readonly quarantineId: string;
    readonly detectedClasses: readonly string[];
    /** sha256 of the rejected payload — metadata only, never material. */
    readonly payloadSha256: string;
    readonly byteSize: number;
  }): Promise<AuditEventRecord> {
    return this.append({
      occurredAt: input.detectedAt,
      actor: input.actor,
      actionClass: 'BLOCKED_OPERATION',
      subject: `provider-response-quarantine:${input.quarantineId}`,
      payload: {
        kind: 'PROVIDER_RESPONSE_QUARANTINE',
        providerId: input.ref.providerId,
        operationId: input.ref.operationId,
        version: input.ref.version,
        detectedClasses: [...input.detectedClasses],
        payloadSha256: input.payloadSha256,
        byteSize: input.byteSize,
        modelContextExclusion: 'ENFORCED',
      },
    });
  }

  /** One rights tightening with its artifact-action enumeration. */
  recordRightsChange(input: {
    readonly changedAt: import('@foresift/domain').UtcTimestamp;
    readonly actor: string;
    readonly changeId: string;
    readonly ref: {
      readonly providerId: string;
      readonly operationId: string;
    };
    readonly newlyProhibitedUses: readonly string[];
    readonly affectedArtifactActions: ReadonlyArray<{
      readonly artifactId: string;
      readonly action: string;
    }>;
  }): Promise<AuditEventRecord> {
    return this.append({
      occurredAt: input.changedAt,
      actor: input.actor,
      actionClass: 'RIGHTS_CHANGE',
      subject: `provider-rights-change:${input.changeId}`,
      payload: {
        kind: 'PROVIDER_RIGHTS_CHANGE',
        changeId: input.changeId,
        providerId: input.ref.providerId,
        operationId: input.ref.operationId,
        newlyProhibitedUses: [...input.newlyProhibitedUses],
        affectedArtifactActions: input.affectedArtifactActions.map((a) => ({ ...a })),
      },
    });
  }
}
