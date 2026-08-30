import { McpProtocolGuard, type ProtocolInspectionInput } from '@foresift/security';

export type JsonRpcId = string | number | null;
export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export type ProtocolAdmission =
  | { readonly allowed: true; readonly request: JsonRpcRequest; readonly protocolRevision: string }
  | {
      readonly allowed: false;
      readonly status: 400 | 405 | 413 | 415;
      readonly code: string;
      readonly reason: string;
    };

export interface ProtocolWiringOptions {
  readonly baselineRevision: string;
  readonly mutuallyTestedRevisions?: readonly string[];
  readonly draftRevisions?: readonly string[];
  readonly optInDraftRevisions?: readonly string[];
  readonly maximumRequestBytes: number;
}

function isJsonRpcRequest(payload: unknown): payload is JsonRpcRequest {
  if (typeof payload !== 'object' || payload === null) return false;
  const value = payload as Record<string, unknown>;
  return (
    value.jsonrpc === '2.0' &&
    (typeof value.id === 'string' || typeof value.id === 'number' || value.id === null) &&
    typeof value.method === 'string' &&
    value.method.length > 0
  );
}

export class McpProtocolWiring {
  private readonly guard: McpProtocolGuard;

  constructor(options: ProtocolWiringOptions) {
    const stable = options.mutuallyTestedRevisions ?? [options.baselineRevision];
    const optedDrafts = (options.optInDraftRevisions ?? []).filter((revision) =>
      (options.draftRevisions ?? []).includes(revision),
    );
    this.guard = new McpProtocolGuard({
      allowedRevisions: [...new Set([...stable, ...optedDrafts])],
      maxMessageBytes: options.maximumRequestBytes,
    });
  }

  inspect(input: ProtocolInspectionInput & { readonly payload: unknown }): ProtocolAdmission {
    const verdict = this.guard.inspect(input);
    if (verdict.decision === 'REFUSE') {
      const status =
        verdict.reason === 'MESSAGE_OVERSIZE'
          ? 413
          : verdict.reason === 'CONTENT_TYPE_INVALID'
            ? 415
            : verdict.reason === 'METHOD_INVALID'
              ? 405
              : 400;
      return { allowed: false, status, code: verdict.reason, reason: verdict.reason };
    }
    if (!isJsonRpcRequest(input.payload)) {
      return { allowed: false, status: 400, code: 'JSON_RPC_INVALID', reason: 'JSON_RPC_INVALID' };
    }
    return {
      allowed: true,
      request: input.payload,
      protocolRevision: input.protocolRevision as string,
    };
  }

  correlate<T>(request: JsonRpcRequest, result: T): { jsonrpc: '2.0'; id: JsonRpcId; result: T } {
    return { jsonrpc: '2.0', id: request.id, result };
  }
}

export function createProtocolWiring(options: ProtocolWiringOptions): McpProtocolWiring {
  return new McpProtocolWiring(options);
}

/** Structural SDK seam; server.ts binds this to StreamableHTTPServerTransport. */
export interface StreamableHttpTransport {
  handleRequest(request: unknown, response: unknown, body?: unknown): Promise<void>;
  close?(): Promise<void>;
}
