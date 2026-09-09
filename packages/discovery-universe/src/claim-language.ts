import { DiscError, ErrorCode } from '@foresift/domain';
import {
  CoveragePopulationManifestSchema,
  DiscClaimBasisSchema,
  type CoveragePopulationManifest,
  type DiscClaimBasis,
} from '@foresift/shared-schemas';

export const DISC_CLAIM_BASES = DiscClaimBasisSchema.options;

export interface ClaimBasisEvidence {
  readonly independentFirstPartyObservation?: boolean;
  readonly independentProviderLineage?: boolean;
  readonly knownInclusionProbabilities?: boolean;
}

/** The exhaustive, closed admission law used by every coverage claim. */
export function isClaimBasisAdmissible(
  basis: DiscClaimBasis,
  evidence: ClaimBasisEvidence,
): boolean {
  switch (basis) {
    case 'INDEPENDENT_FIRST_PARTY_OBSERVATION':
      return evidence.independentFirstPartyObservation === true;
    case 'INDEPENDENT_PROVIDER_LINEAGE':
      return evidence.independentProviderLineage === true;
    case 'KNOWN_INCLUSION_PROBABILITIES':
      return evidence.knownInclusionProbabilities === true;
  }
}

export function admitClaimBasis(value: unknown, evidence: ClaimBasisEvidence): DiscClaimBasis {
  const parsed = DiscClaimBasisSchema.safeParse(value);
  if (!parsed.success) {
    throw new DiscError(
      'coverage claim basis is outside the closed vocabulary',
      {},
      ErrorCode.DISC_CLAIM_BASIS_UNKNOWN,
    );
  }
  if (!isClaimBasisAdmissible(parsed.data, evidence)) {
    throw new DiscError(
      'coverage claim lacks evidence required by its declared basis',
      { claimBasis: parsed.data },
      ErrorCode.DISC_CLAIM_LANGUAGE_REFUSED,
    );
  }
  return parsed.data;
}

export const claimBasisAdmissible = isClaimBasisAdmissible;

export const DISC_SCOPE_ADJECTIVES = ['FULL_MARKET', 'ALL_SOLANA', 'UNIVERSAL_RECALL'] as const;
export type DiscScopeAdjective = (typeof DISC_SCOPE_ADJECTIVES)[number];

export interface ClaimSamplingContract {
  readonly contractId: string;
  readonly populationClass: CoveragePopulationManifest['populationClass'];
  readonly targetScope: DiscScopeAdjective;
  readonly exhaustive: true;
  readonly eligibleSubjectIds: readonly string[];
  readonly selectionProbabilities: Readonly<Record<string, number>>;
}

export interface StructuredDiscoveryClaim {
  readonly claimId: string;
  readonly manifestId: string;
  readonly scopeAdjective: DiscScopeAdjective;
  readonly samplingContract: ClaimSamplingContract;
  readonly claimBasis: DiscClaimBasis;
  readonly madeAt: string;
}

export type ClaimLanguageRefusalReason =
  | 'MANIFEST_MISMATCH'
  | 'POPULATION_CLASS_MISMATCH'
  | 'SCOPE_CONTRACT_MISMATCH'
  | 'NON_EXHAUSTIVE_SAMPLING_CONTRACT'
  | 'SELECTION_PROBABILITIES_INCOMPLETE'
  | 'SELECTION_PROBABILITIES_MISMATCH'
  | 'POPULATION_HAS_KNOWN_GAPS'
  | 'POPULATION_HAS_RIGHTS_EXCLUSIONS'
  | 'SOURCE_DEPENDENCE_UNDISCLOSED'
  | 'CLAIM_BASIS_INADMISSIBLE';

export interface ClaimLanguageRefusalRecord {
  readonly eventName: 'disc.claim_language_refused';
  readonly claimId: string;
  readonly manifestId: string;
  readonly scopeAdjective: DiscScopeAdjective;
  readonly populationClass: CoveragePopulationManifest['populationClass'];
  readonly reason: ClaimLanguageRefusalReason;
  readonly refusedAt: string;
}

export type ClaimLanguageRefusalRecorder = (record: ClaimLanguageRefusalRecord) => void;

export interface AdmittedDiscoveryClaim extends StructuredDiscoveryClaim {
  readonly admitted: true;
  readonly populationClass: CoveragePopulationManifest['populationClass'];
}

