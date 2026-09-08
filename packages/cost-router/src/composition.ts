/**
 * §62.12 cost composition and marginal-cost attribution (FR-COST-011,
 * FR-COST-017, AC-105; plan ADR-1).
 *
 * Cost composition is never a single scalar: every composition carries ALL
 * seven rendered spend classes, total = Σ classes is an enforced identity,
 * and a zero-PAID_DATA_SPEND configuration with any other class positive
 * renders total > 0 — "zero paid data calls" can never be rendered as
 * "zero total cost" (zero-overclaim law).
 */
import {
  AttributionUnitKind,
  ALL_RENDERED_SPEND_CLASSES,
  attributionUnitKind,
  type AttributionUnitKind as AttributionUnitKindType,
} from '@foresift/domain';
import {
  CostAttributionSchema,
  RenderedSpendClassesSchema,
  type CostAttribution,
  type RenderedSpendClasses,
} from '@foresift/shared-schemas';

const ZERO_CLASSES: RenderedSpendClasses = {
  PAID_DATA_SPEND: 0,
  FREE_QUOTA_CONSUMPTION: 0,
  MODEL_SPEND: 0,
  INFRASTRUCTURE_SPEND: 0,
  STORAGE_EGRESS_SPEND: 0,
  NOTIFICATION_SPEND: 0,
  HUMAN_REVIEW_EFFORT: 0,
};

/** IEEE754 slack for the total = Σ classes identity over fractional spend. */
const SUM_EPSILON = 1e-9;

export class CostCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CostCompositionError';
  }
}

function fail(message: string): never {
  throw new CostCompositionError(message);
}

/** Sum the seven classes in the canonical ALL_RENDERED_SPEND_CLASSES order. */
function sumClasses(classes: RenderedSpendClasses): number {
  return ALL_RENDERED_SPEND_CLASSES.reduce((acc, key) => acc + classes[key], 0);
}

export interface ComposedCostTotals {
  /** All seven §62.12 classes, verbatim. */
  readonly renderedClasses: RenderedSpendClasses;
  /** Exactly Σ classes — the identity the renderer enforces, never a caller claim. */
  readonly totalCost: number;
}

/**
 * Compose a cost total from the seven §62.12 rendered spend classes.
 * Refuses (typed throw) any input missing one of the seven class keys or
 * carrying a non-finite/negative value, and refuses any caller-supplied
 * total claim inconsistent with the class sum.
 */
export function composeCostTotals(
  classes: Partial<RenderedSpendClasses>,
  claimedTotal?: number,
): ComposedCostTotals {
  const parsed = RenderedSpendClassesSchema.safeParse(classes);
  if (!parsed.success) {
    const missing = ALL_RENDERED_SPEND_CLASSES.filter((key) => !(key in classes));
    fail(
      missing.length > 0
        ? `COST_COMPOSITION_INCOMPLETE: missing RenderedSpendClass key(s) ${missing.join(',')}`
        : `COST_COMPOSITION_INVALID: rendered classes must be finite non-negative numbers`,
    );
  }
  const rendered = parsed.data;
  const total = sumClasses(rendered);
  if (claimedTotal !== undefined) {
    if (!Number.isFinite(claimedTotal)) fail('COST_TOTAL_INVALID: claimed total must be finite');
    if (Math.abs(claimedTotal - total) > SUM_EPSILON) {
      fail(
        `COST_TOTAL_OVERCLAIM: claimed total ${claimedTotal} != Σ rendered classes ${total} ` +
          `(zero paid data with any other class > 0 renders total > 0 — §62.12)`,
      );
    }
  }
  return { renderedClasses: rendered, totalCost: total };
}

export interface MarginalCostAttributionInput {
  readonly attributionId: string;
  readonly contractId: string;
  readonly unitKind: string;
  readonly subjectId: string;
  /** All seven rendered classes for the unit; marginal = Σ classes. */
  readonly renderedClasses: RenderedSpendClasses;
  /** Optional pre-computed totals; verified against the class sum when present. */
  readonly totalCost?: number;
  readonly attributedAt: string;
}

/**
 * Build a marginal-cost attribution row per AttributionUnitKind (FR-COST-017).
 * The marginal cost is ALWAYS Σ rendered classes of the unit — never a caller
 * claim — so an attribution can never hide owner-supplied model or
 * infrastructure spend. Unknown unit kinds fail closed through the domain
 * vocabulary.
 */
export function marginalCostAttribution(input: MarginalCostAttributionInput): CostAttribution {
  const kind = attributionUnitKind(input.unitKind);
  if (typeof input.subjectId !== 'string' || input.subjectId.length === 0) {
    fail('ATTRIBUTION_SUBJECT_REQUIRED: subjectId is required');
  }
  const composed = composeCostTotals(input.renderedClasses);
  const marginalCost = composed.totalCost;
  const totalCost = input.totalCost ?? marginalCost;
  if (!Number.isFinite(totalCost) || totalCost < 0) {
    fail('ATTRIBUTION_TOTAL_INVALID: totalCost must be a finite non-negative number');
  }
  if (totalCost + SUM_EPSILON < marginalCost) {
    fail(
      `ATTRIBUTION_TOTAL_OVERCLAIM: totalCost ${totalCost} < marginalCost ${marginalCost} ` +
        `(a unit's total can never hide its own marginal spend)`,
    );
  }
  return CostAttributionSchema.parse({
    attributionId: input.attributionId,
    contractId: input.contractId,
    unitKind: kind,
    subjectId: input.subjectId,
    marginalCost,
    totalCost,
    renderedClasses: composed.renderedClasses,
    attributedAt: input.attributedAt,
  });
}

/** The zero composition — every class 0. Only this renders totalCost 0. */
export function zeroCostComposition(): ComposedCostTotals {
  return { renderedClasses: { ...ZERO_CLASSES }, totalCost: 0 };
}

export { AttributionUnitKind, type AttributionUnitKindType };
