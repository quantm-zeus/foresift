export declare const ATTESTATION_FILE: 'full-gate-attestation.json';
export declare const GATE_RESULT_FILE: 'full-gate-result.json';

export interface FullGateResult {
  schema: 'foresift/full-gate-result@1';
  packageId: string | null;
  passed: boolean;
  exitCode: number;
  failedCategories: string[];
  checks: {
    label: string;
    category: string;
    command: string;
    status: 'PASS' | 'FAIL';
  }[];
  synthesizedByRunner?: boolean;
  startedAt?: string;
  timestamp?: string;
}

export declare function parseFullGateResult(raw: unknown): FullGateResult | null;

export interface AttestationIdentity {
  schema: 'foresift/full-gate-attestation@1';
  headSha: string;
  /** V3-D §11: origin/main tip (local remote-tracking view) at gate time. */
  baseMainSha: string | null;
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
  /** V3-D §11 test hook: resolve the origin/main base sha without network. */
  resolveBaseMain?: () => string | null;
}): AttestationIdentity;
export declare function attestationDrift(
  attested: unknown,
  current: AttestationIdentity,
): string[] | null;
