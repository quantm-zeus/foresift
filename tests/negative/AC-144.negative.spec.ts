/**
 * AC-144 negative / failure-path — MCP protocol and draft revision refusals.
 * Traces: FR-MCP-001, FR-MCP-009.
 *
 * Asserts:
 * - Draft revisions (e.g. 2026-01-01-draft) are strictly refused unless explicitly opted in.
 * - Missing or undefined protocol revision fails closed with REVISION_UNSUPPORTED.
 * - Legacy or unknown revisions (e.g. 2024-11-05, v1.0) are refused.
 * - Invalid content types, non-POST methods, and oversized messages fail closed before execution.
 * - Session binding claim mismatches and unauthorized cursors are refused.
 */
import { describe, expect, it } from 'bun:test';
import { McpProtocolGuard } from '../../packages/security/src/mcp-protocol-guard.ts';
import { MCP_PROTOCOL_BASELINE_REVISION } from '../../packages/shared-schemas/src/sec.ts';

describe('AC-144 negative: protocol refusal and draft revision rejection', () => {
  const guard = new McpProtocolGuard({
    allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
    maxMessageBytes: 262144,
  });

  const baseInput = {
    protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
    contentType: 'application/json',
    method: 'POST',
    messageBytes: 512,
  };

  it('refuses unconfigured draft revisions fail-closed', () => {
    const draftRevisions = [
      '2026-01-01-draft',
      '2026-06-01-draft',
      'v2-experimental-draft',
      'draft-next',
    ];

    for (const draft of draftRevisions) {
      const verdict = guard.inspect({
        ...baseInput,
        protocolRevision: draft,
      });

      expect(verdict).toEqual({
        decision: 'REFUSE',
        reason: 'REVISION_UNSUPPORTED',
      });
    }
  });

  it('refuses missing or undefined protocol revision', () => {
    const verdict = guard.inspect({
      ...baseInput,
      protocolRevision: undefined,
    });

    expect(verdict).toEqual({
      decision: 'REFUSE',
      reason: 'REVISION_UNSUPPORTED',
    });
  });

  it('refuses legacy or unknown protocol revisions', () => {
    const legacyRevisions = ['2024-11-05', '2024-10-07', '1.0.0', '0.1.0', 'unknown-rev'];

    for (const rev of legacyRevisions) {
      expect(guard.inspect({ ...baseInput, protocolRevision: rev })).toEqual({
        decision: 'REFUSE',
        reason: 'REVISION_UNSUPPORTED',
      });
    }
  });

  it('refuses invalid transport content types', () => {
    const invalidTypes = [
      'text/plain',
      'application/xml',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      'application/octet-stream',
    ];

    for (const contentType of invalidTypes) {
      expect(guard.inspect({ ...baseInput, contentType })).toEqual({
        decision: 'REFUSE',
        reason: 'CONTENT_TYPE_INVALID',
      });
    }
  });

  it('refuses non-POST HTTP methods for JSON-RPC transport', () => {
    const invalidMethods = ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];

    for (const method of invalidMethods) {
      expect(guard.inspect({ ...baseInput, method })).toEqual({
        decision: 'REFUSE',
        reason: 'METHOD_INVALID',
      });
    }
  });

  it('refuses messages exceeding the maximum request size cap', () => {
    expect(guard.inspect({ ...baseInput, messageBytes: 262145 })).toEqual({
      decision: 'REFUSE',
      reason: 'MESSAGE_OVERSIZE',
    });

    expect(guard.inspect({ ...baseInput, messageBytes: 1024 * 1024 })).toEqual({
      decision: 'REFUSE',
      reason: 'MESSAGE_OVERSIZE',
    });
  });

  it('refuses session binding mismatches and unauthorized stream cursors', () => {
    const session = {
      actor: 'actor-legitimate@example.com',
      profileId: 'discovery',
      origin: 'https://mcp.example.com',
      protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
    };

    // Mismatched actor claim
    expect(
      guard.inspect({
        ...baseInput,
        session,
        requestClaims: { actor: 'actor-imposter@example.com' },
      }),
    ).toEqual({
      decision: 'REFUSE',
      reason: 'SESSION_BINDING_INVALID',
    });

    // Unauthorized cursor
    expect(
      guard.inspect({
        ...baseInput,
        session,
        resumableCursor: { cursor: 'cur-foreign-001', authorized: false },
      }),
    ).toEqual({
      decision: 'REFUSE',
      reason: 'CURSOR_UNAUTHORIZED',
    });
  });
});
