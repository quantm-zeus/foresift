#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export function migrateMechanicalFile(root, entry, { write = false } = {}) {
  if (entry.migrationType !== 'EASY_MECHANICAL' || entry.state !== 'CODEMOD_READY')
    throw new Error(`BUN_CODEMOD_NOT_PROVEN_MECHANICAL: ${entry.path}`);
  const file = join(root, entry.path);
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(entry.path, text, ts.ScriptTarget.Latest, true);
  const replacements = [];
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    if (node.moduleSpecifier.text !== 'vitest') continue;
    replacements.push({
      start: node.moduleSpecifier.getStart(source),
      end: node.moduleSpecifier.getEnd(),
      value: "'bun:test'",
    });
  }
  if (replacements.length !== 1)
    throw new Error(`BUN_CODEMOD_IMPORT_SHAPE_CHANGED: ${entry.path}:${replacements.length}`);
  let migrated = text;
  for (const replacement of replacements.sort((a, b) => b.start - a.start))
    migrated =
      migrated.slice(0, replacement.start) + replacement.value + migrated.slice(replacement.end);
  if (write) writeFileSync(file, migrated);
  return { path: entry.path, changed: migrated !== text, output: migrated };
}

export function runMechanicalCodemod({ root, manifest, paths = null, write = false }) {
  const selected = manifest.files.filter(
    (entry) => entry.migrationType === 'EASY_MECHANICAL' && (!paths || paths.includes(entry.path)),
  );
  return selected.map((entry) => migrateMechanicalFile(root, entry, { write }));
}

function cli() {
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const root = value('--root') ?? process.cwd();
  const manifest = JSON.parse(readFileSync(value('--manifest'), 'utf8'));
  const paths = value('--paths')?.split(',').filter(Boolean) ?? null;
  const results = runMechanicalCodemod({ root, manifest, paths, write: argv.includes('--write') });
  process.stdout.write(
    JSON.stringify({ changed: results.filter((item) => item.changed).length, results }) + '\n',
  );
}

if (process.argv[1]?.endsWith('bun-migration-codemod.mjs')) cli();
