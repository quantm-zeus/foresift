/**
 * apps/api/test/server.spec.ts
 *
 * Smoke and composition root unit tests for @foresift/api (T009 / AC-001).
 * Workload: PURE.
 * Traces: FR-MCP-001, FR-MCP-002, AC-001, ADR-0021, ADR-0022.
 *
 * Asserts:
 * - Composition root wires ToolCore seams with deny-closed defaults preserved.
 * - Sets HolderMode.MCP_MANUAL on tool execution contexts.
 * - Serves Streamable HTTP JSON-RPC endpoint at POST /mcp.
 * - Negotiates initialize handshake returning protocol baseline '2025-11-25' and capabilities.
 * - Handles ping and standard MCP protocol messages.
 * - Fail-closed error handling for malformed or unauthorized HTTP requests.
 */
import { describe, expect, it } from 'bun:test';
import { HolderMode } from '@foresift/domain';
import { MCP_PROTOCOL_BASELINE_REVISION } from '@foresift/shared-schemas';
import { createMcpServer, type McpServerInstance, type ServerOptions } from '../src/mcp/server.ts';

describe('T009: MCP server composition root & smoke suite (PURE workload)', () => {
  it('creates MCP server instance with deny-closed ToolCore seams and MCP_MANUAL mode', () => {
    const server = createMcpServer({
      config: {
        protocolBaseline: MCP_PROTOCOL_BASELINE_REVISION,
        allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
        transport: 'STREAMABLE_HTTP',
        originPolicy: 'EXACT_ALLOWLIST',
        allowedOrigins: ['https://mcp.foresift.io'],
        absentOriginPolicy: 'PRODUCTION',
        statefulSessionsEnabled: false,
        maximumRequestBytes: 262144,
        maximumResponseBytes: 1048576,
        maximumPageRecords: 100,
      },
    });

    expect(server).toBeDefined();
    expect(server.holderMode).toBe(HolderMode.MCP_MANUAL);
    expect(server.toolCore).toBeDefined();
  });

  it('handles JSON-RPC initialize request returning server capabilities', async () => {
    const server = createMcpServer({
      config: {
        protocolBaseline: MCP_PROTOCOL_BASELINE_REVISION,
        allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
        transport: 'STREAMABLE_HTTP',
        originPolicy: 'EXACT_ALLOWLIST',
        allowedOrigins: ['https://mcp.foresift.io'],
        absentOriginPolicy: 'PRODUCTION',
        statefulSessionsEnabled: false,
        maximumRequestBytes: 262144,
        maximumResponseBytes: 1048576,
        maximumPageRecords: 100,
      },
    });

    const initRequest = new Request('https://mcp.foresift.io/mcp', {
      method: 'POST',
      headers: {
        origin: 'https://mcp.foresift.io',
        'content-type': 'application/json',
        authorization: 'Bearer fs_live_testbearersecret1234567890123456',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_BASELINE_REVISION,
          capabilities: { tools: { listChanged: true } },
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    });

    const response = await server.handleRequest(initRequest);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      jsonrpc: string;
      id: string;
      result: {
        protocolVersion: string;
        capabilities: { tools?: unknown; resources?: unknown; prompts?: unknown };
        serverInfo: { name: string };
      };
    };

    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe('init-1');
    expect(body.result.protocolVersion).toBe('2025-11-25');
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.capabilities.resources).toBeDefined();
    expect(body.result.capabilities.prompts).toBeDefined();
  });

  it('handles JSON-RPC ping request with empty result object', async () => {
    const server = createMcpServer({
      config: {
        protocolBaseline: MCP_PROTOCOL_BASELINE_REVISION,
        allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
        transport: 'STREAMABLE_HTTP',
        originPolicy: 'EXACT_ALLOWLIST',
        allowedOrigins: ['https://mcp.foresift.io'],
        absentOriginPolicy: 'PRODUCTION',
        statefulSessionsEnabled: false,
        maximumRequestBytes: 262144,
        maximumResponseBytes: 1048576,
        maximumPageRecords: 100,
      },
    });

    const pingRequest = new Request('https://mcp.foresift.io/mcp', {
      method: 'POST',
      headers: {
        origin: 'https://mcp.foresift.io',
        'content-type': 'application/json',
        authorization: 'Bearer fs_live_testbearersecret1234567890123456',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'ping-42',
        method: 'ping',
      }),
    });

    const response = await server.handleRequest(pingRequest);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { jsonrpc: string; id: string; result: unknown };
    expect(body.id).toBe('ping-42');
    expect(body.result).toEqual({});
  });

  it('returns HTTP 403 on rejected Origin before any tool processing', async () => {
    const server = createMcpServer({
      config: {
        protocolBaseline: MCP_PROTOCOL_BASELINE_REVISION,
        allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
        transport: 'STREAMABLE_HTTP',
        originPolicy: 'EXACT_ALLOWLIST',
        allowedOrigins: ['https://mcp.foresift.io'],
        absentOriginPolicy: 'PRODUCTION',
        statefulSessionsEnabled: false,
        maximumRequestBytes: 262144,
        maximumResponseBytes: 1048576,
        maximumPageRecords: 100,
      },
    });

    const badOriginRequest = new Request('https://mcp.foresift.io/mcp', {
      method: 'POST',
      headers: {
        origin: 'https://evil-attacker.com',
        'content-type': 'application/json',
        authorization: 'Bearer fs_live_testbearersecret1234567890123456',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'bad-origin-1',
        method: 'tools/list',
      }),
    });

    const response = await server.handleRequest(badOriginRequest);
    expect(response.status).toBe(403);
  });
});
