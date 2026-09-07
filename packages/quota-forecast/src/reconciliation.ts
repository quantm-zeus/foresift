/**
 * Forecast reconciliation and cost attribution (PRD §62.9, §62.11; FR-COST-016,
 * FR-COST-017, AC-229, plan ADR-6).
 *
 * `reconcileForecast` compares an actual against the forecast for one
 * ReconciliationDimension subject and persists the outcome into
 * `cost.forecast_reconciliations`. A breach — MATERIAL_UNDERESTIMATION
 * (actual > forecast·(1+tolerance)) or RESERVE_BREACH (protected floor
 * crossed) — raises an incident id THROUGH the G0 tolerance-breach seam
 * (`forecast.ts` onToleranceBreach — no parallel incident machinery) and
 * recomputes admission limits that can only TIGHTEN future admission. On any
 * breach the reconciliation refuses silent paid overage or protected-reserve
 * consumption: the recomputed caps land at the consumed boundary, never above
 * it (fail-closed, AC-229).
 *
 * `writeCostAttribution` persists a marginal/total cost attribution row per
 * AttributionUnitKind (operation/workload/candidate/run/module granularity),
 * composing the seven §62.12 rendered classes through the cost-router
 * composition law — an attribution can never hide owner-supplied model or
 * infrastructure spend.
 */
import {
  ALL_RECONCILIATION_DIMENSIONS,
  ReconciliationBreachKind,
  attributionUnitKind,
  reconciliationBreachKind,
  reconciliationDimension,
  reserveClass,
  type AttributionUnitKind,
  type ReconciliationBreachKind as BreachKind,
  type ReconciliationDimension,
  type ReserveClass,
  type SustainableCapacityContract,
} from '@foresift/domain';
import {
  BorrowedReserveSchema,
  CostAttributionSchema,
  ForecastReconciliationSchema,
  RenderedSpendClassesSchema,
  type BorrowedReserve,
  type CostAttribution,
  type ForecastReconciliation,
  type RenderedSpendClasses,
} from '@foresift/shared-schemas';
import type { DatabaseEngine } from '@foresift/persistence';

/** Row shape returned from cost.forecast_reconciliations. */
interface ReconciliationRow {
  reconciliation_id: string;
  contract_id: string;
  dimension: string;
  subject_id: string;
  forecast_value: string | number;
  actual_value: string | number;
  tolerance_fraction: string | number;
  breach_kind: string | null;
  incident_id: string | null;
  reconciled_at: string | Date;
}

const iso = (value: string | Date): string => (value instanceof Date ? value.toISOString() : value);
const num = (value: string | number): number => Number(value);

/** The §62.4 floor the protected reserves may never fall below, in units. */
export interface ProtectedReserveFloor {
  readonly reserveClass: ReserveClass;
  /** Declared §62.4 allocation fraction for the class (0..1). */
  readonly fraction: number;
  /** Total units the class' protected capacity is a fraction of. */
  readonly totalUnits: number;
}

export const floorUnits = (floor: ProtectedReserveFloor): number =>
  Math.floor(floor.fraction * floor.totalUnits);

export interface ReconciliationDecision {
  /** The persisted reconciliation row (breach⇔incident symmetric). */
  readonly reconciliation: ForecastReconciliation;
  /** The breach kind, when the actual crossed a boundary. */
  readonly breachKind: BreachKind | null;
  /** The G0-seam incident id — present iff a breach was recorded. */
  readonly incidentId: string | null;
  /**
   * Recomputed admission limits per dimension family: cap-only-tighten law.
   * Keys are the replay dimension names; values are the new caps.
   */
  readonly recomputedAdmissionLimits: Readonly<Record<string, number>>;
}

