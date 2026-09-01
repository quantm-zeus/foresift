#!/usr/bin/env node
/** Zero-runtime-dependency release conformance entrypoint. @requirement FR-TRACE-003 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  buildReleaseReport,
  evaluateConformance,
  verifyReleaseReport,
} from '../../packages/release-conformance/src/index.ts';

function usage() {
  return `Usage: node scripts/verify-release-conformance/cli.mjs [--json] [--root PATH]\n\nRuns mapping, dependency-gate, generated-document, and release-report verification.\n`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage());
    return;
  }
  const json = args.includes('--json');
  if (json) args.splice(args.indexOf('--json'), 1);
  let repoRoot = process.cwd();
  const rootIndex = args.indexOf('--root');
  if (rootIndex >= 0) {
    if (!args[rootIndex + 1]) throw new Error('--root requires a path');
    repoRoot = path.resolve(args[rootIndex + 1]);
    args.splice(rootIndex, 2);
  }
  if (args.length) {
    process.stderr.write(`Unknown argument: ${args[0]}\n${usage()}`);
    process.exitCode = 2;
    return;
  }

  const conformance = await evaluateConformance({ repoRoot, milestone: 'G0' });
  const audit = JSON.parse(
    await readFile(
      path.join(repoRoot, 'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.audit.json'),
      'utf8',
    ),
  );
  const report = await buildReleaseReport({
    repoRoot,
    milestone: 'G0',
    conformanceResults: conformance,
    previousReport: {
      previousReportId: 'prd-v6.0-approved-baseline',
      previousDocumentHash: audit.hashes.documentArtifactSha256,
      previousManifestHash: audit.hashes.requirementManifestSha256,
    },
  });
  const reportVerification = verifyReleaseReport(report);
  const findings = [...conformance.findings];
  for (const error of reportVerification.errors) {
    findings.push({
      requirementId: 'FR-TRACE-006',
      rule: 'RELEASE_REPORT_VALID',
      path: 'release-report',
      message: error,
    });
  }
  const output = {
    status: findings.length === 0 ? 'PASSED' : 'FAILED',
    findings,
    conformance,
    reportId: report.reportId,
  };
  if (json || findings.length) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  else process.stdout.write('Release conformance verified: PASSED.\n');
  if (findings.length) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ status: 'FAILED', findings: [{ requirementId: 'FR-TRACE-003', rule: 'CLI_EXECUTION', path: process.cwd(), message: error.message }] }, null, 2)}\n`,
  );
  process.exitCode = 1;
});
