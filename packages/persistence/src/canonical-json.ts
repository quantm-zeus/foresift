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
 *
 * SHADOW-SAFE (audit HIGH): every array walk is by NUMERIC INDEX and every
 * string build is by concatenation. `.map`/`.filter`/`.sort`/`.join`/`.push`
 * and `Symbol.iterator` all read `Array.prototype` hooks an in-process caller
 * can replace at decision time; the pre-fix `map(...).join(',')` chain made
 * EVERY object serialize as `{}` under a shadowed `map`/`filter`, so distinct
 * scopes hashed identically. Inputs that merely shadow those hooks must hash
 * exactly as they do with the untouched prototype.
 */
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(
      `canonicalJson refuses non-JSON leaf value (${value === undefined ? 'undefined' : typeof value}); coercing it to null would let distinct inputs hash identically`,
    );
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    let serialized = '[';
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) serialized += ',';
      serialized += canonicalJson(value[index]);
    }
    return `${serialized}]`;
  }
  const record = value as Record<string, unknown>;
  // Numeric key sort (ascending UTF-16 code unit) — the exact order
  // `Array.prototype.sort` produces for distinct string keys — then a numeric
  // emit that drops `undefined` members.
  const keys = Object.keys(record);
  for (let index = 1; index < keys.length; index += 1) {
    const current = keys[index] as string;
    let position = index - 1;
    while (position >= 0 && (keys[position] as string) > current) {
      keys[position + 1] = keys[position] as string;
      position -= 1;
    }
    keys[position + 1] = current;
  }
  let serialized = '{';
  let emitted = 0;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index] as string;
    const member = record[key];
    if (member === undefined) continue;
    if (emitted > 0) serialized += ',';
    serialized += `${JSON.stringify(key)}:${canonicalJson(member)}`;
    emitted += 1;
  }
  return `${serialized}}`;
}

/** sha256 over UTF-8 text, in the repository's `sha256:<hex>` address form. */
export function sha256Text(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}
