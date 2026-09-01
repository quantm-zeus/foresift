#!/usr/bin/env node
/** @requirement FR-TRACE-001 FR-TRACE-003 @acceptance AC-265 AC-266 */
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_NAME = 'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json';
const AUDIT_NAME = 'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.audit.json';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
  );
  return value;
}

function bytes(value) {
  return `${JSON.stringify(canonical(value))}\n`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function walk(root, directory = '') {
  const result = [];
  let entries = [];
  try { entries = await readdir(path.join(root, directory), { withFileTypes: true }); } catch { return result; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'docs/generated') continue;
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(root, relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result;
}

function globPattern(ref) {
  return ref.replace(/\s+@(?:requirement|acceptance)\s+.*$/, '').replaceAll('\\', '/');
}

function regexForGlob(glob) {
  let expression = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === '*' && glob[index + 1] === '*') { expression += '.*'; index += 1; }
    else if (character === '*') expression += '[^/]*';
    else expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${expression}$`);
}

function resolveRefs(refs, allFiles) {
  return [...new Set((refs ?? []).flatMap((ref) => {
    const pattern = globPattern(ref);
    if (!pattern.includes('*')) return allFiles.includes(pattern) ? [pattern] : [];
    const matcher = regexForGlob(pattern);
    return allFiles.filter((file) => matcher.test(file));
  }))].sort();
}

async function loadTelemetry(root) {
  const telemetryRoot = path.join(root, 'telemetry');
  let names = [];
  try { names = (await readdir(telemetryRoot)).filter((name) => name.endsWith('.catalog.json')).sort(); } catch {}
  const catalogs = [];
  for (const name of names) {
    try { catalogs.push({ path: `telemetry/${name}`, value: JSON.parse(await readFile(path.join(telemetryRoot, name), 'utf8')) }); } catch {}
  }
  return catalogs;
}

function telemetryEntriesFor(requirement, catalogs) {
  const family = requirement.family.replace(/^FR-/, '').toLowerCase();
  return catalogs.filter(({ path: catalogPath, value }) =>
    catalogPath === `telemetry/${family}.catalog.json` || JSON.stringify(value).includes(requirement.id),
  ).map(({ path: catalogPath }) => catalogPath).sort();
}

function validate(manifest, audit, sourceBytes) {
  const findings = [];
  const namespaces = [manifest.requirements, manifest.acceptanceCriteria, manifest.invariants, manifest.adrs];
  const ids = namespaces.flat().map((item) => item.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length) findings.push({ rule: 'GLOBAL_ID_UNIQUENESS', ids: [...new Set(duplicateIds)].sort() });
  const expected = audit?.manifest ?? {};
  const counts = {
    requirements: manifest.requirements.length,
    acceptanceCriteria: manifest.acceptanceCriteria.length,
    invariants: manifest.invariants.length,
    adrs: manifest.adrs.length,
  };
  const auditCounts = {
    requirements: expected.requirements,
    acceptanceCriteria: expected.acceptanceCriteria,
    invariants: expected.invariants,
    adrs: expected.adrs,
  };
  for (const key of Object.keys(counts)) if (auditCounts[key] !== counts[key]) findings.push({ rule: 'COUNT_AGREEMENT', path: key });
  if (audit?.hashes?.requirementManifestSha256 !== sha256(sourceBytes)) findings.push({ rule: 'MANIFEST_HASH_CONSISTENCY', path: SOURCE_NAME });
  return { counts, findings, isValid: findings.length === 0 };
}

export async function generateOutputs(root) {
  const specRoot = path.join(root, 'docs/spec');
  const sourcePath = path.join(specRoot, SOURCE_NAME);
  const auditPath = path.join(specRoot, AUDIT_NAME);
  if (!await exists(sourcePath)) throw new Error(`not found: ${sourcePath}`);
  const [sourceBytes, audit, allFiles, catalogs] = await Promise.all([
    readFile(sourcePath, 'utf8'),
    readFile(auditPath, 'utf8').then(JSON.parse),
    walk(root),
    loadTelemetry(root),
  ]);
  const manifest = JSON.parse(sourceBytes);
  const validation = validate(manifest, audit, sourceBytes);
  const outputs = new Map();
  outputs.set('requirements.json', bytes(manifest));

  const families = [...new Set(manifest.requirements.map((item) => item.family))].sort();
  for (const family of families) {
    const requirements = manifest.requirements.filter((item) => item.family === family).map((item) => ({
      id: item.id,
      anchor: { section: item.section, subsection: item.subsection, line: item.line },
      dependencyGroup: item.dependencyGroup,
      owner: item.owner,
      status: item.status,
      acceptanceCriteria: item.acceptanceCriteria,
      implementationRefs: item.implementationRefs,
      resolvedImplementationPaths: resolveRefs(item.implementationRefs, allFiles),
      testRefs: item.testRefs,
      schemaRefs: item.schemaRefs,
      resolvedSchemaPaths: resolveRefs(item.schemaRefs, allFiles),
      persistenceRefs: item.persistenceRefs,
      apiToolUiRefs: item.apiToolUiRefs,
      telemetryRefs: item.telemetryRefs,
      telemetryCatalogs: telemetryEntriesFor(item, catalogs),
      fixtureRefs: item.fixtureRefs,
      activationGateRefs: item.activationGateRefs,
      rollbackRefs: item.rollbackRefs,
    }));
    outputs.set(`${family.replace(/^FR-/, '').toLowerCase()}-surfaces.json`, bytes({
      schemaVersion: 'foresift/requirement-surfaces@1', family, requirements,
    }));
  }
  outputs.set('requirement-manifest.integrity.json', bytes({
    schemaVersion: 'foresift/requirement-manifest-integrity@1',
    verdict: validation.isValid ? 'VALID' : 'INVALID',
    findings: validation.findings,
    counts: validation.counts,
    hashes: {
      sourceManifestSha256: sha256(sourceBytes),
      normalizedDocumentSha256: manifest.document.normalizedSha256,
      canonicalProjectionSha256: sha256(outputs.get('requirements.json')),
    },
    generatedFiles: [...outputs.keys(), 'requirement-manifest.integrity.json'].sort(),
  }));
  return outputs;
}

async function run() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: node scripts/generate-requirement-manifest/cli.mjs generate | --check');
    return;
  }
  if (args.length !== 1 || !['generate', '--check'].includes(args[0])) {
    console.error('error: expected generate or --check; use --help for usage');
    process.exitCode = 1;
    return;
  }
  const root = process.cwd();
  const outputRoot = path.join(root, 'docs/generated');
  const outputs = await generateOutputs(root);
  if (args[0] === 'generate') {
    await mkdir(outputRoot, { recursive: true });
    for (const [name, content] of outputs) await writeFile(path.join(outputRoot, name), content);
    console.log(`generated ${outputs.size} deterministic files in docs/generated (requirements.json plus surfaces and integrity)`);
    return;
  }
  const drift = [];
  for (const [name, expected] of outputs) {
    const target = path.join(outputRoot, name);
    let actual;
    try { actual = await readFile(target, 'utf8'); } catch { drift.push({ path: `docs/generated/${name}`, reason: 'not found' }); continue; }
    if (actual !== expected) drift.push({ path: `docs/generated/${name}`, reason: 'byte mismatch' });
  }
  if (drift.length) {
    console.error(JSON.stringify({ error: 'generated documentation drift', findings: drift }));
    process.exitCode = 1;
  } else console.log(`integrity verified: ${outputs.size} generated files clean`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  run().catch((error) => { console.error(`error: ${error.message}`); process.exitCode = 1; });
}
