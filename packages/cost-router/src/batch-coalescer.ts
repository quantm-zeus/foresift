/** Deterministic, compatibility-safe provider batch coalescing (FR-COST-005). */
import { createHash } from 'node:crypto';
import type { CostBatchCapability, BatchDescriptor } from '@foresift/shared-schemas';
import { CostBatchCapabilitySchema, BatchDescriptorSchema } from '@foresift/shared-schemas';

export interface CoalescibleRequest<T = unknown> {
  readonly requestId: string;
  readonly provider: string;
  readonly operation: string;
  readonly operationVersion?: string;
  readonly chain?: string;
  readonly fieldProjection?: readonly string[];
  readonly freshnessPolicy?: string;
  readonly asOf?: string;
  readonly licensePolicyId?: string;
  readonly deadlineAt?: string;
  /** Deterministic arrival instant used to enforce the coalescing window. */
  readonly receivedAt?: string | number;
  readonly payload: T;
}

export interface CoalescedBatch<T = unknown> {
  readonly descriptor: BatchDescriptor;
  readonly requests: readonly CoalescibleRequest<T>[];
}

function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function fieldAt(request: CoalescibleRequest, path: string): unknown {
  const segments = path.split('.');
  let value: unknown =
    path in request ? (request as unknown as Record<string, unknown>)[path] : request.payload;
  if (path in request) return value;
  for (const segment of segments) {
    if (typeof value !== 'object' || value === null || !(segment in value)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

/** Bit-for-bit stable compatibility key; provider is always present. */
export function deterministicBatchKey(
  request: CoalescibleRequest,
  capability: Pick<CostBatchCapability, 'keyFields'>,
): string {
  const mandatory = {
    provider: request.provider,
    operation: request.operation,
    operationVersion: request.operationVersion ?? null,
    chain: request.chain ?? null,
    fieldProjection:
      request.fieldProjection === undefined ? null : [...request.fieldProjection].sort(),
    freshnessPolicy: request.freshnessPolicy ?? null,
    asOf: request.asOf ?? null,
    licensePolicyId: request.licensePolicyId ?? null,
  };
  const selected = Object.fromEntries(
    [...capability.keyFields].sort().map((field) => [field, fieldAt(request, field) ?? null]),
  );
  return canonical({ mandatory, selected });
}

export function coalesceBatches<T>(
  requests: readonly CoalescibleRequest<T>[],
  rawCapability: CostBatchCapability,
): readonly CoalescedBatch<T>[] {
  const capability = CostBatchCapabilitySchema.parse(rawCapability);
  const safeSize = Math.max(
    1,
    Math.min(
      capability.maxBatchSize,
      Math.floor(capability.maxBatchSize * capability.safeMaxUtilization),
    ),
  );
  const groups = new Map<string, CoalescibleRequest<T>[]>();
  for (const request of requests) {
    if (
      request.requestId.length === 0 ||
      request.provider.length === 0 ||
      request.operation.length === 0
    ) {
      throw new Error('batch requests require requestId, provider, and operation');
    }
    const key = deterministicBatchKey(request, capability);
    const group = groups.get(key) ?? [];
    group.push(request);
    groups.set(key, group);
  }
  const batches: CoalescedBatch<T>[] = [];
  for (const [key, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const arrival = (request: CoalescibleRequest<T>): number => {
      if (request.receivedAt === undefined) return 0;
      const value =
        typeof request.receivedAt === 'number'
          ? request.receivedAt
          : new Date(request.receivedAt).getTime();
      if (!Number.isFinite(value)) throw new Error(`invalid receivedAt for ${request.requestId}`);
      return value;
    };
    const ordered = [...group].sort(
      (a, b) => arrival(a) - arrival(b) || a.requestId.localeCompare(b.requestId),
    );
    const windows: CoalescibleRequest<T>[][] = [];
    let current: CoalescibleRequest<T>[] = [];
    for (const request of ordered) {
      const outsideWindow =
        current.length > 0 &&
        arrival(request) - arrival(current[0]!) > capability.coalescingWindowMs;
      if (current.length >= safeSize || outsideWindow) {
        windows.push(current);
        current = [];
      }
      current.push(request);
    }
    if (current.length > 0) windows.push(current);
    for (const members of windows) {
      const first = members[0]!;
      const digest = createHash('sha256')
        .update(`${key}\u0000${members.map((member) => member.requestId).join('\u0000')}`)
        .digest('hex');
      const descriptor = BatchDescriptorSchema.parse({
        batchId: `sha256:${digest}`,
        provider: first.provider,
        operation: first.operation,
        ...(first.operationVersion === undefined
          ? {}
          : { operationVersion: first.operationVersion }),
        requestIds: members.map((member) => member.requestId),
        deterministicKey: key,
        maxBatchSize: capability.maxBatchSize,
        utilization: members.length / capability.maxBatchSize,
      });
      batches.push({ descriptor, requests: members });
    }
  }
  return batches;
}

export class BatchCoalescer {
  coalesce<T>(
    requests: readonly CoalescibleRequest<T>[],
    capability: CostBatchCapability,
  ): readonly CoalescedBatch<T>[] {
    return coalesceBatches(requests, capability);
  }
}

export const coalesceBatchRequests = coalesceBatches;

export function computeBatchKey(
  provider: string,
  operation: string,
  keyFields: Readonly<Record<string, unknown>>,
): string {
  return `batch_key:${createHash('sha256')
    .update(canonical({ provider, operation, keyFields }))
    .digest('hex')}`;
}

export function coalesceRequests<T extends { provider: string; operation: string }>(
  requests: readonly T[],
  capability: { readonly maxBatchSize: number; readonly safeMaxUtilization: number },
): readonly {
  batchId: string;
  provider: string;
  operation: string;
  items: readonly T[];
  utilization: number;
}[] {
  if (!Number.isInteger(capability.maxBatchSize) || capability.maxBatchSize <= 0)
    throw new RangeError('maxBatchSize must be positive');
  if (capability.safeMaxUtilization <= 0 || capability.safeMaxUtilization > 1)
    throw new RangeError('safeMaxUtilization must be in (0,1]');
  const safeSize = Math.max(1, Math.floor(capability.maxBatchSize * capability.safeMaxUtilization));
  const groups = new Map<string, T[]>();
  for (const request of requests) {
    const key = `${request.provider}\u0000${request.operation}`;
    const values = groups.get(key) ?? [];
    values.push(request);
    groups.set(key, values);
  }
  const result = [];
  for (const [groupKey, items] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (let offset = 0; offset < items.length; offset += safeSize) {
      const members = items.slice(offset, offset + safeSize);
      const first = members[0]!;
      result.push({
        batchId: computeBatchKey(first.provider, first.operation, { groupKey, offset }),
        provider: first.provider,
        operation: first.operation,
        items: members,
        utilization: members.length / capability.maxBatchSize,
      });
    }
  }
  return result;
}

export async function processBatchRequests<T>(input: {
  readonly provider: string;
  readonly operation: string;
  readonly items: readonly T[];
  readonly batchCapability: { readonly maxBatchSize: number; readonly safeMaxUtilization: number };
}): Promise<{
  readonly batches: readonly { batchId: string; itemCount: number; utilization: number }[];
  readonly reservationCount: number;
}> {
  const batches = coalesceRequests(
    input.items.map((item) => ({ provider: input.provider, operation: input.operation, item })),
    input.batchCapability,
  );
  return {
    batches: batches.map((batch) => ({
      batchId: batch.batchId,
      itemCount: batch.items.length,
      utilization: batch.utilization,
    })),
    reservationCount: batches.length,
  };
}

export async function processMixedRequests<T extends { provider: string; operation: string }>(
  requests: readonly T[],
): Promise<{
  readonly providerBatches: Readonly<Record<string, number>>;
  readonly totalReservations: number;
}> {
  const batches = coalesceRequests(requests, {
    maxBatchSize: Number.MAX_SAFE_INTEGER,
    safeMaxUtilization: 1,
  });
  const providerBatches: Record<string, number> = {};
  for (const batch of batches)
    providerBatches[batch.provider] = (providerBatches[batch.provider] ?? 0) + 1;
  return { providerBatches, totalReservations: batches.length };
}
