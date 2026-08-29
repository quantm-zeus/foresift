import { randomUUID } from 'node:crypto';
import { CostClass, CostMode, ForesiftError, ErrorCode } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import type {
  QuotaReservationAdapter as ToolQuotaAdapter,
  QuotaEstimateRequest,
  QuotaEstimate,
  QuotaAdmissionDecision,
  ReservationRequest,
} from '@foresift/tool-core';
import type { OperationCostDeclaration } from '@foresift/shared-schemas';
import { OperationCostDeclarationReader } from './cost-declaration.ts';
import { CostModePolicy } from './cost-mode.ts';
import { strictFreeGuard } from './strict-free-guard.ts';
import { routeProtectedReserve } from './reserve-router.ts';

interface BalanceRow {
  remaining_units: string | number;
  period_window_start: string | Date;
}
interface UsageRow {
  provider_id: string;
  quota_model_id: string;
  period_window_start: string | Date;
  reserve_id: string | null;
  reserved_units: string | number;
  state: string;
}
interface ReservationRow {
  reservation_id: string;
}
export interface PlanFreshnessSource {
  assertVerified(declaration: OperationCostDeclaration, at?: Date): void | Promise<void>;
}
export interface QuotaReservationAdapterOptions {
  readonly engine: DatabaseEngine;
  readonly declarations?: OperationCostDeclarationReader;
  readonly costMode?: CostModePolicy;
  readonly planFreshness?: PlanFreshnessSource;
  readonly now?: () => Date;
  readonly mode?: CostMode;
}
interface AdmissionContext {
  declaration: OperationCostDeclaration;
  reserveId: string | null;
  periodWindowStart: string | Date | null;
}
const keyOf = (provider: string, operation: string): string => `${provider}\0${operation}`;

export class QuotaReservationAdapter implements ToolQuotaAdapter {
  private readonly declarations: OperationCostDeclarationReader;
  private readonly modes: CostModePolicy;
  private readonly now: () => Date;
  private readonly contexts = new Map<string, AdmissionContext>();
  constructor(private readonly options: QuotaReservationAdapterOptions) {
    this.declarations = options.declarations ?? new OperationCostDeclarationReader(options.engine);
    this.modes = options.costMode ?? new CostModePolicy();
    this.now = options.now ?? (() => new Date());
  }

  async estimate(request: QuotaEstimateRequest): Promise<QuotaEstimate> {
    const declaration = await this.declarations.get(request.provider, request.operation);
    await this.options.planFreshness?.assertVerified(declaration, this.now());
    if (
      declaration.costClass === CostClass.UNKNOWN_COST ||
      declaration.costClass === CostClass.DISABLED
    ) {
      throw new ForesiftError(ErrorCode.UNKNOWN_COST, 'operation cost cannot be estimated');
    }
    this.contexts.set(keyOf(request.provider, request.operation), {
      declaration,
      reserveId: null,
      periodWindowStart: null,
    });
    return { quotaModel: declaration.quotaModelId, estimatedUnits: declaration.quotaUnitCost };
  }

