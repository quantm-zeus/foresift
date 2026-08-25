/**
 * Audit bridges (FR-PROV-001; plan material decision 9): lifecycle facts map
 * onto the security AuditChain's existing §35.9 action-class vocabulary —
 * no second chain is invented here. The bridge is OPTIONAL at every call
 * site: the SQL lifecycle ledger is the system of record; audit entries are
 * the cross-domain attestation that security tooling consumes.
 *
 * Critical-transition mapping (the classes named by FR-PROV-001):
 *   → ACTIVE   = PROVIDER_COLLECTOR_ACCESS  (a collector became usable)
 *   → BLOCKED  = BLOCKED_OPERATION          (an operation was cut off)
 *   → REMOVED  = BLOCKED_OPERATION          (removal is permanent revocation)
 * All other transitions live in prov_lifecycle_events alone.
 */
import type { AuditActionClass, AuditEventRecord } from '@foresift/shared-schemas';
import { utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import { AuditChain } from '@foresift/security';
import type { LifecycleEventRecord, LifecycleState } from './schemas.ts';

export function actionClassForTransition(toState: LifecycleState): AuditActionClass | undefined {
  switch (toState) {
    case 'ACTIVE':
      return 'PROVIDER_COLLECTOR_ACCESS';
    case 'BLOCKED':
    case 'REMOVED':
      return 'BLOCKED_OPERATION';
    default:
      return undefined;
  }
}

/** Stable subject format for provider-lifecycle audit entries. */
export function providerSubject(
  providerId: string,
  operationId: string,
  version: string,
): string {
  return `provider:${providerId}/operation:${operationId}@${version}`;
}

export interface ProviderAuditBridgeOptions {
  readonly chain: AuditChain;
}

export class ProviderAuditBridge {
  private readonly chain: AuditChain;

  constructor(options: ProviderAuditBridgeOptions) {
    this.chain = options.chain;
  }

  /**
   * Bridge one applied lifecycle transition. Non-critical transitions return
   * undefined WITHOUT appending — silence in the audit chain means "nothing
   * security-relevant happened", never a dropped entry.
   */
  async transitionApplied(
    event: LifecycleEventRecord,
  ): Promise<AuditEventRecord | undefined> {
    const actionClass = actionClassForTransition(event.toState);
    if (actionClass === undefined) {
      return undefined;
    }
    return this.chain.append({
      occurredAt: utcTimestamp(event.occurredAt),
      actor: event.actor,
      actionClass,
      subject: providerSubject(event.providerId, event.operationId, event.operationVersion),
      payload: {
        lifecycleSeq: event.seq,
        fromState: event.fromState,
        toState: event.toState,
        reasonClass: event.reasonClass,
      },
    });
  }

  /** Rights tightening/loosening facts (FR-PROV-009, wired by rights-matrix). */
  async rightsChange(input: {
    readonly occurredAt: UtcTimestamp;
    readonly actor: string;
    readonly providerId: string;
    readonly operationId: string;
    readonly fromRightsVersion: number;
    readonly toRightsVersion: number;
    readonly newlyProhibitedUses: readonly string[];
    readonly changeId: string;
  }): Promise<AuditEventRecord> {
    return this.chain.append({
      occurredAt: input.occurredAt,
      actor: input.actor,
      actionClass: 'RIGHTS_CHANGE',
      subject: providerSubject(input.providerId, input.operationId, 'rights'),
      payload: {
        changeId: input.changeId,
        fromRightsVersion: input.fromRightsVersion,
        toRightsVersion: input.toRightsVersion,
        newlyProhibitedUses: [...input.newlyProhibitedUses],
      },
    });
  }

  /**
   * Malicious-response quarantine facts (FR-PROV-008, AC-259/AC-271):
   * BLOCKED_OPERATION carries the metadata-only refusal. The payload holds
   * classes/paths/hash/size ONLY — hazardous material is structurally
   * absent from the audit entry too.
   */
  async responseQuarantined(input: {
    readonly occurredAt: UtcTimestamp;
    readonly actor: string;
    readonly providerId: string;
    readonly operationId: string;
    readonly detectedClasses: readonly string[];
    readonly fieldPaths: readonly string[];
    readonly payloadSha256: string;
    readonly byteSize: number;
    readonly quarantineId: string;
  }): Promise<AuditEventRecord> {
    return this.chain.append({
      occurredAt: input.occurredAt,
      actor: input.actor,
      actionClass: 'BLOCKED_OPERATION',
      subject: providerSubject(input.providerId, input.operationId, 'response'),
      payload: {
        quarantineId: input.quarantineId,
        detectedClasses: [...input.detectedClasses],
        fieldPaths: [...input.fieldPaths],
        payloadSha256: input.payloadSha256,
        byteSize: input.byteSize,
      },
    });
  }

  /** Capability-class changes between versions of an operation (§15.2). */
  async capabilityChange(input: {
    readonly occurredAt: UtcTimestamp;
    readonly actor: string;
    readonly providerId: string;
    readonly operationId: string;
    readonly version: string;
    readonly previousCapabilityClass: string | null;
    readonly capabilityClass: string;
  }): Promise<AuditEventRecord> {
    return this.chain.append({
      occurredAt: input.occurredAt,
      actor: input.actor,
      actionClass: 'CAPABILITY_CHANGE',
      subject: providerSubject(input.providerId, input.operationId, input.version),
      payload: {
        previousCapabilityClass: input.previousCapabilityClass,
        capabilityClass: input.capabilityClass,
      },
    });
  }

  /** Affected-feature dependency registration/deactivation facts (§15.4). */
  async sourceDependenceChange(input: {
    readonly occurredAt: UtcTimestamp;
    readonly actor: string;
    readonly providerId: string;
    readonly operationId: string;
    readonly version: string;
    readonly consumerKind: string;
    readonly consumerKey: string;
    readonly active: boolean;
  }): Promise<AuditEventRecord> {
    return this.chain.append({
      occurredAt: input.occurredAt,
      actor: input.actor,
      actionClass: 'SOURCE_DEPENDENCE_CHANGE',
      subject: providerSubject(input.providerId, input.operationId, input.version),
      payload: {
        consumerKind: input.consumerKind,
        consumerKey: input.consumerKey,
        active: input.active,
      },
    });
  }
}
