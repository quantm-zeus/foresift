import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regression coverage for ADR-0004: Archon v0.9.0 does NOT export ARTIFACTS_DIR
// into until_bash guard environments (only bare-form `$ARTIFACTS_DIR` textual
// substitution reaches a guard). Validators invoked from guards must therefore
// accept an explicit --artifacts-dir argument, and no workflow guard may rely
// on the env var or on brace-form `${ARTIFACTS_DIR}` (which never substitutes).
//
// The live failure this pins down: the scoped-plan guard exhausted all 4 loop
// iterations on 2026-08-22/23 while plan-recheck bash nodes exited 0 every
// time — the guard context simply had no ARTIFACTS_DIR env var.

const ROOT = join(import.meta.dirname, '../..');
const AUTOMATION = join(ROOT, 'scripts/automation');
const WORKFLOW_ROOT = join(ROOT, '.archon/workflows');

function run(
  script: string,
  args: string[],
  env: Record<string, string>,
): { status: number | null; out: string } {
  const r = spawnSync('node', [join(AUTOMATION, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Validators print pretty-printed JSON verdicts to stdout; pull the object out
 * even when other output precedes it. */
function verdictJson(out: string): { complete?: boolean; errors?: string[] } {
  const start = out.indexOf('{');
  const end = out.lastIndexOf('}');
  return JSON.parse(out.slice(start, end + 1));
}

const MISSING_MSG = 'missing artifacts directory';

describe('plan validator artifacts-dir contract (ADR-0004)', () => {
  it('fails closed naming --artifacts-dir when neither flag nor env provides a path', () => {
    // Guard-context invocation with no ARTIFACTS_DIR env: the old build failed
    // with an opaque "missing ARTIFACTS_DIR"; the message now teaches the fix.
    const r = run('package-plan-complete.mjs', ['--package', 'g0-contracts-data-truth'], {
      ARTIFACTS_DIR: '',
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain(MISSING_MSG);
    // Parsed (unescaped) error names the exact remediation.
    const errors = verdictJson(r.out).errors ?? [];
    expect(errors.join('\n')).toContain('--artifacts-dir "$ARTIFACTS_DIR"');
  });

  it('accepts --artifacts-dir alone (guard context, env unset)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foresift-guard-test-'));
    try {
      const r = run(
        'package-plan-complete.mjs',
        ['--package', 'g0-contracts-data-truth', '--artifacts-dir', dir],
        { ARTIFACTS_DIR: '' },
      );
      // Past the artifacts-dir resolution gate: the verdict is structured JSON
      // and no longer the missing-path refusal (whatever the milestone state
      // goes on to say about the artifacts themselves).
      expect(r.status).toBe(1);
      expect(verdictJson(r.out).complete).toBe(false);
      expect(r.out).not.toContain(MISSING_MSG);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--artifacts-dir takes precedence over a (garbage) env value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foresift-guard-test-'));
    try {
      writeFileSync(join(dir, 'plan.md'), '# Plan\n\nlegitimate plan body for the fixture.\n');
      writeFileSync(
        join(dir, 'plan-context.md'),
        '# Context\n\nlegitimate context body for the fixture.\n',
      );
      const r = run(
        'package-plan-complete.mjs',
        ['--package', 'g0-contracts-data-truth', '--artifacts-dir', dir],
        { ARTIFACTS_DIR: '/nonexistent/garbage/path' },
      );
      // The artifact-copy checks resolved via the FLAG (both fixtures exist),
      // so no "artifact $ARTIFACTS_DIR/…" complaint may appear even though the
      // env var points nowhere.
      const errors = verdictJson(r.out).errors ?? [];
      expect(errors.join('\n')).not.toMatch(/artifact \$ARTIFACTS_DIR\//);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('audit-progress artifacts-dir contract (ADR-0004)', () => {
  it('fails closed naming --artifacts-dir when neither flag nor env provides a path', () => {
    const r = run('audit-progress.mjs', ['--check'], { ARTIFACTS_DIR: '' });
    expect(r.status).toBe(2);
    expect(r.out).toContain(MISSING_MSG);
  });

  it('accepts --artifacts-dir alone (guard context, env unset)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foresift-guard-test-'));
    try {
      const r = run('audit-progress.mjs', ['--check', '--artifacts-dir', dir], {
        ARTIFACTS_DIR: '',
      });
      // Any structured nonzero verdict is fine (the progress artifact is
      // legitimately absent); the point is that resolution no longer fails
      // on the missing environment variable.
      expect(r.status).not.toBe(0);
      expect(r.out).not.toContain(MISSING_MSG);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── static workflow lint: no guard may use the prohibited forms ──────────────

/** Extract every `until_bash:` block literal from a workflow YAML (raw-text
 * scan; the repo carries no YAML dependency and the shape is conventionally
 * a fixed-indentation block scalar). Only EXECUTABLE lines are returned —
 * `#`-comment lines inside the block are documentation and never execute. */
function extractUntilBashBlocks(yaml: string): string[] {
  const lines = yaml.split('\n');
  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]?.match(/^(\s*)until_bash:\s*\|/);
    if (!m || m[1] === undefined) continue;
    const indent = m[1].length;
    const block: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j] ?? '';
      if (line.trim() !== '' && line.search(/\S/) <= indent) break;
      const body = line.slice(indent + 2);
      if (body.trim().startsWith('#')) continue;
      block.push(body);
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
}

function workflowFiles(): string[] {
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith('.yaml')) files.push(p);
    }
  };
  walk(WORKFLOW_ROOT);
  return files;
}

describe('until_bash guard contract across all workflows (ADR-0004)', () => {
  // Validators known to need the artifacts dir; each invocation inside a
  // guard must receive it explicitly via archon's bare-form substitution.
  const NEEDS_ARTIFACTS_FLAG = [
    'scripts/automation/package-plan-complete.mjs',
    'scripts/automation/audit-progress.mjs',
  ];

  it('every workflow exposes at least one scannable guard surface', () => {
    let guards = 0;
    for (const f of workflowFiles())
      guards += extractUntilBashBlocks(readFileSync(f, 'utf8')).length;
    // work-package ×3 + milestone-control ×4 + smoke ×1 at time of writing.
    expect(guards).toBeGreaterThanOrEqual(5);
  });

  it('no guard references process.env.ARTIFACTS_DIR (absent in guard env)', () => {
    for (const f of workflowFiles()) {
      for (const block of extractUntilBashBlocks(readFileSync(f, 'utf8'))) {
        expect(block).not.toContain('process.env.ARTIFACTS_DIR');
      }
    }
  });

  it('no guard uses brace-form ${ARTIFACTS_DIR} (never substituted)', () => {
    for (const f of workflowFiles()) {
      for (const block of extractUntilBashBlocks(readFileSync(f, 'utf8'))) {
        expect(block).not.toContain('${ARTIFACTS_DIR}');
      }
    }
  });

  it('validators needing the artifacts dir get --artifacts-dir "$ARTIFACTS_DIR"', () => {
    for (const f of workflowFiles()) {
      for (const block of extractUntilBashBlocks(readFileSync(f, 'utf8'))) {
        for (const script of NEEDS_ARTIFACTS_FLAG) {
          if (!block.includes(script)) continue;
          expect(
            /--artifacts-dir\s+"\$ARTIFACTS_DIR"/.test(block),
            `${f}: guard invokes ${script} without --artifacts-dir "$ARTIFACTS_DIR"`,
          ).toBe(true);
        }
      }
    }
  });
});
