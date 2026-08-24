/**
 * Chain-specific address normalization (FR-DATA-001, §11.5, AC-023).
 *
 * - EVM: canonical lowercase hex; EIP-55 checksum rendering via Keccak-256
 *   (pure TS implementation below, validated against the EIP-55 vectors).
 * - Solana: base58 validation preserving the validated representation.
 *
 * Canonical form is what identity keys use; checksum rendering is presentation.
 */
import { ErrorCode, ForesiftError } from './errors.ts';

declare const brand: unique symbol;

/** Canonical lowercase `0x`-prefixed 20-byte EVM address. */
export type EvmAddress = string & { readonly [brand]: 'EvmAddress' };
/** Validated base58 Solana address (32-byte ed25519 program-derived account). */
export type SolanaAddress = string & { readonly [brand]: 'SolanaAddress' };

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
export const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// ---------------------------------------------------------------------------
// Keccak-256 (original padding, as required by EIP-55) — pure TypeScript.
// ---------------------------------------------------------------------------

const ROUND_CONSTANTS = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
];

// Rotation offsets r[x][y] for keccak-f[1600].
const ROTATION_OFFSETS: readonly (readonly [number, number, number, number, number])[] = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

const MASK64 = (1n << 64n) - 1n;

/**
 * The 25-lane keccak permutation state. Lane A(x,y) lives at index x + 5y;
 * indices are structurally in range, so accessors assert instead of widening
 * element types to `bigint | undefined`.
 */
class KeccakState {
  private readonly lanes = new BigUint64Array(25);

  at(index: number): bigint {
    if (index < 0 || index >= 25) throw new RangeError(`keccak lane ${index} out of range`);
    const v = this.lanes[index];
    if (v === undefined) throw new RangeError(`keccak lane ${index} unset`);
    return v;
  }

  xorInto(index: number, value: bigint): void {
    this.set(index, this.at(index) ^ value);
  }

  set(index: number, value: bigint): void {
    if (index < 0 || index >= 25) throw new RangeError(`keccak lane ${index} out of range`);
    this.lanes[index] = value & MASK64;
  }

  rotInto(index: number, value: bigint, shift: number): void {
    this.lanes[index] = rotl64(value, shift);
  }
}

function rotl64(value: bigint, shift: number): bigint {
  const s = BigInt(shift % 64);
  return ((value << s) | (value >> (64n - s))) & MASK64;
}

function keccakF1600(state: KeccakState): void {
  for (let round = 0; round < 24; round += 1) {
    // theta
    const c: bigint[] = [];
    for (let x = 0; x < 5; x += 1) {
      c.push(
        state.at(x) ^ state.at(x + 5) ^ state.at(x + 10) ^ state.at(x + 15) ^ state.at(x + 20),
      );
    }
    const cAt = (i: number): bigint => {
      const v = c[(i + 5) % 5];
      if (v === undefined) throw new RangeError('theta parity lane missing');
      return v;
    };
    for (let x = 0; x < 5; x += 1) {
      const d = cAt(x + 4) ^ rotl64(cAt(x + 1), 1);
      for (let y = 0; y < 5; y += 1) state.xorInto(x + 5 * y, d);
    }
    // rho and pi
    const b = new KeccakState();
    const rotAt = (x: number, y: number): number => {
      const row = ROTATION_OFFSETS[x];
      const v = row === undefined ? undefined : row[y];
      if (v === undefined) throw new RangeError('keccak rotation offset missing');
      return v;
    };
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        b.rotInto(y + 5 * ((2 * x + 3 * y) % 5), state.at(x + 5 * y), rotAt(x, y));
      }
    }
    // chi
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const self = b.at(x + 5 * y);
        const next = ~b.at(((x + 1) % 5) + 5 * y) & MASK64;
        const next2 = b.at(((x + 2) % 5) + 5 * y);
        state.set(x + 5 * y, self ^ (next & next2));
      }
    }
    // iota
    const rc = ROUND_CONSTANTS[round];
    if (rc === undefined) throw new RangeError(`keccak round constant ${round} missing`);
    state.xorInto(0, rc);
  }
}

function utf8Bytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

