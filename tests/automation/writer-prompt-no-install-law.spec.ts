// Live run e32031f (2026-09-04): the CLAUDE handoff core ran `bun install`
// inside the lane worktree — bun does not read pnpm-workspace.yaml, so it
// appended a root "workspaces" field to package.json and created a 727-line
// bun.lock. Both are tooling plumbing outside every write scope; the guard
// correctly rejected the lane (WRITE-AUTHORITY VIOLATION: bun.lock,
// package.json) and the wave died after a full 3m32s execution.
//
// Law under test: BOTH writer cores (claude-lane-core.mjs and
// exec-codex-writer.mjs) must carry the package-manager law in their lane
// prompt — pnpm only, never install, never create/modify/commit lockfiles,
// never register workspaces. The law is the first line of defense; the
// guard remains the fail-closed backstop.
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) =>
  readFileSync(join(here, '..', '..', 'scripts', 'automation', p), 'utf8');

describe('writer prompt package-manager law (run e32031f regression)', () => {
  const law = ['claude-lane-core.mjs', 'exec-codex-writer.mjs'];

  for (const file of law) {
    test(`${file} forbids bun/npm/yarn install and lockfile or workspace edits`, () => {
      const src = read(file);
      expect(src).toContain('pnpm-workspace.yaml');
      expect(src).toContain('Never run bun install');
      expect(src).toContain('never create, modify, or commit any lockfile');
      expect(src).toContain('never add a workspaces');
      // The law must name the exact lockfiles seen in live incidents.
      expect(src).toContain('bun.lock');
      expect(src).toContain('pnpm-lock.yaml');
    });
  }

  test('the law text appears in the lane PROMPT (not just module comments)', () => {
    // claude-lane-core builds its prompt inline: the law strings must sit
    // inside the prompt array (after the brief, before 'Commit coherent').
    const src = read('claude-lane-core.mjs');
    const promptStart = src.indexOf('const prompt = [');
    const commitLine = src.indexOf("'Commit coherent production changes before exit.'");
    expect(promptStart).toBeGreaterThan(-1);
    expect(commitLine).toBeGreaterThan(promptStart);
    const promptBody = src.slice(promptStart, commitLine);
    expect(promptBody).toContain('Never run bun install');
    expect(promptBody).toContain('never create, modify, or commit any lockfile');
  });
});
