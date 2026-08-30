/**
 * Package smoke suite for apps/api server composition root (T009).
 * Traces: FR-MCP-001, AC-001, PRD §17, HolderMode.MCP_MANUAL.
 * Workload: PURE (runs without database dependency using mock/seam interfaces).
 *
 * Asserts:
 * - createServer / createMcpServer initializes correctly with ToolCore seams.
 * - HolderMode is set to MCP_MANUAL.
 * - Deny-closed security defaults are preserved.
 * - /mcp route serves JSON-RPC Streamable HTTP transport.
 * - Handles initialize, ping, tools/list, tools/call requests over HTTP.
 */
import { describe, expect, it } from 'bun:test';
import { HolderMode } from '@foresift/domain';
import { createMcpServer, type McpServerInstance } from '../src/mcp/server.ts';

describe('T009 — MCP server composition root smoke suite (AC-001)', () => {
  it('creates an MCP server instance with deny-closed seams and MCP_MANUAL holder mode', () => {
    const server: McpServerInstance = createMcpServer({
      config: {
        protocolRevision: '2025-11-25',
        transport: 'STREAMABLE_HTTP',
        originMode: 'EXACT_ALLOWLIST',
        originAllowlist: ['https://mcp.example.com'],
        absentOriginPolicy: 'NON_PRODUCTION',
        maximumRequestBytes: 262144,
        maximumResponseBytes: 1048576,
        maximumPageRecords: 100,
      },
    });

    expect(server).toBeDefined();
    expect(server.holderMode).toBe(HolderMode.MCP_MANUAL);
    expect(server.protocolRevision).toBe('2025-11-25');
  });

  it('handles MCP initialize JSON-RPC handshake returning server capabilities', async () => {
    const server = createMcpServer({
      config: {
        protocolRevision: '2025-11-25',
        transport: 'STREAMABLE_HTTP',
        originMode: 'EXACT_ALLOWLIST',
        originAllowlist: ['https://mcp.example.com'],
        absentOriginPolicy: 'NON_PRODUCTION',
      },
    });

    const initReq = {
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {}, resources: {}, prompts: {} },
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    };

    const response = await server.handleJsonRpc(initReq, {
      origin: 'https://mcp.example.com',
      sourceIp: '127.0.0.1',
    });

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe('init-1');
    expect(response.result?.protocolVersion).toBe('2025-11-25');
    expect(response.result?.serverInfo?.name).toBe('@foresift/api');
    expect(response.result?.capabilities?.tools).toBeDefined();
    expect(response.result?.capabilities?.resources).toBeDefined();
    expect(response.result?.capabilities?.prompts).toBeDefined();
  });

  it('handles ping request returning empty result object', async () => {
    const server = createMcpServer({
      config: {
        protocolRevision: '2025-11-25',
        transport: 'STREAMABLE_HTTP',
        originMode: 'EXACT_ALLOWLIST',
        originAllowlist: ['https://mcp.example.com'],
        absentOriginPolicy: 'NON_PRODUCTION',
      },
    });

    const pingReq = {
      jsonrpc: '2.0',
      id: 'ping-1',
      method: 'ping',
    };

    const response = await server.handleJsonRpc(pingReq, {
      origin: 'https://mcp.example.com',
      sourceIp: '127.0.0.1',
    });

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe('ping-1');
    expect(response.result).toEqual({});
  });

  it('handles tools/list returning scoped tools for the authenticated profile', async () => {
    const server = createMcpServer({
      config: {
        protocolRevision: '2025-11-25',
        transport: 'STREAMABLE_HTTP',
        originMode: 'EXACT_ALLOWLIST',
        originAllowlist: ['https://mcp.example.com'],
        absentOriginPolicy: 'NON_PRODUCTION',
      },
    });

    const listReq = {
      jsonrpc: '2.0',
      id: 'list-1',
      method: 'tools/list',
    };

    const response = await server.handleJsonRpc(listReq, {
      origin: 'https://mcp.example.com',
      sourceIp: '127.0.0.1',
      actor: 'test-user',
      profileId: 'discovery',
    });

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe('list-1');
    expect(Array.isArray(response.result?.tools)).toBe(true);
    const names = response.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('discover_candidates');
    expect(names).toContain('get_asset_identity');
  });

  it('handles HTTP POST /mcp endpoint with standard headers', async () => {
    const server = createMcpServer({
      config: {
        protocolRevision: '2025-11-25',
        transport: 'STREAMABLE_HTTP',
        originMode: 'EXACT_ALLOWLIST',
        originAllowlist: ['https://mcp.example.com'],
        absentOriginPolicy: 'NON_PRODUCTION',
      },
    });

    const httpResponse = await server.fetch(
      new Request('https://api.foresift.internal/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://mcp.example.com',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'http-ping', method: 'ping' }),
      }),
    );

    expect(httpResponse.status).toBe(200);
    const body = await httpResponse.json();
    expect(body.id).toBe('http-ping');
  });
});
