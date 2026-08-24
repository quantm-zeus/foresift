/**
 * LocalFilesystemObjectStore: deterministic content-addressed,
 * versioned filesystem implementation for dev/test. Layout (`<hash>` is the
 * BARE sha256 hex — the `sha256:` scheme prefix is stripped):
 *
 *   <root>/objects/<hh>/<hash>/v<version>.blob      exact bytes
 *   <root>/objects/<hh>/<hash>/v<version>.meta.json protection metadata
 *
 * The blob bytes are immutable once written; a rewrite that would change
 * existing bytes is refused rather than silently overwritten.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  dedupIdentityOf,
  type ObjectLookup,
  type ObjectStoreAdapter,
  type PhysicalVerification,
  type PutObjectRequest,
  type StoredObject,
} from './adapter.ts';
import { sha256Hex } from './hash.ts';

/** Only a real sha256 content address may reach the filesystem layout. */
const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

/**
 * Derive the storage directory for one content hash. The hash is validated
 * against its canonical shape first — this store is dev/test today, but the
 * layout is imitable, and an unvalidated `sha256:../..` must never be able to
 * walk out of the root.
 */
function dirFor(root: string, contentHash: string): string {
  if (!CONTENT_HASH_PATTERN.test(contentHash)) {
    throw new Error(
      `malformed content hash rejected by object store: ${JSON.stringify(contentHash)}`,
    );
  }
  const hex = contentHash.slice('sha256:'.length);
  return path.join(root, 'objects', hex.slice(0, 2), hex);
}

async function readMeta(
  dir: string,
  version: number,
): Promise<{ stored: StoredObject; identity: string } | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(dir, `v${version}.meta.json`), 'utf8');
  } catch (err) {
    // Absence is the only condition that reads as "no metadata here".
    // Corruption (unparseable JSON), permission, and wrong-type failures must
    // surface — swallowing them would fabricate MISSING for bytes that sit
    // intact on disk and misdirect reconciliation.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return null;
  }
  return JSON.parse(raw) as { stored: StoredObject; identity: string };
}

export class LocalFilesystemObjectStore implements ObjectStoreAdapter {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async put(request: PutObjectRequest): Promise<StoredObject> {
    const contentHash = `sha256:${sha256Hex(request.bytes)}`;
    const dir = dirFor(this.root, contentHash);
    const identity = dedupIdentityOf(request.metadata);
    await mkdir(dir, { recursive: true });

    // Dedup within the same protected metadata identity; identical bytes with
    // different metadata occupy a NEW version under the same hash.
    const existing = await this.versions(contentHash);
    for (const prior of [...existing].reverse()) {
      if (dedupIdentityOf(prior.metadata) === identity) return prior;
    }

    const version = existing.length + 1;
    const blobPath = path.join(dir, `v${version}.blob`);
    // Blobs are immutable once written: an existing file at the next slot is
    // a corruption signal, never something to overwrite.
    try {
      await readFile(blobPath);
      throw new Error(`object ${contentHash} v${version} already exists and is immutable`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await writeFile(blobPath, request.bytes);
    const stored: StoredObject = {
      artifactId: request.artifactId,
      contentHash,
      version,
      sizeBytes: request.bytes.byteLength,
      metadata: request.metadata,
      storedAt: new Date().toISOString().replace('.000Z', 'Z'),
    };
    await writeFile(
      path.join(dir, `v${version}.meta.json`),
      JSON.stringify({ stored, identity }, null, 2),
    );
    return stored;
  }

  async get(lookup: ObjectLookup): Promise<{ bytes: Uint8Array; stored: StoredObject } | null> {
    const all = await this.versions(lookup.contentHash);
    let candidates = all;
    if (lookup.version !== undefined) {
      // Precedence, not conjunction: a supplied version wins outright and any
      // supplied metadata is ignored (see ObjectLookup).
      candidates = candidates.filter((s) => s.version === lookup.version);
    } else if (lookup.metadata !== undefined) {
      // Metadata-scoped lookups never fall back to another dedup identity:
      // in a rights-aware store, handing back a differently-protected version
      // of the same bytes on a miss would silently cross the protection
      // boundary — no match reads as absent.
      const identity = dedupIdentityOf(lookup.metadata);
      candidates = candidates.filter((s) => dedupIdentityOf(s.metadata) === identity);
    }
    if (candidates.length === 0) return null;
    // Newest version WITH an intact blob. A blob whose bytes vanished reads
    // as ABSENT at this layer (get returns null); physical loss with surviving
    // metadata is surfaced by verify()/the reconciler, not fabricated here.
    for (const candidate of [...candidates].reverse()) {
      try {
        const bytes = await readFile(
          path.join(dirFor(this.root, candidate.contentHash), `v${candidate.version}.blob`),
        );
        return { bytes: new Uint8Array(bytes), stored: candidate };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    return null;
  }

  async verify(lookup: ObjectLookup): Promise<PhysicalVerification> {
    const found = await this.get(lookup);
    if (found === null) return { outcome: 'MISSING' };
    const actual = `sha256:${sha256Hex(found.bytes)}`;
    return actual === found.stored.contentHash
      ? { outcome: 'VERIFIED', contentHash: actual }
      : { outcome: 'HASH_MISMATCH', expected: found.stored.contentHash, actual };
  }

  async versions(contentHash: string): Promise<readonly StoredObject[]> {
    const dir = dirFor(this.root, contentHash);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      // ENOENT alone reads as "object absent"; every other failure (EACCES,
      // EISDIR, …) is a real fault and must surface, not masquerade as an
      // empty version list.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      return [];
    }
    const metas: StoredObject[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.meta.json')) continue;
      const version = Number(entry.slice(1, -'.meta.json'.length));
      if (!Number.isInteger(version)) continue;
      const meta = await readMeta(dir, version);
      if (meta !== null) metas.push(meta.stored);
    }
    return metas.sort((a, b) => a.version - b.version);
  }
}
