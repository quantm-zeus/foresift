#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASENAME = 'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0';
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
const bytes = (value) => `${canonicalJson(value)}\n`;

async function allFiles(rootDir) {
  const output = [];
  const walk = async (relative) => {
    let entries;
    try {
      entries = await readdir(path.join(rootDir, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(child);
      else output.push(child);
    }
  };
  await walk('');
  return output.sort();
}
function globRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\0')
    .replaceAll('*', '[^/]*')
    .replaceAll('\0', '.*');
  return new RegExp(`^${escaped}$`);
}
const cleanRef = (reference) =>
  (reference.split(/\s+@(?:requirement|acceptance)\s+/, 1)[0] ?? reference).replace(/\/$/, '/**');
function related(manifest, requirement) {
  return {
    anchor: {
      line: requirement.line,
      section: requirement.section,
      subsection: requirement.subsection,
    },
    group: requirement.dependencyGroup,
    owner: requirement.owner,
    mappings: {
      implementationRefs: requirement.implementationRefs,
      schemaRefs: requirement.schemaRefs,
      persistenceRefs: requirement.persistenceRefs,
      apiToolUiRefs: requirement.apiToolUiRefs,
      testRefs: requirement.testRefs,
      fixtureRefs: requirement.fixtureRefs,
      telemetryRefs: requirement.telemetryRefs,
    },
    activationGate: requirement.activationGateRefs,
    rollbackTarget: requirement.rollbackRefs,
  };
}

export async function buildArtifacts(rootDir = process.cwd()) {
  const specDir = path.join(rootDir, 'docs/spec');
  const [manifestText, auditText, documentText, sumsText] = await Promise.all([
    readFile(path.join(specDir, `${BASENAME}.requirements.json`), 'utf8'),
    readFile(path.join(specDir, `${BASENAME}.audit.json`), 'utf8'),
    readFile(path.join(specDir, `${BASENAME}.md`), 'utf8'),
    readFile(path.join(specDir, 'SHA256SUMS'), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText);
  const audit = JSON.parse(auditText);
  const sums = new Map(
    sumsText
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const [hash, filename] = line.trim().split(/\s+/, 2);
        return [filename, hash];
      }),
  );
  const checked = [
    [`${BASENAME}.requirements.json`, manifestText],
    [`${BASENAME}.audit.json`, auditText],
    [`${BASENAME}.md`, documentText],
  ];
  const hashFindings = checked
    .filter(([name, content]) => sums.get(name) !== sha256(content))
    .map(([name]) => name);
  const lines = documentText.split(/\r?\n/);
  const anchorFindings = [
    ...manifest.requirements,
    ...manifest.acceptanceCriteria,
    ...manifest.invariants,
    ...manifest.adrs,
  ]
    .filter((item) => !lines[item.line - 1]?.includes(item.id))
    .map((item) => item.id);
  if (hashFindings.length || anchorFindings.length)
    throw new Error(
      `manifest validation refused: ${JSON.stringify({ hashFindings, anchorFindings })}`,
    );

  const requirements = manifest.requirements.map((item) => ({
    ...item,
    traceability: related(manifest, item),
  }));
  const acceptanceCriteria = manifest.acceptanceCriteria.map((item) => {
    const parents = manifest.requirements.filter((fr) => item.requirementRefs.includes(fr.id));
    return {
      ...item,
      anchor: { line: item.line, section: item.section, subsection: item.subsection },
      groups: [...new Set(parents.map((fr) => fr.dependencyGroup))].sort(),
      owners: [...new Set([item.evidenceOwner, ...parents.map((fr) => fr.owner)])].sort(),
      mappings: {
        implementationRefs: [...new Set(parents.flatMap((fr) => fr.implementationRefs))].sort(),
        testRefs: [item.positiveTestRef, item.negativeOrFailureTestRef],
      },
      activationGate: [...new Set(parents.flatMap((fr) => fr.activationGateRefs))].sort(),
      rollbackTarget: [...new Set(parents.flatMap((fr) => fr.rollbackRefs))].sort(),
    };
  });
  const invariants = manifest.invariants.map((item) => {
    const parents = manifest.requirements.filter((fr) =>
      fr.securityRightsCostControls.includes(item.id),
    );
    return {
      ...item,
      anchor: { line: item.line, section: item.section },
      groups: [...new Set(parents.map((fr) => fr.dependencyGroup))].sort(),
      owners: [...new Set(parents.map((fr) => fr.owner))].sort(),
      mappings: {
        implementationRefs: [...new Set(parents.flatMap((fr) => fr.implementationRefs))].sort(),
        testRefs: [item.testRef],
      },
      activationGate: [...new Set(parents.flatMap((fr) => fr.activationGateRefs))].sort(),
      rollbackTarget: [...new Set(parents.flatMap((fr) => fr.rollbackRefs))].sort(),
    };
  });
  const adrs = manifest.adrs.map((item) => ({
    ...item,
    anchor: { line: item.line, section: item.section },
    group: 'DOCUMENT',
    owner: 'architecture',
    mappings: { implementationRefs: [], testRefs: [] },
    activationGate: [],
    rollbackTarget: item.supersedes,
  }));
  const projection = {
    schema: 'foresift/requirement-manifest@1',
    document: manifest.document,
    dependencyGroups: manifest.dependencyGroups,
    requirements,
    acceptanceCriteria,
    invariants,
    adrs,
    releaseConformance: manifest.releaseConformance,
  };
  const files = await allFiles(rootDir);
  const artifacts = { 'docs/generated/requirements.json': bytes(projection) };
  for (const family of [...new Set(manifest.requirements.map((item) => item.family))].sort()) {
    const familyRequirements = manifest.requirements.filter((item) => item.family === family);
    const surfaces = [];
    for (const item of familyRequirements) {
      const resolved = [];
      for (const reference of item.implementationRefs) {
        const matcher = globRegex(cleanRef(reference));
        resolved.push(...files.filter((file) => matcher.test(file)));
      }
      surfaces.push({
        requirementId: item.id,
        surfaceRefs: item.apiToolUiRefs,
        resolvedImplementationPaths: [...new Set(resolved)].sort(),
        testRefs: item.testRefs,
        telemetryCatalogRefs: item.telemetryRefs.map((ref) =>
          ref.replace(/\/[^/]*\*$/, '.catalog.json').replace(/\.\*$/, '.catalog.json'),
        ),
        schemaRefs: item.schemaRefs,
      });
    }
    artifacts[`docs/generated/${family.slice(3).toLowerCase()}-surfaces.json`] = bytes({
      schema: 'foresift/requirement-surfaces@1',
      family,
      surfaces,
    });
  }
  const counts = {
    requirements: manifest.requirements.length,
    acceptanceCriteria: manifest.acceptanceCriteria.length,
    invariants: manifest.invariants.length,
    adrs: manifest.adrs.length,
  };
  artifacts['docs/generated/requirement-manifest.integrity.json'] = bytes({
    schema: 'foresift/requirement-manifest-integrity@1',
    valid: true,
    hashes: {
      documentArtifactSha256: sha256(documentText),
      documentNormalizedSha256: manifest.document.normalizedSha256,
      manifestSha256: sha256(manifestText),
      auditManifestSha256: audit.hashes.requirementManifestSha256,
    },
    counts,
    findings: [],
  });
  return artifacts;
}

export async function writeArtifacts(rootDir, artifacts) {
  await mkdir(path.join(rootDir, 'docs/generated'), { recursive: true });
  for (const [relative, content] of Object.entries(artifacts))
    await writeFile(path.join(rootDir, relative), content, 'utf8');
}
export async function checkArtifacts(rootDir, artifacts) {
  const differences = [];
  for (const [relative, expected] of Object.entries(artifacts)) {
    let actual;
    try {
      actual = await readFile(path.join(rootDir, relative), 'utf8');
    } catch {
      actual = undefined;
    }
    if (actual !== expected) differences.push(relative);
  }
  return differences.sort();
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const command = args.find((arg) => !arg.startsWith('-')) ?? (check ? 'generate' : undefined);
  if (command !== 'generate') throw new Error('usage: cli.mjs generate [--check] | --check');
  const rootDir = process.env.FORESIFT_ROOT
    ? path.resolve(process.env.FORESIFT_ROOT)
    : process.cwd();
  const artifacts = await buildArtifacts(rootDir);
  if (check) {
    const differences = await checkArtifacts(rootDir, artifacts);
    if (differences.length) {
      process.stdout.write(`${JSON.stringify({ ok: false, differences })}\n`);
      process.exitCode = 1;
    } else
      process.stdout.write(
        `${JSON.stringify({ ok: true, files: Object.keys(artifacts).length })}\n`,
      );
  } else {
    await writeArtifacts(rootDir, artifacts);
    process.stdout.write(`${JSON.stringify({ ok: true, files: Object.keys(artifacts).length })}\n`);
  }
}
const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked)
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = 1;
  });
