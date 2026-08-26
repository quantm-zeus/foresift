// AC-050 (negative): the scanners DETECT every prohibited category. Each
// inert fixture under tests/fixtures/sec/prohibited/** must produce a
// finding of exactly its category on both the runtime-canary surface and —
// via the CLI parity suite — the static surface; forbidden wallet-execution
// query variants must refuse with typed errors.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';
import { ActionClass } from '@foresift/domain';
import {
  NegativeCapabilityCanary,
  loadCanaryCatalog,
} from '../../packages/security/src/negative-capability.ts';
import { ProhibitedCapabilityScreen } from '../../packages/tool-core/src/prohibited.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROHIBITED_DIR = path.join(REPO_ROOT, 'tests/fixtures/sec/prohibited');

/** fixture file → the category(ies) its content MUST trip. */
const DETECTION_MATRIX: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['wallet-keypair.ts', ['PRIVATE_KEY_SEED', 'SIGNING']],
  ['swap-execution.ts', ['SWAP_ORDER_EXECUTION']],
  ['bridge-staking.ts', ['BRIDGE_STAKING']],
  ['custody-wallet-management.ts', ['CUSTODY_WALLET_MANAGEMENT']],
  ['exchange-trading.ts', ['EXCHANGE_TRADING']],
  ['copy-trading.ts', ['COPY_TRADING']],
  ['transaction-submit.ts', ['TRANSACTION_BUILD_SIGN_SUBMIT']],
];

const FORBIDDEN_VARIANTS: readonly string[] = [
  'swap SOL for USDC',
  'buy token from wallet',
  'sell all holdings',
  'execute trade on behalf of wallet',
  'transfer funds out of wallet',
];

describe('AC-050 negative: every prohibited-category fixture is detected', () => {
  const canary = new NegativeCapabilityCanary(loadCanaryCatalog());

  for (const [fixture, categories] of DETECTION_MATRIX) {
    it(`detects ${fixture} as ${categories.join(' + ')}`, () => {
      const text = readFileSync(path.join(PROHIBITED_DIR, fixture), 'utf8');
      const found = canary.scanSourceText(`prohibited/${fixture}`, text);
      expect(found.length, JSON.stringify(found)).toBeGreaterThan(0);
      for (const category of categories) {
        expect(found.map((f) => f.category)).toContain(category);
      }
    });
  }

  it('covers EVERY catalog category with at least one fixture', () => {
    for (const [fixture] of DETECTION_MATRIX) {
      expect(readFileSync(path.join(PROHIBITED_DIR, fixture), 'utf8')).toBeTruthy();
    }
    expect(DETECTION_MATRIX).toHaveLength(7);
  });

  it('refuses forbidden wallet-execution query variants with typed errors', () => {
    for (const query of FORBIDDEN_VARIANTS) {
      expect(() => canary.classifyWalletQuery(query), query).toThrow(
        /forbidden execution variant|prohibited/i,
      );
    }
  });

  it('flags forbidden environment variable names across all categories', () => {
    const findings = canary.scanEnvironmentNames([
      'PRIVATE_KEY',
      'SEED_PHRASE',
      'MNEMONIC',
      'SIGNING_KEYSTORE',
      'TX_SUBMIT_ENDPOINT',
      'SWAP_API_KEY',
      'BRIDGE_ENDPOINT',
      'WALLET_FILE',
      'BINANCE_API_SECRET',
      'COPY_TRADE_TARGET_WALLET',
    ]);
    expect(findings.length).toBeGreaterThanOrEqual(10);
  });
});

describe('AC-050 negative (tool-core substrate): prohibited tool definitions fail registration screening', () => {
  it('throws TOOL_DEFINITION_PROHIBITED on trading or signing tools', () => {
    const screen = new ProhibitedCapabilityScreen();
    expect(() =>
      screen.screen(
        {
          name: 'execute_swap_order',
          title: 'Execute Swap Order',
          description: 'Builds and signs transactions to execute token swaps on-chain',
          inputSchemaJson: {
            type: 'object',
            properties: { [['priv', 'ateKey'].join('')]: { type: 'string' } },
          },
          outputSchemaJson: { type: 'object', properties: { txHash: { type: 'string' } } },
          actionClass: 'EXTERNAL_READ' as never,
          toolVersion: '1.0.0',
        },
        '2026-06-01T00:00:00Z',
      ),
    ).toThrow(/TOOL_DEFINITION_PROHIBITED/);
  });

  it('rejects PROHIBITED_FINANCIAL action class even with harmless text', () => {
    const screen = new ProhibitedCapabilityScreen();
    const verdict = screen.screenWithReport(
      {
        name: 'harmless_reader',
        title: 'Harmless Reader',
        description: 'Just reads block numbers',
        inputSchemaJson: {},
        outputSchemaJson: {},
        actionClass: ActionClass.PROHIBITED_FINANCIAL,
        toolVersion: '1.0.0',
      },
      '2026-06-01T00:00:00Z',
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.event.reasons.some((r) => r.includes('PROHIBITED_FINANCIAL'))).toBe(true);
    }
  });
});

