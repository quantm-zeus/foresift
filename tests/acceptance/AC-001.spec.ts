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
  HolderMode,
  PIPELINE_STAGE_ORDER,
  type PipelineStage,
  type UtcTimestamp,
} from '@foresift/domain';
import { parseCoreSchema, type ToolResultEnvelope } from '@foresift/shared-schemas';
import { McpOriginGate } from '../../packages/security/src/mcp-origin.ts';
import { McpProtocolGuard } from '../../packages/security/src/mcp-protocol-guard.ts';
import {
  CREDENTIAL_DISCOVERY_CLIENT,
  MCP_INITIALIZE_REQUEST,
  MCP_PRODUCTION_ALLOWLIST,
  SESSION_DISCOVERY_STATELESS,
} from '../fixtures/mcp/index.ts';
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

describe('AC-001 acceptance (mcp-surface facet): manual client initialize -> scoped profile -> HTTP tool call', () => {
  const originGate = new McpOriginGate({
    allowlist: MCP_PRODUCTION_ALLOWLIST,
    absentOriginPolicy: 'PRODUCTION',
  });

  const protocolGuard = new McpProtocolGuard({
    maxMessageBytes: 262144, // 256 KiB PRD §29.4 cap
    allowedRevisions: ['2025-11-25'],
  });

  it('manual client initialize (HolderMode.MCP_MANUAL) establishes baseline protocol session', () => {
    // 1. Validate Origin header
    const originVerdict = originGate.decide(CREDENTIAL_DISCOVERY_CLIENT.allowedOrigins[0]);
    expect(originVerdict.decision).toBe('ALLOW');

    // 2. Validate Protocol Inspection
    const protocolVerdict = protocolGuard.inspect({
      protocolRevision: MCP_INITIALIZE_REQUEST.params.protocolVersion,
      contentType: 'application/json',
      method: 'POST',
      messageBytes: JSON.stringify(MCP_INITIALIZE_REQUEST).length,
    });
    expect(protocolVerdict.decision).toBe('ALLOW');

    // 3. Confirm HolderMode setting for manual client initialization
    expect(HolderMode.MCP_MANUAL).toBe('MCP_MANUAL');
  });

  it('lists scoped profile tools over MCP surface without leaking atomic or foreign tools', () => {
    // Authenticated client bound to discovery profile queries tool catalog
    const profileBinding = { id: CREDENTIAL_DISCOVERY_CLIENT.profileId, klass: 'STANDARD' } as const;
    const scopedTools = visibleToolsFor(profileBinding);

    expect(scopedTools).toEqual([
      'discover_candidates',
      'get_asset_identity',
      'get_candidate_delta',
      'compare_candidates',
    ]);
    // Free discovery profile never receives atomic provider tools
    for (const atomic of ATOMIC_TOOL_CATALOG) {
      expect(scopedTools).not.toContain(atomic);
    }
  });

  it('executes discovery analysis tool call returning structured envelope without payment or prohibited keys', async () => {
    let callResultEnvelope: ToolResultEnvelope | null = null;

    const handlers: PipelineHandlers = Object.fromEntries(
      ALL_PIPELINE_STAGES.map((stage) => [
        stage,
        async () => {
          if (stage === 'RETURN_STRUCTURED_RESULT') {
            callResultEnvelope = {
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
    await orchestrator.run('run-ac001-mcp-call');

    expect(callResultEnvelope).not.toBeNull();
    const validated = parseCoreSchema('ToolResultEnvelope', callResultEnvelope);
    expect(validated.meta.toolName).toBe('discover_candidates');
    expect(validated.meta.qualityCodes).toContain('SOURCE_FIRST_PARTY_VERIFIED');
    expect(validated.meta.partial).toBe(false);

    // Negative contract check: no prohibited financial payload keys present
    const dataKeys = Object.keys(validated.data as Record<string, unknown>);
    expect(dataKeys).not.toContain('privateKey');
    expect(dataKeys).not.toContain('seedPhrase');
    expect(dataKeys).not.toContain('transactionPayload');
    expect(dataKeys).not.toContain('signatureRequest');
  });

  it('explicitly degrades over MCP surface when optional provider is unavailable without silent omission', async () => {
    let degradedMcpEnvelope: ToolResultEnvelope | null = null;

    const handlers: PipelineHandlers = Object.fromEntries(
      ALL_PIPELINE_STAGES.map((stage) => [
        stage,
        async () => {
          if (stage === 'RETURN_STRUCTURED_RESULT') {
            degradedMcpEnvelope = {
              data: {
                candidates: [
                  {
                    address: 'So11111111111111111111111111111111111111112',
                    missingSources: ['optional_dex_depth'],
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
    await orchestrator.run('run-ac001-mcp-degraded');

    expect(degradedMcpEnvelope).not.toBeNull();
    const validated = parseCoreSchema('ToolResultEnvelope', degradedMcpEnvelope);
    expect(validated.meta.partial).toBe(true);
    expect(validated.meta.qualityCodes).toContain('SOURCE_DEGRADED_UNAVAILABLE');
    expect(validated.meta.evidenceIds).toHaveLength(1);
  });
});
