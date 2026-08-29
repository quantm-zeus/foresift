export interface RouteLegObservation {
  readonly adapterId: string;
  readonly inputAsset: string;
  readonly outputAsset: string;
  readonly inputAmount: string;
  readonly outputAmount: string;
  readonly venueEventKey: string;
}
export interface JupiterRouteObservation {
  readonly routeId: string;
  readonly slot: number;
  readonly transactionSignature: string;
  readonly legs: readonly RouteLegObservation[];
}
export interface VenueSwapObservation extends RouteLegObservation {
  readonly slot: number;
  readonly transactionSignature: string;
}
export interface RouteReconciliation {
  readonly route: JupiterRouteObservation;
  readonly matched: readonly VenueSwapObservation[];
  readonly unmatchedLegIndexes: readonly number[];
  readonly authoritativePoolMath: false;
}
export function normalizeObservedRoute(value: JupiterRouteObservation): JupiterRouteObservation {
  return {
    ...value,
    legs: value.legs.map((leg) => ({
      ...leg,
      inputAmount: BigInt(leg.inputAmount).toString(),
      outputAmount: BigInt(leg.outputAmount).toString(),
    })),
  };
}
export function reconcileObservedRoute(
  route: JupiterRouteObservation,
  venueEvents: readonly VenueSwapObservation[],
): RouteReconciliation {
  const normalized = normalizeObservedRoute(route);
  const matched: VenueSwapObservation[] = [];
  const unmatched: number[] = [];
  normalized.legs.forEach((leg, index) => {
    const found = venueEvents.find(
      (v) =>
        v.venueEventKey === leg.venueEventKey &&
        v.slot === normalized.slot &&
        v.transactionSignature === normalized.transactionSignature &&
        v.adapterId === leg.adapterId,
    );
    if (found) matched.push(found);
    else unmatched.push(index);
  });
  return {
    route: normalized,
    matched,
    unmatchedLegIndexes: unmatched,
    authoritativePoolMath: false,
  };
}
