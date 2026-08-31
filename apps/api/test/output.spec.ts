/**
 * T015: MCP Output Contract & Prohibited Payload Scrub suite (FR-MCP-003, §17.4, §29.4, AC-002, AC-004, AC-050).
 * Tests apps/api/src/mcp/output.ts for structured output envelopes, pagination cursors,
 * evidence links, explicit abstention states, and prohibited payload scrubbing.
 */
import { describe, expect, it } from 'bun:test';
import {
  VALID_MCP_OUTPUT_ENVELOPE,
  DEGRADED_MCP_OUTPUT_ENVELOPE,
  PROHIBITED_FINANCIAL_PAYLOADS,
  MAXIMUM_RESPONSE_BYTES,
  MAXIMUM_PAGE_RECORDS,
} from '../../../tests/fixtures/mcp/index.ts';

async function loadOutputModule() {
  return await import('../src/mcp/output.ts');
}

describe('T015: MCP output contract & prohibited payload scrub (AC-002, AC-004, AC-050)', () => {
  it('formats ToolCore result envelope into §17.4 MCP structured output envelope', async () => {
    const { formatMcpOutput } = await loadOutputModule();
    const toolCoreEnvelope = {
      data: VALID_MCP_OUTPUT_ENVELOPE.structuredContent,
      meta: VALID_MCP_OUTPUT_ENVELOPE.meta,
    };

    const mcpOutput = formatMcpOutput(toolCoreEnvelope);
    expect(mcpOutput.structuredContent).toBeDefined();
    expect(mcpOutput.textContent).toBeDefined();
    expect(mcpOutput.meta.toolName).toBe('discover_candidates');
    expect(mcpOutput.meta.qualityCodes).toContain('SOURCE_FIRST_PARTY_VERIFIED');
    expect(mcpOutput.meta.nextCursor).toBe('cur_page_2_tok_abc');
    expect(mcpOutput.resourceLinks).toHaveLength(2);
  });

  it('preserves explicit abstention states and partial result indicators (AC-004)', async () => {
    const { formatMcpOutput } = await loadOutputModule();
    const toolCoreEnvelope = {
      data: DEGRADED_MCP_OUTPUT_ENVELOPE.structuredContent,
      meta: DEGRADED_MCP_OUTPUT_ENVELOPE.meta,
    };

    const mcpOutput = formatMcpOutput(toolCoreEnvelope);
    expect(mcpOutput.meta.partial).toBe(true);
    expect(mcpOutput.meta.abstentionReason).toBe('INSUFFICIENT_FIRST_PARTY_EVIDENCE');
    expect(mcpOutput.meta.qualityCodes).toContain('EXPLICIT_ABSTENTION');
    expect(mcpOutput.textContent).toContain('Explicit abstention');
  });

  it('enforces §29.4 response size caps and maximum record limits', async () => {
    const { formatMcpOutput, validateOutputCaps } = await loadOutputModule();

    // Oversized response exceeding 1 MiB
    const hugeData = {
      records: Array.from({ length: 2000 }, (_, i) => ({
        id: i,
        padding: 'x'.repeat(1024),
      })),
    };
    const hugeEnvelope = {
      data: hugeData,
      meta: { ...VALID_MCP_OUTPUT_ENVELOPE.meta },
    };

    expect(() => formatMcpOutput(hugeEnvelope, { maxBytes: MAXIMUM_RESPONSE_BYTES })).toThrow(
      /cap|limit|oversize/i,
    );

    // Page record limit exceeding 100 records
    const tooManyRecords = {
      candidates: Array.from({ length: MAXIMUM_PAGE_RECORDS + 10 }, (_, i) => ({ id: i })),
    };
    const excessivePageEnvelope = {
      data: tooManyRecords,
      meta: { ...VALID_MCP_OUTPUT_ENVELOPE.meta },
    };
    expect(() =>
      validateOutputCaps(excessivePageEnvelope, { maxRecords: MAXIMUM_PAGE_RECORDS }),
    ).toThrow(/page records exceed maximum/i);
  });

  it('scrubs and refuses every prohibited financial payload vector (AC-050, INV-001)', async () => {
    const { scrubProhibitedPayloads } = await loadOutputModule();

    for (const fixture of PROHIBITED_FINANCIAL_PAYLOADS) {
      expect(
        () => scrubProhibitedPayloads(fixture.data),
        `Should reject prohibited payload: ${fixture.name}`,
      ).toThrow(/prohibited|financial|key|transaction|swap|signature/i);
    }
  });

  it('passes clean read-only intelligence payload through scrubber cleanly', async () => {
    const { scrubProhibitedPayloads } = await loadOutputModule();
    const cleanData = {
      token: 'SOL',
      marketCapUsd: 75000000000,
      holderDistribution: [
        { address: 'So11111111111111111111111111111111111111112', percentage: 4.2 },
      ],
    };

    expect(() => scrubProhibitedPayloads(cleanData)).not.toThrow();
  });
});
