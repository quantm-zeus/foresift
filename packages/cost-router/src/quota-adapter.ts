/** Primary tool-core QuotaReservationAdapter composition seam (FR-COST-001…005/008). */
import { createHash } from 'node:crypto';
import { CostClass, CostMode, ErrorCode, ForesiftError } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import type {
  QuotaAdmissionDecision,
  QuotaEstimate,
  QuotaEstimateRequest,
  QuotaReservationAdapter,
  ReservationRequest,
} from '@foresift/tool-core';
import type { CostDeclaration, CostDeclarationSource } from './cost-declaration.ts';
import { CostModeResolver } from './cost-mode.ts';
import { StrictFreeGuard } from './strict-free-guard.ts';
import { ReserveRouter } from './reserve-router.ts';
import type { CostAudit } from './cost-audit.ts';
import {
  BatchCoalescer,
  type BatchCapability,
  type BatchableRequest,
  type CoalescedBatch,
} from './batch-coalescer.ts';

interface QuotaBalanceRow {
  provider_id: string;
  quota_model_id: string;
  period_window_start: string;
  period_window_end: string;
  remaining_units: string | number;
}

interface CoreReservationRow {
  reservation_id: string;
  provider: string;
  operation: string;
  workload_class: QuotaEstimateRequest['workloadClass'];
  estimated_units: string | number;
  actual_units: string | number | null;
  state: string;
}

interface AllocationRow {
  provider_id: string;
  quota_model_id: string;
  period_window_start: string;
  reserve_id: string | null;
  reserved_units: string | number;
  settled: boolean;
}

export interface QuotaAdapterRequestFlags {
  readonly requestedMode?: CostMode;
  readonly automaticUpgrade?: boolean;
  readonly paidFallback?: boolean;
  readonly candidate?: string;
  readonly caller?: string;
  readonly alternative?: string;
}

export interface CostQuotaAdapterDeps {
  readonly engine: DatabaseEngine;
  readonly declarations: CostDeclarationSource;
  readonly costModes: CostModeResolver;
  readonly strictFreeGuard?: StrictFreeGuard;
  readonly reserveRouter?: ReserveRouter;
  readonly batchCoalescer?: BatchCoalescer;
  readonly audit?: CostAudit;
  readonly flags?: (request: QuotaEstimateRequest) => QuotaAdapterRequestFlags;
  readonly now?: () => Date;
}

function reservationId(request: ReservationRequest): string {
  const digest = createHash('sha256')
    .update(`${request.pipelineRunId}\u0000${request.stage}`)
    .digest('hex');
  return `cost-rsv:${digest}`;
}

function refusal(message: string): never {
  throw new ForesiftError(ErrorCode.QUOTA_EXHAUSTED, message);
}

export class CostQuotaReservationAdapter implements QuotaReservationAdapter {
  private readonly guard: StrictFreeGuard;
  private readonly reserves: ReserveRouter;
  private readonly batches: BatchCoalescer;
  private readonly now: () => Date;

