import { createHash } from 'node:crypto';
import type { CollectorScopeDeclaration } from '@foresift/shared-schemas';
export interface PartitionAssignment {
  readonly partitionId: string;
  readonly shard: number;
  readonly scopeId: string;
  readonly scopeVersion: number;
  readonly programId: string;
  readonly programVersion: string;
  readonly account: string;
  readonly eventFamily: string;
  readonly replayStart: number;
  readonly replayEnd: number;
}
function stableInt(value: string): number {
  return Number.parseInt(createHash('sha256').update(value).digest('hex').slice(0, 12), 16);
}
export function createEndpointPlan(
  scopes: readonly CollectorScopeDeclaration[],
  shardCount: number,
  replay: { start: number; end: number },
): readonly PartitionAssignment[] {
  if (
    !Number.isInteger(shardCount) ||
    shardCount < 1 ||
    replay.start < 0 ||
    replay.end < replay.start
  )
    throw new Error('INVALID_SHARD_PLAN');
  const rows: PartitionAssignment[] = [];
  for (const scope of [...scopes].sort((a, b) =>
    `${a.scopeId}:${a.scopeVersion}`.localeCompare(`${b.scopeId}:${b.scopeVersion}`),
  ))
    for (const account of [...scope.accountFilters].sort())
      for (const eventFamily of [...scope.eventFamilies].sort()) {
        const partitionId = `${scope.scopeId}:${scope.scopeVersion}:${account}:${eventFamily}`;
        rows.push({
          partitionId,
          shard: stableInt(partitionId) % shardCount,
          scopeId: scope.scopeId,
          scopeVersion: scope.scopeVersion,
          programId: scope.programId,
          programVersion: scope.programVersion,
          account,
          eventFamily,
          replayStart: replay.start,
          replayEnd: replay.end,
        });
      }
  return rows.sort((a, b) => a.partitionId.localeCompare(b.partitionId));
}
