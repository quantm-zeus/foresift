/**
 * §12.11 lifecycle alphabet and legal-transition graph (FR-PROV-001, T108).
 *
 * The graph is the SINGLE in-process source of truth for which transitions
 * the lifecycle machine will guard-approve:
 *
 *   DISCOVERED → VERIFIED → ACTIVE ⇄ DEGRADED
 *   every non-terminal state → {DEPRECATED, BLOCKED, REMOVED}
 *
 * (a vendor notice can deprecate a never-activated discovery just as it can
 * be blocked or removed — the three exits are legal from all four).
 *
 * DEPRECATED / BLOCKED / REMOVED are TERMINAL per operation version: rows are
 * versioned and immutable per version, so recovery is expressed as a NEW
 * operation version (or the replacement named by deprecation metadata), never
 * by resurrecting a terminal row.
 *
 * COMPLETENESS CONTRACT: `test/lifecycle-states.spec.ts` proves this graph,
 * the SQL CHECK alphabets in g0_prov_0001, and the Zod schemas below agree
 * value-for-value — three representations, one alphabet.
 */
import { z } from 'zod';
import { LifecycleTransitionError } from './errors.ts';

/** The seven §12.11 states, in canonical (PRD-listed) order. */
export const PROVIDER_LIFECYCLE_STATES = [
  'DISCOVERED',
  'VERIFIED',
  'ACTIVE',
  'DEGRADED',
  'DEPRECATED',
  'BLOCKED',
  'REMOVED',
] as const;
export const ProviderLifecycleStateSchema = z.enum(PROVIDER_LIFECYCLE_STATES);
export type ProviderLifecycleState = z.infer<typeof ProviderLifecycleStateSchema>;

/** States from which no outgoing transition is legal for this version. */
export const TERMINAL_LIFECYCLE_STATES: readonly ProviderLifecycleState[] = [
  'DEPRECATED',
  'BLOCKED',
  'REMOVED',
];

/**
 * Legal edges of the §12.11 graph. Expiry sweeps exit ACTIVE via
 * ACTIVE→DEGRADED; they NEVER mutate stored historical evidence (the ledger is
 * append-only; only the control-plane projection columns move).
 */
export const LIFECYCLE_TRANSITIONS: Readonly<
  Record<ProviderLifecycleState, readonly ProviderLifecycleState[]>
> = Object.freeze({
  DISCOVERED: ['VERIFIED', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
  VERIFIED: ['ACTIVE', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
  ACTIVE: ['DEGRADED', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
  DEGRADED: ['ACTIVE', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
  DEPRECATED: [],
  BLOCKED: [],
  REMOVED: [],
});

/** Flat sorted edge list — the exact shape the completeness test pins. */
export const LEGAL_TRANSITION_EDGES: readonly (readonly [
  ProviderLifecycleState,
  ProviderLifecycleState,
])[] = PROVIDER_LIFECYCLE_STATES.flatMap((from) =>
  (LIFECYCLE_TRANSITIONS[from] ?? []).map((to) => [from, to] as const),
).sort((a, b) => `${a[0]}>${a[1]}`.localeCompare(`${b[0]}>${b[1]}`));

export function isLegalLifecycleTransition(
  from: ProviderLifecycleState,
  to: ProviderLifecycleState,
): boolean {
  return (LIFECYCLE_TRANSITIONS[from] ?? []).includes(to);
}

/** Guarded-edge check used by the lifecycle machine; refuses with detail. */
export function assertLegalLifecycleTransition(
  from: ProviderLifecycleState,
  to: ProviderLifecycleState,
): void {
  if (!isLegalLifecycleTransition(from, to)) {
    throw new LifecycleTransitionError(
      `lifecycle transition ${from} → ${to} is not in the §12.11 graph`,
      { from, to },
    );
  }
}

/**
 * Every state must be reachable from DISCOVERED and every non-terminal state
 * must have at least one outgoing edge — structural invariants asserted at
 * module load so a future edit cannot silently orphan part of the alphabet.
 */
for (const state of PROVIDER_LIFECYCLE_STATES) {
  const seen = new Set<ProviderLifecycleState>(['DISCOVERED']);
  let frontier: ProviderLifecycleState[] = ['DISCOVERED'];
  while (frontier.length > 0) {
    const next: ProviderLifecycleState[] = [];
    for (const current of frontier) {
      for (const target of LIFECYCLE_TRANSITIONS[current] ?? []) {
        if (!seen.has(target)) {
          seen.add(target);
          next.push(target);
        }
      }
    }
    frontier = next;
  }
  if (!seen.has(state)) {
    throw new Error(`§12.11 graph incomplete: ${state} is unreachable from DISCOVERED`);
  }
}
for (const state of TERMINAL_LIFECYCLE_STATES) {
  if ((LIFECYCLE_TRANSITIONS[state]?.length ?? 0) > 0) {
    throw new Error(`§12.11 graph incomplete: terminal ${state} has outgoing edges`);
  }
}