  constructor(private readonly deps: CostQuotaAdapterDeps) {
    this.guard = deps.strictFreeGuard ?? new StrictFreeGuard();
    this.reserves = deps.reserveRouter ?? new ReserveRouter();
    this.batches = deps.batchCoalescer ?? new BatchCoalescer();
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Provider-call preparation surface: callers coalesce before invoking the
   * tool-core seam, so each returned batch receives exactly one reservation.
   */
  coalesceProviderCalls<T>(
    requests: readonly BatchableRequest<T>[],
    capability: BatchCapability,
  ): readonly CoalescedBatch<T>[] {
    return this.batches.coalesce(requests, capability);
  }

  async estimate(request: QuotaEstimateRequest): Promise<QuotaEstimate> {
    const declaration = await this.deps.declarations.get(request.provider, request.operation);
    if (
      declaration.costClass === CostClass.UNKNOWN_COST ||
      declaration.costClass === CostClass.DISABLED
    ) {
      throw new ForesiftError(ErrorCode.UNKNOWN_COST, 'operation cost is unknown or disabled');
    }
    if (Date.parse(declaration.verificationExpiresAt) <= this.now().getTime()) {
      throw new ForesiftError(
        ErrorCode.UNKNOWN_COST,
        'UNVERIFIED: provider plan metadata is stale',
      );
    }
    return { quotaModel: declaration.quotaModel, estimatedUnits: declaration.quotaUnitCost };
  }

  private async currentBalance(declaration: CostDeclaration): Promise<QuotaBalanceRow | undefined> {
    const rows = await this.deps.engine.query<QuotaBalanceRow>(
      `SELECT provider_id, quota_model_id, period_window_start, period_window_end, remaining_units
       FROM cost.cost_quota_balances
       WHERE provider_id = $1 AND quota_model_id = $2
         AND period_window_start <= $3 AND period_window_end > $3
       ORDER BY period_window_start DESC LIMIT 1`,
      [declaration.providerId, declaration.quotaModelId, this.now().toISOString()],
    );
    return rows.rows[0];
  }

  private async protectedRemaining(
    declaration: CostDeclaration,
    request: QuotaEstimateRequest,
    balance: QuotaBalanceRow,
  ): Promise<number> {
    const reserveId = this.reserves.route({
      workloadClass: request.workloadClass,
      operation: declaration,
    });
    if (reserveId === null) return 0;
    const rows = await this.deps.engine.query<{ remaining_units: string | number }>(
      `SELECT remaining_units FROM cost.cost_reserve_buckets
       WHERE reserve_id = $1 AND provider_id = $2 AND period_window_start = $3`,
      [reserveId, declaration.providerId, balance.period_window_start],
    );
    return Number(rows.rows[0]?.remaining_units ?? 0);
  }

  async admit(
    request: QuotaEstimateRequest & { readonly estimate: QuotaEstimate },
  ): Promise<QuotaAdmissionDecision> {
    const declaration = await this.deps.declarations.get(request.provider, request.operation);
    const flags = this.deps.flags?.(request) ?? {};
    const mode = await this.deps.costModes.resolve(request.provider, flags.requestedMode);
    let exhausted = false;
    if (declaration.costClass === CostClass.FREE_QUOTA) {
      const balance = await this.currentBalance(declaration);
      const general = Number(balance?.remaining_units ?? 0);
      const protectedUnits =
        balance === undefined ? 0 : await this.protectedRemaining(declaration, request, balance);
      exhausted = Math.max(general, protectedUnits) < request.estimate.estimatedUnits;
    } else if (declaration.costClass === CostClass.PAID_EXPLICIT) {
      if (mode.mode !== CostMode.PAID_ENABLED || mode.budgetUnits === undefined) {
        exhausted = true;
      } else {
        const used = await this.deps.engine.query<{ used: string | number }>(
          `SELECT COALESCE(SUM(CASE WHEN state = 'COMMITTED' THEN actual_units ELSE estimated_units END), 0) AS used
           FROM core.core_quota_reservations
           WHERE provider = $1 AND state IN ('RESERVED','COMMITTED')`,
          [request.provider],
        );
        exhausted =
          Number(used.rows[0]?.used ?? 0) + request.estimate.estimatedUnits > mode.budgetUnits;
      }
    }
    const denial = this.guard.evaluate({
      mode: mode.mode,
      declaration,
      quotaExhausted: exhausted,
      automaticUpgrade: flags.automaticUpgrade ?? false,
      paidFallback: flags.paidFallback ?? false,
      candidate: flags.candidate ?? `${request.provider}/${request.operation}`,
      caller: flags.caller ?? request.workloadClass,
      alternative: flags.alternative ?? 'return cache, reduce depth, or skip the operation',
    });
    if (denial !== null) {
      await this.deps.audit?.blocked(denial);
      return { allowed: false, reason: denial.reason };
    }
    if (exhausted) return { allowed: false, reason: 'QUOTA_EXHAUSTED:no admissible balance' };
    return { allowed: true, reason: 'ADMITTED' };
  }

  private async allocate(
    tx: DatabaseEngine,
    request: ReservationRequest,
    declaration: CostDeclaration,
    id: string,
  ): Promise<void> {
    if (declaration.costClass !== CostClass.FREE_QUOTA || request.estimate.estimatedUnits === 0)
      return;
    const at = this.now().toISOString();
    const general = await tx.query<{ period_window_start: string }>(
      `UPDATE cost.cost_quota_balances
       SET consumed_reserved = consumed_reserved + $3
       WHERE provider_id = $1 AND quota_model_id = $2
         AND period_window_start <= $4 AND period_window_end > $4
         AND remaining_units >= $3
       RETURNING period_window_start`,
      [
        declaration.providerId,
        declaration.quotaModelId,
        String(request.estimate.estimatedUnits),
        at,
      ],
    );
    let periodStart = general.rows[0]?.period_window_start;
    let reserveId: string | null = null;
    if (periodStart === undefined) {
      const balance = await tx.query<{ period_window_start: string }>(
        `SELECT period_window_start FROM cost.cost_quota_balances
         WHERE provider_id = $1 AND quota_model_id = $2
           AND period_window_start <= $3 AND period_window_end > $3
         ORDER BY period_window_start DESC LIMIT 1`,
        [declaration.providerId, declaration.quotaModelId, at],
      );
      periodStart = balance.rows[0]?.period_window_start;
      if (periodStart === undefined) refusal('QUOTA_EXHAUSTED:no current balance');
      reserveId = this.reserves.route({
        workloadClass: request.workloadClass,
        operation: declaration,
      });
      if (reserveId === null) refusal('QUOTA_EXHAUSTED:protected reserve is not eligible');
      const protectedUpdate = await tx.query(
        `UPDATE cost.cost_reserve_buckets
         SET consumed_units = consumed_units + $4
         WHERE reserve_id = $1 AND provider_id = $2 AND period_window_start = $3
           AND remaining_units >= $4 RETURNING reserve_id`,
        [reserveId, declaration.providerId, periodStart, String(request.estimate.estimatedUnits)],
      );
      if (protectedUpdate.rows.length === 0) refusal('QUOTA_EXHAUSTED:protected reserve exhausted');
    }
    await tx.query(
      `INSERT INTO cost.cost_quota_allocations
         (reservation_id, provider_id, quota_model_id, period_window_start,
          reserve_id, reserved_units)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        id,
        declaration.providerId,
        declaration.quotaModelId,
        periodStart,
        reserveId,
        String(request.estimate.estimatedUnits),
      ],
    );
  }

  async reserve(request: ReservationRequest): Promise<string> {
    const admission = await this.admit({
      provider: request.provider,
      operation: request.operation,
      workloadClass: request.workloadClass,
      estimate: request.estimate,
    });
    if (!admission.allowed) refusal(admission.reason);
    const declaration = await this.deps.declarations.get(request.provider, request.operation);
    const id = reservationId(request);
    return this.deps.engine.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO core.core_quota_reservations
           (reservation_id, pipeline_run_id, stage, actor_id, provider, operation,
            workload_class, estimated_units, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING')
         ON CONFLICT (pipeline_run_id, stage) DO NOTHING`,
        [
          id,
          request.pipelineRunId,
          request.stage,
          request.actorId,
          request.provider,
          request.operation,
          request.workloadClass,
          String(request.estimate.estimatedUnits),
        ],
      );
      const existing = await tx.query<CoreReservationRow>(
        `SELECT reservation_id, provider, operation, workload_class,
                estimated_units, actual_units, state
         FROM core.core_quota_reservations WHERE pipeline_run_id = $1 AND stage = $2`,
        [request.pipelineRunId, request.stage],
      );
      const row = existing.rows[0];
      if (row === undefined) refusal('reservation idempotency row is absent');
      if (
        row.provider !== request.provider ||
        row.operation !== request.operation ||
        Number(row.estimated_units) !== request.estimate.estimatedUnits
      ) {
        refusal('reservation idempotency key was reused for a different provider call');
      }
      if (row.state === 'RESERVED' || row.state === 'COMMITTED') return row.reservation_id;
      if (row.state !== 'PENDING') refusal(`reservation cannot be restored from ${row.state}`);
      await this.allocate(tx, request, declaration, row.reservation_id);
      const reserved = await tx.query(
        `UPDATE core.core_quota_reservations SET state = 'RESERVED', reserved_at = $2
         WHERE reservation_id = $1 AND state = 'PENDING' RETURNING reservation_id`,
        [row.reservation_id, this.now().toISOString()],
      );
      if (reserved.rows.length === 0) refusal('concurrent reservation transition refused');
      return row.reservation_id;
    });
  }

  async commit(request: {
    readonly reservationId: string;
    readonly actualUnits: number;
  }): Promise<void> {
    if (!Number.isFinite(request.actualUnits) || request.actualUnits < 0)
      refusal('actual units are invalid');
    await this.deps.engine.transaction(async (tx) => {
      const core = await tx.query<CoreReservationRow>(
        `SELECT reservation_id, provider, operation, workload_class,
                estimated_units, actual_units, state
         FROM core.core_quota_reservations WHERE reservation_id = $1`,
        [request.reservationId],
      );
      const row = core.rows[0];
      if (row === undefined) refusal('reservation does not exist');
      if (row.state === 'COMMITTED') return;
      if (row.state !== 'RESERVED') refusal(`commit is illegal from ${row.state}`);
      const allocations = await tx.query<AllocationRow>(
        `SELECT * FROM cost.cost_quota_allocations WHERE reservation_id = $1`,
        [request.reservationId],
      );
      const allocation = allocations.rows[0];
      if (allocation !== undefined) {
        const target =
          allocation.reserve_id === null ? 'cost.cost_quota_balances' : 'cost.cost_reserve_buckets';
        const update =
          allocation.reserve_id === null
            ? await tx.query(
                `UPDATE ${target}
               SET consumed_reserved = consumed_reserved - $4,
                   consumed_committed = consumed_committed + $5
               WHERE provider_id = $1 AND quota_model_id = $2 AND period_window_start = $3
                 AND consumed_reserved >= $4
                 AND cap_limit - consumed_reserved + $4 - consumed_committed >= $5
               RETURNING provider_id`,
                [
                  allocation.provider_id,
                  allocation.quota_model_id,
                  allocation.period_window_start,
                  String(allocation.reserved_units),
                  String(request.actualUnits),
                ],
              )
            : await tx.query(
                `UPDATE ${target}
               SET consumed_units = consumed_units - $4 + $5
               WHERE reserve_id = $1 AND provider_id = $2 AND period_window_start = $3
                 AND consumed_units >= $4 AND cap_limit - consumed_units + $4 >= $5
               RETURNING provider_id`,
                [
                  allocation.reserve_id,
                  allocation.provider_id,
                  allocation.period_window_start,
                  String(allocation.reserved_units),
                  String(request.actualUnits),
                ],
              );
        if (update.rows.length === 0) refusal('actual usage exceeds the allocated ceiling');
        await tx.query(
          `INSERT INTO cost.cost_usage_counters
             (provider_id, quota_model_id, period_window_start, workload_class,
              reserve_id, protected_reserve_eligible, observed_units, observed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (provider_id, quota_model_id, period_window_start,
                        workload_class, reserve_key)
           DO UPDATE SET observed_units = cost.cost_usage_counters.observed_units + EXCLUDED.observed_units,
                         observed_at = EXCLUDED.observed_at`,
          [
            allocation.provider_id,
            allocation.quota_model_id,
            allocation.period_window_start,
            row.workload_class,
            allocation.reserve_id,
            allocation.reserve_id !== null,
            String(request.actualUnits),
            this.now().toISOString(),
          ],
        );
        await tx.query(
          `UPDATE cost.cost_quota_allocations SET settled = TRUE WHERE reservation_id = $1`,
          [request.reservationId],
        );
      }
      const committed = await tx.query(
        `UPDATE core.core_quota_reservations
         SET state = 'COMMITTED', actual_units = $2, settled_at = $3
         WHERE reservation_id = $1 AND state = 'RESERVED' RETURNING reservation_id`,
        [request.reservationId, String(request.actualUnits), this.now().toISOString()],
      );
      if (committed.rows.length === 0) refusal('concurrent commit transition refused');
    });
  }

  async release(request: { readonly reservationId: string }): Promise<void> {
    await this.deps.engine.transaction(async (tx) => {
      const core = await tx.query<CoreReservationRow>(
        `SELECT reservation_id, provider, operation, workload_class,
                estimated_units, actual_units, state
         FROM core.core_quota_reservations WHERE reservation_id = $1`,
        [request.reservationId],
      );
      const row = core.rows[0];
      if (row === undefined) refusal('reservation does not exist');
      if (row.state === 'RELEASED') return;
      if (row.state !== 'PENDING' && row.state !== 'RESERVED')
        refusal(`release is illegal from ${row.state}`);
      const allocations = await tx.query<AllocationRow>(
        `SELECT * FROM cost.cost_quota_allocations WHERE reservation_id = $1 AND settled = FALSE`,
        [request.reservationId],
      );
      const allocation = allocations.rows[0];
      if (allocation !== undefined) {
        if (allocation.reserve_id === null) {
          await tx.query(
            `UPDATE cost.cost_quota_balances SET consumed_reserved = consumed_reserved - $4
             WHERE provider_id = $1 AND quota_model_id = $2 AND period_window_start = $3
               AND consumed_reserved >= $4`,
            [
              allocation.provider_id,
              allocation.quota_model_id,
              allocation.period_window_start,
              String(allocation.reserved_units),
            ],
          );
        } else {
          await tx.query(
            `UPDATE cost.cost_reserve_buckets SET consumed_units = consumed_units - $4
             WHERE reserve_id = $1 AND provider_id = $2 AND period_window_start = $3
               AND consumed_units >= $4`,
            [
              allocation.reserve_id,
              allocation.provider_id,
              allocation.period_window_start,
              String(allocation.reserved_units),
            ],
          );
        }
        await tx.query(
          `UPDATE cost.cost_quota_allocations SET settled = TRUE WHERE reservation_id = $1`,
          [request.reservationId],
        );
      }
      const released = await tx.query(
        `UPDATE core.core_quota_reservations SET state = 'RELEASED', settled_at = $2
         WHERE reservation_id = $1 AND state IN ('PENDING','RESERVED') RETURNING reservation_id`,
        [request.reservationId, this.now().toISOString()],
      );
      if (released.rows.length === 0) refusal('concurrent release transition refused');
    });
  }
}

/** Compatibility name matching the seam itself. */
export { CostQuotaReservationAdapter as QuotaReservationAdapterImpl };
export { CostQuotaReservationAdapter as QuotaReservationAdapter };
