export const ProviderConflictClass = {
  BENIGN_LATENCY_ROUNDING_VARIANCE: 'BENIGN_LATENCY_ROUNDING_VARIANCE',
  COMMON_UPSTREAM_DUPLICATION: 'COMMON_UPSTREAM_DUPLICATION',
  MATERIAL_DISAGREEMENT: 'MATERIAL_DISAGREEMENT',
  UNRESOLVED_DECISION_CRITICAL: 'UNRESOLVED_DECISION_CRITICAL',
} as const;

export type ProviderConflictClass =
  (typeof ProviderConflictClass)[keyof typeof ProviderConflictClass];
export const ALL_PROVIDER_CONFLICT_CLASSES: readonly ProviderConflictClass[] =
  Object.values(ProviderConflictClass);

export function providerConflictClass(value: string): ProviderConflictClass {
  if (!(ALL_PROVIDER_CONFLICT_CLASSES as readonly string[]).includes(value)) {
    throw new RangeError(`unknown provider conflict class: ${JSON.stringify(value)}`);
  }
  return value as ProviderConflictClass;
}

export interface ConflictObservation {
  readonly value: string;
  readonly fetchedAt: string;
  readonly upstreamLineage?: string;
}

export interface ConflictClassificationInput {
  readonly obsA: ConflictObservation;
  readonly obsB: ConflictObservation;
  readonly latencyDeltaMs: number;
  readonly roundingFingerprintMatch: boolean;
  readonly sharedUpstream: boolean;
  readonly affectsDecisionThreshold: boolean;
}

export function classifyConflict(input: ConflictClassificationInput): ProviderConflictClass {
  if (input.affectsDecisionThreshold) {
    return ProviderConflictClass.UNRESOLVED_DECISION_CRITICAL;
  }
  if (
    input.sharedUpstream ||
    (input.obsA.upstreamLineage !== undefined &&
      input.obsA.upstreamLineage === input.obsB.upstreamLineage)
  ) {
    return ProviderConflictClass.COMMON_UPSTREAM_DUPLICATION;
  }

  const a = Number(input.obsA.value);
  const b = Number(input.obsB.value);
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  const roundingVariance =
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a - b) / scale <= 0.000001 &&
    input.roundingFingerprintMatch &&
    Number.isFinite(input.latencyDeltaMs) &&
    input.latencyDeltaMs >= 0;
  return roundingVariance
    ? ProviderConflictClass.BENIGN_LATENCY_ROUNDING_VARIANCE
    : ProviderConflictClass.MATERIAL_DISAGREEMENT;
}
