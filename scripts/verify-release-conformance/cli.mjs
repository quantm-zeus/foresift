#!/usr/bin/env node
/** @requirement FR-TRACE-003 @acceptance AC-266 */
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { generateOutputs } from '../generate-requirement-manifest/cli.mjs';

const MANIFEST = 'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json';
const DOCUMENT = 'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md';
const AUDIT = 'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.audit.json';

function finding(requirementId, rule, filePath, message) {
  return { requirementId, rule, path: filePath, message };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function mappedPath(ref) {
  return ref
    .replace(/\s+@(?:requirement|acceptance)\s+.*$/, '')
    .replace(/[*{[].*$/, '')
    .replace(/\/$/, '');
}

async function mappingFindings(root, manifest, activeGroup = 'G0') {
  const findings = [];
  for (const requirement of manifest.requirements) {
    for (const [field, value] of [
      ['owner', requirement.owner],
      ['implementationRefs', requirement.implementationRefs],
      ['testRefs', requirement.testRefs],
    ]) {
      if (!value || (Array.isArray(value) && value.length === 0))
        findings.push(
          finding(
            requirement.id,
            'NORMATIVE_MAPPING_COMPLETE',
            MANIFEST,
            `${field} mapping is missing`,
          ),
        );
    }
    if (requirement.dependencyGroup !== activeGroup) continue;
    const targets = (requirement.implementationRefs ?? []).map(mappedPath);
    const resolutions = await Promise.all(
      targets.map((target) => target && exists(path.join(root, target))),
    );
    if (targets.length && !resolutions.some(Boolean)) {
      findings.push(
        finding(
          requirement.id,
          'ACTIVE_IMPLEMENTATION_PATH_EXISTS',
          targets[0] || MANIFEST,
          'no active implementation mapping resolves',
        ),
      );
    }
  }
  for (const criterion of manifest.acceptanceCriteria) {
    if (
      !criterion.evidenceOwner ||
      !criterion.positiveTestRef ||
      !criterion.negativeOrFailureTestRef
    )
      findings.push(
        finding(
          criterion.id,
          'NORMATIVE_MAPPING_COMPLETE',
          MANIFEST,
          'acceptance criterion owner or test mapping is missing',
        ),
      );
  }
  for (const invariant of manifest.invariants)
    if (!invariant.testRef)
      findings.push(
        finding(
          invariant.id,
          'NORMATIVE_MAPPING_COMPLETE',
          MANIFEST,
          'invariant test mapping is missing',
        ),
      );
  return findings;
}

async function generatedDriftFindings(root) {
  const outputs = await generateOutputs(root);
  const findings = [];
  for (const [name, expected] of outputs) {
    const relative = `docs/generated/${name}`;
    let actual;
    try {
      actual = await readFile(path.join(root, relative), 'utf8');
    } catch {
      findings.push(
        finding('FR-TRACE-003', 'GENERATED_DOCS_DRIFT', relative, 'generated file not found'),
      );
      continue;
    }
    if (actual !== expected)
      findings.push(
        finding(
          'FR-TRACE-003',
          'GENERATED_DOCS_DRIFT',
          relative,
          'generated file differs byte-for-byte',
        ),
      );
  }
  return findings;
}

async function reportConsistencyFindings(root, audit) {
  const [document, manifest, lockfile] = await Promise.all([
    readFile(path.join(root, DOCUMENT)),
    readFile(path.join(root, MANIFEST)),
    readFile(path.join(root, 'pnpm-lock.yaml')),
  ]);
  const checks = [
    ['documentHash', sha256(document), audit?.hashes?.documentArtifactSha256, DOCUMENT],
    ['manifestHash', sha256(manifest), audit?.hashes?.requirementManifestSha256, MANIFEST],
  ];
  const findings = checks
    .filter(([, actual, expected]) => actual !== expected)
    .map(([field, , , target]) =>
      finding(
        'FR-TRACE-006',
        'RELEASE_REPORT_HASH_CONSISTENCY',
        target,
        `${field} disagrees with audit provenance`,
      ),
    );
  if (!/^[a-f0-9]{64}$/.test(audit?.hashes?.documentNormalizedSha256 ?? ''))
    findings.push(
      finding(
        'FR-TRACE-006',
        'RELEASE_REPORT_FIELD_REQUIRED',
        AUDIT,
        'normalizedHash is missing or malformed',
      ),
    );
  if (lockfile.length === 0)
    findings.push(
      finding(
        'FR-TRACE-006',
        'RELEASE_REPORT_FIELD_REQUIRED',
        'pnpm-lock.yaml',
        'dependency input is empty',
      ),
    );
  return findings;
}

export async function verifyReleaseConformance(root) {
  const [manifest, audit] = await Promise.all([
    readFile(path.join(root, MANIFEST), 'utf8').then(JSON.parse),
    readFile(path.join(root, AUDIT), 'utf8').then(JSON.parse),
  ]);
  const groups = [
    await mappingFindings(root, manifest),
    await generatedDriftFindings(root),
    await reportConsistencyFindings(root, audit),
  ];
  const findings = groups
    .flat()
    .sort(
      (left, right) =>
        left.requirementId.localeCompare(right.requirementId) ||
        left.rule.localeCompare(right.rule) ||
        left.path.localeCompare(right.path),
    );
  return {
    schema: 'foresift/release-conformance-verdict@1',
    overall: findings.length ? 'FAILED' : 'PASSED',
    rules: [
      'NORMATIVE_MAPPING_COMPLETE',
      'ACTIVE_IMPLEMENTATION_PATH_EXISTS',
      'GENERATED_DOCS_DRIFT',
      'RELEASE_REPORT_HASH_CONSISTENCY',
    ],
    findings,
  };
}

async function run() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(
      'Usage: node scripts/verify-release-conformance/cli.mjs [--json]\nVerify release conformance against the live tree.',
    );
    return;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--json')) {
    console.error('error: unsupported conformance verification argument');
    process.exitCode = 1;
    return;
  }
  const verdict = await verifyReleaseConformance(process.cwd());
  console.log(JSON.stringify(verdict));
  if (verdict.overall === 'FAILED') process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  run().catch((error) => {
    console.log(
      JSON.stringify({
        schema: 'foresift/release-conformance-verdict@1',
        overall: 'FAILED',
        findings: [
          finding('FR-TRACE-003', 'CONFORMANCE_EXECUTION', error.path ?? '.', error.message),
        ],
      }),
    );
    process.exitCode = 1;
  });
}
