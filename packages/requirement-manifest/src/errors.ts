export const ManifestErrorCode = {
  ARTIFACT_HASH_MISMATCH: 'ARTIFACT_HASH_MISMATCH',
  TEXT_HASH_MISMATCH: 'TEXT_HASH_MISMATCH',
  ANCHOR_INVALID: 'ANCHOR_INVALID',
  REFERENCE_INVALID: 'REFERENCE_INVALID',
  COUNT_MISMATCH: 'COUNT_MISMATCH',
  DEPENDENCY_CYCLE: 'DEPENDENCY_CYCLE',
  DUPLICATE_ID: 'DUPLICATE_ID',
  ID_SHAPE_INVALID: 'ID_SHAPE_INVALID',
  ID_ORDER_INVALID: 'ID_ORDER_INVALID',
  SUPERSESSION_LINK_REQUIRED: 'SUPERSESSION_LINK_REQUIRED',
  RELEASED_ID_REUSED: 'RELEASED_ID_REUSED',
  MANIFEST_INVALID: 'MANIFEST_INVALID',
} as const;

export type ManifestErrorCode = (typeof ManifestErrorCode)[keyof typeof ManifestErrorCode];
export type ManifestErrorDetail = Readonly<Record<string, string | number | boolean | null>>;

/** Package-local ForesiftError-style refusal; the shared domain enum stays immutable. */
export class ManifestError extends Error {
  readonly code: ManifestErrorCode;
  readonly detail: ManifestErrorDetail;

  constructor(code: ManifestErrorCode, message: string, detail: ManifestErrorDetail = {}) {
    super(`${code}: ${message}`);
    this.name = 'ManifestError';
    this.code = code;
    this.detail = detail;
  }
}

export function isManifestError(value: unknown): value is ManifestError {
  return value instanceof ManifestError;
}
