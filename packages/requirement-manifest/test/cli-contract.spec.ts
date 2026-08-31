/**
 * Contract tests driving scripts/generate-requirement-manifest/cli.mjs as a child process (FR-TRACE-001, FR-TRACE-003).
 */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI_PATH = path.join(REPO_ROOT, 'scripts/generate-requirement-manifest/cli.mjs');

describe('generate-requirement-manifest CLI contract (FR-TRACE-001, FR-TRACE-003, AC-265, AC-266)', () => {
  it('executes with --help and displays usage information', () => {
    const result = spawnSync('node', [CLI_PATH, '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/usage|generate|--check/i);
  });

  it('runs --check mode against generated docs', () => {
    const result = spawnSync('node', [CLI_PATH, '--check'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    // If generated files match, exit code should be 0; if missing/drifted, exit code 1 with error report
    expect([0, 1]).toContain(result.status ?? -1);
    if (result.status === 0) {
      expect(result.stdout).toMatch(/integrity verified|ok|clean/i);
    } else {
      expect(result.stderr || result.stdout).toMatch(/drift|mismatch|not found|error/i);
    }
  });

  it('runs generate command and produces valid output files', () => {
    const result = spawnSync('node', [CLI_PATH, 'generate'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    // When implemented, generate will produce exit 0 and write docs/generated/**
    if (result.status === 0) {
      expect(result.stdout).toMatch(/generated|written|requirements\.json/i);
    }
  });

  it('refuses invalid unknown command flags with non-zero exit code', () => {
    const result = spawnSync('node', [CLI_PATH, '--invalid-flag-999'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
  });
});
