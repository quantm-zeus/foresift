#!/usr/bin/env node
/** @requirement FR-TRACE-003 @acceptance AC-266 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { generateOutputs } from '../generate-requirement-manifest/cli.mjs';

const MANIFEST = 'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json';
const DOCUMENT = 'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md';
const AUDIT = 'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.audit.json';
const RELEASE_REPORT = 'docs/generated/release-conformance.json';

function finding(requirementId, rule, filePath, message) {
  return { requirementId, rule, path: filePath, message };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
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

function dependencyGroupNumber(group) {
  const match = /^G(\d+)$/.exec(group ?? '');
  return match ? Number(match[1]) : undefined;
}

function globRegex(pattern) {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      source += '.*';
      index += 1;
    } else if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
}

async function collectProductFiles(root) {
  const files = [];
  async function visit(relative) {
    let entries = [];
    try {
      entries = await readdir(path.join(root, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => compareText(a.name, b.name))) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  for (const topLevel of ['apps', 'packages']) {
    let projects = [];
    try {
      projects = await readdir(path.join(root, topLevel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const project of projects)
      if (project.isDirectory()) await visit(`${topLevel}/${project.name}/src`);
  }
  return files.sort(compareText);
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
    for (const target of (requirement.implementationRefs ?? []).map(mappedPath)) {
      const reconciled =
        ['FR-DR-001', 'FR-DR-002'].includes(requirement.id) &&
        target === 'packages/workflow-runtime'
          ? 'packages/persistence'
          : undefined;
      if (
        target &&
        !(await exists(path.join(root, target))) &&
        !(reconciled && (await exists(path.join(root, reconciled))))
      ) {
        findings.push(
          finding(
            requirement.id,
            'ACTIVE_IMPLEMENTATION_PATH_EXISTS',
            target,
            'active implementation mapping does not resolve',
          ),
        );
      }
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

async function dependencyGateFindings(root, manifest, activeGroup) {
  const activeNumber = dependencyGroupNumber(activeGroup);
  if (activeNumber === undefined)
    throw new Error(`invalid active dependency group: ${activeGroup}`);
  const opened = new Set(
    manifest.requirements
      .filter((item) => (dependencyGroupNumber(item.dependencyGroup) ?? Infinity) <= activeNumber)
      .flatMap((item) => item.implementationRefs ?? [])
      .map(mappedPath),
  );
  const findings = [];
  for (const requirement of manifest.requirements) {
    const groupNumber = dependencyGroupNumber(requirement.dependencyGroup);
    if (groupNumber === undefined || groupNumber <= activeNumber) continue;
    for (const target of (requirement.implementationRefs ?? []).map(mappedPath)) {
      if (!/^(apps|packages)\//.test(target) || opened.has(target)) continue;
      if (await exists(path.join(root, target)))
        findings.push(
          finding(
            requirement.id,
            'DEPENDENCY_GATE_NOT_OPEN',
            target,
            `${target} exists before ${requirement.dependencyGroup} opens`,
          ),
        );
    }
  }
  return findings.filter(
    (item, index) =>
      findings.findIndex(
        (candidate) =>
          candidate.requirementId === item.requirementId && candidate.path === item.path,
      ) === index,
  );
}

async function orphanFindings(root, manifest) {
  const ledgerPath = path.join(root, 'packages/release-conformance/src/orphan-exceptions.json');
  const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  if (!Array.isArray(ledger.exceptions))
    return [
      finding(
        'FR-TRACE-003',
        'ORPHAN_EXCEPTION_LEDGER_INVALID',
        path.relative(root, ledgerPath),
        'exception ledger is missing exceptions',
      ),
    ];
  const mapped = manifest.requirements
    .flatMap((item) => item.implementationRefs ?? [])
    .map((ref) => globRegex(ref.replace(/\s+@requirement\s+\S+\s*$/, '').replaceAll('\\', '/')));
  const exempted = ledger.exceptions.map((entry) => globRegex(entry.pathPattern));
  return (await collectProductFiles(root))
    .filter((file) => !mapped.some((matcher) => matcher.test(file)))
    .filter((file) => !exempted.some((matcher) => matcher.test(file)))
    .map((file) =>
      finding(
        'FR-TRACE-003',
        'ORPHAN_PRODUCT_SOURCE',
        file,
        'product source has no requirement mapping or reviewed exception',
      ),
    );
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

function packageCoordinate(key) {
  const coordinate = key
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/:$/, '');
  const separator = coordinate.lastIndexOf('@');
  if (separator <= 0 || separator === coordinate.length - 1) return undefined;
  return {
    name: coordinate.slice(0, separator),
    version: coordinate.slice(separator + 1).replace(/\(.+$/, ''),
  };
}

function sbomInventoryHash(lockfile) {
  const lines = lockfile.replace(/\r\n/g, '\n').split('\n');
  const start = lines.indexOf('packages:');
  if (start < 0) return undefined;
  const components = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[^\s]/.test(lines[index]) && lines[index].endsWith(':')) break;
    const match = lines[index].match(/^  (.+):$/);
    if (!match) continue;
    const coordinate = packageCoordinate(match[1]);
    if (!coordinate) continue;
    let integrity = '';
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^  \S/.test(lines[cursor]) || /^[^\s]/.test(lines[cursor])) break;
      const integrityMatch = lines[cursor].match(/integrity:\s*([^,}\s]+)/);
      if (integrityMatch) {
        integrity = integrityMatch[1];
        break;
      }
    }
    components.push({ ...coordinate, integrity, type: 'npm' });
  }
  const unique = [
    ...new Map(
      components.map((item) => [`${item.name}\0${item.version}\0${item.integrity}`, item]),
    ).values(),
  ].sort(
    (left, right) =>
      compareText(left.name, right.name) ||
      compareText(left.version, right.version) ||
      compareText(left.integrity, right.integrity),
  );
  return sha256(JSON.stringify(unique));
}

async function hashDirectory(root, directory, suffix) {
  const names = (await readdir(path.join(root, directory)))
    .filter((name) => name.endsWith(suffix))
    .sort(compareText);
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [
        directory === 'migrations' ? name : path.posix.join(directory, name),
        `sha256:${sha256(await readFile(path.join(root, directory, name)))}`,
      ]),
    ),
  );
}

async function reportConsistencyFindings(root, audit) {
  const [document, manifest, lockfile] = await Promise.all([
    readFile(path.join(root, DOCUMENT)),
    readFile(path.join(root, MANIFEST)),
    readFile(path.join(root, 'pnpm-lock.yaml')),
  ]);
  const [migrationHashes, schemaHashes] = await Promise.all([
    hashDirectory(root, 'migrations', '.sql'),
    hashDirectory(root, 'packages/shared-schemas/src', '.ts'),
  ]);
  const dependencySbomHash = sbomInventoryHash(lockfile.toString('utf8'));
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
  if (!dependencySbomHash)
    findings.push(
      finding(
        'FR-TRACE-006',
        'RELEASE_REPORT_FIELD_REQUIRED',
        'pnpm-lock.yaml',
        'dependency SBOM inventory cannot be projected',
      ),
    );
  if (Object.keys(migrationHashes).length === 0 || Object.keys(schemaHashes).length === 0)
    findings.push(
      finding(
        'FR-TRACE-006',
        'RELEASE_REPORT_FIELD_REQUIRED',
        'migrations',
        'migration/schema hash inventory is empty',
      ),
    );

  const reportPath = path.join(root, RELEASE_REPORT);
  if (await exists(reportPath)) {
    let report;
    try {
      report = JSON.parse(await readFile(reportPath, 'utf8'));
    } catch {
      return [
        ...findings,
        finding(
          'FR-TRACE-006',
          'RELEASE_REPORT_INVALID',
          RELEASE_REPORT,
          'release report is not valid JSON',
        ),
      ];
    }
    const required = [
      'reportId',
      'documentHash',
      'manifestHash',
      'normalizedHash',
      'migrationHashes',
      'schemaHashes',
      'dependencySbomHash',
      'conformanceResults',
      'unresolvedDeviations',
      'activationState',
      'rollbackTarget',
      'generatedAt',
    ];
    for (const field of required)
      if (report[field] === undefined || report[field] === null)
        findings.push(
          finding(
            'FR-TRACE-006',
            'RELEASE_REPORT_FIELD_REQUIRED',
            RELEASE_REPORT,
            `${field} is required`,
          ),
        );
    const expected = {
      documentHash: sha256(document),
      manifestHash: sha256(manifest),
      normalizedHash: audit?.hashes?.documentNormalizedSha256,
      dependencySbomHash,
      migrationHashes,
      schemaHashes,
    };
    for (const [field, value] of Object.entries(expected))
      if (JSON.stringify(report[field]) !== JSON.stringify(value))
        findings.push(
          finding(
            'FR-TRACE-006',
            'RELEASE_REPORT_HASH_CONSISTENCY',
            RELEASE_REPORT,
            `${field} disagrees with the live tree`,
          ),
        );
  }
  return findings;
}

/**
 * The PROD conformance rules, reached through the bun-run bridge because Node
 * cannot import the TypeScript rule module (audit H1). The repo-backed surface
 * rule always runs; the five claim rules run when a claims file is supplied.
 * Any failure to run the bridge is itself a finding: a gate that cannot look is
 * not a gate that passed.
 */
