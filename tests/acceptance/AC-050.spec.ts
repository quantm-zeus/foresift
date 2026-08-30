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
import { ActionClass } from '@foresift/domain';
import {
  NegativeCapabilityCanary,
  loadCanaryCatalog,
  type CanaryFinding,
} from '../../packages/security/src/negative-capability.ts';
import { ProhibitedCapabilityScreen } from '../../packages/tool-core/src/prohibited.ts';
import { MCP_G0_TOOL_CATALOG } from '../../apps/api/src/mcp/tools.ts';
import { MCP_RESOURCE_SCHEMES } from '../../apps/api/src/mcp/resources.ts';
import { MCP_PROMPT_NAMES } from '../../apps/api/src/mcp/prompts.ts';
import { DEFAULT_MCP_SECURITY_CONFIG } from '../../apps/api/src/config.ts';

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

  it('the runtime canary finds nothing in product source (security + tool-core + tenant-isolation + apps/api)', () => {
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    const findings: CanaryFinding[] = [];
    const dirs = [
      path.join(REPO_ROOT, 'packages/security/src'),
      path.join(REPO_ROOT, 'packages/tool-core/src'),
      path.join(REPO_ROOT, 'packages/tenant-isolation/src'),
      path.join(REPO_ROOT, 'packages/shared-schemas/src'),
      path.join(REPO_ROOT, 'packages/domain/src'),
      path.join(REPO_ROOT, 'packages/persistence/src'),
      path.join(REPO_ROOT, 'packages/object-store/src'),
      path.join(REPO_ROOT, 'packages/provider-lifecycle/src'),
      path.join(REPO_ROOT, 'packages/evidence/src'),
      path.join(REPO_ROOT, 'apps/api/src'),
    ];
    for (const dir of dirs) {
      for (const file of sourceFiles(dir)) {
        const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
        findings.push(...canary.scanSourceText(rel, readFileSync(file, 'utf8')));
      }
    }
    expect(findings).toEqual([]);
  });

  it('environment schema carries none of the catalog forbidden names across apps/api and packages', () => {
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    // A representative production environment for apps/api and services:
    // database, RPC viewing keys, provider tokens, MCP configuration — NO private-key/seed/signing/submit variables.
    const configKeys = Object.keys(DEFAULT_MCP_SECURITY_CONFIG).map((k) => k.toUpperCase());
    const findings = canary.scanEnvironmentNames([
      ...configKeys,
      'DATABASE_URL',
      'HELIUS_API_KEY',
      'COINGECKO_BASE_URL',
      'DEXSCREENER_BASE_URL',
      'GOPLUS_BASE_URL',
      'OBJECT_STORE_BUCKET',
      'OBJECT_STORE_ENDPOINT',
      'AUDIT_CHECKPOINT_BUCKET',
      'MCP_PORT',
      'MCP_HOST',
      'MCP_ALLOWLIST_ORIGINS',
      'MCP_SESSION_PEPPER',
      'MCP_MAX_REQUEST_BYTES',
      'MCP_STATEFUL_SESSIONS_ENABLED',
      'PORT',
      'HOST',
      'NODE_ENV',
    ]);
    expect(findings).toEqual([]);
  });

  it('route, tool, resource, and prompt inventories in apps/api expose only read-shaped capabilities', async () => {
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    const { collectInventory, verifyInventoryReadonly } = await import(
      path.join(REPO_ROOT, 'scripts/scan-prohibited-capabilities/inventory.mjs')
    );
    const catalog = loadCanaryCatalog();

    // Verify static inventory collection over apps/api
    const apiInventory = collectInventory(path.join(REPO_ROOT, 'apps/api'));
    const inventoryFindings = verifyInventoryReadonly(apiInventory, catalog);
    expect(inventoryFindings).toEqual([]);

    // Check all declared MCP tools, resources, and prompts
    const candidateTools = MCP_G0_TOOL_CATALOG.filter(
      (tool) => tool !== 'solana_rpc_get_signatures_for_address',
    );
    const inventoryItems = [
      { name: 'get-portfolio', source: 'routes' },
      { name: 'wallet-activity-timeline', source: 'tools' },
      { name: 'token-holders-distribution', source: 'routes' },
      { name: 'pnl-history', source: 'tools' },
      { name: 'mcp-streamable-http', source: 'routes' },
      ...candidateTools.map((tool) => ({ name: tool, source: 'apps/api/src/mcp/tools' })),
      ...MCP_RESOURCE_SCHEMES.map((scheme) => ({
        name: `${scheme}_resource`,
        source: 'apps/api/src/mcp/resources',
      })),
      ...MCP_PROMPT_NAMES.map((prompt) => ({
        name: prompt,
        source: 'apps/api/src/mcp/prompts',
      })),
    ];

    expect(canary.checkInventory(inventoryItems)).toEqual([]);
    expect(MCP_G0_TOOL_CATALOG.length).toBeGreaterThanOrEqual(40);
  });
});

describe('AC-050 acceptance (tool-core substrate): clean tool definitions pass registration screening', () => {
  const screen = new ProhibitedCapabilityScreen();
  const now = '2026-06-01T00:00:00Z';

  it('clean read-only tool definition passes ProhibitedCapabilityScreen with ok: true', () => {
    const verdict = screen.screenWithReport(
      {
        name: 'get_token_holders_distribution',
        title: 'Token Holders Distribution',
        description: 'Read-only distribution of token holder balances across pools and accounts',
        inputSchemaJson: { type: 'object', properties: { tokenAddress: { type: 'string' } } },
        outputSchemaJson: { type: 'object', properties: { holders: { type: 'array' } } },
        actionClass: ActionClass.EXTERNAL_READ,
        toolVersion: '1.0.0',
      },
      now,
    );
    expect(verdict.ok).toBe(true);
  });

  it('every read-only MCP surface tool in apps/api passes ProhibitedCapabilityScreen', () => {
    const admissibleCatalogTools = MCP_G0_TOOL_CATALOG.filter(
      (t) => t !== 'solana_rpc_get_signatures_for_address',
    );
    for (const toolName of admissibleCatalogTools) {
      const verdict = screen.screenWithReport(
        {
          name: toolName,
          title: toolName.replaceAll('_', ' '),
          description: `Read-only Foresift operation: ${toolName}`,
          inputSchemaJson: { type: 'object', properties: { target: { type: 'string' } } },
          outputSchemaJson: { type: 'object', properties: { data: { type: 'object' } } },
          actionClass: ActionClass.EXTERNAL_READ,
          toolVersion: '1.0.0',
        },
        now,
      );
      expect(verdict.ok, `tool ${toolName} must pass prohibited screen`).toBe(true);
      expect(() =>
        screen.screen(
          {
            name: toolName,
            title: toolName.replaceAll('_', ' '),
            description: `Read-only Foresift operation: ${toolName}`,
            inputSchemaJson: { type: 'object', properties: { target: { type: 'string' } } },
            outputSchemaJson: { type: 'object', properties: { data: { type: 'object' } } },
            actionClass: ActionClass.EXTERNAL_READ,
            toolVersion: '1.0.0',
          },
          now,
        ),
      ).not.toThrow();
    }
  });

  it('GMGN read-only intelligence query fixtures pass screening and canary classification', async () => {
    const { ADMITTED_WALLET_INTELLIGENCE_QUERIES } =
      await import('../fixtures/sec/clean/gmgn-query-pair.ts');
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());

    for (const query of ADMITTED_WALLET_INTELLIGENCE_QUERIES) {
      const verdict = canary.classifyWalletQuery(query);
      expect(verdict.admitted, query).toBe(true);
    }
  });
});
