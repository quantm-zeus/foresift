export interface RetrospectiveEvidence {
  readonly subjectId: string;
  readonly outcomeProfileMatched: boolean;
  readonly liveSourceIds: readonly string[];
  readonly retrospectiveUniversePresent: boolean;
  readonly lineageIndependenceDisclosed: boolean;
  readonly evidenceRefs: readonly string[];
}
export interface RetrospectiveClassification {
  readonly classification: 'NOT_DISCOVERED' | 'INELIGIBLE';
  readonly retrospectiveOnly: true;
  readonly historicalDecisionBundleEligible: false;
  readonly evidenceRefs: readonly string[];
}
export function classifyRetrospectiveMiss(
  input: RetrospectiveEvidence,
): RetrospectiveClassification {
  const allowed =
    input.outcomeProfileMatched &&
    input.liveSourceIds.length === 0 &&
    input.retrospectiveUniversePresent &&
    input.lineageIndependenceDisclosed &&
    input.evidenceRefs.length > 0;
  return {
    classification: allowed ? 'NOT_DISCOVERED' : 'INELIGIBLE',
    retrospectiveOnly: true,
    historicalDecisionBundleEligible: false,
    evidenceRefs: input.evidenceRefs,
  };
}
