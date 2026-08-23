/**
 * ObjectStoreAdapter (§14.5, §14.7, §14.8; FR-DR-002, FR-DATA-002).
 *
 * Content-addressed, rights-aware, versioned object storage. Identical BYTES
 * never merge with different protection metadata: rights reference, tenant,
 * encryption status, retention class, and availability class are part of the
 * dedup identity — content-addressed deduplication cannot merge artifacts
 * that differ in any of them. Deletion is barred from the general interface;
 * retention execution is a separate governed operation (FR-DR-002), never a
 * convenience method.
 */

/** Protection metadata that participates in the dedup identity. */
export interface ObjectProtectionMetadata {
  /** MIME/content type of the stored bytes. */
  readonly contentType: string;
  readonly compression: 'NONE' | 'GZIP' | 'ZSTD';
  /** e.g. 'PLAINTEXT' or 'SERVER_SIDE_AES256' — recorded, never faked. */
  readonly encryptionStatus: string;
  /** Provider licensing/rights policy reference; absent means unrestricted. */
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
  /** Monotonic version within the same dedup identity, starting at 1. */
  readonly version: number;
  readonly sizeBytes: number;
  readonly metadata: ObjectProtectionMetadata;
  readonly storedAt: string;
}

export interface ObjectLookup {
  readonly contentHash: string;
  readonly version?: number | undefined;
  /** When omitted, the newest version of the identity is returned. */
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
  /** Verify physical presence and byte-exact hash without full transfer cost assumptions. */
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
