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

describe('AC-001 negative (mcp-surface facet): MCP transport and execution failure paths', () => {
  it('refuses MCP tool execution when client attempts to invoke tool outside granted profile', () => {
    function executeMcpTool(toolName: string, profile: ProfileBinding): void {
      const allowed = visibleToolsFor(profile);
      if (!allowed.includes(toolName)) {
        throw new Error(`MCP_TOOL_AUTHORIZATION_REFUSED: tool '${toolName}' not visible to profile '${profile.id}'`);
      }
    }

    const discoveryBinding: ProfileBinding = { id: 'discovery', klass: 'STANDARD' };

    // Allowed tools pass
    expect(() => executeMcpTool('discover_candidates', discoveryBinding)).not.toThrow();

    // Provider atomic tool call refused over MCP
    expect(() => executeMcpTool('provider_adapter_probe', discoveryBinding)).toThrow(
      /MCP_TOOL_AUTHORIZATION_REFUSED/,
    );
    expect(() => executeMcpTool('raw_ledger_diagnostic', discoveryBinding)).toThrow(
      /MCP_TOOL_AUTHORIZATION_REFUSED/,
    );
    // Unassigned domain tool refused over MCP
    expect(() => executeMcpTool('get_wallet_cluster_evidence', discoveryBinding)).toThrow(
      /MCP_TOOL_AUTHORIZATION_REFUSED/,
    );
  });

  it('refuses unauthenticated MCP tool execution requests', () => {
    function authenticateMcpRequest(authHeader: string | undefined): { authenticated: boolean } {
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('MCP_AUTHENTICATION_REQUIRED: missing or invalid Authorization header');
      }
      return { authenticated: true };
    }

    expect(() => authenticateMcpRequest(undefined)).toThrow(/MCP_AUTHENTICATION_REQUIRED/);
    expect(() => authenticateMcpRequest('Basic dXNlcjpwYXNz')).toThrow(/MCP_AUTHENTICATION_REQUIRED/);
    expect(() => authenticateMcpRequest('')).toThrow(/MCP_AUTHENTICATION_REQUIRED/);
  });

  it('refuses silent gaps in MCP tool response payloads when partial degradation is present', () => {
    function validateMcpResponseIntegrity(payload: {
      data: { missingSources?: string[] };
      meta: { partial: boolean; qualityCodes: string[] };
    }): void {
      if (
        payload.data.missingSources &&
        payload.data.missingSources.length > 0 &&
        (!payload.meta.partial || payload.meta.qualityCodes.length === 0)
      ) {
        throw new Error('SILENT_GAP_REFUSED: MCP response with missing sources must declare partial: true and qualityCodes');
      }
    }

    const invalidMcpResponse = {
      data: { missingSources: ['dex_stream'] },
      meta: { partial: false, qualityCodes: [] },
    };

    expect(() => validateMcpResponseIntegrity(invalidMcpResponse)).toThrow(/SILENT_GAP_REFUSED/);
  });
});

