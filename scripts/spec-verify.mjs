#!/usr/bin/env node
/**
 * Foresift specification integrity verifier.
 *
 * Product-neutral verification of the authoritative contract in `docs/spec/`
 * (PRD + machine-readable requirement manifest + audit artifact + SHA256SUMS).
 *
 * Exits non-zero when any applicable verification fails. See
 * `docs/migration/SPEC_MIGRATION.md` for what each check guarantees and which
 * historical values are preserved as provenance rather than recomputed.
 *
 * Zero runtime dependencies: runs with plain `node`.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const SPEC_DIR = 'docs/spec';
const PRD_FILE = 'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md';
const MANIFEST_FILE = 'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json';
const AUDIT_FILE = 'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.audit.json';
const SUMS_FILE = 'SHA256SUMS';

// Paths where historical legacy-project references are allowed (migration
// provenance only): the full migration record, and the README's single required
// pointer to the specification source repository and commit.
const BRANDING_ALLOWLIST = [join('.', 'docs/migration'), join('.', 'README.md')];
// Built indirectly so this file does not itself contain the legacy brand literal
// and can keep scanning every other repository file under one allowlist rule.
const BRAND_PATTERN = new RegExp('chain[-_ ]?sieve', 'i');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const issues = [];
const checksRun = [];
const fail = (code, detail = '') => issues.push(detail ? `${code}: ${detail}` : code);

async function readSpecFile(name) {
  const path = join(SPEC_DIR, name);
  try {
    return await readFile(path, 'utf8');
  } catch {
    fail('MISSING_REQUIRED_SPEC_FILE', path);
    return null;
  }
}

// --- Check 1+2: required files exist and match SHA256SUMS -------------------
async function verifyChecksums() {
  checksRun.push('sha256sums');
  const prd = await readSpecFile(PRD_FILE);
  const manifestText = await readSpecFile(MANIFEST_FILE);
  const auditText = await readSpecFile(AUDIT_FILE);
  const sumsText = await readSpecFile(SUMS_FILE);
  if (prd === null || manifestText === null || auditText === null || sumsText === null) return {};

  const expected = new Map();
  for (const line of sumsText.split('\n')) {
    const match = /^([0-9a-f]{64})\s{2}(.+)$/.exec(line.trim());
    if (match) expected.set(match[2], match[1]);
  }
  for (const name of [AUDIT_FILE, PRD_FILE, MANIFEST_FILE]) {
    if (!expected.has(name)) fail('SHA256SUMS_MISSING_ENTRY', name);
  }
  if (expected.size !== 3) fail('SHA256SUMS_UNEXPECTED_ENTRY_COUNT', String(expected.size));
  for (const [name, hash] of expected) {
    const content = await readFile(join(SPEC_DIR, name), 'utf8').catch(() => null);
    if (content === null) fail('SHA256SUMS_TARGET_MISSING', name);
    else if (sha256(content) !== hash) fail('SHA256SUMS_HASH_MISMATCH', name);
  }
  return { prd, manifestText, auditText };
}

// --- Checks 3–7: audit hashes, counts, document metrics ---------------------
function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail('INVALID_SPEC_JSON', `${label}: ${error.message}`);
    return null;
  }
}

function expectEqual(valueA, valueB, label) {
  if (valueA !== valueB)
    fail(
      'INTEGRITY_METADATA_MISMATCH',
      `${label}: ${JSON.stringify(valueA)} != ${JSON.stringify(valueB)}`,
    );
}

function verifyAuditAndCounts(prd, manifestText, auditText, manifest) {
  checksRun.push('audit-hashes', 'document-metrics', 'count-agreement');
  const audit = parseJson(auditText, AUDIT_FILE);
  if (!audit || !manifest) return;

  // Audit-recorded hashes must match the actual released bytes.
  const recordedHashes = audit.hashes ?? {};
  expectEqual(
    recordedHashes.documentArtifactSha256,
    sha256(prd),
    'audit.hashes.documentArtifactSha256 vs PRD bytes',
  );
  expectEqual(
    recordedHashes.requirementManifestSha256,
    sha256(manifestText),
    'audit.hashes.requirementManifestSha256 vs manifest bytes',
  );

  // Normalized hash: cross-artifact consistency (see SPEC_MIGRATION.md provenance note).
  expectEqual(
    manifest.document?.normalizedSha256,
    recordedHashes.documentNormalizedSha256,
    'manifest.document.normalizedSha256 vs audit.hashes.documentNormalizedSha256',
  );

  // Document byte/line metrics.
  const prdBytes = Buffer.byteLength(prd, 'utf8');
  const prdLines = (prd.match(/\n/g) ?? []).length;
  expectEqual(
    audit.inventory?.documentBytes,
    prdBytes,
    'audit.inventory.documentBytes vs PRD bytes',
  );
  expectEqual(
    audit.inventory?.documentLines,
    prdLines,
    'audit.inventory.documentLines vs PRD lines',
  );
  expectEqual(manifest.document?.lineCount, prdLines, 'manifest.document.lineCount vs PRD lines');

  // Structural-audit copy of the artifact hash must agree too.
  expectEqual(
    audit.structuralAudit?.checks?.sha256,
    sha256(prd),
    'audit.structuralAudit.checks.sha256 vs PRD bytes',
  );

  // Four-way count agreement: manifest arrays ↔ audit inventory ↔ audit.manifest ↔ manifest.releaseConformance.
  const conformance = manifest.releaseConformance ?? {};
  const countTriples = [
    [
      'requirements',
      manifest.requirements?.length,
      audit.inventory?.functionalRequirements,
      audit.manifest?.requirements,
      conformance.requirementCount,
    ],
    [
      'acceptanceCriteria',
      manifest.acceptanceCriteria?.length,
      audit.inventory?.acceptanceCriteria,
      audit.manifest?.acceptanceCriteria,
      conformance.acceptanceCriteriaCount,
    ],
    [
      'invariants',
      manifest.invariants?.length,
      audit.inventory?.architectureInvariants,
      audit.manifest?.invariants,
      conformance.invariantCount,
    ],
    [
      'adrs',
      manifest.adrs?.length,
      audit.inventory?.acceptedADRs,
      audit.manifest?.adrs,
      conformance.adrCount,
    ],
  ];
  for (const [label, ...counts] of countTriples) {
    const distinct = [...new Set(counts)];
    if (distinct.length !== 1 || distinct[0] == null) {
      fail(
        'COUNT_DISAGREEMENT',
        `${label}: manifest=${counts[0]} inventory=${counts[1]} audit=${counts[2]} conformance=${counts[3]}`,
      );
    }
  }

  // Semantic-audit derived indexes recorded in the audit artifact.
  const api = extractApiRoutes(prd);
  const persistence = extractPersistenceEntities(prd);
  checksRun.push('api-uniqueness', 'persistence-uniqueness');
  expectEqual(
    api.length,
    audit.inventory?.apiRoutes,
    'extracted API routes vs audit.inventory.apiRoutes',
  );
  expectEqual(
    persistence.length,
    audit.inventory?.persistenceEntities,
    'extracted persistence entities vs audit.inventory.persistenceEntities',
  );
}

// --- Check 11: normative API/persistence section extraction -----------------
function extractApiRoutes(prd) {
  const start = prd.indexOf('## 29. API contract');
  const end = prd.indexOf('## 30.', start);
  if (start < 0 || end < 0) {
    fail('MISSING_NORMATIVE_SECTION', '## 29. API contract');
    return [];
  }
  const routes = [];
  for (const line of prd.slice(start, end).split('\n')) {
    const match =
      /^(GET|POST|PATCH|DELETE|PUT)(?:\/(GET|POST|PATCH|DELETE|PUT))?\s+(\/api\/v1\S+|\/mcp)\b/.exec(
        line.trim(),
      );
    if (match?.[1] && match[3]) {
      routes.push(`${match[1]} ${match[3]}`);
      if (match[2]) routes.push(`${match[2]} ${match[3]}`);
    }
  }
  const duplicate = routes.find((route, index) => routes.indexOf(route) !== index);
  if (duplicate) fail('DUPLICATE_API_ROUTE', duplicate);
  return routes;
}

function extractPersistenceEntities(prd) {
  const start = prd.indexOf('## 30. Core persistence model');
  const end = prd.indexOf('## 31.', start);
  if (start < 0 || end < 0) {
    fail('MISSING_NORMATIVE_SECTION', '## 30. Core persistence model');
    return [];
  }
  const entities = [];
  let fenced = false;
  for (const raw of prd.slice(start, end).split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced && /^[a-z][a-z0-9_]+$/.test(line)) entities.push(line);
  }
  const duplicate = entities.find((name, index) => entities.indexOf(name) !== index);
  if (duplicate) fail('DUPLICATE_PERSISTENCE_ENTITY', duplicate);
  return entities;
}

// --- Checks 8–10: entry hashes, anchors, IDs, references, DAG ---------------
const FR_ID_PATTERN = /^FR-[A-Z0-9]+-\d{3}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

function verifyManifestEntries(manifest, prdLines) {
  checksRun.push(
    'text-hashes',
    'line-anchors',
    'id-integrity',
    'reference-integrity',
    'dependency-dag',
  );
  if (!manifest) return;

  const ids = new Map(
    ['requirements', 'acceptanceCriteria', 'invariants', 'adrs'].map((key) => [
      key,
      new Set((manifest[key] ?? []).map((entry) => entry.id)),
    ]),
  );
  for (const [key] of ids) {
    const seen = new Set();
    for (const entry of manifest[key] ?? []) {
      if (seen.has(entry.id)) fail('DUPLICATE_NORMATIVE_ID', `${key}:${entry.id}`);
      seen.add(entry.id);
    }
  }

  // Requirement text hashes and ID shape (recomputed — deterministic contract).
  for (const requirement of manifest.requirements ?? []) {
    if (!FR_ID_PATTERN.test(requirement.id)) fail('MALFORMED_REQUIREMENT_ID', requirement.id);
    if (
      typeof requirement.text !== 'string' ||
      sha256(requirement.text) !== requirement.textSha256
    ) {
      fail('REQUIREMENT_TEXT_HASH_MISMATCH', requirement.id);
    }
  }
  // Acceptance-criteria and invariant text hashes.
  for (const criterion of manifest.acceptanceCriteria ?? []) {
    if (typeof criterion.text !== 'string' || sha256(criterion.text) !== criterion.textSha256) {
      fail('ACCEPTANCE_TEXT_HASH_MISMATCH', criterion.id);
    }
  }
  for (const invariant of manifest.invariants ?? []) {
    if (typeof invariant.text !== 'string' || sha256(invariant.text) !== invariant.textSha256) {
      fail('INVARIANT_TEXT_HASH_MISMATCH', invariant.id);
    }
  }
  // ADR entries carry generator-internal excerpt hashes that are not recoverable
  // outside the original toolchain (see SPEC_MIGRATION.md); verify format only.
  for (const adr of manifest.adrs ?? []) {
    if (!HASH_PATTERN.test(adr.textSha256 ?? '')) fail('ADR_TEXT_HASH_FORMAT', adr.id);
  }

  // Line anchors resolve to PRD lines containing the normative ID.
  for (const key of ['requirements', 'acceptanceCriteria', 'invariants', 'adrs']) {
    for (const entry of manifest[key] ?? []) {
      const line = prdLines[entry.line - 1];
      if (typeof line !== 'string' || !line.includes(entry.id)) {
        fail('LINE_ANCHOR_MISMATCH', `${key}:${entry.id}:${entry.line}`);
      }
    }
  }

  // Reference integrity.
  const groupIds = new Set((manifest.dependencyGroups ?? []).map((group) => group.id));
  for (const group of manifest.dependencyGroups ?? []) {
    for (const dependency of group.dependsOn ?? []) {
      if (!groupIds.has(dependency)) fail('INVALID_GROUP_DEPENDENCY', `${group.id}:${dependency}`);
    }
  }
  const referencedRequirements = new Set();
  for (const criterion of manifest.acceptanceCriteria ?? []) {
    if ((criterion.requirementRefs ?? []).length === 0)
      fail('ORPHAN_ACCEPTANCE_CRITERION', criterion.id);
    for (const ref of criterion.requirementRefs ?? []) {
      if (!ids.get('requirements').has(ref))
        fail('INVALID_REQUIREMENT_REF', `${criterion.id}:${ref}`);
      referencedRequirements.add(ref);
    }
  }
  for (const requirement of manifest.requirements ?? []) {
    if (!groupIds.has(requirement.dependencyGroup))
      fail('INVALID_DEPENDENCY_GROUP_REF', requirement.id);
    for (const ref of requirement.acceptanceCriteria ?? []) {
      if (!ids.get('acceptanceCriteria').has(ref))
        fail('INVALID_AC_REF', `${requirement.id}:${ref}`);
    }
    for (const ref of requirement.securityRightsCostControls ?? []) {
      if (ref.startsWith('INV-') && !ids.get('invariants').has(ref))
        fail('INVALID_INVARIANT_REF', `${requirement.id}:${ref}`);
    }
    if (!referencedRequirements.has(requirement.id)) fail('ORPHAN_REQUIREMENT', requirement.id);
  }

  // Dependency-group DAG must be acyclic.
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, path) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      fail('DEPENDENCY_GROUP_CYCLE', [...path, id].join('>'));
      return;
    }
    visiting.add(id);
    const group = (manifest.dependencyGroups ?? []).find((candidate) => candidate.id === id);
    for (const dependency of group?.dependsOn ?? []) visit(dependency, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const group of manifest.dependencyGroups ?? []) visit(group.id, []);
}

// --- Check 12: unresolved placeholders --------------------------------------
function verifyPlaceholders(prd) {
  checksRun.push('placeholder-scan');
  const match = /\{\{[^}]+\}\}|<TBD>/.exec(prd);
  if (match) fail('UNRESOLVED_PLACEHOLDER', match[0]);
}

// --- Check 13: accidental old branding outside provenance allowlist ---------
async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'dist', '.specify', '.claude', '.archon'].includes(entry.name))
        continue;
      yield* walk(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

async function verifyBranding(root) {
  checksRun.push('branding-scan');
  for await (const path of walk(root)) {
    const relativePath = relative(root, path);
    if (
      BRANDING_ALLOWLIST.some(
        (allowed) => relativePath === allowed || relativePath.startsWith(allowed + sep),
      )
    )
      continue;
    let content;
    try {
      content = await readFile(path, 'utf8');
    } catch {
      continue; // binary or unreadable — skip
    }
    if (BRAND_PATTERN.test(content)) fail('LEGACY_BRANDING_OUTSIDE_ALLOWLIST', relativePath);
  }
}

// --- Main -------------------------------------------------------------------
async function main() {
  const root = process.cwd();
  const { prd, manifestText, auditText } = await verifyChecksums();
  if (prd === null || manifestText === null || auditText === null) {
    report(checksRun);
    process.exit(1);
  }
  const manifest = parseJson(manifestText, MANIFEST_FILE);
  verifyAuditAndCounts(prd, manifestText, auditText, manifest);
  verifyManifestEntries(manifest, prd.split('\n'));
  verifyPlaceholders(prd);
  await verifyBranding(root);
  report(checksRun);
  process.exit(issues.length > 0 ? 1 : 0);
}

function report() {
  if (issues.length > 0) {
    console.error(`spec:verify FAILED — ${issues.length} issue(s):`);
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exitCode = 1;
  } else {
    console.log(`spec:verify OK — ${checksRun.length} checks passed (${checksRun.join(', ')})`);
  }
}

await main().catch((error) => {
  console.error('spec:verify CRASHED:', error);
  process.exit(1);
});
