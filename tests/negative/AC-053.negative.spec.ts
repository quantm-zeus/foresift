// AC-053 (negative): revoked, expired, and misused credentials are refused
// with typed errors; revocation is idempotent-guarded and unknown
// credentials never authenticate.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpCredentialStore } from '../../packages/security/src/mcp-credentials.ts';
import { visibleToolsFor, isVisibleToProfile } from '../../packages/tool-core/src/profiles.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);
const at = (s: string) => s as import('@foresift/domain').UtcTimestamp;

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
});

afterAll(async () => {
  await db.close();
});

describe('AC-053 negative: misused credentials refuse with typed errors', () => {
  let store: McpCredentialStore;
  let revokedSecret: string;
  let expiredSecret: string;
  let ipBoundSecret: string;
  let scopedSecret: string;

  beforeAll(async () => {
    let n = 0;
    const entropy = () => new Uint8Array(32).fill(++n % 256);
    store = new McpCredentialStore({
      engine,
      pepper: 'ac-053-negative-pepper-not-for-production-use',
      entropy,
      clock: () => Date.parse('2026-08-01T00:00:00Z'),
    });

    const revoked = await store.issue({
      credentialId: 'neg-revoked',
      scopes: ['tools:read'],
      originPolicyRef: 'https://mcp.example.com',
      profileBindings: ['profile-r'],
      rateLimitClass: 'STANDARD',
      expiresAt: at('2026-08-30T00:00:00Z'),
    });
    revokedSecret = revoked.secret;
    await store.revoke('neg-revoked', at('2026-08-01T06:00:00Z'));

    const expired = await store.issue({
      credentialId: 'neg-expired',
      scopes: ['tools:read'],
      originPolicyRef: 'https://mcp.example.com',
      profileBindings: ['profile-e'],
      rateLimitClass: 'STANDARD',
      expiresAt: at('2026-07-31T23:00:00Z'), // already past the frozen clock
    });
    expiredSecret = expired.secret;

    const ipBound = await store.issue({
      credentialId: 'neg-ipbound',
      scopes: ['tools:read'],
      originPolicyRef: 'https://mcp.example.com',
      profileBindings: ['profile-i'],
      rateLimitClass: 'STANDARD',
      expiresAt: at('2026-08-30T00:00:00Z'),
      ipConstraints: ['203.0.113.7'], // constraint list is exact-address
    });
    ipBoundSecret = ipBound.secret;

    const scoped = await store.issue({
      credentialId: 'neg-scoped',
      scopes: ['tools:read'],
      originPolicyRef: 'https://mcp.example.com',
      profileBindings: ['profile-s'],
      rateLimitClass: 'STANDARD',
      expiresAt: at('2026-08-30T00:00:00Z'),
    });
    scopedSecret = scoped.secret;
  });

  it('refuses REVOKED credentials', async () => {
    await expect(
      store.authenticate({ presentedSecret: revokedSecret, origin: 'https://mcp.example.com' }),
    ).rejects.toMatchObject({ code: 'SEC_CREDENTIAL_REVOKED' });
  });

  it('refuses EXPIRED credentials against the injected clock', async () => {
    await expect(
      store.authenticate({ presentedSecret: expiredSecret, origin: 'https://mcp.example.com' }),
    ).rejects.toMatchObject({ code: 'SEC_CREDENTIAL_EXPIRED' });
  });

  it('refuses origin misuse (credential bound to another Origin policy)', async () => {
    await expect(
      store.authenticate({ presentedSecret: scopedSecret, origin: 'https://evil.example.com' }),
    ).rejects.toMatchObject({ code: 'SEC_CREDENTIAL_ORIGIN_MISMATCH' });
  });

  it('refuses source-IP misuse when an allowlist is recorded', async () => {
    await expect(
      store.authenticate({
        presentedSecret: ipBoundSecret,
        origin: 'https://mcp.example.com',
        sourceIp: '198.51.100.9',
      }),
    ).rejects.toThrow();
    await expect(
      store.authenticate({
        presentedSecret: ipBoundSecret,
        origin: 'https://mcp.example.com',
        sourceIp: '203.0.113.7',
      }),
    ).resolves.toBeDefined();
  });

  it('refuses unknown secrets without leaking which IDs exist', async () => {
    await expect(
      store.authenticate({ presentedSecret: 'bogus-secret-value' }),
    ).rejects.toMatchObject({ code: 'SEC_CREDENTIAL_UNKNOWN' });
  });

  it('guards re-revocation of already-revoked credentials and unknown IDs', async () => {
    await expect(store.revoke('neg-revoked', at('2026-08-01T07:00:00Z'))).rejects.toThrow();
    await expect(store.revoke('cred-never-existed', at('2026-08-01T07:00:00Z'))).rejects.toThrow();
  });
});

describe('AC-053 negative (tool-core substrate): out-of-profile and atomic tools fail profile authorization', () => {
  it('throws AUTHORIZATION_REFUSED if a STANDARD profile requests atomic tools', () => {
    expect(() =>
      visibleToolsFor({
        id: 'discovery',
        klass: 'STANDARD',
        extraAtomicTools: ['provider_adapter_probe'],
      }),
    ).toThrow(/cannot bind provider-specific atomic tools|AUTHORIZATION_REFUSED/);
  });

  it('isVisibleToProfile returns false for atomic tools under standard profiles', () => {
    const visible = isVisibleToProfile(
      { name: 'provider_adapter_probe', atomic: true },
      { id: 'discovery', klass: 'STANDARD' },
    );
    expect(visible).toBe(false);
  });
});
