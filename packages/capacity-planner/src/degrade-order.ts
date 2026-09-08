/**
 * Versioned degradation-order loading and admission-integration resolution
 * (PRD §62.8; FR-COST-015, AC-104, AC-228, plan ADR-4).
 *
 * The §62.8 canonical eleven-step order lives as DATA in
 * `cost.degradation_policies` + `cost.degradation_order_steps` (seeded by
 * g1_cost_0003 under policy_version 'v1'); the domain constant
 * DEFAULT_POLICY_V1 is the code-side mirror. `loadDegradationOrder` reads the
 * SQL truth and REFUSES on drift against the domain constant (seed-parity
 * law) — a second private ordering is never created. Resolution on quota
 * exhaustion returns the next REDUCE step from the versioned order; the two
 * PROTECTED_STEPS are terminal, never skippable, and no resolver path can
 * select a paid operation or silently drop protected work (§62.8 closing
 * law) — at full exhaustion resolution lands on the terminal protected step,
 * never on a paid fallback.
 */
import {
  DEFAULT_POLICY_V1,
  PROTECTED_STEPS,
  degradationStep,
  isProtectedStep,
  type DegradationStep,
} from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

/** Row shape of cost.degradation_order_steps (g1_cost_0003 seed). */
interface DegradationOrderStepRow {
  policy_version: string;
  step_index: number | string;
  step_name: string;
  protected_class: string | null;
}

/** An ordered, versioned degradation order read from SQL truth. */
export interface LoadedDegradationOrder {
  readonly policyVersion: string;
  /** Steps ordered by step_index ascending — the deterministic §62.8 order. */
  readonly steps: readonly DegradationStep[];
  /** Terminal protected steps of the order (subset of steps). */
  readonly protectedSteps: readonly DegradationStep[];
}

/** The seed-parity refusal: SQL truth and the domain constant drifted. */
export class DegradationOrderDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DegradationOrderDriftError';
  }
}

/** Domain-mirror parity check: SQL rows must equal DEFAULT_POLICY_V1 exactly. */
export function assertSeedParity(policyVersion: string, steps: readonly DegradationStep[]): void {
  if (policyVersion !== 'v1') return; // non-default versions carry their own order
  const expected = DEFAULT_POLICY_V1;
  if (steps.length !== expected.length) {
    throw new DegradationOrderDriftError(
      `DEGRADATION_ORDER_DRIFT: policy ${policyVersion} has ${steps.length} step(s), ` +
        `domain DEFAULT_POLICY_V1 has ${expected.length} — drift refuses (plan ADR-4)`,
    );
  }
  for (let i = 0; i < expected.length; i++) {
    if (steps[i] !== expected[i]) {
      throw new DegradationOrderDriftError(
        `DEGRADATION_ORDER_DRIFT: policy ${policyVersion} step ${i + 1} is ` +
          `${String(steps[i])}, domain DEFAULT_POLICY_V1 declares ${expected[i]} — drift refuses (plan ADR-4)`,
      );
    }
  }
}

/**
 * Load a versioned degradation order from `cost.degradation_order_steps`.
 * Unknown step names fail closed through the domain vocabulary. For policy
 * version 'v1' the seed-parity assertion refuses any drift from the domain
 * constant DEFAULT_POLICY_V1.
 */
export async function loadDegradationOrder(
  engine: DatabaseEngine,
  version: string,
): Promise<LoadedDegradationOrder> {
  const result = await engine.query<DegradationOrderStepRow>(
    `SELECT policy_version, step_index, step_name, protected_class
       FROM cost.degradation_order_steps
      WHERE policy_version = $1
      ORDER BY step_index ASC`,
    [version],
  );
  if (result.rows.length === 0) {
    throw new DegradationOrderDriftError(
      `DEGRADATION_POLICY_UNKNOWN: no degradation_order_steps rows for policy_version ${version}`,
    );
  }
  const steps = result.rows
    .map((row) => ({
      index: Number(row.step_index),
      step: degradationStep(row.step_name),
      protectedClass: row.protected_class,
    }))
    .sort((a, b) => a.index - b.index)
    .map((row) => row.step);
  assertSeedParity(version, steps);
  return {
    policyVersion: version,
    steps,
    protectedSteps: steps.filter((step) => isProtectedStep(step)),
  };
}

/** The state a quota-exhaustion resolver consumes (admission-integration shape). */
export interface DegradationResolutionInput {
  /** The versioned order (from loadDegradationOrder or DEFAULT_POLICY_V1). */
  readonly order: readonly DegradationStep[];
  /** Steps already entered. */
  readonly activeSteps: readonly DegradationStep[];
}

/**
 * Admission-integration resolver: on quota exhaustion return the NEXT REDUCE
 * step of the versioned order. Deterministic: the first step of `order` not
 * yet active. Protected steps are terminal — they are never proposed as a
 * reduction (a reduction is something the system gives UP); when every
 * reducible step is active the resolution lands on the terminal protected
 * step `RETURN_PARTIAL_INSUFFICIENT_DATA`, so the caller degrades honestly
 * instead of escaping to a paid operation (§62.8 closing law).
 */
export function resolveNextReduceStep(input: DegradationResolutionInput): DegradationStep {
  const active = new Set(input.activeSteps);
  for (const step of input.order) {
    if ((PROTECTED_STEPS as readonly string[]).includes(step)) continue;
    if (!active.has(step)) return step;
  }
  return 'RETURN_PARTIAL_INSUFFICIENT_DATA';
}
