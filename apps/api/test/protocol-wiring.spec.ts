/**
 * Unit test suite for MCP protocol guard wiring & transport framing (T008).
 * Traces: FR-MCP-009, AC-144, AC-251, §17.3, §17.4.
 *
 * Asserts:
 * - Composes McpProtocolGuard.inspect().
 * - Protocol revision: baseline 2025-11-25 admitted; draft revisions refused unless opt-in enabled.
 * - Content-Type validation: application/json admitted; others refused.
 * - Method semantics: POST required for JSON-RPC mutations / calls; GET refused.
 * - Message size limits: <= 262144 bytes admitted; oversize refused.
 * - Session binding claims validated against protocol guard.
 * - Resumable-cursor ownership and validity checked.
 * - JSON-RPC 2.0 request-response correlation preserved (string and integer IDs).
 */
import { describe, expect, it } from 'bun:test';
import {
  McpProtocolWiring,
  type ProtocolInspectionRequest,
} from '../src/mcp/protocol-wiring.ts';

describe('T008 — MCP protocol guard wiring (AC-144, AC-251)', () => {
  const wiring = new McpProtocolWiring({
    maxMessageBytes: 262144,
    allowedRevisions: ['2025-11-25'],
    allowDraftRevisions: false,
  });

  const validRequest: ProtocolInspectionRequest = {
    protocolRevision: '2025-11-25',
    contentType: 'application/json',
    method: 'POST',
    messageBytes: 2048,
    jsonRpcPayload: {
      jsonrpc: '2.0',
      id: 'req-42',
      method: 'tools/call',
      params: { name: 'system_health' },
    },
  };

  it('admits a valid protocol baseline request with JSON-RPC payload', () => {
    const verdict = wiring.inspect(validRequest);
    expect(verdict.admitted).toBe(true);
    expect(verdict.correlationId).toBe('req-42');
  });

  it('correlates integer JSON-RPC IDs correctly', () => {
    const verdict = wiring.inspect({
      ...validRequest,
      jsonRpcPayload: {
        jsonrpc: '2.0',
        id: 1001,
        method: 'ping',
      },
    });
    expect(verdict.admitted).toBe(true);
    expect(verdict.correlationId).toBe(1001);
  });

  it('refuses draft revisions unless explicitly opted in', () => {
    const draftRequest = {
      ...validRequest,
      protocolRevision: '2026-03-draft',
    };
    const refused = wiring.inspect(draftRequest);
    expect(refused.admitted).toBe(false);
    expect(refused.reason).toBe('REVISION_UNSUPPORTED');

    // With opt-in enabled
    const optInWiring = new McpProtocolWiring({
      maxMessageBytes: 262144,
      allowedRevisions: ['2025-11-25', '2026-03-draft'],
      allowDraftRevisions: true,
    });
    const admitted = optInWiring.inspect(draftRequest);
    expect(admitted.admitted).toBe(true);
  });

  it('refuses non-JSON Content-Type headers', () => {
    const xmlRequest = {
      ...validRequest,
      contentType: 'text/xml',
    };
    const verdict = wiring.inspect(xmlRequest);
    expect(verdict.admitted).toBe(false);
    expect(verdict.reason).toBe('CONTENT_TYPE_INVALID');
  });

  it('refuses non-POST methods for JSON-RPC mutation calls', () => {
    const getRequest = {
      ...validRequest,
      method: 'GET',
    };
    const verdict = wiring.inspect(getRequest);
    expect(verdict.admitted).toBe(false);
    expect(verdict.reason).toBe('METHOD_INVALID');
  });

  it('refuses messages exceeding the 256 KiB cap', () => {
    const oversized = {
      ...validRequest,
      messageBytes: 262145,
    };
    const verdict = wiring.inspect(oversized);
    expect(verdict.admitted).toBe(false);
    expect(verdict.reason).toBe('MESSAGE_OVERSIZE');
  });

  it('refuses session binding mismatch claims', () => {
    const mismatchedSession = {
      ...validRequest,
      session: {
        actor: 'user@example.com',
        profileId: 'profile-a',
        origin: 'https://mcp.example.com',
        protocolRevision: '2025-11-25',
      },
      requestClaims: {
        actor: 'different-user@example.com',
      },
    };
    const verdict = wiring.inspect(mismatchedSession);
    expect(verdict.admitted).toBe(false);
    expect(verdict.reason).toBe('SESSION_BINDING_INVALID');
  });

  it('validates resumable cursor ownership and authorization', () => {
    const authorizedCursor = {
      ...validRequest,
      resumableCursor: {
        cursor: 'cur_abc123',
        sessionId: 'sess_1',
        actor: 'user@example.com',
        authorized: true,
      },
    };
    expect(wiring.inspect(authorizedCursor).admitted).toBe(true);

    const unauthorizedCursor = {
      ...validRequest,
      resumableCursor: {
        cursor: 'cur_abc123',
        sessionId: 'sess_1',
        actor: 'user@example.com',
        authorized: false,
      },
    };
    const refused = wiring.inspect(unauthorizedCursor);
    expect(refused.admitted).toBe(false);
    expect(refused.reason).toBe('CURSOR_UNAUTHORIZED');
  });
});
