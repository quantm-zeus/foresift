/**
 * Unit test suite for MCP structured output, pagination, and scrubbing (T015).
 * Traces: FR-MCP-003, AC-002, AC-004, AC-050, §17.4, §29.4, INV-001, INV-007, INV-008.
 *
 * Asserts:
 * - Output conforms to §17.4: outputSchema, concise human content, structured content, _meta.
 * - Result envelope fields (qualityCodes, observedAt, availableAt, fetchedAt, evidenceIds, quota, partial) pass through unmodified (AC-002).
 * - Cursor pagination mapped to nextCursor with max 100 records per page.
 * - Explicit abstention states (ABSTAINED, abstentionReason) preserved unmangled (AC-004).
 * - 1 MiB response cap enforced (§29.4).
 * - Prohibited-payload scrub blocks any private key, seed phrase, signature request, or transaction payload (AC-050, INV-001).
 */
import { describe, expect, it } from 'bun:test';
import {
  formatMcpToolOutput,
  scrubProhibitedPayload,
  type FormatOutputInput,
} from '../src/mcp/output.ts';
import type { ToolResultEnvelope } from '@foresift/shared-schemas';

describe('T015 — MCP output contract, pagination, and payload scrub (AC-002, AC-004, AC-050)', () => {
  const validEnvelope: ToolResultEnvelope = {
    data: {
      candidates: [
        {
          address: 'So11111111111111111111111111111111111111112',
          symbol: 'SOL',
          name: 'Wrapped SOL',
        },
      ],
    },
    meta: {
      toolName: 'discover_candidates',
      toolVersion: '1.0.0',
      provider: 'first-party-dex-observer',
      operation: 'discover_candidates',
      evidenceIds: ['ev-001', 'ev-002'],
      observedAt: '2026-08-01T00:00:00Z',
      availableAt: '2026-08-01T00:01:00Z',
      fetchedAt: '2026-08-01T00:01:05Z',
      cache: 'HIT_FRESH',
      freshnessSeconds: 15,
      qualityCodes: ['QUALITY_HIGH', 'SOURCE_FIRST_PARTY_VERIFIED'],
      conflicts: [],
      quota: {
        quotaModel: 'REQUESTS_PER_PERIOD',
        reservationState: 'COMMITTED',
        estimatedUnits: 1,
        actualUnits: 1,
      },
      partial: false,
      nextCursor: 'cur_page_2_abc',
    },
  };

  it('formats envelope into standard MCP tool response with structured content (AC-002)', () => {
    const formatted = formatMcpToolOutput({ envelope: validEnvelope });

    expect(formatted.content).toBeDefined();
    expect(formatted.content[0]?.type).toBe('text');
    expect(formatted.structuredContent).toEqual(validEnvelope.data);
    expect(formatted._meta.toolName).toBe('discover_candidates');
    expect(formatted._meta.evidenceIds).toEqual(['ev-001', 'ev-002']);
    expect(formatted._meta.qualityCodes).toContain('SOURCE_FIRST_PARTY_VERIFIED');
    expect(formatted._meta.partial).toBe(false);
    expect(formatted._meta.nextCursor).toBe('cur_page_2_abc');
  });

  it('preserves explicit abstention state and abstention reason (AC-004, INV-007)', () => {
    const abstainedEnvelope: ToolResultEnvelope = {
      data: null,
      meta: {
        toolName: 'get_asset_identity',
        toolVersion: '1.0.0',
        provider: 'first-party-dex-observer',
        operation: 'get_asset_identity',
        evidenceIds: [],
        fetchedAt: '2026-08-01T00:01:05Z',
        cache: 'MISS',
        qualityCodes: ['QUALITY_ABSTAINED', 'SOURCE_CONFLICT_DETECTED'],
        conflicts: ['metadata_symbol_mismatch'],
        quota: {
          quotaModel: 'REQUESTS_PER_PERIOD',
          reservationState: 'COMMITTED',
          estimatedUnits: 1,
          actualUnits: 1,
        },
        partial: true,
        abstentionReason: 'Conflicting on-chain token symbols between mint and metadata program',
      },
    };

    const formatted = formatMcpToolOutput({ envelope: abstainedEnvelope });
    expect(formatted._meta.abstentionReason).toBe(
      'Conflicting on-chain token symbols between mint and metadata program',
    );
    expect(formatted._meta.qualityCodes).toContain('QUALITY_ABSTAINED');
    expect(formatted.content[0]?.text).toMatch(/abstained|conflict/i);
  });

  it('enforces maximum 100 records per page limit (§29.4)', () => {
    const oversizedRecords = Array.from({ length: 150 }, (_, i) => ({ id: i }));
    const paginated = formatMcpToolOutput({
      envelope: {
        ...validEnvelope,
        data: { items: oversizedRecords },
      },
      maxPageRecords: 100,
    });

    expect(paginated.structuredContent.items.length).toBeLessThanOrEqual(100);
    expect(paginated._meta.nextCursor).toBeDefined();
  });

  it('enforces 1 MiB response size limit (§29.4)', () => {
    const hugePayload = { text: 'x'.repeat(1024 * 1024 + 100) };
    expect(() =>
      formatMcpToolOutput({
        envelope: {
          ...validEnvelope,
          data: hugePayload,
        },
        maxResponseBytes: 1024 * 1024,
      }),
    ).toThrow(/RESPONSE_OVERSIZE|exceeds/i);
  });

  it('scrubs prohibited financial payloads (AC-050, INV-001)', async () => {
    const { PROHIBITED_FINANCIAL_PAYLOADS } = await import(
      '../../../tests/fixtures/mcp/payloads.ts'
    );

    for (const fixture of PROHIBITED_FINANCIAL_PAYLOADS) {
      expect(() => scrubProhibitedPayload(fixture.data)).toThrow(
        /PROHIBITED_PAYLOAD_DETECTED|prohibited financial/i,
      );
    }
  });
});
