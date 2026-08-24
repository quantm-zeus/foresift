import { describe, expect, it } from 'vitest';
import {
  ErrorCode,
  ForesiftError,
  caip10,
  chainIdentity,
  normalizeEvmAddress,
  normalizeSolanaAddress,
  keccak256Hex,
  parseChainId,
  renderEip55,
  BASE58_ALPHABET,
  type SolanaAddress,
} from '../src/index.ts';

/** Official EIP-55 test vectors (eips.ethereum.org/EIPS/eip-55). */
const EIP55_VECTORS: readonly [lowercase: string, checksummed: string][] = [
  ['52908400098527886e0f7030069857d2e4169ee7', '0x52908400098527886E0F7030069857D2E4169EE7'],
  ['8617e340b3d01fa5f11f306f4090fd50e238070d', '0x8617E340B3D01FA5F11F306F4090FD50E238070D'],
  ['de709f2102306220921060314715629080e2fb77', '0xde709f2102306220921060314715629080e2fb77'],
  ['27b1fdb04752bbc536007a920d24acb045561c26', '0x27b1fdb04752bbc536007a920d24acb045561c26'],
  ['5aaeb6053f3e94c9b9a09f33669435e7ef1beaed', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'],
  ['fb6916095ca1df60bb79ce92ce3ea74c37c5d359', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'],
  ['dbf03b407c01e7cd3cbea99509d93f8dddc8c6fb', '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB'],
  ['d1220a0cf47c7b9be7a2e6ba89f429762e7b9adb', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb'],
];

describe('CAIP-2 chain ids (FR-DATA-001)', () => {
  it('parses registered namespaces and derives mapping quality', () => {
    const evm = chainIdentity({ chainId: 'eip155:1' });
    expect(evm.mappingQuality).toBe('REGISTERED_EIP155_REFERENCE');
    expect(evm.namespace).toBe('eip155');
    const sol = chainIdentity({ chainId: 'solana:mainnet' });
    expect(sol.mappingQuality).toBe('REGISTERED_CAIP2');
  });

  it('requires an explicit id version for unregistered internal identifiers', () => {
    const internal = chainIdentity({
      chainId: 'foresift:net_0007',
      internalIdVersion: 3,
    });
    expect(internal.mappingQuality).toBe('INTERNAL_VERSIONED');
    expect(internal.internalIdVersion).toBe(3);
    // Without the version the mapping-quality state would be unproven.
    const unverified = chainIdentity({ chainId: 'foresift:net_0007' });
    expect(unverified.mappingQuality).toBe('UNVERIFIED_ASSERTION');
  });

  it('refuses malformed chain ids fail-closed', () => {
    for (const bad of ['', 'ethereum', 'eip155:', ':1', 'eip155:abc:def', 'UPPER:1']) {
      expect(() => parseChainId(bad)).toThrowError(ForesiftError);
      try {
        parseChainId(bad);
      } catch (e) {
        expect((e as ForesiftError).code).toBe(ErrorCode.IDENTITY_CHAIN_ID_INVALID);
      }
    }
  });

  it('composes CAIP-10 account ids and refuses separator injection', () => {
    expect(caip10(parseChainId('eip155:1'), normalizeEvmAddress('0x' + 'ab'.repeat(20)))).toBe(
      'eip155:1:0x' + 'ab'.repeat(20),
    );
    expect(() => caip10(parseChainId('eip155:1'), 'aa:bb')).toThrowError(ForesiftError);
  });
});

describe('EVM address normalization + EIP-55 rendering (AC-023)', () => {
  it('canonicalizes any-cased input to lowercase hex', () => {
    expect(normalizeEvmAddress('0xABCDEF0000000000000000000000000000000987')).toBe(
      '0xabcdef0000000000000000000000000000000987',
    );
  });

  it('renders the official EIP-55 checksum vectors exactly', () => {
    for (const [lc, want] of EIP55_VECTORS) {
      expect(renderEip55(normalizeEvmAddress('0x' + lc))).toBe(want);
    }
  });

  it('matches independent Keccak-256 reference digests at pad-boundary lengths', () => {
    // Regression: the final pad byte must MERGE the domain byte (0x01) with
    // the closing bit (0x80). Overwriting instead of merging diverged from
    // Keccak for every input length ≡ 135 (mod 136) — a class the 40-byte
    // EIP-55 vectors above cannot reach. Expected values below were generated
    // against an independent reference implementation validated on the
    // published Keccak-256("") and Keccak-256("abc") digests.
    const KECCAK256_VECTORS: readonly [length: number, hex: string][] = [
      [0, 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'],
      [134, '9b15a71de979234ab809a8015d8ed19b2bf29bc43bb51be59b296471aa0a479f'],
      [135, '47a414666f08a4658719043e5045638ef1ff99cb09400eff6289e6dc80c0970a'],
      [136, '91bac0515ccd2811f7b65984a2971e3d6093ccb9fac349b14c048499c2832e81'],
      [271, '67cd16d4b81d9371024e85c926ca78b79b5ff4447847f21f42678d7adc3a1c8b'],
      [272, '490d7f50c63ba285913a6e03deb33641fa06e0870a192f253c10fdc8e556e7c8'],
    ];
    for (const [length, want] of KECCAK256_VECTORS) {
      // Deterministic pseudo-message; content is irrelevant, length is the point.
      const msg = Uint8Array.from({ length }, (_, i) => (i * 7 + 11) % 256);
      expect(keccak256Hex(msg), `length ${length}`).toBe(want);
    }
  });

  it('rejects non-hex, wrong-length, and non-prefixed inputs', () => {
    for (const bad of [
      '',
      '0x1234',
      '0x' + 'gg'.repeat(20),
      '0X' + 'ab'.repeat(20).toUpperCase().slice(0, 40),
      'abcd',
    ]) {
      expect(() => normalizeEvmAddress(bad)).toThrowError(ForesiftError);
    }
  });
});

describe('Solana base58 validation (AC-023)', () => {
  /** Deterministic base58 encoder mirroring the alphabet contract. */
  function encodeBase58(bytes: Uint8Array): string {
    let num = 0n;
    for (const b of bytes) num = (num << 8n) | BigInt(b);
    let out = '';
    while (num > 0n) {
      out = BASE58_ALPHABET[Number(num % 58n)] + out;
      num /= 58n;
    }
    for (const b of bytes) {
      if (b === 0) out = '1' + out;
      else break;
    }
    return out;
  }

  function base58Of(bytes: number[]): SolanaAddress {
    return encodeBase58(new Uint8Array(bytes)) as SolanaAddress;
  }

  it('accepts encoded 32-byte accounts including the all-zero system program', () => {
    expect(normalizeSolanaAddress('1'.repeat(32))).toBeTruthy();
    const encoded = base58Of([1, 2, 3, ...new Array<number>(29).fill(200)]);
    expect(normalizeSolanaAddress(encoded)).toBe(encoded);
  });

  it('rejects invalid base58 characters, lengths, and overflowed decodes', () => {
    for (const bad of [
      '0'.repeat(43), // '0' not in the base58 alphabet
      'O'.repeat(43), // visually confusable char excluded from alphabet
      'lI'.padEnd(43, 'a'),
      '1'.repeat(31), // too short
      'z'.repeat(50), // too long
      base58Of([...new Array<number>(33).fill(9)]), // decodes to 33 bytes
    ]) {
      expect(() => normalizeSolanaAddress(bad)).toThrowError(ForesiftError);
    }
  });
});
