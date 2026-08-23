/**
 * AC-023 negative / failure-path — task T052.
 * Traces: FR-DATA-001, §11.8 (explicit quality states, never guesses).
 * Invalid chain ids / addresses are refused with typed errors; invalid
 * decimal strings are refused by the quantity contract; a conflicting
 * decimals history leaves the representation explicitly unusable (null),
 * never silently resolved.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ErrorCode,
  ForesiftError,
  normalizeAddressForNamespace,
  parseChainId,
  rawAmount,
  renderDecimalString,
  tokenQuantityToRaw,
  utcTimestamp,
} from '@foresift/domain';
import {
  ensureChain,
  insertRepresentation,
  recordDecimalsObservation,
} from '@foresift/persistence';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  type TestDatabase,
} from '../acceptance/helpers.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-023 negative: invalid identity inputs yield typed refusals', () => {
  it('refuses malformed chain ids at the domain boundary', () => {
    for (const bad of ['eip155', 'EIP155:1', 'eip155:', ':', 'eip155:1:extra', 'x:%%']) {
      try {
        parseChainId(bad);
        throw new Error(`expected refusal for ${bad}`);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('expected refusal')) throw err;
        expect(err, bad).toBeInstanceOf(ForesiftError);
        expect((err as ForesiftError).code, bad).toBe(ErrorCode.IDENTITY_CHAIN_ID_INVALID);
      }
    }
  });

  it('the repository refuses to persist malformed chain ids', async () => {
    await expectForesiftError(
      ensureChain(tdb.engine, 'not-a-caip2'),
      ErrorCode.IDENTITY_CHAIN_ID_INVALID,
    );
  });

  it('refuses malformed EVM addresses (length, prefix)', () => {
    for (const bad of [
      '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beae', // too short
      '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed0', // too long
      '5aaeb6053f3e94c9b9a09f33669435e7ef1beaed', // missing 0x
    ]) {
      try {
        normalizeAddressForNamespace('eip155', bad);
        throw new Error(`expected refusal for ${bad}`);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('expected refusal')) throw err;
        expect((err as { code?: string }).code).toBe(ErrorCode.IDENTITY_ADDRESS_INVALID);
      }
    }
  });

  it('refuses malformed Solana addresses (bad alphabet, wrong length)', () => {
    for (const bad of [
      '0OIl1111111111111111111111111111111111111111', // 0OIl not in base58
      'short',
      '1'.repeat(60), // far beyond 32 bytes
    ]) {
      try {
        normalizeAddressForNamespace('solana', bad);
        throw new Error(`expected refusal for ${bad.slice(0, 12)}…`);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('expected refusal')) throw err;
        expect((err as { code?: string }).code).toBe(ErrorCode.IDENTITY_ADDRESS_INVALID);
      }
    }
  });
});

describe('AC-023 negative: quantity refusals and explicit conflicting states', () => {
  it('refuses decimal strings that are not canonical unsigned decimals', () => {
    for (const bad of ['1,000.5', 'abc', '', '-3.14', '1e18']) {
      try {
        tokenQuantityToRaw(bad, 18);
        throw new Error(`expected refusal for ${JSON.stringify(bad)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.startsWith('expected refusal')) {
          throw new Error(`tokenQuantityToRaw accepted ${JSON.stringify(bad)}`);
        }
        expect(err, JSON.stringify(bad)).toBeInstanceOf(ForesiftError);
        expect((err as ForesiftError).code, JSON.stringify(bad)).toBe(
          ErrorCode.QUANTITY_DECIMAL_STRING_INVALID,
        );
      }
    }
  });

  it('refuses negative amounts outright at the quantity boundary', () => {
    try {
      rawAmount(-5n);
      throw new Error('expected refusal');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Rethrow OUR sentinel first so a non-refusing call can never pass by
      // skipping the assertion block.
      if (message.startsWith('expected refusal')) throw err;
      expect((err as { code?: string }).code).toBe(ErrorCode.QUANTITY_NEGATIVE_UNSUPPORTED);
    }
  });

  it('refuses precision beyond the token decimals instead of truncating', async () => {
    await expectForesiftError(
      Promise.resolve().then(() => tokenQuantityToRaw('1.0000000000000000001', 18)),
      ErrorCode.QUANTITY_SCALE_EXCEEDED,
    );
  });

  it('rendering keeps exact scale — no float rounding ever enters storage', () => {
    // 1 wei of an 18-decimals token must never degrade through a JS number.
    expect(renderDecimalString(1n, 18)).toBe('0.000000000000000001');
  });

  it('a conflicting decimals representation is stored unusable (null), not guessed', async () => {
    const chainId = 'eip155:1';
    const address = '0x00000000000000000000000000000000000ac230';
    await ensureChain(tdb.engine, chainId);
    await insertRepresentation(tdb.engine, { chainId, canonicalAddress: address });

    // Two independent sources disagreeing at the same newest instant.
    await recordDecimalsObservation(tdb.engine, {
      observationId: 'ac23n-conflict-a',
      chainId,
      canonicalAddress: address,
      decimals: 18,
      observedAt: utcTimestamp('2026-06-05T00:00:00Z'),
      sourceRef: 'src/rpc-a',
    });
    const result = await recordDecimalsObservation(tdb.engine, {
      observationId: 'ac23n-conflict-b',
      chainId,
      canonicalAddress: address,
      decimals: 6,
      observedAt: utcTimestamp('2026-06-05T00:00:00Z'),
      sourceRef: 'src/explorer-b',
    });
    expect(result.state).toBe('CONFLICTING');
    expect(result.decimals).toBeNull();

    const stored = await tdb.engine.query<{ decimals_state: string; decimals: number | null }>(
      'SELECT decimals_state, decimals FROM asset_representations WHERE chain_id = $1 AND canonical_address = $2',
      [chainId, address],
    );
    expect(stored.rows[0]?.decimals_state).toBe('CONFLICTING');
    expect(stored.rows[0]?.decimals ?? null).toBeNull();
  });
});
