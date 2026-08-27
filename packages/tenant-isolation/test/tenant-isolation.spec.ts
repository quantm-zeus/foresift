/**
 * Tenant-isolation primitives (FR-SEC-009; T129–T131). Covers context
 * derivation + namespacing for every isolated surface, fail-closed row
 * scoping, signed-URL bindings, and the full cross-tenant bypass battery
 * (signed-URL, range, redirect, path confusion).
 */
import { describe, expect, it } from 'bun:test';
import {
  ARTIFACT_RANGE_READ_RIGHT,
  ResourceAccessGuard,
  RowScope,
  SignedUrlService,
  TENANT_ISOLATED_SURFACES,
  deriveModelContextPartition,
  deriveNamespacedKey,
  deriveQueueName,
  deriveSessionKey,
  deriveTenantContext,
  isolationActive,
  normalizeResourcePath,
} from '../src/index.ts';

const ALICE = deriveTenantContext({
  tenantId: 'tenant-alice',
  mode: 'PERSONAL',
  actor: 'actor-a1',
  sessionRef: 'sess-a1',
});
const BOB = deriveTenantContext({
  tenantId: 'tenant-bob',
  mode: 'WORKSPACE',
  actor: 'actor-b1',
  sessionRef: 'sess-b1',
});
const PUBLIC = deriveTenantContext({
  ...ALICE,
  mode: 'PUBLIC',
});

describe('tenant context derivation (T129)', () => {
  it('derives schema-valid contexts and rejects malformed ones', () => {
    expect(ALICE.tenantId).toBe('tenant-alice');
    expect(() => deriveTenantContext({ tenantId: '' })).toThrow(/schema validation/);
    expect(() => deriveTenantContext({ ...ALICE, mode: 'STEALTH' })).toThrow(/schema validation/);
  });

  it('treats isolation as active for everything but PUBLIC', () => {
    expect(isolationActive(ALICE)).toBe(true);
    expect(isolationActive(BOB)).toBe(true);
    expect(isolationActive(PUBLIC)).toBe(false);
  });
});

describe('namespaced keys across the isolated surfaces (T129, AC-275)', () => {
  it('derives tenant-prefixed keys for EVERY isolated surface', () => {
    for (const surface of TENANT_ISOLATED_SURFACES) {
      if (surface === 'MODEL_CONTEXT' || surface === 'SIGNED_URLS') continue; // opaque/dedicated
      const key = deriveNamespacedKey(ALICE, surface, 'item/42');
      expect(key.startsWith(`tn/tenant-alice/${surface.toLowerCase()}/`), surface).toBe(true);
      expect(key).not.toContain('tenant-bob');
    }
  });

  it('keeps tenants in disjoint namespaces even for identical keys', () => {
    const a = deriveNamespacedKey(ALICE, 'CACHE', 'portfolio/latest');
    const b = deriveNamespacedKey(BOB, 'CACHE', 'portfolio/latest');
    expect(a).not.toBe(b);
    expect(a).toContain('tn/tenant-alice/cache/');
    expect(b).toContain('tn/tenant-bob/cache/');
  });

  it('refuses traversal, absolute, empty, and NUL keys', () => {
    for (const bad of ['../escape', '/absolute', '', 'a\0b', '..\\..\\win']) {
      expect(() => deriveNamespacedKey(ALICE, 'CACHE', bad), JSON.stringify(bad)).toThrow(
        /traversal-free/,
      );
    }
  });

  it('derives OPAQUE model-context partitions that never leak tenant ids', () => {
    const a = deriveModelContextPartition(ALICE);
    const b = deriveModelContextPartition(BOB);
    expect(a).toMatch(/^iso:v1:[0-9a-f]{64}$/);
    expect(a).not.toContain('tenant-alice');
    expect(a).not.toBe(b);
    // Deterministic per tenant.
    expect(deriveModelContextPartition(ALICE)).toBe(a);
  });

  it('provides queue/session derivations through the same namespace rule', () => {
    expect(deriveQueueName(ALICE, 'alerts')).toBe('tn/tenant-alice/queues/alerts');
    expect(deriveSessionKey(BOB, 'sess-b1/state')).toBe('tn/tenant-bob/sessions/sess-b1/state');
  });
});

