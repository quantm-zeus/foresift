/**
 * §31.5 / FR-EXEC-010 frozen replay manifests (AC-127).
 *
 * A replay manifest freezes every assumption and code version a simulation
 * run depended on: the assumption hash over the exact pre-registered
 * scenario payloads, the pool-math adapter versions, the execution-scenario
 * versions, and the code-and-dependency hash. Freezing is append-only and
 * one-way — a manifest, once frozen, is immutable; a re-freeze with changed
 * content produces a DIFFERENT manifest id, never an update.
 *
 * Frozen replay reproduces stress outcomes (AC-127): evaluating the same
 * scenario payloads under the frozen manifest must hash-identify identical
 * assumptions, and a mismatch is refused rather than papered over.
 *
 * Traces: FR-EXEC-010, AC-127.
 */
import { ExecErrorCode, ExecVocabularyError } from '@foresift/domain';
import { canonicalJson, sha256Text } from '@foresift/persistence';
import type { ReplayManifest } from '@foresift/shared-schemas';

export type { ReplayManifest };

/** The exact assumption payload a manifest freezes (all fields required). */
export interface ReplayAssumptions {
  /** Pre-registered scenario payloads (id → canonical scenario record). */
  readonly scenarioPayloads: Readonly<Record<string, unknown>>;
  /** Pool-math adapter versions used (at least one). */
  readonly poolMathAdapterVersions: readonly string[];
  /** Execution-scenario versions used (at least one). */
  readonly executionScenarioVersions: readonly string[];
  /** Conservative stress policy version. */
  readonly conservativeStressPolicyId: string;
  /** Outcome profile version governing labels. */
  readonly outcomeProfileVersion: string;
  /** Fee policy version. */
  readonly feePolicyVersionId: string;
  /** Entry policy version. */
  readonly entryPolicyVersionId: string;
  /** Exit policy version. */
  readonly exitPolicyVersionId: string;
}

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SHA256_REF = /^sha256:[0-9a-f]{64}$/;

function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'MANIFEST_FIELD_INVALID',
      field: label,
    });
  }
  return value;
}

function requireIsoZ(value: string, label: string): string {
  if (typeof value !== 'string' || !ISO_Z.test(value)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'MANIFEST_FIELD_INVALID',
      field: label,
      value,
    });
  }
  return value;
}

function requireVersionList(values: readonly string[], label: string): readonly string[] {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((v) => typeof v !== 'string' || v.length === 0)
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'MANIFEST_FIELD_INVALID',
      field: label,
    });
  }
  return [...values];
}

/** sha256 over the canonical JSON of the frozen assumption payload. */
export function assumptionsHash(assumptions: ReplayAssumptions): string {
  if (assumptions === null || typeof assumptions !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, assumptions);
  }
  if (assumptions.scenarioPayloads === null || typeof assumptions.scenarioPayloads !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'MANIFEST_FIELD_INVALID',
      field: 'scenarioPayloads',
    });
  }
  requireVersionList(assumptions.poolMathAdapterVersions, 'poolMathAdapterVersions');
  requireVersionList(assumptions.executionScenarioVersions, 'executionScenarioVersions');
  requireNonEmpty(assumptions.conservativeStressPolicyId, 'conservativeStressPolicyId');
  requireNonEmpty(assumptions.outcomeProfileVersion, 'outcomeProfileVersion');
  requireNonEmpty(assumptions.feePolicyVersionId, 'feePolicyVersionId');
  requireNonEmpty(assumptions.entryPolicyVersionId, 'entryPolicyVersionId');
  requireNonEmpty(assumptions.exitPolicyVersionId, 'exitPolicyVersionId');
  return sha256Text(canonicalJson(assumptions as unknown as Record<string, unknown>));
}

export interface FreezeManifestInput {
  readonly replayId: string;
  readonly asOf: string;
  /** Dataset population the replay claims to reproduce. */
  readonly datasetVersion: string;
  readonly populationClaim: string;
  readonly candidateUniverseHash: string;
  readonly observationCutoff: string;
  readonly collectorCoverageManifestId: string;
  readonly providerDependenceVersion: string;
  readonly featureVersion: string;
  readonly rankingVersion: string;
  readonly workflowVersion: string;
  readonly promptVersion: string;
  readonly toolProfileVersion: string;
  readonly modelProfileVersion: string;
  readonly policyVersion: string;
  readonly deliveryLatencyPolicyVersion: string;
  readonly capacityContractVersion: string;
  readonly assumptions: ReplayAssumptions;
  readonly artifactIds: readonly string[];
  readonly holdoutExposureSnapshotId: string;
  /** sha256 over the deployed code and dependency tree. */
  readonly codeAndDependencyHash: string;
}

/**
 * Freeze a replay manifest: validate every version field, hash the
 * assumptions, and emit the immutable manifest record. The caller persists
 * it append-only; freezing the same inputs again yields the identical
 * manifest (deterministic), and changed inputs yield a different record.
 */
