/**
 * Contract tests driving scripts/verify-release-conformance/cli.mjs as a child process (FR-TRACE-003 / AC-266).
 */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI_PATH = path.join(REPO_ROOT, 'scripts/verify-release-conformance/cli.mjs');

describe('verify-release-conformance CLI contract (FR-TRACE-003, AC-266)', () => {
  it('executes with --help and displays usage information', () => {
    const result = spawnSync('node', [CLI_PATH, '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/usage|verify|conformance/i);
  });

  it('runs conformance verification and outputs verdict report', () => {
    const result = spawnSync('node', [CLI_PATH, '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    // Exit 0 on clean tree or exit 1 with findings JSON
    expect([0, 1]).toContain(result.status ?? -1);
    if (result.status === 0) {
      expect(result.stdout).toMatch(/passed|ok|conformance verified/i);
    } else {
      // Must output structured findings on failure
      const output = result.stdout || result.stderr;
      expect(output).toMatch(/findings|requirement|rule|path/i);
    }
  });

  it('refuses invalid unknown flags with non-zero exit code', () => {
    const result = spawnSync('node', [CLI_PATH, '--unknown-unsupported-arg'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
  });
});
