import { describe, expect, it } from 'vitest';
import {
  ErrorCode,
  ForesiftError,
  compareDecimalStrings,
  multiplyDecimalStrings,
  parseDecimalString,
  rawAmount,
  rawToTokenQuantity,
  renderDecimalString,
  sumRaw,
  tokenQuantityToRaw,
  type DecimalString,
} from '../src/index.ts';

const dec = (s: string): DecimalString => s as DecimalString;

describe('raw-integer quantity policy (FR-DATA-001 §11.5)', () => {
  it('converts human decimal strings to raw amounts exactly', () => {
    expect(tokenQuantityToRaw('1.5', 18)).toBe(1500000000000000000n);
    expect(tokenQuantityToRaw('150', 6)).toBe(150000000n);
    expect(tokenQuantityToRaw('0.000001', 6)).toBe(1n);
    expect(tokenQuantityToRaw('7', 0)).toBe(7n);
  });

  it('renders raw amounts back to exact decimal strings', () => {
    expect(rawToTokenQuantity(1500000000000000000n, 18)).toBe('1.500000000000000000');
    expect(rawToTokenQuantity(1n, 6)).toBe('0.000001');
    expect(rawToTokenQuantity(42n, 0)).toBe('42');
  });

  it('roundtrips losslessly across arbitrary decimals', () => {
    for (const decimals of [2, 6, 8, 9, 18]) {
      for (const input of ['0', '1', '3.14', '999999.123456']) {
        if ((input.split('.')[1]?.length ?? 0) > decimals) continue;
        const raw = tokenQuantityToRaw(input, decimals);
        // Strip trailing zeros for comparison of semantic equality.
        const rendered = rawToTokenQuantity(raw, decimals).replace(/\.?0+$/, '') || '0';
        const expected = input.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
        expect(rendered).toBe(expected);
      }
    }
    expect(tokenQuantityToRaw('7', 0)).toBe(7n);
    expect(rawToTokenQuantity(7n, 0)).toBe('7');
  });

  it('refuses precision beyond token decimals instead of truncating', () => {
    try {
      tokenQuantityToRaw('0.0000001', 6);
      expect.unreachable('must refuse');
    } catch (e) {
      expect((e as ForesiftError).code).toBe(ErrorCode.QUANTITY_SCALE_EXCEEDED);
    }
  });

  it('refuses negatives and malformed decimal strings', () => {
    expect(() => rawAmount(-1n)).toThrowError(ForesiftError);
    expect(() => parseDecimalString('-1.5')).toThrowError(ForesiftError);
    expect(() => parseDecimalString('1e9')).toThrowError(ForesiftError);
    expect(() => parseDecimalString('01.5')).toThrowError(ForesiftError);
    expect(() => parseDecimalString('.5')).toThrowError(ForesiftError);
  });

  it('accepts pure decimal digit strings and nothing else for rawAmount strings', () => {
    // Raw BigInt() would also admit hex/binary/octal prefixes, a leading '+',
    // and surrounding whitespace; a §11.5 raw amount is decimal digits only.
    expect(rawAmount('42')).toBe(42n);
    expect(rawAmount('007')).toBe(7n);
    expect(() => rawAmount('0x10')).toThrowError(ForesiftError);
    expect(() => rawAmount('0b101')).toThrowError(ForesiftError);
    expect(() => rawAmount('0o17')).toThrowError(ForesiftError);
    expect(() => rawAmount('+5')).toThrowError(ForesiftError);
    expect(() => rawAmount(' 5')).toThrowError(ForesiftError);
    expect(() => rawAmount('5 ')).toThrowError(ForesiftError);
    expect(() => rawAmount('5.0')).toThrowError(ForesiftError);
    expect(() => rawAmount('-3')).toThrowError(ForesiftError);
    expect(() => rawAmount('')).toThrowError(ForesiftError);
  });

  it('never exposes a JS-number pathway: inputs/outputs are bigint or string', () => {
    const raw = tokenQuantityToRaw('2.5', 9);
    expect(typeof raw).toBe('bigint');
    const rendered = rawToTokenQuantity(raw, 9);
    expect(typeof rendered).toBe('string');
    expect(Number.isSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(true); // sanity of host
  });

  it('sums and multiplies decimal strings exactly (no float drift)', () => {
    expect(sumRaw([rawAmount(1n), rawAmount(2n), rawAmount(3000000n)])).toBe(3000003n);
    expect(multiplyDecimalStrings(dec('0.1'), dec('0.2'), 2)).toBe('0.02');
    const a = renderDecimalString(1n, 1);
    const b = renderDecimalString(2n, 1);
    expect(multiplyDecimalStrings(a, b, 2)).toBe('0.02');
    expect(compareDecimalStrings(dec('1.5'), dec('1.45'))).toBe(1);
    expect(compareDecimalStrings(dec('1.50'), dec('1.5'))).toBe(0);
    expect(compareDecimalStrings(dec('0.0009'), dec('0.001'))).toBe(-1);
  });

  it('enforces documented scale bounds', () => {
    expect(() => renderDecimalString(1n, -1)).toThrowError(ForesiftError);
    expect(() => renderDecimalString(1n, 37)).toThrowError(ForesiftError);
    expect(() => tokenQuantityToRaw('1', 37)).toThrowError(ForesiftError);
  });

  it('multiplies by explicit truncation at the declared output scale', () => {
    // price × size at declared scale: the dropped digits must be TRUNCATED
    // toward zero (1705/10 → 170), never rounded — a refactor to rounding
    // would silently re-scale every USD computation while staying green.
    expect(multiplyDecimalStrings(dec('1.55'), dec('1.1'), 2)).toBe('1.70');
    expect(multiplyDecimalStrings(dec('0.999'), dec('0.001'), 2)).toBe('0.00');
    // Output scale above total input scale pads with zeros instead.
    expect(multiplyDecimalStrings(dec('1.5'), dec('2'), 4)).toBe('3.0000');
    // The truncation convention is parse-refuse-compatible: rendered output
    // always parses back losslessly at its own scale.
    const out = multiplyDecimalStrings(dec('1.55'), dec('1.1'), 2);
    expect(parseDecimalString(out)).toEqual({ units: 170n, scale: 2 });
  });

  it('renders negative units with a sign and refuses to parse them back', () => {
    // Rendering supports signed units (internal deltas); parsing stays
    // unsigned-canonical — quantities in storage are never negative.
    expect(renderDecimalString(-1500n, 2)).toBe('-15.00');
    expect(renderDecimalString(-7n, 0)).toBe('-7');
    expect(() => parseDecimalString('-15.00')).toThrowError(ForesiftError);
  });
});
