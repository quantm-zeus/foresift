// `.claude` TOOLING-ONLY INVARIANT (V4 §10 hardening, option A).
//
// The repo's source-discovery surfaces deliberately EXCLUDE `.claude/`:
//   · scripts/spec-verify.mjs skips the directory during tracked-source scans;
//   · fast-impact.mjs classifies it as ARCHON_CONTROL_PLANE (never product
//     test selection);
//   · generation-salvage.mjs treats it as current-main-wins control plane;
//   · package-fast-verify.mjs maps it to format + `archon validate`, not tests.
// Those exclusions are SAFE only while `.claude/**` carries tooling content
// exclusively (skills markdown + workflow examples). If a scannable source
// file ever lands there, every surface above would silently skip it — a
// false-negative class with NO detector. This spec is that detector: it pins
// the invariant so landing product/runtime source under `.claude/` FAILS CI
// and forces a conscious decision (move the file, or revisit every exclusion
// with a documented reason). Positive detection of the classification itself
// stays pinned in v2/v3 throughput specs.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classifyPath } from '../../scripts/automation/fast-impact.mjs';

const REPO = join(fileURLToPath(new URL('../..', import.meta.url)));

const SCANNABLE_SOURCE =
  /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/i;

function trackedClaudeFiles(): string[] {
  return execFileSync('git', ['ls-files', '.claude/'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
}

describe('.claude tooling-only invariant', () => {
  it('tracked .claude/** carries NO scannable source files (tripwire against silent scanner blind spots)', () => {
    const offenders = trackedClaudeFiles().filter(
      (f) => SCANNABLE_SOURCE.test(f) || /(^|\/)package\.json$/.test(f),
    );
    expect(
      offenders,
      `scannable source under .claude/ defeats the spec-verify / fast-impact / salvage exclusions — ` +
        `move it into the product tree or consciously revisit EVERY exclusion site: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('no npm package can hide under .claude (packaging/discovery cannot rely on the excluded prefix)', () => {
    for (const f of trackedClaudeFiles()) {
      expect(f.endsWith('pnpm-lock.yaml'), f).toBe(false);
      expect(/(^|\/)tsconfig(\..*)?\.json$/.test(f), f).toBe(false);
    }
    const workspace = readFileSync(join(REPO, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace.includes('.claude')).toBe(false);
  });

  it('the control-plane classification itself stays armed (positive detection)', () => {
    // If `.claude/` is ever dropped from fast-impact's controlPlane regexes,
    // a stray file there would fall through to CODE_JS_TS/DOC_ONLY silently.
    expect(classifyPath('.claude/skills/archon/SKILL.md')).toBe('ARCHON_CONTROL_PLANE');
    expect(classifyPath('.claude/some/new/file.ts')).toBe('ARCHON_CONTROL_PLANE');
  });
});
