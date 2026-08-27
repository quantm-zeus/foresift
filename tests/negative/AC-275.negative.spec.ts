// AC-275 (negative): adversarial cross-tenant attempts fail closed on EVERY
// isolated surface — key collisions, unscoped queries, foreign row
// ownership, signed-URL tenant mismatch, traversal keys, opaque partitions.
import { describe, expect, it } from 'bun:test';
import {
  deriveModelContextPartition,
  deriveNamespacedKey,
  deriveTenantContext,
  isolationActive,
} from '../../packages/tenant-isolation/src/tenant-context.ts';
import { RowScope } from '../../packages/tenant-isolation/src/row-scope.ts';
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
const PUBLIC = deriveTenantContext({
  tenantId: 'tenant-public',
  mode: 'PUBLIC',
  actor: 'anon',
  sessionRef: 'sess-p',
});

const ALL_SURFACES = [
  'ROWS',
  'ARTIFACTS',
  'CACHE',
  'QUEUES',
  'SESSIONS',
  'QUOTAS',
  'LOGS',
  'METRICS',
  'SIGNED_URLS',
  'MODEL_CONTEXT',
  'RESOURCE_URIS',
] as const;

const refusalCode = (error: unknown): string => (error as { code?: string }).code ?? String(error);

describe('AC-275 negatives: cross-tenant attempts refuse on every surface', () => {
  it('all ELEVEN isolated surfaces keep alice and bob keys disjoint', () => {
    for (const surface of ALL_SURFACES) {
      const a = deriveNamespacedKey(ALICE, surface, 'shared-resource');
      const b = deriveNamespacedKey(BOB, surface, 'shared-resource');
      expect(a, surface).not.toBe(b);
      expect(a.startsWith('tn/tenant-alice/')).toBe(true);
      // Bob cannot reach alice's namespace by spelling her tenant into the key.
      expect(b.includes('tenant-alice')).toBe(false);
    }
  });

  it('unscoped queries are refused whenever isolation mode is active', () => {
    for (const context of [ALICE, BOB]) {
      expect(() =>
        new RowScope(context).scopedSelect('sec.artifacts', [], { allowUnscoped: true }),
      ).toThrowError(/unscoped query refused/);
    }
    // PUBLIC mode may go unscoped ONLY via the explicit opt-out…
    const publicSelect = new RowScope(PUBLIC).scopedSelect('sec.artifacts', [], {
      allowUnscoped: true,
    });
    expect(publicSelect.scoped).toBe(false);
    // …and even PUBLIC keeps write namespaces tenant-prefixed.
    expect(isolationActive(PUBLIC)).toBe(false);
    expect(deriveNamespacedKey(PUBLIC, 'ROWS', 'x')).toContain('tn/tenant-public/');
  });

  it('foreign row ownership (and missing rows) refuse fail-closed', () => {
    const aliceScope = new RowScope(ALICE);
    expect(() => aliceScope.assertRowOwnership({ tenantId: 'tenant-bob' })).toThrowError(
      /cross-tenant row access refused/,
    );
    // A row that "lost" its owner column refuses rather than defaulting open.
    expect(() => aliceScope.assertRowOwnership({ tenantId: undefined })).toThrowError(
      /cross-tenant row access refused/,
    );
    expect(() => aliceScope.assertRowOwnership(undefined)).toThrowError(/row not found/);
  });

  it('a minted URL validated under the WRONG tenant binding refuses', () => {
    const service = new SignedUrlService({ pepper: 'pepper-ac275-negative' });
    const token = service.mint({
      uri: 'foresift://artifacts/report.md',
      context: ALICE,
      audience: 'mcp',
    });
    try {
      service.validate({ token, audience: 'mcp', expectedTenantId: 'tenant-bob' });
      throw new Error('expected validation to refuse');
    } catch (error) {
      // Tenant-binding mismatch is an ACCESS refusal, not a malformed-token
      // refusal — the MAC itself verified.
      expect(refusalCode(error)).toBe('SEC_TENANT_RESOURCE_ACCESS_REFUSED');
      expect((error as Error).message).toMatch(/tenant mismatch/);
    }
    // The same token validates fine for its own tenant.
    expect(
      service.validate({ token, audience: 'mcp', expectedTenantId: 'tenant-alice' }).valid,
    ).toBe(true);
  });

  it('traversal and absolute keys refuse as malformed on every spelling', () => {
    const hostileKeys = ['../tenant-bob/secret', '/etc/passwd', '..\\bob', 'ok/../..', 'a\0b'];
    for (const key of hostileKeys) {
      let refused = false;
      try {
        deriveNamespacedKey(ALICE, 'ARTIFACTS', key);
      } catch (error) {
        refused = true;
        expect(refusalCode(error)).toBe('SEC_TENANT_KEY_MALFORMED');
      }
      expect(refused, key).toBe(true);
    }
    // Encoded dot-segment spellings stay inside alice's namespace — the
    // derivation is byte-literal, never URL-decoded into traversal.
    const encodedAttempt = deriveNamespacedKey(ALICE, 'ARTIFACTS', '%2e%2e-note');
    expect(encodedAttempt.startsWith('tn/tenant-alice/')).toBe(true);
  });

  it('opaque model-context partitions remain distinct AND unguessable across tenants', () => {
    const partitions = [ALICE, BOB, PUBLIC].map(deriveModelContextPartition);
    expect(new Set(partitions).size).toBe(3);
    for (const partition of partitions) {
      expect(partition).toMatch(/^iso:v1:[0-9a-f]{64}$/);
      for (const tenant of ['tenant-alice', 'tenant-bob', 'tenant-public']) {
        expect(partition.includes(tenant)).toBe(false);
      }
    }
  });
});
