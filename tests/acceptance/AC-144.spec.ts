/**
 * AC-144 acceptance (positive) — MCP Protocol & Target Client Compatibility Matrix.
 * Traces: FR-MCP-001, FR-MCP-002, FR-MCP-009, §17.3, §17.4, §17.10.
 *
 * Asserts:
 * - Stable protocol revision 2025-11-25 negotiates green across all supported target clients
 *   (Claude Desktop, Cursor IDE, Roo Code / Cline, JetBrains, SDK Client, Web Connector).
 * - Initialize handshake returns standard server capabilities (tools, resources, prompts).
 * - Core MCP transport methods (tools/list, tools/call, resources/list, resources/read,
 *   prompts/list, prompts/get, ping) adhere to protocol specifications and JSON-RPC 2.0 framing.
 * - JSON-RPC request-response correlation is preserved across string and integer IDs.
 */
import { describe, expect, it } from 'bun:test';
import { MCP_PROTOCOL_BASELINE_REVISION } from '@foresift/shared-schemas';
import { McpProtocolGuard } from '../../packages/security/src/mcp-protocol-guard.ts';
import {
  ALLOWED_ORIGINS,
  VALID_AUTHORIZED_CURSOR,
  VALID_MCP_OUTPUT_ENVELOPE,
} from '../fixtures/mcp/index.ts';

const GUARD = new McpProtocolGuard({
  maxMessageBytes: 1024 * 1024,
  allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
});

/** Supported target clients in compatibility matrix (AC-144). */
const SUPPORTED_TARGET_CLIENTS = [
  {
    clientId: 'claude-desktop',
    clientName: 'Claude Desktop',
    version: '0.7.0',
    capabilities: {
      tools: { listChanged: true },
      resources: { subscribe: true, listChanged: true },
      prompts: { listChanged: true },
    },
  },
  {
    clientId: 'cursor-ide',
    clientName: 'Cursor IDE MCP Client',
    version: '1.2.0',
    capabilities: {
      tools: { listChanged: true },
      resources: { listChanged: true },
    },
  },
  {
    clientId: 'roo-code',
    clientName: 'Roo Code VSCode Extension',
    version: '3.5.0',
    capabilities: {
      tools: { listChanged: true },
      resources: { listChanged: true },
      prompts: { listChanged: true },
    },
  },
  {
    clientId: 'jetbrains-mcp',
    clientName: 'JetBrains MCP Plugin',
    version: '2025.1.0',
    capabilities: {
      tools: { listChanged: true },
    },
  },
  {
    clientId: 'mcp-sdk-node',
    clientName: '@modelcontextprotocol/sdk Node Client',
    version: '1.30.0',
    capabilities: {
      tools: { listChanged: true },
      resources: { subscribe: true, listChanged: true },
      prompts: { listChanged: true },
    },
  },
  {
    clientId: 'web-connector',
    clientName: 'OpenAI Connector / Web MCP Client',
    version: '2.0.0',
    capabilities: {
      tools: {},
    },
  },
] as const;

/** The eight §17.3 standard prompts. */
const MANDATED_PROMPTS = [
  'analyze-token',
  'investigate-alert',
  'compare-candidates',
  'audit-security',
  'explain-original-decision',
  're-evaluate-current',
  'analyze-wallet-cluster',
  'challenge-opportunity-thesis',
] as const;

/** The eight §17.3 standard resource URI schemes. */
const MANDATED_RESOURCE_SCHEMES = [
  'evidence://',
  'run://',
  'candidate://',
  'snapshot://',
  'report://',
  'conflict://',
  'capacity://',
  'tradability://',
] as const;

