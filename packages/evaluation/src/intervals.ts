/** Cluster/block bootstrap and effective independent sample size (FR-MAT-005). */
import { ErrorCode, EvalError, essGate, type ClusterDefinition, type IntervalMethod } from '@foresift/domain';

export interface ClusteredObservation {
  readonly stableId: string;
  readonly clusterId: string;
  readonly value: number;
}

export interface ClusteredInterval {
  readonly pointEstimate: number;
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly naiveSampleSize: number;
  readonly clusterCount: number;
  readonly effectiveIndependentSampleSize: number;
  readonly clusterDefinition: ClusterDefinition;
  readonly intervalMethod: IntervalMethod;
  readonly alternateClusterSensitivity: Readonly<Record<string, number>>;
  readonly essGatePassed: boolean;
  readonly promotionEligible: boolean;
}

function seeded(seed: string): () => number {
  let state = 0;
  for (const char of seed) state = (Math.imul(state, 31) + char.charCodeAt(0)) >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4_294_967_296);
}

const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

export function computeClusteredInterval(input: {
  readonly observations: readonly ClusteredObservation[];
  readonly clusterDefinition: ClusterDefinition;
  readonly intervalMethod: IntervalMethod;
  readonly minimumEffectiveSampleSize: number;
  readonly seedProvenance: string;
  readonly iterations?: number;
  readonly alternateClusterSensitivity?: Readonly<Record<string, number>>;
}): ClusteredInterval {
  if (input.observations.length === 0)
    throw new EvalError('clustered interval requires observations', {}, ErrorCode.EVAL_ESS_BELOW_GATE);
  const clusters = new Map<string, number[]>();
  for (const observation of input.observations) {
    if (!Number.isFinite(observation.value) || !observation.clusterId)
      throw new EvalError('invalid clustered observation', { stableId: observation.stableId }, ErrorCode.EVAL_ESS_BELOW_GATE);
    const values = clusters.get(observation.clusterId) ?? [];
    values.push(observation.value);
    clusters.set(observation.clusterId, values);
  }
  const clusterMeans = [...clusters.values()].map(mean);
  const sizes = [...clusters.values()].map((values) => values.length);
  const effectiveIndependentSampleSize = Math.min(
    input.observations.length,
    (sizes.reduce((sum, value) => sum + value, 0) ** 2) /
      sizes.reduce((sum, value) => sum + value * value, 0),
  );
  const iterations = input.iterations ?? 1000;
  const random = seeded(input.seedProvenance);
  const samples: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const draw = Array.from({ length: clusterMeans.length }, () => clusterMeans[Math.floor(random() * clusterMeans.length)]!);
    samples.push(mean(draw));
  }
  samples.sort((left, right) => left - right);
  const quantile = (probability: number): number => samples[Math.min(samples.length - 1, Math.floor(probability * samples.length))]!;
  const passed = essGate(effectiveIndependentSampleSize, input.minimumEffectiveSampleSize);
  return Object.freeze({
    pointEstimate: mean(input.observations.map((observation) => observation.value)),
    lowerBound: quantile(0.025),
    upperBound: quantile(0.975),
    naiveSampleSize: input.observations.length,
    clusterCount: clusters.size,
    effectiveIndependentSampleSize,
    clusterDefinition: input.clusterDefinition,
    intervalMethod: input.intervalMethod,
    alternateClusterSensitivity: Object.freeze({ ...(input.alternateClusterSensitivity ?? {}) }),
    essGatePassed: passed,
    promotionEligible: passed,
  });
}
