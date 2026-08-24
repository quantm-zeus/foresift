/**
 * §13.9 field-level data-quality codes (FR-DATA-005).
 *
 * Every normalized field carries one or more explicit quality statuses from
 * this exact vocabulary. `null` alone is insufficient — a missing value must
 * say WHY it is missing.
 */
import { ErrorCode, QualityError } from './errors.ts';

/** The complete §13.9 vocabulary. Values are stable machine codes. */
export const QualityCode = {
  VALID: 'VALID',
  MISSING_PROVIDER: 'MISSING_PROVIDER',
  NOT_REQUESTED_BY_POLICY: 'NOT_REQUESTED_BY_POLICY',
  UNSUPPORTED_CHAIN: 'UNSUPPORTED_CHAIN',
  UNSUPPORTED_PROGRAM_VERSION: 'UNSUPPORTED_PROGRAM_VERSION',
  STALE: 'STALE',
  PARTIAL: 'PARTIAL',
  ESTIMATED: 'ESTIMATED',
  CONFLICTING: 'CONFLICTING',
  REORG_PENDING: 'REORG_PENDING',
  GAP_AFFECTED: 'GAP_AFFECTED',
  LOW_SAMPLE: 'LOW_SAMPLE',
  DECIMAL_UNCERTAIN: 'DECIMAL_UNCERTAIN',
  LICENSE_RESTRICTED: 'LICENSE_RESTRICTED',
  SCHEMA_DEGRADED: 'SCHEMA_DEGRADED',
  DEPRECATED_OPERATION: 'DEPRECATED_OPERATION',
  COST_BLOCKED: 'COST_BLOCKED',
  QUOTA_RESERVE_PROTECTED: 'QUOTA_RESERVE_PROTECTED',
  CAPACITY_BLOCKED: 'CAPACITY_BLOCKED',
  EXECUTION_UNAVAILABLE: 'EXECUTION_UNAVAILABLE',
  EXECUTION_PARTIAL: 'EXECUTION_PARTIAL',
  POOL_MATH_UNSUPPORTED: 'POOL_MATH_UNSUPPORTED',
  QUOTE_PARITY_FAILED: 'QUOTE_PARITY_FAILED',
  TOKEN_EXTENSION_UNKNOWN: 'TOKEN_EXTENSION_UNKNOWN',
  SUPPLY_UNCERTAIN: 'SUPPLY_UNCERTAIN',
  SYSTEM_ADDRESS_UNCERTAIN: 'SYSTEM_ADDRESS_UNCERTAIN',
  SOCIAL_UNAVAILABLE: 'SOCIAL_UNAVAILABLE',
  SOURCE_DEPENDENCE_HIGH: 'SOURCE_DEPENDENCE_HIGH',
  OUTCOME_PENDING: 'OUTCOME_PENDING',
  OUTCOME_CENSORED: 'OUTCOME_CENSORED',
  RETROSPECTIVE_ONLY: 'RETROSPECTIVE_ONLY',
} as const;

export type QualityCode = (typeof QualityCode)[keyof typeof QualityCode];

/** Declaration-order list of every §13.9 code. */
export const ALL_QUALITY_CODES: readonly QualityCode[] = Object.values(QualityCode);

/** Fail-closed resolution: unknown strings refuse rather than coerce. */
export function qualityCode(value: string): QualityCode {
  const code = (ALL_QUALITY_CODES as readonly string[]).includes(value)
    ? (value as QualityCode)
    : undefined;
  if (code === undefined) {
    throw new QualityError('unknown quality code', { value }, ErrorCode.QUALITY_CODE_UNKNOWN);
  }
  return code;
}

export function isQualityCode(value: unknown): value is QualityCode {
  return typeof value === 'string' && (ALL_QUALITY_CODES as readonly string[]).includes(value);
}

/**
 * Policy-missingness semantics (AC-242): `NOT_REQUESTED_BY_POLICY` is not
 * provider missingness and must never be imputed as a negative feature or
 * rendered as a provider-failure state. (Quality-code view.)
 */
export function qualityIsNotRequestedByPolicy(code: QualityCode): boolean {
  return code === QualityCode.NOT_REQUESTED_BY_POLICY;
}

/** Codes that describe the system choosing not to fetch at all. */
const POLICY_BLOCKED_CODES: readonly QualityCode[] = [
  QualityCode.NOT_REQUESTED_BY_POLICY,
  QualityCode.COST_BLOCKED,
  QualityCode.CAPACITY_BLOCKED,
  QualityCode.LICENSE_RESTRICTED,
];

/**
 * Deliberate non-acquisition codes: absence because THIS system chose not to
 * fetch (policy, licensing) or could not justify/afford the fetch (cost,
 * capacity) — never provider failure or provider-side missingness. Despite
 * the name, the group is broader than policy and rights alone; cost and
 * capacity blocks share the same "no acquisition happened by our own
 * decision" semantics.
 */
export function isPolicyOrRightsBlocked(code: QualityCode): boolean {
  return POLICY_BLOCKED_CODES.includes(code);
}

/**
 * "Null alone is insufficient" invariant, expressed as a pure check a
 * repository can reuse: a null/absent stored value MUST carry at least one
 * explicit non-VALID code explaining the absence.
 */
export function nullRequiresExplicitCode(codes: readonly QualityCode[]): boolean {
  return codes.length >= 1 && !codes.every((c) => c === QualityCode.VALID);
}
