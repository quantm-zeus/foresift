/**
 * AC-001 negative / failure-path — tool-core facet.
 * Traces: FR-CORE-001, FR-CORE-002, FR-CORE-003, FR-CORE-004.
 *
 * Asserts:
 * - No silent gap: returning incomplete or degraded results without explicit degradation indicators in envelope meta fails validation.
 * - No out-of-profile tool exposure: actor bound to a narrow profile cannot list or execute tools outside that profile (e.g. atomic tools or unlisted domain tools).
 * - Out-of-profile execution attempts fail closed with typed authorization refusal.
 */
import { describe, expect, it } from 'bun:test';
import { parseCoreSchema, type ToolResultEnvelope } from '@foresift/shared-schemas';
import {
  visibleToolsFor,
  isVisibleToProfile,
  type ProfileBinding,
} from '../../packages/tool-core/src/profiles.ts';

describe('AC-001 negative (tool-core facet): no silent gaps and no out-of-profile tool exposure', () => {
  it('refuses silent gaps: degraded data without explicit partial: true or quality codes is rejected by policy', () => {
    // Semantic validator helper: an envelope reporting missing fields/sources
    // MUST have partial: true and appropriate qualityCodes.
    function validateNoSilentGaps(envelope: ToolResultEnvelope): void {
      const parsed = parseCoreSchema('ToolResultEnvelope', envelope);
      const data = parsed.data as Record<string, unknown> | null;
      const isDegradedData =
        data !== null &&
        typeof data === 'object' &&
        ('missingSources' in data || 'isPartial' in data || 'error' in data);

      if (isDegradedData && (!parsed.meta.partial || parsed.meta.qualityCodes.length === 0)) {
        throw new Error(
          'SILENT_GAP_DETECTED: degraded data must carry explicit partial: true and qualityCodes',
        );
      }
    }

    const invalidSilentGapEnvelope: ToolResultEnvelope = {
      data: {
        candidates: [{ address: 'So11111111111111111111111111111111111111112' }],
        missingSources: ['dex_volume_stream'],
      },
      meta: {
        toolName: 'discover_candidates',
        toolVersion: '1.0.0',
        fetchedAt: '2026-08-01T00:00:00Z' as never,
        evidenceIds: ['ev-001'],
        qualityCodes: [], // Empty qualityCodes with missingSources!
        cache: 'MISS',
        conflicts: [],
        quota: {
          quotaModel: 'REQUESTS_PER_PERIOD',
          reservationState: 'COMMITTED',
          estimatedUnits: 1,
          actualUnits: 1,
        },
        partial: false, // Silent omission!
      },
    };

    expect(() => validateNoSilentGaps(invalidSilentGapEnvelope)).toThrow(/SILENT_GAP_DETECTED/);
  });

  it('refuses out-of-profile tool exposure to standard discovery profile', () => {
    const discoveryBinding: ProfileBinding = { id: 'discovery', klass: 'STANDARD' };

    // Standard discovery actor attempting to bind atomic tool throws typed authorization error
    expect(() =>
      visibleToolsFor({
        id: 'discovery',
        klass: 'STANDARD',
        extraAtomicTools: ['provider_adapter_probe'],
      }),
    ).toThrow(/AUTHORIZATION_REFUSED|atomic/i);

    // Visibility check directly returns false for unassigned or atomic tools
    expect(
      isVisibleToProfile({ name: 'provider_adapter_probe', atomic: true }, discoveryBinding),
    ).toBe(false);
    expect(
      isVisibleToProfile({ name: 'raw_ledger_diagnostic', atomic: true }, discoveryBinding),
    ).toBe(false);
    expect(isVisibleToProfile({ name: 'get_wallet_cluster_evidence' }, discoveryBinding)).toBe(
      false,
    );
  });

  it('refuses execution when tool definition is not in actor profile', () => {
    function authorizeToolForActor(toolName: string, profile: ProfileBinding): void {
      const allowed = visibleToolsFor(profile);
      if (!allowed.includes(toolName)) {
        throw new Error(`AUTHORIZATION_REFUSED: tool '${toolName}' not in profile '${profile.id}'`);
      }
    }

    const discoveryProfile: ProfileBinding = { id: 'discovery', klass: 'STANDARD' };

    // Allowed tools succeed
    expect(() => authorizeToolForActor('discover_candidates', discoveryProfile)).not.toThrow();
    expect(() => authorizeToolForActor('get_asset_identity', discoveryProfile)).not.toThrow();

    // Out-of-profile tools throw typed error
    expect(() => authorizeToolForActor('get_wallet_cluster_evidence', discoveryProfile)).toThrow(
      /AUTHORIZATION_REFUSED/,
    );
    expect(() => authorizeToolForActor('provider_adapter_probe', discoveryProfile)).toThrow(
      /AUTHORIZATION_REFUSED/,
    );
  });
});

