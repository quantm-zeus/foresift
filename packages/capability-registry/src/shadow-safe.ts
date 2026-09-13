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
    copy[copy.length] = source[index] as T;
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
    if (!seen) unique[unique.length] = value;
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
    concatenated[concatenated.length] = right[index] as T;
  }
  return concatenated;
}
