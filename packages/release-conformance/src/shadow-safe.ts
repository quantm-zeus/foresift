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
