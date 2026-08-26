// AC-255 (acceptance): GMGN-shaped READ-ONLY query fixtures pass every gate
// while their paired forbidden variants fail with typed policy errors at
// both build-scan and runtime-validation layers.
import { readdirSync, readFileSync } from 'node:fs';
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

describe('AC-255 acceptance (tool-core substrate): permitted query fixtures pass registration screening', () => {
  const screen = new ProhibitedCapabilityScreen();
  const now = '2026-08-01T00:00:00Z';

  it('permits every admitted GMGN wallet-intelligence query fixture as an EXTERNAL_READ tool definition', async () => {
    const { ADMITTED_WALLET_INTELLIGENCE_QUERIES } = await import(
      '../fixtures/sec/clean/gmgn-query-pair.ts'
    );
    expect(ADMITTED_WALLET_INTELLIGENCE_QUERIES.length).toBeGreaterThanOrEqual(7);

    for (const query of ADMITTED_WALLET_INTELLIGENCE_QUERIES) {
      const toolName = query.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const verdict = screen.screenWithReport(
        {
          name: `gmgn_${toolName}`,
          title: `GMGN ${query}`,
          description: `Read-only wallet intelligence query: ${query}`,
          inputSchemaJson: {
            type: 'object',
            properties: { address: { type: 'string' } },
            required: ['address'],
          },
          outputSchemaJson: { type: 'object' },
          actionClass: ActionClass.EXTERNAL_READ,
          toolVersion: '1.0.0',
        },
        now,
      );
      expect(verdict.ok, query).toBe(true);
      expect(() =>
        screen.screen(
          {
            name: `gmgn_${toolName}`,
            title: `GMGN ${query}`,
            description: `Read-only wallet intelligence query: ${query}`,
            inputSchemaJson: {
              type: 'object',
              properties: { address: { type: 'string' } },
              required: ['address'],
            },
            outputSchemaJson: { type: 'object' },
            actionClass: ActionClass.EXTERNAL_READ,
            toolVersion: '1.0.0',
          },
          now,
        ),
      ).not.toThrow();
    }
  });

  it('permits clean query definitions across all admissible action classes', () => {
    const admissibleClasses = [
      ActionClass.EXTERNAL_READ,
      ActionClass.INTERNAL_STATE_WRITE,
      ActionClass.NOTIFICATION,
      ActionClass.ADMINISTRATIVE,
    ];

    for (const actionClass of admissibleClasses) {
      const verdict = screen.screenWithReport(
        {
          name: `query_${actionClass.toLowerCase()}`,
          title: `Query under ${actionClass}`,
          description: 'Read-only analytics and intelligence query for wallet portfolios',
          inputSchemaJson: { type: 'object' },
          outputSchemaJson: { type: 'object' },
          actionClass,
          toolVersion: '1.0.0',
        },
        now,
      );
      expect(verdict.ok, actionClass).toBe(true);
    }
  });
});
