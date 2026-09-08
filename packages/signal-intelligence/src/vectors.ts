import {
  QualityCode,
  TradabilityVerdict,
  tradabilityVerdict,
  type QualityCode as Quality,
  type TradabilityVerdict as Tradability,
} from '@foresift/domain';
import {
  ProviderDependenceStateSchema,
  type ProviderDependenceState,
} from '@foresift/shared-schemas';

export const VECTOR_KINDS = [
  'OPPORTUNITY',
  'RISK',
  'DATA_QUALITY',
  'URGENCY',
  'NOVELTY',
  'TRADABILITY',
  'SOURCE_INDEPENDENCE',
] as const;
export type VectorKind = (typeof VECTOR_KINDS)[number];

export interface VectorComponent {
  readonly name: string;
  readonly value: number | null;
  readonly qualityCodes: readonly Quality[];
}

export interface IndependentVector<K extends VectorKind = VectorKind> {
  readonly kind: K;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly algorithmVersion: string;
  readonly components: readonly VectorComponent[];
}

export type OpportunityVector = IndependentVector<'OPPORTUNITY'>;
export type RiskVector = IndependentVector<'RISK'>;
export type DataQualityVector = IndependentVector<'DATA_QUALITY'>;
export type UrgencyVector = IndependentVector<'URGENCY'>;
export type NoveltyVector = IndependentVector<'NOVELTY'>;
export type TradabilityVector = IndependentVector<'TRADABILITY'> & {
  readonly verdict: Tradability;
  readonly feasible: boolean;
};
export type SourceIndependenceVector = IndependentVector<'SOURCE_INDEPENDENCE'> & {
  readonly sourceGroupCredits: Readonly<Record<string, number>>;
};

export function vectorComponent(
  name: string,
  value: number | null,
  qualityCodes: readonly Quality[],
): VectorComponent {
  if (name.trim() === '') throw new RangeError('vector component name is required');
  if (value !== null && !Number.isFinite(value))
    throw new RangeError('vector value must be finite or null');
  if (qualityCodes.length === 0) throw new RangeError('vector components require a quality code');
  if (value === null && qualityCodes.every((code) => code === QualityCode.VALID)) {
    throw new RangeError('unknown vector components require a non-VALID quality code');
  }
  return { name, value, qualityCodes: [...qualityCodes] };
}

export function buildIndependentVector<
  K extends Exclude<VectorKind, 'TRADABILITY' | 'SOURCE_INDEPENDENCE'>,
>(
  kind: K,
  input: {
    readonly profileId: string;
    readonly profileVersion: number;
    readonly algorithmVersion: string;
    readonly components: readonly VectorComponent[];
  },
): IndependentVector<K> {
  if (input.profileId.trim() === '' || input.algorithmVersion.trim() === '')
    throw new RangeError('vector versions are required');
  if (!Number.isInteger(input.profileVersion) || input.profileVersion < 1)
    throw new RangeError('profileVersion must be positive');
  if (input.components.length === 0) throw new RangeError('a vector requires components');
  return {
    kind,
    ...input,
    components: input.components.map((component) =>
      vectorComponent(component.name, component.value, component.qualityCodes),
    ),
  };
}

export interface ExecutionFeasibilityEnvelope {
  readonly verdict: Tradability;
  readonly executableCapacityRatio: number | null;
  readonly maximumExecutableNotional: number | null;
  readonly remainingActionabilitySeconds: number | null;
  readonly robustExecutionMargin: number | null;
  readonly qualityCodes: readonly Quality[];
}

/** H.14–H.16 are accepted as proven inputs; no execution or pool math occurs here. */
export function buildTradabilityVector(input: {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly algorithmVersion: string;
  readonly feasibility: ExecutionFeasibilityEnvelope;
}): TradabilityVector {
  const verdict = tradabilityVerdict(input.feasibility.verdict);
  const feasible = verdict === TradabilityVerdict.TRADABLE;
  const unknownCode: Quality = feasible ? QualityCode.PARTIAL : QualityCode.EXECUTION_UNAVAILABLE;
  const component = (name: string, value: number | null): VectorComponent =>
    vectorComponent(name, value, value === null ? [unknownCode] : input.feasibility.qualityCodes);
  const base = {
    kind: 'TRADABILITY' as const,
    profileId: input.profileId,
    profileVersion: input.profileVersion,
    algorithmVersion: input.algorithmVersion,
    components: [
      component('executable_capacity_ratio', input.feasibility.executableCapacityRatio),
      component('maximum_executable_notional', input.feasibility.maximumExecutableNotional),
      component('remaining_actionability_seconds', input.feasibility.remainingActionabilitySeconds),
      component('robust_execution_margin', input.feasibility.robustExecutionMargin),
    ],
  };
  buildIndependentVector('OPPORTUNITY', { ...base, components: base.components });
  return { ...base, verdict, feasible };
}