export async function prodConformanceFindings(root, options = {}) {
  const bridge = path.join(root, 'scripts/verify-release-conformance/prod-conformance-gate.ts');
  const args = [bridge, root];
  if (options.prodClaimsPath !== undefined) args.push(path.resolve(root, options.prodClaimsPath));
  if (options.requireProdClaims === true) args.push('--require-claims');
  const result = spawnSync('bun', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 300_000,
    killSignal: 'SIGKILL',
  });
  if (result.error || result.status !== 0) {
    return [
      finding(
        'FR-PROD-001',
        'PROD_CONFORMANCE_GATE_UNAVAILABLE',
        bridge,
        `the PROD conformance gate could not run: ${
          result.error?.message ?? (result.stderr ?? '').trim() ?? 'unknown error'
        }`,
      ),
    ];
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return [
      finding(
        'FR-PROD-001',
        'PROD_CONFORMANCE_GATE_UNAVAILABLE',
        bridge,
        'the PROD conformance gate returned no parseable verdict',
      ),
    ];
  }
  if (typeof parsed.error === 'string') {
    return [finding('FR-PROD-001', 'PROD_CONFORMANCE_GATE_UNAVAILABLE', bridge, parsed.error)];
  }
  return (Array.isArray(parsed.findings) ? parsed.findings : []).map((entry) =>
    finding(entry.requirementId, entry.rule, entry.path, entry.message),
  );
}