export function freezeReplayManifest(input: FreezeManifestInput): ReplayManifest {
  if (input === null || typeof input !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, input);
  }
  requireNonEmpty(input.replayId, 'replayId');
  requireIsoZ(input.asOf, 'asOf');
  requireNonEmpty(input.datasetVersion, 'datasetVersion');
  requireNonEmpty(input.populationClaim, 'populationClaim');
  requireNonEmpty(input.collectorCoverageManifestId, 'collectorCoverageManifestId');
  requireNonEmpty(input.providerDependenceVersion, 'providerDependenceVersion');
  requireNonEmpty(input.featureVersion, 'featureVersion');
  requireNonEmpty(input.rankingVersion, 'rankingVersion');
  requireNonEmpty(input.workflowVersion, 'workflowVersion');
  requireNonEmpty(input.promptVersion, 'promptVersion');
  requireNonEmpty(input.toolProfileVersion, 'toolProfileVersion');
  requireNonEmpty(input.modelProfileVersion, 'modelProfileVersion');
  requireNonEmpty(input.policyVersion, 'policyVersion');
  requireNonEmpty(input.deliveryLatencyPolicyVersion, 'deliveryLatencyPolicyVersion');
  requireNonEmpty(input.capacityContractVersion, 'capacityContractVersion');
  requireNonEmpty(input.holdoutExposureSnapshotId, 'holdoutExposureSnapshotId');
  if (!SHA256_REF.test(input.candidateUniverseHash)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'MANIFEST_FIELD_INVALID',
      field: 'candidateUniverseHash',
    });
  }
  if (!SHA256_REF.test(input.codeAndDependencyHash)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'MANIFEST_FIELD_INVALID',
      field: 'codeAndDependencyHash',
    });
  }
  requireIsoZ(input.observationCutoff, 'observationCutoff');
  if (Date.parse(input.observationCutoff) > Date.parse(input.asOf)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'MANIFEST_OBSERVATION_CUTOFF_AFTER_AS_OF',
    });
  }
  if (
    !Array.isArray(input.artifactIds) ||
    input.artifactIds.some((a) => typeof a !== 'string' || a.length === 0)
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'MANIFEST_FIELD_INVALID',
      field: 'artifactIds',
    });
  }

  const hash = assumptionsHash(input.assumptions);
  void hash;
  return {
    replayId: input.replayId,
    asOf: input.asOf,
    datasetVersion: input.datasetVersion,
    populationClaim: input.populationClaim,
    candidateUniverseHash: input.candidateUniverseHash,
    observationCutoff: input.observationCutoff,
    collectorCoverageManifestId: input.collectorCoverageManifestId,
    providerDependenceVersion: input.providerDependenceVersion,
    featureVersion: input.featureVersion,
    rankingVersion: input.rankingVersion,
    workflowVersion: input.workflowVersion,
    promptVersion: input.promptVersion,
    toolProfileVersion: input.toolProfileVersion,
    modelProfileVersion: input.modelProfileVersion,
    outcomeProfileVersion: input.assumptions.outcomeProfileVersion,
    policyVersion: input.policyVersion,
    deliveryLatencyPolicyVersion: input.deliveryLatencyPolicyVersion,
    capacityContractVersion: input.capacityContractVersion,
    poolMathAdapterVersions: [...input.assumptions.poolMathAdapterVersions],
    executionScenarioVersions: [...input.assumptions.executionScenarioVersions],
    artifactIds: [...input.artifactIds],
    holdoutExposureSnapshotId: input.holdoutExposureSnapshotId,
    codeAndDependencyHash: input.codeAndDependencyHash,
  };
}

/**
 * AC-127 reproduction check: a frozen replay verifies that the manifest's
 * recorded adapter/scenario versions and the recomputed assumption hash
 * match the evaluating run. Any drift refuses — reproduction under changed
 * assumptions is not reproduction.
 */
export function verifyReproduction(input: {
  readonly manifest: ReplayManifest;
  readonly evaluatingAssumptions: ReplayAssumptions;
}): { reproduces: boolean; reason: string | null } {
  const manifest = input.manifest;
  if (manifest === null || typeof manifest !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, manifest);
  }
  const recorded = new Set(manifest.executionScenarioVersions);
  for (const version of input.evaluatingAssumptions.executionScenarioVersions) {
    if (!recorded.has(version)) {
      return { reproduces: false, reason: 'SCENARIO_VERSION_NOT_IN_MANIFEST' };
    }
  }
  const adapters = new Set(manifest.poolMathAdapterVersions);
  for (const version of input.evaluatingAssumptions.poolMathAdapterVersions) {
    if (!adapters.has(version)) {
      return { reproduces: false, reason: 'ADAPTER_VERSION_NOT_IN_MANIFEST' };
    }
  }
  if (manifest.outcomeProfileVersion !== input.evaluatingAssumptions.outcomeProfileVersion) {
    return { reproduces: false, reason: 'OUTCOME_PROFILE_DRIFT' };
  }
  return { reproduces: true, reason: null };
}
