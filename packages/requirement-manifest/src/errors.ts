/** Stable, typed refusals for requirement-manifest integrity failures. */
export const ManifestErrorCode = {
  MANIFEST_PARSE_FAILED: 'MANIFEST_PARSE_FAILED',
  ARTIFACT_HASH_MISMATCH: 'ARTIFACT_HASH_MISMATCH',
  TEXT_HASH_MISMATCH: 'TEXT_HASH_MISMATCH',
  ID_GRAMMAR_INVALID: 'ID_GRAMMAR_INVALID',
  DUPLICATE_ID: 'DUPLICATE_ID',
  ANCHOR_UNRESOLVED: 'ANCHOR_UNRESOLVED',
  DANGLING_REFERENCE: 'DANGLING_REFERENCE',
  ORPHAN_NORMATIVE_ITEM: 'ORPHAN_NORMATIVE_ITEM',
  DEPENDENCY_GROUP_CYCLE: 'DEPENDENCY_GROUP_CYCLE',
  COUNT_MISMATCH: 'COUNT_MISMATCH',
  SUPERSESSION_LINK_REQUIRED: 'SUPERSESSION_LINK_REQUIRED',
  ID_REUSE_FORBIDDEN: 'ID_REUSE_FORBIDDEN',
} as const;

export type ManifestErrorCode = (typeof ManifestErrorCode)[keyof typeof ManifestErrorCode];

export class RequirementManifestError extends Error {
  readonly code: ManifestErrorCode;
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: ManifestErrorCode,
    message: string,
    detail: Readonly<Record<string, string | number | boolean | null>> = {},
  ) {
    super(`${code}: ${message}`);
    this.name = 'RequirementManifestError';
    this.code = code;
    this.detail = detail;
  }
}
