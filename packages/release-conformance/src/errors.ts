export const ConformanceErrorCode = {
  EVIDENCE_MALFORMED: 'EVIDENCE_MALFORMED',
  EVIDENCE_HASH_MISMATCH: 'EVIDENCE_HASH_MISMATCH',
  EVIDENCE_SIGNATURE_INVALID: 'EVIDENCE_SIGNATURE_INVALID',
  EVIDENCE_EXPIRED: 'EVIDENCE_EXPIRED',
  EVIDENCE_REVOKED: 'EVIDENCE_REVOKED',
  EVIDENCE_SCOPE_INSUFFICIENT: 'EVIDENCE_SCOPE_INSUFFICIENT',
  DECISION_TRACE_INCOMPLETE: 'DECISION_TRACE_INCOMPLETE',
  RELEASE_REPORT_INCOMPLETE: 'RELEASE_REPORT_INCOMPLETE',
  RELEASE_REPORT_HASH_MISMATCH: 'RELEASE_REPORT_HASH_MISMATCH',
} as const;
export type ConformanceErrorCode = (typeof ConformanceErrorCode)[keyof typeof ConformanceErrorCode];
export class ConformanceError extends Error {
  readonly code: ConformanceErrorCode;
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
  constructor(
    code: ConformanceErrorCode,
    message: string,
    detail: Record<string, string | number | boolean | null> = {},
  ) {
    super(`${code}: ${message}`);
    this.name = 'ConformanceError';
    this.code = code;
    this.detail = detail;
  }
}
