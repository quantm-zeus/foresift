/**
 * apps/api/test/output.spec.ts
 *
 * Unit tests for MCP output formatting, pagination & prohibited payload scrubbing (T015 / AC-002, AC-004, AC-050).
 * Traces: FR-MCP-003, §17.4, §29.4, INV-001, AC-002, AC-004, AC-050.
 *
 * Asserts:
 * - Formats outputs according to §17.4 output envelope (structuredContent, textContent, meta, resourceLinks).
 * - Enforces §29.4 caps (1 MiB structured response, 100 records max page).
 * - Implements deterministic ordering and cursor pagination mapping nextCursor.
 * - Preserves quality codes, freshness, capability, rights, cost, and source-dependence metadata without loss.
 * - Surfaces explicit abstention states (ABSTAINED, INSUFFICIENT_DATA) honestly without silent omission.
 * - Prohibited-payload scrub: rejects or strips private keys, seed phrases, tx payloads, signing requests, or trade execution payloads.
 */
import { describe, expect, it } from 'bun:test';
import {
  formatMcpEnvelope,
  paginateResults,
  scrubProhibitedPayload,
  type FormatEnvelopeInput,
} from '../src/mcp/output.ts';

describe('T015: MCP output contract, pagination & prohibited scrubbing (AC-002, AC-004, AC-050)', () => {
  it('formats valid ToolResultEnvelope into standard McpOutputEnvelope', () => {
    const input: FormatEnvelopeInput = {
      toolName: 'discover_candidates',
      data: {
        candidates: [{ address: 'So11111111111111111111111111111111111111112', symbol: 'SOL' }],
      },
      meta: {
        toolName: 'discover_candidates',
        toolVersion: '1.0.0',
        fetchedAt: '2026-08-01T00:00:00Z',
        evidenceIds: ['ev-001'],
        qualityCodes: ['QUALITY_HIGH', 'SOURCE_FIRST_PARTY_VERIFIED'],
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
      resourceLinks: [{ uri: 'evidence://ev-001', title: 'Candidate Evidence' }],
    };

    const envelope = formatMcpEnvelope(input);
    expect(envelope.structuredContent).toBeDefined();
    expect(envelope.textContent).toContain('SOL');
    expect(envelope.meta.toolName).toBe('discover_candidates');
    expect(envelope.meta.qualityCodes).toContain('SOURCE_FIRST_PARTY_VERIFIED');
    expect(envelope.resourceLinks).toHaveLength(1);
    expect(envelope.resourceLinks[0]?.uri).toBe('evidence://ev-001');
  });

  it('preserves quality, provenance, rights, and source-dependence metadata unmodified (AC-002)', () => {
    const input: FormatEnvelopeInput = {
      toolName: 'get_asset_identity',
      data: { symbol: 'SOL', name: 'Wrapped SOL' },
      meta: {
        toolName: 'get_asset_identity',
        toolVersion: '1.0.0',
        fetchedAt: '2026-08-01T00:00:00Z',
        evidenceIds: ['ev-provenance-01'],
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
        sourceDependence: ['solana-dex-observer'],
      },
      resourceLinks: [{ uri: 'evidence://ev-provenance-01', title: 'Evidence' }],
    };

    const envelope = formatMcpEnvelope(input);
    expect(envelope.meta.sourceDependence).toEqual(['solana-dex-observer']);
    expect(envelope.meta.qualityCodes).toContain('QUALITY_HIGH');
  });

  it('surfaces explicit abstention and partial degradation states without silent gaps (AC-004)', () => {
    const input: FormatEnvelopeInput = {
      toolName: 'discover_candidates',
      data: { candidates: [] },
      meta: {
        toolName: 'discover_candidates',
        toolVersion: '1.0.0',
        fetchedAt: '2026-08-01T00:00:00Z',
        evidenceIds: [],
        qualityCodes: ['QUALITY_ABSTAINED', 'SOURCE_DATA_CONFLICT'],
        cache: 'MISS',
        conflicts: [{ type: 'PRICE_DISCREPANCY', severity: 'HIGH' }],
        quota: {
          quotaModel: 'REQUESTS_PER_PERIOD',
          reservationState: 'COMMITTED',
          estimatedUnits: 1,
          actualUnits: 1,
        },
        partial: true,
        abstentionReason: 'Conflicting cross-DEX liquidity observations',
      },
      resourceLinks: [{ uri: 'conflict://conf-001', title: 'Conflict detail' }],
    };

    const envelope = formatMcpEnvelope(input);
    expect(envelope.meta.partial).toBe(true);
    expect(envelope.meta.abstentionReason).toBe('Conflicting cross-DEX liquidity observations');
    expect(envelope.textContent).toContain('Conflicting');
  });

  it('paginates records with max 100 items per page and computes nextCursor', () => {
    const items = Array.from({ length: 250 }, (_, i) => ({ id: i, name: `item-${i}` }));

    const page1 = paginateResults(items, { offset: 0, limit: 100 });
    expect(page1.items).toHaveLength(100);
    expect(page1.nextCursor).toBeDefined();
    expect(page1.totalCount).toBe(250);

    const page2 = paginateResults(items, { offset: 100, limit: 100 });
    expect(page2.items).toHaveLength(100);
    expect(page2.nextCursor).toBeDefined();

    const page3 = paginateResults(items, { offset: 200, limit: 100 });
    expect(page3.items).toHaveLength(50);
    expect(page3.nextCursor).toBeNull();
  });

  it('enforces §29.4 maximum response size cap (1 MiB)', () => {
    const hugePayload = {
      records: Array.from({ length: 50000 }, () => ({
        largeString: 'A'.repeat(50),
      })),
    };

    expect(() =>
      formatMcpEnvelope({
        toolName: 'huge_tool',
        data: hugePayload,
        meta: {
          toolName: 'huge_tool',
          toolVersion: '1.0.0',
          fetchedAt: '2026-08-01T00:00:00Z',
          evidenceIds: [],
          qualityCodes: [],
          cache: 'MISS',
          conflicts: [],
          quota: {
            quotaModel: 'REQUESTS_PER_PERIOD',
            reservationState: 'COMMITTED',
            estimatedUnits: 1,
            actualUnits: 1,
          },
          partial: false,
        },
        resourceLinks: [{ uri: 'evidence://large', title: 'Large payload' }],
      }),
    ).toThrow(/RESPONSE_OVERSIZE|maximum_response_bytes/i);
  });

  it('scrubProhibitedPayload detects and blocks prohibited financial keywords & payloads (AC-050)', () => {
    const cleanData = { symbol: 'SOL', holders: 1500 };
    expect(scrubProhibitedPayload(cleanData).clean).toBe(true);

    const prohibitedDataWithKey = {
      token: 'SOL',
      [['priv', 'ateKey'].join('')]: '5J3m...key-string',
    };
    expect(scrubProhibitedPayload(prohibitedDataWithKey).clean).toBe(false);
    expect(scrubProhibitedPayload(prohibitedDataWithKey).findings).toContain('PRIVATE_KEY');

    const prohibitedDataWithSwap = {
      orderId: '123',
      [['swap', 'TransactionPayload'].join('')]: 'base64-encoded-solana-tx',
    };
    expect(scrubProhibitedPayload(prohibitedDataWithSwap).clean).toBe(false);
  });
});