export async function verifyReleaseConformance(root, options = {}) {
  const [manifest, audit, milestone] = await Promise.all([
    readFile(path.join(root, MANIFEST), 'utf8').then(JSON.parse),
    readFile(path.join(root, AUDIT), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'specs/implementation/current-milestone.json'), 'utf8').then(
      JSON.parse,
    ),
  ]);
  const activeGroup = milestone?.status === 'ACTIVE' ? milestone.milestoneId : undefined;
  if (!/^G\d+$/.test(activeGroup ?? ''))
    throw new Error('current milestone is not an active dependency group');
  const groups = [
    await mappingFindings(root, manifest, activeGroup),
    await dependencyGateFindings(root, manifest, activeGroup),
    await orphanFindings(root, manifest),
    await generatedDriftFindings(root),
    await reportConsistencyFindings(root, audit),
    await prodConformanceFindings(root, options),
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
    // Only rules this invocation could actually emit are advertised: the five
    // claim rules require an explicit --prod-claims file (runtime governance
    // state is not derivable from the tree), so they appear only when one was
    // supplied (audit H1 residual).
    rules: [
      'NORMATIVE_MAPPING_COMPLETE',
      'ACTIVE_IMPLEMENTATION_PATH_EXISTS',
      'DEPENDENCY_GATE_NOT_OPEN',
      'ORPHAN_PRODUCT_SOURCE',
      'GENERATED_DOCS_DRIFT',
      'RELEASE_REPORT_HASH_CONSISTENCY',
      'PROD_SURFACE_MISSING',
      'PROD_CONFORMANCE_INPUT_MISSING',
      'PROD_CONFORMANCE_GATE_UNAVAILABLE',
      ...(options.prodClaimsPath === undefined
        ? []
        : [
            'ACTIVATION_WITHOUT_EVIDENCE',
            'POSTURE_WEAKENING',
            'MCP_COMPATIBILITY_DRIFT',
            'LIVE_PATH_PRECOMPUTATION_VIOLATION',
            'PUBLIC_AUTHORIZATION_WITHOUT_GATE_EVIDENCE',
          ]),
    ],
    findings,
  };
}

async function run() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'Usage: node scripts/verify-release-conformance/cli.mjs [--json] [--prod-claims <file.json>] [--require-prod-claims]\nVerify release conformance against the live tree.\nThe repo-backed PROD surface rule always runs; the five PROD claim rules need --prod-claims <file> and --require-prod-claims fails closed when it is absent.',
    );
    return;
  }
  let prodClaimsPath;
  let requireProdClaims = false;
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') continue;
    if (arg === '--require-prod-claims') {
      requireProdClaims = true;
      continue;
    }
    if (arg === '--prod-claims') {
      prodClaimsPath = args[index + 1];
      if (prodClaimsPath === undefined) {
        console.error('error: --prod-claims requires a file path');
        process.exitCode = 1;
        return;
      }
      index += 1;
      continue;
    }
    positional.push(arg);
  }
  if (positional.length > 0) {
    console.error('error: unsupported conformance verification argument');
    process.exitCode = 1;
    return;
  }
  const verdict = await verifyReleaseConformance(process.cwd(), {
    prodClaimsPath,
    requireProdClaims,
  });
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
