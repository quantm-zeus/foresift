/** Deterministic provider-safe batch coalescing (FR-COST-005). */
import type { BatchDescriptor } from '@foresift/shared-schemas';

export interface BatchableRequest<T = Readonly<Record<string, unknown>>> {
  readonly providerId: string;
  readonly operationId: string;
  readonly payload: T;
  readonly submittedAtMs?: number;
}

export interface BatchCapability {
  readonly maxBatchSize: number;
  readonly safeMaxUtilization: number;
  readonly keyFields: readonly string[];
  readonly coalescingWindowMs: number;
}

export interface CoalescedBatch<T = Readonly<Record<string, unknown>>> {
  readonly descriptor: BatchDescriptor;
  readonly requests: readonly BatchableRequest<T>[];
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('batch key contains a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  throw new Error('batch key contains an unsupported value');
}

function getPath(payload: unknown, path: string): unknown {
  let cursor = payload;
  for (const part of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null || !(part in cursor)) {
      throw new Error(`batch key field ${path} is absent`);
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

export function deterministicBatchKey<T>(
  request: BatchableRequest<T>,
  keyFields: readonly string[],
): string {
  return canonical({
    providerId: request.providerId,
    operationId: request.operationId,
    keys: keyFields.map((field) => [field, getPath(request.payload, field)]),
  });
}

export class BatchCoalescer {
  coalesce<T>(
    requests: readonly BatchableRequest<T>[],
    capability: BatchCapability,
  ): readonly CoalescedBatch<T>[] {
    if (!Number.isInteger(capability.maxBatchSize) || capability.maxBatchSize <= 0)
      throw new Error('invalid maxBatchSize');
    if (capability.safeMaxUtilization <= 0 || capability.safeMaxUtilization > 1)
      throw new Error('invalid safeMaxUtilization');
    const effectiveMaximum = Math.max(
      1,
      Math.floor(capability.maxBatchSize * capability.safeMaxUtilization),
    );
    const groups = new Map<string, BatchableRequest<T>[]>();
    for (const request of requests) {
      const key = deterministicBatchKey(request, capability.keyFields);
      const bucket = groups.get(key) ?? [];
      bucket.push(request);
      groups.set(key, bucket);
    }
    const output: CoalescedBatch<T>[] = [];
    for (const key of [...groups.keys()].sort()) {
      const compatible = groups.get(key)!;
      compatible.sort((a, b) => (a.submittedAtMs ?? 0) - (b.submittedAtMs ?? 0));
      let chunk: BatchableRequest<T>[] = [];
      let windowStart = 0;
      const flush = (): void => {
        if (chunk.length === 0) return;
        const first = chunk[0]!;
        output.push({
          descriptor: {
            providerId: first.providerId,
            operationId: first.operationId,
            batchKey: key,
            itemCount: chunk.length,
            maxBatchSize: capability.maxBatchSize,
            utilization: chunk.length / capability.maxBatchSize,
          },
          requests: chunk,
        });
        chunk = [];
      };
      for (const request of compatible) {
        const submitted = request.submittedAtMs ?? 0;
        if (chunk.length === 0) windowStart = submitted;
        if (
          chunk.length >= effectiveMaximum ||
          submitted - windowStart > capability.coalescingWindowMs
        ) {
          flush();
          windowStart = submitted;
        }
        chunk.push(request);
      }
      flush();
    }
    return output;
  }

  async execute<T, R>(
    requests: readonly BatchableRequest<T>[],
    capability: BatchCapability,
    providerCall: (batch: CoalescedBatch<T>) => Promise<R>,
  ): Promise<readonly { readonly descriptor: BatchDescriptor; readonly result: R }[]> {
    const results = [];
    for (const batch of this.coalesce(requests, capability)) {
      results.push({ descriptor: batch.descriptor, result: await providerCall(batch) });
    }
    return results;
  }
}
