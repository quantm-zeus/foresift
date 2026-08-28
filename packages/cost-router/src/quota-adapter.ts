/** Primary tool-core quota seam implementation (FR-COST-001…005/008). */
import { createHash } from 'node:crypto';
import { CostClass, ErrorCode, ForesiftError, QuotaModel } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import type {
  QuotaAdmissionDecision,
  QuotaEstimate,
  QuotaEstimateRequest,
  QuotaReservationAdapter,
  ReservationRequest,
} from '@foresift/tool-core';
import type { CostDeclarationSource, OperationCostDeclaration } from './cost-declaration.ts';
import { SqlCostDeclarationSource } from './cost-declaration.ts';
import { CostModePolicy } from './cost-mode.ts';
import type { ActivePaidPolicySource } from './paid-policy.ts';
import { PaidPolicyStore } from './paid-policy.ts';
import { ProtectedReserveRouter } from './reserve-router.ts';
import { strictFreeDenial } from './strict-free-guard.ts';
import type { CostAuditor } from './cost-audit.ts';

interface BalanceRow {
  provider_id: string;
  quota_model_id: string;
  period_window_start: Date | string;
  period_window_end: Date | string;
  cap_limit: string | number;
}

interface ReservationRow {
  reservation_id: string;
  provider: string;
  operation: string;
  workload_class: ReservationRequest['workloadClass'];
  estimated_units: string | number;
  actual_units: string | number | null;
  state: string;
}

export interface CostQuotaAdapterOptions {
  readonly engine: DatabaseEngine;
  readonly declarations?: CostDeclarationSource;
  readonly paidPolicies?: ActivePaidPolicySource;
  readonly modes?: CostModePolicy;
  readonly reserveRouter?: ProtectedReserveRouter;
  readonly auditor?: CostAuditor;
  readonly now?: () => string;
}

function costRefusal(message: string, code: ErrorCode = ErrorCode.COST_QUOTA_EXHAUSTED): never {
  throw new ForesiftError(code, message);
}

function reservationIdOf(request: ReservationRequest): string {
  const digest = createHash('sha256')
    .update(`${request.pipelineRunId}\u0000${request.stage}`)
    .digest('hex');
  return `cost-reservation:${digest}`;
}

export class CostQuotaReservationAdapter implements QuotaReservationAdapter {
  private readonly engine: DatabaseEngine;
  private readonly declarations: CostDeclarationSource;
  private readonly paidPolicies: ActivePaidPolicySource;
  private readonly modes: CostModePolicy;
  private readonly reserveRouter: ProtectedReserveRouter;
  private readonly auditor: CostAuditor | undefined;
  private readonly clock: () => string;

  constructor(options: CostQuotaAdapterOptions) {
    this.engine = options.engine;
    this.declarations = options.declarations ?? new SqlCostDeclarationSource(options.engine);
    this.paidPolicies = options.paidPolicies ?? new PaidPolicyStore(options.engine);
    this.modes = options.modes ?? new CostModePolicy(this.paidPolicies);
    this.reserveRouter = options.reserveRouter ?? new ProtectedReserveRouter();
    this.auditor = options.auditor;
    this.clock = options.now ?? (() => new Date().toISOString());
  }

  private async declaration(request: QuotaEstimateRequest): Promise<OperationCostDeclaration> {
    const declaration = await this.declarations.declaration(request.provider, request.operation);
    if (
      declaration.verificationExpiresAt !== undefined &&
      new Date(declaration.verificationExpiresAt).getTime() <= new Date(this.clock()).getTime()
    ) {
      costRefusal(
        'UNKNOWN_COST: provider plan metadata is UNVERIFIED',
        ErrorCode.COST_PLAN_UNVERIFIED,
      );
    }
    return declaration;
  }

  async estimate(request: QuotaEstimateRequest): Promise<QuotaEstimate> {
    const declaration = await this.declaration(request);
    if (
      declaration.costClass === CostClass.UNKNOWN_COST ||
      declaration.costClass === CostClass.DISABLED ||
      declaration.quotaModel === QuotaModel.UNKNOWN_CONFIGURABLE
    ) {
      costRefusal(
        'UNKNOWN_COST: operation does not have verified quota semantics',
        ErrorCode.COST_DECLARATION_UNKNOWN,
      );
    }
    return { quotaModel: declaration.quotaModel, estimatedUnits: declaration.quotaUnitCost };
  }

