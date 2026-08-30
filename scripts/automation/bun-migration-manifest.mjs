#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { formatMilestoneText } from './schema.mjs';

export const BUN_MIGRATION_MANIFEST_SCHEMA = 'foresift/bun-migration-manifest@1';
export const BUN_DIRECT_IMPORTS = new Set([
  'afterAll',
  'afterEach',
  'beforeAll',
  'beforeEach',
  'describe',
  'expect',
  'it',
  'test',
]);

const SEMANTIC_PATTERNS = [
  ['table-driven-each', /\b(?:describe|it|test)\.each\b/],
  ['vitest-namespace', /\bvi\s*\./],
  ['vitest-module-mock', /\b(?:vi|vitest)\.(?:mock|doMock|unmock|resetModules)\b/],
  ['fake-timers', /\b(?:useFakeTimers|setSystemTime|advanceTimers|runAllTimers|useRealTimers)\b/],
  ['snapshot', /\btoMatch(?:Inline)?Snapshot\b/],
];

function slash(path) {
  return path.split(sep).join('/');
}

function gitFiles(root) {
  const result = spawnSync('git', ['ls-files', '-co', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`BUN_MANIFEST_GIT_FILES_FAILED: ${result.stderr}`);
  return result.stdout.split('\n').filter(Boolean);
}

export function isTestFile(path) {
  return /(?:^|\/)[^/]+\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/.test(path);
}

function packageFor(path) {
  const match = /^packages\/([^/]+)\//.exec(path);
  if (match) return `@foresift/${match[1]}`;
  if (path.startsWith('tests/automation/')) return 'automation';
  if (path.startsWith('tests/acceptance/')) return 'acceptance';
  if (path.startsWith('tests/negative/')) return 'negative';
  return 'root';
}

function workloadFor(path, text) {
  if (/\b(?:PGlite|@electric-sql\/pglite)\b/.test(text)) return 'DATABASE_PGLITE';
  if (/gate-e2e|foresift-gate|package-full-gate/.test(path + '\n' + text)) return 'META_GATE';
  if (/gitFixture|node:child_process|\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(/.test(text))
    return 'PROCESS';
  return 'PURE';
}

function sourceInfo(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const imports = [];
  const vitestImports = [];
  const bunImports = [];
  let dynamicImports = false;
  let functionWrappedRejects = false;
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      imports.push(from);
      const names = [];
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          names.push(element.propertyName?.text ?? element.name.text);
      const item = {
        from,
        names,
        start: node.moduleSpecifier.getStart(source),
        end: node.moduleSpecifier.getEnd(),
      };
      if (from === 'vitest') vitestImports.push(item);
      if (from === 'bun:test') bunImports.push(item);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      dynamicImports = true;
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'rejects' &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'expect' &&
      node.expression.arguments.length > 0 &&
      (ts.isArrowFunction(node.expression.arguments[0]) ||
        ts.isFunctionExpression(node.expression.arguments[0]))
    )
      functionWrappedRejects = true;
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { imports, vitestImports, bunImports, dynamicImports, functionWrappedRejects };
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function analyzeTestFile(root, path, previous = null) {
  const absolute = join(root, path);
  const text = readFileSync(absolute, 'utf8');
  const info = sourceInfo(path, text);
  const features = [];
  for (const [name, pattern] of SEMANTIC_PATTERNS) if (pattern.test(text)) features.push(name);
  const withoutRunnerImports = text.replace(
    /import\s+[^;\n]+\s+from\s+['"](?:vitest|bun:test)['"];?/g,
    '',
  );
  if (/\bvitest\b/i.test(withoutRunnerImports)) features.push('vitest-runtime-reference');
  if (info.dynamicImports) features.push('dynamic-import');
  if (info.functionWrappedRejects) features.push('function-wrapped-rejects');
  const importedNames = [...new Set(info.vitestImports.flatMap((item) => item.names))].sort();
  const unsupportedImports = importedNames.filter((name) => !BUN_DIRECT_IMPORTS.has(name));
  if (unsupportedImports.length)
    features.push(`unsupported-import:${unsupportedImports.join(',')}`);
  const alreadyMigrated = info.vitestImports.length === 0 && info.bunImports.length > 0;
  const bunRewriteRequired = features.some((feature) =>
    ['function-wrapped-rejects', 'vitest-runtime-reference'].includes(feature),
  );
  const migrationType = alreadyMigrated
    ? bunRewriteRequired
      ? 'SEMANTIC_REWRITE'
      : 'ALREADY_MIGRATED'
    : info.vitestImports.length === 1 &&
        unsupportedImports.length === 0 &&
        !features.some((feature) => feature !== 'dynamic-import')
      ? 'EASY_MECHANICAL'
      : info.vitestImports.length > 0
        ? 'SEMANTIC_REWRITE'
        : 'UNSUPPORTED_OR_AMBIGUOUS';
  const hash = sha256(text);
  const state =
    previous?.sha256 === hash && previous?.state === 'VERIFIED'
      ? 'VERIFIED'
      : migrationType === 'SEMANTIC_REWRITE'
        ? 'AGY_REQUIRED'
        : alreadyMigrated
          ? 'MIGRATED'
          : migrationType === 'EASY_MECHANICAL'
            ? 'CODEMOD_READY'
            : 'BLOCKED';

  return {
    path,
    package: packageFor(path),
    bytes: Buffer.byteLength(text),
    lines: text.split('\n').length,
    sha256: hash,
    imports: info.imports,
    vitestImports: importedNames,
    features: [...new Set(features)].sort(),
    workload: workloadFor(path, text),
    migrationType,
    fixturesAndHelpers: info.imports.filter((item) => /fixture|helper/.test(item)),
    sourceAnchors: info.imports.filter(
      (item) => !item.startsWith('node:') && !['vitest', 'bun:test'].includes(item),
    ),
    state,
  };
}

// State-control-plane specs are executed by CI's dedicated
// test:state-control-plane job. They must NOT enter the coordinator manifest:
// sweeping them into the PROCESS workload duplicates them and wedged the CI
// Process job ~1s into every attempt (observed live 2026-08-29 on the
// g0-cost-capacity landing PR after the first manifest regeneration).
export const STATE_CONTROL_PLANE_SPECS = Object.freeze([
  'tests/automation/ci-authority-hardening.spec.ts',
  'tests/automation/state-landing-lifecycle.spec.ts',
  'tests/automation/package-launch-intent.spec.ts',
  'tests/automation/ci-repair-lifecycle.spec.ts',
  'tests/automation/ci-diff-classifier.spec.ts',
  'tests/automation/state-authority-v2.spec.ts',
]);

export function buildBunMigrationManifest({ root = process.cwd(), previousFile = null } = {}) {
  let previous = null;
  if (previousFile && existsSync(previousFile))
    previous = JSON.parse(readFileSync(previousFile, 'utf8'));
  const previousByPath = new Map((previous?.files ?? []).map((entry) => [entry.path, entry]));
  const paths = gitFiles(root)
    .map(slash)
    .filter(isTestFile)
    .filter((path) => !STATE_CONTROL_PLANE_SPECS.includes(path))
    .sort();
  const files = paths.map((path) => analyzeTestFile(root, path, previousByPath.get(path)));
  const previousPaths = new Set((previous?.files ?? []).map((entry) => entry.path));
  const disappeared = [...previousPaths].filter(
    (path) => !paths.includes(path) && !STATE_CONTROL_PLANE_SPECS.includes(path),
  );
  if (disappeared.length)
    throw new Error(`BUN_MIGRATION_TEST_LOSS: ${disappeared.slice(0, 20).join(',')}`);
  const counts = Object.fromEntries(
    ['CODEMOD_READY', 'AGY_REQUIRED', 'MIGRATED', 'VERIFIED', 'BLOCKED'].map((state) => [
      state,
      files.filter((entry) => entry.state === state).length,
    ]),
  );
  return {
    schema: BUN_MIGRATION_MANIFEST_SCHEMA,
    migrationId: 'bun-test-authority-v1',
    generatedAt: new Date().toISOString(),
    root: '.',
    totalTestFiles: files.length,
    counts,
    parity: { previousTotal: previous?.totalTestFiles ?? files.length, disappeared: [] },
    files,
    batches: previous?.batches ?? [],
  };
}

async function cli() {
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const root = value('--root') ?? process.cwd();
  const out = value('--out');
  const manifest = buildBunMigrationManifest({ root, previousFile: value('--previous') });
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    // Prettier-format: the format:check gate covers this file, and raw
    // JSON.stringify output fails it (observed live 2026-08-30, PR #120).
    // formatMilestoneText resolves the repo prettier config + falls back.
    const formatted = await formatMilestoneText(JSON.stringify(manifest, null, 2) + '\n');
    writeFileSync(out, formatted);
  }
  process.stdout.write(JSON.stringify(manifest, null, out ? 0 : 2) + '\n');
}

if (process.argv[1]?.endsWith('bun-migration-manifest.mjs'))
  cli().then(
    () => process.exit(0),
    (err) => {
      console.error(err?.message ?? err);
      process.exit(1);
    },
  );
