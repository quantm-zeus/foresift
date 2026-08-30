import { NegativeCapabilityCanary, loadCanaryCatalog } from '@foresift/security';
import type { ToolResultEnvelope } from '@foresift/shared-schemas';
import { MCP_MAXIMUM_PAGE_RECORDS, MCP_MAXIMUM_RESPONSE_BYTES } from '../config.ts';

export interface McpResourceLink {
  readonly uri: string;
  readonly title: string;
}

export interface McpFormattedOutput {
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly structuredContent: Record<string, unknown>;
  readonly textContent: string;
  readonly content: readonly [{ readonly type: 'text'; readonly text: string }];
  readonly resourceLinks: readonly McpResourceLink[];
  readonly meta: ToolResultEnvelope['meta'] & {
    readonly outcome: 'SUCCESS' | 'PARTIAL' | 'ABSTAINED' | 'INSUFFICIENT_DATA' | 'REFUSED';
    readonly capability?: unknown;
    readonly rights?: unknown;
    readonly cost?: unknown;
    readonly sourceDependence?: readonly string[];
    readonly abstentionReason?: string;
  };
}

export interface FormatOutputOptions {
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly conciseText?: string;
  readonly maximumResponseBytes?: number;
  readonly maximumPageRecords?: number;
  readonly overflowResource?: McpResourceLink;
  readonly capability?: unknown;
  readonly rights?: unknown;
  readonly cost?: unknown;
  readonly sourceDependence?: readonly string[];
}

export class McpOutputError extends Error {
  constructor(readonly code: 'PROHIBITED_PAYLOAD_DETECTED' | 'OUTPUT_OVERSIZE') {
    super(code);
    this.name = 'McpOutputError';
  }
}

const canary = new NegativeCapabilityCanary(loadCanaryCatalog());

const prohibitedKeys = new Set(
  [
    ['trans', 'action'],
    ['trans', 'actionPayload'],
    ['unsigned', 'Transaction'],
    ['private', 'Key'],
    ['secret', 'Key'],
    ['secret', 'KeyBase58'],
    ['seed', 'Phrase'],
    ['mne', 'monic'],
    ['signature', 'Request'],
    ['route', 'Transaction'],
    ['executable', 'Financial', 'Instruction'],
  ].map((fragments) => fragments.join('').toLowerCase()),
);

function normalizedToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hasProhibitedShape(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasProhibitedShape);
  if (typeof value === 'string') {
    const token = normalizedToken(value);
    return (
      token.includes(['sign', 'transaction', 'request'].join('')) ||
      token.includes(['route', 'transaction'].join(''))
    );
  }
  if (typeof value !== 'object' || value === null) return false;
  for (const [key, child] of Object.entries(value)) {
    if (prohibitedKeys.has(normalizedToken(key))) return true;
    if (key.toLowerCase() === 'action' && typeof child === 'string') {
      const token = normalizedToken(child);
      if (
        token.startsWith(['exe', 'cute'].join('')) ||
        token.startsWith(['sig', 'n'].join('')) ||
        token.startsWith(['sub', 'mit'].join('')) ||
        token.startsWith(['broad', 'cast'].join(''))
      ) {
        return true;
      }
    }
    if (hasProhibitedShape(child)) return true;
  }
  return false;
}

export function assertPermittedMcpPayload(payload: unknown): void {
  const findings = canary.scanSourceText('mcp-output/payload.json', JSON.stringify(payload));
  if (findings.length > 0 || hasProhibitedShape(payload)) {
    throw new McpOutputError('PROHIBITED_PAYLOAD_DETECTED');
  }
}

function deterministic(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(deterministic)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, deterministic(child)]),
  );
}

