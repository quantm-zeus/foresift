import type { CollectorCeilingSet } from '@foresift/shared-schemas';
export interface CapacityUsage {
  readonly cpuPercent: number;
  readonly memoryBytes: number;
  readonly networkBytes: number;
  readonly subscriptions: number;
  readonly eventRate: number;
  readonly rawStorageBytes: number;
  readonly retries: number;
  readonly monthlyCredits: number;
}
export type CapacityDimension = keyof CapacityUsage;
export interface CapacityPersistence {
  pausePartition(input: { partitionId: string; reason: string; at: string }): Promise<void>;
  createIncident(input: {
    partitionId: string;
    kind: string;
    dimensions: readonly CapacityDimension[];
    at: string;
  }): Promise<string>;
  auditResume(input: {
    partitionId: string;
    actor: string;
    reason: string;
    at: string;
  }): Promise<void>;
  resumePartition(partitionId: string): Promise<void>;
}
export class CapacityGovernor {
  constructor(
    private readonly contract: CollectorCeilingSet,
    private readonly store: CapacityPersistence,
    private readonly now: () => Date = () => new Date(),
  ) {}
  evaluate(
    usage: CapacityUsage,
  ): { allowed: true } | { allowed: false; reached: readonly CapacityDimension[] } {
    const reached = (Object.keys(usage) as CapacityDimension[]).filter(
      (k) => usage[k] >= this.contract[k],
    );
    return reached.length === 0 ? { allowed: true } : { allowed: false, reached };
  }
  async admit(partitionId: string, usage: CapacityUsage): Promise<void> {
    if (
      this.contract.result !== 'PASS' ||
      Date.parse(this.contract.expiresAt) <= this.now().getTime()
    )
      throw new Error('SUSTAINABLE_CAPACITY_CONTRACT_UNVERIFIED');
    const result = this.evaluate(usage);
    if (result.allowed) return;
    const at = this.now().toISOString();
    await this.store.pausePartition({
      partitionId,
      reason: `CAPACITY_CEILING:${result.reached.join(',')}`,
      at,
    });
    await this.store.createIncident({
      partitionId,
      kind: 'CAPACITY_CEILING_REACHED',
      dimensions: result.reached,
      at,
    });
    throw new Error(`CAPACITY_BLOCKED:${result.reached.join(',')}`);
  }
  autoReactivate(): never {
    throw new Error('AUTO_REACTIVATION_REFUSED');
  }
  async resume(partitionId: string, actor: string, reason: string): Promise<void> {
    if (!actor || !reason) throw new Error('AUDITED_RESUME_REQUIRED');
    const at = this.now().toISOString();
    await this.store.auditResume({ partitionId, actor, reason, at });
    await this.store.resumePartition(partitionId);
  }
}