function refuseClaimLanguage(
  claim: StructuredDiscoveryClaim,
  manifest: CoveragePopulationManifest,
  reason: ClaimLanguageRefusalReason,
  recordRefusal?: ClaimLanguageRefusalRecorder,
): never {
  recordRefusal?.({
    eventName: 'disc.claim_language_refused',
    claimId: claim.claimId,
    manifestId: claim.manifestId,
    scopeAdjective: claim.scopeAdjective,
    populationClass: manifest.populationClass,
    reason,
    refusedAt: claim.madeAt,
  });
  throw new DiscError(
    'scope adjective is not established by the cited population and sampling contract',
    { claimId: claim.claimId, manifestId: claim.manifestId, reason },
    ErrorCode.DISC_CLAIM_LANGUAGE_REFUSED,
  );
}

function probabilityMapIsExhaustive(
  subjectIds: readonly string[],
  probabilities: Readonly<Record<string, number>>,
): boolean {
  if (subjectIds.length === 0 || new Set(subjectIds).size !== subjectIds.length) return false;
  const keys = Object.keys(probabilities);
  return (
    keys.length === subjectIds.length &&
    subjectIds.every((subjectId) => {
      const probability = probabilities[subjectId];
      return (
        probability !== undefined &&
        Number.isFinite(probability) &&
        probability > 0 &&
        probability <= 1
      );
    })
  );
}

function probabilityMapsMatch(
  expected: Readonly<Record<string, number>>,
  actual: Readonly<Record<string, number>>,
): boolean {
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  return (
    expectedKeys.length === actualKeys.length &&
    expectedKeys.every((key, index) => key === actualKeys[index] && expected[key] === actual[key])
  );
}

/**
 * Admit strong market-wide language only when the separately stored manifest
 * and sampling contract establish exactly the scope named by the claim.
 */
export function admitStructuredDiscoveryClaim(
  claim: StructuredDiscoveryClaim,
  manifestInput: unknown,
  basisEvidence: ClaimBasisEvidence,
  recordRefusal?: ClaimLanguageRefusalRecorder,
): AdmittedDiscoveryClaim {
  const manifest = CoveragePopulationManifestSchema.parse(manifestInput);
  if (claim.manifestId !== manifest.manifestId) {
    refuseClaimLanguage(claim, manifest, 'MANIFEST_MISMATCH', recordRefusal);
  }
  if (claim.samplingContract.populationClass !== manifest.populationClass) {
    refuseClaimLanguage(claim, manifest, 'POPULATION_CLASS_MISMATCH', recordRefusal);
  }
  if (claim.samplingContract.targetScope !== claim.scopeAdjective) {
    refuseClaimLanguage(claim, manifest, 'SCOPE_CONTRACT_MISMATCH', recordRefusal);
  }
  if (
    !['PROSPECTIVELY_OBSERVED_UNIVERSE', 'STRATIFIED_SAMPLED_UNIVERSE'].includes(
      manifest.populationClass,
    )
  ) {
    refuseClaimLanguage(claim, manifest, 'SCOPE_CONTRACT_MISMATCH', recordRefusal);
  }
  if (claim.samplingContract.exhaustive !== true) {
    refuseClaimLanguage(claim, manifest, 'NON_EXHAUSTIVE_SAMPLING_CONTRACT', recordRefusal);
  }
  if (
    !probabilityMapIsExhaustive(
      claim.samplingContract.eligibleSubjectIds,
      claim.samplingContract.selectionProbabilities,
    )
  ) {
    refuseClaimLanguage(claim, manifest, 'SELECTION_PROBABILITIES_INCOMPLETE', recordRefusal);
  }
  if (
    manifest.selectionProbabilities === undefined ||
    !probabilityMapsMatch(
      claim.samplingContract.selectionProbabilities,
      manifest.selectionProbabilities,
    )
  ) {
    refuseClaimLanguage(claim, manifest, 'SELECTION_PROBABILITIES_MISMATCH', recordRefusal);
  }
  if (manifest.knownGapsCount > 0) {
    refuseClaimLanguage(claim, manifest, 'POPULATION_HAS_KNOWN_GAPS', recordRefusal);
  }
  if (manifest.rightsExclusions.length > 0) {
    refuseClaimLanguage(claim, manifest, 'POPULATION_HAS_RIGHTS_EXCLUSIONS', recordRefusal);
  }
  if (!manifest.sourceDependenceDisclosed) {
    refuseClaimLanguage(claim, manifest, 'SOURCE_DEPENDENCE_UNDISCLOSED', recordRefusal);
  }
  if (!isClaimBasisAdmissible(claim.claimBasis, basisEvidence)) {
    refuseClaimLanguage(claim, manifest, 'CLAIM_BASIS_INADMISSIBLE', recordRefusal);
  }
  return { ...claim, admitted: true, populationClass: manifest.populationClass };
}

export const evaluateClaimLanguage = admitStructuredDiscoveryClaim;