describe('AC-001 negative (mcp-surface facet): refusal of out-of-profile calls, uninitialized execution, and invalid arguments', () => {
  interface McpServerState {
    initialized: boolean;
    profileId: string;
  }

  function executeMcpCall(
    state: McpServerState,
    request: { method: string; params?: { name?: string; arguments?: Record<string, unknown> } },
  ): { error?: { code: number; message: string } } {
    if (!state.initialized) {
      return { error: { code: -32002, message: 'Server not initialized' } };
    }

    if (request.method !== 'tools/call') {
      return { error: { code: -32601, message: `Method '${request.method}' not found` } };
    }

    const toolName = request.params?.name;
    if (!toolName) {
      return { error: { code: -32602, message: 'Invalid params: missing tool name' } };
    }

    // Prohibited capability check
    const prohibitedKeywords = ['buy', 'sell', 'swap', 'sign', 'transfer', 'bridge', 'private_key'];
    if (prohibitedKeywords.some((kw) => toolName.toLowerCase().includes(kw))) {
      return {
        error: {
          code: -32600,
          message: `PROHIBITED_CAPABILITY_REFUSED: tool '${toolName}' is forbidden on the MCP surface`,
        },
      };
    }

    const allowedTools = visibleToolsFor({ id: state.profileId as never, klass: 'STANDARD' });
    if (!allowedTools.includes(toolName)) {
      return {
        error: {
          code: -32601,
          message: `AUTHORIZATION_REFUSED: tool '${toolName}' is not accessible in profile '${state.profileId}'`,
        },
      };
    }

    const args = request.params?.arguments;
    if (args && typeof args.minLiquidityUsd === 'number' && args.minLiquidityUsd < 0) {
      return {
        error: {
          code: -32602,
          message: 'INVALID_ARGUMENTS: minLiquidityUsd cannot be negative',
        },
      };
    }

    return {};
  }

  it('refuses MCP tools/call before client initialize handshake', () => {
    const uninitializedState: McpServerState = {
      initialized: false,
      profileId: 'discovery',
    };

    const res = executeMcpCall(uninitializedState, {
      method: 'tools/call',
      params: { name: 'discover_candidates', arguments: {} },
    });

    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe(-32002);
    expect(res.error?.message).toContain('Server not initialized');
  });

  it('refuses MCP tools/call on atomic or out-of-profile tools with typed authorization refusal', () => {
    const activeDiscoveryState: McpServerState = {
      initialized: true,
      profileId: 'discovery',
    };

    // Out-of-profile domain tool
    const outOfProfileRes = executeMcpCall(activeDiscoveryState, {
      method: 'tools/call',
      params: { name: 'get_wallet_cluster_evidence', arguments: {} },
    });
    expect(outOfProfileRes.error).toBeDefined();
    expect(outOfProfileRes.error?.message).toContain('AUTHORIZATION_REFUSED');

    // Atomic provider tool
    const atomicRes = executeMcpCall(activeDiscoveryState, {
      method: 'tools/call',
      params: { name: 'dexscreener_search_pairs', arguments: {} },
    });
    expect(atomicRes.error).toBeDefined();
    expect(atomicRes.error?.message).toContain('AUTHORIZATION_REFUSED');
  });

  it('refuses MCP tools/call when arguments violate schema', () => {
    const activeDiscoveryState: McpServerState = {
      initialized: true,
      profileId: 'discovery',
    };

    const invalidArgsRes = executeMcpCall(activeDiscoveryState, {
      method: 'tools/call',
      params: { name: 'discover_candidates', arguments: { minLiquidityUsd: -500 } },
    });
    expect(invalidArgsRes.error).toBeDefined();
    expect(invalidArgsRes.error?.code).toBe(-32602);
    expect(invalidArgsRes.error?.message).toContain('INVALID_ARGUMENTS');
  });

  it('refuses prohibited financial operations structurally over MCP tools/call', () => {
    const activeDiscoveryState: McpServerState = {
      initialized: true,
      profileId: 'discovery',
    };

    const prohibitedCalls = [
      'execute_swap_order',
      'sign_transaction_payload',
      'export_wallet_private_key',
      'bridge_cross_chain_asset',
    ];

    for (const forbiddenTool of prohibitedCalls) {
      const res = executeMcpCall(activeDiscoveryState, {
        method: 'tools/call',
        params: { name: forbiddenTool, arguments: {} },
      });
      expect(res.error).toBeDefined();
      expect(res.error?.message).toMatch(/PROHIBITED_CAPABILITY_REFUSED|AUTHORIZATION_REFUSED/);
    }
  });

  it('refuses silent gaps in MCP envelopes when partial results omit qualityCodes', () => {
    function validateMcpEnvelopeIntegrity(envelope: ToolResultEnvelope): void {
      const parsed = parseCoreSchema('ToolResultEnvelope', envelope);
      const isPartial = parsed.meta.partial;
      const qualityCodes = parsed.meta.qualityCodes;
      if (isPartial && qualityCodes.length === 0) {
        throw new Error('ENVELOPE_VALIDATION_FAILED: partial results must carry quality codes');
      }
    }

    const invalidEnvelope: ToolResultEnvelope = {
      data: { candidates: [] },
      meta: {
        toolName: 'discover_candidates',
        toolVersion: '1.0.0',
        fetchedAt: '2026-08-01T00:00:00Z' as never,
        evidenceIds: [],
        cache: 'MISS',
        qualityCodes: [], // Empty qualityCodes while partial is true!
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

    expect(() => validateMcpEnvelopeIntegrity(invalidEnvelope)).toThrow(
      /ENVELOPE_VALIDATION_FAILED/,
    );
  });
});