  async admit(
    request: QuotaEstimateRequest & { readonly estimate: QuotaEstimate },
  ): Promise<QuotaAdmissionDecision> {
    const declaration =
      this.contexts.get(keyOf(request.provider, request.operation))?.declaration ??
      (await this.declarations.get(request.provider, request.operation));
    const mode = this.options.mode ?? (await this.modes.resolve(request.provider));
    if (declaration.costClass === CostClass.PAID_EXPLICIT && mode !== CostMode.PAID_ENABLED) {
      return { allowed: false, reason: 'PAID_BLOCKED: no current immutable paid policy' };
    }
    if (declaration.costClass === CostClass.FREE_UNMETERED) {
      const blocked = strictFreeGuard({
        mode,
        declaration,
        candidate: `${request.provider}/${request.operation}`,
        caller: request.workloadClass,
        callerId: request.workloadClass,
        estimatedUnits: request.estimate.estimatedUnits,
      });
      if (blocked !== undefined) return { allowed: false, reason: blocked.reason };
      this.contexts.set(keyOf(request.provider, request.operation), {
        declaration,
        reserveId: null,
        periodWindowStart: null,
      });
      return { allowed: true, reason: 'FREE_UNMETERED' };
    }
    const general = await this.options.engine.query<BalanceRow>(
      `SELECT remaining_units, period_window_start FROM cost.cost_quota_balances
        WHERE provider_id=$1 AND quota_model_id=$2 AND period_window_start <= $3
          AND period_reset_at > $3 ORDER BY period_window_start DESC LIMIT 1`,
      [request.provider, request.estimate.quotaModel, this.now().toISOString()],
    );
    let balance = general.rows[0];
    let reserveId: string | null = null;
    if (
      balance === undefined ||
      Number(balance.remaining_units) < request.estimate.estimatedUnits
    ) {
      reserveId = routeProtectedReserve({
        workloadClass: request.workloadClass,
        operation: request.operation,
        protectedReserveEligible: declaration.protectedReserveEligible,
      });
      if (reserveId !== null) {
        const reserve = await this.options.engine.query<BalanceRow>(
          `SELECT remaining_units, period_window_start FROM cost.cost_reserve_buckets
            WHERE reserve_id=$1 AND provider_id=$2 AND quota_model_id=$3
              AND period_window_start <= $4 AND period_reset_at > $4
            ORDER BY period_window_start DESC LIMIT 1`,
          [reserveId, request.provider, request.estimate.quotaModel, this.now().toISOString()],
        );
        balance = reserve.rows[0];
      }
    }
    const remaining = balance === undefined ? 0 : Number(balance.remaining_units);
    const blocked = strictFreeGuard({
      mode,
      declaration,
      candidate: `${request.provider}/${request.operation}`,
      caller: request.workloadClass,
      callerId: request.workloadClass,
      remainingUnits: remaining,
      estimatedUnits: request.estimate.estimatedUnits,
    });
    if (blocked !== undefined) return { allowed: false, reason: blocked.reason };
    if (balance === undefined || remaining < request.estimate.estimatedUnits) {
      return {
        allowed: false,
        reason: 'QUOTA_EXHAUSTED: no admissible general or protected balance',
      };
    }
    this.contexts.set(keyOf(request.provider, request.operation), {
      declaration,
      reserveId,
      periodWindowStart: balance.period_window_start,
    });
    return { allowed: true, reason: reserveId === null ? 'GENERAL_POOL' : `RESERVE:${reserveId}` };
  }

  async reserve(request: ReservationRequest): Promise<string> {
    const context = this.contexts.get(keyOf(request.provider, request.operation));
    if (context === undefined) throw new Error('UNKNOWN_COST: estimate/admit must precede reserve');
    return this.options.engine.transaction(async (tx) => {
      const existing = await tx.query<ReservationRow>(
        'SELECT reservation_id FROM core.core_quota_reservations WHERE pipeline_run_id=$1 AND stage=$2',
        [request.pipelineRunId, request.stage],
      );
      if (existing.rows[0] !== undefined) return existing.rows[0].reservation_id;
      if (context.periodWindowStart !== null) {
        const table =
          context.reserveId === null ? 'cost.cost_quota_balances' : 'cost.cost_reserve_buckets';
        const reservePredicate = context.reserveId === null ? '' : ' AND reserve_id=$5';
        const updated = await tx.query(
          `UPDATE ${table} SET consumed_reserved=consumed_reserved+$4
            WHERE provider_id=$1 AND quota_model_id=$2 AND period_window_start=$3
              AND remaining_units >= $4${reservePredicate} RETURNING remaining_units`,
          context.reserveId === null
            ? [
                request.provider,
                request.estimate.quotaModel,
                context.periodWindowStart,
                request.estimate.estimatedUnits,
              ]
            : [
                request.provider,
                request.estimate.quotaModel,
                context.periodWindowStart,
                request.estimate.estimatedUnits,
                context.reserveId,
              ],
        );
        if (updated.rows.length === 0)
          throw new ForesiftError(ErrorCode.QUOTA_EXHAUSTED, 'quota changed before reservation');
      }
      const reservationId = randomUUID();
      await tx.query(
        `INSERT INTO core.core_quota_reservations
          (reservation_id,pipeline_run_id,stage,actor_id,provider,operation,workload_class,estimated_units,state,reserved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'RESERVED',$9)`,
        [
          reservationId,
          request.pipelineRunId,
          request.stage,
          request.actorId,
          request.provider,
          request.operation,
          request.workloadClass,
          request.estimate.estimatedUnits,
          this.now().toISOString(),
        ],
      );
      if (context.periodWindowStart !== null)
        await tx.query(
          `INSERT INTO cost.cost_usage_counters
          (reservation_id,provider_id,quota_model_id,period_window_start,reserve_id,workload_class,reserved_units,state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'RESERVED')`,
          [
            reservationId,
            request.provider,
            request.estimate.quotaModel,
            context.periodWindowStart,
            context.reserveId,
            request.workloadClass,
            request.estimate.estimatedUnits,
          ],
        );
      return reservationId;
    });
  }

