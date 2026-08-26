/**
 * Exact cache keys (FR-CORE-006; PRD §16.4). A key is sha256 over THE
 * canonical JSON of exactly the nine mandated components — provider,
 * operation, operation version, chain, canonical entity identity, normalized
 * arguments, field projection, as-of semantics, license policy. Canonical
 * JSON sorts object keys recursively, so semantically identical argument
 * objects hash identically.
 *
 * Semantic caching MUST NOT be used for financial or identity data (§16.4).
 * This module is the only cache-key authority in tool-core: no semantic key
 * constructor exists at all, and `assertExactOnlyCaching` refuses any
 * semantic request fail-closed — categorically for financial/identity, and
 * for every other class too because the system implements exact caching only.
 */
import { ForesiftError } from '@foresift/domain';
import type { CacheKeyComponents } from '@foresift/shared-schemas';
import { CacheKeyComponentsSchema } from '@foresift/shared-schemas';
import { canonicalJson, sha256Text } from '@foresift/persistence';

export interface ExactCacheKey {
  /** Byte-stable canonical JSON of the nine components. */
  readonly canonicalJson: string;
  /** `sha256:<hex>` over the canonical JSON — the SQL primary-key shape. */
  readonly cacheKeyHash: string;
}

/** Validate then hash. Refuses anything beyond the nine mandated components. */
export function computeExactCacheKey(components: CacheKeyComponents): ExactCacheKey {
  const parsed = CacheKeyComponentsSchema.parse(components);
  const canonical = canonicalJson(parsed);
  return { canonicalJson: canonical, cacheKeyHash: sha256Text(canonical) };
}

/** Data sensitivity classes relevant to §16.4's semantic-cache prohibition. */
export type SensitiveDataClass = 'FINANCIAL' | 'IDENTITY' | 'OTHER';

/**
 * Fail-closed strategy admission. SEMANTIC is refused for FINANCIAL and
 * IDENTITY categorically (the §16.4 prohibition), and refused for OTHER
 * because tool-core implements exact caching only — there is no semantic
 * path to fall back to.
 */
export function assertExactOnlyCaching(request: {
  requestedStrategy: 'EXACT' | 'SEMANTIC';
  dataClass: SensitiveDataClass;
}): void {
  if (request.requestedStrategy === 'EXACT') return;
  const prohibited = request.dataClass === 'FINANCIAL' || request.dataClass === 'IDENTITY';
  throw new ForesiftError(
    'SEMANTIC_CACHE_FORBIDDEN',
    prohibited
      ? `semantic caching MUST NOT be used for ${request.dataClass.toLowerCase()} data`
      : 'tool-core provides exact caching only',
    { dataClass: request.dataClass },
  );
}