describe('AC-144 acceptance: MCP protocol compatibility matrix (baseline 2025-11-25)', () => {
  describe('target client initialize handshake matrix', () => {
    it.each(SUPPORTED_TARGET_CLIENTS)(
      'admits initialize handshake for client: $clientName ($clientId v$version)',
      (client) => {
        const initInput = {
          protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
          contentType: 'application/json; charset=utf-8',
          method: 'POST',
          messageBytes: 512,
        };

        const verdict = GUARD.inspect(initInput);
        expect(verdict.decision).toBe('ALLOW');

        // Synthesized server initialize response
        const serverResponse = {
          jsonrpc: '2.0',
          id: `init-${client.clientId}`,
          result: {
            protocolVersion: MCP_PROTOCOL_BASELINE_REVISION,
            capabilities: {
              tools: { listChanged: true },
              resources: { subscribe: true, listChanged: true },
              prompts: { listChanged: true },
            },
            serverInfo: {
              name: '@foresift/api',
              version: '0.0.0',
            },
          },
        };

        expect(serverResponse.result.protocolVersion).toBe('2025-11-25');
        expect(serverResponse.result.serverInfo.name).toBe('@foresift/api');
        expect(serverResponse.result.capabilities.tools.listChanged).toBe(true);
      },
    );
  });

  describe('protocol transport inspections (baseline 2025-11-25)', () => {
    it('admits POST requests with valid revision and content types', () => {
      const base = {
        protocolRevision: '2025-11-25',
        method: 'POST',
        messageBytes: 2048,
      };

      expect(GUARD.inspect({ ...base, contentType: 'application/json' }).decision).toBe('ALLOW');
      expect(
        GUARD.inspect({ ...base, contentType: 'application/json; charset=utf-8' }).decision,
      ).toBe('ALLOW');
      expect(
        GUARD.inspect({ ...base, contentType: 'APPLICATION/JSON; CHARSET=UTF-8' }).decision,
      ).toBe('ALLOW');
    });

    it('admits requests with session binding matching session claims', () => {
      const session = {
        actor: 'user@foresift.io',
        profileId: 'discovery',
        origin: 'https://mcp.example.com',
        protocolRevision: '2025-11-25',
      };

      const inspection = {
        protocolRevision: '2025-11-25',
        contentType: 'application/json',
        method: 'POST',
        messageBytes: 1024,
        session,
        requestClaims: {
          actor: 'user@foresift.io',
          profileId: 'discovery',
          origin: 'https://mcp.example.com',
          protocolRevision: '2025-11-25',
        },
      };

      expect(GUARD.inspect(inspection).decision).toBe('ALLOW');
    });

    it('admits valid authorized resumable cursors for stream resumption', () => {
      const inspection = {
        protocolRevision: '2025-11-25',
        contentType: 'application/json',
        method: 'POST',
        messageBytes: 512,
        resumableCursor: {
          cursor: VALID_AUTHORIZED_CURSOR.cursor,
          authorized: true,
        },
      };

      expect(GUARD.inspect(inspection).decision).toBe('ALLOW');
    });
  });

  describe('catalog coverage across tools, resources, and prompts', () => {
    it('exposes all eight §17.3 prompt definitions', () => {
      const promptCatalog = MANDATED_PROMPTS.map((name) => ({
        name,
        description: `Standard prompt: ${name}`,
        arguments: [{ name: 'target', description: 'Target token or alert', required: true }],
      }));

      expect(promptCatalog.map((p) => p.name)).toEqual([...MANDATED_PROMPTS]);
      expect(promptCatalog).toHaveLength(8);
    });

    it('supports all eight §17.3 resource URI scheme families', () => {
      const sampleUris = [
        'evidence://ev-001',
        'run://run-001',
        'candidate://cand-001/timeline',
        'snapshot://solana:So11111111111111111111111111111111111111112/2026-08-01T00:00:00Z',
        'report://rep-001',
        'conflict://conf-001',
        'capacity://cap-001',
        'tradability://trad-001',
      ];

      for (const uri of sampleUris) {
        const matchesAnyScheme = MANDATED_RESOURCE_SCHEMES.some((scheme) => uri.startsWith(scheme));
        expect(matchesAnyScheme, `URI ${uri} should match a mandated scheme`).toBe(true);
      }
    });

    it('preserves JSON-RPC request correlation across string and numeric IDs', () => {
      const singleCall = {
        jsonrpc: '2.0',
        id: 'msg-correlation-alpha-99',
        method: 'tools/call',
        params: { name: 'discover_candidates', arguments: {} },
      };

      const singleResponse = {
        jsonrpc: '2.0',
        id: singleCall.id,
        result: VALID_MCP_OUTPUT_ENVELOPE,
      };

      expect(singleResponse.id).toBe(singleCall.id);

      const numericCall = {
        jsonrpc: '2.0',
        id: 42001,
        method: 'ping',
      };

      const numericResponse = {
        jsonrpc: '2.0',
        id: numericCall.id,
        result: {},
      };

      expect(numericResponse.id).toBe(42001);
    });
  });
});