  private async balance(
    engine: DatabaseEngine,
    declaration: OperationCostDeclaration,
    at: string,
  ): Promise<BalanceRow | null> {
    const result = await engine.query<BalanceRow>(
      `SELECT provider_id, quota_model_id, period_window_start, period_window_end, cap_limit
         FROM cost.cost_quota_balances
        WHERE provider_id = $1 AND quota_model_id = $2
          AND period_window_start <= $3 AND period_window_end > $3
          AND verification_expires_at > $3
        ORDER BY period_window_start DESC`,
      [declaration.providerId, declaration.quotaModel, at],
    );
    if (result.rows.length > 1) costRefusal('UNKNOWN_COST: overlapping quota balance windows');
    return result.rows[0] ?? null;
  }

  private async remainingGeneral(engine: DatabaseEngine, balance: BalanceRow): Promise<number> {
    const window =
      typeof balance.period_window_start === 'string'
        ? balance.period_window_start
        : balance.period_window_start.toISOString();
    const usage = await engine.query<{ spent: string | number; reserve_floor: string | number }>(
      `SELECT
         COALESCE((SELECT SUM(consumed_reserved + consumed_committed)
                     FROM cost.cost_usage_counters
                    WHERE provider_id = $1 AND quota_model_id = $2
                      AND period_window_start = $3 AND reserve_id IS NULL), 0) AS spent,
         COALESCE((SELECT SUM(cap_limit)
                     FROM cost.cost_reserve_buckets
                    WHERE provider_id = $1 AND period_window_start = $3), 0) AS reserve_floor`,
      [balance.provider_id, balance.quota_model_id, window],
    );
    const row = usage.rows[0] ?? { spent: 0, reserve_floor: 0 };
    return Number(balance.cap_limit) - Number(row.reserve_floor) - Number(row.spent);
  }

  async admit(
    request: QuotaEstimateRequest & { readonly estimate: QuotaEstimate },
  ): Promise<QuotaAdmissionDecision> {
    const declaration = await this.declaration(request);
    if (
      request.estimate.quotaModel !== declaration.quotaModel ||
      request.estimate.estimatedUnits !== declaration.quotaUnitCost
    ) {
      return { allowed: false, reason: 'UNKNOWN_COST: estimate does not match declaration' };
    }
    const resolvedMode = await this.modes.resolve(request.provider, this.clock());
    const activePaid = await this.paidPolicies.activePolicy(request.provider, this.clock());
    let quotaAvailable = true;
    if (declaration.costClass === CostClass.FREE_QUOTA) {
      const balance = await this.balance(this.engine, declaration, this.clock());
      quotaAvailable =
        balance !== null &&
        (await this.remainingGeneral(this.engine, balance)) >= request.estimate.estimatedUnits;
    }
    if (declaration.costClass === CostClass.PAID_EXPLICIT) {
      quotaAvailable =
        activePaid !== null && request.estimate.estimatedUnits <= activePaid.budgetUnits;
    }
    const denied = strictFreeDenial({
      mode: resolvedMode.mode,
      costClass: declaration.costClass,
      allowedInStrictFree: declaration.allowedInStrictFree,
      quotaAvailable,
      // The request is the selected primary call. A fallback planner supplies
      // its attempted-fallback flag directly to StrictFreeGuard; the mere
      // existence of a fallback must not block this verified free path.
      paidFallback: false,
      hasActivePaidPolicy: activePaid !== null,
      candidate: `${request.provider}/${request.operation}`,
      caller: request.workloadClass,
      provider: request.provider,
      operation: request.operation,
      alternative: 'RETURN_CACHE_OR_DEGRADE',
    });
    if (denied !== null) {
      await this.auditor?.blocked({ ...denied, blockedAt: this.clock() });
      return { allowed: false, reason: denied.reason };
    }
    return { allowed: true, reason: 'ADMITTED' };
  }

