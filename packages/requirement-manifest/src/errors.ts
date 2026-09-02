/** Stable, package-local refusal codes. The shared domain enum remains untouched. */
export const RequirementManifestErrorCode = {
  MANIFEST_PARSE_FAILED: 'MANIFEST_PARSE_FAILED',
  MANIFEST_SHAPE_INVALID: 'MANIFEST_SHAPE_INVALID',
  TEXT_HASH_MISMATCH: 'TEXT_HASH_MISMATCH',
  ADR_FORMAT_INVALID: 'ADR_FORMAT_INVALID',
  ANCHOR_UNRESOLVED: 'ANCHOR_UNRESOLVED',
  DANGLING_REFERENCE: 'DANGLING_REFERENCE',
  ORPHAN_REFERENCE: 'ORPHAN_REFERENCE',
  DEPENDENCY_CYCLE: 'DEPENDENCY_CYCLE',
  COUNT_MISMATCH: 'COUNT_MISMATCH',
  CHECKSUM_MISMATCH: 'CHECKSUM_MISMATCH',
} as const;

export type RequirementManifestErrorCode =
  (typeof RequirementManifestErrorCode)[keyof typeof RequirementManifestErrorCode];

export class RequirementManifestError extends Error {
  readonly code: RequirementManifestErrorCode;
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: RequirementManifestErrorCode,
    message: string,
    detail: Readonly<Record<string, string | number | boolean | null>> = {},
  ) {
    super(`${code}: ${message}`);
    this.name = 'RequirementManifestError';
    this.code = code;
    this.detail = detail;
  }
}
