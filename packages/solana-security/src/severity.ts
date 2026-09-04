import {
  LiquidityRemovalRisk,
  PoolSupportState,
  SecuritySeverity,
  StateCompleteness,
  TokenControl,
  TokenControlState,
} from '@foresift/domain';
import type {
  PoolSecurityAssessment,
  TokenControlFinding,
} from '@foresift/shared-schemas';

/**
 * Appendix Q.1 severity baseline as a versioned pure policy over
 * deterministic findings (FR-SOLSEC-001…003, AC-131 trace).
 *
 * The Q.1 caveat is structural here: an authority is NOT automatically
 * malicious. Control status, holder/observed-behavior evidence, revocation
 * ability and context are evidence inputs — administrative control without
 * observed abuse never exceeds MEDIUM for authorities whose activation is not
 * itself the risk, and CRITICAL requires either a known blocking risk
 * (non-transferability, transfer hook blocking modeled exit), a required-path
 * program owner that is malicious/unknown, or observed abuse by an active
 * authority/pool control. Revoked authorities carry no risk at all.
 *
 * This policy is the authoritative Q.1 mapping; the analyzer's pre-policy
 * severity stamps are conservative defaults and may be refined by this
 * module (e.g. known non-transferability computes CRITICAL where the
 * analyzer's initial stamp is HIGH).
 */
export const SEVERITY_POLICY_VERSION = 'solsec-severity@1';

const SEVERITY_RANK: Readonly<Record<SecuritySeverity, number>> = {
  [SecuritySeverity.NONE]: 0,
  [SecuritySeverity.LOW]: 1,
  [SecuritySeverity.MEDIUM]: 2,
  [SecuritySeverity.HIGH]: 3,
  [SecuritySeverity.CRITICAL]: 4,
};

/** Evidence inputs beyond the finding itself (Q.1: holder/behavior/context). */
export interface SeverityEvidenceContext {
  /** Observed malicious action by the authority or pool control. */
  readonly observedAbuse?: boolean;
  /** The control demonstrably blocks the modeled exit path. */
  readonly blocksModeledExit?: boolean;
  /** The program owner on the path is malicious or unknown. */
  readonly programOwnerUntrusted?: boolean;
  /** The finding sits on a path required by the execution model. */
  readonly requiredForModeledPath?: boolean;
}

/**
 * Base Q.1 mapping for one deterministic finding, before behavioral/context
 * evidence. Deterministic in (control, controlState) alone.
 */
export function baseFindingSeverity(
  control: TokenControl,
  state: TokenControlState,
): SecuritySeverity {
  switch (state) {
    case TokenControlState.REVOKED_AUTHORITY:
      // Revocation ability exercised: no active authority remains.
      return SecuritySeverity.NONE;
    case TokenControlState.KNOWN_RISK:
      // Q.1 names known non-transferability and transfer hooks that block
      // modeled exit as CRITICAL; a known-frozen default state stays HIGH.
      return control === TokenControl.DEFAULT_STATE
        ? SecuritySeverity.HIGH
        : SecuritySeverity.CRITICAL;
    case TokenControlState.UNABLE_TO_VERIFY:
      // Unknown required extension is HIGH; other unverifiable state is an
      // incomplete-coverage gap (MEDIUM), never negative evidence.
      if (control === TokenControl.UNKNOWN_EXTENSION) return SecuritySeverity.HIGH;
      return control === TokenControl.DEFAULT_STATE
        ? SecuritySeverity.NONE
        : SecuritySeverity.MEDIUM;
    case TokenControlState.ADMINISTRATIVE_CONTROL:
      switch (control) {
        // Active freeze / permanent delegate / transfer hook is concentrated
        // creator control over user funds or the exit path (HIGH), but not
        // automatically malicious (never CRITICAL without observed abuse).
        case TokenControl.FREEZE:
        case TokenControl.PERMANENT_DELEGATE:
        case TokenControl.TRANSFER_HOOK:
          return SecuritySeverity.HIGH;
        // Administrative authorities without observed abuse.
        case TokenControl.METADATA_UPDATE:
        case TokenControl.CONFIDENTIAL_TRANSFER:
          return SecuritySeverity.LOW;
        default:
          return SecuritySeverity.MEDIUM;
      }
    case TokenControlState.NEUTRAL_CONFIGURATION:
      return control === TokenControl.CONFIDENTIAL_TRANSFER
        ? SecuritySeverity.LOW
        : SecuritySeverity.NONE;
  }
}

