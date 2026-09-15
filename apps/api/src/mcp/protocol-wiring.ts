import { MCP_BASELINE_STABLE_REVISION } from '@foresift/domain';
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

/**
 * The GOVERNED MCP compatibility admission this adapter consumes.
 *
 * This is the structural shape of `McpCompatibilityResolution` produced by
 * `resolveCompatibilityMatrix` / `resolveProtocolRevision` in
 * `@foresift/capability-registry`. It MUST be the resolver's output — the
 * adapter derives its guard allow-list ONLY from `usableRevisions`, and the
 * resolver owns registration, draft-channel and mutual-testing validation. Never
 * assemble this object from caller-supplied revision strings: a free-form
 * revision list admits an unregistered revision the server would refuse to
 * serve (V7-F9).
 *
 * This adapter has NO in-tree production constructor today (`mcp/server.ts`
 * imports only the type), so the composition root must call the resolver when
 * wiring production.
 */
export interface McpCompatibilityAdmission {
  /** `McpCompatibilityResolution.defaultRevision`; must be the stable baseline. */
  readonly defaultRevision: string;
  /**
   * `McpCompatibilityResolution.usableRevisions` — the stable allow-list.
   * Non-empty, all syntactically valid protocol revisions, no duplicates; the
   * guard allow-list is `usableRevisions ∪ optInRevisions` and must contain
   * `defaultRevision`.
   */
  readonly usableRevisions: readonly string[];
  /**
   * `McpCompatibilityResolution.optInRevisions` — the validated opt-in drafts.
   * Each is admitted into the guard allow-list (union with `usableRevisions`),
   * exactly as `resolveProtocolRevision` does.
   */
  readonly optInRevisions: readonly string[];
}

export interface ProtocolWiringOptions {
  /**
   * REQUIRED. The governed resolver output, never a caller-assembled
   * allow-list. See {@link McpCompatibilityAdmission}.
   */
  readonly admission: McpCompatibilityAdmission;
  readonly maximumRequestBytes: number;
}

/**
 * Residual (recorded precisely): an identity-branded proof (a private `WeakSet`
 * brand on the resolver's returned object, as the activation gate uses) is not
 * possible without a runtime dependency on `@foresift/capability-registry`, so
 * this adapter enforces the governed SHAPE plus the §69.7 revision syntax, and
 * the composition root MUST call `resolveCompatibilityMatrix` /
 * `resolveProtocolRevision`. The demonstrated free-form probe
 * (`mutuallyTestedRevisions: ['TOTALLY-UNREGISTERED-EVIL']`, and any bare
 * `allowedRevisions` list) is refused; a caller that deliberately hand-builds
 * the resolver-shaped object can still satisfy the shape, which is the recorded
 * D013 trusted-caller residual (the adapter has no in-tree production
 * constructor).
 */

/** §69.7 protocol revisions are date-prefixed (`2025-11-25`, `2026-draft-v2`). */
const MCP_PROTOCOL_REVISION_MAX_LENGTH = 64;
const MCP_PROTOCOL_REVISION_PATTERN = /^\d{4}-[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isSyntacticProtocolRevision(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MCP_PROTOCOL_REVISION_MAX_LENGTH &&
    MCP_PROTOCOL_REVISION_PATTERN.test(value)
  );
}

function failAdmission(detail: string): never {
  throw new TypeError(
    `MCP protocol admission must be the governed resolveCompatibilityMatrix/resolveProtocolRevision output (${detail}); a caller-assembled revision allow-list is refused`,
  );
}

/** Numeric-index copy; never spread or `Array.prototype` helpers. */
function copyRevisions(source: readonly string[]): string[] {
  const copy: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    copy[copy.length] = source[index] as string;
  }
  return copy;
}

/**
 * Fail-closed validation of the governed admission (V7-F9). Reads every input
 * ONCE into locals, then returns a FROZEN normalized copy built from those
 * locals, so a getter/Proxy carrier cannot present one set of revisions to the
 * validation and another to the guard. Throws a clear `TypeError` on any
 * violation; never returns a caller object by reference.
 *
 * The admit-list is the UNION `usableRevisions ∪ optInRevisions`, matching
 * `resolveProtocolRevision`; the real resolver keeps its validated opt-in drafts
 * OUT of `usableRevisions`, so requiring membership would reject genuine
 * resolver output.
 */
