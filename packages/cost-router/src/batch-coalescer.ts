import type { OperationCostDeclaration } from '@foresift/shared-schemas';

export interface BatchRequest<T = unknown> {
  readonly provider: string;
  readonly operation: string;
  readonly input: T;
}
export interface CoalescedBatch<T = unknown> {
  readonly provider: string;
  readonly operation: string;
  readonly key: string;
  readonly items: readonly BatchRequest<T>[];
  readonly utilization: number;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(object[k])}`)
    .join(',')}}`;
}

export function deterministicBatchKey<T>(
  request: BatchRequest<T>,
  keyFields: readonly string[],
): string {
  const input =
    request.input !== null && typeof request.input === 'object'
      ? (request.input as Record<string, unknown>)
      : {};
  return canonical({
    provider: request.provider,
    operation: request.operation,
    fields: Object.fromEntries([...keyFields].sort().map((field) => [field, input[field]])),
  });
}

export class BatchCoalescer {
  coalesce<T>(
    requests: readonly BatchRequest<T>[],
    capability: OperationCostDeclaration['batchCapability'],
  ): readonly CoalescedBatch<T>[] {
    if (capability === null)
      return requests.map((request) => ({
        provider: request.provider,
        operation: request.operation,
        key: deterministicBatchKey(request, []),
        items: [request],
        utilization: 1,
      }));
    const safeSize = Math.max(
      1,
      Math.floor(capability.maxBatchSize * capability.safeMaxUtilization),
    );
    const groups = new Map<string, BatchRequest<T>[]>();
    for (const request of requests) {
      const key = deterministicBatchKey(request, capability.keyFields);
      const group = groups.get(key) ?? [];
      group.push(request);
      groups.set(key, group);
    }
    const batches: CoalescedBatch<T>[] = [];
    for (const [key, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      for (let offset = 0; offset < group.length; offset += safeSize) {
        const items = group.slice(offset, offset + safeSize);
        const first = items[0]!;
        batches.push({
          provider: first.provider,
          operation: first.operation,
          key,
          items,
          utilization: items.length / capability.maxBatchSize,
        });
      }
    }
    return batches;
  }
}
