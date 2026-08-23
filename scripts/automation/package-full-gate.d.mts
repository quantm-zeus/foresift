export declare const ATTESTATION_FILE: 'full-gate-attestation.json';

export interface AttestationIdentity {
  schema: 'foresift/full-gate-attestation@1';
  headSha: string;
  packageId: string;
  risk: string;
  profile: 'LEGACY' | 'OPTIMIZED';
  pnpmLockHash: string | null;
  authorityHashes: {
    prdManifest: string | null;
    currentMilestone: string | null;
    roadmap: string | null;
  };
  gateImplementationHashes: {
    gate: string;
    schema: string;
    runner: string;
  };
  toolchain: Record<string, string>;
}

export declare function attestationIdentity(input: {
  packageId: string;
  repoRoot: string;
}): AttestationIdentity;

/** null = identities match (reuse allowed); otherwise the drifted field paths. */
export declare function attestationDrift(
  attested: Partial<AttestationIdentity> | Record<string, unknown>,
  current: AttestationIdentity,
): string[] | null;