  private async reserveMetered(
    tx: DatabaseEngine,
    request: ReservationRequest,
    declaration: OperationCostDeclaration,
  ): Promise<void> {
    const units = request.estimate.estimatedUnits;
    if (declaration.costClass === CostClass.FREE_UNMETERED) return;
    const at = this.clock();
    if (declaration.costClass === CostClass.PAID_EXPLICIT) {
      const policy = await this.paidPolicies.activePolicy(request.provider, at);
      if (policy === null) costRefusal('PAID_BLOCKED: active paid policy required');
      const spent = await tx.query<{ spent: string | number }>(
        `SELECT COALESCE(SUM(CASE WHEN state = 'COMMITTED' THEN actual_units ELSE estimated_units END), 0) AS spent
           FROM core.core_quota_reservations
          WHERE provider = $1 AND state IN ('RESERVED','COMMITTED')`,
        [request.provider],
      );
      if (Number(spent.rows[0]?.spent ?? 0) + units > policy.budgetUnits) {
        costRefusal('PAID_BLOCKED: explicit provider budget exhausted');
      }
      return;
    }
    const balance = await this.balance(tx, declaration, at);
    if (balance === null) costRefusal('QUOTA_EXHAUSTED: no current verified balance');
    const window =
      typeof balance.period_window_start === 'string'
        ? balance.period_window_start
        : balance.period_window_start.toISOString();
    const route = this.reserveRouter.route({
      workloadClass: request.workloadClass,
      operation: request.operation,
      protectedReserveEligible: declaration.protectedReserveEligible,
      generalPoolExhausted: (await this.remainingGeneral(tx, balance)) < units,
    });
    if (!route.allowed) costRefusal(route.reason);
    let capLimit: number;
    if (route.reserveId !== null) {
      const bucket = await tx.query<{ cap_limit: string | number }>(
        `UPDATE cost.cost_reserve_buckets
            SET consumed_units = consumed_units + $4::numeric
          WHERE reserve_id = $1 AND provider_id = $2 AND period_window_start = $3
            AND consumed_units + $4::numeric <= cap_limit
          RETURNING cap_limit`,
        [route.reserveId, request.provider, window, String(units)],
      );
      if (bucket.rows[0] === undefined)
        costRefusal(`QUOTA_EXHAUSTED: protected reserve ${route.reserveId}`);
      capLimit = Number(bucket.rows[0].cap_limit);
    } else {
      const remaining = await this.remainingGeneral(tx, balance);
      if (remaining < units) costRefusal('QUOTA_EXHAUSTED: general pool');
      const floors = await tx.query<{ floor: string | number }>(
        `SELECT COALESCE(SUM(cap_limit), 0) AS floor FROM cost.cost_reserve_buckets
          WHERE provider_id = $1 AND period_window_start = $2`,
        [request.provider, window],
      );
      capLimit = Number(balance.cap_limit) - Number(floors.rows[0]?.floor ?? 0);
    }
    const updated = await tx.query(
      `INSERT INTO cost.cost_usage_counters
         (provider_id, quota_model_id, period_window_start, workload_class,
          reserve_id, cap_limit, consumed_reserved, consumed_committed, remaining_units, observed_at)
       VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,0,$6::numeric-$7::numeric,$8)
       ON CONFLICT (provider_id, quota_model_id, period_window_start, workload_class)
       DO UPDATE SET
         consumed_reserved = cost.cost_usage_counters.consumed_reserved + EXCLUDED.consumed_reserved,
         remaining_units = cost.cost_usage_counters.cap_limit
           - (cost.cost_usage_counters.consumed_reserved + EXCLUDED.consumed_reserved)
           - cost.cost_usage_counters.consumed_committed,
         observed_at = EXCLUDED.observed_at
       WHERE cost.cost_usage_counters.reserve_id IS NOT DISTINCT FROM EXCLUDED.reserve_id
         AND cost.cost_usage_counters.remaining_units >= EXCLUDED.consumed_reserved
       RETURNING provider_id`,
      [
        request.provider,
        declaration.quotaModel,
        window,
        request.workloadClass,
        route.reserveId,
        String(capLimit),
        String(units),
        at,
      ],
    );
    if (updated.rows.length === 0) costRefusal('QUOTA_EXHAUSTED: atomic reservation refused');
  }

