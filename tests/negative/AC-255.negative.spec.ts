// AC-255 (negative): paired forbidden variants fail at BOTH enforcement
// layers — the build-scan layer detects swap endpoints / private-key env
// names / signing imports / transaction schema fields in fixtures, and the
// runtime-validation layer refuses the same shapes with typed errors.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NegativeCapabilityCanary,
  loadCanaryCatalog,
} from '../../packages/security/src/negative-capability.ts';

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
