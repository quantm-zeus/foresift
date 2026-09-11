/**
 * Robust action-delay gate (FR-OBJ-008): a configurable action-delay
 * distribution includes at least p50, p90, and conservative-tail
 * scenarios, and the active opportunity policy must pass its declared
 * robust-delay gate rather than only a single favorable fixed delay.
 *
 * Single-scenario evidence refuses; a fully evidenced but failed gate is
 * a verdict (`passed: false`), not a refusal.
 */
import {
  ObjError,
  ObjErrorCode,
  parseDelayScenario,
  robustDelayRequired,
  type DelayScenario,
} from '@foresift/domain';

/** Per-scenario delay evidence: observed and passing. */
export interface DelayScenarioResult {
  readonly evidenced: boolean;
  readonly passed: boolean;
}

/** Robust-delay verdict for one policy. */
export interface DelayGateVerdict {
  readonly runId: string;
  readonly declaredGate: readonly DelayScenario[];
  readonly passed: boolean;
}

/**
 * Parse a declared gate: a non-empty set of known delay scenarios.
 * Duplicates collapse (a set, not a list); unknown literals refuse.
 */
export function parseDeclaredGate(value: unknown): DelayScenario[] {
  if (!(value instanceof Array) || value.length === 0)
    throw new ObjError(
      ObjErrorCode.OBJ_SINGLE_DELAY_EVIDENCE_REFUSED,
      'robust delay requires a declared non-empty gate',
      {},
    );
  const gate: DelayScenario[] = [];
  for (const entry of value) {
    const scenario = parseDelayScenario(entry);
    if (!gate.includes(scenario)) gate.push(scenario);
  }
  return gate;
}

/**
 * Evaluate the declared robust-delay gate over three-scenario evidence.
 * Missing evidence for any scenario refuses; otherwise the gate verdict
 * reports whether every declared scenario passed.
 */
export function evaluateDelayGate(
  runId: string,
  results: Readonly<Partial<Record<DelayScenario, DelayScenarioResult>>>,
  declaredGate: readonly DelayScenario[],
): DelayGateVerdict {
  if (runId.length === 0)
    throw new ObjError(ObjErrorCode.OBJ_DIMENSION_UNKNOWN, 'delay gate requires a run id', {});
  const gate = parseDeclaredGate([...declaredGate]);
  const passed = robustDelayRequired({ results, declaredGate: gate });
  return { runId, declaredGate: gate, passed };
}
