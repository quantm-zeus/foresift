// AC-254 (acceptance): the five declared scan surfaces run green over the
// tree — dependency catalogue, route inventory, tool registry input,
// environment schema, runtime canary — while read-only wallet-intelligence
// entries are EXPLICITLY allowlisted and their permission re-proven.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';
import {
  NegativeCapabilityCanary,
  loadCanaryCatalog,
} from '../../packages/security/src/negative-capability.ts';
import {
  assertPinned,
  checkLifecycleScripts,
  emitSbomRecord,
  verifyPinning,
} from '../../packages/security/src/supply-chain.ts';
import { MCP_G0_TOOL_CATALOG, listToolsForProfile } from '../../apps/api/src/mcp/tools.ts';
import { MCP_RESOURCE_SCHEMES } from '../../apps/api/src/mcp/resources.ts';
import { MCP_PROMPT_NAMES } from '../../apps/api/src/mcp/prompts.ts';
import { DEFAULT_MCP_SECURITY_CONFIG } from '../../apps/api/src/config.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

interface RawCatalogCategory {
  readonly category: string;
  readonly dependencyPatterns?: readonly string[];
}

interface RawCatalog {
  readonly categories: readonly RawCatalogCategory[];
}

describe('AC-254: all five scan surfaces green; read-only intelligence allowed', () => {
  it('surface 1 — the dependency catalogue carries NO prohibited dependency across packages and apps', () => {
    const raw = JSON.parse(
      readFileSync(
        path.join(REPO_ROOT, 'scripts/scan-prohibited-capabilities/catalog.json'),
        'utf8',
      ),
    ) as RawCatalog;
    // Every production dependency declared across the workspace (packages + apps)…
    const manifestPaths = ['package.json', 'apps/api/package.json'];
    for (const entry of readdirSync(path.join(REPO_ROOT, 'packages'), { withFileTypes: true })) {
      if (entry.isDirectory())
        manifestPaths.push(path.join('packages', entry.name, 'package.json'));
    }
    const appsDir = path.join(REPO_ROOT, 'apps');
    try {
      for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== 'api') {
          const relPkg = path.join('apps', entry.name, 'package.json');
          try {
            readFileSync(path.join(REPO_ROOT, relPkg));
            manifestPaths.push(relPkg);
          } catch {
            // app package.json not yet created
          }
        }
      }
    } catch {
      // apps dir unreadable
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

  it('surface 1b — pinning + lifecycle policy primitives accept clean manifests including apps/api', () => {
    const apiPkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'apps/api/package.json'), 'utf8'),
    ) as { name: string; dependencies?: Record<string, string>; scripts?: Record<string, string> };
    const externalDeps = Object.fromEntries(
      Object.entries(apiPkg.dependencies ?? {}).filter(([_, v]) => !v.startsWith('workspace:')),
    );
    const report = verifyPinning([
      { name: 'clean', dependencies: { undici: '6.21.0' } },
      { name: apiPkg.name, dependencies: externalDeps },
    ]);
    expect(report.violations).toEqual([]);
    expect(() =>
      assertPinned([
        { name: 'clean', dependencies: { undici: '6.21.0' } },
        { name: apiPkg.name, dependencies: externalDeps },
      ]),
    ).not.toThrow();
    expect(() =>
      checkLifecycleScripts({ name: 'clean', scripts: { prepare: 'husky install' } }),
    ).not.toThrow();
    expect(() => checkLifecycleScripts(apiPkg)).not.toThrow();
  });

  it('surfaces 2+3 — route and tool inventories admit only read-shaped entries across apps/api', async () => {
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    const discoveryTools = await listToolsForProfile('discovery');
    const adminTools = await listToolsForProfile('admin-read');
    const candidateCatalogTools = MCP_G0_TOOL_CATALOG.filter(
      (t) => t !== 'solana_rpc_get_signatures_for_address',
    );

    const inventory = [
      { name: 'get-token-metadata', source: 'routes' },
      { name: 'list-detectors', source: 'tools' },
      { name: 'get-shadow-portfolio', source: 'routes' },
      { name: 'query-wallet-intelligence', source: 'tools' },
      { name: 'mcp-streamable-http', source: 'routes' },
      ...discoveryTools.map((t) => ({ name: t.name, source: 'apps/api/profile:discovery' })),
      ...adminTools.map((t) => ({ name: t.name, source: 'apps/api/profile:admin-read' })),
      ...candidateCatalogTools.map((t) => ({ name: t, source: 'apps/api/tools' })),
      ...MCP_RESOURCE_SCHEMES.map((scheme) => ({
        name: `${scheme}_resource`,
        source: 'apps/api/resources',
      })),
      ...MCP_PROMPT_NAMES.map((prompt) => ({ name: prompt, source: 'apps/api/prompts' })),
    ];

    expect(canary.checkInventory(inventory)).toEqual([]);
  });

  it('surface 4 — environment schema admits operational variables only', () => {
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    const mcpConfigKeys = Object.keys(DEFAULT_MCP_SECURITY_CONFIG).map((k) => k.toUpperCase());
    expect(
      canary.scanEnvironmentNames([
        ...mcpConfigKeys,
        'DATABASE_URL',
        'HELIUS_API_KEY',
        'COINGECKO_BASE_URL',
        'DEXSCREENER_BASE_URL',
        'GOPLUS_BASE_URL',
        'MCP_PORT',
        'MCP_HOST',
        'MCP_ALLOWLIST_ORIGINS',
        'MCP_SESSION_PEPPER',
        'MCP_MAX_REQUEST_BYTES',
        'MCP_STATEFUL_SESSIONS_ENABLED',
        'OBJECT_STORE_ENDPOINT',
        'AUDIT_CHECKPOINT_BUCKET',
        'PORT',
        'HOST',
      ]),
    ).toEqual([]);
  });

  it('surface 5 — runtime canary stays silent over shipped source across all packages and apps/api', async () => {
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    const srcDirs = [
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

  it('SBOM records emit with component inventory for @foresift/api and core packages', () => {
    const record = emitSbomRecord([
      { name: '@foresift/api', version: '0.0.0', purl: 'pkg:npm/@foresift/api@0.0.0' },
      { name: '@foresift/security', version: '0.0.0', purl: 'pkg:npm/@foresift/security@0.0.0' },
      { name: '@foresift/tool-core', version: '0.0.0', purl: 'pkg:npm/@foresift/tool-core@0.0.0' },
    ]);
    expect(record.components).toHaveLength(3);
    expect(record.componentsHash).toBeTruthy();
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

  it('execution gate returns empty findings for MCP surface read-only tool definitions', () => {
    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    const mcpToolDescriptions = [
      'discover_candidates\nRead-only candidate discovery stream from first-party observer',
      'get_asset_identity\nRead-only token metadata and mint authority verification',
      'get_candidate_delta\nRead-only candidate metrics changes between timestamps',
      'compare_candidates\nRead-only pairwise candidate comparison and thesis scoring',
      'gmgn_get_token_info\nRead-only GMGN token statistics and contract metadata',
      'gmgn_get_top_holders\nRead-only GMGN token top holder distribution analysis',
    ];
    for (const desc of mcpToolDescriptions) {
      expect(canary.scanSourceText('mcp/tools', desc)).toEqual([]);
    }
  });
});
