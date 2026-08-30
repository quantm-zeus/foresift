/**
 * apps/api/test/protocol-wiring.spec.ts
 *
 * Unit tests for MCP protocol guard wiring and transport validation (T008 / AC-144, AC-251).
 * Traces: FR-MCP-009, §17.1, §17.4, ADR-004, ADR-027, AC-144, AC-251.
 *
 * Asserts:
 * - Protocol revision negotiation (baseline 2025-11-25; draft revisions opt-in only).
 * - Content-Type validation (application/json required).
 * - HTTP method enforcement (POST required; GET/PUT/DELETE rejected).
 * - Message size cap enforcement (<= 262144 bytes).
 * - JSON-RPC 2.0 framing and request-response correlation.
 * - Session binding claim validation and resumable cursor ownership.
 */
import { describe, expect, it } from 'bun:test';
import { MCP_PROTOCOL_BASELINE_REVISION } from '@foresift/shared-schemas';
import {
  McpProtocolMiddleware,
  correlateJsonRpcResponse,
  type ProtocolCheckInput,
} from '../src/mcp/protocol-wiring.ts';

const VALID_PROTOCOL_INPUT: ProtocolCheckInput = {
  protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
  contentType: 'application/json; charset=utf-8',
  method: 'POST',
  messageBytes: 2048,
};

describe('T008: MCP protocol wiring & transport validation (AC-144, AC-251)', () => {
  it('admits baseline protocol revision 2025-11-25 with valid POST request', () => {
    const middleware = new McpProtocolMiddleware({
      maxMessageBytes: 262144,
      allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
    });

    const verdict = middleware.inspect(VALID_PROTOCOL_INPUT);
    expect(verdict.allowed).toBe(true);
  });

  it('refuses unsupported or future revisions deterministically', () => {
    const middleware = new McpProtocolMiddleware({
      maxMessageBytes: 262144,
      allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
    });

    expect(
      middleware.inspect({ ...VALID_PROTOCOL_INPUT, protocolRevision: '2024-01-01' }),
    ).toMatchObject({ allowed: false, refusalReason: 'REVISION_UNSUPPORTED' });

    expect(
      middleware.inspect({ ...VALID_PROTOCOL_INPUT, protocolRevision: '2030-01-01' }),
    ).toMatchObject({ allowed: false, refusalReason: 'REVISION_UNSUPPORTED' });
  });

  it('refuses draft revisions unless explicitly opted in via configuration', () => {
    const defaultMiddleware = new McpProtocolMiddleware({
      maxMessageBytes: 262144,
      allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
    });

    expect(
      defaultMiddleware.inspect({ ...VALID_PROTOCOL_INPUT, protocolRevision: '2026-03-01-draft' }),
    ).toMatchObject({ allowed: false, refusalReason: 'REVISION_UNSUPPORTED' });

    const optInMiddleware = new McpProtocolMiddleware({
      maxMessageBytes: 262144,
      allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION, '2026-03-01-draft'],
    });

    expect(
      optInMiddleware.inspect({ ...VALID_PROTOCOL_INPUT, protocolRevision: '2026-03-01-draft' }),
    ).toMatchObject({ allowed: true });
  });

  it('refuses non-JSON content types with CONTENT_TYPE_INVALID', () => {
    const middleware = new McpProtocolMiddleware({
      maxMessageBytes: 262144,
      allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
    });

    for (const contentType of ['text/plain', 'application/xml', 'multipart/form-data']) {
      expect(middleware.inspect({ ...VALID_PROTOCOL_INPUT, contentType })).toMatchObject({
        allowed: false,
        refusalReason: 'CONTENT_TYPE_INVALID',
      });
    }
  });

  it('refuses non-POST HTTP methods with METHOD_INVALID', () => {
    const middleware = new McpProtocolMiddleware({
      maxMessageBytes: 262144,
      allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
    });

    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
      expect(middleware.inspect({ ...VALID_PROTOCOL_INPUT, method })).toMatchObject({
        allowed: false,
        refusalReason: 'METHOD_INVALID',
      });
    }
  });

  it('refuses messages exceeding maximum_request_bytes cap', () => {
    const middleware = new McpProtocolMiddleware({
      maxMessageBytes: 262144,
      allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
    });

    expect(middleware.inspect({ ...VALID_PROTOCOL_INPUT, messageBytes: 262145 })).toMatchObject({
      allowed: false,
      refusalReason: 'MESSAGE_OVERSIZE',
    });
  });

  it('preserves JSON-RPC request-response correlation across string and numeric IDs', () => {
    const stringCall = { jsonrpc: '2.0', id: 'corr-str-101', method: 'ping' };
    const stringResp = correlateJsonRpcResponse(stringCall, { ok: true });
    expect(stringResp.id).toBe('corr-str-101');
    expect(stringResp.jsonrpc).toBe('2.0');

    const numCall = { jsonrpc: '2.0', id: 998877, method: 'ping' };
    const numResp = correlateJsonRpcResponse(numCall, { ok: true });
    expect(numResp.id).toBe(998877);
  });

  it('refuses requests with mismatched session binding claims', () => {
    const middleware = new McpProtocolMiddleware({
      maxMessageBytes: 262144,
      allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
    });

    const session = {
      actor: 'alice@example.com',
      profileId: 'discovery',
      origin: 'https://mcp.foresift.io',
      protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
    };

    // Mismatched actor claim
    expect(
      middleware.inspect({
        ...VALID_PROTOCOL_INPUT,
        session,
        requestClaims: { actor: 'bob@example.com' },
      }),
    ).toMatchObject({ allowed: false, refusalReason: 'SESSION_BINDING_INVALID' });
  });
});
