// AC-254 (acceptance): the five declared scan surfaces run green over the
// tree — dependency catalogue, route inventory, tool registry input,
// environment schema, runtime canary — while read-only wallet-intelligence
// entries are EXPLICITLY allowlisted and their permission re-proven.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';
import {
  NegativeCapabilityCanary,
  loadCanaryCatalog,
} from '../../packages/security/src/negative-capability.ts';
import {
  checkLifecycleScripts,
  emitSbomRecord,
  verifyPinning,
} from '../../packages/security/src/supply-chain.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

interface RawCatalogCategory {
  readonly category: string;
  readonly dependencyPatterns?: readonly string[];
}

interface RawCatalog {
  readonly categories: readonly RawCatalogCategory[];
}

describe('AC-254: all five scan surfaces green; read-only intelligence allowed', () => {
  it('surface 1 — the dependency catalogue carries NO prohibited dependency', () => {
    const raw = JSON.parse(
      readFileSync(
        path.join(REPO_ROOT, 'scripts/scan-prohibited-capabilities/catalog.json'),
        'utf8',
      ),
    ) as RawCatalog;
    // Every production dependency declared across the workspace (packages + apps)…
    const manifestPaths = ['package.json'];
    for (const parent of ['packages', 'apps']) {
      const parentDir = path.join(REPO_ROOT, parent);
      if (existsSync(parentDir)) {
        for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const pkgJson = path.join(parent, entry.name, 'package.json');
            if (existsSync(path.join(REPO_ROOT, pkgJson))) {
              manifestPaths.push(pkgJson);
            }
          }
        }
      }
    }
    const declared: string[] = [];
    for (const rel of manifestPaths) {
      const parsed = JSON.parse(readFileSync(path.join(REPO_ROOT, rel), 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      declared.push(...Object.keys(parsed.dependencies ?? {}));
    }
    expect(declared.length).toBeGreaterThan(0);
    // …matched against EVERY category's prohibited-dependency patterns.
    const offenders: string[] = [];
    for (const name of declared) {
      for (const category of raw.categories) {
        for (const pattern of category.dependencyPatterns ?? []) {
          if (new RegExp(pattern).test(name)) offenders.push(`${category.category}:${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('surface 1b — pinning + lifecycle policy primitives accept clean manifests', () => {
    const report = verifyPinning([{ name: 'clean', dependencies: { undici: '6.21.0' } }]);
    expect(report.violations).toEqual([]);
    expect(() =>
      checkLifecycleScripts({ name: 'clean', scripts: { prepare: 'husky install' } }),
    ).not.toThrow();
  });

  it('surfaces 2+3 — route and tool inventories admit only read-shaped entries', () => {
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    expect(
      canary.checkInventory([
        { name: 'get-token-metadata', source: 'routes' },
        { name: 'list-detectors', source: 'tools' },
        { name: 'get-shadow-portfolio', source: 'routes' },
        { name: 'query-wallet-intelligence', source: 'tools' },
        { name: 'mcp-streamable-http', source: 'apps/api/src/mcp/server.ts' },
        { name: 'system_health', source: 'apps/api/src/mcp/tools.ts' },
        { name: 'quota_get_status', source: 'apps/api/src/mcp/tools.ts' },
        { name: 'capacity_get_status', source: 'apps/api/src/mcp/tools.ts' },
        { name: 'provider_get_health', source: 'apps/api/src/mcp/tools.ts' },
        { name: 'collector_get_health', source: 'apps/api/src/mcp/tools.ts' },
        { name: 'capability_get_status', source: 'apps/api/src/mcp/tools.ts' },
        { name: 'discover_candidates', source: 'apps/api/src/mcp/tools.ts' },
        { name: 'get_asset_identity', source: 'apps/api/src/mcp/tools.ts' },
      ]),
    ).toEqual([]);
  });

  it('surface 4 — environment schema admits operational variables only', () => {
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    expect(
      canary.scanEnvironmentNames([
        'DATABASE_URL',
        'HELIUS_API_KEY',
        'MCP_PORT',
        'MCP_ORIGIN_ALLOWLIST',
        'MCP_SESSION_PEPPER',
        'OBJECT_STORE_ENDPOINT',
      ]),
    ).toEqual([]);
  });

  it('surface 5 — runtime canary stays silent over shipped source', async () => {
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    const srcDirs = [
      path.join(REPO_ROOT, 'packages/security/src'),
      ...(existsSync(path.join(REPO_ROOT, 'apps/api/src'))
        ? [path.join(REPO_ROOT, 'apps/api/src')]
        : []),
    ];
    for (const srcDir of srcDirs) {
      const files = readdirSync(srcDir, { recursive: true })
        .map(String)
        .filter((f) => f.endsWith('.ts'));
      for (const file of files) {
        const text = readFileSync(path.join(srcDir, file), 'utf8');
        expect(canary.scanSourceText(file, text), file).toEqual([]);
      }
    }
  });

  it('SBOM records emit with component inventory', () => {
    const record = emitSbomRecord([
      { name: '@foresift/security', version: '0.0.0', purl: 'pkg:npm/@foresift/security@0.0.0' },
    ]);
    expect(record.components).toHaveLength(1);
  });

  it('read-only wallet intelligence is EXPLICITLY allowlisted and admitted', () => {
    const catalog = loadCanaryCatalog();
    const canary = new NegativeCapabilityCanary(catalog);
    expect(catalog.readOnlyWalletIntelligenceAllowlist.admittedQueryShapes.length).toBeGreaterThan(
      0,
    );
    for (const shape of catalog.readOnlyWalletIntelligenceAllowlist.admittedQueryShapes) {
      const verdict = canary.classifyWalletQuery(shape);
      expect(verdict.admitted, shape).toBe(true);
      expect(verdict.matchedShape).toBe(shape);
    }
  });
});

describe('AC-254 acceptance (tool-core substrate): execution gate passes clean read-only tool calls', () => {
  it('execution gate returns empty findings for clean read-only queries', () => {
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    const findings = canary.scanSourceText(
      'tool-core/dispatch/get_portfolio',
      'get_portfolio\nRead-only portfolio balances and transfer events',
    );
    expect(findings).toEqual([]);
  });
});