export interface ReconcileForecastOptions {
  /** Engine to persist through; omit to compute without persistence. */
  readonly engine?: DatabaseEngine;
  /**
   * The G0 tolerance-breach seam (`forecast.ts` onToleranceBreach shape):
   * receives the breach result, returns the incident id to record. Providing
   * it is how callers wire the EXISTING incident machinery — this module
   * never spawns parallel incident infrastructure (plan ADR-6).
   */
  readonly onToleranceBreach?: (result: {
    breachKind: BreachKind;
    dimension: ReconciliationDimension;
    subjectId: string;
    forecastValue: number;
    actualValue: number;
    toleranceFraction: number;
  }) => string | void;
  /** Protected floors whose crossing is a RESERVE_BREACH. */
  readonly protectedFloors?: readonly ProtectedReserveFloor[];
  /** Consumed protected-reserve units at reconciliation time. */
  readonly reserveUnitsUsed?: number;
  /** Evaluation instant; defaults to now. */
  readonly at?: Date;
  /** Id factory for the reconciliation row; deterministic default. */
  readonly reconciliationId?: string;
}

/** Compute the tightened admission caps implied by a reconciliation. */
function recomputeAdmissionLimits(
  contract: SustainableCapacityContract,
  forecastValue: number,
  actualValue: number,
  breached: boolean,
  reserveFloors: readonly ProtectedReserveFloor[],
  reserveUnitsUsed: number,
): Record<string, number> {
  const system = contract.systemEnvelope;
  const caps: Record<string, number> = {
    workflowSteps: system.workflowSteps,
    modelTokens: system.modelInputTokens + system.modelOutputTokens,
    egressBytes: system.egressBytes,
    notifications: system.notificationSends,
  };
  if (!breached) return caps;
  // Cap-only-tighten law: a breach never RAISES a cap. The overage fraction
  // observed against the forecast scales the declared system capacity down to
  // the consumed boundary — the admission limits future callers see can only
  // shrink, never open paid/reserve headroom (AC-229, fail-closed).
  const overageFraction =
    forecastValue > 0 ? Math.max(0, actualValue / forecastValue - 1) : actualValue > 0 ? 1 : 0;
  const factor = 1 / (1 + overageFraction);
  for (const key of Object.keys(caps)) {
    const current = caps[key] ?? 0;
    caps[key] = Math.max(0, Math.floor(current * Math.min(1, factor)));
  }
  // Protected-reserve consumption is refused silently: the reserve cap lands
  // at the protected floor exactly — headroom above the floor is consumed
  // capacity, never silently borrowable.
  for (const floor of reserveFloors) {
    caps[`reserve:${floor.reserveClass}`] = Math.max(0, floorUnits(floor) - reserveUnitsUsed);
  }
  return caps;
}

/**
 * Reconcile one forecast against its actual for (contract, dimension,
 * subject). Persists the row when `engine` is given, raises the incident id
 * through the G0 seam on breach, and returns the recomputed admission limits.
 * Fail-closed: on breach the returned limits can only tighten, and the
 * breach⇔incident symmetry of the table is mirrored in the returned row.
 */