describe('fail-closed row scoping (T130)', () => {
  it('composes parameterized tenant predicates', () => {
    const scope = new RowScope(ALICE);
    const predicate = scope.tenantPredicate(2);
    expect(predicate.sql).toBe('"tenant_id" = $3');
    const params: unknown[] = ['x', 'y'];
    predicate.bind(params);
    expect(params).toEqual(['x', 'y', 'tenant-alice']);
  });

  it('builds scoped SELECTs with the predicate always present', () => {
    const scope = new RowScope(BOB);
    // Convention: caller placeholders number first ($1…), the tenant
    // predicate takes the next index — bind order is [...callerParams, tenantId].
    const { sql, scoped } = scope.scopedSelect('sec.import_artifacts', ['state = $1'], {
      existingParamCount: 1,
    });
    expect(scoped).toBe(true);
    // Caller clauses are parenthesized (L8) so a top-level OR inside a
    // clause can never flip precedence past the tenant predicate.
    expect(sql).toBe('SELECT * FROM sec.import_artifacts WHERE "tenant_id" = $2 AND (state = $1)');
  });

  it('REFUSES unscoped selects while isolation is active — even on request', () => {
    const scope = new RowScope(ALICE);
    expect(() => scope.scopedSelect('artifacts', [], { allowUnscoped: true })).toThrow(
      /unscoped query refused.*isolation mode is active/,
    );
  });

  it('allows explicit unscoped selects ONLY in PUBLIC mode', () => {
    const scope = new RowScope(PUBLIC);
    const { scoped } = scope.scopedSelect('public_notices', [], { allowUnscoped: true });
    expect(scoped).toBe(false);
  });

  it('asserts row ownership and refuses missing or foreign owners', () => {
    const scope = new RowScope(ALICE);
    scope.assertRowOwnership({ tenantId: 'tenant-alice' });
    expect(() => scope.assertRowOwnership({ tenantId: 'tenant-bob' })).toThrow(
      /cross-tenant row access/,
    );
    expect(() => scope.assertRowOwnership({ tenantId: null })).toThrow(/cross-tenant row access/);
    expect(() => scope.assertRowOwnership(undefined)).toThrow(/row not found within tenant scope/);
  });
});

describe('signed URLs (T131)', () => {
  const service = new SignedUrlService({ pepper: 'test-pepper', clock: () => 1_000_000 });

  it('round-trips mint → validate within audience/tenant/method/uri bindings', () => {
    const token = service.mint({
      uri: 'foresift://artifacts/tenant-alice/report.pdf',
      context: ALICE,
      audience: 'mcp',
    });
    const result = service.validate({
      token,
      audience: 'mcp',
      expectedTenantId: 'tenant-alice',
      expectedUri: 'foresift://artifacts/tenant-alice/report.pdf',
      method: 'GET',
    });
    expect(result.valid).toBe(true);
    expect(result.claims.actor).toBe('actor-a1');
  });

  it('refuses tampered payloads, wrong audiences, methods, and foreign tenants', () => {
    const token = service.mint({
      uri: 'foresift://artifacts/tenant-alice/report.pdf',
      context: ALICE,
      audience: 'mcp',
    });
    expect(() => service.validate({ token, audience: 'alpha-lab' })).toThrow(/audience mismatch/);
    expect(() => service.validate({ token, audience: 'mcp', method: 'HEAD' })).toThrow(
      /method mismatch/,
    );
    expect(() =>
      service.validate({ token, audience: 'mcp', expectedTenantId: 'tenant-bob' }),
    ).toThrow(/tenant mismatch/);

    const [version, , mac] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify([
        'v1',
        'foresift://artifacts/tenant-bob/all',
        'tenant-bob',
        'x',
        'mcp',
        'GET',
        9_999_999,
      ]),
    ).toString('base64url');
    expect(() =>
      service.validate({ token: `${version}.${forgedPayload}.${mac}`, audience: 'mcp' }),
    ).toThrow(/MAC verification failed/);
  });

  it('enforces expiry against the injected clock', () => {
    const shortLived = new SignedUrlService({
      pepper: 'p2',
      defaultTtlSeconds: 10,
      clock: () => 1_000_000,
    });
    const token = shortLived.mint({
      uri: 'foresift://cache/tenant-alice/x',
      context: ALICE,
      audience: 'mcp',
      ttlSeconds: 5,
    });
    const later = new SignedUrlService({ pepper: 'p2', clock: () => 1_100_000 });
    expect(() => later.validate({ token, audience: 'mcp' })).toThrow(/expired/);
  });
});

