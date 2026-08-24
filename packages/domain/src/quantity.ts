/**
 * Numeric precision policy (FR-DATA-001, §11.5): token quantities are raw
 * integer amounts plus decimals — never JavaScript `number`; prices, USD
 * values, ratios, percentages are decimal strings with documented scale.
 *
 * All arithmetic here is BigInt/integer. There is intentionally no API that
 * accepts or returns a JS number for a quantity.
 */
import { ErrorCode, QuantityError } from './errors.ts';

declare const brand: unique symbol;

/** Non-negative raw integer amount (base units). */
export type RawAmount = bigint & { readonly [brand]: 'RawAmount' };
/** Decimal string with an explicit scale, e.g. `"12.3450"` at scale 4. */
export type DecimalString = string & { readonly [brand]: 'DecimalString' };

// Unsigned canonical decimals only: no sign, no leading zeros, no exponent
// (`renderDecimalString` below CAN emit a leading '-' for negative
// `(units, scale)` pairs — such output is a render-side convention and must
// be re-signed/parsed through the raw-integer path, not this pattern).
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/**
 * Scale semantics (documented per §11.5):
 * - A quantity is `rawAmount × 10^(-decimals)`.
 * - `decimals` is the token's canonical decimal count; it is sourced,
 *   cross-checked, and versioned elsewhere (identity layer).
 * - `scale` on price/ratio/percentage decimal strings is the exact number of
 *   fractional digits retained; trailing zeros are significant to the scale.
 */
export interface QuantitySemantics {
  readonly kind: 'TOKEN_QUANTITY' | 'PRICE' | 'USD_VALUE' | 'RATIO' | 'PERCENTAGE';
  /** Fixed fractional-digit count for non-quantity kinds. */
  readonly scale: number;
}

/** Validate and brand a non-negative raw integer amount. */
export function rawAmount(value: bigint | string): RawAmount {
  let v: bigint;
  if (typeof value === 'string') {
    try {
      v = BigInt(value);
    } catch {
      throw new QuantityError(
        'raw amount must be a decimal digit string',
        { value },
        ErrorCode.QUANTITY_DECIMAL_STRING_INVALID,
      );
    }
  } else {
    v = value;
  }
  if (v < 0n)
    throw new QuantityError(
      'negative amounts are not quantities',
      { value: String(v) },
      ErrorCode.QUANTITY_NEGATIVE_UNSUPPORTED,
    );
  return v as RawAmount;
}

/** Parse a canonical decimal string ("123", "12.34") without any float step. */
export function parseDecimalString(value: string): { units: bigint; scale: number } {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new QuantityError(
      'decimal string must be an unsigned canonical decimal',
      { value },
      ErrorCode.QUANTITY_DECIMAL_STRING_INVALID,
    );
  }
  const dot = value.indexOf('.');
  if (dot === -1) return { units: BigInt(value), scale: 0 };
  const whole = value.slice(0, dot);
  const frac = value.slice(dot + 1);
  return { units: BigInt(whole + frac), scale: frac.length };
}

/** Render `(units, scale)` back to a decimal string with exactly `scale` digits. */
export function renderDecimalString(units: bigint, scale: number): DecimalString {
  if (!Number.isInteger(scale) || scale < 0 || scale > 36) {
    throw new QuantityError(
      'scale must be an integer in [0, 36]',
      { scale },
      ErrorCode.QUANTITY_SCALE_EXCEEDED,
    );
  }
  const neg = units < 0n;
  let digits = (neg ? -units : units).toString();
  if (scale === 0) {
    return (neg ? '-' + digits : digits) as DecimalString;
  }
  digits = digits.padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale);
  return `${neg ? '-' : ''}${whole}.${frac}` as DecimalString;
}

/**
 * Convert a human decimal-string token amount into its raw integer form at the
 * token's decimals. Throws when the input carries more precision than the
 * token supports (never silently truncates).
 */
export function tokenQuantityToRaw(decimalString: string, tokenDecimals: number): RawAmount {
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 36) {
    throw new QuantityError(
      'token decimals out of representable range',
      { tokenDecimals },
      ErrorCode.QUANTITY_SCALE_EXCEEDED,
    );
  }
  const { units, scale } = parseDecimalString(decimalString);
  if (scale > tokenDecimals) {
    throw new QuantityError(
      'input precision exceeds token decimals; refusing to truncate',
      { decimalString, tokenDecimals, scale },
      ErrorCode.QUANTITY_SCALE_EXCEEDED,
    );
  }
  return (units * 10n ** BigInt(tokenDecimals - scale)) as RawAmount;
}

/** Render a raw integer amount at `tokenDecimals` as a plain decimal string. */
export function rawToTokenQuantity(raw: bigint, tokenDecimals: number): DecimalString {
  return renderDecimalString(raw, tokenDecimals);
}

/** Sum raw amounts (same token only — callers enforce identity). */
export function sumRaw(amounts: readonly RawAmount[]): RawAmount {
  let acc = 0n;
  for (const a of amounts) acc += a;
  return acc as RawAmount;
}

/**
 * Multiply two fixed-scale decimals exactly, returning the declared output
 * scale (truncation beyond that scale is explicit, never float drift).
 */
export function multiplyDecimalStrings(
  a: DecimalString,
  b: DecimalString,
  outputScale: number,
): DecimalString {
  const pa = parseDecimalString(a);
  const pb = parseDecimalString(b);
  const product = pa.units * pb.units;
  const totalScale = pa.scale + pb.scale;
  if (totalScale <= outputScale) {
    return renderDecimalString(product * 10n ** BigInt(outputScale - totalScale), outputScale);
  }
  // Truncate toward zero by dividing; the dropped digits are recorded nowhere —
  // callers needing banker's rounding do so above this primitive.
  const divisor = 10n ** BigInt(totalScale - outputScale);
  return renderDecimalString(product / divisor, outputScale);
}

/** Compare two decimal strings of arbitrary scales exactly. */
export function compareDecimalStrings(a: DecimalString, b: DecimalString): number {
  const pa = parseDecimalString(a);
  const pb = parseDecimalString(b);
  const na = pa.units * 10n ** BigInt(pb.scale);
  const nb = pb.units * 10n ** BigInt(pa.scale);
  return na === nb ? 0 : na < nb ? -1 : 1;
}
