/**
 * T117/T118: Helius raw/history separation, LOCAL supported-program decoding,
 * and the decoder-authority validator wired to the REAL catalog entries —
 * both directions: the normative configuration passes; enhanced-parser-as-
 * sole/authoritative configurations are refused using the actual deprecated
 * entry.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HELIUS_OPERATIONS,
  ProvAdapterErrorCode,
  assertHeliusOperationExecutable,
  createHeliusAdapterManifest,
  decodeRawTransaction,
  heliusCatalogEntry,
} from '../src/index.ts';
import type { DecodingPathConfig } from '@foresift/security';
import { validateDecoderAuthority } from '@foresift/security';

const RAW_TX = JSON.parse(
  readFileSync(new URL('./fixtures/helius/raw-transaction.json', import.meta.url), 'utf8'),
) as Parameters<typeof decodeRawTransaction>[0];

/** Builds a decoder-authority config from THIS package's real catalog rows. */
function configFromCatalog(overrides?: {
  readonly enhancedAuthority?: 'SOLE' | 'PRIMARY' | 'FALLBACK' | 'NONE';
  readonly rawOperationLocalDecodingEnabled?: boolean;
  readonly acknowledgedDeprecations?: readonly string[] | undefined;
}): DecodingPathConfig {
  const authority = overrides?.enhancedAuthority;
  return {
    decoders: HELIUS_OPERATIONS.map((entry) => ({
      id: `helius:${entry.operation.operationId}`,
      status:
        entry.decoder.decoderStatus === 'ACTIVE' ? ('ACTIVE' as const) : ('DEPRECATED' as const),
      authority:
        entry.operation.operationId === 'enhanced.get_transaction' && authority !== undefined
          ? authority
          : entry.decoder.decoderAuthority,
      domains: ['solana-economic-events'],
    })),
    rawOperationLocalDecodingEnabled: overrides?.rawOperationLocalDecodingEnabled ?? true,
    acknowledgedDeprecations: overrides?.acknowledgedDeprecations ?? [
      'helius:enhanced.get_transaction',
    ],
  };
}

describe('T117 Helius catalog separation', () => {
  it('separates raw, standard history, deprecated parser, and plan-gated ops', () => {
    const manifest = createHeliusAdapterManifest();
    expect(manifest.adapterId).toBe('helius-raw-history');
    expect(manifest.plane).toBe('COLLECTOR');
    expect(manifest.operations).toHaveLength(4);
    expect(HELIUS_OPERATIONS.map((e) => e.operation.operationId)).toEqual([
      'rpc.get_transaction',
      'rpc.get_signatures_for_address',
      'enhanced.get_transaction',
      'history.get_transactions_for_address',
    ]);
    const enhanced = heliusCatalogEntry('enhanced.get_transaction');
    expect(enhanced.decoder).toMatchObject({
      decoderStatus: 'DEPRECATED',
      decoderAuthority: 'NONE',
      requiresMigrationException: true,
    });
    expect(enhanced.operation.deprecatedAt).not.toBeNull();
    const planGated = heliusCatalogEntry('history.get_transactions_for_address');
    expect(planGated.operation.allowedInStrictFree).toBe(false);
    expect(planGated.decoder.planGated).toBe(true);
  });
});

describe('T117 LOCAL supported-program decoding', () => {
  it('decodes supported-program instructions deterministically with explicit coverage', () => {
    const first = decodeRawTransaction(RAW_TX);
    const second = decodeRawTransaction(RAW_TX);
    expect(second).toEqual(first); // deterministic

    expect(first.events).toHaveLength(2);
    expect(first.events[0]).toMatchObject({
      eventType: 'TOKEN_TRANSFER',
      program: 'spl-token',
      instructionType: 'transferChecked',
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '250000000',
      decimals: 6,
    });
    expect(first.events[1]).toMatchObject({
      eventType: 'TOKEN_TRANSFER',
      program: 'token-2022',
      instructionType: 'transfer',
      amount: '1000',
    });
    // Coverage is explicit: 3 examined, 2 decoded, unsupported reported.
    expect(first.coverage.instructionsExamined).toBe(3);
    expect(first.coverage.instructionsDecoded).toBe(2);
    expect(first.coverage.unsupportedProgramIds).toEqual([
      'UnknownProg1111111111111111111111111111111111',
    ]);
  });
});

