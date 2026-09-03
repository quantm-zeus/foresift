import { SecuritySeverity, TokenControl } from '@foresift/domain';

/** Appendix Q.1 policy identifier persisted with every derived decision. */
export const SOLSEC_SEVERITY_POLICY_VERSION = 'solsec-severity-q1@1';
export const SEVERITY_POLICY_VERSION = SOLSEC_SEVERITY_POLICY_VERSION;

export type AuthorityStatus = 'ACTIVE' | 'REVOKED' | 'ABSENT' | 'UNKNOWN';
export type AuthorityHolder = 'CREATOR' | 'CONCENTRATED_CREATOR_GROUP' | 'THIRD_PARTY' | 'UNKNOWN';
export type ObservedAuthorityBehavior = 'ABUSE_OBSERVED' | 'NO_ABUSE_OBSERVED' | 'NOT_OBSERVED';
export type RevocationAbility = 'REVOCABLE' | 'IRREVOCABLE' | 'UNKNOWN' | 'NOT_APPLICABLE';

/**
 * Q.1 authority evidence. Keeping these dimensions independent prevents the
 * presence of an administrative key from being mislabeled as malicious.
 */
export interface AuthorityEvidence {
  readonly status: AuthorityStatus;
  readonly holder: AuthorityHolder;
  readonly observedBehavior: ObservedAuthorityBehavior;
  readonly revocationAbility: RevocationAbility;
  readonly context:
    | 'MINT'
    | 'FREEZE'
    | 'PERMANENT_DELEGATE'
    | 'TRANSFER_FEE'
    | 'TRANSFER_HOOK'
    | 'CLOSE'
    | 'METADATA_UPDATE'
    | 'WITHDRAWAL'
    | 'OTHER';
}

export type DeterministicFindingKind =
  | 'NON_TRANSFERABILITY'
  | 'TRANSFER_HOOK'
  | 'PROGRAM_OWNER'
  | 'AUTHORITY'
  | 'LIQUIDITY'
  | 'UNKNOWN_REQUIRED_EXTENSION'
  | 'INCOMPLETE_COVERAGE'
  | 'OTHER';

export interface DeterministicSeverityFinding {
  readonly findingId: string;
  readonly kind: DeterministicFindingKind;
  readonly control?: TokenControl;
  readonly blocksModeledExit?: boolean;
  readonly maliciousProgramOwner?: boolean;
  readonly authority?: AuthorityEvidence;
  readonly liquidityState?:
    'USABLE' | 'UNUSABLE' | 'WITHDRAWABLE' | 'LOCKED' | 'BURNED' | 'UNKNOWN';
  readonly coverage?: 'COMPLETE' | 'PARTIAL' | 'INCOMPLETE' | 'UNKNOWN';
  readonly knownBenign?: boolean;
}

export interface SeverityPolicy {
  readonly version: string;
}

export const DEFAULT_SEVERITY_POLICY: SeverityPolicy = Object.freeze({
  version: SOLSEC_SEVERITY_POLICY_VERSION,
});

export interface SeverityDecision {
  readonly severity: SecuritySeverity;
  readonly policyVersion: string;
  readonly reasonCodes: readonly string[];
  readonly decisiveFindingIds: readonly string[];
}

const RANK: Readonly<Record<SecuritySeverity, number>> = Object.freeze({
  [SecuritySeverity.NONE]: 0,
  [SecuritySeverity.LOW]: 1,
  [SecuritySeverity.MEDIUM]: 2,
  [SecuritySeverity.HIGH]: 3,
  [SecuritySeverity.CRITICAL]: 4,
});

interface FindingDecision {
  readonly severity: SecuritySeverity;
  readonly reason: string;
}

function authoritySeverity(authority: AuthorityEvidence): FindingDecision {
  if (authority.status === 'REVOKED' || authority.status === 'ABSENT') {
    return { severity: SecuritySeverity.NONE, reason: 'AUTHORITY_NOT_ACTIVE' };
  }
  if (authority.status === 'UNKNOWN') {
    return { severity: SecuritySeverity.MEDIUM, reason: 'AUTHORITY_STATUS_INCOMPLETE' };
  }
  if (authority.observedBehavior === 'ABUSE_OBSERVED') {
    return { severity: SecuritySeverity.CRITICAL, reason: 'ACTIVE_AUTHORITY_OBSERVED_ABUSE' };
  }
  const creatorControlled =
    authority.holder === 'CREATOR' || authority.holder === 'CONCENTRATED_CREATOR_GROUP';
  if (
    creatorControlled &&
    (authority.context === 'FREEZE' || authority.context === 'PERMANENT_DELEGATE')
  ) {
    return {
      severity: SecuritySeverity.HIGH,
      reason: 'ACTIVE_PRIVILEGED_AUTHORITY_CONCENTRATED_CREATOR_CONTROL',
    };
  }
  // Revocation ability and observation coverage remain explicit evidence. They
  // affect the rationale, but absence of observed abuse never implies safety.
  const suffix =
    authority.observedBehavior === 'NOT_OBSERVED' || authority.revocationAbility === 'UNKNOWN'
      ? '_INCOMPLETE_CONTEXT'
      : '';
  return {
    severity: SecuritySeverity.MEDIUM,
    reason: `ACTIVE_ADMINISTRATIVE_AUTHORITY${suffix}`,
  };
}