export interface SourceDependenceInput {
  readonly sourceId: string;
  readonly upstreamGroupId: string | null;
  readonly state: ProviderDependenceState;
  readonly effectiveIndependenceMultiplier: number;
  readonly availableAtDecision: boolean;
}

export function buildSourceIndependenceVector(input: {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly algorithmVersion: string;
  readonly sources: readonly SourceDependenceInput[];
  readonly unknownDependenceWeight: number;
}): SourceIndependenceVector {
  if (
    !Number.isFinite(input.unknownDependenceWeight) ||
    input.unknownDependenceWeight < 0 ||
    input.unknownDependenceWeight >= 1
  ) {
    throw new RangeError('unknownDependenceWeight must lie in [0,1)');
  }
  const credits: Record<string, number> = {};
  let unknownCount = 0;
  for (const source of [...input.sources].sort((a, b) => a.sourceId.localeCompare(b.sourceId))) {
    const state = ProviderDependenceStateSchema.parse(source.state);
    if (
      !Number.isFinite(source.effectiveIndependenceMultiplier) ||
      source.effectiveIndependenceMultiplier < 0 ||
      source.effectiveIndependenceMultiplier > 1
    ) {
      throw new RangeError('effectiveIndependenceMultiplier must lie in [0,1]');
    }
    const contemporaneousState = source.availableAtDecision ? state : 'UNKNOWN_DEPENDENCE';
    if (contemporaneousState === 'UNKNOWN_DEPENDENCE') unknownCount += 1;
    const weight =
      contemporaneousState === 'UNKNOWN_DEPENDENCE'
        ? Math.min(source.effectiveIndependenceMultiplier, input.unknownDependenceWeight)
        : source.effectiveIndependenceMultiplier;
    const group =
      contemporaneousState === 'SAME_UPSTREAM'
        ? `upstream:${source.upstreamGroupId ?? 'unknown'}`
        : `source:${source.sourceId}`;
    // SAME_UPSTREAM sources share one capped group credit, never additive credit.
    credits[group] = Math.min(1, Math.max(credits[group] ?? 0, weight));
  }
  const effectiveGroups = Object.values(credits).reduce((sum, credit) => sum + credit, 0);
  const knownFraction =
    input.sources.length === 0
      ? null
      : (input.sources.length - unknownCount) / input.sources.length;
  const qualityCodes: readonly Quality[] =
    unknownCount > 0 ? [QualityCode.SOURCE_DEPENDENCE_HIGH] : [QualityCode.VALID];
  const components = [
    vectorComponent(
      'effective_independent_groups',
      input.sources.length === 0 ? null : effectiveGroups,
      input.sources.length === 0 ? [QualityCode.MISSING_PROVIDER] : qualityCodes,
    ),
    vectorComponent(
      'known_dependence_fraction',
      knownFraction,
      knownFraction === null ? [QualityCode.MISSING_PROVIDER] : qualityCodes,
    ),
  ];
  buildIndependentVector('DATA_QUALITY', { ...input, components });
  return {
    kind: 'SOURCE_INDEPENDENCE',
    profileId: input.profileId,
    profileVersion: input.profileVersion,
    algorithmVersion: input.algorithmVersion,
    components,
    sourceGroupCredits: credits,
  };
}

/** The independent structure has no total/score field by design. */
export interface CandidateVectorSet {
  readonly opportunity: OpportunityVector;
  readonly risk: RiskVector;
  readonly dataQuality: DataQualityVector;
  readonly urgency: UrgencyVector;
  readonly novelty: NoveltyVector;
  readonly tradability: TradabilityVector;
  readonly sourceIndependence: SourceIndependenceVector;
}

export function unknownComponentsBlockFavorableComparison(vector: IndependentVector): boolean {
  return vector.components.some((component) => component.value === null);
}
