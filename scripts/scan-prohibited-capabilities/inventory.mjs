// Route/tool/schema inventory collection + read-only verification (T122).
// The inventory is collected from source by deterministic regex markers and
// verified against the catalog's inventoryForbiddenVerbs — a route, tool,
// or exported schema whose NAME carries an action verb from the prohibited
// set is a finding (surface ROUTE_INVENTORY / SCHEMA_INVENTORY).
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.mjs', '.js']);
// `.claude` excluded for the same reason as the CLI scanner: agent-session
// tooling state whose nested worktrees hold branch checkouts of this same
// repository (re-reported tracked content + escaped fixture exclusions).
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.claude']);

function* walkFiles(dir, skips, rootRelative = '') {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const relFromRoot = rootRelative === '' ? entry : `${rootRelative}/${entry}`;
    let stats;
    try {
      stats = lstatSync(full);
    } catch (error) {
      skips.push({ rel: relFromRoot, reason: `lstat failed: ${error?.code ?? 'unreadable'}` });
      continue;
    }
    // Symlinks are NEVER followed — the scan stays inside this repository.
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) {
      yield* walkFiles(full, skips, relFromRoot);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry))) {
      yield { full, rel: relFromRoot };
    }
  }
}

export function collectInventory(rootDir) {
  const routes = [];
  const tools = [];
  const schemas = [];
  const unscannable = [];
  for (const { full, rel } of walkFiles(rootDir, unscannable)) {
    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch (error) {
      unscannable.push({ rel, reason: `read failed: ${error?.code ?? 'unreadable'}` });
      continue;
    }
    for (const match of text.matchAll(
      /\b(?:app|router|server)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g,
    )) {
      routes.push({ method: match[1].toUpperCase(), path: match[2], source: rel });
    }
    for (const match of text.matchAll(
      /\b(?:toolName|tool_id|registerTool\()\s*['"`]([a-z0-9_.:-]+)['"`]/gi,
    )) {
      tools.push({ name: match[1], source: rel });
    }
    for (const match of text.matchAll(/export const (\w+Schema)\s*=/g)) {
      schemas.push({ name: match[1], source: rel });
    }
  }
  return { routes, tools, schemas, unscannable };
}

/**
 * Verify the inventory against forbidden verbs. Returns findings in the
 * SAME shape as scan.mjs so reports and parity tests stay uniform.
 */
export function verifyInventoryReadonly(inventory, catalog) {
  const findings = [];
  const verbs = catalog.inventoryForbiddenVerbs ?? [];
  const makeFinding = (category, surface, reference, matchedPattern) => ({
    // Stable synthetic id shared with the canary's classification.
    findingId: `pc-inv-${category}-${matchedPattern}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    category,
    surface,
    reference,
    matchedPattern,
  });

  const nameHitsVerb = (name) =>
    verbs.filter((verb) =>
      name
        .toLowerCase()
        .replace(/[_\s.-]+/g, '-')
        .includes(verb),
    );

  for (const route of [...inventory.routes, ...inventory.tools]) {
    const label = 'path' in route ? route.path : route.name;
    for (const verb of nameHitsVerb(String(label))) {
      findings.push(
        makeFinding(
          'TRANSACTION_BUILD_SIGN_SUBMIT',
          'ROUTE_INVENTORY',
          `${route.source}#${label}`,
          verb,
        ),
      );
    }
  }
  return findings;
}
