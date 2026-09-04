import { SecuritySeverity } from '@foresift/domain';

/** Appendix Q.1 policy identity. Persist this beside every derived severity. */
export const SOLANA_SECURITY_SEVERITY_POLICY_VERSION = 'solsec-severity-q1@1';
export const SEVERITY_POLICY_VERSION = SOLANA_SECURITY_SEVERITY_POLICY_VERSION;

export type DeterministicSecurityFindingKind =
  | 'NON_TRANSFERABLE_EXIT_BLOCKED'
  | 'TRANSFER_HOOK_EXIT_BLOCKED'
  | 'MALICIOUS_PROGRAM_OWNER'
  | 'ACTIVE_AUTHORITY_OBSERVED_ABUSE'
  | 'LIQUIDITY_UNUSABLE'
  | 'LIQUIDITY_WITHDRAWABLE'
  | 'FREEZE_AUTHORITY'
  | 'PERMANENT_DELEGATE'
  | 'UNKNOWN_REQUIRED_EXTENSION'
  | 'ADMINISTRATIVE_AUTHORITY'
  | 'INCOMPLETE_COVERAGE'
  | 'LOW_RISK_CONFIGURATION'
  | 'NEUTRAL_CONFIGURATION';

export type AuthorityStatus = 'ACTIVE' | 'REVOKED' | 'UNKNOWN';
export type AuthorityHolder =
  | 'CREATOR'
  | 'CONCENTRATED_CREATOR_CONTROL'
  | 'DISTRIBUTED_GOVERNANCE'
  | 'KNOWN_SYSTEM_PROGRAM'
  | 'UNKNOWN';
export type RevocationAbility = 'REVOCABLE' | 'IRREVOCABLE' | 'UNKNOWN';

/**
 * Evidence needed to interpret an authority. Its presence is deliberately not
 * equivalent to maliciousness (Appendix Q.1).
 */
export interface AuthoritySeverityEvidence {
  readonly status: AuthorityStatus;
  readonly holder: AuthorityHolder;
  readonly observedAbuse: boolean;
  readonly revocationAbility: RevocationAbility;
  /** Stable context supplied by the analyzer (for example FREEZE or pool withdrawal). */
  readonly context: string;
}

export interface DeterministicSeverityFinding {
  readonly findingId: string;
  readonly kind: DeterministicSecurityFindingKind;
  /** False means the finding is retained as evidence but does not affect severity. */
  readonly present?: boolean;
  readonly authority?: AuthoritySeverityEvidence;
}

export interface SeverityPolicyInput {
  readonly findings: readonly DeterministicSeverityFinding[];
  readonly policyVersion?: typeof SOLANA_SECURITY_SEVERITY_POLICY_VERSION;
}

export interface SeverityPolicyDecision {
  readonly severity: SecuritySeverity;
  readonly policyVersion: typeof SOLANA_SECURITY_SEVERITY_POLICY_VERSION;
  /** Sorted stable identifiers for the findings that established the maximum severity. */
  readonly determiningFindingIds: readonly string[];
}

const RANK: Readonly<Record<SecuritySeverity, number>> = {
  [SecuritySeverity.NONE]: 0,
  [SecuritySeverity.LOW]: 1,
  [SecuritySeverity.MEDIUM]: 2,
  [SecuritySeverity.HIGH]: 3,
  [SecuritySeverity.CRITICAL]: 4,
};

function authoritySeverity(
  kind: DeterministicSecurityFindingKind,
  authority: AuthoritySeverityEvidence | undefined,
): SecuritySeverity {
  if (authority === undefined || authority.status === 'UNKNOWN') return SecuritySeverity.MEDIUM;
  if (authority.status === 'REVOKED') return SecuritySeverity.NONE;
  if (authority.observedAbuse) return SecuritySeverity.CRITICAL;

  const concentrated = authority.holder === 'CONCENTRATED_CREATOR_CONTROL';
  if ((kind === 'FREEZE_AUTHORITY' || kind === 'PERMANENT_DELEGATE') && concentrated) {
    return SecuritySeverity.HIGH;
  }

  // An active authority without observed abuse is administrative evidence.
  // Holder, revocation ability, and context remain explicit reconstruction inputs.
  return SecuritySeverity.MEDIUM;
}

function findingSeverity(finding: DeterministicSeverityFinding): SecuritySeverity {
  if (finding.present === false) return SecuritySeverity.NONE;
  switch (finding.kind) {
    case 'NON_TRANSFERABLE_EXIT_BLOCKED':
    case 'TRANSFER_HOOK_EXIT_BLOCKED':
    case 'MALICIOUS_PROGRAM_OWNER':
    case 'LIQUIDITY_UNUSABLE':
    case 'LIQUIDITY_WITHDRAWABLE':
      return SecuritySeverity.CRITICAL;
    case 'ACTIVE_AUTHORITY_OBSERVED_ABUSE':
      return finding.authority?.status === 'ACTIVE' && finding.authority.observedAbuse
        ? SecuritySeverity.CRITICAL
        : authoritySeverity(finding.kind, finding.authority);
    case 'FREEZE_AUTHORITY':
    case 'PERMANENT_DELEGATE':
    case 'ADMINISTRATIVE_AUTHORITY':
      return authoritySeverity(finding.kind, finding.authority);
    case 'UNKNOWN_REQUIRED_EXTENSION':
      return SecuritySeverity.HIGH;
    case 'INCOMPLETE_COVERAGE':
      return SecuritySeverity.MEDIUM;
    case 'LOW_RISK_CONFIGURATION':
      return SecuritySeverity.LOW;
    case 'NEUTRAL_CONFIGURATION':
      return SecuritySeverity.NONE;
  }
}

/** Pure, order-independent Appendix Q.1 severity decision. */
export function classifyDeterministicSeverity(input: SeverityPolicyInput): SeverityPolicyDecision {
  const version = input.policyVersion ?? SOLANA_SECURITY_SEVERITY_POLICY_VERSION;
  if (version !== SOLANA_SECURITY_SEVERITY_POLICY_VERSION) {
    throw new RangeError(`UNSUPPORTED_SEVERITY_POLICY_VERSION: ${version}`);
  }

  let severity: SecuritySeverity = SecuritySeverity.NONE;
  let determiningFindingIds: string[] = [];
  for (const finding of input.findings) {
    if (finding.findingId.length === 0) throw new RangeError('findingId must not be empty');
    const candidate = findingSeverity(finding);
    if (RANK[candidate] > RANK[severity]) {
      severity = candidate;
      determiningFindingIds = [finding.findingId];
    } else if (candidate === severity && candidate !== SecuritySeverity.NONE) {
      determiningFindingIds.push(finding.findingId);
    }
  }

  return {
    severity,
    policyVersion: version,
    determiningFindingIds: [...new Set(determiningFindingIds)].sort(),
  };
}

/** Convenience projection for consumers that persist only the enum and policy separately. */
export function deterministicSeverity(
  findings: readonly DeterministicSeverityFinding[],
): SecuritySeverity {
  return classifyDeterministicSeverity({ findings }).severity;
}

export const assessSeverity = classifyDeterministicSeverity;