describe('resource-access authorization bypass battery (T131, AC-252)', () => {
  const guard = new ResourceAccessGuard({
    signedUrls: new SignedUrlService({ pepper: 'resource-access-test-pepper' }),
  });
  const aliceRequest = {
    grantedScope: 'tenant:artifact:read',
    rights: ['artifact:read'],
  };

  it('admits same-tenant URIs holding scope and rights', () => {
    const decision = guard.authorize({
      request: { uri: 'foresift://artifacts/tenant-alice/runs/r1.json', ...aliceRequest },
      context: ALICE,
      audience: 'mcp',
    });
    expect(decision.allowed).toBe(true);
    expect(decision.canonicalPath).toBe('runs/r1.json');
  });

  it('refuses cross-tenant URIs regardless of query decoration', () => {
    expect(() =>
      guard.authorize({
        request: {
          uri: 'foresift://artifacts/tenant-bob/runs/r1.json?download=1',
          ...aliceRequest,
        },
        context: ALICE,
        audience: 'mcp',
      }),
    ).toThrow(/belongs to tenant 'tenant-bob'/);
  });

  it('refuses path-confusion vectors before any fetch', () => {
    for (const uri of [
      'foresift://artifacts/tenant-alice/%2e%2e/tenant-bob/secrets',
      'foresift://artifacts/tenant-alice/runs/..%2f..%2ftenant-bob%2fx',
      'foresift://artifacts/tenant-alice/..%5c..%5ctenant-bob%5cx',
      'foresift://artifacts/tenant-alice//..//..//tenant-bob//x',
      'foresift://artifacts/tenant-alice/a/../../../tenant-bob/x',
    ]) {
      let refused = false;
      try {
        guard.authorize({ request: { uri, ...aliceRequest }, context: ALICE, audience: 'mcp' });
      } catch (error) {
        refused = true;
        // Either normalization unmasks a foreign tenant segment or the
        // escape structure itself is confusion — both refuse pre-fetch.
        expect(['CROSS_TENANT', 'PATH_CONFUSION'], uri).toContain(
          (error as { detail?: { reason?: string } }).detail?.reason,
        );
      }
      expect(refused, `must refuse: ${uri}`).toBe(true);
    }
  });

  it('refuses plainly foreign tenants as CROSS_TENANT', () => {
    try {
      guard.authorize({
        request: { uri: 'foresift://artifacts/tenant-bob/plain.txt', ...aliceRequest },
        context: ALICE,
        audience: 'mcp',
      });
      expect.unreachable();
    } catch (error) {
      expect((error as { detail?: { reason?: string } }).detail?.reason).toBe('CROSS_TENANT');
    }
  });

  it('normalizes benign paths without refusing them', () => {
    expect(normalizeResourcePath('runs/./r1.json')).toBe('runs/r1.json');
    expect(normalizeResourcePath('runs//nested///x')).toBe('runs/nested/x');
    expect(normalizeResourcePath('runs/sub/../r1.json')).toBe('runs/r1.json');
  });

  it("rejects another tenant's signed URL replayed into the query", () => {
    const bobService = new SignedUrlService({ pepper: 'bob-pepper', clock: () => 1_000_000 });
    const bobToken = bobService.mint({
      uri: 'foresift://artifacts/tenant-bob/wallet.png',
      context: BOB,
      audience: 'mcp',
    });
    // The URI's own tenant segment matches Alice, so the replay must fail at
    // the embedded-token layer (foreign MAC / tenant claim) — still refused
    // BEFORE any fetch.
    let reason: string | undefined;
    try {
      guard.authorize({
        request: {
          uri: `foresift://artifacts/tenant-alice/wallet.png?token=${encodeURIComponent(bobToken)}`,
          ...aliceRequest,
        },
        context: ALICE,
        audience: 'mcp',
      });
    } catch (error) {
      reason = (error as { detail?: { reason?: string } }).detail?.reason;
      expect((error as Error).message).toMatch(/embedded signed token invalid/);
    }
    expect(reason).toBe('SIGNED_URL_BYPASS');
  });

  it('refuses ranged reads without the dedicated right', () => {
    expect(() =>
      guard.authorize({
        request: {
          uri: 'foresift://artifacts/tenant-alice/big.bin',
          ...aliceRequest,
          rangeHeader: 'bytes=0-1023',
        },
        context: ALICE,
        audience: 'mcp',
      }),
    ).toThrow(/range-read right/);
    expect(() =>
      guard.authorize({
        request: {
          uri: 'foresift://artifacts/tenant-alice/big.bin',
          grantedScope: 'tenant:artifact:read',
          rights: ['artifact:read', ARTIFACT_RANGE_READ_RIGHT],
          rangeHeader: 'bytes=0-1023',
        },
        context: ALICE,
        audience: 'mcp',
      }),
    ).not.toThrow();
  });

  it('re-authorizes redirect targets from scratch', () => {
    expect(() =>
      guard.authorize({
        request: {
          uri: 'foresift://artifacts/tenant-alice/a.json',
          ...aliceRequest,
          redirectTarget: 'foresift://artifacts/tenant-bob/a.json',
        },
        context: ALICE,
        audience: 'mcp',
      }),
    ).toThrow(/redirect target refused/);
    expect(() =>
      guard.authorize({
        request: {
          uri: 'foresift://artifacts/tenant-alice/a.json',
          ...aliceRequest,
          redirectTarget: 'foresift://artifacts/tenant-alice/b.json',
        },
        context: ALICE,
        audience: 'mcp',
      }),
    ).not.toThrow();
  });

  it('refuses callers with no recognized scope or no rights at all', () => {
    expect(() =>
      guard.authorize({
        request: { uri: 'foresift://artifacts/tenant-alice/x', grantedScope: '', rights: [] },
        context: ALICE,
        audience: 'mcp',
      }),
    ).toThrow(/grant scope|rights/);
  });
});
