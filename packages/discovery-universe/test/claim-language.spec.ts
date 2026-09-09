/**
 * Claim-language admission and refusal contracts (FR-DISC-006, FR-DISC-010, FR-DISC-014).
 * Prohibits full-market, all-Solana, or universal-recall claims unless exact contract establishes it.
 */
import { describe, expect, it } from 'bun:test';
import { DiscError } from '@foresift/domain';
import {
  isClaimBasisAdmissible,
  admitClaimBasis,
  admitStructuredDiscoveryClaim,
  DISC_CLAIM_BASES,
  DISC_SCOPE_ADJECTIVES,
  type StructuredDiscoveryClaim,
  type ClaimBasisEvidence,
  type ClaimLanguageRefusalRecord,
} from '../src/claim-language.ts';
import type { CoveragePopulationManifest } from '@foresift/shared-schemas';

describe('Claim Basis Vocabulary & Admission (FR-DISC-010)', () => {
  it('exposes the closed claim basis vocabulary', () => {
    expect(DISC_CLAIM_BASES).toEqual([
      'INDEPENDENT_FIRST_PARTY_OBSERVATION',
      'INDEPENDENT_PROVIDER_LINEAGE',
      'KNOWN_INCLUSION_PROBABILITIES',
    ]);
  });

  it('evaluates admissible claim basis evidence', () => {
    expect(
      isClaimBasisAdmissible('INDEPENDENT_FIRST_PARTY_OBSERVATION', {
        independentFirstPartyObservation: true,
      }),
    ).toBe(true);

    expect(
      isClaimBasisAdmissible('INDEPENDENT_FIRST_PARTY_OBSERVATION', {
        independentFirstPartyObservation: false,
      }),
    ).toBe(false);

    expect(
      isClaimBasisAdmissible('INDEPENDENT_PROVIDER_LINEAGE', {
        independentProviderLineage: true,
      }),
    ).toBe(true);

    expect(
      isClaimBasisAdmissible('KNOWN_INCLUSION_PROBABILITIES', {
        knownInclusionProbabilities: true,
      }),
    ).toBe(true);
  });

  it('admits valid claim basis and throws on invalid / unbacked basis', () => {
    const admitted = admitClaimBasis('INDEPENDENT_FIRST_PARTY_OBSERVATION', {
      independentFirstPartyObservation: true,
    });
    expect(admitted).toBe('INDEPENDENT_FIRST_PARTY_OBSERVATION');

    // Unknown basis outside closed vocabulary
    expect(() => admitClaimBasis('AI_HALLUCINATED_BASIS', {})).toThrow(DiscError);

    // Known basis without supporting evidence
    expect(() =>
      admitClaimBasis('INDEPENDENT_FIRST_PARTY_OBSERVATION', {
        independentFirstPartyObservation: false,
      }),
    ).toThrow(DiscError);
  });
});