  async reserve(request: ReservationRequest): Promise<string> {
    const expected = await this.estimate(request);
    if (
      expected.quotaModel !== request.estimate.quotaModel ||
      expected.estimatedUnits !== request.estimate.estimatedUnits
    ) {
      costRefusal('UNKNOWN_COST: reservation estimate changed', ErrorCode.COST_DECLARATION_UNKNOWN);
    }
    const admission = await this.admit(request);
    if (!admission.allowed) costRefusal(admission.reason);
    const declaration = await this.declaration(request);
    const reservationId = reservationIdOf(request);
    return this.engine.transaction(async (tx) => {
      const existing = await tx.query<ReservationRow>(
        `SELECT reservation_id, provider, operation, workload_class, estimated_units, actual_units, state
           FROM core.core_quota_reservations WHERE pipeline_run_id = $1 AND stage = $2`,
        [request.pipelineRunId, request.stage],
      );
      const row = existing.rows[0];
      if (row !== undefined) {
        if (
          row.reservation_id === reservationId &&
          row.provider === request.provider &&
          row.operation === request.operation &&
          Number(row.estimated_units) === request.estimate.estimatedUnits &&
          row.state === 'RESERVED'
        )
          return reservationId;
        costRefusal(`reservation idempotency conflict in state ${row.state}`);
      }
      await this.reserveMetered(tx, request, declaration);
      await tx.query(
        `INSERT INTO core.core_quota_reservations
           (reservation_id, pipeline_run_id, stage, actor_id, provider, operation,
            workload_class, estimated_units, state, reserved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'RESERVED',$9)`,
        [
          reservationId,
          request.pipelineRunId,
          request.stage,
          request.actorId,
          request.provider,
          request.operation,
          request.workloadClass,
          String(request.estimate.estimatedUnits),
          this.clock(),
        ],
      );
      return reservationId;
    });
  }

  async commit(request: {
    readonly reservationId: string;
    readonly actualUnits: number;
  }): Promise<void> {
    if (!Number.isFinite(request.actualUnits) || request.actualUnits < 0) {
      costRefusal('actual units must be finite and nonnegative');
    }
    await this.engine.transaction(async (tx) => {
      const found = await tx.query<ReservationRow>(
        `SELECT reservation_id, provider, operation, workload_class, estimated_units, actual_units, state
           FROM core.core_quota_reservations WHERE reservation_id = $1`,
        [request.reservationId],
      );
      const row = found.rows[0];
      if (row === undefined) costRefusal('reservation not found');
      if (row.state === 'COMMITTED' && Number(row.actual_units) === request.actualUnits) return;
      if (row.state !== 'RESERVED') costRefusal(`commit is illegal from ${row.state}`);
      const transitioned = await tx.query(
        `UPDATE core.core_quota_reservations
            SET state='COMMITTED', actual_units=$2, settled_at=$3
          WHERE reservation_id=$1 AND state='RESERVED' RETURNING reservation_id`,
        [request.reservationId, String(request.actualUnits), this.clock()],
      );
      if (transitioned.rows.length === 0) costRefusal('concurrent commit transition refused');
      const updated = await tx.query<{
        reserve_id: string | null;
        provider_id: string;
        period_window_start: Date | string;
      }>(
        `UPDATE cost.cost_usage_counters
            SET consumed_reserved = consumed_reserved - $3::numeric,
                consumed_committed = consumed_committed + $4::numeric,
                remaining_units = cap_limit - (consumed_reserved - $3::numeric)
                  - (consumed_committed + $4::numeric),
                observed_at = $5
          WHERE provider_id=$1 AND workload_class=$2
            AND consumed_reserved >= $3::numeric
            AND remaining_units >= $4::numeric - $3::numeric
            AND period_window_start = (
              SELECT MAX(period_window_start) FROM cost.cost_usage_counters
               WHERE provider_id=$1 AND workload_class=$2)
          RETURNING reserve_id, provider_id, period_window_start`,
        [
          row.provider,
          row.workload_class,
          String(row.estimated_units),
          String(request.actualUnits),
          this.clock(),
        ],
      );
      // No usage row is expected for FREE_UNMETERED or paid-policy reservations.
      if (updated.rows.length === 0 && request.actualUnits > Number(row.estimated_units)) {
        const declaration = await this.declarations.declaration(row.provider, row.operation);
        if (declaration.costClass === CostClass.FREE_QUOTA)
          costRefusal('actual usage exceeds reserved free quota');
      }
    });
  }

