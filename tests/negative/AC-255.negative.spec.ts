// AC-255 (negative): paired forbidden variants fail at BOTH enforcement
// layers — the build-scan layer detects swap endpoints / private-key env
// names / signing imports / transaction schema fields in fixtures, and the
// runtime-validation layer refuses the same shapes with typed errors.
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
const FIXTURES = path.join(REPO_ROOT, 'tests/fixtures/sec/prohibited');

function fixtureText(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

describe('AC-255 negative: paired forbidden variants fail policy', () => {
  const canary = new NegativeCapabilityCanary(loadCanaryCatalog());

  it('BUILD layer: the swap-endpoint fixture is detected as SWAP_ORDER_EXECUTION', () => {
    const found = canary.scanSourceText(
      'prohibited/swap-execution.ts',
      fixtureText('swap-execution.ts'),
    );
    expect(found.map((f) => f.category)).toContain('SWAP_ORDER_EXECUTION');
  });

  it('BUILD layer: the transaction fixture is detected as TRANSACTION_BUILD_SIGN_SUBMIT', () => {
    const found = canary.scanSourceText(
      'prohibited/transaction-submit.ts',
      fixtureText('transaction-submit.ts'),
    );
    expect(found.map((f) => f.category)).toContain('TRANSACTION_BUILD_SIGN_SUBMIT');
  });

  it('BUILD layer: the private-key fixture is detected as PRIVATE_KEY_SEED', () => {
    const found = canary.scanSourceText(
      'prohibited/wallet-keypair.ts',
      fixtureText('wallet-keypair.ts'),
    );
    expect(found.map((f) => f.category)).toContain('PRIVATE_KEY_SEED');
  });

  it('RUNTIME layer: private-key environment names refuse with typed errors', () => {
    const findings = canary.scanEnvironmentNames(['PRIVATE_KEY', 'SEED_PHRASE']);
    expect(findings.length).toBeGreaterThanOrEqual(2);
  });

  it('RUNTIME layer: forbidden execution query variants throw typed errors', () => {
    for (const query of ['swap SOL for USDC', 'execute trade on behalf of wallet']) {
      let error: unknown;
      try {
        canary.classifyWalletQuery(query);
      } catch (caught) {
        error = caught;
      }
      expect(error, query).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/forbidden execution variant|prohibited/i);
    }
  });
});

describe('AC-255 negative (tool-core substrate): prohibited-shape tool definitions fail registration screening', () => {
  const screen = new ProhibitedCapabilityScreen();
  const now = '2026-08-01T00:00:00Z';

  it('refuses registration for prohibited execution tool definitions across categories', () => {
    const prohibitedDefinitions = [
      {
        name: 'execute_gmgn_swap',
        title: 'Execute GMGN Swap',
        description: 'Execute swap order on DEX pool on behalf of caller',
        inputSchemaJson: { type: 'object', properties: { inputToken: { type: 'string' } } },
        outputSchemaJson: { type: 'object' },
        actionClass: ActionClass.EXTERNAL_READ,
        toolVersion: '1.0.0',
      },
      {
        name: 'gmgn_sign_transaction',
        title: 'Sign Transaction Payload',
        description: 'Sign raw transaction payload using private key seed',
        inputSchemaJson: { type: 'object', properties: { privateKey: { type: 'string' } } },
        outputSchemaJson: { type: 'object' },
        actionClass: ActionClass.EXTERNAL_READ,
        toolVersion: '1.0.0',
      },
      {
        name: 'gmgn_submit_broadcast_tx',
        title: 'Submit Broadcast Transaction',
        description: 'Submit raw signed transaction to RPC endpoint',
        inputSchemaJson: { type: 'object' },
        outputSchemaJson: { type: 'object' },
        actionClass: ActionClass.EXTERNAL_READ,
        toolVersion: '1.0.0',
      },
      {
        name: 'gmgn_manage_custody_wallet',
        title: 'Manage Custody Wallet',
        description: 'Custody wallet private key and seed phrase management',
        inputSchemaJson: { type: 'object' },
        outputSchemaJson: { type: 'object' },
        actionClass: ActionClass.EXTERNAL_READ,
        toolVersion: '1.0.0',
      },
      {
        name: 'gmgn_execute_trade',
        title: 'Execute Trade on Behalf of Wallet',
        description: 'Execute trade order on behalf of wallet',
        inputSchemaJson: { type: 'object' },
        outputSchemaJson: { type: 'object' },
        actionClass: ActionClass.EXTERNAL_READ,
        toolVersion: '1.0.0',
      },
      {
        name: 'harmless_query_name',
        title: 'Harmless Title',
        description: 'Benign description with structurally prohibited financial class',
        inputSchemaJson: { type: 'object' },
        outputSchemaJson: { type: 'object' },
        actionClass: ActionClass.PROHIBITED_FINANCIAL,
        toolVersion: '1.0.0',
      },
    ];

    for (const def of prohibitedDefinitions) {
      const verdict = screen.screenWithReport(def, now);
      expect(verdict.ok, def.name).toBe(false);
      if (!verdict.ok) {
        expect(verdict.event.toolName).toBe(def.name);
        expect(verdict.event.reasons.length).toBeGreaterThan(0);
        expect(verdict.event.at).toBe(now);
      }

      try {
        screen.screen(def, now);
        expect.unreachable(`definition ${def.name} must fail registration`);
      } catch (err) {
        expect(err).toBeInstanceOf(ForesiftError);
        expect((err as ForesiftError).code).toBe('TOOL_DEFINITION_PROHIBITED');
      }
    }
  });

  it('audited refusal events carry matched prohibited findings for prohibited tool definitions', () => {
    const verdict = screen.screenWithReport(
      {
        name: 'execute_swap_order',
        title: 'Execute Swap Order',
        description: 'Broadcast signed swap transaction using privateKey',
        inputSchemaJson: { type: 'object', properties: { privateKey: { type: 'string' } } },
        outputSchemaJson: { type: 'object' },
        actionClass: ActionClass.EXTERNAL_READ,
        toolVersion: '1.0.0',
      },
      now,
    );

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.event.toolName).toBe('execute_swap_order');
      expect(verdict.event.reasons.length).toBeGreaterThan(0);
      expect(verdict.event.findings.length).toBeGreaterThan(0);
    }
  });
});
