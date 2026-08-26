/**
 * AC-002 acceptance (positive) — envelope completeness.
 * Traces: FR-CORE-003 (provenance, event-time, quality, and evidence envelope).
 * AC text (manifest §39): "Every observation carries quality codes, event-time,
 * ingest-time, availability provenance, and source coordinates."
 *
 * Exercises:
 * - Envelope completeness across all metadata dimensions: quality codes, timestamps
 *   (observedAt, availableAt, fetchedAt), provenance, evidence references, cache outcome,
 *   conflicts, and quota summary.
 * - Every important field has evidence references / quality codes.
 * - Envelope validates against authoritative Zod schema (ToolResultEnvelopeSchema).
 */
import { describe, expect, it } from 'bun:test';
import type { UtcTimestamp } from '@foresift/domain';
import { parseCoreSchema, type ToolResultEnvelope } from '@foresift/shared-schemas';

describe('AC-002 acceptance: envelope completeness', () => {
  it('structured tool result envelope carries all required metadata dimensions', () => {
    const envelope: ToolResultEnvelope = {
      data: {
        assetId: 'solana:So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        decimals: 9,
        marketData: {
          priceUsd: '150.50',
          liquidityUsd: '50000000',
        },
      },
      meta: {
        toolName: 'get_asset_identity',
        toolVersion: '1.0.0',
        provider: 'helius',
        operation: 'raw_asset_query',
        evidenceIds: ['ev-obs-001', 'ev-obs-002'],
        observedAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
        availableAt: '2026-08-01T00:01:00Z' as UtcTimestamp,
        fetchedAt: '2026-08-01T00:01:05Z' as UtcTimestamp,
        cache: 'HIT_FRESH',
        freshnessSeconds: 120,
        qualityCodes: ['QUALITY_HIGH', 'SOURCE_FIRST_PARTY_VERIFIED'],
        conflicts: [],
        quota: {
          quotaModel: 'REQUESTS_PER_PERIOD',
          reservationState: 'COMMITTED',
          estimatedUnits: 1,
          actualUnits: 1,
        },
        partial: false,
        resourceUris: ['foresift://evidence/ev-obs-001', 'foresift://evidence/ev-obs-002'],
      },
    };

    const parsed = parseCoreSchema('ToolResultEnvelope', envelope);
    expect(parsed.meta.toolName).toBe('get_asset_identity');
    expect(parsed.meta.toolVersion).toBe('1.0.0');
    expect(parsed.meta.provider).toBe('helius');
    expect(parsed.meta.operation).toBe('raw_asset_query');
    expect(parsed.meta.evidenceIds).toEqual(['ev-obs-001', 'ev-obs-002']);
    expect(parsed.meta.observedAt).toBe('2026-08-01T00:00:00Z');
    expect(parsed.meta.availableAt).toBe('2026-08-01T00:01:00Z');
    expect(parsed.meta.fetchedAt).toBe('2026-08-01T00:01:05Z');
    expect(parsed.meta.cache).toBe('HIT_FRESH');
    expect(parsed.meta.freshnessSeconds).toBe(120);
    expect(parsed.meta.qualityCodes).toEqual(['QUALITY_HIGH', 'SOURCE_FIRST_PARTY_VERIFIED']);
    expect(parsed.meta.conflicts).toEqual([]);
    expect(parsed.meta.quota.quotaModel).toBe('REQUESTS_PER_PERIOD');
    expect(parsed.meta.quota.reservationState).toBe('COMMITTED');
    expect(parsed.meta.partial).toBe(false);
  });

  it('validates evidence references and provenance on every important field', () => {
    const envelopeWithFieldEvidence: ToolResultEnvelope = {
      data: {
        tokenSecurity: {
          isHoneypot: false,
          top10Percent: 0.15,
          evidenceRef: 'ev-security-pack-001',
        },
        distribution: {
          holderCount: 15000,
          evidenceRef: 'ev-holder-dist-001',
        },
      },
      meta: {
        toolName: 'get_security_evidence_pack',
        toolVersion: '1.0.0',
        provider: 'gmgn',
        operation: 'token_security',
        evidenceIds: ['ev-security-pack-001', 'ev-holder-dist-001'],
        observedAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
        availableAt: '2026-08-01T00:01:00Z' as UtcTimestamp,
        fetchedAt: '2026-08-01T00:01:05Z' as UtcTimestamp,
        cache: 'HIT_FRESH',
        freshnessSeconds: 600,
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

    const parsed = parseCoreSchema('ToolResultEnvelope', envelopeWithFieldEvidence);
    const data = parsed.data as {
      tokenSecurity: { evidenceRef: string };
      distribution: { evidenceRef: string };
    };

    // Important data fields link to IDs in meta.evidenceIds
    expect(parsed.meta.evidenceIds).toContain(data.tokenSecurity.evidenceRef);
    expect(parsed.meta.evidenceIds).toContain(data.distribution.evidenceRef);
  });
});
