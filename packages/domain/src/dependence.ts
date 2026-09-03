import type { UtcTimestamp } from './timestamps.ts';

export type DependenceKind = 'DECLARED' | 'EMPIRICAL';

export interface DependenceEdgeValidity {
  readonly edgeId: string;
  readonly sourceA: string;
  readonly sourceB: string;
  readonly dependenceKind: DependenceKind;
  readonly validFrom: UtcTimestamp;
  readonly validUntil: UtcTimestamp | null;
  readonly method: string;
  readonly evidenceIds: readonly string[];
  readonly confidence: number;
  readonly effectiveIndependentCountDelta: number;
  readonly availableAt: UtcTimestamp;
}
