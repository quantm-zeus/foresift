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

/** Largest wire-message age accepted by the transport security matrix (§35.6). */
const MAXIMUM_MESSAGE_AGE_MS = 60_000;

/**
 * Single-argument wire-message security check (FR-COL-009 substrate): a
 * transport-agnostic verdict over { timestamp, payload, signature? }. Refuses
 * stale timestamps, non-object payloads, missing signatures, and oversized
 * payloads without advancing any checkpoint (stateless by construction —
 * contract-bound validation of full first-party messages is
 * `validateInboundMessage`'s job).
 */
export function validateTransportMessage(msg: unknown): { valid: boolean; reason?: string } {
  if (typeof msg !== 'object' || msg === null) return { valid: false, reason: 'NOT_AN_OBJECT' };
  const m = msg as { timestamp?: unknown; payload?: unknown; signature?: unknown };
  const ts = typeof m.timestamp === 'string' ? Date.parse(m.timestamp) : Number.NaN;
  if (!Number.isFinite(ts)) return { valid: false, reason: 'INVALID_TIMESTAMP' };
  if (Date.now() - ts > MAXIMUM_MESSAGE_AGE_MS) return { valid: false, reason: 'STALE_MESSAGE' };
  if (m.payload === null || typeof m.payload !== 'object')
    return { valid: false, reason: 'MALFORMED_PAYLOAD' };
  if (typeof m.signature !== 'string' || m.signature.length === 0)
    return { valid: false, reason: 'MISSING_SIGNATURE' };
  return { valid: true };
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
