export interface CollectorEndpoint {
  readonly endpointId: string;
  readonly url: string;
  readonly priority: number;
}
export interface ReplayCursor {
  readonly partitionId: string;
  readonly committedPosition: number;
  readonly fencingToken: number;
}
export interface SubscriptionEnvelope {
  readonly endpointId: string;
  readonly connectionGeneration: number;
  readonly payload: unknown;
}
export interface ReadOnlySubscriptionPort {
  readonly endpoints: readonly CollectorEndpoint[];
  subscribe(request: unknown, replay: ReplayCursor): AsyncIterable<SubscriptionEnvelope>;
  poll(request: unknown, replay: ReplayCursor): Promise<readonly SubscriptionEnvelope[]>;
  close(): Promise<void>;
}
export function selectEndpoint(
  endpoints: readonly CollectorEndpoint[],
  failureCount: number,
): CollectorEndpoint {
  if (endpoints.length === 0) throw new Error('NO_CONFIGURED_ENDPOINT');
  const ordered = [...endpoints].sort(
    (a, b) => a.priority - b.priority || a.endpointId.localeCompare(b.endpointId),
  );
  return ordered[failureCount % ordered.length] as CollectorEndpoint;
}
