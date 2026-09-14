/**
 * Shadow-safe numeric array primitives for release-conformance (audit HIGH:
 * in-process `Array.prototype` shadowing).
 *
 * A caller that shadows `Array.prototype.push`/`Symbol.iterator`/`sort`/`filter`
 * at decision time must not be able to make a finding/failure collection look
 * empty and so turn a FAILED release verdict into `PASSED`. These helpers walk
 * by numeric index only and never touch `Array.prototype`. The module-init
 * intrinsics (`Object.freeze`, `Object.keys`, `Array.isArray`) are read at
 * import time and are explicitly out of the declared threat model.
 */

/**
 * The genuine `Array.prototype[Symbol.iterator]`, captured once at module init.
 * Shadowing the prototype BEFORE this module is imported is out of scope (D018),
 * but every later in-process shadow must not be able to rewrite the iteration
 * protocol of the arrays `promiseAllNumeric` hands to `Promise.all`.
 */
const capturedArrayIterator: (this: unknown) => IterableIterator<unknown> = Array.prototype[
  Symbol.iterator
] as (this: unknown) => IterableIterator<unknown>;

/**
 * Shadow-safe `Promise.all`. `Promise.all(iterable)` reads
 * `Array.prototype[Symbol.iterator]` on its ARGUMENT array, so a surgical
 * iterator can substitute forged resolved values before the settled tuple is
 * read. This aggregator copies `items` by numeric index (never spread/`.push`/
 * `.map`) into an array that carries its OWN captured `Symbol.iterator`, so the
 * builtin never consults the shadowable prototype. Concurrency and settled-array
 * ordering are identical to `Promise.all`.
 */
export function promiseAllNumeric<T extends readonly unknown[] | []>(
  items: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const promises: Promise<unknown>[] = [];
  for (let index = 0; index < items.length; index += 1) {
    promises[index] = items[index] as Promise<unknown>;
  }
  Object.defineProperty(promises, Symbol.iterator, {
    value: capturedArrayIterator,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return Promise.all(promises) as Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }>;
}

/**
 * Numeric-index equivalent of `Object.fromEntries` for a settled array of
 * `[key, value]` pairs; `Object.fromEntries` iterates its argument, so a
 * shadowed `Array.prototype[Symbol.iterator]` could forge an empty record.
 * Uses `Object.defineProperty` to match `Object.fromEntries`' CreateDataProperty
 * semantics (a `__proto__` key stays an own data property).
 */
export function numericFromEntries(
  entries: readonly (readonly [string, string])[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as readonly [string, string];
    Object.defineProperty(result, entry[0], {
      value: entry[1],
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

/** A numeric-index copy of `source`; never uses spread or `.slice`. */
export function numericCopy<T>(source: readonly T[]): T[] {
  const copy: T[] = [];
  for (let index = 0; index < source.length; index += 1) {
    copy[copy.length] = source[index] as T;
  }
  return copy;
}

/** Numeric membership; never `Array.prototype.includes`/`indexOf`. */
export function numericIncludes<T>(values: readonly T[], candidate: T): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === candidate) return true;
  }
  return false;
}

/** Numeric-index filter of `source` by `predicate`; never `.filter`. */
export function numericFilter<T>(
  source: readonly T[],
  predicate: (value: T, index: number) => boolean,
): T[] {
  const filtered: T[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index] as T;
    if (predicate(value, index)) filtered[filtered.length] = value;
  }
  return filtered;
}

/** Numeric-index map of `source` by `project`; never `.map`. */
export function numericMap<T, R>(
  source: readonly T[],
  project: (value: T, index: number) => R,
): R[] {
  const mapped: R[] = [];
  for (let index = 0; index < source.length; index += 1) {
    mapped[mapped.length] = project(source[index] as T, index);
  }
  return mapped;
}

/** Numeric-index `some`; never `.some`. */
export function numericSome<T>(
  source: readonly T[],
  predicate: (value: T, index: number) => boolean,
): boolean {
  for (let index = 0; index < source.length; index += 1) {
    if (predicate(source[index] as T, index)) return true;
  }
  return false;
}

/**
 * A stable, numeric-only insertion sort of strings, ascending by UTF-16 code
 * unit (the default `Array.prototype.sort` order) unless `descending`. Never
 * uses `.sort` and never mutates `source`.
 */
export function numericSortStrings<T extends string>(
  source: readonly T[],
  descending = false,
): T[] {
  const sorted = numericCopy(source);
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index] as T;
    let position = index - 1;
    while (
      position >= 0 &&
      (descending ? (sorted[position] as T) < current : (sorted[position] as T) > current)
    ) {
      sorted[position + 1] = sorted[position] as T;
      position -= 1;
    }
    sorted[position + 1] = current;
  }
  return sorted;
}

