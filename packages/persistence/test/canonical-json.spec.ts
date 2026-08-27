/**
 * THE canonical JSON serializer: key-sorted, byte-stable, object-member
 * `undefined`-dropping, and refusal of non-JSON leaves (FR-DATA-002/003
 * substrate — observation receipt hashes, evidence content addressing, and
 * restore-drill cross-checks all hash through this one function; EH-L1).
 */
import { describe, expect, it } from 'bun:test';
import { canonicalJson } from '../src/index.ts';

describe('canonicalJson hashing substrate', () => {
  it('sorts keys recursively and stays byte-stable', () => {
    const a = { b: 1, a: { y: 2, x: [3, { d: 4, c: 5 }] } };
    expect(canonicalJson(a)).toBe('{"a":{"x":[3,{"c":5,"d":4}],"y":2},"b":1}');
    expect(canonicalJson(a)).toBe(canonicalJson({ a: { y: 2, x: [3, { c: 5, d: 4 }] }, b: 1 }));
  });

  it('drops undefined object members so absent and explicit-undefined are the same input', () => {
    expect(canonicalJson({ a: 1 })).toBe(canonicalJson({ a: 1, gone: undefined }));
    expect(canonicalJson({ a: 1, gone: undefined })).toBe('{"a":1}');
  });

  it('refuses non-JSON leaf values instead of coercing them to null (EH-L1)', () => {
    // Distinct inputs hashing identically is exactly how indexed hashes
    // silently drift from computed ones — fail closed at the substrate.
    expect(() => canonicalJson(undefined)).toThrowError(TypeError);
    expect(() => canonicalJson([1, undefined])).toThrowError(TypeError);
    expect(() => canonicalJson({ nested: [undefined] })).toThrowError(TypeError);
    expect(() => canonicalJson(() => 'x')).toThrowError(TypeError);
    expect(() => canonicalJson({ fn: Symbol('s') })).toThrowError(/symbol/);
    // The refusal names the hazard for whoever meets it in production.
    expect(() => canonicalJson(undefined)).toThrowError(/distinct inputs hash identically/);
  });

  it('still renders JSON leaves exactly like JSON.stringify would', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson([null, '', 0, false])).toBe('[null,"",0,false]');
    expect(canonicalJson('é')).toBe('"é"');
  });
});
