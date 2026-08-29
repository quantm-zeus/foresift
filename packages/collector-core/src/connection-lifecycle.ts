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
  ) {}
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
