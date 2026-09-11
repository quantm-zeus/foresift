/**
 * Hard constraints before utility (FR-OBJ-003): critical security,
 * execution, rights, leakage, public-claim, capacity, and tail-risk
 * constraints are evaluated totally before any utility optimization,
 * and no weighted score may compensate for a failed hard constraint.
 *
 * Weighted scores are not inputs to this module by design — the
 * signature below cannot receive them.
 */
import {
  ALL_HARD_CONSTRAINT_KINDS,
  ObjError,
  ObjErrorCode,
  hardConstraintsPrecedeUtility,
  parseHardConstraintKind,
  parseHardConstraintVerdict,
  type HardConstraintKind,
  type HardConstraintVerdict,
} from '@foresift/domain';

/** One evaluated hard constraint with its evidence reference. */
export interface HardConstraintEvaluation {
  readonly kind: string;
  readonly verdict: string;
  readonly evidenceRef: string;
}

/**
 * Total seven-kind evaluation: every kind present exactly once with a
 * known verdict, then the precede-utility law. Any FAIL, any missing
 * kind, any duplicate, or any unknown literal refuses before utility
 * is consulted.
 */
export function evaluateHardConstraints(
  evaluations: readonly HardConstraintEvaluation[],
): Readonly<Record<HardConstraintKind, HardConstraintVerdict>> {
  const decided = {} as Record<HardConstraintKind, HardConstraintVerdict>;
  for (const evaluation of evaluations) {
    const kind = parseHardConstraintKind(evaluation.kind);
    const verdict = parseHardConstraintVerdict(evaluation.verdict);
    if (kind in decided)
      throw new ObjError(ObjErrorCode.OBJ_HARD_CONSTRAINT_FAILED, 'duplicate hard-constraint evaluation', {
        kind,
      });
    if (evaluation.evidenceRef.length === 0)
      throw new ObjError(ObjErrorCode.OBJ_HARD_CONSTRAINT_FAILED, 'hard constraint requires evidence', {
        kind,
      });
    decided[kind] = verdict;
  }
  for (const kind of ALL_HARD_CONSTRAINT_KINDS) {
    if (!(kind in decided))
      throw new ObjError(ObjErrorCode.OBJ_HARD_CONSTRAINT_FAILED, 'hard constraint unevaluated', {
        kind,
      });
  }
  hardConstraintsPrecedeUtility(decided);
  return decided;
}
