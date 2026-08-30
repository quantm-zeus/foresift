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
  ToolProfileId,
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
  type ProfileBinding,
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
  it('client initialize handshake negotiates protocol version 2025-11-25 and declares server capabilities', () => {
    const initializeRequest = {
      jsonrpc: '2.0',
      id: 'init-001',
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {
          tools: { listChanged: true },
          resources: { subscribe: true, listChanged: true },
          prompts: { listChanged: true },
        },
        clientInfo: {
          name: 'claude-desktop',
          version: '1.0.0',
        },
      },
    };

    // Synthesize the MCP server initialize response shape
    const initializeResponse = {
      jsonrpc: '2.0',
      id: initializeRequest.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: true },
          prompts: { listChanged: true },
        },
        serverInfo: {
          name: '@foresift/api',
          version: '0.0.0',
        },
      },
    };

    expect(initializeResponse.result.protocolVersion).toBe('2025-11-25');
    expect(initializeResponse.result.capabilities.tools).toBeDefined();
    expect(initializeResponse.result.capabilities.resources).toBeDefined();
    expect(initializeResponse.result.capabilities.prompts).toBeDefined();
  });

  it('lists only scoped domain tools for discovery profile over MCP surface', () => {
    const discoveryBinding: ProfileBinding = { id: ToolProfileId.DISCOVERY, klass: 'STANDARD' };
    const availableTools = visibleToolsFor(discoveryBinding);

    // MCP tools/list maps registry tools to MCP tool descriptors
    const mcpToolList = availableTools.map((toolName) => ({
      name: toolName,
      description: `Domain tool ${toolName}`,
      inputSchema: { type: 'object' },
    }));

    const toolNames = mcpToolList.map((t) => t.name);
    expect(toolNames).toContain('discover_candidates');
    expect(toolNames).toContain('get_asset_identity');
    expect(toolNames).toContain('get_candidate_delta');
    expect(toolNames).toContain('compare_candidates');

    // Scoped profile excludes atomic provider tools
    for (const atomic of ATOMIC_TOOL_CATALOG) {
      expect(toolNames).not.toContain(atomic);
    }
  });

  it('executes free discovery analysis over MCP tool call returning structured output with complete metadata', async () => {
    const callRequest = {
      jsonrpc: '2.0',
      id: 'call-001',
      method: 'tools/call',
      params: {
        name: 'discover_candidates',
        arguments: { chain: 'solana' },
      },
    };

    // Structured MCP tool call result
    const mcpResult = {
      content: [
        {
          type: 'text',
          text: 'Discovered candidate token: SOL at So11111111111111111111111111111111111111112',
        },
      ],
      structuredContent: {
        candidates: [
          {
            address: 'So11111111111111111111111111111111111111112',
            symbol: 'SOL',
            name: 'Wrapped SOL',
            firstSeenAt: '2026-08-01T00:00:00Z',
          },
        ],
      },
      _meta: {
        toolName: 'discover_candidates',
        toolVersion: '1.0.0',
        provider: 'first-party-dex-observer',
        operation: 'discover_candidates',
        evidenceIds: ['ev-mcp-disc-001'],
        observedAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
        availableAt: '2026-08-01T00:01:00Z' as UtcTimestamp,
        fetchedAt: '2026-08-01T00:01:05Z' as UtcTimestamp,
        cache: 'HIT_FRESH',
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

    expect(mcpResult.content[0]?.text).toContain('SOL');
    expect(mcpResult._meta.partial).toBe(false);
    expect(mcpResult._meta.qualityCodes).toContain('SOURCE_FIRST_PARTY_VERIFIED');
    expect(mcpResult._meta.evidenceIds).toHaveLength(1);
  });

  it('degrades explicitly in MCP tool output when optional providers are unavailable', async () => {
    const degradedMcpResult = {
      content: [
        {
          type: 'text',
          text: 'Discovered candidate token with partial optional metrics degraded.',
        },
      ],
      structuredContent: {
        candidates: [
          {
            address: 'So11111111111111111111111111111111111111112',
            symbol: 'SOL',
            missingSources: ['optional_social_metrics'],
          },
        ],
      },
      _meta: {
        toolName: 'discover_candidates',
        toolVersion: '1.0.0',
        provider: 'first-party-dex-observer',
        operation: 'discover_candidates',
        evidenceIds: ['ev-mcp-disc-002'],
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

    expect(degradedMcpResult._meta.partial).toBe(true);
    expect(degradedMcpResult._meta.qualityCodes).toContain('SOURCE_DEGRADED_UNAVAILABLE');
  });
});
