/**
 * Shadow-safe numeric array primitives for release-conformance (audit HIGH:
 * in-process `Array.prototype` shadowing).
 *
 * A caller that shadows `Array.prototype.push`/`Symbol.iterator`/`sort`/`filter`
 * at decision time must not be able to make a finding/failure collection look
 * empty and so turn a FAILED release verdict into `PASSED`. These helpers walk
 * by numeric index only and never touch `Array.prototype`. The module-init
 * intrinsics (`Object.freeze`, `Object.create`, `Object.getOwnPropertyNames`,
 * `Array.isArray`) are captured at import time so a LATER shadow cannot
 * neutralize them.
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
    // `appendSafe`, never `promises[index] = ...` (V7 round 10): a prototype-chain
    // index accessor beyond the guard's walk cap (or a Proxy) swallowed the raw
    // assignment, leaving `Promise.all` with an empty array whose later reads the
    // accessor fabricated — flipping the release gate FAILED -> PASSED.
    appendSafe(promises, items[index] as Promise<unknown>);
  }
  capturedDefineProperty(promises, Symbol.iterator, {
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
    appendSafe(copy, source[index] as T);
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
    if (predicate(value, index)) appendSafe(filtered, value);
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
    appendSafe(mapped, project(source[index] as T, index));
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
      appendSafe(flattened, projected[innerIndex] as R);
    }
  }
  return flattened;
}

/** Captured intrinsics: a caller subclass/Proxy must not control the copy. */
const capturedTypedArrayLengthGetter: ((this: unknown) => unknown) | undefined =
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length')?.get as
    ((this: unknown) => unknown) | undefined;
const capturedArrayBufferByteLengthGetter: ((this: unknown) => unknown) | undefined =
  Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get as
    ((this: unknown) => unknown) | undefined;
const capturedDateGetTime: (this: unknown) => number = Date.prototype.getTime;

const capturedDefineProperty = Object.defineProperty;
const capturedGetOwnPropertyNames = Object.getOwnPropertyNames;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedCreate = Object.create;
const capturedToString = Object.prototype.toString;
/**
 * `Array.isArray` is a STATIC, but shadowing it (`Array.isArray = () => true`)
 * collapses a plain-object snapshot into an EMPTY array (the object has no
 * numeric length), so a field the guard must see reads as absent. Capture the
 * genuine detector at module init so the shadow cannot neutralize it.
 */
const capturedIsArray: (value: unknown) => value is unknown[] = Array.isArray;

/**
 * Upper bound on a single snapshot's element/key count. A Proxy declaring a
 * bogus `length` (or `ownKeys`) could otherwise force an unbounded allocation
 * and hang the gate. Real caller DTOs are far below these.
 */
const SNAPSHOT_MAX_ARRAY = 1_000_000;
const SNAPSHOT_MAX_KEYS = 100_000;

/**
 * Fail closed when `Array.prototype` carries an integer-index accessor. Such a
 * setter silently swallows `array[array.length] = value` (the numeric-append
 * pattern used throughout the authority paths), so a 2-element array can become
 * empty and a FAILED verdict PASSED (V7 review round 7). The shadow is detected
 * once at every snapshot boundary.
 */
export function assertNoHostileArrayIndexShadow(): void {
  // Walk the WHOLE prototype chain (Array.prototype -> Object.prototype -> null):
  // an integer-index accessor on an INHERITED prototype swallows
  // `array[array.length] = value` just as an own one does, so an own-property
  // scan was bypassable via `Object.prototype[0]` or
  // `setPrototypeOf(Array.prototype, hostile)` (V7 review round 8).
  let proto: object | null = Array.prototype;
  let depth = 0;
  while (proto !== null && depth < 32) {
    const names = capturedGetOwnPropertyNames(proto);
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index] as string;
      if (!/^\d+$/.test(name)) continue;
      const descriptor = capturedGetOwnPropertyDescriptor(proto, name);
      if (
        descriptor !== undefined &&
        (descriptor.get !== undefined || descriptor.set !== undefined)
      ) {
        throw new TypeError(
          'the array prototype chain carries an integer-index accessor (hostile shadow); numeric appends cannot be trusted',
        );
      }
    }
    proto = capturedGetPrototypeOf(proto) as object | null;
    depth += 1;
  }
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
  assertNoHostileArrayIndexShadow();
  return snapshotValue(value, new Map<object, unknown>(), new WeakSet<object>()) as T;
}