/** Pure Q.1 mapping for one deterministic finding. */
export function severityForDeterministicFinding(
  finding: DeterministicSeverityFinding,
): FindingDecision {
  if (finding.findingId.trim().length === 0) throw new RangeError('findingId must be non-empty');
  if (finding.knownBenign === true) {
    return { severity: SecuritySeverity.NONE, reason: 'DETERMINISTICALLY_BENIGN' };
  }
  if (
    (finding.kind === 'NON_TRANSFERABILITY' || finding.control === TokenControl.NON_TRANSFERABLE) &&
    finding.blocksModeledExit === true
  ) {
    return { severity: SecuritySeverity.CRITICAL, reason: 'NON_TRANSFERABILITY_BLOCKS_EXIT' };
  }
  if (
    (finding.kind === 'TRANSFER_HOOK' || finding.control === TokenControl.TRANSFER_HOOK) &&
    finding.blocksModeledExit === true
  ) {
    return { severity: SecuritySeverity.CRITICAL, reason: 'TRANSFER_HOOK_BLOCKS_EXIT' };
  }
  if (finding.kind === 'PROGRAM_OWNER' && finding.maliciousProgramOwner === true) {
    return { severity: SecuritySeverity.CRITICAL, reason: 'MALICIOUS_PROGRAM_OWNER' };
  }
  if (finding.authority !== undefined) return authoritySeverity(finding.authority);
  if (
    finding.kind === 'LIQUIDITY' &&
    (finding.liquidityState === 'UNUSABLE' || finding.liquidityState === 'WITHDRAWABLE')
  ) {
    return { severity: SecuritySeverity.CRITICAL, reason: 'LIQUIDITY_UNUSABLE_OR_WITHDRAWABLE' };
  }
  if (
    finding.kind === 'UNKNOWN_REQUIRED_EXTENSION' ||
    finding.control === TokenControl.UNKNOWN_EXTENSION
  ) {
    return { severity: SecuritySeverity.HIGH, reason: 'UNKNOWN_REQUIRED_EXTENSION' };
  }
  if (
    finding.kind === 'INCOMPLETE_COVERAGE' ||
    finding.coverage === 'PARTIAL' ||
    finding.coverage === 'INCOMPLETE' ||
    finding.coverage === 'UNKNOWN' ||
    finding.liquidityState === 'UNKNOWN'
  ) {
    return { severity: SecuritySeverity.MEDIUM, reason: 'INCOMPLETE_DETERMINISTIC_COVERAGE' };
  }
  if (
    finding.kind === 'PROGRAM_OWNER' ||
    finding.kind === 'TRANSFER_HOOK' ||
    finding.kind === 'NON_TRANSFERABILITY' ||
    finding.kind === 'LIQUIDITY'
  ) {
    return { severity: SecuritySeverity.LOW, reason: 'KNOWN_NON_BLOCKING_CONDITION' };
  }
  return { severity: SecuritySeverity.NONE, reason: 'NO_DETERMINISTIC_RISK' };
}

/** Aggregate by maximum deterministic severity; provider evidence is intentionally absent. */
export function evaluateDeterministicSeverity(
  findings: readonly DeterministicSeverityFinding[],
  policy: SeverityPolicy = DEFAULT_SEVERITY_POLICY,
): SeverityDecision {
  if (policy.version.trim().length === 0) throw new RangeError('policy version must be non-empty');
  let severity: SecuritySeverity = SecuritySeverity.NONE;
  const evaluated = findings.map((finding) => ({
    findingId: finding.findingId,
    ...severityForDeterministicFinding(finding),
  }));
  for (const item of evaluated) {
    if (RANK[item.severity] > RANK[severity]) severity = item.severity;
  }
  const decisive = evaluated.filter((item) => item.severity === severity);
  return {
    severity,
    policyVersion: policy.version,
    reasonCodes: decisive.map((item) => item.reason),
    decisiveFindingIds: decisive.map((item) => item.findingId),
  };
}

export const deriveSecuritySeverity = evaluateDeterministicSeverity;
export const mapDeterministicSeverity = evaluateDeterministicSeverity;
