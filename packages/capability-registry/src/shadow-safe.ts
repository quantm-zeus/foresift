/**
 * Shadow-safe numeric array primitives (audit NEW-H1/NEW-M4).
 *
 * Every fail-closed decision in this package walks arrays by NUMERIC INDEX
 * (`for (let index = 0; …)`) instead of `for…of`, array spread,
 * `.map/.filter/.some/.find/.includes/.indexOf/.forEach`, or a `new Set(array)`
 * constructor. All of those route through `Array.prototype` hooks that an
 * in-process caller can shadow globally — a shadowed `Symbol.iterator`, for
 * example, makes `for…of` yield nothing and `new Set(array)` build an EMPTY set,
 * which is how a passing gate could be manufactured from a required-gate set
 * that was silently emptied (audit HIGH, demonstrated at 5486938).
 *
 * Membership authority is `isOneOf` from `@foresift/domain` (also a numeric
 * walk). The copy/unique helpers below never touch `Array.prototype`.
 *
 * Threat-model boundary: this defends against shadows installed AFTER the
 * package is imported. `Object.freeze`/`Object.values`/`Array.isArray` are read
 * at module initialization and are explicitly out of scope (coordinator note).
 */

/** A numeric-index copy of `source`; never uses spread or `.slice`. */
export function numericCopy<T>(source: readonly T[]): T[] {
  const copy: T[] = [];
  for (let index = 0; index < source.length; index += 1) {
    appendSafe(copy, source[index] as T);
  }
  return copy;
}

/** Order-preserving de-duplication by strict equality; never uses `Set(array)`. */
export function numericUnique<T>(source: readonly T[]): T[] {
  const unique: T[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index] as T;
    let seen = false;
    for (let seenIndex = 0; seenIndex < unique.length; seenIndex += 1) {
      if (unique[seenIndex] === value) {
        seen = true;
        break;
      }
    }
    if (!seen) appendSafe(unique, value);
  }
  return unique;
}

/**
 * A numeric-index `join`; never uses `Array.prototype.join`. `separator`
 * defaults to `, ` to match the refusal-message formatting it replaces.
 */
export function numericJoin(source: readonly string[], separator = ', '): string {
  let joined = '';
  for (let index = 0; index < source.length; index += 1) {
    if (index > 0) joined += separator;
    joined += source[index] as string;
  }
  return joined;
}

/**
 * A stable, numeric-only insertion sort of `source` by `key`, ascending.
 * Equivalent to `numericCopy(source).sort((a, b) => key(a) - key(b))` for the
 * small decision arrays in this package, without `Array.prototype.sort`.
 */
export function numericSortBy<T>(source: readonly T[], key: (value: T) => number): T[] {
  const sorted = numericCopy(source);
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index] as T;
    const currentKey = key(current);
    let position = index - 1;
    while (position >= 0 && key(sorted[position] as T) > currentKey) {
      sorted[position + 1] = sorted[position] as T;
      position -= 1;
    }
    sorted[position + 1] = current;
  }
  return sorted;
}

/**
 * A stable, numeric-only insertion sort of strings, ascending by UTF-16 code
 * unit (the default `Array.prototype.sort` order) unless `descending`. Never
 * uses `.sort`.
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
 * A stable, numeric-only insertion sort of objects by a STRING key (ascending by
 * UTF-16 code unit unless `descending`). Never uses `.sort`.
 */
export function numericSortByString<T>(
  source: readonly T[],
  key: (value: T) => string,
  descending = false,
): T[] {
  const sorted = numericCopy(source);
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index] as T;
    const currentKey = key(current);
    let position = index - 1;
    while (position >= 0) {
      const priorKey = key(sorted[position] as T);
      const outOfOrder = descending ? priorKey < currentKey : priorKey > currentKey;
      if (!outOfOrder) break;
      sorted[position + 1] = sorted[position] as T;
      position -= 1;
    }
    sorted[position + 1] = current;
  }
  return sorted;
}

/**
 * A numeric-index array `push`-free append that returns a new array. Useful for
 * building a required-gate list from other lists without array spread.
 */
export function numericConcat<T>(left: readonly T[], right: readonly T[]): T[] {
  const concatenated = numericCopy(left);
  for (let index = 0; index < right.length; index += 1) {
    appendSafe(concatenated, right[index] as T);
  }
  return concatenated;
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
  if (value === null || typeof value !== 'object') return value;
  if (path.has(value)) throw new TypeError('cyclic caller input is not supported');
  const existing = memo.get(value);
  if (existing !== undefined) return existing;
  path.add(value);
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    memo.set(value, copy);
    for (let index = 0; index < value.length; index += 1) {
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
  if (Object.prototype.toString.call(value) === '[object Date]') {
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
