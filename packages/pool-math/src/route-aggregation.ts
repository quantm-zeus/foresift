/**
 * §64.5 read-only route aggregation — canonical route selection, shared-vault
 * detection, loop refusal, and the complexity cap. The evaluation core lives
 * in `state-completeness.ts` (it shares the fail-closed refusal vocabulary);
 * this module is the T012-mandated re-export surface for the route side.
 *
 * Traces: FR-EXEC-002, FR-EXEC-005, FR-EXEC-020, INV-001.
 */
export type {
  EvaluateRouteInput,
  QuoteConversion,
  RouteEvaluation,
  RouteLeg,
} from './state-completeness.ts';
export { evaluateRoute } from './state-completeness.ts';
