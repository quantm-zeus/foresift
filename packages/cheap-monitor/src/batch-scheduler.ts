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
interface StoredMonitorRow {
  candidate_id: string;
  state: CheapMonitorRow['state'];
  checks_completed: number;
  max_checks: number;
  next_check_at: string | Date;
  expires_at: string | Date;
  backoff_ms: number;
  max_staleness_ms: number;
  resource_budget_class: string;
  provider_id: string;
  operation_id: string;
  last_observation_at: string | Date | null;
}
function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
function monitorRow(row: StoredMonitorRow): CheapMonitorRow {
  return CheapMonitorRowSchema.parse({
    candidateId: row.candidate_id,
    assetRepresentationId: row.candidate_id,
    state: row.state,
    checkCount: Number(row.checks_completed),
    maxChecks: Number(row.max_checks),
    backoffSeconds: Number(row.backoff_ms) / 1000,
    ...(row.last_observation_at === null ? {} : { lastCheckedAt: iso(row.last_observation_at) }),
    nextCheckDueAt: iso(row.next_check_at),
    expiresAt: iso(row.expires_at),
    stalenessLimitSeconds: Number(row.max_staleness_ms) / 1000,
    resourceBudgetClass: row.resource_budget_class,
    providerId: row.provider_id,
    operationId: row.operation_id,
    decisionHistory: [],
  });
}
export class BatchScheduler {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly provider: MonitorProvider,
    private readonly deltas: CollectorDeltaSource,
    private readonly perRunBound: number,
    private readonly batchSize: number,
    private readonly providerId: string = 'free-aggregate',
    private readonly operationId: string = 'cheap-monitor-batch',
    private readonly now: () => Date = () => new Date(),
  ) {}
  async run(): Promise<SchedulerResult> {
    const at = this.now().toISOString();
    const result = await this.engine.query<StoredMonitorRow>(
      `SELECT candidate_id,state,checks_completed,max_checks,next_check_at,expires_at,
              backoff_ms,max_staleness_ms,resource_budget_class,provider_id,operation_id,
              last_observation_at
       FROM disc.cheap_monitor_rows
       WHERE state IN ('NEW','MONITORING_CHEAP') AND next_check_at <= $1
         AND expires_at > $1 AND checks_completed < max_checks
       ORDER BY next_check_at,monitor_id LIMIT $2`,
      [at, this.perRunBound],
    );
    const rows = result.rows.map(monitorRow);
    const deltaMap = await this.deltas.take(rows.map((r) => r.candidateId));
    let observations = 0,
      batches = 0;
    const deltaRows = rows.filter((row) => deltaMap.has(row.candidateId));
    const providerRows = rows.filter((row) => !deltaMap.has(row.candidateId));
    if (deltaRows.length > 0) {
      const batchId = await this.openBatch(
        deltaRows,
        'first-party-collector',
        'collector-delta',
        at,
        this.perRunBound,
      );
      batches++;
      for (const row of deltaRows) {
        await this.write(batchId, row, deltaMap.get(row.candidateId), at, 'first-party-collector');
        observations++;
      }
      await this.closeBatch(batchId, deltaRows.length, deltaRows.length, at);
    }
    const groups = new Map<string, CheapMonitorRow[]>();
    for (const row of providerRows) {
      const providerId = row.providerId ?? this.providerId;
      const operationId = row.operationId ?? this.operationId;
      const key = `${providerId}\0${operationId}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    for (const group of groups.values())
      for (let i = 0; i < group.length; i += this.batchSize) {
        const batch = group.slice(i, i + this.batchSize);
        const providerId = batch[0]?.providerId ?? this.providerId;
        const operationId = batch[0]?.operationId ?? this.operationId;
        const batchId = await this.openBatch(batch, providerId, operationId, at, this.batchSize);
        batches++;
        const returned = await this.provider.fetch(providerId, operationId, batch);
        let returnedCount = 0;
        for (const row of batch) {
          const value = returned.get(row.candidateId);
          if (value !== undefined) {
            await this.write(batchId, row, value, at, providerId);
            observations++;
            returnedCount++;
          }
        }
        await this.closeBatch(batchId, batch.length, returnedCount, at);
      }
    return { rowsSelected: rows.length, batches, observationsWritten: observations };
  }
  private async openBatch(
    rows: readonly CheapMonitorRow[],
    providerId: string,
    operationId: string,
    at: string,
    maximum: number,
  ): Promise<string> {
    const batchId = randomUUID();
    await this.engine.query(
      `INSERT INTO disc.monitor_batches (
        batch_id,provider_id,operation_id,monitor_ids,max_batch_size,scheduled_at,
        started_at,due_before,selected_count,returned_entity_count,status
      ) VALUES ($1,$2,$3,$4,$5,$6,$6,$6,$7,0,'RUNNING')`,
      [
        batchId,
        providerId,
        operationId,
        rows.map((row) => row.candidateId),
        maximum,
        at,
        rows.length,
      ],
    );
    return batchId;
  }
  private async closeBatch(
    batchId: string,
    selected: number,
    returned: number,
    at: string,
  ): Promise<void> {
    await this.engine.query(
      `UPDATE disc.monitor_batches
       SET returned_entity_count=$2::integer,completed_at=$3::timestamptz,
           status=CASE WHEN $2::integer=$4::integer THEN 'COMPLETED' ELSE 'PARTIAL' END
       WHERE batch_id=$1`,
      [batchId, returned, at, selected],
    );
  }
  private async write(
    batchId: string,
    row: CheapMonitorRow,
    value: unknown,
    at: string,
    sourceId: string,
  ): Promise<void> {
    const snapshot = typeof value === 'object' && value !== null ? value : { value };
    await this.engine.query(
      `INSERT INTO disc.monitor_observations (
        observation_id,batch_id,monitor_id,entity_id,source_id,observed_at,available_at,snapshot
      ) VALUES ($1,$2,$3,$3,$4,$5,$5,$6)`,
      [randomUUID(), batchId, row.candidateId, sourceId, at, JSON.stringify(snapshot)],
    );
    await this.engine.query(
      `UPDATE disc.cheap_monitor_rows SET
        checks_completed=LEAST(checks_completed+1,max_checks),
        state=CASE WHEN checks_completed+1>=max_checks THEN 'EXPIRED_CHEAP' ELSE 'MONITORING_CHEAP' END,
        last_observation_at=$2::timestamptz,
        next_check_at=$2::timestamptz+(backoff_ms * interval '1 millisecond'),
        updated_at=$2::timestamptz
       WHERE monitor_id=$1`,
      [row.candidateId, at],
    );
  }
}
