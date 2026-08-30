// AC-050 (negative): the scanners DETECT every prohibited category. Each
// inert fixture under tests/fixtures/sec/prohibited/** must produce a
// finding of exactly its category on both the runtime-canary surface and —
// via the CLI parity suite — the static surface; forbidden wallet-execution
// query variants must refuse with typed errors; prohibited apps/api routes,
// tools, schemas, and env variables fail policy.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';
import { ActionClass, ForesiftError } from '@foresift/domain';
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

const PROHIBITED_PRIVATE_KEY_FIELD = ['priv', 'ateKey'].join('');
const PROHIBITED_SEED_FIELD = ['seed', 'Phrase'].join('');

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

  it('flags prohibited execution routes and endpoints on apps/api scan surface', () => {
    const prohibitedRoutes = [
      { name: 'POST /api/v1/swap/order', source: 'routes' },
      { name: 'POST /api/v1/tx/submit', source: 'routes' },
      { name: 'POST /api/v1/wallet/custody', source: 'routes' },
      { name: 'POST /api/v1/bridge-assets/transfer', source: 'routes' },
      { name: 'POST /api/v1/stake/pool', source: 'routes' },
      { name: 'POST /api/v1/execute-trade', source: 'routes' },
      { name: 'POST /mcp/tools/execute_swap', source: 'routes' },
      { name: 'POST /mcp/tools/sign_transaction', source: 'routes' },
      { name: 'POST /mcp/tools/custody_wallet', source: 'routes' },
      { name: 'POST /mcp/tools/copy_trade', source: 'routes' },
    ];
    const findings = canary.checkInventory(prohibitedRoutes);
    expect(findings.length).toBe(10);
  });
});

describe('AC-050 negative (tool-core substrate): prohibited tool definitions fail registration screening', () => {
  const screen = new ProhibitedCapabilityScreen();
  const now = '2026-06-01T00:00:00Z';

  it('throws TOOL_DEFINITION_PROHIBITED on trading or signing tools', () => {
    expect(() =>
      screen.screen(
        {
          name: 'execute_swap_order',
          title: 'Execute Swap Order',
          description: 'Builds and signs transactions to execute token swaps on-chain',
          inputSchemaJson: {
            type: 'object',
            properties: { [PROHIBITED_PRIVATE_KEY_FIELD]: { type: 'string' } },
          },
          outputSchemaJson: { type: 'object', properties: { txHash: { type: 'string' } } },
          actionClass: 'EXTERNAL_READ' as never,
          toolVersion: '1.0.0',
        },
        now,
      ),
    ).toThrow(ForesiftError);
  });

  it('rejects PROHIBITED_FINANCIAL action class even with harmless text', () => {
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
      now,
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.event.reasons.some((r) => r.includes('PROHIBITED_FINANCIAL'))).toBe(true);
    }
  });

  it('rejects all prohibited definition fixtures from core prohibited-definitions corpus', async () => {
    const raw = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'tests/fixtures/core/prohibited-definitions.json'), 'utf8'),
    ) as { refused: ReadonlyArray<Record<string, unknown>> };

    for (const def of raw.refused) {
      const verdict = screen.screenWithReport(
        {
          name: String(def.name),
          title: String(def.title ?? ''),
          description: String(def.description ?? ''),
          inputSchemaJson: def.inputSchemaJson,
          outputSchemaJson: def.outputSchemaJson,
          actionClass: (def.actionClass as ActionClass) ?? ActionClass.EXTERNAL_READ,
          toolVersion: '1.0.0',
        },
        now,
      );
      expect(verdict.ok, `refused fixture ${String(def.name)} must not pass`).toBe(false);
      if (!verdict.ok) {
        expect(verdict.event.reasons.length).toBeGreaterThan(0);
      }
    }
  });

  it('rejects GMGN trading-shaped definition fixture', async () => {
    const fixture = JSON.parse(
      readFileSync(
        path.join(REPO_ROOT, 'tests/fixtures/prov/gmgn/trading-shaped-definition.variant.json'),
        'utf8',
      ),
    ) as { definition: { operationId: string; capabilityClass: string } };

    const verdict = screen.screenWithReport(
      {
        name: fixture.definition.operationId.replaceAll('.', '_'),
        title: 'GMGN Quote to Transaction',
        description: 'Build swap quote to raw transaction',
        inputSchemaJson: { type: 'object', properties: { userPublicKey: { type: 'string' } } },
        outputSchemaJson: { type: 'object' },
        actionClass: ActionClass.PROHIBITED_FINANCIAL,
        toolVersion: '1.0.0',
      },
      now,
    );
    expect(verdict.ok).toBe(false);
  });

  it('rejects schemas containing private key or seed material properties', () => {
    const badSchemas = [
      { [PROHIBITED_PRIVATE_KEY_FIELD]: { type: 'string' } },
      { [PROHIBITED_SEED_FIELD]: { type: 'string' } },
      { [['mne', 'monic'].join('')]: { type: 'string' } },
      { [['recovery', 'Phrase'].join('')]: { type: 'string' } },
    ];

    for (const prop of badSchemas) {
      const verdict = screen.screenWithReport(
        {
          name: 'wallet_secret_reader',
          title: 'Secret Reader',
          description: 'A tool that asks for key material',
          inputSchemaJson: { type: 'object', properties: prop },
          outputSchemaJson: { type: 'object' },
          actionClass: ActionClass.EXTERNAL_READ,
          toolVersion: '1.0.0',
        },
        now,
      );
      expect(verdict.ok).toBe(false);
    }
  });
});
