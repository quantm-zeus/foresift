import { isGovernedMcpCompatibilityResolution } from '@foresift/capability-registry';
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
  /**
   * `McpCompatibilityResolution.defaultRevision` — the resolver's latest
   * mutually tested stable revision. It is NOT pinned to a hard-coded baseline;
   * it is required to be a member of the usable set.
   */
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
 * HIGH-5/L1/L2: the admission MUST be the branded output of the governed
 * resolver. A private `WeakSet` brand lives in `@foresift/capability-registry`
 * and is minted only by `resolveCompatibilityMatrix`; `protocol-wiring`
 * requires it here, so a caller-declared revision list, a resolver-shaped
 * hand-built object, or a `structuredClone`d copy is refused before any guard
 * is built. Unregistered / untested / not-mutually-tested revisions therefore
 * cannot reach the allow-list.
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
    `MCP protocol admission must be the governed resolveCompatibilityMatrix output bearing the capability-registry provenance brand (${detail}); a caller-assembled or cloned revision allow-list is refused`,
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
  // HIGH-5: the brand is checked FIRST. Without it, a resolver-shaped object has
  // no proof it came from the governed matrix (registered + mutually tested).
  if (!isGovernedMcpCompatibilityResolution(raw)) {
    failAdmission('the admission does not carry the governed-resolution provenance brand');
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    failAdmission('the admission is not an object');
  }
  const source = raw as Record<string, unknown>;
  const defaultRevision = source['defaultRevision'];
  const usableRaw = source['usableRevisions'];
  const optInRaw = source['optInRevisions'];
  // The resolver's defaultRevision is authoritative and is NOT pinned to a
  // hard-coded baseline: it must simply be a syntactically valid revision that
  // is a member of the allow-list (validated below).
  if (!isSyntacticProtocolRevision(defaultRevision)) {
    failAdmission('defaultRevision must be a syntactically valid protocol revision');
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

/**
 * Normalize a validated JSON-RPC request into a FROZEN copy, reading each field
 * exactly once (HIGH-5). Returns `undefined` when the payload is not a valid
 * JSON-RPC request; the caller must not re-read the original payload after this
 * (a getter could otherwise present a valid request to validation and a
 * different object to the returned admission).
 */
function normalizeJsonRpcRequest(payload: unknown): JsonRpcRequest | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = payload as Record<string, unknown>;
  const jsonrpc = value['jsonrpc'];
  const id = value['id'];
  const method = value['method'];
  if (
    jsonrpc !== '2.0' ||
    !(typeof id === 'string' || typeof id === 'number' || id === null) ||
    typeof method !== 'string' ||
    method.length === 0
  ) {
    return undefined;
  }
  const hasParams = 'params' in value;
  const params = hasParams ? value['params'] : undefined;
  return Object.freeze(
    hasParams ? { jsonrpc: '2.0', id, method, params } : { jsonrpc: '2.0', id, method },
  ) as JsonRpcRequest;
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
    // HIGH-5: single-read snapshot of every field used for the verdict AND for
    // the returned admission. A getter can therefore never present one revision
    // to the guard and a different one to the caller, and the returned request
    // is a frozen copy rather than the caller's mutable payload.
    const protocolRevision = input.protocolRevision;
    const contentType = input.contentType;
    const method = input.method;
    const messageBytes = input.messageBytes;
    const requestClaims = input.requestClaims;
    const session = input.session;
    const resumableCursor = input.resumableCursor;
    const payload = input.payload;
    const verdict = this.guard.inspect({
      protocolRevision,
      contentType,
      method,
      messageBytes,
      ...(requestClaims === undefined ? {} : { requestClaims }),
      ...(session === undefined ? {} : { session }),
      ...(resumableCursor === undefined ? {} : { resumableCursor }),
    });
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
    const request = normalizeJsonRpcRequest(payload);
    if (request === undefined) {
      return { allowed: false, status: 400, code: 'JSON_RPC_INVALID', reason: 'JSON_RPC_INVALID' };
    }
    return {
      allowed: true,
      request,
      protocolRevision: protocolRevision as string,
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
