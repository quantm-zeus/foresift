/**
 * Frozen evidence bundle manifests (T040, FR-DATA-003, §13.8, §14.7).
 *
 * Bundles are content-addressed: the manifest's canonical JSON hashes to the
 * stored content_hash, and identical content cannot be re-frozen under a
 * different identity. Freezing is one-way — the database trigger refuses any
 * later mutation of a frozen row.
 */
import { createHash } from 'node:crypto';
import { ErrorCode, ForesiftError, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

/** Recursively key-sorted canonical JSON — same discipline as receipt hashing. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

export function manifestContentHash(manifest: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(manifest), 'utf8').digest('hex')}`;
}

export interface FreezeBundleInput {
  readonly bundleId: string;
  /** Arbitrary JSON manifest; hashed canonically for content addressing. */
  readonly manifest: Record<string, unknown>;
  readonly frozenAt: UtcTimestamp;
}

export interface FrozenBundle {
  readonly bundleId: string;
  readonly contentHash: string;
  readonly manifest: unknown;
  readonly frozenAt: UtcTimestamp;
}

/**
 * Freeze an evidence bundle. Re-freezing IDENTICAL content verifies and is
 * idempotent; identical id or hash with DIFFERENT content is refused.
 */
export async function freezeBundle(
  engine: DatabaseEngine,
  input: FreezeBundleInput,
): Promise<FrozenBundle> {
  const contentHash = manifestContentHash(input.manifest);
  const existing = await engine.query<{
    bundle_id: string;
    content_hash: string;
    frozen_at: Date | string;
  }>(
    'SELECT bundle_id, content_hash, frozen_at FROM evidence_bundles WHERE bundle_id = $1 OR content_hash = $2',
    [input.bundleId, contentHash],
  );
  const clash = existing.rows.find(
    (r) => r.content_hash === contentHash && r.bundle_id !== input.bundleId,
  );
  if (clash !== undefined) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      `identical evidence content already frozen as ${clash.bundle_id}; re-freezing under ${input.bundleId} refused`,
      { bundleId: input.bundleId },
    );
  }
  const sameId = existing.rows.find((r) => r.bundle_id === input.bundleId);
  if (sameId !== undefined) {
    if (sameId.content_hash !== contentHash) {
      throw new ForesiftError(
        ErrorCode.CONTRACT_INVARIANT_VIOLATED,
        `bundle ${input.bundleId} already frozen with different content`,
        { bundleId: input.bundleId },
      );
    }
    const reloaded = await loadFrozenBundle(engine, input.bundleId);
    if (reloaded === null) throw new Error('unreachable');
    return reloaded;
  }
  await engine.query(
    `INSERT INTO evidence_bundles (bundle_id, content_hash, manifest, frozen_at)
     VALUES ($1,$2,$3::jsonb,$4)`,
    [input.bundleId, contentHash, canonicalJson(input.manifest), input.frozenAt],
  );
  return {
    bundleId: input.bundleId,
    contentHash,
    manifest: input.manifest,
    frozenAt: input.frozenAt,
  };
}

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().replace('.000Z', 'Z');
}

export async function loadFrozenBundle(
  engine: DatabaseEngine,
  bundleId: string,
): Promise<FrozenBundle | null> {
  const rows = await engine.query<{
    bundle_id: string;
    content_hash: string;
    manifest: unknown;
    frozen_at: Date | string;
  }>(
    'SELECT bundle_id, content_hash, manifest, frozen_at FROM evidence_bundles WHERE bundle_id = $1',
    [bundleId],
  );
  const r = rows.rows[0];
  if (r === undefined) return null;
  return {
    bundleId: r.bundle_id,
    contentHash: r.content_hash,
    manifest: r.manifest,
    frozenAt: utcTimestamp(toIso(r.frozen_at)),
  };
}

/**
 * Verify a frozen bundle still hashes to its recorded identity — the
 * tamper-evidence check consumed by restore drills and negative suites.
 */
export async function verifyBundleIntegrity(
  engine: DatabaseEngine,
  bundleId: string,
): Promise<'INTACT' | 'MISSING' | 'HASH_MISMATCH'> {
  const bundle = await loadFrozenBundle(engine, bundleId);
  if (bundle === null) return 'MISSING';
  const recomputed = manifestContentHash(bundle.manifest);
  return recomputed === bundle.contentHash ? 'INTACT' : 'HASH_MISMATCH';
}
