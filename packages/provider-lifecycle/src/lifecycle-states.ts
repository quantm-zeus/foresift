/**
 * The seven-state provider operation lifecycle (FR-PROV-001, §12.11) and its
 * legal-transition graph.
 *
 * Shape rules from the product contract:
 *   DISCOVERED → VERIFIED → ACTIVE   (the activation spine)
 *   ACTIVE ⇄ DEGRADED                (health-driven excursions)
 *   any live state → DEPRECATED / BLOCKED / REMOVED
 *   DEPRECATED / BLOCKED / REMOVED are TERMINAL in this graph: leaving them
 *   happens through a NEW OPERATION VERSION registered fresh at DISCOVERED,
 *   never by mutating history (§12.11: expiry "may transition an operation
 *   out of ACTIVE without changing stored historical evidence").
 *
 * This module is one leg of the three-way parity contract: the SQL CHECK
 * constraints on prov.prov_operations.current_state / prov_lifecycle_events
 * pin VALUES, this graph pins EDGES, and both are asserted equal by
 * test/lifecycle-states.spec.ts against the same constants.
 */
import { z } from 'zod';
import { LifecycleTransitionError, ProvErrorCode } from './errors.ts';

/** The §12.11 state alphabet (order = declaration order in the PRD). */
export const PROVIDER_LIFECYCLE_STATES = [
  'DISCOVERED',
  'VERIFIED',
  'ACTIVE',
  'DEGRADED',
  'DEPRECATED',
  'BLOCKED',
  'REMOVED',
] as const;

export type LifecycleState = (typeof PROVIDER_LIFECYCLE_STATES)[number];

export const LifecycleStateSchema = z.enum(PROVIDER_LIFECYCLE_STATES);

/** States from which no outgoing edge exists. */
export const TERMINAL_STATES: readonly LifecycleState[] = ['REMOVED'];

/** States that may still serve active decision-critical use. */
export function isActiveServiceState(state: LifecycleState): boolean {
  return state === 'ACTIVE';
}

interface TransitionEdge {
  readonly from: LifecycleState;
  readonly to: LifecycleState;
}

export const EDGE_LIST: readonly TransitionEdge[] = [
  { from: 'DISCOVERED', to: 'VERIFIED' },
  { from: 'DISCOVERED', to: 'BLOCKED' },
  { from: 'DISCOVERED', to: 'REMOVED' },
  { from: 'VERIFIED', to: 'ACTIVE' },
  { from: 'VERIFIED', to: 'DEGRADED' },
  { from: 'VERIFIED', to: 'BLOCKED' },
  { from: 'VERIFIED', to: 'DEPRECATED' },
  { from: 'VERIFIED', to: 'REMOVED' },
  { from: 'ACTIVE', to: 'DEGRADED' },
  { from: 'DEGRADED', to: 'ACTIVE' },
  { from: 'ACTIVE', to: 'BLOCKED' },
  { from: 'DEGRADED', to: 'BLOCKED' },
  { from: 'ACTIVE', to: 'DEPRECATED' },
  { from: 'DEGRADED', to: 'DEPRECATED' },
  { from: 'ACTIVE', to: 'REMOVED' },
  { from: 'DEGRADED', to: 'REMOVED' },
  { from: 'DEPRECATED', to: 'REMOVED' },
  { from: 'BLOCKED', to: 'REMOVED' },
];

/**
 * The legal-transition graph as a frozen adjacency map. Derived from
 * EDGE_LIST so the list above stays the single reviewable statement of edge
 * legality (a completeness test asserts the map is total over the alphabet).
 */
export const LEGAL_TRANSITIONS: ReadonlyMap<LifecycleState, readonly LifecycleState[]> =
  new Map(
    PROVIDER_LIFECYCLE_STATES.map((state) => [
      state,
      Object.freeze(
        EDGE_LIST.filter((edge) => edge.from === state).map((edge) => edge.to),
      ),
    ]),
  );

/** Self-transitions are never edges: same-state "transitions" are no-ops, not events. */
export function isLegalTransition(from: LifecycleState, to: LifecycleState): boolean {
  if (from === to) return false;
  return LEGAL_TRANSITIONS.get(from)?.includes(to) ?? false;
}

/** Fail-closed edge check: refuses unknown states and illegal edges alike. */
export function assertTransitionLegal(from: LifecycleState, to: LifecycleState): void {
  if (!PROVIDER_LIFECYCLE_STATES.includes(from)) {
    throw new LifecycleTransitionError(
      `unknown lifecycle state '${from}'`,
      { from },
      ProvErrorCode.PROV_LIFECYCLE_STATE_UNKNOWN,
    );
  }
  if (!PROVIDER_LIFECYCLE_STATES.includes(to)) {
    throw new LifecycleTransitionError(
      `unknown lifecycle state '${to}'`,
      { to },
      ProvErrorCode.PROV_LIFECYCLE_STATE_UNKNOWN,
    );
  }
  if (!isLegalTransition(from, to)) {
    throw new LifecycleTransitionError(
      `lifecycle transition ${from} -> ${to} is not in the legal graph`,
      { from, to },
    );
  }
}
