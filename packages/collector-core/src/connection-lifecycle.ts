import type { CollectorEndpoint, ReplayCursor } from './subscription-port.ts';
import { selectEndpoint } from './subscription-port.ts';
export interface BackoffPolicy {
  readonly initialMs: number;
  readonly maximumMs: number;
  readonly multiplier: number;
  readonly jitterRatio: number;
  readonly seed: string;
}
function hash(seed: string): number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function boundedReconnectDelay(attempt: number, policy: BackoffPolicy): number {
  if (
    !Number.isInteger(attempt) ||
    attempt < 0 ||
    !Number.isFinite(policy.initialMs) ||
    policy.initialMs < 0 ||
    !Number.isFinite(policy.maximumMs) ||
    policy.maximumMs < policy.initialMs ||
    !Number.isFinite(policy.multiplier) ||
    policy.multiplier < 1 ||
    !Number.isFinite(policy.jitterRatio) ||
    policy.jitterRatio < 0 ||
    policy.jitterRatio > 1 ||
    policy.seed.length === 0
  )
    throw new Error('INVALID_RECONNECT_BACKOFF_POLICY');
  const base = Math.min(
    policy.maximumMs,
    policy.initialMs * policy.multiplier ** Math.max(0, attempt),
  );
  const unit = (hash(`${policy.seed}:${attempt}`) / 0xffffffff) * 2 - 1;
  return Math.max(
    0,
    Math.min(policy.maximumMs, Math.round(base * (1 + unit * policy.jitterRatio))),
  );
}
export class ConnectionLifecycle {
  private generation = 0;
  private failures = 0;
  constructor(
    private readonly endpoints: readonly CollectorEndpoint[],
    private readonly policy: BackoffPolicy,
  ) {
    if (
      endpoints.length === 0 ||
      new Set(endpoints.map((endpoint) => endpoint.endpointId)).size !== endpoints.length ||
      endpoints.some(
        (endpoint) =>
          endpoint.endpointId.length === 0 ||
          endpoint.url.length === 0 ||
          !Number.isFinite(endpoint.priority),
      )
    )
      throw new Error('INVALID_FIXED_ENDPOINT_CONFIGURATION');
    // Validate the policy at construction, before a failure path needs it.
    boundedReconnectDelay(0, policy);
  }
  connect(replay: ReplayCursor): {
    endpoint: CollectorEndpoint;
    generation: number;
    replayFrom: number;
    fencingToken: number;
    delayMs: number;
  } {
    this.generation += 1;
    const endpoint = selectEndpoint(this.endpoints, this.failures);
    const delayMs = this.failures === 0 ? 0 : boundedReconnectDelay(this.failures - 1, this.policy);
    return {
      endpoint,
      generation: this.generation,
      replayFrom: replay.committedPosition,
      fencingToken: replay.fencingToken + this.generation,
      delayMs,
    };
  }
  failed(): void {
    this.failures += 1;
  }
  healthy(): void {
    this.failures = 0;
  }
}