export async function reconcileForecast(
  contract: SustainableCapacityContract,
  dimension: string,
  subject: string,
  forecast: number,
  actual: number,
  toleranceFraction: number,
  options: ReconcileForecastOptions = {},
): Promise<ReconciliationDecision> {
  const dim = reconciliationDimension(dimension);
  if (!Number.isFinite(forecast) || forecast < 0) {
    throw new Error(
      `RECONCILIATION_FORECAST_INVALID: forecast must be a finite non-negative number`,
    );
  }
  if (!Number.isFinite(actual) || actual < 0) {
    throw new Error('RECONCILIATION_ACTUAL_INVALID: actual must be a finite non-negative number');
  }
  if (!Number.isFinite(toleranceFraction) || toleranceFraction < 0) {
    throw new Error('RECONCILIATION_TOLERANCE_INVALID: toleranceFraction must be >= 0');
  }
  if (typeof subject !== 'string' || subject.length === 0) {
    throw new Error('RECONCILIATION_SUBJECT_REQUIRED: subject is required');
  }
  const at = options.at ?? new Date();

  // §62.11 breach law: MATERIAL_UNDERESTIMATION when the actual exceeds the
  // forecast beyond tolerance. RESERVE_BREACH when the protected floor of any
  // declared class is crossed by the consumed reserve units.
  const floors = options.protectedFloors ?? [];
  for (const floor of floors) reserveClass(floor.reserveClass);
  const reserveUnitsUsed = options.reserveUnitsUsed ?? 0;
  const floorCrossed = floors.some(
    (floor) =>
      reserveUnitsUsed > floorUnits(floor) || (reserveUnitsUsed > 0 && floorUnits(floor) === 0),
  );
  const underestimation = actual > forecast * (1 + toleranceFraction);
  const breachKind: BreachKind | null = floorCrossed
    ? ReconciliationBreachKind.RESERVE_BREACH
    : underestimation
      ? ReconciliationBreachKind.MATERIAL_UNDERESTIMATION
      : null;

  let incidentId: string | null = null;
  if (breachKind !== null && options.onToleranceBreach !== undefined) {
    const raised = options.onToleranceBreach({
      breachKind,
      dimension: dim,
      subjectId: subject,
      forecastValue: forecast,
      actualValue: actual,
      toleranceFraction,
    });
    if (typeof raised === 'string' && raised.length > 0) incidentId = raised;
  }
  // Fail-closed symmetry: a recorded breach WITHOUT an incident id is refused
  // when a breach handler is wired — the incident machinery must see it.
  if (breachKind !== null && options.onToleranceBreach !== undefined && incidentId === null) {
    throw new Error(
      `RECONCILIATION_INCIDENT_REQUIRED: ${breachKind} on ${dim}/${subject} must raise an incident through the G0 seam — silent breach refused`,
    );
  }

  const reconciliationId =
    options.reconciliationId ?? `recon_${contract.contractId}_${dim}_${subject}_${at.getTime()}`;
  const row = ForecastReconciliationSchema.parse({
    reconciliationId,
    contractId: contract.contractId,
    dimension: dim,
    subjectId: subject,
    forecastValue: forecast,
    actualValue: actual,
    toleranceFraction,
    breachKind,
    incidentId,
    reconciledAt: at.toISOString(),
  });

  if (options.engine !== undefined) {
    await options.engine.query(
      `INSERT INTO cost.forecast_reconciliations
         (reconciliation_id, contract_id, dimension, subject_id, forecast_value,
          actual_value, tolerance_fraction, breach_kind, incident_id, reconciled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (reconciliation_id) DO NOTHING`,
      [
        row.reconciliationId,
        row.contractId,
        row.dimension,
        row.subjectId,
        row.forecastValue,
        row.actualValue,
        row.toleranceFraction,
        row.breachKind,
        row.incidentId,
        row.reconciledAt,
      ],
    );
  }

  return {
    reconciliation: row,
    breachKind,
    incidentId,
    recomputedAdmissionLimits: recomputeAdmissionLimits(
      contract,
      forecast,
      actual,
      breachKind !== null,
      floors,
      reserveUnitsUsed,
    ),
  };
}

