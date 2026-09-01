#!/usr/bin/env node
/** Zero-dependency deterministic manifest documentation generator. @requirement FR-TRACE-001 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SPEC_NAME = 'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

const encode = (value) => `${JSON.stringify(canonicalize(value))}\n`;
const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort();

async function walk(root, relative = '') {
  const result = [];
  let entries;
  try {
    entries = await readdir(path.join(root, relative), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return result;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (['.git', 'node_modules'].includes(entry.name)) continue;
    const child = path.posix.join(relative.replaceAll(path.sep, '/'), entry.name);
    if (entry.isDirectory()) result.push(...(await walk(root, child)));
    else if (entry.isFile()) result.push(child);
  }
  return result;
}

function globPattern(reference) {
  const raw = reference
    .split(/\s+@requirement\s+/)[0]
    .trim()
    .replaceAll('\\', '/');
  const escaped = raw.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return {
    raw,
    regex: new RegExp(
      `^${escaped.replaceAll('**', '\u0000').replaceAll('*', '[^/]*').replaceAll('\u0000', '.*')}$`,
    ),
  };
}

function resolveReferences(references, files) {
  const resolved = [];
  for (const reference of references) {
    const pattern = globPattern(reference);
    for (const file of files) if (pattern.regex.test(file)) resolved.push(file);
  }
  return uniqueSorted(resolved);
}

function assertUnique(items, namespace) {
  const seen = new Set();
  for (const item of items) {
    if (!item?.id) throw new Error(`${namespace}: item is missing id`);
    if (seen.has(item.id)) throw new Error(`${namespace}: duplicate id ${item.id}`);
    seen.add(item.id);
  }
}

export async function buildGeneratedFiles(repoRoot) {
  const specRoot = path.join(repoRoot, 'docs/spec');
  const manifestPath = path.join(specRoot, `${SPEC_NAME}.requirements.json`);
  const auditPath = path.join(specRoot, `${SPEC_NAME}.audit.json`);
  const [manifestBytes, auditBytes, allFiles] = await Promise.all([
    readFile(manifestPath),
    readFile(auditPath),
    walk(repoRoot),
  ]);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const audit = JSON.parse(auditBytes.toString('utf8'));
  for (const [name, items] of [
    ['requirements', manifest.requirements],
    ['acceptanceCriteria', manifest.acceptanceCriteria],
    ['invariants', manifest.invariants],
    ['adrs', manifest.adrs],
  ])
    assertUnique(items, name);

  const generated = new Map();
  generated.set('requirements.json', encode(manifest));
  const families = uniqueSorted(manifest.requirements.map((item) => item.family));
  for (const family of families) {
    const requirements = manifest.requirements.filter((item) => item.family === family);
    const implementationRefs = uniqueSorted(
      requirements.flatMap((item) => item.implementationRefs ?? []),
    );
    const telemetryRefs = uniqueSorted(requirements.flatMap((item) => item.telemetryRefs ?? []));
    const familySlug = family.replace(/^FR-/, '').toLowerCase();
    const surface = {
      family,
      requirementRefs: requirements.map((item) => item.id),
      surfaceRefs: uniqueSorted(requirements.flatMap((item) => item.apiToolUiRefs ?? [])),
      implementationRefs,
      resolvedImplementationPaths: resolveReferences(implementationRefs, allFiles),
      testRefs: uniqueSorted(requirements.flatMap((item) => item.testRefs ?? [])),
      telemetryRefs,
      telemetryCatalogRefs: allFiles.filter(
        (file) => file === `telemetry/${familySlug}.catalog.json`,
      ),
      schemaRefs: uniqueSorted(requirements.flatMap((item) => item.schemaRefs ?? [])),
      persistenceRefs: uniqueSorted(requirements.flatMap((item) => item.persistenceRefs ?? [])),
      activationGateRefs: uniqueSorted(
        requirements.flatMap((item) => item.activationGateRefs ?? []),
      ),
      rollbackRefs: uniqueSorted(requirements.flatMap((item) => item.rollbackRefs ?? [])),
    };
    generated.set(`${familySlug}-surfaces.json`, encode(surface));
  }

  const counts = {
    requirements: manifest.requirements.length,
    acceptanceCriteria: manifest.acceptanceCriteria.length,
    invariants: manifest.invariants.length,
    adrs: manifest.adrs.length,
    families: families.length,
  };
  const expectedCounts = {
    requirements: audit.manifest?.requirements,
    acceptanceCriteria: audit.manifest?.acceptanceCriteria,
    invariants: audit.manifest?.invariants,
    adrs: audit.manifest?.adrs,
    families: 58,
  };
  const errors = Object.keys(expectedCounts)
    .filter((key) => counts[key] !== expectedCounts[key])
    .map((key) => `COUNT_MISMATCH ${key}: ${counts[key]} != ${expectedCounts[key]}`);
  const manifestHash = sha256(manifestBytes);
  if (audit.hashes?.requirementManifestSha256 !== manifestHash)
    errors.push('HASH_MISMATCH manifest does not agree with audit');
  const integrity = {
    schema: 'foresift/requirement-manifest-integrity@1',
    verdict: errors.length === 0 ? 'PASS' : 'FAIL',
    errors,
    counts,
    hashes: {
      documentSha256: audit.hashes?.documentArtifactSha256,
      normalizedDocumentSha256: audit.hashes?.documentNormalizedSha256,
      sourceManifestSha256: manifestHash,
      auditSha256: sha256(auditBytes),
      generatedRequirementsSha256: sha256(generated.get('requirements.json')),
    },
  };
  generated.set('requirement-manifest.integrity.json', encode(integrity));
  return generated;
}

async function checkGenerated(repoRoot, generated) {
  const outputRoot = path.join(repoRoot, 'docs/generated');
  const drift = [];
  for (const [name, expected] of generated) {
    try {
      const actual = await readFile(path.join(outputRoot, name), 'utf8');
      if (actual !== expected)
        drift.push({ path: `docs/generated/${name}`, reason: 'byte mismatch' });
    } catch (error) {
      if (error.code === 'ENOENT')
        drift.push({ path: `docs/generated/${name}`, reason: 'not found' });
      else throw error;
    }
  }
  return drift;
}

async function generate(repoRoot, generated) {
  const outputRoot = path.join(repoRoot, 'docs/generated');
  await mkdir(outputRoot, { recursive: true });
  await Promise.all(
    [...generated].map(([name, bytes]) => writeFile(path.join(outputRoot, name), bytes, 'utf8')),
  );
}

function usage() {
  return `Usage: node scripts/generate-requirement-manifest/cli.mjs generate\n       node scripts/generate-requirement-manifest/cli.mjs --check\n\nOptions:\n  --check       Fail when docs/generated differs from deterministic output\n  --root PATH   Use PATH as the repository root (default: current directory)\n  --help        Show this help\n`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage());
    return;
  }
  let repoRoot = process.cwd();
  const rootIndex = args.indexOf('--root');
  if (rootIndex >= 0) {
    if (!args[rootIndex + 1]) throw new Error('--root requires a path');
    repoRoot = path.resolve(args[rootIndex + 1]);
    args.splice(rootIndex, 2);
  }
  const mode = args.length === 1 ? args[0] : undefined;
  if (!['generate', '--check'].includes(mode)) {
    process.stderr.write(usage());
    process.exitCode = 2;
    return;
  }
  const files = await buildGeneratedFiles(repoRoot);
  if (mode === 'generate') {
    await generate(repoRoot, files);
    process.stdout.write(
      `Generated requirements.json and ${files.size - 2} family surfaces files.\n`,
    );
    return;
  }
  const drift = await checkGenerated(repoRoot, files);
  if (drift.length) {
    process.stderr.write(`${JSON.stringify({ error: 'GENERATED_DOCS_DRIFT', drift }, null, 2)}\n`);
    process.exitCode = 1;
  } else
    process.stdout.write('Generated requirement manifest integrity verified; tree is clean.\n');
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