describe('T117 runtime gates', () => {
  it('blocks the deprecated enhanced parser without a wired exception gate', async () => {
    await expect(
      assertHeliusOperationExecutable('enhanced.get_transaction', {}),
    ).rejects.toMatchObject({ code: ProvAdapterErrorCode.PROV_ADAPTER_DEPRECATED_PARSER_BLOCKED });
  });

  it('blocks the enhanced parser when the exception gate REFUSES (lapsed)', async () => {
    await expect(
      assertHeliusOperationExecutable('enhanced.get_transaction', {
        exceptions: {
          assertValidForUse: async () => {
            throw new Error('PROV_MIGRATION_EXCEPTION_EXPIRED');
          },
        },
      }),
    ).rejects.toMatchObject({ code: ProvAdapterErrorCode.PROV_ADAPTER_DEPRECATED_PARSER_BLOCKED });
  });

  it('admits the enhanced parser ONLY under a valid migration exception', async () => {
    await expect(
      assertHeliusOperationExecutable('enhanced.get_transaction', {
        exceptions: { assertValidForUse: async () => ({ exceptionId: 'valid' }) },
      }),
    ).resolves.toBeUndefined();
  });

  it('refuses plan-gated history on STRICT_FREE and admits on METERED', async () => {
    await expect(
      assertHeliusOperationExecutable('history.get_transactions_for_address', {
        plan: 'STRICT_FREE',
      }),
    ).rejects.toMatchObject({ code: ProvAdapterErrorCode.PROV_ADAPTER_PLAN_GATED_UNAVAILABLE });
    await expect(
      assertHeliusOperationExecutable('history.get_transactions_for_address', { plan: 'METERED' }),
    ).resolves.toBeUndefined();
  });

  it('raw normative operations never require an exception or plan gate', async () => {
    await expect(
      assertHeliusOperationExecutable('rpc.get_transaction', {}),
    ).resolves.toBeUndefined();
    await expect(
      assertHeliusOperationExecutable('rpc.get_signatures_for_address', { plan: 'STRICT_FREE' }),
    ).resolves.toBeUndefined();
  });
});

describe('T118 decoder-authority wiring over REAL catalog entries', () => {
  it('the normative raw/history-plus-local-decoding configuration PASSES', () => {
    const verdict = validateDecoderAuthority(configFromCatalog());
    expect(verdict.ok).toBe(true);
    expect(verdict.authoritativeDecoderIds).toEqual([
      'helius:rpc.get_transaction',
      'helius:rpc.get_signatures_for_address',
      'helius:history.get_transactions_for_address',
    ]);
  });

  it('REFUSES the deprecated enhanced parser as SOLE authoritative decoder', () => {
    expect(() =>
      validateDecoderAuthority(configFromCatalog({ enhancedAuthority: 'SOLE' })),
    ).toThrow(/authoritative economic-event decoder/);
  });

  it('REFUSES the deprecated enhanced parser as PRIMARY authority', () => {
    expect(() =>
      validateDecoderAuthority(configFromCatalog({ enhancedAuthority: 'PRIMARY' })),
    ).toThrow(/authoritative economic-event decoder/);
  });

  it('REFUSES configurations running deprecated parsing WITHOUT the local decoding path', () => {
    expect(() =>
      validateDecoderAuthority(configFromCatalog({ rawOperationLocalDecodingEnabled: false })),
    ).toThrow(/without the raw-operation local decoding pass/);
  });

  it('REFUSES deprecated parsers without explicit operator acknowledgement', () => {
    expect(() =>
      validateDecoderAuthority(configFromCatalog({ acknowledgedDeprecations: [] })),
    ).toThrow(/without explicit operator acknowledgement/);
  });
});
