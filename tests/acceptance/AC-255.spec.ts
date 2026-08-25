// AC-255 (acceptance): GMGN-shaped READ-ONLY query fixtures pass every gate
// while their paired forbidden variants fail with typed policy errors at
// both build-scan and runtime-validation layers.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NegativeCapabilityCanary,
  loadCanaryCatalog,
} from '../../packages/security/src/negative-capability.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLEAN_DIR = path.join(REPO_ROOT, 'tests/fixtures/sec/clean');

describe('AC-255: GMGN pair passes gates; forbidden pairs fail policy', () => {
  it('every admitted GMGN-shaped query passes the runtime policy gate', async () => {
    const queries = (await import('../fixtures/sec/clean/gmgn-query-pair.ts'))
      .ADMITTED_WALLET_INTELLIGENCE_QUERIES;
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    expect(queries.length).toBeGreaterThanOrEqual(7);
    for (const query of queries) {
      const verdict = canary.classifyWalletQuery(query);
      expect(verdict.admitted, query).toBe(true);
    }
  });

  it('the clean fixture corpus is scanner-silent on BOTH surfaces', async () => {
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    const files = readdirSync(CLEAN_DIR, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const file of files) {
      const rel = path.relative(REPO_ROOT, path.join(CLEAN_DIR, file)).split(path.sep).join('/');
      expect(
        canary.scanSourceText(rel, readFileSync(path.join(CLEAN_DIR, file), 'utf8')),
        rel,
      ).toEqual([]);
    }
    // And the static CLI agrees: scanning ONLY the clean subtree is clean.
    const { runScan } = await import(
      path.join(REPO_ROOT, 'scripts/scan-prohibited-capabilities/cli.mjs')
    );
    expect(runScan({ root: CLEAN_DIR }).clean).toBe(true);
  });

  it('paired forbidden variants refuse at the RUNTIME-validation layer', async () => {
    const { FORBIDDEN_EXECUTION_QUERY_VARIANTS } =
      await import('../fixtures/sec/clean/gmgn-query-pair.ts');
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    for (const variant of FORBIDDEN_EXECUTION_QUERY_VARIANTS) {
      expect(() => canary.classifyWalletQuery(variant), variant).toThrow(
        /forbidden execution variant|prohibited/i,
      );
    }
  });
});
