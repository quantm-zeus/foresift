// Prohibited-capability scanner CLI (T122). Exit 0 = clean, nonzero =
// findings. Emits a STABLE JSON report (sorted, deterministic ids) so CI
// diffs are meaningful and the runtime-canary parity test can consume the
// same classification output.
//
// FAIL-CLOSED EVIDENCE RULE (review fix): a file that cannot be stat'ed or
// read is NOT silently dropped from the evidence corpus — it is reported as
// an UNSCANNABLE_FILE finding, which makes the scan dirty. Otherwise making
// a prohibited file unreadable would be the cheapest adversarial dodge of
// the whole static gate.
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadCatalog,
  scanDependencyManifest,
  scanEnvironmentNames,
  scanSourceFile,
} from './scan.mjs';
import { collectInventory, verifyInventoryReadonly } from './inventory.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.mjs', '.cjs', '.js']);

/**
 * FIXTURE-CORPUS EXCLUSION RULE (documented in README.md): files under
 * tests/fixtures/sec/** intentionally CONTAIN prohibited-code text as
 * negative-acceptance fixtures; the scanner excludes them from its own
 * verdict while the parity test classifies those same fixtures explicitly.
 */
function isExcluded(relativePath) {
  return (
    relativePath.startsWith('tests/fixtures/sec/') ||
    relativePath === 'scripts/scan-prohibited-capabilities/catalog.json'
  );
}

function errnoReason(error) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return code ? `${code} (unreadable)` : 'unreadable';
}

/**
 * Directories never scanned, wherever they appear in the tree. `.claude` is
 * agent-session tooling state: its worktrees hold BRANCH CHECKOUTS of this
 * same repository, so sweeping them re-reports tracked content under nested
 * paths and escapes the top-level fixture exclusion (observed live: AC-050
 * went red locally because
 * `.claude/worktrees/<session>/tests/fixtures/sec/prohibited/**` — the
 * documented-excluded canary corpus — was swept). Same infrastructure class
 * as `.git`; every real finding in tracked source is still detected.
 */
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.claude']);

/**
 * Walk the tree yielding scannable files. Unreadable entries land in
 * `skips` as { rel, reason } so runScan can fail the scan closed.
 */
function* walk(rootDir, skips, rootRelative = '') {
  for (const entry of readdirSync(rootDir)) {
    const full = path.join(rootDir, entry);
    const relFromRoot = rootRelative === '' ? entry : `${rootRelative}/${entry}`;
    let stats;
    try {
      stats = lstatSync(full);
    } catch (error) {
      skips.push({ rel: relFromRoot, reason: `lstat failed: ${errnoReason(error)}` });
      continue;
    }
    // Symlinks are never followed; excluded dirs keep the scan inside the repo.
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry)) continue;
      yield* walk(full, skips, relFromRoot);
    } else if (
      (SCAN_EXTENSIONS.has(path.extname(entry)) || entry === 'package.json') &&
      !isExcluded(relFromRoot)
    ) {
      yield { full, rel: relFromRoot };
    }
  }
}

/** UNSCANNABLE_FILE findings share the uniform finding shape. */
function unscannableFinding(skip) {
  const sanitized = skip.rel.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return {
    findingId: `pc-unscannable-${sanitized}`,
    category: 'UNSCANNABLE_FILE',
    surface: 'SOURCE_TREE',
    reference: skip.rel,
    matchedPattern: skip.reason,
  };
}

export function runScan(options = {}) {
  const root = options.root ?? DEFAULT_ROOT;
  const catalogPath = options.catalogPath ?? path.join(SCRIPT_DIR, 'catalog.json');
  const catalog = loadCatalog(catalogPath);

  const findings = [];
  const skips = [];
  for (const { full, rel } of walk(root, skips)) {
    if (path.basename(rel) === 'package.json') {
      try {
        findings.push(
          ...scanDependencyManifest(rel, JSON.parse(readFileSync(full, 'utf8')), catalog),
        );
      } catch (error) {
        // A manifest that cannot be parsed could be hiding dependencies —
        // that IS gate-relevant, not ignorable.
        skips.push({ rel, reason: `manifest unreadable/unparseable: ${errnoReason(error)}` });
      }
      continue;
    }
    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch (error) {
      skips.push({ rel, reason: `read failed: ${errnoReason(error)}` });
      continue;
    }
    findings.push(...scanSourceFile(rel, text, catalog));
  }
  findings.push(...skips.map(unscannableFinding));

  const inventory = collectInventory(root);
  findings.push(...verifyInventoryReadonly(inventory, catalog));
  findings.push(...(inventory.unscannable ?? []).map(unscannableFinding));

  // Environment names come from committed env EXAMPLE files only — real
  // .env files never exist in git (and are git-ignored by contract).
  const envNames = [];
  try {
    const example = readFileSync(path.join(root, '.env.example'), 'utf8');
    for (const line of example.split('\n')) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (match) envNames.push(match[1]);
    }
  } catch {
    /* no .env.example committed yet */
  }
  findings.push(...scanEnvironmentNames(envNames, catalog));

  const sorted = [...findings].sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.surface.localeCompare(b.surface) ||
      a.reference.localeCompare(b.reference),
  );

  return {
    reportVersion: 1,
    catalogVersion: catalog.catalogVersion,
    scannedRoot: path.relative(root, root) || '.',
    clean: sorted.length === 0,
    summary: {
      totalFindings: sorted.length,
      byCategory: Object.fromEntries(
        [...new Set(sorted.map((f) => f.category))]
          .sort()
          .map((category) => [category, sorted.filter((f) => f.category === category).length]),
      ),
      inventorySizes: {
        routes: inventory.routes.length,
        tools: inventory.tools.length,
        schemas: inventory.schemas.length,
      },
    },
    findings: sorted,
  };
}

export function main(argv = process.argv.slice(2)) {
  const outIndex = argv.indexOf('--out');
  const report = runScan({ root: argv[0] ?? DEFAULT_ROOT });
  const serialized = JSON.stringify(report, null, 2);
  if (outIndex !== -1 && argv[outIndex + 1]) {
    writeFileSync(argv[outIndex + 1], `${serialized}\n`);
  } else {
    console.log(serialized);
  }
  console.error(
    report.clean
      ? `prohibited-capability scan CLEAN (${report.summary.inventorySizes.routes} routes, ${report.summary.inventorySizes.tools} tools, ${report.summary.inventorySizes.schemas} schemas inventoried)`
      : `prohibited-capability scan FOUND ${report.summary.totalFindings} issue(s)`,
  );
  return report.clean ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
