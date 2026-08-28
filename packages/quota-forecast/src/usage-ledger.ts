import type { QuotaModel } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

export interface ObservedUsageCounter {
  readonly providerId: string;
  readonly quotaModelId: QuotaModel;
  readonly periodWindowStart: string;
  readonly observedUnits: number;
  readonly reservationCount: number;
}
interface UsageAggregateRow {
  provider_id: string;
  quota_model_id: QuotaModel;
  period_window_start: string | Date;
  observed_units: string | number;
  reservation_count: string | number;
}
const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : v);

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
}
