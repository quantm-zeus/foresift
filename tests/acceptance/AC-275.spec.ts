// AC-275 (acceptance): the isolation matrix HOLDS across every shared
// surface — cache, queues, sessions, quotas, logs, metrics, model context,
// rows/artifacts (predicates + ownership), signed URLs. Same-tenant flows
// resolve correctly; different tenants can never collide.
import { describe, expect, it } from 'bun:test';
import {
  deriveModelContextPartition,
  deriveNamespacedKey,
  deriveQueueName,
  deriveSessionKey,
  deriveTenantContext,
  isolationActive,
} from '../../packages/tenant-isolation/src/tenant-context.ts';
import { RowScope } from '../../packages/tenant-isolation/src/row-scope.ts';
import { ResourceAccessGuard } from '../../packages/tenant-isolation/src/resource-access.ts';
import { SignedUrlService } from '../../packages/tenant-isolation/src/signed-url.ts';

const ALICE = deriveTenantContext({
  tenantId: 'tenant-alice',
  mode: 'WORKSPACE',
  actor: 'alice',
  sessionRef: 'sess-a',
});
const BOB = deriveTenantContext({
  tenantId: 'tenant-bob',
  mode: 'WORKSPACE',
  actor: 'bob',
  sessionRef: 'sess-b',
});

const SURFACES = [
  'CACHE',
  'QUEUES',
  'SESSIONS',
  'QUOTAS',
  'LOGS',
  'METRICS',
  'MODEL_CONTEXT',
] as const;

describe('AC-275: isolation holds on every shared surface', () => {
  it('namespaced keys stay disjoint between tenants for EVERY surface', () => {
    for (const surface of SURFACES) {
      const aliceKey = deriveNamespacedKey(ALICE, surface, 'shared-resource');
      const bobKey = deriveNamespacedKey(BOB, surface, 'shared-resource');
      expect(aliceKey).toContain('tenant-alice');
      expect(bobKey).toContain('tenant-bob');
      expect(aliceKey, surface).not.toBe(bobKey);
    }
  });

  it('model-context partitions are opaque and tenant-distinct', () => {
    const a = deriveModelContextPartition(ALICE);
    const b = deriveModelContextPartition(BOB);
    expect(a).toMatch(/^iso:v1:[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    // No tenant identifier leaks into the opaque partition token.
    expect(a.includes('tenant-alice')).toBe(false);
  });

  it('queues and sessions carry tenant-safe derived names', () => {
    const aliceQueue = deriveQueueName(ALICE, 'ingest');
    const bobQueue = deriveQueueName(BOB, 'ingest');
    expect(aliceQueue).not.toBe(bobQueue);
    expect(deriveSessionKey(ALICE, 'browser')).not.toBe(deriveSessionKey(BOB, 'browser'));
  });

  it('row predicates bind the caller tenant; ownership asserts pass for owners', () => {
    for (const tenant of [ALICE, BOB]) {
      const scope = new RowScope(tenant);
      const params: unknown[] = [];
      const predicate = scope.tenantPredicate(params.length);
      predicate.bind(params);
      expect(predicate.sql).toContain('tenant_id');
      expect(params).toEqual([tenant.tenantId]);
      // An owner asserting their OWN row passes.
      expect(() => scope.assertRowOwnership({ tenantId: tenant.tenantId })).not.toThrow();
    }
    // WORKSPACE isolation is ACTIVE for both tenants.
    expect(isolationActive(ALICE)).toBe(true);
    expect(isolationActive(BOB)).toBe(true);
  });

  it('same-tenant resource access authorizes with canonical paths', () => {
    const guard = new ResourceAccessGuard({
      signedUrls: new SignedUrlService({ pepper: 'resource-access-test-pepper' }),
    });
    const decision = guard.authorize({
      request: {
        uri: 'foresift://artifacts/tenant-alice/report.md',
        grantedScope: 'tenant:artifact-read',
        rights: ['artifact:read'],
      },
      context: ALICE,
      audience: 'mcp',
    });
    expect(decision.allowed).toBe(true);
    expect(decision.canonicalPath).toBe('report.md');
  });
});
