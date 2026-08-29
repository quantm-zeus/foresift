/**
 * First-seen latency span computation unit tests (FR-COL-011).
 * Asserts latency math across source event, collector receipt, and availability boundaries.
 */
import { describe, expect, it } from 'bun:test';

interface LatencySpanInput {
  sourceEventAt: string;
  collectorReceiptAt: string;
  systemAvailableAt: string;
}

function computeCollectorSpans(input: LatencySpanInput): {
  eventToReceiptMs: number;
  receiptToAvailableMs: number;
} {
  const tEvent = new Date(input.sourceEventAt).getTime();
  const tReceipt = new Date(input.collectorReceiptAt).getTime();
  const tAvailable = new Date(input.systemAvailableAt).getTime();

  return {
    eventToReceiptMs: tReceipt - tEvent,
    receiptToAvailableMs: tAvailable - tReceipt,
  };
}

describe('First-Seen Latency Spans (FR-COL-011)', () => {
  it('computes non-negative latency spans for verified collector scope', () => {
    const input: LatencySpanInput = {
      sourceEventAt: '2026-08-20T10:00:00.000Z',
      collectorReceiptAt: '2026-08-20T10:00:00.045Z',
      systemAvailableAt: '2026-08-20T10:00:00.050Z',
    };

    const spans = computeCollectorSpans(input);
    expect(spans.eventToReceiptMs).toBe(45);
    expect(spans.receiptToAvailableMs).toBe(5);
  });
});
