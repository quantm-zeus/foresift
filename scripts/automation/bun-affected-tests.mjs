#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { isTestFile } from './bun-migration-manifest.mjs';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

function slash(path) {
  return path.split(sep).join('/');
}

function packageName(path) {
  return /^packages\/([^/]+)\//.exec(path)?.[1] ?? null;
}

function candidates(root, importer, specifier) {
  let base;
  if (specifier.startsWith('.')) base = resolve(root, dirname(importer), specifier);
  else {
    const match = /^@foresift\/([^/]+)(?:\/(.*))?$/.exec(specifier);
    if (!match) return [];
    base = resolve(root, 'packages', match[1], match[2] ?? 'src/index');
  }
  const values = [base];
  if (!extname(base)) {
    for (const extension of SOURCE_EXTENSIONS) values.push(`${base}${extension}`);
    for (const extension of SOURCE_EXTENSIONS) values.push(join(base, `index${extension}`));
  }
  return values.map((value) => slash(relative(root, normalize(value))));
}

function staticImports(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const imports = [];
  let ambiguous = false;
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier))
      imports.push(node.moduleSpecifier.text);
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      ambiguous = true;
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { imports, ambiguous };
}

export function buildImportGraph(root, paths) {
  const existing = new Set(paths.filter((path) => existsSync(join(root, path))));
  const reverse = new Map();
  const ambiguousImporters = new Set();
  for (const importer of existing) {
    if (!SOURCE_EXTENSIONS.includes(extname(importer))) continue;
    const { imports, ambiguous } = staticImports(
      importer,
      readFileSync(join(root, importer), 'utf8'),
    );
    if (ambiguous) ambiguousImporters.add(importer);
    for (const specifier of imports) {
      const target = candidates(root, importer, specifier).find((candidate) =>
        existing.has(candidate),
      );
      if (!target) continue;
      if (!reverse.has(target)) reverse.set(target, new Set());
      reverse.get(target).add(importer);
    }
  }
  return { reverse, ambiguousImporters };
}

function packageTests(allPaths, packageId) {
  if (!packageId) return [];
  return allPaths.filter(
    (path) => isTestFile(path) && path.startsWith(`packages/${packageId}/test/`),
  );
}

export function selectAffectedTests({ root = process.cwd(), changedPaths, allPaths }) {
  const normalizedChanges = [...new Set(changedPaths.map(slash))].sort();
  if (normalizedChanges.length === 0)
    return { ok: false, mode: 'FULL', reason: 'ZERO_CHANGED_PATHS', tests: [] };
  const { reverse, ambiguousImporters } = buildImportGraph(root, allPaths);
  const selected = new Set();
  const reasons = [];
  let mode = 'AFFECTED';
  for (const changed of normalizedChanges) {
    if (isTestFile(changed) && existsSync(join(root, changed))) selected.add(changed);
    const packageId = packageName(changed);
    if (!existsSync(join(root, changed))) {
      const fallback = packageTests(allPaths, packageId);
      if (fallback.length) {
        fallback.forEach((path) => selected.add(path));
        mode = 'PACKAGE';
        reasons.push(`deleted:${changed}`);
      } else return { ok: false, mode: 'FULL', reason: `DELETED_UNKNOWN:${changed}`, tests: [] };
      continue;
    }
    const queue = [changed];
    const seen = new Set(queue);
    while (queue.length) {
      const current = queue.shift();
      for (const importer of reverse.get(current) ?? []) {
        if (seen.has(importer)) continue;
        seen.add(importer);
        if (isTestFile(importer)) selected.add(importer);
        else queue.push(importer);
      }
    }
    const ambiguousInPackage = [...ambiguousImporters].some(
      (path) => packageName(path) === packageId,
    );
    if (ambiguousInPackage && packageId) {
      packageTests(allPaths, packageId).forEach((path) => selected.add(path));
      mode = 'PACKAGE';
      reasons.push(`dynamic-import:${packageId}`);
    }
  }
  if (selected.size === 0)
    return {
      ok: false,
      mode: 'FULL',
      reason: `ZERO_MATCH_FAIL_CLOSED:${normalizedChanges.join(',')}`,
      tests: [],
    };
  return {
    ok: true,
    mode,
    reason: reasons.join(';') || 'static-import-graph',
    changedPaths: normalizedChanges,
    tests: [...selected].sort(),
  };
}

export function repositorySourcePaths(root = process.cwd()) {
  const result = spawnSync('git', ['ls-files', '-co', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`BUN_AFFECTED_GIT_FILES_FAILED: ${result.stderr}`);
  return result.stdout
    .split('\n')
    .filter((path) => /\.(?:[cm]?[jt]sx?)$/.test(path))
    .map(slash);
}

function cli() {
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const root = value('--root') ?? process.cwd();
  const changedPaths = value('--changed-file')
    ? readFileSync(value('--changed-file'), 'utf8').split('\n').filter(Boolean)
    : (value('--changed')?.split(',').filter(Boolean) ?? []);
  const result = selectAffectedTests({
    root,
    changedPaths,
    allPaths: repositorySourcePaths(root),
  });
  const out = value('--out');
  if (out) writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.ok ? 0 : 3;
}

if (process.argv[1]?.endsWith('bun-affected-tests.mjs')) cli();