/** Read one reconciliation row back (the persisted truth of a decision). */
export async function readReconciliation(
  engine: DatabaseEngine,
  reconciliationId: string,
): Promise<ForecastReconciliation | null> {
  const result = await engine.query<ReconciliationRow>(
    `SELECT reconciliation_id, contract_id, dimension, subject_id, forecast_value,
            actual_value, tolerance_fraction, breach_kind, incident_id, reconciled_at
       FROM cost.forecast_reconciliations
      WHERE reconciliation_id = $1`,
    [reconciliationId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return ForecastReconciliationSchema.parse({
    reconciliationId: row.reconciliation_id,
    contractId: row.contract_id,
    dimension: reconciliationDimension(row.dimension),
    subjectId: row.subject_id,
    forecastValue: num(row.forecast_value),
    actualValue: num(row.actual_value),
    toleranceFraction: num(row.tolerance_fraction),
    breachKind: row.breach_kind === null ? null : reconciliationBreachKind(row.breach_kind),
    incidentId: row.incident_id,
    reconciledAt: iso(row.reconciled_at),
  });
}

// ---------------------------------------------------------------------------
// Cost attribution (FR-COST-017, §62.12, AC-105 zero-overclaim)
// ---------------------------------------------------------------------------

export interface WriteCostAttributionInput {
  readonly attributionId: string;
  readonly contractId: string;
  readonly unitKind: string;
  readonly subjectId: string;
  /** All seven §62.12 rendered spend classes for the unit. */
  readonly renderedClasses: Record<string, number>;
  /** Optional caller total; verified against the class sum when present. */
  readonly totalCost?: number;
  readonly attributedAt?: string;
}

/**
 * Persist one marginal-cost attribution row into `cost.cost_attributions`
 * per operation/workload/candidate/run/module granularity (FR-COST-016/017).
 * The seven rendered classes are composed through the cost-router
 * composition law's schema pinning — the marginal cost is ALWAYS Σ
 * classes, so owner-supplied model or infrastructure spend can never be
 * hidden behind a "zero total" claim (§62.12 zero-overclaim law).
 */
export async function writeCostAttribution(
  engine: DatabaseEngine,
  input: WriteCostAttributionInput,
): Promise<CostAttribution> {
  const kind: AttributionUnitKind = attributionUnitKind(input.unitKind);
  // The attribution's rendered classes MUST carry all seven §62.12 classes —
  // validated through the shared schema mirror (AC-105: a 6-class
  // composition is refused, never rendered as zero total cost).
  const rendered: RenderedSpendClasses = RenderedSpendClassesSchema.parse(input.renderedClasses);
  const marginalCost = Object.values(rendered).reduce((acc, v) => acc + v, 0);
  const totalCost = input.totalCost ?? marginalCost;
  if (!Number.isFinite(totalCost) || totalCost < 0) {
    throw new Error('ATTRIBUTION_TOTAL_INVALID: totalCost must be a finite non-negative number');
  }
  if (totalCost + 1e-9 < marginalCost) {
    throw new Error(
      `ATTRIBUTION_TOTAL_OVERCLAIM: totalCost ${totalCost} < marginalCost ${marginalCost} ` +
        `(a unit's total can never hide its own marginal spend)`,
    );
  }
  const row = CostAttributionSchema.parse({
    attributionId: input.attributionId,
    contractId: input.contractId,
    unitKind: kind,
    subjectId: input.subjectId,
    marginalCost,
    totalCost,
    renderedClasses: rendered,
    attributedAt: input.attributedAt ?? new Date().toISOString(),
  });
  await engine.query(
    `INSERT INTO cost.cost_attributions
       (attribution_id, contract_id, unit_kind, subject_id, marginal_cost, total_cost,
        rendered_classes, attributed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (attribution_id) DO NOTHING`,
    [
      row.attributionId,
      row.contractId,
      row.unitKind,
      row.subjectId,
      row.marginalCost,
      row.totalCost,
      JSON.stringify(row.renderedClasses),
      row.attributedAt,
    ],
  );
  return row;
}

/** The §62.4 borrowing record shape writeReserveBorrowing persists (audit only). */
export type ReserveBorrowingRecord = BorrowedReserve;

/**
 * Persist a §62.4 reserve borrowing audit record into
 * cost.contract_reserves_borrowed. Borrowing is recorded, never silent: the
 * caller supplies the versioned policy that authorizes it, and a class can
 * never borrow from itself (schema refine + SQL CHECK).
 */
export async function writeReserveBorrowing(
  engine: DatabaseEngine,
  record: BorrowedReserve,
): Promise<void> {
  // Schema law first (fail-closed: unknown classes, self-borrowing refused).
  const parsed = BorrowedReserveSchema.parse(record);
  await engine.query(
    `INSERT INTO cost.contract_reserves_borrowed
       (borrow_id, contract_id, reserve_class, borrowed_by_class, units, policy_version, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (borrow_id) DO NOTHING`,
    [
      parsed.borrowId,
      parsed.contractId,
      parsed.reserveClass,
      parsed.borrowedByClass,
      parsed.units,
      parsed.policyVersion,
      parsed.occurredAt ?? new Date().toISOString(),
    ],
  );
}

export { ALL_RECONCILIATION_DIMENSIONS as RECONCILIATION_DIMENSIONS };
