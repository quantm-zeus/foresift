// OAuth token binding (T116, AC-253) and the MCP credential lifecycle
// (T117, AC-053): PKCE required, exact redirect matching, audience/resource
// binding, expiry, scope narrowing, upstream-passthrough refusal; ≥256-bit
// entropy via injectable seam, keyed hash at rest, per-dimension use
// validation, independent revocation.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OAuthBindingGuard } from '../src/oauth-binding.ts';
import { McpCredentialStore } from '../src/mcp-credentials.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
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

const NOW_MS = Date.parse('2026-08-01T00:00:00Z');

function goodBinding() {
  return {
    subject: 'user-1',
    clientId: 'mcp-client',
    redirectUri: 'https://mcp.example.com/callback',
    audience: 'foresift-mcp',
    resourceIndicator: 'https://foresift.example.com/mcp',
    scopes: ['tools:read'],
    expiresAt: at('2026-08-01T01:00:00Z'),
    pkceRequired: true as const,
  };
}

describe('oauth token binding (AC-253)', () => {
  const guard = new OAuthBindingGuard(() => NOW_MS);

  it('accepts a fully-bound grant', () => {
    const parsed = guard.validateTokenBinding({
      candidate: goodBinding(),
      registeredRedirectUris: ['https://mcp.example.com/callback'],
      registeredScopes: ['tools:read', 'tools:write'],
      expectedAudience: 'foresift-mcp',
      expectedResourceIndicator: 'https://foresift.example.com/mcp',
    });
    expect(parsed.subject).toBe('user-1');
  });

  it('refuses grants without PKCE', () => {
    expect(() =>
      guard.validateTokenBinding({
        candidate: { ...goodBinding(), pkceRequired: false },
        registeredRedirectUris: ['https://mcp.example.com/callback'],
        registeredScopes: ['tools:read'],
        expectedAudience: 'foresift-mcp',
        expectedResourceIndicator: 'https://foresift.example.com/mcp',
      }),
    ).toThrow(/PKCE/);
  });

  it('requires EXACT redirect URI equality (no normalization games)', () => {
    for (const variant of [
      'https://mcp.example.com/callback/',
      'https://mcp.example.com/callback/../callback',
      'https://mcp.example.com:443/callback',
      'https://mcp.evil.com/callback',
    ]) {
      expect(() =>
        guard.validateTokenBinding({
          candidate: { ...goodBinding(), redirectUri: variant },
          registeredRedirectUris: ['https://mcp.example.com/callback'],
          registeredScopes: ['tools:read'],
          expectedAudience: 'foresift-mcp',
          expectedResourceIndicator: 'https://foresift.example.com/mcp',
        }),
      ).toThrow(/redirect/i);
    }
  });

  it('binds audience and RFC 8707 resource indicator exactly', () => {
    expect(() =>
      guard.validateTokenBinding({
        candidate: goodBinding(),
        registeredRedirectUris: ['https://mcp.example.com/callback'],
        registeredScopes: ['tools:read'],
        expectedAudience: 'OTHER_AUDIENCE',
        expectedResourceIndicator: 'https://foresift.example.com/mcp',
      }),
    ).toThrow(/audience/i);
  });

  it('honours expiry against the injected clock', () => {
    expect(() =>
      guard.validateTokenBinding({
        candidate: { ...goodBinding(), expiresAt: at('2026-07-31T23:59:59Z') },
        registeredRedirectUris: ['https://mcp.example.com/callback'],
        registeredScopes: ['tools:read'],
        expectedAudience: 'foresift-mcp',
        expectedResourceIndicator: 'https://foresift.example.com/mcp',
      }),
    ).toThrow(/expired/i);
  });

  it('refuses scope WIDENING beyond the registered set', () => {
    expect(() =>
      guard.validateTokenBinding({
        candidate: { ...goodBinding(), scopes: ['tools:read', 'admin:*'] },
        registeredRedirectUris: ['https://mcp.example.com/callback'],
        registeredScopes: ['tools:read'],
        expectedAudience: 'foresift-mcp',
        expectedResourceIndicator: 'https://foresift.example.com/mcp',
      }),
    ).toThrow(/widen/i);
  });

  it('refuses upstream provider tokens as passthrough credentials', () => {
    expect(() =>
      guard.refuseUpstreamPassthrough({ isUpstreamIssued: true }),
    ).toThrow(/upstream/i);
    expect(() =>
      guard.refuseUpstreamPassthrough({ upstreamIssuer: 'github' }),
    ).toThrow();
    expect(() => guard.refuseUpstreamPassthrough({})).not.toThrow();
  });
});

// Deterministic 32-byte entropy seam producing DISTINCT material per call
// (counter-filled) — identical bytes would trip the keyed_hash UNIQUE rule.
function counterEntropy(): () => Uint8Array {
  let n = 0;
  return () => new Uint8Array(32).fill(++n % 256);
}

