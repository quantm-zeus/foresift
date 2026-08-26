// AC-052 (acceptance): "Secrets do not appear in model context, logs,
// traces, exports, or UI." Positive flows: clean text passes context
// guards, log redaction is idempotent and stable, keyed references follow
// their sanctioned export/UI paths, and lifecycle rotation records cleanly.
import { describe, expect, it } from 'bun:test';
import {
  SECRET_CLASSIFICATIONS,
  SecretLifecycleLedger,
  detectMaterial,
  redactForLogs,
  refuseSecretTowardModelContext,
  assertEnvironmentSeparation,
  assertExportAllowed,
  assertUiDisplayAllowed,
  validateSecretClassConfiguration,
} from '../../packages/security/src/secrets-policy.ts';
import { parseCoreSchema, type ToolResultEnvelope } from '@foresift/shared-schemas';

describe('AC-052: secret-hygiene flows admit only clean material', () => {
  it('clean operational text carries no detectable material into context', () => {
    expect(detectMaterial('portfolio snapshot for wallet at slot 12345')).toEqual([]);
    expect(() =>
      refuseSecretTowardModelContext({
        content: 'detector fired with evidence ref evidence://run/1',
      }),
    ).not.toThrow();
  });

  it('log redaction replaces known values once and stays idempotent', () => {
    const redacted = redactForLogs('request used key sk-proj-abcdefghijklmnopqrstuvwx and failed');
    expect(redacted).toContain('[REDACTED:');
    expect(redacted).not.toContain('sk-proj-abcdefghijklmnopqrstuvwx');
    expect(redactForLogs(redacted)).toBe(redacted);
  });

  it('keyed REFERENCES (never raw credentials) hold sanctioned export paths', () => {
    // Hash/key-ID references are exactly the classes export may carry.
    for (const classification of [
      'MCP_CREDENTIAL_HASH',
      'ENCRYPTION_KEY_REFERENCE',
      'PRODUCER_SIGNING_KEY_REFERENCE',
    ] as const) {
      expect(() => assertExportAllowed(classification, 'ALPHA_LAB')).not.toThrow();
    }
    // Masked reference display in UI is likewise sanctioned.
    expect(() => assertUiDisplayAllowed('MCP_CREDENTIAL_HASH')).not.toThrow();
  });

  it('environment separation admits downward-safe references', () => {
    expect(() => assertEnvironmentSeparation('PRODUCTION', 'PRODUCTION')).not.toThrow();
    expect(() => assertEnvironmentSeparation('ALPHA_LAB', 'PRODUCTION')).not.toThrow();
  });

  it('the full classification set is a valid configuration', () => {
    expect(() => validateSecretClassConfiguration(SECRET_CLASSIFICATIONS)).not.toThrow();
    expect(SECRET_CLASSIFICATIONS.length).toBeGreaterThanOrEqual(5);
  });

  it('rotation records land with strictly-beyond overlap windows', () => {
    const ledger = new SecretLifecycleLedger();
    const event = ledger.recordRotation({
      secretRef: 'ref/mcp-primary',
      classification: 'MCP_CREDENTIAL_HASH',
      at: '2026-08-24T00:00:00.000Z',
      overlapUntil: '2026-08-24T02:00:00.000Z',
      environment: 'PRODUCTION',
    });
    expect(event.event).toBe('ROTATED');
    expect(ledger.all()).toHaveLength(1);
  });
});

describe('AC-052 acceptance (tool-core substrate): emitted envelopes and audit payloads carry no secrets', () => {
  it('clean envelope payload validates with zero detected secrets', () => {
    const envelope: ToolResultEnvelope = {
      data: {
        poolAddress: '0x1111111111111111111111111111111111111111',
        reserveUsd: '500000',
      },
      meta: {
        toolName: 'get_pool_reserves',
        toolVersion: '1.0.0',
        evidenceIds: ['ev-clean-1'],
        fetchedAt: '2026-08-24T00:00:00Z' as never,
        cache: 'MISS',
        qualityCodes: ['QUALITY_HIGH'],
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

    const parsed = parseCoreSchema('ToolResultEnvelope', envelope);
    const json = JSON.stringify(parsed);
    expect(detectMaterial(json)).toEqual([]);
  });
});
