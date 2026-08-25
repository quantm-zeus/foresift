/**
 * Exact cache-key units (FR-CORE-006, §16.4): golden vectors pin the
 * byte-stable canonical JSON and sha256 hash of the nine mandated components
 * (tests/fixtures/core/cache-key-golden.json), member-order-insensitive
 * argument objects hash identically while any semantic difference (as-of,
 * license policy) produces a different key, and every semantic-cache request
 * is refused fail-closed — categorically for financial/identity data.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertExactOnlyCaching,
  computeExactCacheKey,
  type SensitiveDataClass,
} from '../src/cache-key.ts';
import type { CacheKeyComponents } from '@foresift/shared-schemas';

const GOLDEN = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../../tests/fixtures/core/cache-key-golden.json'),
    'utf8',
  ),
) as Array<{
  label: string;
  components: CacheKeyComponents;
  expectedCanonicalJson: string;
  expectedCacheKeyHash: string;
}>;

describe('exact cache key golden vectors', () => {
  it.each(GOLDEN.map((v) => [v.label, v] as const))('%s', (_label, vector) => {
    const key = computeExactCacheKey(vector.components);
    expect(key.canonicalJson).toBe(vector.expectedCanonicalJson);
    expect(key.cacheKeyHash).toBe(vector.expectedCacheKeyHash);
    expect(key.cacheKeyHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('pins distinct keys for semantically distinct components', () => {
    const hashes = GOLDEN.map((v) => computeExactCacheKey(v.components).cacheKeyHash);
    // Vectors 0 and 1 are the same semantics (member order only); every other
    // pair must differ.
    expect(hashes[0]).toBe(hashes[1]);
    expect(new Set(hashes).size).toBe(GOLDEN.length - 1);
  });
});

describe('semantic-cache prohibition (§16.4)', () => {
  it.each(['FINANCIAL', 'IDENTITY'] as const)(
    'refuses SEMANTIC caching for %s data categorically',
    (dataClass) => {
      expect(() => assertExactOnlyCaching({ requestedStrategy: 'SEMANTIC', dataClass })).toThrow(
        /SEMANTIC_CACHE_FORBIDDEN|semantic/i,
      );
      expect(() =>
        assertExactOnlyCaching({
          requestedStrategy: 'EXACT',
          dataClass: dataClass as SensitiveDataClass,
        }),
      ).not.toThrow();
    },
  );

  it('refuses SEMANTIC for other classes too — tool-core has exact caching only', () => {
    expect(() =>
      assertExactOnlyCaching({ requestedStrategy: 'SEMANTIC', dataClass: 'OTHER' }),
    ).toThrow();
  });

  it('admits EXACT strategy for every data class', () => {
    for (const dataClass of ['FINANCIAL', 'IDENTITY', 'OTHER'] as const) {
      expect(() => assertExactOnlyCaching({ requestedStrategy: 'EXACT', dataClass })).not.toThrow();
    }
  });
});
