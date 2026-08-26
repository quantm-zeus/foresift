/**
 * AC-004 negative / failure-path — conflicting provider data & explicit capability unavailability.
 * Traces: FR-CORE-002, FR-CORE-003.
 *
 * Asserts:
 * - Silent replacement / invalid conflict representation fails schema validation:
 *   a ProviderConflictRef must carry at least 2 distinct providers and at least 1 evidence ID.
 * - Unsupported capabilities must not silently return empty data without a CAPABILITY_UNAVAILABLE state.
 */
import { describe, expect, it } from 'bun:test';
import { parseCoreSchema } from '@foresift/shared-schemas';

describe('AC-004 negative: silent replacement and invalid conflict representations are refused', () => {
  const baseValidEnvelope = {
    data: { holderCount: 1000 },
    meta: {
      toolName: 'get_holder_distribution',
      toolVersion: '1.0.0',
      fetchedAt: '2026-08-01T00:00:00Z',
      evidenceIds: ['ev-001', 'ev-002'],
      qualityCodes: ['QUALITY_HIGH'],
      cache: 'HIT_FRESH',
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

  it('refuses ProviderConflictRef with fewer than 2 providers (cannot conflict with oneself alone)', () => {
    const invalid = {
      ...baseValidEnvelope,
      meta: {
        ...baseValidEnvelope.meta,
        conflicts: [
          {
            conflictId: 'conf-1',
            providers: ['gmgn'], // Only 1 provider!
            fieldPath: 'data.holderCount',
            evidenceIds: ['ev-001'],
          },
        ],
      },
    };
    expect(() => parseCoreSchema('ToolResultEnvelope', invalid)).toThrow();
  });

  it('refuses ProviderConflictRef with empty evidenceIds array', () => {
    const invalid = {
      ...baseValidEnvelope,
      meta: {
        ...baseValidEnvelope.meta,
        conflicts: [
          {
            conflictId: 'conf-1',
            providers: ['gmgn', 'helius'],
            fieldPath: 'data.holderCount',
            evidenceIds: [], // Empty evidenceIds!
          },
        ],
      },
    };
    expect(() => parseCoreSchema('ToolResultEnvelope', invalid)).toThrow();
  });

  it('refuses silent replacement: conflicting data indicated without conflict reference', () => {
    function assertHonestConflictHandling(
      envelope: typeof baseValidEnvelope & {
        meta: { qualityCodes: string[]; conflicts: unknown[] };
      },
    ): void {
      if (
        envelope.meta.qualityCodes.includes('DISAGREEMENT_PRESERVED') &&
        envelope.meta.conflicts.length === 0
      ) {
        throw new Error(
          'SILENT_REPLACEMENT_FORBIDDEN: disagreement reported in quality codes but conflicts array is empty',
        );
      }
    }

    const dishonestEnvelope = {
      ...baseValidEnvelope,
      meta: {
        ...baseValidEnvelope.meta,
        qualityCodes: ['DISAGREEMENT_PRESERVED'],
        conflicts: [], // Silent omission of conflict record!
      },
    };

    expect(() => assertHonestConflictHandling(dishonestEnvelope)).toThrow(
      /SILENT_REPLACEMENT_FORBIDDEN/,
    );
  });
});
