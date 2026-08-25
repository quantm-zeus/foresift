/**
 * §12.11 lifecycle alphabet and the legal-transition graph (FR-PROV-001).
 *
 * The graph is the single in-process authority: the SQL CHECK constraints on
 * `prov_lifecycle_events`/`prov_operations` and this module's exported
 * constants are proven byte-equal by a completeness test, so SQL truth, the
 * TS engine, and the schemas cannot drift.
 *
 * Legal edges (everything else refuses fail-closed):
 *   DISCOVERED → VERIFIED            promotion after verification evidence
 *   VERIFIED → ACTIVE                activation
 *   ACTIVE ⇄ DEGRADED                expiry/incident exits and recovery
 *   ACTIVE → DEPRECATED | BLOCKED | REMOVED   terminal semantics
 * Terminal states have NO outgoing edges: corrections land as new operation
 * versions or replacement operations — stored history never mutates
 * (INV-005/INV-006; §12.11 "without changing stored historical evidence").
 */
import type { LifecycleState } from './schemas.ts';
import { LifecycleStateSchema } from './schemas.ts';
import { LifecycleTransitionError } from './errors.ts';

/** All seven states, in §12.11 order (single source for parity tests). */
export const ALL_LIFECYCLE_STATES: readonly LifecycleState[] = LifecycleStateSchema.options;

/** States with no outgoing transitions (§12.11 terminal semantics). */
export const TERMINAL_STATES: readonly LifecycleState[] = ['DEPRECATED', 'BLOCKED', 'REMOVED'];

type TransitionEdge = `${LifecycleState}->${LifecycleState}`;

/** The complete legal-edge set, phrased as ordered pairs. */
export const LEGAL_TRANSITIONS: ReadonlyArray<readonly [LifecycleState, LifecycleState]> = [
  ['DISCOVERED', 'VERIFIED'],
  ['VERIFIED', 'ACTIVE'],
  ['ACTIVE', 'DEGRADED'],
  ['DEGRADED', 'ACTIVE'],
  ['ACTIVE', 'DEPRECATED'],
  ['ACTIVE', 'BLOCKED'],
  ['ACTIVE', 'REMOVED'],
];

const LEGAL_EDGE_SET: ReadonlySet<TransitionEdge> = new Set(
  LEGAL_TRANSITIONS.map(([from, to]) => `${from}->${to}` as TransitionEdge),
);

/** Is `to` reachable from `from` in one guarded transition? */
export function isTransitionLegal(from: LifecycleState, to: LifecycleState): boolean {
  return LEGAL_EDGE_SET.has(`${from}->${to}` as TransitionEdge);
}

/** States directly reachable from `from` (empty for terminal states). */
export function successorsOf(from: LifecycleState): readonly LifecycleState[] {
  return LEGAL_TRANSITIONS.filter(([fromState]) => fromState === from).map(([, to]) => to);
}

/** Fail-closed guard used by the lifecycle machine before any write. */
export function requireLegalTransition(from: LifecycleState, to: LifecycleState): void {
  if (!isTransitionLegal(from, to)) {
    throw new LifecycleTransitionError(`illegal lifecycle transition ${from} -> ${to}`, {
      from,
      to,
    });
  }
}
