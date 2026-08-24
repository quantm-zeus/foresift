/**
 * THE single canonical JSON serializer: recursively key-sorted,
 * byte-stable. Hash compatibility across observation receipt hashing,
 * evidence-bundle content addressing, and restore-drill cross-checks
 * depends on every hashing site calling THIS exact function — fork copies
 * are how indexed hashes silently drift from computed ones.
 *
 * `undefined` members of objects are dropped (a missing fact and an explicit
 * `undefined` are the same input); every other non-JSON leaf (`undefined`
 * outside object members — e.g. bare or in an array slot — plus `function`
 * and `symbol`) is REFUSED instead of being coerced to `"null"`, which would
 * make distinct inputs hash identically.
 */
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(
      `canonicalJson refuses non-JSON leaf value (${value === undefined ? 'undefined' : typeof value}); coercing it to null would let distinct inputs hash identically`,
    );
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

/** sha256 over UTF-8 text, in the repository's `sha256:<hex>` address form. */
export function sha256Text(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}
