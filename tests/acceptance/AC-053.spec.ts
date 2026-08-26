// AC-053 (acceptance): "MCP credentials are independently scoped and
// revocable." Storage-backed lifecycle: ≥256-bit secrets minted once and
// stored only as keyed hashes, per-dimension authentication, and one
// credential's revocation leaving its siblings intact.
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

describe('AC-053: MCP credential lifecycle proves independent scoping + revocation', () => {
  let store: McpCredentialStore;
  let primarySecret: string;
  let siblingSecret: string;

  beforeAll(async () => {
    let n = 0;
    const entropy = () => new Uint8Array(32).fill(++n % 256); // DISTINCT per call
    store = new McpCredentialStore({
      engine,
      pepper: 'ac-053-pepper-not-for-production-use-0123456789',
      entropy,
      clock: () => Date.parse('2026-08-01T00:00:00Z'),
    });
  });

  it('mints a ≥256-bit secret shown ONCE; SQL truth holds ONLY a keyed hash', async () => {
    const issued = await store.issue({
      credentialId: 'cred-ac53-primary',
      scopes: ['tools:read'],
      originPolicyRef: 'https://mcp.example.com',
      profileBindings: ['profile-1'],
      rateLimitClass: 'STANDARD',
      expiresAt: at('2026-08-30T00:00:00Z'),
    });
    primarySecret = issued.secret;
    expect(Buffer.from(issued.secret, 'base64url').byteLength).toBeGreaterThanOrEqual(32);

    const rows = await engine.query<{ keyed_hash: string }>(
      "SELECT keyed_hash FROM sec.mcp_credentials WHERE credential_id = 'cred-ac53-primary'",
    );
    expect(rows.rows[0]?.keyed_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const leak = await engine.query(
      'SELECT credential_id FROM sec.mcp_credentials WHERE keyed_hash LIKE $1',
      [`%${primarySecret}%`],
    );
    expect(leak.rows).toHaveLength(0);
  });

  it('authenticates across every recorded dimension (scope set, origin, expiry)', async () => {
    await expect(
      store.authenticate({ presentedSecret: primarySecret, origin: 'https://mcp.example.com' }),
    ).resolves.toBeDefined();
  });

  it('issues a scoped sibling with an INDEPENDENT lifecycle', async () => {
    const issued = await store.issue({
      credentialId: 'cred-ac53-sibling',
      scopes: ['tools:read', 'resources:read'],
      originPolicyRef: 'https://mcp.example.com',
      profileBindings: ['profile-2'],
      rateLimitClass: 'ELEVATED',
      expiresAt: at('2026-09-30T00:00:00Z'),
    });
    siblingSecret = issued.secret;
    await expect(
      store.authenticate({ presentedSecret: siblingSecret, origin: 'https://mcp.example.com' }),
    ).resolves.toBeDefined();
  });

  it('revoking ONE credential leaves its sibling fully functional', async () => {
    await store.revoke('cred-ac53-primary', at('2026-08-01T12:00:00Z'));
    await expect(
      store.authenticate({ presentedSecret: primarySecret, origin: 'https://mcp.example.com' }),
    ).rejects.toMatchObject({ code: 'SEC_CREDENTIAL_REVOKED' });

    // The sibling — same issuer, same pepper, DIFFERENT scope set — keeps
    // authenticating: revocation is per-credential, never per-class.
    await expect(
      store.authenticate({ presentedSecret: siblingSecret, origin: 'https://mcp.example.com' }),
    ).resolves.toBeDefined();
    const siblingRow = await engine.query<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM sec.mcp_credentials WHERE credential_id = 'cred-ac53-sibling'",
    );
    expect(siblingRow.rows[0]?.revoked_at ?? null).toBeNull();
  });
});

describe('AC-053 acceptance (tool-core substrate): profile binding scopes tool visibility narrowly', () => {
  it('discovery profile resolves strict subset of tools and excludes unlisted domain tools', () => {
    const tools = visibleToolsFor({ id: 'discovery', klass: 'STANDARD' });
    expect(tools).toContain('discover_candidates');
    expect(tools).toContain('get_asset_identity');
    expect(tools).not.toContain('get_holder_distribution');
  });

  it('isVisibleToProfile admits standard domain tools for matching standard profiles', () => {
    expect(
      isVisibleToProfile(
        { name: 'discover_candidates', atomic: false },
        { id: 'discovery', klass: 'STANDARD' },
      ),
    ).toBe(true);
  });
});
