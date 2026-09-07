/**
 * Usage ledger multi-dimension read aggregates unit tests (FR-COST-016, AC-226, AC-229).
 * Tests aggregation over cost.cost_usage_counters by the 5 ReconciliationDimension values:
 * OPERATION, WORKLOAD, CANDIDATE, RUN, MODULE.
 */
import { describe, expect, it } from 'bun:test';
import { UsageLedger } from '../src/usage-ledger.ts';
// @ts-expect-error - Domain vocabulary pending in parallel wave (T001)
import type { ReconciliationDimension } from '@foresift/domain';

describe('UsageLedger multi-dimension aggregation (FR-COST-016, AC-226)', () => {
  const dimensions: ReconciliationDimension[] = [
    'OPERATION',
    'WORKLOAD',
    'CANDIDATE',
    'RUN',
    'MODULE',
  ];

  for (const dim of dimensions) {
    it(`aggregates usage counters grouped by ${dim} dimension`, async () => {
      const mockRows = [
        {
          dimension: dim,
          subject_id: `subj_${dim.toLowerCase()}_1`,
          total_units: '500',
          event_count: '10',
        },
        {
          dimension: dim,
          subject_id: `subj_${dim.toLowerCase()}_2`,
          total_units: '1200',
          event_count: '25',
        },
      ];

      const mockEngine = {
        query: async () => ({ rows: mockRows }),
      } as never;

      const ledger = new UsageLedger(mockEngine);
      // @ts-expect-error - Product method extension pending in parallel wave (T016)
      const aggregates = await ledger.aggregateByDimension(dim, '2026-08-01T00:00:00Z');

      expect(aggregates.length).toBe(2);
      expect(aggregates[0]?.dimension).toBe(dim);
      expect(aggregates[0]?.subjectId).toBe(`subj_${dim.toLowerCase()}_1`);
      expect(aggregates[0]?.totalUnits).toBe(500);
      expect(aggregates[0]?.eventCount).toBe(10);
    });
  }

  it('provides RUN-dimension granularity for latency and cost decomposition (AC-226)', async () => {
    const mockRunRows = [
      {
        dimension: 'RUN',
        subject_id: 'run_batch_collector_001',
        total_units: '2500',
        event_count: '100',
      },
    ];

    const mockEngine = {
      query: async () => ({ rows: mockRunRows }),
    } as never;

    const ledger = new UsageLedger(mockEngine);
    // @ts-expect-error - Product method extension pending in parallel wave (T016)
    const runAggregates = await ledger.aggregateByDimension('RUN', '2026-08-01T00:00:00Z');

    expect(runAggregates[0]?.dimension).toBe('RUN');
    expect(runAggregates[0]?.subjectId).toBe('run_batch_collector_001');
    expect(runAggregates[0]?.totalUnits).toBe(2500);
  });
});
