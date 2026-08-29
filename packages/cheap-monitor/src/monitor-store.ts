import type { DatabaseEngine } from '@foresift/persistence';
import { CheapMonitorRowSchema, type CheapMonitorRow } from '@foresift/shared-schemas';
const terminal = new Set(['PROMOTED_TO_VERIFY', 'REJECTED_CHEAP', 'EXPIRED_CHEAP']);
export class CheapMonitorStore {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async put(value: CheapMonitorRow): Promise<void> {
    const row = CheapMonitorRowSchema.parse(value);
    await this.engine.query(
      `INSERT INTO disc.cheap_monitor_rows (monitor_id,candidate_id,state,checks_completed,max_checks,next_check_at,expires_at,row_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (monitor_id) DO UPDATE SET state=EXCLUDED.state,checks_completed=EXCLUDED.checks_completed,next_check_at=EXCLUDED.next_check_at,expires_at=EXCLUDED.expires_at,row_json=EXCLUDED.row_json`,
      [
        row.candidateId,
        row.candidateId,
        row.state,
        row.checkCount,
        row.maxChecks,
        row.nextCheckDueAt,
        row.expiresAt,
        JSON.stringify(row),
      ],
    );
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
    const nextCheckDueAt = new Date(
      Date.parse(observationAt) + row.backoffSeconds * 1000 * Math.max(1, 2 ** (checkCount - 1)),
    ).toISOString();
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
