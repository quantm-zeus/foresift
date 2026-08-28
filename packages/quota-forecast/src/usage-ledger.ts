/** Observed 30-day quota actuals persisted in cost_usage_counters. */
import type { ReserveId, WorkloadClass } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

export interface ObservedUsageInput {
  readonly providerId: string;
  readonly quotaModelId: string;
  readonly periodWindowStart: string;
  readonly workloadClass: WorkloadClass;
  readonly reserveId?: ReserveId;
  readonly units: number;
  readonly observedAt?: string;
}

export interface ObservedUsageCounter {
  readonly providerId: string;
  readonly quotaModelId: string;
  readonly periodWindowStart: string;
  readonly workloadClass: string;
  readonly reserveId: string | null;
  readonly observedUnits: number;
  readonly observedAt: string;
}

interface UsageRow {
  provider_id: string;
  quota_model_id: string;
  period_window_start: string;
  workload_class: string;
  reserve_id: string | null;
  observed_units: string | number;
  observed_at: string;
}

function fromRow(row: UsageRow): ObservedUsageCounter {
  return {
    providerId: row.provider_id,
    quotaModelId: row.quota_model_id,
    periodWindowStart: row.period_window_start,
    workloadClass: row.workload_class,
    reserveId: row.reserve_id,
    observedUnits: Number(row.observed_units),
    observedAt: row.observed_at,
  };
}

export class UsageLedger {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(input: ObservedUsageInput): Promise<ObservedUsageCounter> {
    if (!Number.isFinite(input.units) || input.units < 0)
      throw new Error('observed usage must be nonnegative');
    const observedAt = input.observedAt ?? this.now().toISOString();
    const rows = await this.engine.query<UsageRow>(
      `INSERT INTO cost.cost_usage_counters
         (provider_id, quota_model_id, period_window_start, workload_class,
          reserve_id, protected_reserve_eligible, observed_units, observed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (provider_id, quota_model_id, period_window_start,
                    workload_class, reserve_key)
       DO UPDATE SET observed_units = cost.cost_usage_counters.observed_units + EXCLUDED.observed_units,
                     observed_at = EXCLUDED.observed_at
       RETURNING provider_id, quota_model_id, period_window_start,
                 workload_class, reserve_id, observed_units, observed_at`,
      [
        input.providerId,
        input.quotaModelId,
        input.periodWindowStart,
        input.workloadClass,
        input.reserveId ?? null,
        input.reserveId !== undefined,
        String(input.units),
        observedAt,
      ],
    );
    return fromRow(rows.rows[0]!);
  }

  async thirtyDayActuals(at = this.now()): Promise<readonly ObservedUsageCounter[]> {
    const since = new Date(at.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString();
    const rows = await this.engine.query<UsageRow>(
      `SELECT provider_id, quota_model_id, period_window_start,
              workload_class, reserve_id, observed_units, observed_at
       FROM cost.cost_usage_counters
       WHERE observed_at >= $1 AND observed_at <= $2
       ORDER BY provider_id, quota_model_id, period_window_start,
                workload_class, reserve_key`,
      [since, at.toISOString()],
    );
    return rows.rows.map(fromRow);
  }
}
