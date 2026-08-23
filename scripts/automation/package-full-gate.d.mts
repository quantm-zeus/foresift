export declare const ATTESTATION_FILE: 'full-gate-attestation.json';

export interface AttestationIdentity {
  schema: 'foresift/full-gate-attestation@1';
  headSha: string;
  packageId: string;
  risk: string;
  profile: 'LEGACY' | 'OPTIMIZED';
  pnpmLockHash: string | null;
  authorityHashes: Record<string, string | null>;
  gateImplementationHashes: Record<string, string>;
  toolchain: Record<string, string>;
}

export declare function attestationIdentity(opts: {
  packageId: string;
  repoRoot?: string;
}): AttestationIdentity;
export declare function attestationDrift(
  attested: unknown,
  current: AttestationIdentity,
): string[] | null;
