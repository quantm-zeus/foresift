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

export interface ConflictClassificationRule {
  readonly version: string;
  readonly relativeRoundingTolerance: number;
  readonly maxBenignLatencyDeltaMs: number;
}

export const DEFAULT_CONFLICT_CLASSIFICATION_RULE: ConflictClassificationRule = {
  version: 'provider-conflict/v1',
  relativeRoundingTolerance: 0.000001,
  maxBenignLatencyDeltaMs: 60_000,
};

export interface ClassifiedConflict {
  readonly conflictClass: ProviderConflictClass;
  /** Non-null only when a deterministic rule resolved the conflict class. */
  readonly resolvedByRule: string | null;
  readonly qualityCode: 'CONFLICTING' | 'BENIGN_VARIANCE';
}

export function classifyConflictWithRule(
  input: ConflictClassificationInput,
  rule: ConflictClassificationRule = DEFAULT_CONFLICT_CLASSIFICATION_RULE,
): ClassifiedConflict {
  utcTimestamp(input.obsA.fetchedAt);
  utcTimestamp(input.obsB.fetchedAt);
  if (
    input.obsA.value.length === 0 ||
    input.obsB.value.length === 0 ||
    !Number.isFinite(input.latencyDeltaMs) ||
    input.latencyDeltaMs < 0 ||
    !Number.isFinite(rule.relativeRoundingTolerance) ||
    rule.relativeRoundingTolerance < 0 ||
    !Number.isFinite(rule.maxBenignLatencyDeltaMs) ||
    rule.maxBenignLatencyDeltaMs < 0 ||
    rule.version.trim().length === 0
  ) {
    throw new RangeError('invalid provider-conflict classification input or rule');
  }
  if (input.affectsDecisionThreshold) {
    return {
      conflictClass: ProviderConflictClass.UNRESOLVED_DECISION_CRITICAL,
      resolvedByRule: null,
      qualityCode: 'CONFLICTING',
    };
  }
  if (
    input.sharedUpstream ||
    (input.obsA.upstreamLineage !== undefined &&
      input.obsA.upstreamLineage === input.obsB.upstreamLineage)
  ) {
    return {
      conflictClass: ProviderConflictClass.COMMON_UPSTREAM_DUPLICATION,
      resolvedByRule: rule.version,
      qualityCode: 'CONFLICTING',
    };
  }

  const a = Number(input.obsA.value);
  const b = Number(input.obsB.value);
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  const roundingVariance =
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a - b) / scale <= rule.relativeRoundingTolerance &&
    input.roundingFingerprintMatch &&
    input.latencyDeltaMs <= rule.maxBenignLatencyDeltaMs;
  return roundingVariance
    ? {
        conflictClass: ProviderConflictClass.BENIGN_LATENCY_ROUNDING_VARIANCE,
        resolvedByRule: rule.version,
        qualityCode: 'BENIGN_VARIANCE',
      }
    : {
        conflictClass: ProviderConflictClass.MATERIAL_DISAGREEMENT,
        resolvedByRule: rule.version,
        qualityCode: 'CONFLICTING',
      };
}

export function classifyConflict(input: ConflictClassificationInput): ProviderConflictClass {
  return classifyConflictWithRule(input).conflictClass;
}
import { utcTimestamp } from './timestamps.ts';
