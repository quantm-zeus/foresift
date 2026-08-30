/**
 * T009: MCP Server Composition Root & Smoke Suite (FR-MCP-001, AC-001).
 * Workload: PURE.
 * Tests apps/api/src/main.ts and apps/api/src/mcp/server.ts for createToolCore seam wiring,
 * deny-closed defaults, HolderMode.MCP_MANUAL, and streamable HTTP JSON-RPC dispatch.
 */
import { describe, expect, it } from 'bun:test';
import { HolderMode, ToolProfileId } from '@foresift/domain';
import { MCP_PROTOCOL_BASELINE_REVISION } from '@foresift/shared-schemas';
import { STANDARD_DISCOVERY_CREDENTIAL } from '../../../tests/fixtures/mcp/index.ts';

async function loadServerModule() {
  return await import('../src/mcp/server.ts');
}

describe('T009: MCP server composition root smoke suite (PURE workload, AC-001)', () => {
  it('creates MCP server instance with default deny-closed seams and HolderMode.MCP_MANUAL', async () => {
    const { createMcpServer } = await loadServerModule();
    const server = createMcpServer();

    expect(server).toBeDefined();
    expect(server.holderMode).toBe(HolderMode.MCP_MANUAL);
    expect(server.protocolRevision).toBe(MCP_PROTOCOL_BASELINE_REVISION);
  });

  it('handles JSON-RPC initialize request returning server capabilities', async () => {
    const { createMcpServer } = await loadServerModule();
    const server = createMcpServer();

    const initializeRequest = {
      jsonrpc: '2.0',
      id: 'init-smoke-001',
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    };

    const response = await server.handleRequest({
      body: initializeRequest,
      origin: 'https://mcp.example.com',
      authorization: `Bearer ${STANDARD_DISCOVERY_CREDENTIAL.rawSecret}`,
    });

    expect(response.status).toBe(200);
    expect(response.body.jsonrpc).toBe('2.0');
    expect(response.body.id).toBe('init-smoke-001');
    expect(response.body.result.protocolVersion).toBe('2025-11-25');
    expect(response.body.result.capabilities.tools).toBeDefined();
    expect(response.body.result.capabilities.resources).toBeDefined();
    expect(response.body.result.capabilities.prompts).toBeDefined();
    expect(response.body.result.serverInfo.name).toBe('@foresift/api');
  });

  it('handles tools/list scoped to client discovery profile', async () => {
    const { createMcpServer } = await loadServerModule();
    const server = createMcpServer();

    const listRequest = {
      jsonrpc: '2.0',
      id: 'tools-list-001',
      method: 'tools/list',
      params: {},
    };

    const response = await server.handleRequest({
      body: listRequest,
      origin: 'https://mcp.example.com',
      authorization: `Bearer ${STANDARD_DISCOVERY_CREDENTIAL.rawSecret}`,
      profileId: ToolProfileId.DISCOVERY,
    });

    expect(response.status).toBe(200);
    expect(response.body.result.tools).toBeInstanceOf(Array);
    const toolNames = response.body.result.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain('discover_candidates');
    expect(toolNames).toContain('get_asset_identity');
  });

  it('handles tools/call delegating to ToolCore and returning §17.4 structured envelope', async () => {
    const { createMcpServer } = await loadServerModule();
    const server = createMcpServer();

    const callRequest = {
      jsonrpc: '2.0',
      id: 'tools-call-001',
      method: 'tools/call',
      params: {
        name: 'discover_candidates',
        arguments: { limit: 5 },
      },
    };

    const response = await server.handleRequest({
      body: callRequest,
      origin: 'https://mcp.example.com',
      authorization: `Bearer ${STANDARD_DISCOVERY_CREDENTIAL.rawSecret}`,
    });

    expect(response.status).toBe(200);
    expect(response.body.result.content).toBeInstanceOf(Array);
    expect(response.body.result.structuredContent).toBeDefined();
    expect(response.body.result._meta).toBeDefined();
  });

  it('handles prompts/list and prompts/get for standard prompts', async () => {
    const { createMcpServer } = await loadServerModule();
    const server = createMcpServer();

    const promptsListResponse = await server.handleRequest({
      body: { jsonrpc: '2.0', id: 'prompts-list-001', method: 'prompts/list' },
      origin: 'https://mcp.example.com',
      authorization: `Bearer ${STANDARD_DISCOVERY_CREDENTIAL.rawSecret}`,
    });

    expect(promptsListResponse.status).toBe(200);
    const promptNames = promptsListResponse.body.result.prompts.map((p: { name: string }) => p.name);
    expect(promptNames).toContain('analyze-token');
    expect(promptNames).toContain('investigate-alert');

    const promptGetResponse = await server.handleRequest({
      body: {
        jsonrpc: '2.0',
        id: 'prompt-get-001',
        method: 'prompts/get',
        params: { name: 'analyze-token', arguments: { token: 'SOL' } },
      },
      origin: 'https://mcp.example.com',
      authorization: `Bearer ${STANDARD_DISCOVERY_CREDENTIAL.rawSecret}`,
    });

    expect(promptGetResponse.status).toBe(200);
    expect(promptGetResponse.body.result.messages).toBeInstanceOf(Array);
  });

  it('handles ping method with immediate response', async () => {
    const { createMcpServer } = await loadServerModule();
    const server = createMcpServer();

    const pingResponse = await server.handleRequest({
      body: { jsonrpc: '2.0', id: 'ping-001', method: 'ping' },
      origin: 'https://mcp.example.com',
      authorization: `Bearer ${STANDARD_DISCOVERY_CREDENTIAL.rawSecret}`,
    });

    expect(pingResponse.status).toBe(200);
    expect(pingResponse.body.result).toEqual({});
  });

  it('refuses unauthenticated calls or refused origins with proper HTTP error codes', async () => {
    const { createMcpServer } = await loadServerModule();
    const server = createMcpServer();

    // Refused origin -> 403
    const badOriginResponse = await server.handleRequest({
      body: { jsonrpc: '2.0', id: 'origin-fail-001', method: 'ping' },
      origin: 'https://attacker.example.com',
      authorization: `Bearer ${STANDARD_DISCOVERY_CREDENTIAL.rawSecret}`,
    });
    expect(badOriginResponse.status).toBe(403);

    // Missing auth -> 401
    const noAuthResponse = await server.handleRequest({
      body: { jsonrpc: '2.0', id: 'auth-fail-001', method: 'tools/list' },
      origin: 'https://mcp.example.com',
    });
    expect(noAuthResponse.status).toBe(401);
  });
});
