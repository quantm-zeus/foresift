/** Stable refusal codes local to the zero-dependency manifest package. */
export const RequirementManifestErrorCode = {
  ARTIFACT_HASH_MISMATCH: 'ARTIFACT_HASH_MISMATCH',
  TEXT_HASH_MISMATCH: 'TEXT_HASH_MISMATCH',
  ANCHOR_UNRESOLVED: 'ANCHOR_UNRESOLVED',
  DANGLING_REFERENCE: 'DANGLING_REFERENCE',
  COUNT_MISMATCH: 'COUNT_MISMATCH',
  DEPENDENCY_CYCLE: 'DEPENDENCY_CYCLE',
  ID_GRAMMAR_INVALID: 'ID_GRAMMAR_INVALID',
  ID_REUSE_FORBIDDEN: 'ID_REUSE_FORBIDDEN',
  SUPERSESSION_LINK_REQUIRED: 'SUPERSESSION_LINK_REQUIRED',
} as const;
export type RequirementManifestErrorCode = (typeof RequirementManifestErrorCode)[keyof typeof RequirementManifestErrorCode];

export class RequirementManifestError extends Error {
  readonly code: RequirementManifestErrorCode;
  readonly detail: Readonly<Record<string, unknown>>;
  constructor(code: RequirementManifestErrorCode, message: string, detail: Readonly<Record<string, unknown>> = {}) {
    super(`${code}: ${message}`);
    this.name = 'RequirementManifestError';
    this.code = code;
    this.detail = detail;
  }
}
