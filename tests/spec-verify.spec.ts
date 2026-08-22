import { spawn } from 'node:child_process';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..');

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runSpecVerify(cwd: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, 'scripts', 'spec-verify.mjs')], {
      cwd,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

const tempRoots: string[] = [];

afterAll(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

describe('spec:verify against the authoritative specification', () => {
  it('passes on the repository as checked in', async () => {
    const result = await runSpecVerify(REPO_ROOT);
    expect(result.stderr, result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/spec:verify OK/);
    // Every verification domain the migration contract requires must have run.
    for (const check of [
      'sha256sums',
      'audit-hashes',
      'document-metrics',
      'count-agreement',
      'api-uniqueness',
      'persistence-uniqueness',
      'text-hashes',
      'line-anchors',
      'id-integrity',
      'reference-integrity',
      'dependency-dag',
      'placeholder-scan',
      'branding-scan',
    ]) {
      expect(result.stdout).toContain(check);
    }
  });

  it.each([
    {
      name: 'tampered SHA256SUMS entry',
      mutate: async (root: string) => {
        const sumsPath = join(root, 'docs', 'spec', 'SHA256SUMS');
        const sums = await readFile(sumsPath, 'utf8');
        const prdHash = 'baa521d9c67e67a86d7ddb111c793b67462ed4c7acc89cec34ab9f5ade077299';
        await writeFile(sumsPath, sums.replace(prdHash, '0'.repeat(64)));
      },
      expectedIssue: 'SHA256SUMS_HASH_MISMATCH',
    },
    {
      name: 'legacy branding introduced into active tooling',
      mutate: async (root: string) => {
        // Assembled from parts so this test source does not itself carry the
        // legacy brand literal the scanner exists to catch. Targets an active
        // tooling file outside the migration-provenance allowlist.
        const brand = ['chain', 'sieve'].join('-');
        await writeFile(
          join(root, 'CONTRIBUTING.md'),
          `# contributing\n\nThis project continues a ${brand} codebase.\n`,
        );
      },
      expectedIssue: 'LEGACY_BRANDING_OUTSIDE_ALLOWLIST',
    },
  ])('fails on $name', async ({ name, mutate, expectedIssue }) => {
    const tempRoot = await mkdtemp(
      join(tmpdir(), `foresift-spec-${name.includes('branding') ? 'b' : 's'}-`),
    );
    tempRoots.push(tempRoot);
    await cp(REPO_ROOT, tempRoot, {
      recursive: true,
      filter: (source) => !source.includes(`${'node_modules'}`),
    });
    await mutate(tempRoot);
    const result = await runSpecVerify(tempRoot);
    expect(result.code, `${name} should fail verification`).toBe(1);
    expect(result.stderr).toContain(expectedIssue);
  });
});
