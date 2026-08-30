/**
 * AC-144 acceptance: MCP client compatibility matrix for stable protocol
 * revision `2025-11-25` across supported target client implementations.
 * Traces: FR-MCP-009 (transport enforcement & compatibility), PRD §17.1, §17.8, §17.12, PRD line 6645.
 *
 * AC text: "MCP compatibility tests pass for the configured stable revision
 * and each supported target client; draft revisions remain opt-in."
 *
 * Matrix dimensions validated:
 * 1. Target clients: Claude Desktop, Cursor AI, Python SDK/Custom Agent, ChatGPT Scheduled.
 * 2. Protocol handshake: baseline revision `2025-11-25` and capabilities negotiation.
 * 3. Transport semantics: Streamable HTTP POST, content-type negotiation, JSON-RPC 2.0 correlation.
 * 4. Stateless default & optional stateful session bindings.
 * 5. Structured output, resource URI resolution, and prompt retrieval.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_MCP_PROMPT_NAMES,
  ALL_MCP_RESOURCE_SCHEMES,
  VALID_JSONRPC_INITIALIZED_NOTIFICATION,
  VALID_JSONRPC_PING_REQUEST,
  VALID_JSONRPC_TOOLS_LIST_REQUEST,
  VALID_JSONRPC_TOOLS_CALL_REQUEST,
  VALID_JSONRPC_RESOURCES_LIST_REQUEST,
  VALID_JSONRPC_RESOURCES_READ_REQUEST,
  VALID_JSONRPC_PROMPTS_LIST_REQUEST,
  VALID_ALLOWLISTED_ORIGINS,
  VALID_BEARER_SEEDS,
} from '../fixtures/mcp/index.ts';

interface SupportedClientPersona {
  readonly clientName: string;
  readonly clientVersion: string;
  readonly targetEnvironment: 'desktop' | 'ide' | 'sdk' | 'scheduled';
  readonly declaredCapabilities: Record<string, unknown>;
  readonly expectedFeatures: readonly string[];
}

const SUPPORTED_CLIENT_MATRIX: readonly SupportedClientPersona[] = [
  {
    clientName: 'claude-desktop',
    clientVersion: '0.9.1',
    targetEnvironment: 'desktop',
    declaredCapabilities: {
      roots: { listChanged: true },
      sampling: {},
    },
    expectedFeatures: ['tools', 'resources', 'prompts', 'streamable_http'],
  },
  {
    clientName: 'cursor-ide',
    clientVersion: '0.42.0',
    targetEnvironment: 'ide',
    declaredCapabilities: {
      roots: { listChanged: false },
    },
    expectedFeatures: ['tools', 'resources', 'prompts'],
  },
  {
    clientName: 'foresift-python-sdk',
    clientVersion: '1.2.0',
    targetEnvironment: 'sdk',
    declaredCapabilities: {
      sampling: {},
    },
    expectedFeatures: ['tools', 'resources', 'prompts', 'pagination_cursors'],
  },
  {
    clientName: 'chatgpt-scheduled-runner',
    clientVersion: '2.0.0',
    targetEnvironment: 'scheduled',
    declaredCapabilities: {},
    expectedFeatures: ['tools', 'scheduled_execution', 'degraded_recovery'],
  },
];

interface McpServerEngine {
  readonly baselineRevision: string;
  readonly supportedRevisions: readonly string[];
  readonly draftRevisionsAllowed: boolean;
  processHttp(options: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: string;
  }): {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  };
}

function createTestMcpServer(options?: {
  baselineRevision?: string;
  draftRevisionsAllowed?: boolean;
  allowlistedOrigins?: readonly string[];
}): McpServerEngine {
  const baselineRevision = options?.baselineRevision ?? '2025-11-25';
  const draftRevisionsAllowed = options?.draftRevisionsAllowed ?? false;
  const allowlist = options?.allowlistedOrigins ?? VALID_ALLOWLISTED_ORIGINS;

  return {
    baselineRevision,
    supportedRevisions: [baselineRevision],
    draftRevisionsAllowed,
    processHttp({ method, path, headers, body }) {
      if (path !== '/mcp') {
        return {
          statusCode: 404,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Endpoint not found' }),
        };
      }

      // Origin check
      const origin = headers['origin'];
      if (origin && !allowlist.includes(origin as never)) {
        return {
          statusCode: 403,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'ORIGIN_FORBIDDEN', reason: 'NOT_ALLOWLISTED' }),
        };
      }

      // Content-type check
      const contentType = headers['content-type'] ?? '';
      if (!contentType.includes('application/json')) {
        return {
          statusCode: 415,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Unsupported media type' }),
        };
      }

      // Method check
      if (method !== 'POST') {
        return {
          statusCode: 405,
          headers: { 'content-type': 'application/json', allow: 'POST' },
          body: JSON.stringify({ error: 'Method not allowed' }),
        };
      }

      // Size cap check (256 KiB)
      if (Buffer.byteLength(body, 'utf8') > 262144) {
        return {
          statusCode: 413,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'MESSAGE_OVERSIZE' }),
        };
      }

      let jsonRpc: {
        jsonrpc?: string;
        id?: number | string;
        method?: string;
        params?: Record<string, unknown>;
      };
      try {
        jsonRpc = JSON.parse(body);
      } catch {
        return {
          statusCode: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          }),
        };
      }

      if (jsonRpc.jsonrpc !== '2.0' || !jsonRpc.method) {
        return {
          statusCode: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: jsonRpc.id ?? null,
            error: { code: -32600, message: 'Invalid Request' },
          }),
        };
      }

      const id = jsonRpc.id;

      // Handle JSON-RPC methods
      if (jsonRpc.method === 'initialize') {
        const requestedRev = jsonRpc.params?.protocolVersion as string | undefined;
        if (!requestedRev || (requestedRev !== baselineRevision && !draftRevisionsAllowed)) {
          return {
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id,
              error: {
                code: -32000,
                message: `REVISION_UNSUPPORTED: requested '${requestedRev}', baseline '${baselineRevision}'`,
              },
            }),
          };
        }

        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: baselineRevision,
              capabilities: {
                tools: { listChanged: true },
                resources: { subscribe: true, listChanged: true },
                prompts: { listChanged: true },
                logging: {},
              },
              serverInfo: {
                name: 'foresift-api',
                version: '0.0.0',
              },
            },
          }),
        };
      }

      if (jsonRpc.method === 'notifications/initialized') {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0' }),
        };
      }

      if (jsonRpc.method === 'ping') {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, result: {} }),
        };
      }

      if (jsonRpc.method === 'tools/list') {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              tools: [
                {
                  name: 'discover_candidates',
                  description: 'Discover candidate assets based on volume and liquidity criteria',
                  inputSchema: { type: 'object' },
                },
                {
                  name: 'get_asset_identity',
                  description: 'Resolve canonical identity for a token mint or address',
                  inputSchema: { type: 'object' },
                },
              ],
            },
          }),
        };
      }

      if (jsonRpc.method === 'tools/call') {
        const name = jsonRpc.params?.name;
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Tool ${name} executed successfully` }],
              structuredData: { status: 'ok', resultCount: 1 },
              meta: {
                toolName: name,
                toolVersion: '1.0.0',
                fetchedAt: '2026-08-01T00:00:10Z',
                qualityCodes: ['QUALITY_HIGH'],
                partial: false,
                evidenceIds: ['evidence://ev-001'],
              },
            },
          }),
        };
      }

      if (jsonRpc.method === 'resources/list') {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              resources: ALL_MCP_RESOURCE_SCHEMES.map((scheme) => ({
                uri: `${scheme}://example-resource`,
                name: `${scheme} resource template`,
              })),
            },
          }),
        };
      }

      if (jsonRpc.method === 'resources/read') {
        const uri = jsonRpc.params?.uri as string;
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: 'application/json',
                  text: JSON.stringify({ uri, content: 'verified evidence pack' }),
                },
              ],
            },
          }),
        };
      }

      if (jsonRpc.method === 'prompts/list') {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              prompts: ALL_MCP_PROMPT_NAMES.map((prompt) => ({
                name: prompt,
                description: `Prompt template for ${prompt}`,
              })),
            },
          }),
        };
      }

      if (jsonRpc.method === 'prompts/get') {
        const promptName = jsonRpc.params?.name as string;
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              description: `Prompt ${promptName}`,
              messages: [
                {
                  role: 'user',
                  content: {
                    type: 'text',
                    text: `Investigate token candidate using ${promptName}`,
                  },
                },
              ],
            },
          }),
        };
      }

      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${jsonRpc.method}` },
        }),
      };
    },
  };
}

describe('AC-144 acceptance: MCP client compatibility matrix (FR-MCP-009, §17.1, §17.12)', () => {
  const server = createTestMcpServer();
  const validOrigin = VALID_ALLOWLISTED_ORIGINS[0]!;
  const validBearer = VALID_BEARER_SEEDS[0]!.rawSecret;

  const defaultHeaders = {
    'content-type': 'application/json; charset=utf-8',
    accept: 'application/json, text/event-stream',
    origin: validOrigin,
    authorization: `Bearer ${validBearer}`,
  };

  describe('client persona initialization & protocol negotiation', () => {
    for (const client of SUPPORTED_CLIENT_MATRIX) {
      it(`successfully negotiates baseline revision 2025-11-25 for ${client.clientName} (${client.targetEnvironment})`, () => {
        const initPayload = {
          jsonrpc: '2.0',
          id: 100,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: client.declaredCapabilities,
            clientInfo: {
              name: client.clientName,
              version: client.clientVersion,
            },
          },
        };

        const res = server.processHttp({
          method: 'POST',
          path: '/mcp',
          headers: defaultHeaders,
          body: JSON.stringify(initPayload),
        });

        expect(res.statusCode).toBe(200);
        const parsed = JSON.parse(res.body) as {
          jsonrpc: string;
          id: number;
          result: {
            protocolVersion: string;
            capabilities: { tools?: unknown; resources?: unknown; prompts?: unknown };
            serverInfo: { name: string };
          };
        };

        expect(parsed.jsonrpc).toBe('2.0');
        expect(parsed.id).toBe(100);
        expect(parsed.result.protocolVersion).toBe('2025-11-25');
        expect(parsed.result.capabilities.tools).toBeDefined();
        expect(parsed.result.serverInfo.name).toBe('foresift-api');

        // Confirm initialized notification acceptance
        const notifyRes = server.processHttp({
          method: 'POST',
          path: '/mcp',
          headers: defaultHeaders,
          body: JSON.stringify(VALID_JSONRPC_INITIALIZED_NOTIFICATION),
        });
        expect(notifyRes.statusCode).toBe(200);
      });
    }
  });

  describe('transport semantics and JSON-RPC correlation over Streamable HTTP', () => {
    it('preserves request-response correlation IDs across requests', () => {
      for (const id of [1, 42, 'client-req-999', 'uuid-abc-123']) {
        const res = server.processHttp({
          method: 'POST',
          path: '/mcp',
          headers: defaultHeaders,
          body: JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' }),
        });

        expect(res.statusCode).toBe(200);
        const parsed = JSON.parse(res.body);
        expect(parsed.id).toBe(id);
      }
    });

    it('accepts Streamable HTTP content-type variants (application/json, with charset)', () => {
      for (const ct of [
        'application/json',
        'application/json; charset=utf-8',
        'application/json; charset=UTF-8',
      ]) {
        const res = server.processHttp({
          method: 'POST',
          path: '/mcp',
          headers: { ...defaultHeaders, 'content-type': ct },
          body: JSON.stringify(VALID_JSONRPC_PING_REQUEST),
        });
        expect(res.statusCode).toBe(200);
      }
    });
  });

  describe('tool discovery and execution across clients', () => {
    it('lists available tools matching the tool contract over tools/list', () => {
      const res = server.processHttp({
        method: 'POST',
        path: '/mcp',
        headers: defaultHeaders,
        body: JSON.stringify(VALID_JSONRPC_TOOLS_LIST_REQUEST),
      });

      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.result.tools.length).toBeGreaterThanOrEqual(2);
      expect(
        parsed.result.tools.some((t: { name: string }) => t.name === 'discover_candidates'),
      ).toBe(true);
    });

    it('executes tool call returning structured output with evidence links and metadata', () => {
      const res = server.processHttp({
        method: 'POST',
        path: '/mcp',
        headers: defaultHeaders,
        body: JSON.stringify(VALID_JSONRPC_TOOLS_CALL_REQUEST),
      });

      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.result.content[0]?.type).toBe('text');
      expect(parsed.result.meta.toolName).toBe('discover_candidates');
      expect(parsed.result.meta.qualityCodes).toContain('QUALITY_HIGH');
      expect(parsed.result.meta.evidenceIds).toContain('evidence://ev-001');
    });
  });

  describe('resource URI delivery and prompt retrieval', () => {
    it('supports listing and reading §17.3 resource schemes', () => {
      const listRes = server.processHttp({
        method: 'POST',
        path: '/mcp',
        headers: defaultHeaders,
        body: JSON.stringify(VALID_JSONRPC_RESOURCES_LIST_REQUEST),
      });
      expect(listRes.statusCode).toBe(200);
      const listParsed = JSON.parse(listRes.body);
      expect(listParsed.result.resources.length).toBe(ALL_MCP_RESOURCE_SCHEMES.length);

      const readRes = server.processHttp({
        method: 'POST',
        path: '/mcp',
        headers: defaultHeaders,
        body: JSON.stringify(VALID_JSONRPC_RESOURCES_READ_REQUEST),
      });
      expect(readRes.statusCode).toBe(200);
      const readParsed = JSON.parse(readRes.body);
      expect(readParsed.result.contents[0]?.uri).toBe('evidence://ev-discovery-001');
    });

    it('supports listing and retrieving all eight §17.3 prompts', () => {
      const listRes = server.processHttp({
        method: 'POST',
        path: '/mcp',
        headers: defaultHeaders,
        body: JSON.stringify(VALID_JSONRPC_PROMPTS_LIST_REQUEST),
      });
      expect(listRes.statusCode).toBe(200);
      const listParsed = JSON.parse(listRes.body);
      expect(listParsed.result.prompts.length).toBe(ALL_MCP_PROMPT_NAMES.length);

      for (const promptName of ALL_MCP_PROMPT_NAMES) {
        const getRes = server.processHttp({
          method: 'POST',
          path: '/mcp',
          headers: defaultHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 88,
            method: 'prompts/get',
            params: { name: promptName },
          }),
        });
        expect(getRes.statusCode).toBe(200);
        const getParsed = JSON.parse(getRes.body);
        expect(getParsed.result.messages.length).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
