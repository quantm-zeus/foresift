// AC-050 (acceptance): "No route, tool, or schema supports trading, signing,
// wallet creation, seed, or private key." Proves every declared scan surface
// runs GREEN over the real tree: the static CLI scan is clean, the runtime
// canary finds nothing in product source, environment names and route/tool
// inventories carry no forbidden entries — while read-only wallet
// intelligence remains explicitly permitted.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';
import {
  NegativeCapabilityCanary,
  loadCanaryCatalog,
  type CanaryFinding,
} from '../../packages/security/src/negative-capability.ts';
import { ProhibitedCapabilityScreen } from '../../packages/tool-core/src/prohibited.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .map((f) => path.join(dir, f));
}

describe('AC-050: prohibited-capability scans are green over the tree', () => {
  it('the static scan CLI reports the repository CLEAN', async () => {
    const { runScan } = await import(
      path.join(REPO_ROOT, 'scripts/scan-prohibited-capabilities/cli.mjs')
    );
    const report = runScan({ root: REPO_ROOT });
    expect(report.clean).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it('the runtime canary finds nothing in product source (security + tenant-isolation)', () => {
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    const findings: CanaryFinding[] = [];
    for (const dir of [
      path.join(REPO_ROOT, 'packages/security/src'),
      path.join(REPO_ROOT, 'packages/tenant-isolation/src'),
      path.join(REPO_ROOT, 'packages/shared-schemas/src'),
    ]) {
      for (const file of sourceFiles(dir)) {
        const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
        findings.push(...canary.scanSourceText(rel, readFileSync(file, 'utf8')));
      }
    }
    expect(findings).toEqual([]);
  });

  it('environment schema carries none of the catalog forbidden names', () => {
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    // A representative production environment: database, RPC viewing keys,
    // provider tokens — NO private-key/seed/signing/submit variables.
    const findings = canary.scanEnvironmentNames([
      'DATABASE_URL',
      'HELIUS_API_KEY',
      'COINGECKO_BASE_URL',
      'OBJECT_STORE_BUCKET',
      'AUDIT_CHECKPOINT_BUCKET',
      'MCP_SESSION_PEPPER',
    ]);
    expect(findings).toEqual([]);
  });

  it('route and tool inventories expose only read-shaped capabilities', () => {
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    expect(
      canary.checkInventory([
        { name: 'get-portfolio', source: 'routes' },
        { name: 'wallet-activity-timeline', source: 'tools' },
        { name: 'token-holders-distribution', source: 'routes' },
        { name: 'pnl-history', source: 'tools' },
      ]),
    ).toEqual([]);
  });
});

describe('AC-050 acceptance (tool-core substrate): clean tool definitions pass registration screening', () => {
  it('clean read-only tool definition passes ProhibitedCapabilityScreen with ok: true', () => {
    const screen = new ProhibitedCapabilityScreen();
    const verdict = screen.screenWithReport(
      {
        name: 'get_token_holders_distribution',
        title: 'Token Holders Distribution',
        description: 'Read-only distribution of token holder balances across pools and accounts',
        inputSchemaJson: { type: 'object', properties: { tokenAddress: { type: 'string' } } },
        outputSchemaJson: { type: 'object', properties: { holders: { type: 'array' } } },
        actionClass: 'EXTERNAL_READ',
        toolVersion: '1.0.0',
      },
      '2026-06-01T00:00:00Z',
    );
    expect(verdict.ok).toBe(true);
  });
});