/**
 * Numeric-index `join`; never `Array.prototype.join`. Used for finding
 * MESSAGES (audit M1): a shadowed `join` returning a non-string made the
 * release-gate message template throw, converting a clean FAILED verdict into
 * an uncaught throw.
 */
export function numericJoin(source: readonly unknown[], separator = ', '): string {
  let joined = '';
  for (let index = 0; index < source.length; index += 1) {
    if (index > 0) joined += separator;
    const value = source[index];
    joined += value === undefined || value === null ? '' : String(value);
  }
  return joined;
}

/** A stable, numeric-only insertion sort of `source` by `compare`; never `.sort`. */
export function numericSortWith<T>(
  source: readonly T[],
  compare: (left: T, right: T) => number,
): T[] {
  const sorted = numericCopy(source);
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index] as T;
    let position = index - 1;
    while (position >= 0 && compare(sorted[position] as T, current) > 0) {
      sorted[position + 1] = sorted[position] as T;
      position -= 1;
    }
    sorted[position + 1] = current;
  }
  return sorted;
}

/**
 * Numeric-index flat projection of `source` into `project` results, in order;
 * never `.flatMap` or array spread.
 */
export function numericFlatMap<T, R>(
  source: readonly T[],
  project: (value: T, index: number) => readonly R[],
): R[] {
  const flattened: R[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const projected = project(source[index] as T, index);
    for (let innerIndex = 0; innerIndex < projected.length; innerIndex += 1) {
      flattened[flattened.length] = projected[innerIndex] as R;
    }
  }
  return flattened;
}

/**
 * Materialize a caller-supplied plain-data value exactly ONCE (V7 accessor
 * class). Every own property and array element is read a single time into a
 * frozen null-prototype snapshot, so a getter or Proxy cannot present one value
 * to an authorization/validity CHECK and a different value to what is CONSUMED,
 * persisted or returned. Shared (DAG) nodes are snapshotted once and reused; a
 * true cycle is refused. Branded objects must not be passed through this helper.
 */
export function snapshotCallerInput<T>(value: T): T {
  return snapshotValue(value, new Map<object, unknown>(), new WeakSet<object>()) as T;
}

function snapshotValue(value: unknown, memo: Map<object, unknown>, path: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (path.has(value)) throw new TypeError('cyclic caller input is not supported');
  const existing = memo.get(value);
  if (existing !== undefined) return existing;
  path.add(value);
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    memo.set(value, copy);
    for (let index = 0; index < value.length; index += 1) {
      copy[copy.length] = snapshotValue(value[index], memo, path);
    }
    Object.freeze(copy);
    path.delete(value);
    return copy;
  }
  // Immutable self-contained carriers are copied, not refused: their indexed
  // reads are not interceptable and they carry no getter state.
  if (value instanceof Uint8Array) {
    path.delete(value);
    return value.slice();
  }
  if (value instanceof ArrayBuffer) {
    path.delete(value);
    return value.slice(0);
  }
  if (value instanceof Date) {
    path.delete(value);
    return new Date(value.getTime());
  }
  // Every other non-plain carrier (class instance, boxed primitive, Map/Set,
  // Proxy with a `getPrototypeOf` trap) is REFUSED, never passed through by
  // reference: passing it through kept its live getters and re-opened the whole
  // accessor class inside every wrapped function (V7 round 6). A caller that
  // needs a branded/identity value must pass it in a field the boundary keeps by
  // reference, not through this helper.
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    path.delete(value);
    throw new TypeError('non-plain caller input is not supported');
  }
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  memo.set(value, copy);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index] as string;
    copy[key] = snapshotValue(source[key], memo, path);
  }
  Object.freeze(copy);
  path.delete(value);
  return copy;
}
