/**
 * T008: MCP Protocol Wiring & Streamable HTTP Transport suite (FR-MCP-009, §17.3, AC-144, AC-251).
 * Tests apps/api/src/mcp/protocol-wiring.ts for protocol guard composition, streamable HTTP endpoint,
 * request correlation, and draft revision opt-in constraints.
 */
import { describe, expect, it } from 'bun:test';
import { MCP_PROTOCOL_BASELINE_REVISION } from '@foresift/shared-schemas';
import {
  VALID_AUTHORIZED_CURSOR,
  UNAUTHORIZED_CURSOR_INSPECTION,
  ACTIVE_SESSION_FIXTURE,
  SESSION_CLAIM_MISMATCH_VECTORS,
  MAXIMUM_REQUEST_BYTES,
} from '../../../tests/fixtures/mcp/index.ts';

async function loadProtocolWiringModule() {
  return await import('../src/mcp/protocol-wiring.ts');
}

describe('T008: MCP protocol wiring & Streamable HTTP transport (AC-144, AC-251)', () => {
  it('admits standard baseline revision 2025-11-25 and supported content types', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    const middleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
      allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
    });

    const result = middleware.inspectRequest({
      protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
      contentType: 'application/json; charset=utf-8',
      method: 'POST',
      messageBytes: 2048,
    });
    expect(result.allowed).toBe(true);
  });

  it('refuses draft revisions unless explicitly opted in via configuration', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    // Default config: draft revision refused
    const defaultMiddleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
      allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
    });
    const defaultResult = defaultMiddleware.inspectRequest({
      protocolRevision: '2026-draft-v2',
      contentType: 'application/json',
      method: 'POST',
      messageBytes: 1024,
    });
    expect(defaultResult.allowed).toBe(false);
    expect(defaultResult.reason).toBe('REVISION_UNSUPPORTED');

    // Opt-in config: draft revision admitted
    const optInMiddleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
      allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION, '2026-draft-v2'],
    });
    const optInResult = optInMiddleware.inspectRequest({
      protocolRevision: '2026-draft-v2',
      contentType: 'application/json',
      method: 'POST',
      messageBytes: 1024,
    });
    expect(optInResult.allowed).toBe(true);
  });

  it('enforces POST method and application/json content type', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    const middleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
    });

    const getResult = middleware.inspectRequest({
      protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
      contentType: 'application/json',
      method: 'GET',
      messageBytes: 100,
    });
    expect(getResult.allowed).toBe(false);
    expect(getResult.reason).toBe('METHOD_INVALID');

    const formResult = middleware.inspectRequest({
      protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
      contentType: 'application/x-www-form-urlencoded',
      method: 'POST',
      messageBytes: 100,
    });
    expect(formResult.allowed).toBe(false);
    expect(formResult.reason).toBe('CONTENT_TYPE_INVALID');
  });

  it('refuses oversized payloads exceeding 256 KiB limit', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    const middleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
    });

    const result = middleware.inspectRequest({
      protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
      contentType: 'application/json',
      method: 'POST',
      messageBytes: MAXIMUM_REQUEST_BYTES + 1,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('MESSAGE_OVERSIZE');
  });

  it('enforces session binding claims matching established session', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    const middleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
    });

    for (const vector of SESSION_CLAIM_MISMATCH_VECTORS) {
      const result = middleware.inspectRequest({
        protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
        contentType: 'application/json',
        method: 'POST',
        messageBytes: 512,
        session: {
          actor: ACTIVE_SESSION_FIXTURE.actor,
          profileId: ACTIVE_SESSION_FIXTURE.profileId,
          origin: ACTIVE_SESSION_FIXTURE.origin,
          protocolRevision: ACTIVE_SESSION_FIXTURE.protocolRevision,
        },
        requestClaims: vector.requestClaims,
      });
      expect(result.allowed, vector.name).toBe(false);
      expect(result.reason, vector.name).toBe('SESSION_BINDING_INVALID');
    }
  });

  it('validates resumable-cursor authorization', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    const middleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
    });

    // Valid cursor
    const validResult = middleware.inspectRequest({
      protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
      contentType: 'application/json',
      method: 'POST',
      messageBytes: 512,
      resumableCursor: {
        cursor: VALID_AUTHORIZED_CURSOR.cursor,
        authorized: true,
      },
    });
    expect(validResult.allowed).toBe(true);

    // Unauthorized cursor
    const unauthResult = middleware.inspectRequest({
      protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
      contentType: 'application/json',
      method: 'POST',
      messageBytes: 512,
      resumableCursor: UNAUTHORIZED_CURSOR_INSPECTION,
    });
    expect(unauthResult.allowed).toBe(false);
    expect(unauthResult.reason).toBe('CURSOR_UNAUTHORIZED');
  });

  it('preserves JSON-RPC request-response correlation over Streamable HTTP transport', async () => {
    const { correlateJsonRpc } = await loadProtocolWiringModule();
    const request = { jsonrpc: '2.0', id: 'corr-req-001', method: 'ping' };
    const responsePayload = { status: 'ok' };

    const correlated = correlateJsonRpc(request.id, responsePayload);
    expect(correlated.jsonrpc).toBe('2.0');
    expect(correlated.id).toBe('corr-req-001');
    expect(correlated.result).toEqual(responsePayload);
  });
});
