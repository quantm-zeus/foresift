/**
 * Shadow-safe numeric array primitives for the security perimeter (audit
 * HIGH: in-process `Array.prototype` shadowing).
 *
 * Repo decision D018: an in-process caller can shadow `Array.prototype`
 * methods (`includes`, `some`, `filter`, `map`, `join`, `sort`, `slice`,
 * `push`, spread `[...x]`, `for...of`, `new Set(array)`, `Symbol.iterator`) at
 * DECISION time and thereby flip a fail-closed authority gate to ALLOW. Every
 * decision-time authority operation in a pure in-process guard must therefore
 * walk arrays by NUMERIC INDEX instead. These helpers never touch
 * `Array.prototype`; `String.prototype`/`path.*`/`Object`/`JSON`/`Map`/`Set`
 * intrinsics are explicitly out of the declared threat model.
 *
 * Semantics are byte-identical to the builtins they replace on unshadowed
 * input: ordering, `===` equality, duplicates, empty arrays, and
 * `undefined`/`null` handling all match.
 */

/** A numeric-index copy of `source`; never uses spread or `.slice`. */
export function numericCopy<T>(source: readonly T[]): T[] {
  const copy: T[] = [];
  for (let index = 0; index < source.length; index += 1) {
    copy[copy.length] = source[index] as T;
  }
  return copy;
}

/**
 * Order-preserving deduplication equivalent to `[...new Set(source)]`, built
 * without `Set` iteration or `Array.prototype` methods. Uses SameValueZero so
 * `NaN` collapses exactly as the `Set` builtin would.
 */
export function numericUnique<T>(source: readonly T[]): T[] {
  const unique: T[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index] as T;
    let seen = false;
    for (let seenIndex = 0; seenIndex < unique.length; seenIndex += 1) {
      const candidate = unique[seenIndex] as T;
      if (candidate === value || (candidate !== candidate && value !== value)) {
        seen = true;
        break;
      }
    }
    if (!seen) unique[unique.length] = value;
  }
  return unique;
}

/**
 * Numeric-index `Array.prototype.join`. `undefined`/`null` render as the empty
 * string, exactly like the builtin; `String(value)` is used for every other
 * element.
 */
export function numericJoin(source: readonly unknown[], separator = ','): string {
  let joined = '';
  for (let index = 0; index < source.length; index += 1) {
    if (index > 0) joined += separator;
    const value = source[index];
    joined += value === undefined || value === null ? '' : String(value);
  }
  return joined;
}

/** Numeric membership; never `Array.prototype.includes`/`indexOf`. SameValueZero. */
export function numericIncludes<T>(values: readonly T[], candidate: T): boolean {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as T;
    if (value === candidate || (value !== value && candidate !== candidate)) return true;
  }
  return false;
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

/** Numeric-index `every`; never `.every`. Vacuously true on empty input. */
export function numericEvery<T>(
  source: readonly T[],
  predicate: (value: T, index: number) => boolean,
): boolean {
  for (let index = 0; index < source.length; index += 1) {
    if (!predicate(source[index] as T, index)) return false;
  }
  return true;
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

/** Numeric-index `find`; never `.find`. Returns `undefined` when absent. */
export function numericFind<T>(
  source: readonly T[],
  predicate: (value: T, index: number) => boolean,
): T | undefined {
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index] as T;
    if (predicate(value, index)) return value;
  }
  return undefined;
}

/** Numeric-index `reduce`; never `.reduce`. Initial value is required. */
export function numericReduce<T, A>(
  source: readonly T[],
  reducer: (accumulator: A, value: T, index: number) => A,
  initial: A,
): A {
  let accumulator = initial;
  for (let index = 0; index < source.length; index += 1) {
    accumulator = reducer(accumulator, source[index] as T, index);
  }
  return accumulator;
}

/**
 * Numeric-index `Array.prototype.slice` with the builtin's negative-index and
 * clamping behavior; never `.slice`.
 */
export function numericSlice<T>(source: readonly T[], start?: number, end?: number): T[] {
  const length = source.length;
  // `ToIntegerOrInfinity(NaN) === 0` in the builtin; `Math.trunc(NaN)` is NaN,
  // which would make the loop body skip and return `[]` for `slice(NaN)`.
  const fromArg = start === undefined ? 0 : Math.trunc(start);
  const toArg = end === undefined ? length : Math.trunc(end);
  let from = Number.isNaN(fromArg) ? 0 : fromArg;
  let to = Number.isNaN(toArg) ? 0 : toArg;
  if (from < 0) from = Math.max(length + from, 0);
  if (to < 0) to = Math.max(length + to, 0);
  if (from > length) from = length;
  if (to > length) to = length;
  const sliced: T[] = [];
  for (let index = from; index < to; index += 1) {
    sliced[sliced.length] = source[index] as T;
  }
  return sliced;
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
 * Deliver `items` to `callback` by numeric index instead of `forEach`, which
 * is an `Array.prototype` method.
 */
export function numericForEach<T>(
  source: readonly T[],
  callback: (value: T, index: number) => void,
): void {
  for (let index = 0; index < source.length; index += 1) {
    callback(source[index] as T, index);
  }
}

/**
 * Schema-backed decision construction that CANNOT fail open when the schema
 * library's own internals are shadowed (audit R13 HIGH residual).
 *
 * zod's `ObjectType._parse` walks `for (const key of shapeKeys)` and appends
 * with `push`; an in-scope `Array.prototype[Symbol.iterator]`/`push` shadow
 * therefore makes `Schema.parse(literal)` return `{}`. Every consumer of these
 * verdicts compares against a NEGATIVE discriminant (`=== 'REFUSE'`,
 * `=== 'REFUSED'`), so a bare `{}` silently authorizes.
 *
 * The `literal` argument is constructed by this package and is already exactly
 * schema-shaped, so when the parsed result does not carry the SAME discriminant
 * value as the literal we return the frozen literal instead. On an unshadowed
 * runtime the schema still validates and its output is returned unchanged.
 */
export function parseDecision<T extends object>(
  schema: { parse(value: unknown): unknown },
  literal: T,
): T {
  let discriminant: string | undefined;
  if ('decision' in literal) discriminant = 'decision';
  else if ('verdict' in literal) discriminant = 'verdict';
  else if ('outcome' in literal) discriminant = 'outcome';
  try {
    const parsed = schema.parse(literal) as T;
    if (parsed !== null && typeof parsed === 'object') {
      if (discriminant === undefined) return parsed;
      const actual = (parsed as Record<string, unknown>)[discriminant];
      const expected = (literal as Record<string, unknown>)[discriminant];
      if (actual === expected) return parsed;
    }
  } catch {
    // The library threw under a shadow; fall through to the trusted literal.
  }
  return Object.freeze(literal);
}
