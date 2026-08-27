/**
 * Prohibited-capability scanner CLI exit contract (T122; review fix for the
 * silent-degradation cluster). The static gate's operational property is THE
 * PROCESS EXIT CODE: nonzero when prohibited content OR unscannable evidence
 * is present, zero on a clean tree. These tests spawn the real CLI so an
 * inverted mapping, broadened exclusion, or fail-open skip could never ship
 * silently.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = path.join(REPO_ROOT, 'scripts/scan-prohibited-capabilities/cli.mjs');

interface ScanReport {
  readonly clean: boolean;
  readonly findings: ReadonlyArray<{ category: string; reference: string }>;
  readonly summary: { inventorySizes: { routes: number; tools: number; schemas: number } };
}

function runCli(root: string): { status: number | null; report: ScanReport; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, root], { encoding: 'utf8' });
  return {
    status: result.status,
    // The JSON report is the entire stdout payload (diagnostics go to stderr).
    report: JSON.parse(result.stdout ?? '{}') as ScanReport,
    stderr: result.stderr ?? '',
  };
}

describe('prohibited-capability scanner exit contract', () => {
  it('exits 1 with findings for a tree carrying prohibited capability text', () => {
    const sandbox = mkdtempSync(path.join(tmpdir(), 'pc-scan-dirty-'));
    try {
      // Reuse a guaranteed-detected fixture corpus sample as the violation.
      const fixture = readFileSync(
        path.join(REPO_ROOT, 'tests/fixtures/sec/prohibited/wallet-keypair.ts'),
        'utf8',
      );
      writeFileSync(path.join(sandbox, 'evil.ts'), fixture);
      const { status, report, stderr } = runCli(sandbox);
      expect(status, stderr).toBe(1);
      expect(report.clean).toBe(false);
      expect(report.findings.length).toBeGreaterThan(0);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('exits 1 with UNSCANNABLE_FILE when evidence becomes unreadable — skipping is not silence', () => {
    const sandbox = mkdtempSync(path.join(tmpdir(), 'pc-scan-corrupt-'));
    try {
      // A manifest corrupted into unparseability could hide dependencies;
      // the scan must go DIRTY, not quietly drop the evidence.
      writeFileSync(path.join(sandbox, 'package.json'), '{ this is not json');
      const { status, report } = runCli(sandbox);
      expect(status).toBe(1);
      expect(report.clean).toBe(false);
      expect(report.findings.some((f) => f.category === 'UNSCANNABLE_FILE')).toBe(true);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('exits 0 CLEAN over the real repository tree (fixture corpus excluded from its own verdict)', () => {
    const { status, report, stderr } = runCli(REPO_ROOT);
    expect(status, stderr).toBe(0);
    expect(report.clean).toBe(true);
    expect(report.findings).toEqual([]);
    // The dependency-manifest surface must actually SEE manifests now that
    // they are wired into the walk.
    expect(report.summary.inventorySizes.schemas).toBeGreaterThan(0);
  });
});
