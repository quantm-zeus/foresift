import { randomUUID } from 'node:crypto';
import type { CollectorScopeDeclaration } from '@foresift/shared-schemas';
export type AcquisitionOutcome =
  | 'RETURNED_VALID'
  | 'EMPTY'
  | 'PARTIAL'
  | 'FAILED_NETWORK'
  | 'FAILED_TIMEOUT'
  | 'FAILED_PROVIDER'
  | 'SCHEMA_REJECTED'
  | 'RIGHTS_REJECTED'
  | 'COST_OR_QUOTA_BLOCKED'
  | 'UNSUPPORTED';
export interface CollectorBootDeclaration {
  readonly collectorInstanceId: string;
  readonly collectorVersion: string;
  readonly chainId: string;
  readonly scopes: readonly CollectorScopeDeclaration[];
  readonly startCheckpoints: Readonly<Record<string, number>>;
  readonly backfillLimit: number;
  readonly byteCeiling: number;
  readonly creditCeiling: number;
  readonly backoffPolicy: {
    initialMs: number;
    maximumMs: number;
    multiplier: number;
    jitterRatio: number;
    seed: string;
  };
}
export interface AcquisitionRecorder {
  open(input: { acquisitionId: string; scopeId: string; startedAt: string }): Promise<void>;
  finish(input: {
    acquisitionId: string;
    outcome: AcquisitionOutcome;
    completedAt: string;
  }): Promise<void>;
}
export interface CollectorPipelinePorts {
  scopeActive(scope: CollectorScopeDeclaration): Promise<boolean>;
  transport(scope: CollectorScopeDeclaration, checkpoint: number): AsyncIterable<unknown>;
  decode(scope: CollectorScopeDeclaration, raw: unknown): Promise<unknown>;
  checkpoint(scope: CollectorScopeDeclaration, decoded: unknown): Promise<void>;
  recover(scope: CollectorScopeDeclaration): Promise<void>;
  appendImmutable(scope: CollectorScopeDeclaration, decoded: unknown): Promise<void>;
  attributeFirstSeen(scope: CollectorScopeDeclaration, decoded: unknown): Promise<void>;
  emitFeatureUpdate(scope: CollectorScopeDeclaration, decoded: unknown): Promise<void>;
  decodePaused(scopeId: string): Promise<boolean>;
  capacityPaused(scopeId: string): Promise<boolean>;
  acquisitions: AcquisitionRecorder;
}
export class CollectorApplication {
  private stopped = false;
  constructor(
    readonly declaration: CollectorBootDeclaration,
    private readonly ports: CollectorPipelinePorts,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (
      !declaration.collectorInstanceId ||
      !declaration.collectorVersion ||
      declaration.scopes.length === 0 ||
      declaration.backfillLimit < 1
    )
      throw new Error('INCOMPLETE_COLLECTOR_BOOT_DECLARATION');
  }
  stop(): void {
    this.stopped = true;
  }
  async run(): Promise<void> {
    for (const scope of this.declaration.scopes) {
      if (this.stopped) return;
      if (!(await this.ports.scopeActive(scope)))
        throw new Error(`INACTIVE_OR_UNVERIFIED_SCOPE:${scope.scopeId}`);
      if (
        (await this.ports.decodePaused(scope.scopeId)) ||
        (await this.ports.capacityPaused(scope.scopeId))
      )
        continue;
      const acquisitionId = randomUUID();
      await this.ports.acquisitions.open({
        acquisitionId,
        scopeId: scope.scopeId,
        startedAt: this.now().toISOString(),
      });
      let outcome: AcquisitionOutcome = 'EMPTY';
      let returnedAny = false;
      try {
        await this.ports.recover(scope);
        for await (const raw of this.ports.transport(
          scope,
          this.declaration.startCheckpoints[scope.scopeId] ?? 0,
        )) {
          if (this.stopped) break;
          const decoded = await this.ports.decode(scope, raw);
          await this.ports.appendImmutable(scope, decoded);
          await this.ports.attributeFirstSeen(scope, decoded);
          await this.ports.emitFeatureUpdate(scope, decoded);
          // Commit only after every externally visible durable side effect.
          // A replay after an attribution/feature failure must see the event
          // again; advancing earlier could permanently erase first-seen truth.
          await this.ports.checkpoint(scope, decoded);
          returnedAny = true;
          outcome = 'RETURNED_VALID';
        }
      } catch (error) {
        outcome = returnedAny ? 'PARTIAL' : this.classify(error);
      } finally {
        await this.ports.acquisitions.finish({
          acquisitionId,
          outcome,
          completedAt: this.now().toISOString(),
        });
      }
    }
  }
  private classify(error: unknown): AcquisitionOutcome {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('SCHEMA') || message.includes('MALFORMED')) return 'SCHEMA_REJECTED';
    if (message.includes('RIGHTS')) return 'RIGHTS_REJECTED';
    if (message.includes('COST') || message.includes('QUOTA') || message.includes('CAPACITY'))
      return 'COST_OR_QUOTA_BLOCKED';
    if (message.includes('UNSUPPORTED')) return 'UNSUPPORTED';
    if (message.includes('TIMEOUT')) return 'FAILED_TIMEOUT';
    return 'FAILED_NETWORK';
  }
}
