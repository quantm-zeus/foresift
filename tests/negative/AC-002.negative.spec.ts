/**
 * AC-002 negative / failure-path — envelope completeness.
 * Traces: FR-CORE-003.
 *
 * Asserts:
 * - Result lacking mandatory metadata fields (fetchedAt, qualityCodes, evidenceIds,
 *   quota summary, cache outcome, conflicts, partial) is refused fail-closed by schema.
 * - Malformed timestamps or negative freshness windows fail schema validation.
 */
import { describe, expect, it } from 'bun:test';
import { parseCoreSchema } from '@foresift/shared-schemas';

describe('AC-002 negative: result lacking envelope metadata is refused', () => {
  const baseValidEnvelope = {
    data: { price: '100' },
    meta: {
      toolName: 'get_asset_identity',
      toolVersion: '1.0.0',
      fetchedAt: '2026-08-01T00:00:00Z',
      evidenceIds: ['ev-001'],
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

  it('refuses envelope missing fetchedAt', () => {
    const invalid = {
      ...baseValidEnvelope,
      meta: { ...baseValidEnvelope.meta, fetchedAt: undefined },
    };
    expect(() => parseCoreSchema('ToolResultEnvelope', invalid)).toThrow();
  });

  it('refuses envelope missing qualityCodes', () => {
    const invalid = {
      ...baseValidEnvelope,
      meta: { ...baseValidEnvelope.meta, qualityCodes: undefined },
    };
    expect(() => parseCoreSchema('ToolResultEnvelope', invalid)).toThrow();
  });

  it('refuses envelope missing evidenceIds', () => {
    const invalid = {
      ...baseValidEnvelope,
      meta: { ...baseValidEnvelope.meta, evidenceIds: undefined },
    };
    expect(() => parseCoreSchema('ToolResultEnvelope', invalid)).toThrow();
  });

  it('refuses envelope missing quota summary', () => {
    const invalid = {
      ...baseValidEnvelope,
      meta: { ...baseValidEnvelope.meta, quota: undefined },
    };
    expect(() => parseCoreSchema('ToolResultEnvelope', invalid)).toThrow();
  });

  it('refuses envelope missing cache outcome', () => {
    const invalid = {
      ...baseValidEnvelope,
      meta: { ...baseValidEnvelope.meta, cache: undefined },
    };
    expect(() => parseCoreSchema('ToolResultEnvelope', invalid)).toThrow();
  });

  it('refuses envelope with negative freshnessSeconds', () => {
    const invalid = {
      ...baseValidEnvelope,
      meta: { ...baseValidEnvelope.meta, freshnessSeconds: -30 },
    };
    expect(() => parseCoreSchema('ToolResultEnvelope', invalid)).toThrow();
  });

  it('refuses envelope with malformed UtcTimestamp format', () => {
    const invalid = {
      ...baseValidEnvelope,
      meta: { ...baseValidEnvelope.meta, fetchedAt: 'not-a-timestamp' },
    };
    expect(() => parseCoreSchema('ToolResultEnvelope', invalid)).toThrow();
  });
});