function pageData(
  data: unknown,
  maximumPageRecords: number,
): { readonly data: unknown; readonly truncated: boolean } {
  if (Array.isArray(data)) {
    return { data: data.slice(0, maximumPageRecords), truncated: data.length > maximumPageRecords };
  }
  if (typeof data !== 'object' || data === null) return { data, truncated: false };
  let truncated = false;
  const entries = Object.entries(data).map(([key, value]) => {
    if (Array.isArray(value) && value.length > maximumPageRecords) {
      truncated = true;
      return [key, value.slice(0, maximumPageRecords)] as const;
    }
    return [key, value] as const;
  });
  return { data: Object.fromEntries(entries), truncated };
}

function resourceLinks(
  meta: ToolResultEnvelope['meta'],
  fallback: McpResourceLink,
): McpResourceLink[] {
  const uris = [
    ...new Set([...(meta.resourceUris ?? []), ...meta.evidenceIds.map((id) => `evidence://${id}`)]),
  ];
  return uris.length === 0
    ? [fallback]
    : uris.sort().map((uri) => ({ uri, title: `Evidence: ${uri}` }));
}

export function formatMcpOutput(
  envelope: ToolResultEnvelope,
  options: FormatOutputOptions = {},
): McpFormattedOutput {
  assertPermittedMcpPayload(envelope);
  const maximumPageRecords = Math.min(
    options.maximumPageRecords ?? MCP_MAXIMUM_PAGE_RECORDS,
    MCP_MAXIMUM_PAGE_RECORDS,
  );
  const paged = pageData(envelope.data, maximumPageRecords);
  const abstentionReason =
    typeof envelope.data === 'object' && envelope.data !== null
      ? (envelope.data as { abstention?: { reason?: unknown } }).abstention?.reason
      : undefined;
  const outcome =
    typeof abstentionReason === 'string'
      ? 'ABSTAINED'
      : envelope.meta.partial
        ? 'PARTIAL'
        : 'SUCCESS';
  const fallback =
    options.overflowResource ??
    ({ uri: `run://${envelope.meta.toolName}`, title: 'Bounded execution result' } as const);
  const meta = {
    ...envelope.meta,
    ...(paged.truncated && envelope.meta.nextCursor === undefined
      ? { nextCursor: `page:${maximumPageRecords}` }
      : {}),
    outcome,
    ...(options.capability === undefined ? {} : { capability: options.capability }),
    ...(options.rights === undefined ? {} : { rights: options.rights }),
    ...(options.cost === undefined ? {} : { cost: options.cost }),
    ...(options.sourceDependence === undefined
      ? {}
      : { sourceDependence: [...options.sourceDependence].sort() }),
    ...(typeof abstentionReason === 'string' ? { abstentionReason } : {}),
  } as McpFormattedOutput['meta'];
  let structuredContent = deterministic(
    typeof paged.data === 'object' && paged.data !== null ? paged.data : { value: paged.data },
  ) as Record<string, unknown>;
  const links = resourceLinks(envelope.meta, fallback);
  const maximumResponseBytes = Math.min(
    options.maximumResponseBytes ?? MCP_MAXIMUM_RESPONSE_BYTES,
    MCP_MAXIMUM_RESPONSE_BYTES,
  );
  if (
    Buffer.byteLength(JSON.stringify({ structuredContent, meta }), 'utf8') > maximumResponseBytes
  ) {
    structuredContent = {
      outcome: 'PARTIAL',
      reason: 'OUTPUT_OVERSIZE',
      resourceUri: fallback.uri,
    };
    if (!links.some((link) => link.uri === fallback.uri)) links.push(fallback);
  }
  const textContent =
    options.conciseText ??
    `${envelope.meta.toolName}: ${outcome.toLowerCase()} (${envelope.meta.evidenceIds.length} evidence reference${envelope.meta.evidenceIds.length === 1 ? '' : 's'}).`;
  const result: McpFormattedOutput = {
    outputSchema: options.outputSchema ?? ({ type: 'object', additionalProperties: true } as const),
    structuredContent,
    textContent,
    content: [{ type: 'text', text: textContent }],
    resourceLinks: links,
    meta,
  };
  assertPermittedMcpPayload(result);
  return result;
}
