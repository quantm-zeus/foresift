import type { UtcTimestamp } from '@foresift/domain';
import { type AuditChain } from '@foresift/security';
import type { McpClientContext } from '../auth/client-context.ts';

export const MCP_RESOURCE_SCHEMES = [
  'evidence',
  'run',
  'candidate',
  'snapshot',
  'report',
  'conflict',
  'capacity',
  'tradability',
] as const;
export type McpResourceScheme = (typeof MCP_RESOURCE_SCHEMES)[number];

export interface McpResourceAuthorizationInput {
  readonly client: McpClientContext;
  readonly uri: string;
  readonly scheme: McpResourceScheme;
  readonly entity: string;
}

export interface McpResourceAuthorizationDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly rightsMode: 'RAW_ALLOWED' | 'DERIVED_ONLY' | 'REFUSED';
  readonly retentionState: 'ACTIVE' | 'EXPIRED' | 'DELETED';
}

export interface McpResourcePayload {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly recordCount: number;
  readonly decompressedBytes: number;
  readonly rawArtifact?: boolean;
  readonly browserRendered?: boolean;
}

export interface McpResourceResult {
  readonly uri: string;
  readonly contentType: string;
  readonly bytes?: Uint8Array;
  readonly text?: string;
  readonly signedUrl?: string;
}

export interface McpResourceDependencies {
  readonly authorize: (
    input: McpResourceAuthorizationInput,
  ) => Promise<McpResourceAuthorizationDecision>;
  readonly load: (uri: string) => Promise<McpResourcePayload | null>;
  readonly signLargeDownload?: (input: {
    readonly uri: string;
    readonly audience: string;
    readonly actor: string;
    readonly expiresAt: UtcTimestamp;
  }) => Promise<string>;
  readonly auditChain: AuditChain;
  readonly clock?: () => number;
  readonly maximumBytes?: number;
  readonly maximumRecords?: number;
  readonly maximumDecompressedBytes?: number;
  readonly allowedContentTypes?: readonly string[];
  readonly signedUrlThresholdBytes?: number;
}

export class McpResourceError extends Error {
  constructor(
    readonly code:
      | 'RESOURCE_URI_INVALID'
      | 'RESOURCE_UNAUTHORIZED'
      | 'RESOURCE_NOT_FOUND'
      | 'RESOURCE_LIMIT_EXCEEDED'
      | 'RESOURCE_CONTENT_TYPE_REFUSED'
      | 'RESOURCE_RIGHTS_REFUSED',
  ) {
    super(code);
    this.name = 'McpResourceError';
  }
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new McpResourceError('RESOURCE_URI_INVALID');
  }
}

export function parseMcpResourceUri(uri: string): {
  readonly scheme: McpResourceScheme;
  readonly entity: string;
  readonly canonicalUri: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new McpResourceError('RESOURCE_URI_INVALID');
  }
  const scheme = parsed.protocol.slice(0, -1);
  if (!(MCP_RESOURCE_SCHEMES as readonly string[]).includes(scheme)) {
    throw new McpResourceError('RESOURCE_URI_INVALID');
  }
  if (parsed.username !== '' || parsed.password !== '' || parsed.hash !== '') {
    throw new McpResourceError('RESOURCE_URI_INVALID');
  }
  const rawIdentity = `${parsed.hostname}${parsed.pathname}`;
  const decoded = decodeSafe(rawIdentity);
  if (
    decoded === '' ||
    decoded.includes('\\') ||
    decoded.split('/').some((segment) => segment === '..' || segment === '.')
  ) {
    throw new McpResourceError('RESOURCE_URI_INVALID');
  }
  const entity = decoded.replace(/^\/+|\/+$/g, '');
  return {
    scheme: scheme as McpResourceScheme,
    entity,
    canonicalUri: `${scheme}://${entity}${parsed.search}`,
  };
}

function resourceBoundAllows(bounds: readonly string[], uri: string): boolean {
  return bounds.some((bound) => {
    if (bound === '*') return true;
    if (bound.endsWith('*')) return uri.startsWith(bound.slice(0, -1));
    return uri === bound;
  });
}