describe('mcp credential lifecycle (AC-053)', () => {
  let store: McpCredentialStore;
  let firstSecret: string;

  beforeAll(async () => {
    store = new McpCredentialStore({
      engine,
      pepper: 'test-pepper-do-not-use-in-prod-at-least-32-chars',
      entropy: counterEntropy(),
      clock: () => Date.parse('2026-08-01T00:00:00Z'),
    });
  });

  async function issue(id: string, overrides: Partial<Parameters<McpCredentialStore['issue']>[0]> = {}) {
    return store.issue({
      credentialId: id,
      scopes: ['tools:read'],
      originPolicyRef: 'https://mcp.example.com',
      profileBindings: ['profile-1'],
      rateLimitClass: 'STANDARD',
      expiresAt: at('2026-08-02T00:00:00Z'),
      ...overrides,
    });
  }

  it('mints a ≥256-bit secret shown ONCE and stores ONLY a keyed hash', async () => {
    const issued = await issue('cred-1');
    firstSecret = issued.secret;
    expect(Buffer.from(issued.secret, 'base64url').byteLength).toBe(32);

    const row = await engine.query<{ keyed_hash: string }>(
      "SELECT keyed_hash FROM sec.mcp_credentials WHERE credential_id = 'cred-1'",
    );
    expect(row.rows[0]?.keyed_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    // The raw secret must NOT appear anywhere in SQL truth.
    const leak = await engine.query(
      'SELECT * FROM sec.mcp_credentials WHERE keyed_hash LIKE $1',
      [`%${firstSecret}%`],
    );
    expect(leak.rows).toHaveLength(0);
  });

  it('authenticates valid material across every recorded dimension', async () => {
    const row = await store.authenticate({
      presentedSecret: firstSecret,
      origin: 'https://mcp.example.com',
      requestedScopes: ['tools:read'],
      sourceIp: undefined,
    });
    expect(row.credential_id).toBe('cred-1');
  });

  it('fails closed on unknown material, wrong origin, and scope excess', async () => {
    await expect(store.authenticate({ presentedSecret: 'nope' })).rejects.toMatchObject({
      code: 'SEC_CREDENTIAL_UNKNOWN',
    });
    await expect(
      store.authenticate({ presentedSecret: firstSecret, origin: 'https://evil.example.com' }),
    ).rejects.toMatchObject({ code: 'SEC_CREDENTIAL_ORIGIN_MISMATCH' });
    await expect(
      store.authenticate({
        presentedSecret: firstSecret,
        origin: 'https://mcp.example.com',
        requestedScopes: ['admin:*'],
      }),
    ).rejects.toMatchObject({ code: 'SEC_CREDENTIAL_SCOPE_EXCEEDED' });
  });

  it('enforces expiry and optional IP constraints', async () => {
    const expired = await issue('cred-expired', { expiresAt: at('2026-07-01T00:00:00Z') });
    await expect(store.authenticate({ presentedSecret: expired.secret })).rejects.toMatchObject({
      code: 'SEC_CREDENTIAL_EXPIRED',
    });

    const ipBound = await issue('cred-ipbound', { ipConstraints: ['203.0.113.7'] });
    await expect(
      store.authenticate({ presentedSecret: ipBound.secret, sourceIp: '198.51.100.9' }),
    ).rejects.toMatchObject({ code: 'SEC_CREDENTIAL_ORIGIN_MISMATCH' });
    await expect(
      store.authenticate({ presentedSecret: ipBound.secret, sourceIp: '203.0.113.7' }),
    ).resolves.toBeDefined();
  });

  it('revokes ONE credential independently; siblings keep working', async () => {
    const siblingA = await issue('cred-a', {});
    const siblingB = await issue('cred-b', {});

    await store.revoke('cred-a', at('2026-08-01T12:00:00Z'));
    await expect(store.authenticate({ presentedSecret: siblingA.secret })).rejects.toMatchObject({
      code: 'SEC_CREDENTIAL_REVOKED',
    });
    await expect(store.authenticate({ presentedSecret: siblingB.secret })).resolves.toBeDefined();

    // Double revocation refuses; unknown credentials refuse identically.
    await expect(store.revoke('cred-a', at('2026-08-01T13:00:00Z'))).rejects.toMatchObject({
      code: 'SEC_CREDENTIAL_UNKNOWN',
    });
    await expect(store.revoke('cred-never-existed', at('2026-08-01T13:00:00Z'))).rejects.toMatchObject({
      code: 'SEC_CREDENTIAL_UNKNOWN',
    });
  });

  it('records last-used metadata without weakening any other dimension', async () => {
    await store.recordUsage('cred-b', {
      at: at('2026-08-01T14:00:00Z'),
      origin: 'https://mcp.example.com',
    });
    const row = await engine.query<{ last_used_at: Date | string; last_used_origin: string | null }>(
      "SELECT last_used_at, last_used_origin FROM sec.mcp_credentials WHERE credential_id = 'cred-b'",
    );
    expect(row.rows[0]?.last_used_origin).toBe('https://mcp.example.com');
    expect(row.rows[0]?.last_used_at).not.toBeNull();
  });
});