function normalizeGovernedAdmission(raw: unknown): McpCompatibilityAdmission {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    failAdmission('the admission is not an object');
  }
  const source = raw as Record<string, unknown>;
  const defaultRevision = source['defaultRevision'];
  const usableRaw = source['usableRevisions'];
  const optInRaw = source['optInRevisions'];
  if (defaultRevision !== MCP_BASELINE_STABLE_REVISION) {
    failAdmission(`defaultRevision must be the stable baseline ${MCP_BASELINE_STABLE_REVISION}`);
  }
  if (!Array.isArray(usableRaw) || usableRaw.length === 0) {
    failAdmission('usableRevisions must be a non-empty array');
  }
  if (!Array.isArray(optInRaw)) {
    failAdmission('optInRevisions must be an array');
  }
  const usableRevisions: string[] = [];
  for (let index = 0; index < usableRaw.length; index += 1) {
    const revision = usableRaw[index];
    if (!isSyntacticProtocolRevision(revision)) {
      failAdmission(`usableRevisions[${index}] is not a syntactically valid protocol revision`);
    }
    let duplicate = false;
    for (let prior = 0; prior < usableRevisions.length; prior += 1) {
      if (usableRevisions[prior] === revision) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) failAdmission(`usableRevisions carries a duplicate entry ${revision}`);
    usableRevisions[usableRevisions.length] = revision;
  }
  const optInRevisions: string[] = [];
  for (let index = 0; index < optInRaw.length; index += 1) {
    const revision = optInRaw[index];
    if (!isSyntacticProtocolRevision(revision)) {
      failAdmission(`optInRevisions[${index}] is not a syntactically valid protocol revision`);
    }
    let duplicate = false;
    for (let prior = 0; prior < optInRevisions.length; prior += 1) {
      if (optInRevisions[prior] === revision) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) failAdmission(`optInRevisions carries a duplicate entry ${revision}`);
    optInRevisions[optInRevisions.length] = revision;
  }
  // The effective allow-list is the union, exactly as `resolveProtocolRevision`
  // derives it; the returned `usableRevisions` is that union.
  const allowList = copyRevisions(usableRevisions);
  for (let index = 0; index < optInRevisions.length; index += 1) {
    const revision = optInRevisions[index] as string;
    let present = false;
    for (let prior = 0; prior < allowList.length; prior += 1) {
      if (allowList[prior] === revision) {
        present = true;
        break;
      }
    }
    if (!present) allowList[allowList.length] = revision;
  }
  let defaultPresent = false;
  for (let index = 0; index < allowList.length; index += 1) {
    if (allowList[index] === defaultRevision) {
      defaultPresent = true;
      break;
    }
  }
  if (!defaultPresent) {
    failAdmission('usableRevisions ∪ optInRevisions must contain defaultRevision');
  }
  return Object.freeze({
    defaultRevision,
    usableRevisions: Object.freeze(allowList),
    optInRevisions: Object.freeze(optInRevisions),
  });
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
    // Bind the admission once; the allow-list is derived ONLY from the
    // governed `usableRevisions` of the normalized copy.
    const admission = normalizeGovernedAdmission(options.admission);
    this.guard = new McpProtocolGuard({
      allowedRevisions: copyRevisions(admission.usableRevisions),
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

export function createMcpProtocolMiddleware(options: {
  readonly maxMessageBytes: number;
  /**
   * REQUIRED. The governed resolver output, never a caller-assembled
   * allow-list. See {@link McpCompatibilityAdmission}.
   */
  readonly admission: McpCompatibilityAdmission;
}) {
  const admission = normalizeGovernedAdmission(options.admission);
  const guard = new McpProtocolGuard({
    allowedRevisions: copyRevisions(admission.usableRevisions),
    maxMessageBytes: options.maxMessageBytes,
  });
  return {
    inspectRequest(input: ProtocolInspectionInput) {
      const verdict = guard.inspect(input);
      return verdict.decision === 'ALLOW'
        ? { allowed: true as const }
        : { allowed: false as const, reason: verdict.reason };
    },
  };
}

export function correlateJsonRpc<T>(id: JsonRpcId, result: T) {
  return { jsonrpc: '2.0' as const, id, result };
}
