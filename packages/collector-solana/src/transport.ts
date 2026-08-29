import { EgressGuard } from '@foresift/security';
import type {
  CollectorEndpoint,
  ReadOnlySubscriptionPort,
  ReplayCursor,
  SubscriptionEnvelope,
} from '@foresift/collector-core';
export interface RawSolanaMessage {
  readonly chainId: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly slot: number;
  readonly accountAddress: string | null;
  readonly accountLayoutHash: string;
  readonly byteLength: number;
  readonly decoderVersion: string;
  readonly payload: unknown;
}
export interface InboundContract {
  readonly chainId: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly accountLayouts: readonly string[];
  readonly maximumBytes: number;
  readonly decoderVersion: string;
}
export interface SolanaWireAdapter {
  stream(endpoint: CollectorEndpoint, request: unknown, position: number): AsyncIterable<unknown>;
  poll(
    endpoint: CollectorEndpoint,
    request: unknown,
    position: number,
    limit: number,
  ): Promise<readonly unknown[]>;
  close(): Promise<void>;
}
export class MalformedCollectorMessageError extends Error {
  readonly code = 'MALFORMED_COLLECTOR_MESSAGE' as const;
}
export function validateInboundMessage(
  value: unknown,
  contract: InboundContract,
): RawSolanaMessage {
  if (typeof value !== 'object' || value === null)
    throw new MalformedCollectorMessageError('object required');
  const v = value as Partial<RawSolanaMessage>;
  if (
    v.chainId !== contract.chainId ||
    v.programId !== contract.programId ||
    v.programVersion !== contract.programVersion ||
    !Number.isInteger(v.slot) ||
    Number(v.slot) < 0 ||
    typeof v.accountLayoutHash !== 'string' ||
    !contract.accountLayouts.includes(v.accountLayoutHash) ||
    typeof v.byteLength !== 'number' ||
    v.byteLength < 0 ||
    v.byteLength > contract.maximumBytes ||
    v.decoderVersion !== contract.decoderVersion
  )
    throw new MalformedCollectorMessageError(
      'chain/program/version/slot/layout/size/decoder contract refused',
    );
  return v as RawSolanaMessage;
}
export class SolanaTransport implements ReadOnlySubscriptionPort {
  private generation = 0;
  readonly endpoints: readonly CollectorEndpoint[];
  constructor(
    endpoints: readonly CollectorEndpoint[],
    private readonly egress: EgressGuard,
    private readonly wire: SolanaWireAdapter,
    private readonly contract: InboundContract,
    private readonly pollLimit: number = 100,
  ) {
    if (endpoints.length === 0 || pollLimit < 1) throw new Error('FIXED_ENDPOINTS_REQUIRED');
    this.endpoints = [...endpoints].sort(
      (a, b) => a.priority - b.priority || a.endpointId.localeCompare(b.endpointId),
    );
  }
  private async authorize(endpoint: CollectorEndpoint): Promise<void> {
    const guardUrl = endpoint.url.startsWith('wss:')
      ? `https:${endpoint.url.slice(4)}`
      : endpoint.url;
    const decision = await this.egress.authorize(guardUrl, 'COLLECTOR');
    if (decision.decision !== 'ALLOW') throw new Error(`EGRESS_REFUSED:${decision.reason}`);
  }
  async *subscribe(request: unknown, replay: ReplayCursor): AsyncIterable<SubscriptionEnvelope> {
    const endpoint = this.endpoints[0] as CollectorEndpoint;
    await this.authorize(endpoint);
    this.generation += 1;
    for await (const raw of this.wire.stream(endpoint, request, replay.committedPosition)) {
      const payload = validateInboundMessage(raw, this.contract);
      yield { endpointId: endpoint.endpointId, connectionGeneration: this.generation, payload };
    }
  }
  async poll(request: unknown, replay: ReplayCursor): Promise<readonly SubscriptionEnvelope[]> {
    const endpoint = this.endpoints[0] as CollectorEndpoint;
    await this.authorize(endpoint);
    this.generation += 1;
    const rows = await this.wire.poll(endpoint, request, replay.committedPosition, this.pollLimit);
    return rows.map((raw) => ({
      endpointId: endpoint.endpointId,
      connectionGeneration: this.generation,
      payload: validateInboundMessage(raw, this.contract),
    }));
  }
  close(): Promise<void> {
    return this.wire.close();
  }
}