/** Keccak-256 (legacy padding 0x01 — NOT sha3-256), returned as lowercase hex. */
export function keccak256Hex(message: Uint8Array | string): string {
  const bytes = typeof message === 'string' ? utf8Bytes(message) : message;
  const rate = 136; // bytes; 1600-bit permutation producing a 256-bit digest
  const state = new KeccakState();

  let offset = 0;
  const byteAt = (arr: Uint8Array, i: number): number => {
    const v = arr[i];
    if (v === undefined) throw new RangeError('absorb block byte out of range');
    return v;
  };
  const absorbBlock = (block: Uint8Array): void => {
    for (let i = 0; i < rate / 8; i += 1) {
      let lane = 0n;
      for (let j = 7; j >= 0; j -= 1) {
        lane = (lane << 8n) | BigInt(byteAt(block, i * 8 + j));
      }
      state.xorInto(i, lane);
    }
    keccakF1600(state);
  };

  while (bytes.length - offset >= rate) {
    absorbBlock(bytes.subarray(offset, offset + rate));
    offset += rate;
  }

  // Final block with keccak pad10*1 (domain byte 0x01). Padding bytes are
  // XOR-merged into the zeroed block: when only one byte of rate remains,
  // domain byte and closing bit land on the SAME index and must coalesce to
  // 0x81 — overwriting would silently diverge from Keccak for input lengths
  // ≡ 135 (mod 136).
  const last = new Uint8Array(rate);
  last.set(bytes.subarray(offset));
  // Both pad indices are provably in range: 0 ≤ remainder < rate after the
  // absorb loop, and rate ≥ 1.
  last[bytes.length - offset] = byteAt(last, bytes.length - offset) ^ 0x01;
  last[rate - 1] = byteAt(last, rate - 1) ^ 0x80;
  absorbBlock(last);

  // Digest = first 32 bytes of the interleaved state, each lane little-endian.
  let hex = '';
  for (let i = 0; i < 4; i += 1) {
    const lane = state.at(i);
    for (let j = 0n; j < 8n; j += 1n) {
      hex += ((lane >> (j * 8n)) & 0xffn).toString(16).padStart(2, '0');
    }
  }
  return hex;
}

// ---------------------------------------------------------------------------
// EVM addresses
// ---------------------------------------------------------------------------

/** Normalize any-cased hex input to canonical lowercase form or throw. */
export function normalizeEvmAddress(value: string): EvmAddress {
  if (!EVM_ADDRESS_PATTERN.test(value)) {
    throw new ForesiftError(ErrorCode.IDENTITY_ADDRESS_INVALID, 'not a 20-byte hex EVM address', {
      value,
    });
  }
  return value.toLowerCase() as EvmAddress;
}

/**
 * EIP-55 mixed-case checksum rendering of a canonical EVM address.
 * Presentation only — never used in identity comparisons.
 */
export function renderEip55(address: EvmAddress): string {
  const lower = address.toLowerCase();
  const hash = keccak256Hex(lower.slice(2));
  let out = '0x';
  for (let i = 0; i < 40; i += 1) {
    const nibbleChar = hash[i];
    const ch = lower[2 + i];
    if (nibbleChar === undefined || ch === undefined) {
      throw new RangeError('EIP-55 rendering indexed past its inputs');
    }
    out += Number.parseInt(nibbleChar, 16) >= 8 ? ch.toUpperCase() : ch;
  }
  return out;
}

/** Accept any-cased EVM address; return canonical + rendered pair. */
export function evmAddressParts(value: string): { canonical: EvmAddress; checksummed: string } {
  const canonical = normalizeEvmAddress(value);
  return { canonical, checksummed: renderEip55(canonical) };
}

// ---------------------------------------------------------------------------
// Solana addresses
// ---------------------------------------------------------------------------

function base58Decode(value: string): Uint8Array | null {
  const byteMap = new Map<string, number>();
  let alphabetIndex = 0;
  for (const ch of BASE58_ALPHABET) {
    byteMap.set(ch, alphabetIndex);
    alphabetIndex += 1;
  }
  let num = 0n;
  for (const ch of value) {
    const digit = byteMap.get(ch);
    if (digit === undefined) return null; // invalid character
    num = num * 58n + BigInt(digit);
  }
  // Leading '1's encode leading zero bytes.
  let zeros = 0;
  for (const ch of value) {
    if (ch === '1') zeros += 1;
    else break;
  }
  const bytes: number[] = [];

  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num >>= 8n;
  }

  const result = new Uint8Array(zeros + bytes.length);
  result.set(bytes, zeros);
  return result;
}

/**
 * Validate a base58-encoded Solana address. The validated representation is
 * preserved exactly (§11.5); decoding is internal to verification only.
 */
export function normalizeSolanaAddress(value: string): SolanaAddress {
  if (value.length < 32 || value.length > 44) {
    throw new ForesiftError(ErrorCode.IDENTITY_ADDRESS_INVALID, 'solana address length invalid', {
      value,
    });
  }
  const decoded = base58Decode(value);
  if (decoded === null || decoded.length !== 32) {
    throw new ForesiftError(
      ErrorCode.IDENTITY_ADDRESS_INVALID,
      'not a valid base58-encoded 32-byte solana address',
      { value },
    );
  }
  return value as SolanaAddress;
}

export function isSolanaAddress(value: string): boolean {
  try {
    normalizeSolanaAddress(value);
    return true;
  } catch {
    return false;
  }
}

/** CAIP-2 namespace discriminator for normalization dispatch. */
export function normalizeAddressForNamespace(namespace: string, value: string): string {
  switch (namespace) {
    case 'eip155':
      return normalizeEvmAddress(value);
    case 'solana':
      return normalizeSolanaAddress(value);
    default:
      // Fail closed: unknown chain namespaces require their own explicit
      // normalizer before an address can enter identity keys.
      throw new ForesiftError(
        ErrorCode.IDENTITY_ADDRESS_INVALID,
        'no registered normalizer for chain namespace',
        { namespace },
      );
  }
}
