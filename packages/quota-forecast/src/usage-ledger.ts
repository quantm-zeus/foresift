/** Observed actual usage per provider/quota/window, persisted for replay. */
import type { WorkloadClass } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

export interface ObservedUsageCounter {
  readonly providerId: string;
  readonly quotaModelId: string;
  readonly periodWindowStart: string;
  readonly workloadClass: WorkloadClass;
  readonly consumedReserved: number;
  readonly consumedCommitted: number;
  readonly remainingUnits: number;
  readonly observedAt: string;
}

interface UsageRow {
  provider_id: string;
  quota_model_id: string;
  period_window_start: Date | string;
  workload_class: WorkloadClass;
  consumed_reserved: string | number;
  consumed_committed: string | number;
  remaining_units: string | number;
  observed_at: Date | string;
}

const iso = (value: Date | string): string =>
  typeof value === 'string' ? new Date(value).toISOString() : value.toISOString();

const fromRow = (row: UsageRow): ObservedUsageCounter => ({
  providerId: row.provider_id,
  quotaModelId: row.quota_model_id,
  periodWindowStart: iso(row.period_window_start),
  workloadClass: row.workload_class,
  consumedReserved: Number(row.consumed_reserved),
  consumedCommitted: Number(row.consumed_committed),
  remainingUnits: Number(row.remaining_units),
  observedAt: iso(row.observed_at),
});

export class UsageLedger {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async recordObserved(input: {
    providerId: string;
    quotaModelId: string;
    periodWindowStart: string;
    workloadClass: WorkloadClass;
    actualUnits: number;
  }): Promise<ObservedUsageCounter> {
    if (!Number.isFinite(input.actualUnits) || input.actualUnits < 0) {
      throw new RangeError('actualUnits must be finite and nonnegative');
    }
    const result = await this.engine.query<UsageRow>(
      `UPDATE cost.cost_usage_counters
          SET consumed_committed = consumed_committed + $5,
              remaining_units = remaining_units - $5,
              observed_at = $6
        WHERE provider_id=$1 AND quota_model_id=$2 AND period_window_start=$3
          AND workload_class=$4 AND remaining_units >= $5
        RETURNING *`,
      [
        input.providerId,
        input.quotaModelId,
        input.periodWindowStart,
        input.workloadClass,
        String(input.actualUnits),
        this.now(),
      ],
    );
    if (result.rows[0] === undefined) {
      throw new Error('QUOTA_EXHAUSTED: observed usage has no admitted counter capacity');
    }
    return fromRow(result.rows[0]);
  }

  async readWindow(
    providerId: string,
    quotaModelId: string,
    windowStart: string,
  ): Promise<readonly ObservedUsageCounter[]> {
    const result = await this.engine.query<UsageRow>(
      `SELECT * FROM cost.cost_usage_counters
        WHERE provider_id=$1 AND quota_model_id=$2 AND period_window_start=$3
        ORDER BY workload_class`,
      [providerId, quotaModelId, windowStart],
    );
    return result.rows.map(fromRow);
  }

  async replayInputs30Days(endingAt = this.now()): Promise<readonly ObservedUsageCounter[]> {
    const start = new Date(new Date(endingAt).getTime() - 30 * 86_400_000).toISOString();
    const result = await this.engine.query<UsageRow>(
      `SELECT * FROM cost.cost_usage_counters
        WHERE observed_at >= $1 AND observed_at <= $2
        ORDER BY observed_at, provider_id, quota_model_id, workload_class`,
      [start, endingAt],
    );
    return result.rows.map(fromRow);
  }
}

export { UsageLedger as ObservedUsageLedger };
