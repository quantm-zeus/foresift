/**
 * AC-269 acceptance (positive).
 * Traces: FR-TRACE-006.
 * AC text (manifest §39.25): "Release conformance reports document hash, manifest hash,
 * SBOM/dependency hash, migration/schema hashes, all test results, deviations, current
 * activation scope, and tested rollback target."
 */
import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReleaseReport, verifyReleaseReport } from '@foresift/release-conformance';
import { VALID_RELEASE_REPORT_FIXTURE } from '../fixtures/trace/index.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('AC-269 acceptance (positive)', () => {
  it('builds a complete, verifiable release report from live repository inputs', async () => {
    const report = await buildReleaseReport({
      repoRoot: REPO_ROOT,
      milestone: 'G0',
      previousReport: VALID_RELEASE_REPORT_FIXTURE.rollbackTarget,
    });

    expect(report).toBeDefined();
    expect(report.documentHash).toBeDefined();
    expect(report.manifestHash).toBeDefined();
    expect(report.normalizedHash).toBeDefined();
    expect(report.dependencySbomHash).toBeDefined();
    expect(report.migrationHashes).toBeDefined();
    expect(report.schemaHashes).toBeDefined();
    expect(report.conformanceResults).toBeDefined();
    expect(report.unresolvedDeviations).toBeDefined();
    expect(report.activationState).toBeDefined();
    expect(report.rollbackTarget).toBeDefined();

    const verification = verifyReleaseReport(report);
    expect(verification.isValid).toBe(true);
  });

  it('rebuilds the report byte-identically from identical inputs', async () => {
    const report1 = await buildReleaseReport({
      repoRoot: REPO_ROOT,
      milestone: 'G0',
      previousReport: VALID_RELEASE_REPORT_FIXTURE.rollbackTarget,
      fixedTimestamp: '2026-08-31T08:00:00.000Z',
    });

    const report2 = await buildReleaseReport({
      repoRoot: REPO_ROOT,
      milestone: 'G0',
      previousReport: VALID_RELEASE_REPORT_FIXTURE.rollbackTarget,
      fixedTimestamp: '2026-08-31T08:00:00.000Z',
    });

    expect(JSON.stringify(report1)).toBe(JSON.stringify(report2));
  });
});
