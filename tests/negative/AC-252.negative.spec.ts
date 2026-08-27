// AC-252 (negative): a resource URI minted under tenant A NEVER resolves
// for tenant B — including through signed-URL replay, ranged reads without
// the right, redirects to foreign targets, and path-confusion vectors.
import { describe, expect, it } from 'bun:test';
import { ResourceAccessGuard } from '../../packages/tenant-isolation/src/resource-access.ts';
import type { ResourceAccessRefusalReason } from '../../packages/tenant-isolation/src/resource-access.ts';
import { SignedUrlService } from '../../packages/tenant-isolation/src/signed-url.ts';
import { deriveTenantContext } from '../../packages/tenant-isolation/src/tenant-context.ts';

const GUARD = new ResourceAccessGuard({
  signedUrls: new SignedUrlService({ pepper: 'resource-access-test-pepper' }),
});
const ALICE = deriveTenantContext({
  tenantId: 'tenant-alice',
  mode: 'WORKSPACE',
  actor: 'alice@example.com',
  sessionRef: 'sess-a-1',
});
const SCOPE = 'tenant:artifact-read';
const RIGHTS = ['artifact:read'];

function refusalOf(run: () => unknown): ResourceAccessRefusalReason {
  try {
    run();
  } catch (error) {
    const detail = (error as Error & { detail?: { reason?: string } }).detail;
    const reason = detail?.reason;
    if (reason !== undefined) return reason as ResourceAccessRefusalReason;
    throw new Error(`expected a typed refusal reason, got: ${(error as Error).message}`);
  }
  throw new Error('expected the access attempt to be REFUSED');
}

describe('AC-252 negative: cross-tenant and bypass attempts all refuse', () => {
  it('refuses plain foreign-tenant URIs as CROSS_TENANT', () => {
    expect(
      refusalOf(() =>
        GUARD.authorize({
          request: {
            uri: 'foresift://artifacts/tenant-bob/private.md',
            grantedScope: SCOPE,
            rights: RIGHTS,
          },
          context: ALICE,
          audience: 'mcp',
        }),
      ),
    ).toBe('CROSS_TENANT');
  });

  it('refuses percent-encoded slash traversal into another tenant', () => {
    const reason = refusalOf(() =>
      GUARD.authorize({
        request: {
          uri: 'foresift://artifacts/tenant-alice/%2e%2e%2ftenant-bob%2fsecret.md',
          grantedScope: SCOPE,
          rights: RIGHTS,
        },
        context: ALICE,
        audience: 'mcp',
      }),
    );
    expect(['PATH_CONFUSION', 'CROSS_TENANT']).toContain(reason);
  });

  it('refuses dot-segment escapes above the tenant root', () => {
    expect(
      refusalOf(() =>
        GUARD.authorize({
          request: {
            uri: 'foresift://artifacts/tenant-alice/../../tenant-bob/x.md',
            grantedScope: SCOPE,
            rights: RIGHTS,
          },
          context: ALICE,
          audience: 'mcp',
        }),
      ),
    ).toBe('PATH_CONFUSION');
  });

  it('refuses backslash confusion in BOTH raw and decoded forms', () => {
    for (const uri of [
      'foresift://artifacts/tenant-alice\\..\\tenant-bob\\x.md',
      'foresift://artifacts/tenant-alice/..%5c..%5ctenant-bob%5cx.md',
    ]) {
      const reason = refusalOf(() =>
        GUARD.authorize({
          request: { uri, grantedScope: SCOPE, rights: RIGHTS },
          context: ALICE,
          audience: 'mcp',
        }),
      );
      expect(['PATH_CONFUSION', 'CROSS_TENANT'], uri).toContain(reason);
    }
  });

  it('refuses tampered or replayed embedded signed tokens', () => {
    // Same tenant, same shape — but the presented token was minted by an
    // attacker and fails MAC verification; it must never confer access.
    const reason = refusalOf(() =>
      GUARD.authorize({
        request: {
          uri: 'foresift://artifacts/tenant-alice/shared.md?token=v1.c2t1Yi5jbGFpbQ.forged-mac',
          grantedScope: SCOPE,
          rights: RIGHTS,
        },
        context: ALICE,
        audience: 'mcp',
      }),
    );
    expect(reason).toBe('SIGNED_URL_BYPASS');
  });

  it('refuses callers with NO recognized scope or empty rights', () => {
    expect(
      refusalOf(() =>
        GUARD.authorize({
          request: {
            uri: 'foresift://artifacts/tenant-alice/a.md',
            grantedScope: 'wallet:drain',
            rights: RIGHTS,
          },
          context: ALICE,
          audience: 'mcp',
        }),
      ),
    ).toBe('SIGNED_URL_BYPASS');
    expect(
      refusalOf(() =>
        GUARD.authorize({
          request: {
            uri: 'foresift://artifacts/tenant-alice/a.md',
            grantedScope: SCOPE,
            rights: [],
          },
          context: ALICE,
          audience: 'mcp',
        }),
      ),
    ).toBe('SIGNED_URL_BYPASS');
  });

  it('refuses RANGED reads without the range-read right', () => {
    expect(
      refusalOf(() =>
        GUARD.authorize({
          request: {
            uri: 'foresift://artifacts/tenant-alice/blob.bin',
            grantedScope: SCOPE,
            rights: RIGHTS,
            rangeHeader: 'bytes=0-1023',
          },
          context: ALICE,
          audience: 'mcp',
        }),
      ),
    ).toBe('RANGE_BYPASS');
  });

  it('refuses REDIRECTS that hop to another tenant', () => {
    expect(
      refusalOf(() =>
        GUARD.authorize({
          request: {
            uri: 'foresift://artifacts/tenant-alice/a.md',
            grantedScope: SCOPE,
            rights: RIGHTS,
            redirectTarget: 'foresift://artifacts/tenant-bob/b.md',
          },
          context: ALICE,
          audience: 'mcp',
        }),
      ),
    ).toBe('REDIRECT_BYPASS');
  });
});