describe('Structured Discovery Claim Refusal Matrix (FR-DISC-014)', () => {
  it('exposes the strong scope adjective vocabulary', () => {
    expect(DISC_SCOPE_ADJECTIVES).toEqual(['FULL_MARKET', 'ALL_SOLANA', 'UNIVERSAL_RECALL']);
  });

  const validManifest: CoveragePopulationManifest = {
    manifestId: 'man_valid_001',
    populationClass: 'STRATIFIED_SAMPLED_UNIVERSE',
    sourceIds: ['src_archive_indexer'],
    collectorScopeIds: ['col_solana_live'],
    startSlot: '1000',
    endSlot: '2000',
    startTime: '2026-08-20T10:00:00Z',
    endTime: '2026-08-20T12:00:00Z',
    knownGapsCount: 0,
    rightsExclusions: [],
    sourceDependenceDisclosed: true,
    selectionProbabilities: {
      item_1: 0.5,
      item_2: 0.5,
    },
  };

  const validClaim: StructuredDiscoveryClaim = {
    claimId: 'claim_001',
    manifestId: 'man_valid_001',
    scopeAdjective: 'FULL_MARKET',
    samplingContract: {
      contractId: 'contract_001',
      populationClass: 'STRATIFIED_SAMPLED_UNIVERSE',
      targetScope: 'FULL_MARKET',
      exhaustive: true,
      eligibleSubjectIds: ['item_1', 'item_2'],
      selectionProbabilities: {
        item_1: 0.5,
        item_2: 0.5,
      },
    },
    claimBasis: 'KNOWN_INCLUSION_PROBABILITIES',
    madeAt: '2026-08-20T12:00:00Z',
  };

  const validEvidence: ClaimBasisEvidence = {
    knownInclusionProbabilities: true,
  };

  it('admits a structured discovery claim when all conditions are met', () => {
    const admitted = admitStructuredDiscoveryClaim(validClaim, validManifest, validEvidence);
    expect(admitted.admitted).toBe(true);
    expect(admitted.populationClass).toBe('STRATIFIED_SAMPLED_UNIVERSE');
  });

  it('refuses claim on manifest mismatch', () => {
    const refusals: ClaimLanguageRefusalRecord[] = [];
    const mismatchedClaim = { ...validClaim, manifestId: 'man_other_999' };

    expect(() =>
      admitStructuredDiscoveryClaim(mismatchedClaim, validManifest, validEvidence, (r) =>
        refusals.push(r),
      ),
    ).toThrow(DiscError);

    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.reason).toBe('MANIFEST_MISMATCH');
  });

  it('refuses claim on population class mismatch', () => {
    const refusals: ClaimLanguageRefusalRecord[] = [];
    const badContractClaim: StructuredDiscoveryClaim = {
      ...validClaim,
      samplingContract: {
        ...validClaim.samplingContract,
        populationClass: 'SUPPORTED_PROGRAM_UNIVERSE' as any,
      },
    };

    expect(() =>
      admitStructuredDiscoveryClaim(badContractClaim, validManifest, validEvidence, (r) =>
        refusals.push(r),
      ),
    ).toThrow(DiscError);

    expect(refusals[0]?.reason).toBe('POPULATION_CLASS_MISMATCH');
  });

  it('refuses claim on scope contract mismatch', () => {
    const refusals: ClaimLanguageRefusalRecord[] = [];
    const mismatchedScope: StructuredDiscoveryClaim = {
      ...validClaim,
      scopeAdjective: 'ALL_SOLANA',
      samplingContract: {
        ...validClaim.samplingContract,
        targetScope: 'FULL_MARKET',
      },
    };

    expect(() =>
      admitStructuredDiscoveryClaim(mismatchedScope, validManifest, validEvidence, (r) =>
        refusals.push(r),
      ),
    ).toThrow(DiscError);

    expect(refusals[0]?.reason).toBe('SCOPE_CONTRACT_MISMATCH');
  });

  it('refuses claim on non-exhaustive sampling contract', () => {
    const refusals: ClaimLanguageRefusalRecord[] = [];
    const nonExhaustiveClaim: StructuredDiscoveryClaim = {
      ...validClaim,
      samplingContract: {
        ...validClaim.samplingContract,
        exhaustive: false as any,
      },
    };

    expect(() =>
      admitStructuredDiscoveryClaim(nonExhaustiveClaim, validManifest, validEvidence, (r) =>
        refusals.push(r),
      ),
    ).toThrow(DiscError);

    expect(refusals[0]?.reason).toBe('NON_EXHAUSTIVE_SAMPLING_CONTRACT');
  });

  it('refuses claim on incomplete selection probabilities', () => {
    const refusals: ClaimLanguageRefusalRecord[] = [];
    const incompleteProbabilitiesClaim: StructuredDiscoveryClaim = {
      ...validClaim,
      samplingContract: {
        ...validClaim.samplingContract,
        eligibleSubjectIds: ['item_1', 'item_2', 'item_3_missing'],
      },
    };

    expect(() =>
      admitStructuredDiscoveryClaim(
        incompleteProbabilitiesClaim,
        validManifest,
        validEvidence,
        (r) => refusals.push(r),
      ),
    ).toThrow(DiscError);

    expect(refusals[0]?.reason).toBe('SELECTION_PROBABILITIES_INCOMPLETE');
  });

  it('refuses claim when population has known collector gaps', () => {
    const refusals: ClaimLanguageRefusalRecord[] = [];
    const gappedManifest = { ...validManifest, knownGapsCount: 2 };

    expect(() =>
      admitStructuredDiscoveryClaim(validClaim, gappedManifest, validEvidence, (r) =>
        refusals.push(r),
      ),
    ).toThrow(DiscError);

    expect(refusals[0]?.reason).toBe('POPULATION_HAS_KNOWN_GAPS');
  });

  it('refuses claim when population has rights exclusions', () => {
    const refusals: ClaimLanguageRefusalRecord[] = [];
    const rightsExcludedManifest = { ...validManifest, rightsExclusions: ['src_unlicensed'] };

    expect(() =>
      admitStructuredDiscoveryClaim(validClaim, rightsExcludedManifest, validEvidence, (r) =>
        refusals.push(r),
      ),
    ).toThrow(DiscError);

    expect(refusals[0]?.reason).toBe('POPULATION_HAS_RIGHTS_EXCLUSIONS');
  });

  it('refuses claim when source dependence is undisclosed', () => {
    const refusals: ClaimLanguageRefusalRecord[] = [];
    const undisclosedManifest = { ...validManifest, sourceDependenceDisclosed: false };

    expect(() =>
      admitStructuredDiscoveryClaim(validClaim, undisclosedManifest, validEvidence, (r) =>
        refusals.push(r),
      ),
    ).toThrow(DiscError);

    expect(refusals[0]?.reason).toBe('SOURCE_DEPENDENCE_UNDISCLOSED');
  });

  it('refuses claim when claim basis lacks evidence', () => {
    const refusals: ClaimLanguageRefusalRecord[] = [];
    const noEvidence: ClaimBasisEvidence = { knownInclusionProbabilities: false };

    expect(() =>
      admitStructuredDiscoveryClaim(validClaim, validManifest, noEvidence, (r) => refusals.push(r)),
    ).toThrow(DiscError);

    expect(refusals[0]?.reason).toBe('CLAIM_BASIS_INADMISSIBLE');
  });
});