/**
 * Computes the Q.1 severity for one finding from its deterministic state plus
 * optional behavioral/context evidence. Escalations only ever raise severity
 * and only fire for controls that are actually active (administrative or
 * known-risk) — status is an evidence input, so unverifiable or revoked
 * authorities are never escalated to CRITICAL.
 */
export function computeFindingSeverity(
  finding: TokenControlFinding,
  context?: SeverityEvidenceContext,
): SecuritySeverity {
  let severity: SecuritySeverity = baseFindingSeverity(finding.control, finding.controlState);
  if (context === undefined) return severity;
  const active =
    finding.controlState === TokenControlState.ADMINISTRATIVE_CONTROL ||
    finding.controlState === TokenControlState.KNOWN_RISK;
  const escalate = (candidate: SecuritySeverity): void => {
    if (SEVERITY_RANK[candidate] > SEVERITY_RANK[severity]) severity = candidate;
  };
  if (context.observedAbuse === true && active) escalate(SecuritySeverity.CRITICAL);
  if (context.blocksModeledExit === true && finding.control === TokenControl.TRANSFER_HOOK)
    escalate(SecuritySeverity.CRITICAL);
  if (context.programOwnerUntrusted === true && context.requiredForModeledPath === true)
    escalate(SecuritySeverity.CRITICAL);
  return severity;
}

/**
 * Maps a pool assessment onto the Q.1 baseline: unusable or withdrawable
 * liquidity is CRITICAL, unverifiable pool support or incomplete state is an
 * incomplete-coverage MEDIUM.
 */
export function poolAssessmentSeverity(pool: PoolSecurityAssessment): SecuritySeverity {
  if (pool.liquidityRemovalRisk === LiquidityRemovalRisk.OBSERVED)
    return SecuritySeverity.CRITICAL;
  if (pool.liquidityRemovalRisk === LiquidityRemovalRisk.POSSIBLE)
    return SecuritySeverity.CRITICAL;
  if (
    pool.liquidityRemovalRisk === LiquidityRemovalRisk.UNABLE_TO_VERIFY ||
    pool.adapterSupportState !== PoolSupportState.RESOLVED ||
    pool.stateCompleteness === StateCompleteness.INCOMPLETE_BLOCKING
  )
    return SecuritySeverity.MEDIUM;
  return SecuritySeverity.NONE;
}

export interface CompositeSeverityInput {
  readonly findings?: readonly TokenControlFinding[];
  readonly poolAssessment?: PoolSecurityAssessment;
}

/**
 * Deterministic composite: the highest Q.1 severity across the deterministic
 * findings and the pool assessment wins (CRITICAL > HIGH > MEDIUM > LOW >
 * NONE). Provider evidence never participates here.
 */
export function evaluateCompositeSeverity(input: CompositeSeverityInput): SecuritySeverity {
  let severity: SecuritySeverity = SecuritySeverity.NONE;
  for (const finding of input.findings ?? []) {
    const candidate = computeFindingSeverity(finding);
    if (SEVERITY_RANK[candidate] > SEVERITY_RANK[severity]) severity = candidate;
  }
  if (input.poolAssessment !== undefined) {
    const candidate = poolAssessmentSeverity(input.poolAssessment);
    if (SEVERITY_RANK[candidate] > SEVERITY_RANK[severity]) severity = candidate;
  }
  return severity;
}
