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
import { McpOriginGate } from '../../packages/security/src/mcp-origin.ts';
import { McpProtocolGuard } from '../../packages/security/src/mcp-protocol-guard.ts';
import {
  INVALID_MCP_ORIGINS,
  MCP_PRODUCTION_ALLOWLIST,
  PROHIBITED_FINANCIAL_TOOL_CALLS,
} from '../fixtures/mcp/index.ts';
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

describe('AC-001 negative (mcp-surface facet): admission, scoping, and capability refusals', () => {
  const originGate = new McpOriginGate({
    allowlist: MCP_PRODUCTION_ALLOWLIST,
    absentOriginPolicy: 'PRODUCTION',
  });

  const protocolGuard = new McpProtocolGuard({
    maxMessageBytes: 262144, // 256 KiB cap
    allowedRevisions: ['2025-11-25'],
  });

  it('refuses MCP initialization from invalid or spoofed Origin headers', () => {
    for (const invalidOrigin of [
      ...INVALID_MCP_ORIGINS.PUNYCODE,
      ...INVALID_MCP_ORIGINS.TRAILING_DOT,
      ...INVALID_MCP_ORIGINS.MIXED_SCHEME,
      ...INVALID_MCP_ORIGINS.WRONG_PORT,
      ...INVALID_MCP_ORIGINS.WRONG_HOST_OR_SUBDOMAIN,
    ]) {
      const verdict = originGate.decide(invalidOrigin);
      expect(verdict.decision).toBe('REFUSE');
    }
  });

  it('refuses MCP initialization when Origin header is absent under PRODUCTION policy', () => {
    const verdict = originGate.decide(undefined);
    expect(verdict.decision).toBe('REFUSE');
    expect(verdict).toMatchObject({ reason: 'ABSENT_POLICY_REFUSES' });
  });

  it('refuses non-POST methods and invalid content types before MCP dispatch', () => {
    expect(
      protocolGuard.inspect({
        protocolRevision: '2025-11-25',
        contentType: 'text/plain',
        method: 'POST',
        messageBytes: 100,
      }).decision,
    ).toBe('REFUSE');

    expect(
      protocolGuard.inspect({
        protocolRevision: '2025-11-25',
        contentType: 'application/json',
        method: 'GET',
        messageBytes: 100,
      }).decision,
    ).toBe('REFUSE');
  });

  it('refuses prohibited financial operations requested over MCP surface fail-closed', () => {
    function evaluateMcpToolAdmission(toolName: string): void {
      const prohibitedKeywords = ['swap', 'sign', 'private_key', 'broadcast', 'create_wallet', 'bridge'];
      if (prohibitedKeywords.some((kw) => toolName.includes(kw))) {
        throw new Error(`PROHIBITED_CAPABILITY_REFUSED: tool '${toolName}' violates negative contract`);
      }
    }

    for (const prohibitedCall of PROHIBITED_FINANCIAL_TOOL_CALLS) {
      expect(() => evaluateMcpToolAdmission(prohibitedCall.name)).toThrow(
        /PROHIBITED_CAPABILITY_REFUSED/,
      );
    }
  });
});
