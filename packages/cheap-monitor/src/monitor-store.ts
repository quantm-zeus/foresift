import type { DatabaseEngine } from '@foresift/persistence';
import { CheapMonitorRowSchema, type CheapMonitorRow } from '@foresift/shared-schemas';
const terminal = new Set(['PROMOTED_TO_VERIFY', 'REJECTED_CHEAP', 'EXPIRED_CHEAP']);
export interface CheapMonitorStorageDefaults {
  readonly resourceBudgetClass: string;
  readonly providerId: string;
  readonly operationId: string;
}
export class CheapMonitorStore {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly now: () => Date = () => new Date(),
    private readonly defaults: CheapMonitorStorageDefaults = {
      resourceBudgetClass: 'STRICT_FREE_CHEAP_MONITOR',
      providerId: 'free-aggregate',
      operationId: 'cheap-monitor-batch',
    },
  ) {}
  async put(value: CheapMonitorRow): Promise<void> {
    const row = CheapMonitorRowSchema.parse(value);
    const persisted = await this.engine.query<{ state: CheapMonitorRow['state'] }>(
      `INSERT INTO disc.cheap_monitor_rows (
        monitor_id,candidate_id,state,checks_completed,max_checks,next_check_at,expires_at,
        backoff_ms,max_staleness_ms,resource_budget_class,provider_id,operation_id,
        last_observation_at,retained_at,updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
      ON CONFLICT (monitor_id) DO UPDATE SET
        state=EXCLUDED.state,checks_completed=EXCLUDED.checks_completed,
        max_checks=EXCLUDED.max_checks,next_check_at=EXCLUDED.next_check_at,
        expires_at=EXCLUDED.expires_at,backoff_ms=EXCLUDED.backoff_ms,
        max_staleness_ms=EXCLUDED.max_staleness_ms,
        resource_budget_class=EXCLUDED.resource_budget_class,
        provider_id=EXCLUDED.provider_id,operation_id=EXCLUDED.operation_id,
        last_observation_at=EXCLUDED.last_observation_at,updated_at=EXCLUDED.updated_at
      WHERE disc.cheap_monitor_rows.state IN ('NEW','MONITORING_CHEAP')
      RETURNING state`,
      [
        row.candidateId,
        row.candidateId,
        row.state,
        row.checkCount,
        row.maxChecks,
        row.nextCheckDueAt,
        row.expiresAt,
        Math.round(row.backoffSeconds * 1000),
        Math.round(row.stalenessLimitSeconds * 1000),
        row.resourceBudgetClass ?? this.defaults.resourceBudgetClass,
        row.providerId ?? this.defaults.providerId,
        row.operationId ?? this.defaults.operationId,
        row.lastCheckedAt ?? null,
        this.now().toISOString(),
      ],
    );
    if (persisted.rows.length === 0) {
      const existing = await this.engine.query<{ state: CheapMonitorRow['state'] }>(
        'SELECT state FROM disc.cheap_monitor_rows WHERE monitor_id=$1',
        [row.candidateId],
      );
      if (existing.rows[0]?.state !== row.state)
        throw new Error('MONITOR_TERMINAL_STATE_IMMUTABLE');
    }
  }
  normalize(row: CheapMonitorRow): CheapMonitorRow {
    if (terminal.has(row.state)) return row;
    const now = this.now().getTime();
    if (
      now >= Date.parse(row.expiresAt) ||
      row.checkCount >= row.maxChecks ||
      (row.lastCheckedAt !== undefined &&
        now - Date.parse(row.lastCheckedAt) > row.stalenessLimitSeconds * 1000)
    )
      return { ...row, state: 'EXPIRED_CHEAP' };
    return row;
  }
  nextAfterCheck(row: CheapMonitorRow, observationAt: string): CheapMonitorRow {
    if (terminal.has(row.state)) throw new Error('MONITOR_TERMINAL');
    const checkCount = row.checkCount + 1;
    const delaySeconds = Math.min(
      row.stalenessLimitSeconds,
      row.backoffSeconds * Math.max(1, 2 ** (checkCount - 1)),
    );
    const nextCheckDueAt = new Date(Date.parse(observationAt) + delaySeconds * 1000).toISOString();
    return this.normalize({
      ...row,
      state: 'MONITORING_CHEAP',
      checkCount,
      lastCheckedAt: observationAt,
      nextCheckDueAt,
      decisionHistory: [...row.decisionHistory, 'MONITOR_CHEAP'],
    });
  }
}