  async release(request: { readonly reservationId: string }): Promise<void> {
    await this.engine.transaction(async (tx) => {
      const found = await tx.query<ReservationRow>(
        `SELECT reservation_id, provider, operation, workload_class, estimated_units, actual_units, state
           FROM core.core_quota_reservations WHERE reservation_id = $1`,
        [request.reservationId],
      );
      const row = found.rows[0];
      if (row === undefined) costRefusal('reservation not found');
      if (row.state === 'RELEASED') return;
      if (row.state !== 'RESERVED' && row.state !== 'PENDING')
        costRefusal(`release is illegal from ${row.state}`);
      await tx.query(
        `UPDATE core.core_quota_reservations SET state='RELEASED', settled_at=$2
          WHERE reservation_id=$1 AND state IN ('PENDING','RESERVED')`,
        [request.reservationId, this.clock()],
      );
      const updated = await tx.query<{
        reserve_id: string | null;
        provider_id: string;
        period_window_start: Date | string;
      }>(
        `UPDATE cost.cost_usage_counters
            SET consumed_reserved = consumed_reserved - $3::numeric,
                remaining_units = remaining_units + $3::numeric,
                observed_at = $4
          WHERE provider_id=$1 AND workload_class=$2 AND consumed_reserved >= $3::numeric
            AND period_window_start = (
              SELECT MAX(period_window_start) FROM cost.cost_usage_counters
               WHERE provider_id=$1 AND workload_class=$2)
          RETURNING reserve_id, provider_id, period_window_start`,
        [row.provider, row.workload_class, String(row.estimated_units), this.clock()],
      );
      const usage = updated.rows[0];
      if (usage?.reserve_id !== null && usage?.reserve_id !== undefined) {
        await tx.query(
          `UPDATE cost.cost_reserve_buckets
              SET consumed_units = consumed_units - $4::numeric
            WHERE reserve_id=$1 AND provider_id=$2 AND period_window_start=$3
              AND consumed_units >= $4::numeric`,
          [
            usage.reserve_id,
            usage.provider_id,
            usage.period_window_start,
            String(row.estimated_units),
          ],
        );
      }
    });
  }
}

export class DenyClosedCostQuotaAdapter implements QuotaReservationAdapter {
  async estimate(): Promise<never> {
    costRefusal(
      'UNKNOWN_COST: quota adapter composition is unbound',
      ErrorCode.COST_DECLARATION_UNKNOWN,
    );
  }
  async admit(): Promise<QuotaAdmissionDecision> {
    return { allowed: false, reason: 'UNKNOWN_COST: quota adapter composition is unbound' };
  }
  async reserve(): Promise<never> {
    costRefusal(
      'UNKNOWN_COST: quota adapter composition is unbound',
      ErrorCode.COST_DECLARATION_UNKNOWN,
    );
  }
  async commit(): Promise<never> {
    costRefusal(
      'UNKNOWN_COST: quota adapter composition is unbound',
      ErrorCode.COST_DECLARATION_UNKNOWN,
    );
  }
  async release(): Promise<never> {
    costRefusal(
      'UNKNOWN_COST: quota adapter composition is unbound',
      ErrorCode.COST_DECLARATION_UNKNOWN,
    );
  }
}

export function createQuotaReservationAdapter(
  options?: CostQuotaAdapterOptions,
): QuotaReservationAdapter {
  return options === undefined
    ? new DenyClosedCostQuotaAdapter()
    : new CostQuotaReservationAdapter(options);
}

/** Compatibility alias describing the primary seam by its tool-core name. */
export { CostQuotaReservationAdapter as QuotaReservationAdapterImpl };
export { CostQuotaReservationAdapter as CostRouterQuotaAdapter };
