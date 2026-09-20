// Shadow-safe carrier hardening regressions (V7 review rounds 13/14).
//
// The eighth-round fresh-context review reproduced a CRITICAL regression that
// the broad single-read sweep introduced: `snapshotCallerInput` enumerated only
// ENUMERABLE own keys (`Object.keys`), so a plain object carrying a
// NON-ENUMERABLE own getter had the field silently DROPPED from the snapshot.
// A guard that treats "field absent" as "no violation" then failed OPEN while
// the downstream consumer still read the raw value.
//
// It also reproduced that `Array.isArray` was read dynamically, so shadowing
// `Array.isArray = () => true` collapsed every snapshot to `[]` and flipped
// refusals to passes; and that a Proxy `length` trap forced an unbounded copy.
import { afterEach, describe, expect, it } from 'bun:test';
import { isArraySafe, snapshotCallerInput } from '../src/shadow-safe.ts';

const ARRAY_STATIC = Array as unknown as Record<string, unknown>;
const realIsArray = Array.isArray;

afterEach(() => {
  ARRAY_STATIC['isArray'] = realIsArray;
});

describe('snapshotCallerInput: own-property completeness (V7 CRITICAL)', () => {
  it('materializes a NON-ENUMERABLE own getter instead of dropping the field', () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE';
    const carrier: Record<string, unknown> = {};
    Object.defineProperty(carrier, 'content', {
      get: () => secret,
      enumerable: false,
      configurable: true,
    });
    expect(Object.keys(carrier).length).toBe(0); // the pre-fix blind spot
    const snapshot = snapshotCallerInput(carrier) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(snapshot, 'content')).toBe(true);
    expect(snapshot['content']).toBe(secret);
  });

  it('materializes a NON-ENUMERABLE own data property too', () => {
    const carrier: Record<string, unknown> = {};
    Object.defineProperty(carrier, 'dependencies', {
      value: { lodash: '^4.0.0' },
      enumerable: false,
      configurable: true,
    });
    const snapshot = snapshotCallerInput(carrier) as Record<string, unknown>;
    expect(snapshot['dependencies']).toEqual({ lodash: '^4.0.0' });
  });
});

describe('snapshotCallerInput resists Array.isArray shadowing (V7 HIGH)', () => {
  it('keeps nested arrays as arrays when Array.isArray is shadowed to true', () => {
    ARRAY_STATIC['isArray'] = () => true;
    try {
      const snapshot = snapshotCallerInput({ items: ['a', 'b'] }) as { items: unknown };
      expect(isArraySafe(snapshot.items)).toBe(true);
      expect((snapshot.items as string[]).length).toBe(2);
      expect((snapshot.items as string[])[0]).toBe('a');
    } finally {
      ARRAY_STATIC['isArray'] = realIsArray;
    }
  });

  it('does not take the array branch for a non-array object under the shadow', () => {
    ARRAY_STATIC['isArray'] = () => true;
    try {
      const snapshot = snapshotCallerInput({ a: 1 }) as Record<string, unknown>;
      expect(snapshot['a']).toBe(1);
      expect(isArraySafe(snapshot)).toBe(false);
    } finally {
      ARRAY_STATIC['isArray'] = realIsArray;
    }
  });
});

describe('snapshotCallerInput bounds a hostile array length', () => {
  it('refuses a Proxy array claiming an unbounded length', () => {
    const proxy = new Proxy(['a', 'b'], {
      get(target, property, receiver) {
        if (property === 'length') return 3_000_000;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => snapshotCallerInput(proxy)).toThrow(TypeError);
  });

  it('still copies a normal array', () => {
    const snapshot = snapshotCallerInput(['x', 'y']) as unknown;
    expect(isArraySafe(snapshot)).toBe(true);
    expect((snapshot as string[]).length).toBe(2);
  });
});
