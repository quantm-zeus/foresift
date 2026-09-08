/**
 * Usage ledger multi-dimension read aggregates unit tests (FR-COST-016, AC-226, AC-229).
 * Tests observedByDimension over cost.cost_usage_counters by the 5
 * ReconciliationDimension values: OPERATION, WORKLOAD, CANDIDATE, RUN, MODULE.
 * Aligned to the landed T016 product API (f750953): the aggregate keys on the
 * G0 counter columns verbatim and returns observedUnits/reservedUnits/counterCount.
 */
import { describe, expect, it } from 'bun:test';
import { UsageLedger } from '../src/usage-ledger.ts';
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
          subject_id: `subj_${dim.toLowerCase()}_1`,
          observed_units: '500',
          reserved_units: '40',
          counter_count: '10',
        },
        {
          subject_id: `subj_${dim.toLowerCase()}_2`,
          observed_units: '1200',
          reserved_units: '0',
          counter_count: '25',
        },
      ];

      const mockEngine = {
        query: async () => ({ rows: mockRows }),
      } as never;

      const ledger = new UsageLedger(mockEngine);
      const aggregates = await ledger.observedByDimension(dim, '2026-08-01T00:00:00Z');

      expect(aggregates.length).toBe(2);
      expect(aggregates[0]?.dimension).toBe(dim);
      expect(aggregates[0]?.subjectId).toBe(`subj_${dim.toLowerCase()}_1`);
      expect(aggregates[0]?.observedUnits).toBe(500);
      expect(aggregates[0]?.reservedUnits).toBe(40);
      expect(aggregates[0]?.counterCount).toBe(10);
    });
  }

  it('provides RUN-dimension granularity for latency and cost decomposition (AC-226)', async () => {
    const mockRunRows = [
      {
        subject_id: 'run_batch_collector_001',
        observed_units: '2500',
        reserved_units: '0',
        counter_count: '100',
      },
    ];

    const mockEngine = {
      query: async () => ({ rows: mockRunRows }),
    } as never;

    const ledger = new UsageLedger(mockEngine);
    const runAggregates = await ledger.observedByDimension('RUN', '2026-08-01T00:00:00Z');

    expect(runAggregates[0]?.dimension).toBe('RUN');
    expect(runAggregates[0]?.subjectId).toBe('run_batch_collector_001');
    expect(runAggregates[0]?.observedUnits).toBe(2500);
    expect(runAggregates[0]?.counterCount).toBe(100);
  });
});
