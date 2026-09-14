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

describe('verify-release-conformance CLI runs the PROD rules (H1)', () => {
  it('fails closed when PROD claims are required but omitted', () => {
    const result = spawnSync('node', [CLI_PATH, '--json', '--require-prod-claims'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('PROD_CONFORMANCE_INPUT_MISSING');
  });

  it('fails a violating PROD claims file with the PROD rule names', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(path.join(tmpdir(), 'foresift-prod-claims-'));
    const claimsPath = path.join(dir, 'claims.json');
    try {
      await writeFile(
        claimsPath,
        JSON.stringify({
          activationClaims: [
            {
              moduleId: 'module-cli',
              lifecycleState: 'ACTIVE',
              implemented: false,
              available: false,
              proven: false,
              requiresProven: true,
              activationEventRef: null,
              gateVerdict: null,
            },
          ],
          postureDeclarations: [],
          mcpCompatibility: {
            revisions: [
              { revision: '2025-11-25', channel: 'DRAFT', isDefault: true, supersededBy: null },
            ],
            clients: [],
            cells: [],
            now: '2026-06-01T00:00:00Z',
          },
          livePaths: [],
          distributionAuthorizations: [],
        }),
        'utf8',
      );
      const result = spawnSync('node', [CLI_PATH, '--json', '--prod-claims', claimsPath], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('ACTIVATION_WITHOUT_EVIDENCE');
      expect(result.stdout).toContain('MCP_COMPATIBILITY_DRIFT');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('advertises exactly the PROD rules the invocation can emit', () => {
    const withoutClaims = JSON.parse(
      spawnSync('node', [CLI_PATH, '--json'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout,
    );
    expect(withoutClaims.rules).toContain('PROD_SURFACE_MISSING');
    expect(withoutClaims.rules).toContain('PROD_CONFORMANCE_INPUT_MISSING');
    expect(withoutClaims.rules).toContain('PROD_CONFORMANCE_GATE_UNAVAILABLE');
    // The five claim rules need an explicit claims file.
    expect(withoutClaims.rules).not.toContain('ACTIVATION_WITHOUT_EVIDENCE');

    const withClaims = JSON.parse(
      spawnSync('node', [CLI_PATH, '--json', '--require-prod-claims'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).stdout,
    );
    expect(withClaims.rules).toContain('PROD_CONFORMANCE_INPUT_MISSING');
  });

  it('fails closed on a malformed claims file instead of skipping the claim rules (H2 residual)', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(path.join(tmpdir(), 'foresift-prod-claims-bad-'));
    const claimsPath = path.join(dir, 'claims.json');
    try {
      await writeFile(
        claimsPath,
        JSON.stringify({
          activationClaims: 'not-an-array',
          postureDeclarations: '',
          mcpCompatibility: 'also-wrong',
          livePaths: '',
          distributionAuthorizations: '',
        }),
        'utf8',
      );
      const result = spawnSync('node', [CLI_PATH, '--json', '--prod-claims', claimsPath], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      const prodFindings = (JSON.parse(result.stdout).findings ?? []).filter(
        (finding: { readonly rule?: string }) => finding.rule === 'PROD_CONFORMANCE_INPUT_MISSING',
      );
      expect(prodFindings).toHaveLength(5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

/**
 * V7-C1: a milestone that owns FR-PROD law cannot be certified by an invocation
 * that never asked for PROD governance claims. Without an explicit
 * `--prod-claims` file the claim rules are now REQUIRED, so the CLI fails closed
 * with `PROD_CONFORMANCE_INPUT_MISSING` instead of silently skipping them.
 */
describe('verify-release-conformance CLI requires PROD claims by default (V7-C1)', () => {
  it('fails closed with PROD_CONFORMANCE_INPUT_MISSING when no claims file is supplied', () => {
    const result = spawnSync('node', [CLI_PATH, '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(result.status).toBe(1);
    const verdict = JSON.parse(result.stdout) as {
      readonly overall?: string;
      readonly findings?: readonly { readonly rule?: string }[];
    };
    expect(verdict.overall).toBe('FAILED');
    expect(
      (verdict.findings ?? []).some((finding) => finding.rule === 'PROD_CONFORMANCE_INPUT_MISSING'),
    ).toBe(true);
  }, 120_000);
});
