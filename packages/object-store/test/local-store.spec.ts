/**
 * LocalFilesystemObjectStore: content addressing, protection-metadata
 * dedup identity, immutability, and tamper detection (FR-DR-002, FR-DATA-002,
 * §14.5/§14.7). Negative paths fail explicitly — no silent repair.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dedupIdentityOf,
  LocalFilesystemObjectStore,
  type ObjectProtectionMetadata,
} from '../src/index.ts';

let root: string;
let store: LocalFilesystemObjectStore;

const META: ObjectProtectionMetadata = {
  contentType: 'application/json',
  compression: 'NONE',
  encryptionStatus: 'SERVER_SIDE_AES256',
  rightsRef: 'license:provider-x-terms',
  retentionClass: 'RAW_PROVIDER_PAYLOAD_7D',
};

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'foresift-objectstore-'));
  store = new LocalFilesystemObjectStore(root);
}, 60_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
}, 30_000);

describe('content addressing and dedup identity', () => {
  it('stores bytes content-addressed and reads them back byte-exact', async () => {
    const bytes = new TextEncoder().encode('{"payload":"hello"}');
    const stored = await store.put({ artifactId: 'art-1', bytes, metadata: META });
    expect(stored.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(stored.version).toBe(1);

    const read = await store.get({ contentHash: stored.contentHash });
    expect(read).not.toBeNull();
    expect(new TextDecoder().decode(read!.bytes)).toBe('{"payload":"hello"}');
    expect(read!.stored.metadata.rightsRef).toBe(META.rightsRef);
  });

  it('dedups identical bytes under identical protected metadata', async () => {
    const bytes = new TextEncoder().encode('dedup-me');
    const first = await store.put({ artifactId: 'art-2', bytes, metadata: META });
    const again = await store.put({ artifactId: 'art-2b', bytes, metadata: META });
    expect(again.contentHash).toBe(first.contentHash);
    expect(again.version).toBe(first.version);
  });

  it('never merges identical bytes that differ in rights/tenant/encryption/retention', async () => {
    const bytes = new TextEncoder().encode('same-bytes-different-protection');
    const restricted = await store.put({
      artifactId: 'art-3',
      bytes,
      metadata: { ...META, rightsRef: 'license:restricted-a' },
    });
    const open = await store.put({
      artifactId: 'art-4',
      bytes,
      metadata: { ...META, rightsRef: null },
    });
    expect(open.contentHash).toBe(restricted.contentHash); // same content address…
    expect(open.version).toBe(restricted.version + 1); // …but a DISTINCT object

    const byMetadata = await store.get({
      contentHash: restricted.contentHash,
      metadata: restricted.metadata,
    });
    expect(byMetadata!.stored.metadata.rightsRef).toBe('license:restricted-a');
    // Protection metadata is part of the identity, not decoration.
    expect(dedupIdentityOf(restricted.metadata)).not.toEqual(dedupIdentityOf(open.metadata));
  });

  it('lists all versions of one content-hash identity in order', async () => {
    const bytes = new TextEncoder().encode('versioned');
    const v1 = await store.put({ artifactId: 'art-5', bytes, metadata: META });
    const v2 = await store.put({
      artifactId: 'art-6',
      bytes,
      metadata: { ...META, retentionClass: 'FROZEN_ALERT_EVIDENCE_24MO' },
    });
    const versions = await store.versions(v1.contentHash);
    expect(versions.map((v) => v.version)).toEqual([v1.version, v2.version]);
    expect(v2.version).toBeGreaterThan(v1.version);
  });

  it('resolution is precedence-based: a supplied version wins and metadata is ignored (ObjectLookup)', async () => {
    const bytes = new TextEncoder().encode('precedence-pin');
    const v1 = await store.put({ artifactId: 'art-5p', bytes, metadata: META });
    const v2 = await store.put({
      artifactId: 'art-6p',
      bytes,
      metadata: { ...META, retentionClass: 'FROZEN_ALERT_EVIDENCE_24MO' },
    });
    // Both supplied: version wins even though the metadata does NOT match
    // that version's identity — documented precedence, not an identity check.
    const read = await store.get({
      contentHash: v2.contentHash,
      version: v1.version,
      metadata: { ...META, retentionClass: 'FROZEN_ALERT_EVIDENCE_24MO' },
    });
    expect(read?.stored.version).toBe(v1.version);
    expect(read?.stored.metadata.retentionClass).toBe(META.retentionClass);
  });
});

describe('tamper detection fails explicitly', () => {
  it('reports VERIFIED when bytes match and MISSING when absent', async () => {
    const bytes = new TextEncoder().encode('verify-target');
    const stored = await store.put({ artifactId: 'art-7', bytes, metadata: META });
    expect((await store.verify({ contentHash: stored.contentHash })).outcome).toBe('VERIFIED');
    expect((await store.verify({ contentHash: 'sha256:' + '0'.repeat(64) })).outcome).toBe(
      'MISSING',
    );
  });

  it('refuses malformed content hashes instead of deriving a path from them', async () => {
    // A non-hash string must never reach filesystem path derivation.
    for (const hostile of ['sha256:../../etc', 'sha256:' + 'G'.repeat(64), 'objects']) {
      await expect(store.versions(hostile)).rejects.toThrow(/malformed content hash/);
    }
  });

  it('reads a metadata-scoped miss as absent, never as another identity’s version', async () => {
    const bytes = new TextEncoder().encode('identity-scoped-lookup');
    const stored = await store.put({
      artifactId: 'art-10',
      bytes,
      metadata: { ...META, rightsRef: 'license:scoped' },
    });
    // Same bytes, same address, but a DIFFERENT protection identity on disk;
    // looking up with an unrelated rights ref must not hand that version back.
    const miss = await store.get({
      contentHash: stored.contentHash,
      metadata: { ...META, rightsRef: 'license:other-party' },
    });
    expect(miss).toBeNull();
    const hit = await store.get({
      contentHash: stored.contentHash,
      metadata: { ...META, rightsRef: 'license:scoped' },
    });
    expect(hit?.stored.artifactId).toBe('art-10');
  });

  it('reports HASH_MISMATCH when stored bytes are tampered on disk', async () => {
    const bytes = new TextEncoder().encode('untampered-original');
    const stored = await store.put({ artifactId: 'art-8', bytes, metadata: META });
    const hex = stored.contentHash.slice('sha256:'.length);
    const blobPath = path.join(root, 'objects', hex.slice(0, 2), hex, `v${stored.version}.blob`);
    await writeFile(blobPath, new TextEncoder().encode('tampered!!!'));
    const verdict = await store.verify({ contentHash: stored.contentHash });
    expect(verdict.outcome).toBe('HASH_MISMATCH');
    if (verdict.outcome === 'HASH_MISMATCH') {
      expect(verdict.expected).toBe(stored.contentHash);
      expect(verdict.actual).not.toBe(stored.contentHash);
    }
  });

  it('refuses to overwrite an existing immutable blob slot', async () => {
    // Corrupt the meta sidecar away so dedup misses, then re-put the SAME
    // bytes: the next version slot must refuse to clobber what exists.
    const bytes = new TextEncoder().encode('immutable-slot');
    const stored = await store.put({ artifactId: 'art-9', bytes, metadata: META });
    const hex = stored.contentHash.slice('sha256:'.length);
    const dir = path.join(root, 'objects', hex.slice(0, 2), hex);
    await rm(path.join(dir, `v${stored.version}.meta.json`));
    await expect(
      store.put({ artifactId: 'art-9-retry', bytes, metadata: META }),
    ).rejects.toThrowError(/immutable/);
  });

  it('surfaces corrupt protection metadata instead of reporting absence', async () => {
    // Unparseable metadata is CORRUPTION, not absence — it must reject so
    // reconciliation files a corruption signal rather than fabricating a
    // MISSING_OBJECT for bytes that sit intact on disk.
    const bytes = new TextEncoder().encode('corrupt-meta-probe');
    const stored = await store.put({ artifactId: 'art-corrupt', bytes, metadata: META });
    const hex = stored.contentHash.slice('sha256:'.length);
    const metaPath = path.join(
      root,
      'objects',
      hex.slice(0, 2),
      hex,
      `v${stored.version}.meta.json`,
    );
    await writeFile(metaPath, '{ not json');

    await expect(store.get({ contentHash: stored.contentHash })).rejects.toThrow();
    await expect(store.versions(stored.contentHash)).rejects.toThrow();
    await expect(store.verify({ contentHash: stored.contentHash })).rejects.toThrow();

    // Absence itself still reads as absent (the ENOENT path is untouched).
    expect(await store.get({ contentHash: `sha256:${'ab'.repeat(32)}` })).toBeNull();
    expect(await store.versions(`sha256:${'cd'.repeat(32)}`)).toEqual([]);
  });

  it('treats unparsable protection-metadata filenames as layout corruption (EH-L2)', async () => {
    // A metadata file whose name does not parse as a version must not be
    // silently skipped — that would make stored versions invisible and
    // fabricate absence for bytes that sit intact on disk.
    const bytes = new TextEncoder().encode('meta-filename-probe');
    const stored = await store.put({ artifactId: 'art-badname', bytes, metadata: META });
    const dir = path.join(
      root,
      'objects',
      stored.contentHash.slice('sha256:'.length, 'sha256:'.length + 2),
      stored.contentHash.slice('sha256:'.length),
    );
    await writeFile(path.join(dir, 'vX.meta.json'), '{}');

    await expect(store.versions(stored.contentHash)).rejects.toThrow(/layout corruption/);
    // Non-metadata entries (blobs, stray files) are still ignored by listing.
    await writeFile(path.join(dir, 'notes.txt'), 'not metadata');
    await rm(path.join(dir, 'vX.meta.json'));
    const listed = await store.versions(stored.contentHash);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.version).toBe(stored.version);
  });
});
