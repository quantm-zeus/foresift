// Scan-traversal contract for the prohibited-capability scanner (defect #19):
// the FS walkers must never sweep agent-session tooling state (`.claude/` —
// its nested worktrees hold BRANCH CHECKOUTS of this same repository, so a
// naive walk re-reports tracked content under nested paths and escapes the
// top-level `tests/fixtures/sec/` exclusion; observed live as an AC-050 red
// on a machine with a session worktree). Excluding infrastructure dirs is NOT
// a weakening: every finding in tracked source is still detected — pinned by
// the positive case here and by AC-050 / negative-capability parity suites.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function runScanOn(root: string) {
  const { runScan } = await import(
    path.join(REPO_ROOT, 'scripts/scan-prohibited-capabilities/cli.mjs')
  );
  return runScan({ root }) as {
    clean: boolean;
    findings: Array<{ reference: string; category: string }>;
  };
}

// A pattern from the shipped catalog that reliably trips SOURCE_SCAN
// (PRIVATE_KEY_SEED / pk-assign). Assembled at RUNTIME so this spec file's
// own text never carries a literal match — spec sources are themselves
// scanned over the real tree.
const PROHIBITED_SNIPPET = `const cfg = { ${['private', 'Key'].join('')}: 'x' };`;

describe('prohibited-capability scan traversal (defect #19)', () => {
  it('detects prohibited source in tracked tree positions', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'scan-trav-'));
    mkdirSync(path.join(root, 'packages', 'tool'), { recursive: true });
    writeFileSync(path.join(root, 'packages', 'tool', 'bridge.ts'), PROHIBITED_SNIPPET);
    const report = await runScanOn(root);
    expect(report.clean).toBe(false);
    // References carry a `:line` suffix — match on the path prefix.
    expect(report.findings.some((f) => f.reference.startsWith('packages/tool/bridge.ts'))).toBe(
      true,
    );
  });

  it('never sweeps .claude tooling state — including nested worktree fixture copies', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'scan-trav-'));
    // Exactly the live shape that broke AC-050: a session worktree checkout
    // carrying the DOCUMENTED-EXCLUDED canary corpus under `.claude/worktrees`.
    const wtFixtures = path.join(
      root,
      '.claude',
      'worktrees',
      'some-session',
      'tests',
      'fixtures',
      'sec',
      'prohibited',
    );
    mkdirSync(wtFixtures, { recursive: true });
    writeFileSync(path.join(wtFixtures, 'bridge-staking.ts'), PROHIBITED_SNIPPET);
    // And scratch outside any documented exclusion — still tooling state.
    const scratch = path.join(root, '.claude', 'scratch');
    mkdirSync(scratch, { recursive: true });
    writeFileSync(path.join(scratch, 'notes.ts'), PROHIBITED_SNIPPET);

    const report = await runScanOn(root);
    expect(report.clean).toBe(true);
    expect(report.findings).toEqual([]);
  });
});
