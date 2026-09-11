import { isEdgeValidAtTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import {
  CoveragePopulationManifestSchema,
  RecallEstimateRecordSchema,
  type CoveragePopulationManifest,
  type DiscClaimBasis,
  type RecallEstimateRecord,
} from '@foresift/shared-schemas';
import { isClaimBasisAdmissible } from './claim-language.ts';
import {
  classifyRetrospectiveMiss,
  type RetrospectiveClassification,
  type RetrospectiveEvidence,
} from './retrospective-classifier.ts';

export interface RecallObservation {
  readonly subjectId: string;
  readonly discoveredByEvaluatedSource: boolean;
  readonly eligible?: boolean;
  readonly evidenceRefs?: readonly string[];
}

export interface RecallDependenceEdge {
  readonly edgeId: string;
  readonly sourceA: string;
  readonly sourceB: string;
  readonly validFrom: string;
  readonly validUntil?: string | null;
  readonly effectiveIndependenceMultiplier: number;
  readonly evidenceIds?: readonly string[];
}

export interface RecallEstimateInput {
  readonly estimateId: string;
  readonly manifest: CoveragePopulationManifest;
  readonly evaluatedSourceId: string;
  readonly claimBasis: DiscClaimBasis;
  readonly asOf: string;
  readonly observations: readonly RecallObservation[];
  readonly independenceEvidence: readonly string[];
  readonly constraintIds?: readonly string[];
  readonly dependenceEdges?: readonly RecallDependenceEdge[];
  readonly independentFirstPartyObservation?: boolean;
  readonly inclusionProbabilitySource?: string;
}

export interface RecallEstimateResult extends RecallEstimateRecord {
  readonly weightedPopulation: number;
  readonly weightedDiscovered: number;
}

function probabilitiesAreKnown(manifest: CoveragePopulationManifest): boolean {
  if (manifest.populationClass !== 'STRATIFIED_SAMPLED_UNIVERSE') return false;
  const probabilities = manifest.selectionProbabilities;
  return (
    probabilities !== undefined &&
    Object.keys(probabilities).length > 0 &&
    Object.values(probabilities).every(
      (probability) => Number.isFinite(probability) && probability > 0 && probability <= 1,
    )
  );
}

/** Resolve independence only from edges whose validity contains the estimate instant. */
export function resolveLineageIndependence(
  evaluatedSourceId: string,
  universeSourceIds: readonly string[],
  edges: readonly RecallDependenceEdge[],
  asOf: string,
): { readonly independent: boolean; readonly appliedEdgeIds: readonly string[] } {
  const universe = new Set(universeSourceIds);
  const applicable = edges.filter((edge) => {
    const connects =
      (edge.sourceA === evaluatedSourceId && universe.has(edge.sourceB)) ||
      (edge.sourceB === evaluatedSourceId && universe.has(edge.sourceA));
    return connects && isEdgeValidAtTimestamp(edge, asOf);
  });
  return {
    independent: applicable.every((edge) => edge.effectiveIndependenceMultiplier >= 1),
    appliedEdgeIds: applicable.map((edge) => edge.edgeId),
  };
}

/** Horvitz-Thompson totals collapse to an ordinary ratio for non-sampled populations. */
export function calculateRecall(
  manifest: CoveragePopulationManifest,
  observations: readonly RecallObservation[],
): {
  readonly recall: number | undefined;
  readonly weightedPopulation: number;
  readonly weightedDiscovered: number;
} {
  let weightedPopulation = 0;
  let weightedDiscovered = 0;
  for (const observation of observations) {
    if (observation.eligible === false) continue;
    const probability =
      manifest.populationClass === 'STRATIFIED_SAMPLED_UNIVERSE'
        ? manifest.selectionProbabilities?.[observation.subjectId]
        : 1;
    if (probability === undefined || probability <= 0 || probability > 1) continue;
    const weight = 1 / probability;
    weightedPopulation += weight;
    if (observation.discoveredByEvaluatedSource) weightedDiscovered += weight;
  }
  return {
    recall: weightedPopulation === 0 ? undefined : weightedDiscovered / weightedPopulation,
    weightedPopulation,
    weightedDiscovered,
  };
}

export function estimateRecall(input: RecallEstimateInput): RecallEstimateResult {
  const manifest = CoveragePopulationManifestSchema.parse(input.manifest);
  const selfRecall = manifest.sourceIds.includes(input.evaluatedSourceId);
  const lineage = resolveLineageIndependence(
    input.evaluatedSourceId,
    manifest.sourceIds,
    input.dependenceEdges ?? [],
    input.asOf,
  );
  const knownProbabilities = probabilitiesAreKnown(manifest);
  const evidence = {
    independentFirstPartyObservation: input.independentFirstPartyObservation === true,
    independentProviderLineage:
      !selfRecall && lineage.independent && input.independenceEvidence.length > 0,
    knownInclusionProbabilities: !selfRecall && knownProbabilities,
  };
  const admitted = isClaimBasisAdmissible(input.claimBasis, evidence);
  const totals = calculateRecall(manifest, input.observations);
  const verdict = selfRecall
    ? 'SELF_RECALL_REFUSED'
    : input.claimBasis === 'INDEPENDENT_PROVIDER_LINEAGE' && !lineage.independent
      ? 'DEPENDENT_DISCLOSED'
      : admitted && totals.recall !== undefined
        ? 'INDEPENDENT_ESTIMATE'
        : 'NO_ADMISSIBLE_BASIS';
  const record = RecallEstimateRecordSchema.parse({
    estimateId: input.estimateId,
    manifestId: manifest.manifestId,
    evaluatedSourceId: input.evaluatedSourceId,
    claimBasis: input.claimBasis,
    verdict,
    ...(verdict === 'INDEPENDENT_ESTIMATE' ? { recallEstimate: totals.recall } : {}),
    ...(input.inclusionProbabilitySource === undefined
      ? {}
      : { inclusionProbabilitySource: input.inclusionProbabilitySource }),
    independenceEvidence: [...new Set([...input.independenceEvidence, ...lineage.appliedEdgeIds])],
    constraintIds: [...(input.constraintIds ?? [])],
    asOf: input.asOf,
  });
  return {
    ...record,
    weightedPopulation: totals.weightedPopulation,
    weightedDiscovered: totals.weightedDiscovered,
  };
}

export function classifyWeightedRetrospectiveMiss(
  evidence: RetrospectiveEvidence,
  inclusionProbability?: number,
): RetrospectiveClassification & { readonly inclusionWeight?: number } {
  const classification = classifyRetrospectiveMiss(evidence);
  const validProbability =
    inclusionProbability === undefined ||
    (Number.isFinite(inclusionProbability) &&
      inclusionProbability > 0 &&
      inclusionProbability <= 1);
  if (!validProbability) return { ...classification, classification: 'INELIGIBLE' };
  return inclusionProbability === undefined
    ? classification
    : { ...classification, inclusionWeight: 1 / inclusionProbability };
}

export class RecallEstimator {
  constructor(private readonly engine: DatabaseEngine) {}

  async estimate(input: RecallEstimateInput): Promise<RecallEstimateResult> {
    const result = estimateRecall(input);
    await this.engine.query(
      `INSERT INTO disc.recall_estimates (
         estimate_id,manifest_id,evaluated_source_id,claim_basis,verdict,recall_estimate,
         inclusion_probability_source,independence_evidence,constraint_ids,as_of)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (estimate_id) DO NOTHING`,
      [
        result.estimateId,
        result.manifestId,
        result.evaluatedSourceId,
        result.claimBasis,
        result.verdict,
        result.recallEstimate ?? null,
        result.inclusionProbabilitySource ?? null,
        [...result.independenceEvidence],
        [...result.constraintIds],
        result.asOf,
      ],
    );
    return result;
  }

  persist(input: RecallEstimateInput): Promise<RecallEstimateResult> {
    return this.estimate(input);
  }
}

export const computeRecallEstimate = estimateRecall;
export const horvitzThompsonRecall = calculateRecall;