function sanitizeBrowserText(text: string): string {
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, '')
    .replace(/\s(?:src|href)\s*=\s*(['"])https?:\/\/[\s\S]*?\1/gi, '');
}

export class McpAccessAuditor {
  constructor(
    private readonly chain: AuditChain,
    private readonly clock: () => number = Date.now.bind(globalThis.Date),
  ) {}

  async append(input: {
    readonly actor: string;
    readonly subject: string;
    readonly allowed: boolean;
    readonly detail?: Record<string, unknown>;
  }): Promise<void> {
    await this.chain.append({
      occurredAt: new Date(this.clock()).toISOString() as UtcTimestamp,
      actor: input.actor,
      actionClass: 'TOOL_RESOURCE_ACCESS',
      subject: input.subject,
      payload: {
        allowed: input.allowed,
        ...(input.detail === undefined ? {} : input.detail),
      },
    });
  }
}

export class McpResourceSurface {
  private readonly clock: () => number;
  private readonly auditor: McpAccessAuditor;
  private readonly maximumBytes: number;
  private readonly maximumRecords: number;
  private readonly maximumDecompressedBytes: number;
  private readonly allowedContentTypes: ReadonlySet<string>;
  private readonly signedUrlThresholdBytes: number;

  constructor(private readonly deps: McpResourceDependencies) {
    this.clock = deps.clock ?? Date.now.bind(globalThis.Date);
    this.auditor = new McpAccessAuditor(deps.auditChain, this.clock);
    this.maximumBytes = deps.maximumBytes ?? 1_048_576;
    this.maximumRecords = deps.maximumRecords ?? 100;
    this.maximumDecompressedBytes = deps.maximumDecompressedBytes ?? 4_194_304;
    this.allowedContentTypes = new Set(
      deps.allowedContentTypes ?? ['application/json', 'text/plain', 'text/markdown', 'text/html'],
    );
    this.signedUrlThresholdBytes = deps.signedUrlThresholdBytes ?? 524_288;
  }

  accessAuditor(): McpAccessAuditor {
    return this.auditor;
  }

  async read(uri: string, client: McpClientContext, audience = 'mcp'): Promise<McpResourceResult> {
    let allowed = false;
    let detail: Record<string, unknown> = {};
    try {
      const parsed = parseMcpResourceUri(uri);
      if (
        !client.scopes.includes('resources:read') ||
        !resourceBoundAllows(client.resourceBounds, parsed.canonicalUri)
      ) {
        detail = { reason: 'CREDENTIAL_SCOPE_OR_BOUND' };
        throw new McpResourceError('RESOURCE_UNAUTHORIZED');
      }
      const decision = await this.deps.authorize({ client, uri: parsed.canonicalUri, ...parsed });
      if (
        !decision.allowed ||
        decision.rightsMode === 'REFUSED' ||
        decision.retentionState !== 'ACTIVE'
      ) {
        detail = { reason: decision.reason, retentionState: decision.retentionState };
        throw new McpResourceError('RESOURCE_UNAUTHORIZED');
      }
      const payload = await this.deps.load(parsed.canonicalUri);
      if (payload === null) throw new McpResourceError('RESOURCE_NOT_FOUND');
      const mediaType = payload.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
      if (!this.allowedContentTypes.has(mediaType)) {
        throw new McpResourceError('RESOURCE_CONTENT_TYPE_REFUSED');
      }
      if (
        payload.bytes.byteLength > this.maximumBytes ||
        payload.recordCount > this.maximumRecords ||
        payload.decompressedBytes > this.maximumDecompressedBytes
      ) {
        if (
          payload.bytes.byteLength > this.signedUrlThresholdBytes &&
          this.deps.signLargeDownload !== undefined
        ) {
          const expiresAt = new Date(this.clock() + 5 * 60_000).toISOString() as UtcTimestamp;
          const signedUrl = await this.deps.signLargeDownload({
            uri: parsed.canonicalUri,
            audience,
            actor: client.actorId,
            expiresAt,
          });
          allowed = true;
          return { uri: parsed.canonicalUri, contentType: mediaType, signedUrl };
        }
        throw new McpResourceError('RESOURCE_LIMIT_EXCEEDED');
      }
      if (payload.rawArtifact === true && decision.rightsMode === 'DERIVED_ONLY') {
        throw new McpResourceError('RESOURCE_RIGHTS_REFUSED');
      }
      allowed = true;
      if (payload.browserRendered === true) {
        return {
          uri: parsed.canonicalUri,
          contentType: mediaType,
          text: sanitizeBrowserText(new TextDecoder().decode(payload.bytes)),
        };
      }
      return { uri: parsed.canonicalUri, contentType: mediaType, bytes: payload.bytes };
    } finally {
      await this.auditor.append({
        actor: client.actorId,
        subject: `resource:${uri}`,
        allowed,
        detail,
      });
    }
  }
}
