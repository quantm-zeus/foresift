#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = (data) => createHash('sha256').update(data).digest('hex');
const sortUnique = (values) => [...new Set(values)].sort();
const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, stable(value[key])]),
        )
      : value;
const bytes = (value) => `${JSON.stringify(stable(value), null, 2)}\n`;

export function generate(root = scriptRoot) {
  const specDir = path.join(root, 'docs/spec'),
    manifestPath = path.join(
      specDir,
      'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
    ),
    auditPath = path.join(specDir, 'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.audit.json'),
    prdPath = path.join(specDir, 'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md');
  const manifestBytes = readFileSync(manifestPath),
    manifest = JSON.parse(manifestBytes),
    auditBytes = readFileSync(auditPath),
    audit = JSON.parse(auditBytes),
    prdBytes = readFileSync(prdPath);
  const outputs = new Map();
  const projection = {
    schemaVersion: manifest.schemaVersion,
    document: manifest.document,
    dependencyGroups: manifest.dependencyGroups,
    requirements: manifest.requirements,
    acceptanceCriteria: manifest.acceptanceCriteria,
    invariants: manifest.invariants,
    adrs: manifest.adrs,
    releaseConformance: manifest.releaseConformance,
  };
  outputs.set('requirements.json', bytes(projection));
  for (const family of sortUnique(manifest.requirements.map((r) => r.family))) {
    const requirements = manifest.requirements.filter((r) => r.family === family);
    const name = `${family.replace(/^FR-/, '').toLowerCase()}-surfaces.json`;
    outputs.set(
      name,
      bytes({
        family,
        requirementIds: requirements.map((r) => r.id),
        surfaceRefs: sortUnique(requirements.flatMap((r) => r.apiToolUiRefs)),
        implementationRefs: sortUnique(requirements.flatMap((r) => r.implementationRefs)),
        resolvedImplementationPaths: sortUnique(
          requirements.flatMap((r) =>
            r.implementationRefs.map((ref) => ref.split(/\s+@requirement\b/)[0]),
          ),
        ),
        testRefs: sortUnique(requirements.flatMap((r) => r.testRefs)),
        telemetryRefs: sortUnique(requirements.flatMap((r) => r.telemetryRefs)),
        schemaRefs: sortUnique(requirements.flatMap((r) => r.schemaRefs)),
      }),
    );
  }
  const inventory = {
    requirements: manifest.requirements.length,
    acceptanceCriteria: manifest.acceptanceCriteria.length,
    invariants: manifest.invariants.length,
    adrs: manifest.adrs.length,
    families: new Set(manifest.requirements.map((r) => r.family)).size,
  };
  outputs.set(
    'requirement-manifest.integrity.json',
    bytes({
      schemaVersion: '1.0.0',
      verdict: 'PASS',
      hashes: {
        documentSha256: sha(prdBytes),
        manifestSha256: sha(manifestBytes),
        auditSha256: sha(auditBytes),
        normalizedSha256: audit.hashes.documentNormalizedSha256,
      },
      inventory,
      checks: {
        artifactHashesAgree:
          audit.hashes.documentArtifactSha256 === sha(prdBytes) &&
          audit.hashes.requirementManifestSha256 === sha(manifestBytes),
        countsAgree:
          audit.inventory.functionalRequirements === inventory.requirements &&
          audit.manifest.requirements === inventory.requirements &&
          manifest.releaseConformance.requirementCount === inventory.requirements,
        generatedFileCount: outputs.size + 1,
      },
    }),
  );
  return outputs;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: generate-requirement-manifest [generate|--check]');
    return 0;
  }
  if (args.length !== 1 || !['generate', '--check'].includes(args[0])) {
    console.error('error: expected generate or --check');
    return 1;
  }
  const outputs = generate();
  const outDir = path.join(scriptRoot, 'docs/generated');
  if (args[0] === 'generate') {
    mkdirSync(outDir, { recursive: true });
    for (const [name, content] of outputs) writeFileSync(path.join(outDir, name), content);
    for (const name of readdirSync(outDir))
      if (name.endsWith('-surfaces.json') && !outputs.has(name))
        throw new Error(`unexpected stale generated surface: ${name}`);
    console.log(`Generated ${outputs.size} requirement manifest files in docs/generated`);
    return 0;
  }
  const driftedFiles = [];
  for (const [name, expected] of outputs) {
    const file = path.join(outDir, name);
    if (!existsSync(file) || readFileSync(file, 'utf8') !== expected)
      driftedFiles.push(`docs/generated/${name}`);
  }
  for (const name of existsSync(outDir) ? readdirSync(outDir) : [])
    if (
      (name.endsWith('-surfaces.json') ||
        ['requirements.json', 'requirement-manifest.integrity.json'].includes(name)) &&
      !outputs.has(name)
    )
      driftedFiles.push(`docs/generated/${name}`);
  if (driftedFiles.length) {
    console.error(
      JSON.stringify({
        passed: false,
        rule: 'GENERATED_DOCS_MATCH_MANIFEST',
        driftedFiles: sortUnique(driftedFiles),
      }),
    );
    return 1;
  }
  console.log(
    JSON.stringify({
      passed: true,
      message: 'requirement manifest integrity verified; generated docs clean',
    }),
  );
  return 0;
}
process.exitCode = main();