  async commit(request: {
    readonly reservationId: string;
    readonly actualUnits: number;
  }): Promise<void> {
    if (!Number.isFinite(request.actualUnits) || request.actualUnits < 0)
      throw new Error('invalid actual units');
    await this.options.engine.transaction(async (tx) => {
      const usage = await tx.query<UsageRow>(
        'SELECT * FROM cost.cost_usage_counters WHERE reservation_id=$1 FOR UPDATE',
        [request.reservationId],
      );
      const row = usage.rows[0];
      if (row !== undefined && row.state === 'RESERVED') {
        const table =
          row.reserve_id === null ? 'cost.cost_quota_balances' : 'cost.cost_reserve_buckets';
        const reservePredicate = row.reserve_id === null ? '' : ' AND reserve_id=$6';
        const updated = await tx.query(
          `UPDATE ${table} SET consumed_reserved=consumed_reserved-$4,
              consumed_committed=consumed_committed+$5
            WHERE provider_id=$1 AND quota_model_id=$2 AND period_window_start=$3
              AND consumed_reserved >= $4 AND remaining_units + $4 >= $5${reservePredicate}
            RETURNING remaining_units`,
          row.reserve_id === null
            ? [
                row.provider_id,
                row.quota_model_id,
                row.period_window_start,
                Number(row.reserved_units),
                request.actualUnits,
              ]
            : [
                row.provider_id,
                row.quota_model_id,
                row.period_window_start,
                Number(row.reserved_units),
                request.actualUnits,
                row.reserve_id,
              ],
        );
        if (updated.rows.length === 0)
          throw new ForesiftError(
            ErrorCode.QUOTA_EXHAUSTED,
            'actual quota exceeds admitted balance',
          );
        await tx.query(
          `UPDATE cost.cost_usage_counters SET state='COMMITTED', committed_units=$2
          WHERE reservation_id=$1 AND state='RESERVED'`,
          [request.reservationId, request.actualUnits],
        );
      }
      const settled = await tx.query(
        `UPDATE core.core_quota_reservations
        SET state='COMMITTED',actual_units=$2,settled_at=$3
        WHERE reservation_id=$1 AND state='RESERVED' RETURNING reservation_id`,
        [request.reservationId, request.actualUnits, this.now().toISOString()],
      );
      if (settled.rows.length === 0)
        throw new Error('QUOTA_RESERVATION_TRANSITION_ILLEGAL: commit refused');
    });
  }

  async release(request: { readonly reservationId: string }): Promise<void> {
    await this.options.engine.transaction(async (tx) => {
      const usage = await tx.query<UsageRow>(
        'SELECT * FROM cost.cost_usage_counters WHERE reservation_id=$1 FOR UPDATE',
        [request.reservationId],
      );
      const row = usage.rows[0];
      if (row !== undefined && row.state === 'RESERVED') {
        const table =
          row.reserve_id === null ? 'cost.cost_quota_balances' : 'cost.cost_reserve_buckets';
        const reservePredicate = row.reserve_id === null ? '' : ' AND reserve_id=$5';
        await tx.query(
          `UPDATE ${table} SET consumed_reserved=consumed_reserved-$4
          WHERE provider_id=$1 AND quota_model_id=$2 AND period_window_start=$3
            AND consumed_reserved >= $4${reservePredicate}`,
          row.reserve_id === null
            ? [
                row.provider_id,
                row.quota_model_id,
                row.period_window_start,
                Number(row.reserved_units),
              ]
            : [
                row.provider_id,
                row.quota_model_id,
                row.period_window_start,
                Number(row.reserved_units),
                row.reserve_id,
              ],
        );
        await tx.query(
          `UPDATE cost.cost_usage_counters SET state='RELEASED'
          WHERE reservation_id=$1 AND state='RESERVED'`,
          [request.reservationId],
        );
      }
      const settled = await tx.query(
        `UPDATE core.core_quota_reservations SET state='RELEASED',settled_at=$2
        WHERE reservation_id=$1 AND state IN ('PENDING','RESERVED') RETURNING reservation_id`,
        [request.reservationId, this.now().toISOString()],
      );
      if (settled.rows.length === 0)
        throw new Error('QUOTA_RESERVATION_TRANSITION_ILLEGAL: release refused');
    });
  }
}

export { QuotaReservationAdapter as CostQuotaAdapter };