function snapshotValue(value: unknown, memo: Map<object, unknown>, path: WeakSet<object>): unknown {
  if (value === null) return value;
  // A FUNCTION is a live carrier too: it can carry getters/own properties, so
  // passing it through by reference re-opens the accessor class.
  if (typeof value === 'function') {
    throw new TypeError('non-plain caller input is not supported');
  }
  if (typeof value !== 'object') return value;
  if (path.has(value)) throw new TypeError('cyclic caller input is not supported');
  const existing = memo.get(value);
  if (existing !== undefined) return existing;
  path.add(value);
  if (capturedIsArray(value)) {
    // Bind `length` ONCE (a Proxy length trap returning 3e6 over a 2-element
    // target forced an unbounded copy) and fail closed above a sane bound.
    const length = (value as unknown[]).length;
    if (!Number.isInteger(length) || length < 0 || length > SNAPSHOT_MAX_ARRAY) {
      path.delete(value);
      throw new TypeError('caller array length is not a bounded non-negative integer');
    }
    const copy: unknown[] = [];
    memo.set(value, copy);
    for (let index = 0; index < length; index += 1) {
      appendSafe(copy, snapshotValue(value[index], memo, path));
    }
    Object.freeze(copy);
    path.delete(value);
    return copy;
  }
  // Typed arrays and ArrayBuffers are copied through CAPTURED INTERNAL-SLOT
  // getters (V7 review round 7): `value.slice()` was a dynamic lookup, so a
  // subclass / own-`slice` property / `getPrototypeOf`-trap Proxy could return
  // the live object and re-open the accessor class. A Proxy has no internal slot
  // and fails the captured getter, so it is refused below.
  if (capturedTypedArrayLengthGetter !== undefined) {
    let typedLength: unknown;
    try {
      typedLength = capturedTypedArrayLengthGetter.call(value);
    } catch {
      typedLength = undefined;
    }
    if (typeof typedLength === 'number' && Number.isInteger(typedLength) && typedLength >= 0) {
      const source = value as unknown as { [index: number]: number };
      const copy = new Uint8Array(typedLength);
      for (let index = 0; index < typedLength; index += 1) copy[index] = source[index] as number;
      path.delete(value);
      return copy;
    }
  }
  if (capturedArrayBufferByteLengthGetter !== undefined) {
    let byteLength: unknown;
    try {
      byteLength = capturedArrayBufferByteLengthGetter.call(value);
    } catch {
      byteLength = undefined;
    }
    if (typeof byteLength === 'number' && Number.isInteger(byteLength) && byteLength >= 0) {
      const copy = new Uint8Array(byteLength);
      copy.set(new Uint8Array(value as ArrayBuffer));
      path.delete(value);
      return copy.buffer;
    }
  }
  if (capturedToString.call(value) === '[object Date]') {
    let time: unknown;
    try {
      time = capturedDateGetTime.call(value);
    } catch {
      time = undefined;
    }
    if (typeof time === 'number') {
      path.delete(value);
      return new Date(time);
    }
  }
  // Every other non-plain carrier (class instance, boxed primitive, Map/Set,
  // Proxy with a `getPrototypeOf` trap) is REFUSED, never passed through by
  // reference: passing it through kept its live getters and re-opened the whole
  // accessor class inside every wrapped function (V7 rounds 6-7).
  const prototype = capturedGetPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    path.delete(value);
    throw new TypeError('non-plain caller input is not supported');
  }
  const source = value as Record<string, unknown>;
  // ALL own string keys, not only the ENUMERABLE ones: `Object.keys` skipped a
  // non-enumerable own getter, so the snapshot dropped the field and a guard
  // that treats "field absent" as "no violation" failed OPEN. Reading each own
  // key once also neutralizes enumerable accessors.
  const keys = capturedGetOwnPropertyNames(source);
  if (keys.length > SNAPSHOT_MAX_KEYS) {
    path.delete(value);
    throw new TypeError('caller object has too many own properties');
  }
  const copy: Record<string, unknown> = capturedCreate(null) as Record<string, unknown>;
  memo.set(value, copy);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index] as string;
    copy[key] = snapshotValue(source[key], memo, path);
  }
  Object.freeze(copy);
  path.delete(value);
  return copy;
}

/**
 * Append with a captured `Object.defineProperty` (V7 review round 9). The plain
 * `array[array.length] = value` form is an ordinary `[[Set]]`: an integer-index
 * accessor anywhere on the array's prototype chain (own, inherited, or behind a
 * Proxy) swallows the append and a FAILED collector reads as empty. Defining an
 * own data property is immune to prototype accessors.
 */
export function appendSafe<T>(target: T[], value: T): void {
  capturedDefineProperty(target, target.length, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
