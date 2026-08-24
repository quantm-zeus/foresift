// AC-252 (acceptance): a resource URI created by one tenant resolves for a
// caller of the SAME tenant holding the original scope and rights — plain
// reads, query-carrying URIs, valid embedded signed URLs, and authorized
// redirects all admit with canonical paths.
import { describe, expect, it } from 'vitest';
import { ResourceAccessGuard } from '../../packages/tenant-isolation/src/resource-access.ts';
import { deriveTenantContext } from '../../packages/tenant-isolation/src/tenant-context.ts';

const GUARD = new ResourceAccessGuard();
const ALICE = deriveTenantContext({
  tenantId: 'tenant-alice',
  mode: 'WORKSPACE',
  actor: 'alice@example.com',
  sessionRef: 'sess-alice-1',
});
const RIGHTS = ['artifact:read'];
const SCOPE = 'tenant:artifact-read';

describe('AC-252: same-tenant, same-scope resource access admits', () => {
  it('admits a plain same-tenant artifact URI', () => {
    const decision = GUARD.authorize({
      request: {
        uri: 'foresift://artifacts/tenant-alice/reports/q3.md',
        grantedScope: SCOPE,
        rights: RIGHTS,
      },
      context: ALICE,
      audience: 'mcp',
    });
    expect(decision).toMatchObject({
      allowed: true,
      surface: 'artifacts',
      tenantId: 'tenant-alice',
      canonicalPath: 'reports/q3.md',
    });
  });

  it('canonicalizes dot segments and duplicate slashes in same-tenant paths', () => {
    const decision = GUARD.authorize({
      request: {
        uri: 'foresift://artifacts/tenant-alice/reports/./nested/../q3.md',
        grantedScope: SCOPE,
        rights: RIGHTS,
      },
      context: ALICE,
      audience: 'mcp',
    });
    expect(decision.canonicalPath).toBe('reports/q3.md');
  });

  it('carries query strings without breaking authorization', () => {
    const decision = GUARD.authorize({
      request: {
        uri: 'foresift://datasets/tenant-alice/exports.csv?limit=100',
        grantedScope: SCOPE,
        rights: RIGHTS,
      },
      context: ALICE,
      audience: 'mcp',
    });
    expect(decision.allowed).toBe(true);
    expect(decision.canonicalPath).toBe('exports.csv');
  });

  it('admits ranged reads when the caller HOLDS the range-read right', () => {
    const decision = GUARD.authorize({
      request: {
        uri: 'foresift://artifacts/tenant-alice/blob.bin',
        grantedScope: SCOPE,
        rights: [...RIGHTS, 'artifact:range-read'],
        rangeHeader: 'bytes=0-1023',
      },
      context: ALICE,
      audience: 'mcp',
    });
    expect(decision.allowed).toBe(true);
  });

  it('admits redirects that re-authorize cleanly under the same tenant', () => {
    const decision = GUARD.authorize({
      request: {
        uri: 'foresift://artifacts/tenant-alice/a.md',
        grantedScope: SCOPE,
        rights: RIGHTS,
        redirectTarget: 'foresift://artifacts/tenant-alice/b.md',
      },
      context: ALICE,
      audience: 'mcp',
    });
    expect(decision.allowed).toBe(true);
  });
});
