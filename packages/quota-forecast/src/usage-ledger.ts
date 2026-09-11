import type { QuotaModel, ReconciliationDimension } from '@foresift/domain';
import { reconciliationDimension } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

export interface ObservedUsageCounter {
  readonly providerId: string;
  readonly quotaModelId: QuotaModel;
  readonly periodWindowStart: string;
  readonly observedUnits: number;
  readonly reservationCount: number;
}

/**
 * One read-side aggregate bucket (FR-COST-016): total observed/committed
 * units grouped by ONE of the five ReconciliationDimension values, so the
 * reconciliation flow consumes actuals at operation/workload/candidate/run/
 * module granularity (AC-226: RUN-dimension granularity).
 */
export interface DimensionUsageAggregate {
  readonly dimension: ReconciliationDimension;
  /** The dimension's subject: operation / workload class / candidate / runId / module. */
  readonly subjectId: string;
  readonly observedUnits: number;
  readonly reservedUnits: number;
  readonly counterCount: number;
}

interface UsageAggregateRow {
  provider_id: string;
  quota_model_id: QuotaModel;
  period_window_start: string | Date;
  observed_units: string | number;
  reservation_count: string | number;
}
const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : v);

/**
 * The cost_usage_counters column each ReconciliationDimension aggregates by
 * (G0 table shape, g0_cost_0001): the G0 counter table carries operation and
 * workload_class directly; run/candidate/module identities ride the
 * pipeline_run_id / stage provenance of the owning reservation (g0_core_0003)
 * — the aggregate keys on those columns verbatim, never on a re-derived one.
 */
const DIMENSION_COLUMN: Record<ReconciliationDimension, string> = {
  OPERATION: 'operation',
  WORKLOAD: 'workload_class',
  RUN: 'pipeline_run_id',
  CANDIDATE: 'stage',
  MODULE: 'stage',
};

/** Whitespace-collapsed label for module aggregation (stage carries module.module form). */
const moduleLabel = (stage: string): string => stage;

export class UsageLedger {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async observedSince(since: string): Promise<readonly ObservedUsageCounter[]> {
    const result = await this.engine.query<UsageAggregateRow>(
      `SELECT provider_id, quota_model_id, period_window_start,
              COALESCE(SUM(committed_units),0) AS observed_units,
              COUNT(*) FILTER (WHERE state='COMMITTED') AS reservation_count
         FROM cost.cost_usage_counters
        WHERE observed_at >= $1
        GROUP BY provider_id, quota_model_id, period_window_start
        ORDER BY provider_id, quota_model_id, period_window_start`,
      [since],
    );
    return result.rows.map((row) => ({
      providerId: row.provider_id,
      quotaModelId: row.quota_model_id,
      periodWindowStart: iso(row.period_window_start),
      observedUnits: Number(row.observed_units),
      reservationCount: Number(row.reservation_count),
    }));
  }
  async thirtyDayReplayInputs(at: Date = this.now()): Promise<readonly ObservedUsageCounter[]> {
    return this.observedSince(new Date(at.getTime() - 30 * 86_400_000).toISOString());
  }

  /**
   * Read-side aggregates by ONE of the five ReconciliationDimension values
   * from the G0 cost_usage_counters rows (FR-COST-016, AC-226). Committed
   * units are the observed consumption the reconciliation compares against
   * forecasts; reserved-but-uncommitted units travel alongside for
   * admission-limit recomputation. Unknown dimensions fail closed through
   * the domain vocabulary.
   */
  async observedByDimension(
    dimension: string,
    since: string,
  ): Promise<readonly DimensionUsageAggregate[]> {
    const dim = reconciliationDimension(dimension);
    const column = DIMENSION_COLUMN[dim];
    const result = await this.engine.query<{
      subject_id: string;
      observed_units: string | number;
      reserved_units: string | number;
      counter_count: string | number;
    }>(
      `SELECT ${column} AS subject_id,
              COALESCE(SUM(committed_units), 0) AS observed_units,
              COALESCE(SUM(reserved_units), 0) AS reserved_units,
              COUNT(*) AS counter_count
         FROM cost.cost_usage_counters
        WHERE observed_at >= $1
        GROUP BY ${column}
        ORDER BY ${column} ASC`,
      [since],
    );
    return result.rows.map((row) => ({
      dimension: dim,
      subjectId: dim === 'MODULE' ? moduleLabel(row.subject_id) : row.subject_id,
      observedUnits: Number(row.observed_units),
      reservedUnits: Number(row.reserved_units),
      counterCount: Number(row.counter_count),
    }));
  }

  /** Dimension aggregates over the trailing 30-day reconciliation window. */
  async thirtyDayDimensionAggregates(
    dimension: string,
    at: Date = this.now(),
  ): Promise<readonly DimensionUsageAggregate[]> {
    return this.observedByDimension(
      dimension,
      new Date(at.getTime() - 30 * 86_400_000).toISOString(),
    );
  }
}
