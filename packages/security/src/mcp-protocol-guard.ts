/**
 * MCP protocol-revision and transport-shape guard (FR-SEC-001, ADR-004;
 * AC-251). Deterministic typed failures BEFORE any tool execution:
 *
 *   - protocol-revision allowlist (baseline 2025-11-25; later revisions
 *     opt-in by configuration, never silently);
 *   - content-type and HTTP method validation;
 *   - message-size caps;
 *   - session binding: actor/profile/origin/revision claimed by a request
 *     must equal what the established session carries;
 *   - resumable-cursor authorization (a cursor is only replayable by the
 *     session that owns it).
 */
import {
  ProtocolVerdictSchema,
  MCP_PROTOCOL_BASELINE_REVISION,
  type ProtocolVerdict,
} from '@foresift/shared-schemas';
import { ProtocolGuardError } from './errors.ts';
import { numericIncludes, parseDecision, snapshotCallerInput } from './shadow-safe.ts';

export type ProtocolRefusalReason = Extract<ProtocolVerdict, { decision: 'REFUSE' }>['reason'];

export interface ProtocolGuardOptions {
  /** Admissible MCP protocol revisions; defaults to the ADR-004 baseline. */
  readonly allowedRevisions?: readonly string[];
  /** Hard cap on encoded message size in bytes. */
  readonly maxMessageBytes: number;
  /** The single admissible content type for JSON-RPC transports. */
  readonly expectedContentType?: string;
}

export interface SessionBindingContext {
  readonly actor: string;
  readonly profileId: string;
  readonly origin: string;
  readonly protocolRevision: string;
}

export interface ProtocolInspectionInput {
  readonly protocolRevision?: string | undefined;
  readonly contentType?: string | undefined;
  readonly method?: string | undefined;
  readonly messageBytes?: number | undefined;
  /** Claims presented with THIS request; each must match the session. */
  readonly requestClaims?:
    | Partial<Pick<SessionBindingContext, 'actor' | 'profileId' | 'origin' | 'protocolRevision'>>
    | undefined;
  readonly session?: SessionBindingContext | undefined;
  /** Present when the request tries to resume from a stream cursor. */
  readonly resumableCursor?: { readonly cursor: string; readonly authorized: boolean } | undefined;
}

const DEFAULT_CONTENT_TYPE = 'application/json';

export class McpProtocolGuard {
  private readonly allowedRevisions: readonly string[];
  private readonly maxMessageBytes: number;
  private readonly expectedContentType: string;

  constructor(options: ProtocolGuardOptions) {
    this.allowedRevisions = options.allowedRevisions ?? [MCP_PROTOCOL_BASELINE_REVISION];
    this.maxMessageBytes = options.maxMessageBytes;
    this.expectedContentType = options.expectedContentType ?? DEFAULT_CONTENT_TYPE;
  }

  inspect(rawInput: ProtocolInspectionInput): ProtocolVerdict {
    // Single-read binding (V7 accessor class): `requestClaims`/`session` are
    // read more than once across the binding check, so a getter could present
    // claims to the first read and `undefined` to the second and skip the
    // session-binding dimension entirely.
    const input = snapshotCallerInput(rawInput);
    const refuse = (reason: ProtocolRefusalReason): ProtocolVerdict =>
      parseDecision(ProtocolVerdictSchema, { decision: 'REFUSE', reason });

    // Numeric-index membership, never `Array.prototype.includes` (audit R11):
    // an in-process caller that shadows `includes` to return `true` would
    // otherwise make the guard ALLOW an arbitrary protocol revision. Index and
    // `length` reads cannot be redefined through `Array.prototype` methods.
    if (
      input.protocolRevision === undefined ||
      !numericIncludes(this.allowedRevisions, input.protocolRevision)
    ) {
      return refuse('REVISION_UNSUPPORTED');
    }
    const contentType = input.contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (contentType !== this.expectedContentType) {
      return refuse('CONTENT_TYPE_INVALID');
    }
    // JSON-RPC over HTTP travels in POST bodies; GET/PUT/etc. are refused.
    // An ABSENT method is an unverifiable transport shape — also refused
    // (M17): omission may never skip a dimension of the guard.
    if (input.method === undefined || input.method.toUpperCase() !== 'POST') {
      return refuse('METHOD_INVALID');
    }
    // An absent byte count cannot be checked against the cap — refused, not
    // skipped (fail-closed symmetry with every other dimension).
    if (
      input.messageBytes === undefined ||
      input.messageBytes > this.maxMessageBytes ||
      input.messageBytes < 0
    ) {
      return refuse('MESSAGE_OVERSIZE');
    }
    // Claims presented without a session to verify against cannot be bound —
    // refusing beats silently skipping the binding check.
    if (input.requestClaims !== undefined && input.session === undefined) {
      return refuse('SESSION_BINDING_INVALID');
    }
    if (input.requestClaims !== undefined && input.session !== undefined) {
      const { requestClaims, session } = input;
      const mismatches =
        (requestClaims.actor !== undefined && requestClaims.actor !== session.actor) ||
        (requestClaims.profileId !== undefined && requestClaims.profileId !== session.profileId) ||
        (requestClaims.origin !== undefined && requestClaims.origin !== session.origin) ||
        (requestClaims.protocolRevision !== undefined &&
          requestClaims.protocolRevision !== session.protocolRevision);
      if (mismatches) {
        return refuse('SESSION_BINDING_INVALID');
      }
    }
    if (input.resumableCursor !== undefined && !input.resumableCursor.authorized) {
      return refuse('CURSOR_UNAUTHORIZED');
    }
    return parseDecision(ProtocolVerdictSchema, { decision: 'ALLOW' });
  }

  /** Fail-closed convenience variant for wiring that prefers exceptions. */
  requireAllowed(rawInput: ProtocolInspectionInput): void {
    // Single-read binding (V7 accessor class).
    const input = snapshotCallerInput(rawInput);
    const verdict = this.inspect(input);
    if (verdict.decision !== 'ALLOW') {
      throw new ProtocolGuardError(`protocol inspection refused (${verdict.reason})`, {
        reason: verdict.reason,
      });
    }
  }
}
