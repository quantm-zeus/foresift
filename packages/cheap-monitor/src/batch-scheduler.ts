import { randomUUID } from 'node:crypto';
import type { DatabaseEngine } from '@foresift/persistence';
import { CheapMonitorRowSchema, type CheapMonitorRow } from '@foresift/shared-schemas';
export interface MonitorProvider {
  fetch(
    providerId: string,
    operationId: string,
    entities: readonly CheapMonitorRow[],
  ): Promise<ReadonlyMap<string, unknown>>;
}
export interface CollectorDeltaSource {
  take(candidateIds: readonly string[]): Promise<ReadonlyMap<string, unknown>>;
}
export interface SchedulerResult {
  readonly rowsSelected: number;
  readonly batches: number;
  readonly observationsWritten: number;
}
export class BatchScheduler {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly provider: MonitorProvider,
    private readonly deltas: CollectorDeltaSource,
    private readonly perRunBound: number,
    private readonly batchSize: number,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async run(): Promise<SchedulerResult> {
    const at = this.now().toISOString();
    const result = await this.engine.query<{ row_json: unknown }>(
      `SELECT row_json FROM disc.cheap_monitor_rows WHERE state IN ('NEW','MONITORING_CHEAP') AND next_check_at <= $1 AND expires_at > $1 ORDER BY next_check_at,monitor_id LIMIT $2`,
      [at, this.perRunBound],
    );
    const rows = result.rows.map((r) =>
      CheapMonitorRowSchema.parse(
        typeof r.row_json === 'string' ? JSON.parse(r.row_json) : r.row_json,
      ),
    );
    const deltaMap = await this.deltas.take(rows.map((r) => r.candidateId));
    let observations = 0,
      batches = 0;
    const pending: CheapMonitorRow[] = [];
    for (const row of rows) {
      const delta = deltaMap.get(row.candidateId);
      if (delta === undefined) pending.push(row);
      else {
        await this.write(row, delta, at);
        observations++;
      }
    }
    const groups = new Map<string, CheapMonitorRow[]>();
    for (const row of pending) {
      const key = `${row.providerId}\0${row.operationId}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    for (const group of groups.values())
      for (let i = 0; i < group.length; i += this.batchSize) {
        const batch = group.slice(i, i + this.batchSize);
        batches++;
        const returned = await this.provider.fetch(
          (batch[0] as CheapMonitorRow).providerId,
          (batch[0] as CheapMonitorRow).operationId,
          batch,
        );
        for (const row of batch) {
          const value = returned.get(row.candidateId);
          if (value !== undefined) {
            await this.write(row, value, at);
            observations++;
          }
        }
      }
    return { rowsSelected: rows.length, batches, observationsWritten: observations };
  }
  private async write(row: CheapMonitorRow, value: unknown, at: string): Promise<void> {
    await this.engine.query(
      'INSERT INTO disc.monitor_observations (observation_id,monitor_id,observed_at,observation_json) VALUES ($1,$2,$3,$4)',
      [randomUUID(), row.monitorId, at, JSON.stringify(value)],
    );
  }
}
