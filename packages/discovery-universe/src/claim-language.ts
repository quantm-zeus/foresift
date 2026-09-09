import { DiscError, ErrorCode } from '@foresift/domain';
import { DiscClaimBasisSchema, type DiscClaimBasis } from '@foresift/shared-schemas';

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
