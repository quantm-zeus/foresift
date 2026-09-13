/**
 * Canonical distribution-authorization fixtures (T033, FR-PROD-002/004,
 * AC-272/273/275/276/277; PRD §69.9).
 *
 * Inert typed gate-evidence claims for an exact release: the full evidence set,
 * a missing gate kind, a scope mismatch, a revoked record, and the honest
 * technically-ready-but-unauthorized position.
 */
import type {
  DistributionAuthorizationClaim,
  DistributionGateEvidenceClaim,
} from '@foresift/release-conformance';

export const PROD_RELEASE_REF = 'release://foresift/prod/v1';
export const PROD_FOREIGN_RELEASE_REF = 'release://foresift/prod/v0';

/** The gate kinds workspace/public authorization requires for the exact release. */
export const PROD_DISTRIBUTION_REQUIRED_GATES: readonly string[] = [
  'RIGHTS',
  'MANUAL',
  'OWNER_APPROVAL',
];

function evidence(
  gateKind: string,
  overrides: Partial<DistributionGateEvidenceClaim> = {},
): DistributionGateEvidenceClaim {
  return {
    evidenceId: `evidence-${gateKind.toLowerCase()}`,
    gateKind,
    scopeRefs: [PROD_RELEASE_REF],
    revokedAt: null,
    valid: true,
    ...overrides,
  };
}

/** Every required gate kind carries valid, unrevoked, exact-release evidence. */
export const PROD_DISTRIBUTION_EVIDENCE_COMPLETE: readonly DistributionGateEvidenceClaim[] =
  PROD_DISTRIBUTION_REQUIRED_GATES.map((gateKind) => evidence(gateKind));

/** The RIGHTS gate evidence is simply absent. */
export const PROD_DISTRIBUTION_EVIDENCE_MISSING: readonly DistributionGateEvidenceClaim[] =
  PROD_DISTRIBUTION_REQUIRED_GATES.filter((gateKind) => gateKind !== 'RIGHTS').map((gateKind) =>
    evidence(gateKind),
  );

/** The RIGHTS evidence exists but is scoped to a different release. */
export const PROD_DISTRIBUTION_EVIDENCE_WRONG_SCOPE: readonly DistributionGateEvidenceClaim[] =
  PROD_DISTRIBUTION_REQUIRED_GATES.map((gateKind) =>
    gateKind === 'RIGHTS'
      ? evidence(gateKind, { scopeRefs: [PROD_FOREIGN_RELEASE_REF] })
      : evidence(gateKind),
  );

/** The RIGHTS evidence was revoked. */
export const PROD_DISTRIBUTION_EVIDENCE_REVOKED: readonly DistributionGateEvidenceClaim[] =
  PROD_DISTRIBUTION_REQUIRED_GATES.map((gateKind) =>
    gateKind === 'RIGHTS'
      ? evidence(gateKind, { revokedAt: '2026-05-01T00:00:00Z', valid: false })
      : evidence(gateKind),
  );

/** Compliant workspace authorization with the full evidence set. */
export const PROD_WORKSPACE_AUTHORIZED_CLAIM: DistributionAuthorizationClaim = {
  releaseRef: PROD_RELEASE_REF,
  distributionReadiness: 'WORKSPACE_AUTHORIZED',
  requiredGateKinds: PROD_DISTRIBUTION_REQUIRED_GATES,
  gateEvidence: PROD_DISTRIBUTION_EVIDENCE_COMPLETE,
};

/** Public authorization claiming a missing gate kind. */
export const PROD_PUBLIC_AUTHORIZED_MISSING_CLAIM: DistributionAuthorizationClaim = {
  ...PROD_WORKSPACE_AUTHORIZED_CLAIM,
  distributionReadiness: 'PUBLIC_AUTHORIZED',
  gateEvidence: PROD_DISTRIBUTION_EVIDENCE_MISSING,
};

/** Public authorization whose only rights evidence is foreign-scoped. */
export const PROD_PUBLIC_AUTHORIZED_WRONG_SCOPE_CLAIM: DistributionAuthorizationClaim = {
  ...PROD_WORKSPACE_AUTHORIZED_CLAIM,
  distributionReadiness: 'PUBLIC_AUTHORIZED',
  gateEvidence: PROD_DISTRIBUTION_EVIDENCE_WRONG_SCOPE,
};

/** Public authorization whose rights evidence was revoked. */
export const PROD_PUBLIC_AUTHORIZED_REVOKED_CLAIM: DistributionAuthorizationClaim = {
  ...PROD_WORKSPACE_AUTHORIZED_CLAIM,
  distributionReadiness: 'PUBLIC_AUTHORIZED',
  gateEvidence: PROD_DISTRIBUTION_EVIDENCE_REVOKED,
};

/** Honest technically-ready position: never authorized without evidence. */
export const PROD_TECHNICALLY_READY_CLAIM: DistributionAuthorizationClaim = {
  releaseRef: PROD_RELEASE_REF,
  distributionReadiness: 'WORKSPACE_TECHNICALLY_READY',
  requiredGateKinds: PROD_DISTRIBUTION_REQUIRED_GATES,
  gateEvidence: [],
};

export const PROD_DISTRIBUTION_CLAIMS: readonly DistributionAuthorizationClaim[] = [
  PROD_WORKSPACE_AUTHORIZED_CLAIM,
  PROD_PUBLIC_AUTHORIZED_MISSING_CLAIM,
  PROD_PUBLIC_AUTHORIZED_WRONG_SCOPE_CLAIM,
  PROD_PUBLIC_AUTHORIZED_REVOKED_CLAIM,
  PROD_TECHNICALLY_READY_CLAIM,
];
