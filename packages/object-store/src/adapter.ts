/**
 * ObjectStoreAdapter (§14.5, §14.7, §14.8; FR-DR-002, FR-DATA-002).
 *
 * Content-addressed, rights-aware, versioned object storage. Identical BYTES
 * never merge with different protection metadata: rights reference, tenant,
 * encryption status, retention class, and availability class are part of the
 * dedup identity — content-addressed deduplication cannot merge artifacts
 * that differ in any of them. This implementation is STRICTER than the PRD
 * minimum: contentType and compression also participate in the identity.
 * Deletion is barred from the general interface; retention execution is a
 * separate governed operation (FR-DR-002), never a convenience method.
 */

/** Protection metadata that participates in the dedup identity. */
export interface ObjectProtectionMetadata {
  /** MIME/content type of the stored bytes. */
  readonly contentType: string;
  readonly compression: 'NONE' | 'GZIP' | 'ZSTD';
  /** e.g. 'PLAINTEXT' or 'SERVER_SIDE_AES256'. Backend contract: this layer
   * records what the caller declares and cannot independently verify it. */
  readonly encryptionStatus: string;
  /** Provider licensing/rights policy reference. Callers SHOULD always
   * supply one; there is no "absent means unrestricted" default implemented
   * at this layer — an absent reference is recorded as absent. */
  readonly rightsRef?: string | null;
  /** Retention class per §14.6 (e.g. 'RAW_PROVIDER_PAYLOAD_7D'). */
  readonly retentionClass: string;
  readonly tenantId?: string | null;
  /** Availability class for cross-store consistency checks. */
  readonly availabilityClass?: string | null;
}

export interface PutObjectRequest {
  readonly artifactId: string;
  readonly bytes: Uint8Array;
  readonly metadata: ObjectProtectionMetadata;
}

export interface StoredObject {
  readonly artifactId: string;
  /** 'sha256:<64 hex>' of the exact stored bytes. */
  readonly contentHash: string;
  /**
   * Monotonic per content hash across ALL dedup identities of those bytes
   * (v1, v2, … in insertion order): identical bytes under different protected
   * metadata occupy successive versions under the same hash, so a version
   * number alone does not imply a particular identity.
   */
  readonly version: number;
  readonly sizeBytes: number;
  readonly metadata: ObjectProtectionMetadata;
  readonly storedAt: string;
}

/**
 * Lookup by content hash. Resolution PRECEDENCE, not conjunction:
 * - `version` omitted → newest version of those bytes;
 * - `metadata` alone → narrows to versions whose dedup identity matches
 *   exactly as in put(); a miss NEVER falls back to a differently-protected
 *   version of the same bytes;
 * - BOTH supplied → `version` wins and `metadata` is ignored (no conjunctive
 *   check). Identity-safe lookup requires omitting `version`; conjunctive
 *   version+metadata resolution is deliberately deferred to an explicit
 *   follow-up decision rather than improvised here.
 */
export interface ObjectLookup {
  readonly contentHash: string;
  readonly version?: number | undefined;
  readonly metadata?: ObjectProtectionMetadata | undefined;
}

export type PhysicalVerification =
  | { readonly outcome: 'VERIFIED'; readonly contentHash: string }
  | { readonly outcome: 'MISSING' }
  | { readonly outcome: 'HASH_MISMATCH'; readonly expected: string; readonly actual: string };

export interface ObjectStoreAdapter {
  /**
   * Store bytes under their content hash. Re-putting the SAME bytes under the
   * SAME protection metadata returns the existing object (dedup); identical
   * bytes under DIFFERENT protected metadata are distinct objects.
   */
  put(request: PutObjectRequest): Promise<StoredObject>;
  /** Read an object back by hash (+ optional version/metadata identity). */
  get(lookup: ObjectLookup): Promise<{ bytes: Uint8Array; stored: StoredObject } | null>;
  /**
   * Verify physical presence and byte-exact hash. No performance contract:
   * an implementation may read the full object to re-hash it locally
   * (the reference store does); checksum-offloading backends can improve
   * on that without changing this interface.
   */
  verify(lookup: ObjectLookup): Promise<PhysicalVerification>;
  /** All versions of one content-hash identity. */
  versions(contentHash: string): Promise<readonly StoredObject[]>;
}

/** Canonical dedup identity over protected metadata (order-independent). */
export function dedupIdentityOf(metadata: ObjectProtectionMetadata): string {
  const identity = {
    availabilityClass: metadata.availabilityClass ?? null,
    compression: metadata.compression,
    contentType: metadata.contentType,
    encryptionStatus: metadata.encryptionStatus,
    rightsRef: metadata.rightsRef ?? null,
    retentionClass: metadata.retentionClass,
    tenantId: metadata.tenantId ?? null,
  };
  return JSON.stringify(identity, Object.keys(identity).sort());
}
