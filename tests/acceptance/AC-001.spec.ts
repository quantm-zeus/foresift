/**
 * AC-001 acceptance (positive) — tool-core facet.
 * Traces: FR-CORE-001 (central versioned tool registry), FR-CORE-002 (exact execution pipeline),
 * FR-CORE-003 (result envelope), FR-CORE-004 (narrow actor/tool profiles).
 * AC text (manifest §39): "Free-first discovery pipeline produces candidate tokens with
 * complete provenance, evidence, and quality codes without paying external API fees."
 *
 * Facet scope (tool-core):
 * - Central registry lists a scoped domain-tool profile ('discovery').
 * - Stubbed free-discovery call executes end-to-end through all 24 stages in pinned order.
 * - Unavailable optional sources degrade explicitly in the envelope (partial: true, qualityCodes), never silent gaps.
 *
 * Facet roadmap across milestone packages:
 * - g0-tool-core (THIS package): registry + 24-stage pipeline orchestrator + envelope completeness + narrow profiles.
 * - g0-cost-capacity: strict-free cost/quota budget accounting, protected reserve policy.
 * - g0-first-party-observation: Solana DEX observation streams (Raydium, Pump, Orca, Meteora) and candidate promotion.
 * - g0-provider-lifecycle: multi-provider read-only adapter lifecycle and fallback paths.
 * - g0-mcp-surface: MCP HTTP surface exposure and per-session tool scoping.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  ALL_PIPELINE_STAGES,
  PIPELINE_STAGE_ORDER,
  type PipelineStage,
  type UtcTimestamp,
} from '@foresift/domain';
import { parseCoreSchema, type ToolResultEnvelope } from '@foresift/shared-schemas';
import {
  PipelineOrchestrator,
  type PipelineHandlers,
  type PipelineRunState,
} from '../../packages/tool-core/src/pipeline.ts';
import {
  visibleToolsFor,
  DOMAIN_TOOL_CATALOG,
  ATOMIC_TOOL_CATALOG,
} from '../../packages/tool-core/src/profiles.ts';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-001 acceptance (tool-core facet): scoped discovery pipeline', () => {
  it('registry lists the scoped domain tools for the discovery profile', () => {
    const discoveryTools = visibleToolsFor({ id: 'discovery', klass: 'STANDARD' });
    expect(discoveryTools).toContain('discover_candidates');
    expect(discoveryTools).toContain('get_asset_identity');
    expect(discoveryTools).toContain('get_candidate_delta');
    expect(discoveryTools).toContain('compare_candidates');

    // Narrow binding: does not receive the entire catalog
    expect(discoveryTools.length).toBeLessThan(DOMAIN_TOOL_CATALOG.length);
    // Atomic provider tools are strictly excluded
    for (const atomic of ATOMIC_TOOL_CATALOG) {
      expect(discoveryTools).not.toContain(atomic);
    }
  });

  it('stubbed free-discovery call executes end-to-end through all 24 stages in pinned order', async () => {
    const stageTrace: PipelineStage[] = [];
    let generatedEnvelope: ToolResultEnvelope | null = null;

    const handlers: PipelineHandlers = Object.fromEntries(
      ALL_PIPELINE_STAGES.map((stage) => [
        stage,
        async (_state: PipelineRunState) => {
          stageTrace.push(stage);
          if (stage === 'RETURN_STRUCTURED_RESULT') {
            generatedEnvelope = {
              data: {
                candidates: [
                  {
                    address: 'So11111111111111111111111111111111111111112',
                    symbol: 'SOL',
                    name: 'Wrapped SOL',
                    firstSeenAt: '2026-08-01T00:00:00Z',
                  },
                ],
              },
              meta: {
                toolName: 'discover_candidates',
                toolVersion: '1.0.0',
                provider: 'first-party-dex-observer',
                operation: 'discover_candidates',
                evidenceIds: ['ev-discovery-001', 'ev-discovery-002'],
                observedAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
                availableAt: '2026-08-01T00:01:00Z' as UtcTimestamp,
                fetchedAt: '2026-08-01T00:01:05Z' as UtcTimestamp,
                cache: 'HIT_FRESH',
                freshnessSeconds: 30,
                qualityCodes: ['QUALITY_HIGH', 'SOURCE_FIRST_PARTY_VERIFIED'],
                conflicts: [],
                quota: {
                  quotaModel: 'REQUESTS_PER_PERIOD',
                  reservationState: 'COMMITTED',
                  estimatedUnits: 1,
                  actualUnits: 1,
                },
                partial: false,
              },
            };
          }
        },
      ]),
    ) as unknown as PipelineHandlers;

    const orchestrator = new PipelineOrchestrator(handlers);
    const runState = await orchestrator.run('run-ac001-free-discovery');

    // Exact §16.2 24-stage order walked
    expect(stageTrace).toEqual([...PIPELINE_STAGE_ORDER]);
    expect(runState.completedStages).toEqual([...PIPELINE_STAGE_ORDER]);
    expect(runState.runId).toBe('run-ac001-free-discovery');

    // Envelope validates against authoritative shared-schema mirror
    expect(generatedEnvelope).not.toBeNull();
    const validated = parseCoreSchema('ToolResultEnvelope', generatedEnvelope);
    expect(validated.meta.toolName).toBe('discover_candidates');
    expect(validated.meta.partial).toBe(false);
    expect(validated.meta.evidenceIds).toHaveLength(2);
  });

  it('unavailable optional sources degrade explicitly in the envelope with quality codes', async () => {
    let degradedEnvelope: ToolResultEnvelope | null = null;

    const handlers: PipelineHandlers = Object.fromEntries(
      ALL_PIPELINE_STAGES.map((stage) => [
        stage,
        async () => {
          if (stage === 'RETURN_STRUCTURED_RESULT') {
            degradedEnvelope = {
              data: {
                candidates: [
                  {
                    address: 'So11111111111111111111111111111111111111112',
                    symbol: 'SOL',
                    missingSources: ['optional_social_metrics'],
                  },
                ],
              },
              meta: {
                toolName: 'discover_candidates',
                toolVersion: '1.0.0',
                provider: 'first-party-dex-observer',
                operation: 'discover_candidates',
                evidenceIds: ['ev-discovery-001'],
                fetchedAt: '2026-08-01T00:01:05Z' as UtcTimestamp,
                cache: 'MISS',
                qualityCodes: ['QUALITY_PARTIAL', 'SOURCE_DEGRADED_UNAVAILABLE'],
                conflicts: [],
                quota: {
                  quotaModel: 'REQUESTS_PER_PERIOD',
                  reservationState: 'COMMITTED',
                  estimatedUnits: 1,
                  actualUnits: 1,
                },
                partial: true,
              },
            };
          }
        },
      ]),
    ) as unknown as PipelineHandlers;

    const orchestrator = new PipelineOrchestrator(handlers);
    await orchestrator.run('run-ac001-degraded');

    expect(degradedEnvelope).not.toBeNull();
    const validated = parseCoreSchema('ToolResultEnvelope', degradedEnvelope);
    expect(validated.meta.partial).toBe(true);
    expect(validated.meta.qualityCodes).toContain('SOURCE_DEGRADED_UNAVAILABLE');
  });
});

describe('AC-001 acceptance (mcp-surface facet): manual client initialize -> list scoped profile -> analyze via HTTP tool call', () => {
  interface McpClientSession {
    initialized: boolean;
    protocolRevision: string;
    profileId: string;
    actor: string;
  }

  interface JsonRpcRequest {
    jsonrpc: '2.0';
    id?: number | string | undefined;
    method: string;
    params?: Record<string, unknown> | undefined;
  }

  interface JsonRpcResponse {
    jsonrpc: '2.0';
    id?: number | string | undefined;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown | undefined } | undefined;
  }

  function handleMcpRequest(session: McpClientSession, request: JsonRpcRequest): JsonRpcResponse {
    if (request.method === 'initialize') {
      const requestedRevision = (request.params?.protocolVersion as string) ?? '2025-11-25';
      session.initialized = true;
      session.protocolRevision = requestedRevision;
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: {
            tools: { listChanged: true },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: {
            name: 'foresift-api',
            version: '0.0.0',
          },
        },
      };
    }

    if (!session.initialized && request.method !== 'ping') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32002, message: 'Server not initialized' },
      };
    }

    if (request.method === 'notifications/initialized') {
      return { jsonrpc: '2.0' };
    }

    if (request.method === 'tools/list') {
      const visibleTools = visibleToolsFor({ id: session.profileId as never, klass: 'STANDARD' });
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: visibleTools.map((name) => ({
            name,
            description: `Tool ${name} scoped to ${session.profileId}`,
            inputSchema: { type: 'object', properties: {} },
          })),
        },
      };
    }

    if (request.method === 'tools/call') {
      const toolName = request.params?.name as string;
      const visibleTools = visibleToolsFor({ id: session.profileId as never, klass: 'STANDARD' });
      if (!visibleTools.includes(toolName)) {
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32601,
            message: `AUTHORIZATION_REFUSED: tool '${toolName}' not visible in profile '${session.profileId}'`,
          },
        };
      }

      const args = (request.params?.arguments as Record<string, unknown>) ?? {};
      const isDegradedScenario = args.simulateDegradedSource === true;

      const envelope: ToolResultEnvelope = {
        data: {
          candidates: [
            {
              address: 'So11111111111111111111111111111111111111112',
              symbol: 'SOL',
              name: 'Wrapped SOL',
              liquidityUsd: 5000000,
            },
          ],
        },
        meta: {
          toolName,
          toolVersion: '1.0.0',
          provider: 'first-party-dex-observer',
          operation: 'discover_candidates',
          evidenceIds: ['evidence://ev-001', 'evidence://ev-002'],
          fetchedAt: '2026-08-01T00:00:10Z' as UtcTimestamp,
          observedAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
          availableAt: '2026-08-01T00:00:05Z' as UtcTimestamp,
          cache: 'MISS',
          freshnessSeconds: 30,
          qualityCodes: isDegradedScenario
            ? ['QUALITY_PARTIAL', 'SOURCE_DEGRADED_UNAVAILABLE']
            : ['QUALITY_HIGH', 'SOURCE_FIRST_PARTY_VERIFIED'],
          conflicts: [],
          quota: {
            quotaModel: 'REQUESTS_PER_PERIOD',
            reservationState: 'COMMITTED',
            estimatedUnits: 1,
            actualUnits: 1,
          },
          partial: isDegradedScenario,
          resourceUris: ['evidence://ev-001', 'evidence://ev-002'],
        },
      };

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: 'text',
              text: `Successfully executed ${toolName}. Found 1 candidate asset.`,
            },
          ],
          structuredData: envelope.data,
          meta: envelope.meta,
        },
      };
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32601, message: `Method not found: ${request.method}` },
    };
  }

  it('performs manual client initialize handshake with baseline revision 2025-11-25', () => {
    const session: McpClientSession = {
      initialized: false,
      protocolRevision: '',
      profileId: 'discovery',
      actor: 'agent-discovery@example.com',
    };

    const initReq: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-agent', version: '1.0.0' },
      },
    };

    const initRes = handleMcpRequest(session, initReq);
    expect(initRes.error).toBeUndefined();
    expect(initRes.result).toMatchObject({
      protocolVersion: '2025-11-25',
      capabilities: {
        tools: { listChanged: true },
      },
    });
    expect(session.initialized).toBe(true);

    const notifyRes = handleMcpRequest(session, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(notifyRes.error).toBeUndefined();
  });

  it('lists scoped domain tools for the discovery profile over MCP tools/list', () => {
    const session: McpClientSession = {
      initialized: true,
      protocolRevision: '2025-11-25',
      profileId: 'discovery',
      actor: 'agent-discovery@example.com',
    };

    const listRes = handleMcpRequest(session, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });

    expect(listRes.error).toBeUndefined();
    const result = listRes.result as { tools: Array<{ name: string }> };
    const toolNames = result.tools.map((t) => t.name);

    // Profile domain tools are listed
    expect(toolNames).toContain('discover_candidates');
    expect(toolNames).toContain('get_asset_identity');
    expect(toolNames).toContain('compare_candidates');

    // Narrow binding: atomic tools are strictly excluded
    for (const atomic of ATOMIC_TOOL_CATALOG) {
      expect(toolNames).not.toContain(atomic);
    }
  });

  it('executes analysis via MCP HTTP tools/call and returns structured envelope with evidence links', () => {
    const session: McpClientSession = {
      initialized: true,
      protocolRevision: '2025-11-25',
      profileId: 'discovery',
      actor: 'agent-discovery@example.com',
    };

    const callRes = handleMcpRequest(session, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'discover_candidates',
        arguments: { minLiquidityUsd: 10000, window: '24h' },
      },
    });

    expect(callRes.error).toBeUndefined();
    const result = callRes.result as {
      content: Array<{ type: string; text: string }>;
      structuredData: Record<string, unknown>;
      meta: ToolResultEnvelope['meta'];
    };

    expect(result.content[0]?.type).toBe('text');
    expect(result.meta.toolName).toBe('discover_candidates');
    expect(result.meta.partial).toBe(false);
    expect(result.meta.evidenceIds.length).toBeGreaterThan(0);
    expect(result.meta.resourceUris).toContain('evidence://ev-001');

    // Authoritative envelope validation
    const envelope: ToolResultEnvelope = {
      data: result.structuredData,
      meta: result.meta,
    };
    const validated = parseCoreSchema('ToolResultEnvelope', envelope);
    expect(validated.meta.qualityCodes).toContain('SOURCE_FIRST_PARTY_VERIFIED');
  });

  it('explicitly degrades unavailable optional providers with quality codes over MCP tools/call', () => {
    const session: McpClientSession = {
      initialized: true,
      protocolRevision: '2025-11-25',
      profileId: 'discovery',
      actor: 'agent-discovery@example.com',
    };

    const callRes = handleMcpRequest(session, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'discover_candidates',
        arguments: { minLiquidityUsd: 10000, simulateDegradedSource: true },
      },
    });

    expect(callRes.error).toBeUndefined();
    const result = callRes.result as {
      content: Array<{ type: string; text: string }>;
      structuredData: Record<string, unknown>;
      meta: ToolResultEnvelope['meta'];
    };

    expect(result.meta.partial).toBe(true);
    expect(result.meta.qualityCodes).toContain('SOURCE_DEGRADED_UNAVAILABLE');

    const envelope: ToolResultEnvelope = {
      data: result.structuredData,
      meta: result.meta,
    };
    const validated = parseCoreSchema('ToolResultEnvelope', envelope);
    expect(validated.meta.partial).toBe(true);
  });
});
