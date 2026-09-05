/**
 * §64.14 / FR-EXEC-011 observation-plan issuance — thin module keeping the
 * plan surface in one place; the fail-closed plan law lives in
 * `experiments.ts` (`issueObservationPlan`, `resolutionCeilingFor`).
 *
 * Traces: FR-EXEC-011, AC-128.
 */
export {
  issueObservationPlan,
  resolutionCeilingFor,
} from './experiments.ts';
export type {
  ExitPolicyExperiment,
  IssueObservationPlanInput,
  OutcomeObservationPlan,
} from './experiments.ts';
