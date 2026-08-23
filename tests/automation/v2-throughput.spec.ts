// V2 second-pass regression coverage (task spec §23 items 1–19):
// checkpoint finalization order, context-capsule derivation, git-derived slice
// changesets, and impact-aware FAST classification. Every behavioral claim is
// tested positively AND negatively; fail-closed direction is asserted explicitly.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildCheckpoint,
  CHECKPOINT_SCHEMA,
  deriveCapsule,
  parseTasksMd,
  sha256File,
  uncheckedTasks,
  validateCheckpoint,
} from '../../scripts/automation/package-checkpoint.mjs';
import {
  resolveSliceChangeset,
  parseNameStatus,
  parsePorcelain,
} from '../../scripts/automation/slice-changeset.mjs';
import {
  classifyImpact,
  classifyPath,
  planFastChecks,
} from '../../scripts/automation/fast-impact.mjs';
import { resolveFastBase } from '../../scripts/automation/package-fast-verify.mjs';

let fx: string;
beforeAll(() => {
  fx = mkdtempSync(join(tmpdir(), 'foresift-v2-'));
});
afterAll(() => {
  rmSync(fx, { recursive: true, force: true });
});

const write = (rel: string, content: string) => {
  const p = join(fx, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content);
  return p;
};

/** Real git fixture repo with one base commit; returns helper object. */
function gitFixture(name: string) {
  const root = join(fx, name);
  mkdirSync(root, { recursive: true });
  const g = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  g(['init', '-q', '--initial-branch=main', '.']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  // Bare "origin" so merge-base(HEAD, origin/main) resolution is exercisable.
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', `${root}-origin.git`]);
  g(['remote', 'add', 'origin', `${root}-origin.git`]);
  writeFileSync(join(root, 'base.txt'), 'base\n');
  g(['add', '.']);
  g(['commit', '-qm', 'base']);
  g(['push', '-q', 'origin', 'main:main']);
  return {
    root,
    g,
    baseSha: () => g(['rev-parse', 'HEAD']).trim(),
    writeFile: (rel: string, content: string) => {
      const p = join(root, rel);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, content);
    },
    rm: (rel: string) => rmSync(join(root, rel)),
    commitAll: (msg: string) => {
      g(['add', '-A']);
      g(['commit', '-qm', msg]);
    },
  };
}

// ── §23 item 1: finalized checkpoint survives the immediately following turn ──
describe('V2 checkpoint finalization order (spec §4)', () => {
  it('CASE A: tasks.md updated BEFORE build ⇒ checkpoint VALID at the next clean turn', () => {
    const repo = gitFixture('finalize-good');
    const art = join(repo.root, 'artifacts');
    mkdirSync(art, { recursive: true });
    repo.writeFile('specs/pkg/tasks.md', '- [ ] T001\n- [ ] T002\n');
    repo.writeFile('src/code.ts', 'export {};\n');
    // Slice boundary in the CORRECT order: tasks.md first, commit, then build.
    repo.writeFile('specs/pkg/tasks.md', '- [x] T001\n- [ ] T002\n');
    repo.commitAll('slice-1');
    const head = repo.baseSha();
    const cp = buildCheckpoint({
      packageId: 'pkg',
      headSha: head,
      tasks: parseTasksMd(readFileSync(join(repo.root, 'specs/pkg/tasks.md'), 'utf8')),
      slice: { id: 'S1' },
      sources: {
        tasks: join(repo.root, 'specs/pkg/tasks.md'),
        milestone: join(repo.root, 'specs/implementation/current-milestone.json'),
      },
      context: deriveCapsule({ repoRoot: repo.root, packageId: 'pkg', artifactsDir: art }),
    });
    writeFileSync(join(art, 'implementation-checkpoint.json'), JSON.stringify(cp));
    // Immediately following clean turn: same HEAD, same authoritative sources.
    expect(validateCheckpoint(cp, { packageId: 'pkg', headSha: head })).toEqual({
      valid: true,
      reasons: [],
    });
  });

  it('CASE B: tasks.md edited AFTER build invalidates the fresh checkpoint (old order)', () => {
    const src = write('order/tasks.md', '- [ ] T001\n');
    const cp = buildCheckpoint({
      packageId: 'p',
      headSha: 'h',
      tasks: { completed: 0, total: 1, remaining: 1 },
      slice: {},
      sources: { tasks: src },
    });
    expect(validateCheckpoint(cp).valid).toBe(true); // consistent right after build…
    write('order/tasks.md', '- [x] T001\n'); // …then the OLD order marks completion
    const verdict = validateCheckpoint(cp);
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/source 'tasks' changed since checkpoint/);
  });

  it('CASE C: authoritative source change invalidates; CASE D: HEAD change invalidates', () => {
    const ms = write('order/current-milestone.json', '{"schemaVersion":"1.0.0"}\n');
    const cp = buildCheckpoint({
      packageId: 'p',
      headSha: 'aaa',
      tasks: { completed: 0, total: 0, remaining: 0 },
      slice: {},
      sources: { milestone: ms },
    });
    write('order/current-milestone.json', '{"schemaVersion":"9.9.9"}\n');
    expect(validateCheckpoint(cp).valid).toBe(false);

    const cp2 = buildCheckpoint({
      packageId: 'p',
      headSha: 'aaa',
      tasks: { completed: 0, total: 0, remaining: 0 },
      slice: {},
    });
    expect(validateCheckpoint(cp2, { packageId: 'p', headSha: 'bbb' }).valid).toBe(false);
  });

  it('schema @2 rejects legacy @1 records (fail-closed forward migration)', () => {
    expect(validateCheckpoint({ schema: 'foresift/implementation-checkpoint@1' }).valid).toBe(
      false,
    );
    expect(CHECKPOINT_SCHEMA).toBe('foresift/implementation-checkpoint@2');
  });

  it('uncheckedTasks reports line numbers and suggested next tasks stay ordered', () => {
    const t = '# Plan\n\n- [x] T001 done\n- [ ] T002 alpha\n- [ ] T003 beta\n';
    expect(parseTasksMd(t)).toEqual({ completed: 1, total: 3, remaining: 2 });
    expect(uncheckedTasks(t)).toEqual([
      { line: 4, text: 'T002 alpha' },
      { line: 5, text: 'T003 beta' },
    ]);
  });
});

// ── §23 items 7–12: git-derived slice changeset across every relevant state ───
describe('V2 git-derived slice changeset (spec §6)', () => {
  it('new, modified, deleted and renamed files are all captured with statuses', () => {
    const repo = gitFixture('statuses');
    repo.writeFile('keep.ts', 'a\n');
    repo.writeFile('gone.ts', 'b\n');
    repo.writeFile('mod.ts', 'v1\n');
    repo.commitAll('work');
    repo.g(['mv', 'keep.ts', 'renamed.ts']); // rename staged
    repo.writeFile('brand-new.ts', 'c\n'); // new untracked
    repo.writeFile('mod.ts', 'v2\n'); // modified unstaged
    repo.rm('gone.ts'); // deleted unstaged
    const cs = resolveSliceChangeset({ repoRoot: repo.root, baseRef: repo.baseSha() });
    const byPath = Object.fromEntries(cs.files.map((f) => [f.path, f.status]));
    expect(byPath['renamed.ts']).toBe('added');
    expect(byPath['keep.ts']).toBe('deleted');
    expect(byPath['brand-new.ts']).toBe('untracked');
    expect(byPath['mod.ts']).toBe('modified');
    expect(byPath['gone.ts']).toBe('deleted');
    expect(cs.unknown).toBe(false);
  });

  it('multiple slice commits accumulate into one changeset since the base', () => {
    const repo = gitFixture('multicommit');
    const base = repo.baseSha();
    repo.writeFile('one.ts', '1\n');
    repo.commitAll('c1');
    repo.writeFile('two.ts', '2\n');
    repo.commitAll('c2');
    repo.writeFile('three.ts', '3\n');
    repo.commitAll('c3');
    const cs = resolveSliceChangeset({ repoRoot: repo.root, baseRef: base });
    expect(cs.files.map((f) => f.path).sort()).toEqual(['one.ts', 'three.ts', 'two.ts']);
    expect(cs.commits).toHaveLength(3);
  });

  it('uncommitted continuation from an interrupted slice is included without any commit', () => {
    const repo = gitFixture('continuation');
    const base = repo.baseSha();
    repo.writeFile('partial.ts', 'partial\n'); // new file, never added
    repo.writeFile('base.txt', 'edited tracked file\n'); // modification
    const cs = resolveSliceChangeset({ repoRoot: repo.root, baseRef: base });
    const statuses = Object.fromEntries(cs.files.map((f) => [f.path, f.status]));
    expect(statuses['partial.ts']).toBe('untracked');
    expect(statuses['base.txt']).toBe('modified');
  });

  it('unresolvable explicit base falls back WIDER (merge-base); no base at all fails closed', () => {
    const repo = gitFixture('closed');
    repo.writeFile('extra.ts', 'x\n');
    repo.commitAll('post-base');
    // Explicit base that does not resolve ⇒ recorded, then merge-base fallback.
    // The fallback can only widen the changeset (superset), so it stays safe.
    const cs = resolveSliceChangeset({ repoRoot: repo.root, baseRef: 'deadbeefdeadbeef' });
    expect(cs.unknown).toBe(false);
    expect(cs.reasons.join(' ')).toMatch(/not a resolvable commit/);
    expect(cs.files.map((f) => f.path)).toContain('extra.ts');
    // No explicit base AND no resolvable origin/main ⇒ unknown (escalate FULL).
    const lonely = gitFixture('lonely');
    lonely.g(['remote', 'remove', 'origin']);
    const cs2 = resolveSliceChangeset({ repoRoot: lonely.root });
    expect(cs2.unknown).toBe(true);
  });

  it('-z parsers handle diff (from→to) and porcelain (to→from) rename orders', () => {
    // Empirically verified byte layouts (see slice-changeset.mjs comment).
    expect(parseNameStatus('R100\0old.ts\0new.ts\0')).toEqual([
      { path: 'old.ts', status: 'deleted' },
      { path: 'new.ts', status: 'added' },
    ]);
    expect(parsePorcelain('R  new.ts\0old.ts\0?? u.ts\0 M m.ts\0 D d.ts\0')).toEqual([
      { path: 'old.ts', status: 'deleted' },
      { path: 'new.ts', status: 'added' },
      { path: 'u.ts', status: 'untracked' },
      { path: 'm.ts', status: 'modified' },
      { path: 'd.ts', status: 'deleted' },
    ]);
  });
});

// ── §23 items 13–19: impact-aware FAST classification ─────────────────────────
describe('V2 impact-aware FAST verification routing (spec §7)', () => {
  it('JS/TS routes to eslint + related tests + typecheck', () => {
    const c = classifyImpact(['packages/x/src/a.ts', 'packages/x/src/b.mjs']);
    expect(c.escalateFull).toBe(false);
    expect(planFastChecks(c).map((s) => s.kind)).toEqual(['eslint', 'vitest-related', 'typecheck']);
  });

  it('SQL/migrations route to database checks (never silently unchecked)', () => {
    const c = classifyImpact(['migrations/g0_core_init.sql', 'db/schema-extra.sql']);
    expect(c.categories.DATABASE).toHaveLength(2);
    expect(planFastChecks(c).map((s) => s.kind)).toEqual(['vitest-related']);
    expect(planFastChecks(c)[0]?.database).toBe(true);
  });

  it('authoritative JSON/spec routes to authority validators + conformance tests', () => {
    const c = classifyImpact([
      'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
      'specs/implementation/current-milestone.json',
    ]);
    expect(c.categories.AUTHORITATIVE_SPEC).toHaveLength(2);
    expect(planFastChecks(c).map((s) => s.kind)).toEqual([
      'authority-validate',
      'conformance-tests',
    ]);
  });

  it('Archon YAML/control-plane routes to format check + archon validation', () => {
    const c = classifyImpact([
      '.archon/workflows/foresift/foresift-work-package-optimized.yaml',
      '.claude/skills/speckit-plan/SKILL.md',
    ]);
    expect(c.categories.ARCHON_CONTROL_PLANE).toHaveLength(2);
    expect(planFastChecks(c).map((s) => s.kind)).toEqual(['format-check', 'archon-validate']);
  });

  it('docs-only slices avoid the full test suite', () => {
    const c = classifyImpact(['docs/runbooks/ops.md', 'README.md', 'notes.txt']);
    expect(c.escalateFull).toBe(false);
    expect(planFastChecks(c).map((s) => s.kind)).toEqual(['format-check']);
  });

  it.each([
    ['package.json', 'root manifest'],
    ['pnpm-lock.yaml', 'lockfile'],
    ['tsconfig.base.json', 'tsconfig'],
    ['.github/workflows/ci.yml', 'CI definition'],
    ['Dockerfile', 'extensionless root type'],
    ['weird.config.unknownext', 'unknown extension'],
    ['scripts/tool.rb', 'unknown language'],
  ])('%s (%s) escalates FULL — unknown impact never guesses (spec §7)', (p) => {
    expect(classifyPath(p)).toBe('ROOT_OR_UNKNOWN');
    expect(classifyImpact([p]).escalateFull).toBe(true);
  });

  it('mixed slices inherit the strongest requirement (one unknown ⇒ FULL)', () => {
    const c = classifyImpact(['src/tiny.ts', 'package.json']);
    expect(c.escalateFull).toBe(true);
    expect(planFastChecks(c)).toEqual([]); // escalation replaces targeted checks
    expect(c.reason).toMatch(/package\.json/);
  });

  it('deletions still trigger their category checks even though the file is gone', () => {
    const c = classifyImpact(['packages/x/deleted-module.ts']);
    expect(planFastChecks(c).some((s) => s.kind === 'typecheck')).toBe(true);
  });
});

// ── FAST base resolution (checkpoint > merge-base > unknown) ──────────────────
describe('V2 FAST scope base resolution (spec §6)', () => {
  it('prefers a VALID checkpoint head, falls back on drifted cache, then merge-base', () => {
    const repo = gitFixture('fastbase');
    const art = join(repo.root, 'artifacts');
    mkdirSync(art, { recursive: true });
    const src = write('fastbase-src/watched.md', 'stable\n');

    const goodCp = buildCheckpoint({
      packageId: 'fb',
      headSha: 'cafe000000000000000000000000000000000000',
      tasks: { completed: 0, total: 0, remaining: 0 },
      slice: {},
      sources: { watched: src },
    });
    writeFileSync(join(art, 'implementation-checkpoint.json'), JSON.stringify(goodCp));
    const r1 = resolveFastBase({ repoRoot: repo.root, packageId: 'fb', artifactsDir: art });
    expect(r1.source).toBe('checkpoint');
    expect(r1.baseRef).toMatch(/^cafe0/);

    // Drifted cached source ⇒ checkpoint unusable ⇒ merge-base fallback.
    write('fastbase-src/watched.md', 'drifted\n');
    const r2 = resolveFastBase({ repoRoot: repo.root, packageId: 'fb', artifactsDir: art });
    expect(r2.source).toBe('merge-base');
    expect(r2.baseRef).toBe(repo.baseSha());

    // Explicit base always wins.
    const r3 = resolveFastBase({
      repoRoot: repo.root,
      packageId: 'fb',
      artifactsDir: art,
      base: '1234567890abcdef1234567890abcdef12345678',
    });
    expect(r3).toEqual({
      baseRef: '1234567890abcdef1234567890abcdef12345678',
      source: 'explicit',
    });

    // Foreign-package checkpoints never pin the base.
    const r4 = resolveFastBase({ repoRoot: repo.root, packageId: 'other', artifactsDir: art });
    expect(r4.source).toBe('merge-base');
  });
});

// ── context capsule derivation (spec §5) ──────────────────────────────────────
describe('V2 deterministic context capsule (spec §5)', () => {
  it('derives requirement→acceptance→PRD/ADR references from the manifest', () => {
    const repoRoot = join(fx, 'capsule-repo');
    mkdirSync(join(repoRoot, 'docs/spec'), { recursive: true });
    mkdirSync(join(repoRoot, 'specs/implementation'), { recursive: true });
    mkdirSync(join(repoRoot, 'specs/cap'), { recursive: true });
    writeFileSync(
      join(repoRoot, 'specs/implementation/current-milestone.json'),
      JSON.stringify({
        packages: [
          {
            id: 'cap',
            objective: 'Build the capsule fixture package for tests.',
            risk: 'HIGH',
            writeScopes: ['packages/cap/**'],
            requirementIds: ['FR-TST-001'],
          },
        ],
      }),
    );
    writeFileSync(
      join(repoRoot, 'docs/spec/m.requirements.json'),
      JSON.stringify({
        requirements: [
          {
            id: 'FR-TST-001',
            section: '38. Functional requirements catalogue',
            subsection: '38.1',
            line: 100,
            acceptanceCriteria: ['AC-900', 'AC-901'],
            securityRightsCostControls: ['see ADR-007 for isolation rationale'],
          },
          { id: 'FR-OTHER-999', acceptanceCriteria: ['AC-999'] },
        ],
        acceptanceCriteria: [
          { id: 'AC-900', positiveTestRef: 'tests/acceptance/AC-900.spec.ts' },
          { id: 'AC-999', positiveTestRef: 'tests/acceptance/AC-999.spec.ts' },
        ],
        adrs: [{ id: 'ADR-007', title: 'Isolation', section: 'Appendix D' }],
      }),
    );
    // Point the module at the fixture manifest by mirroring the canonical name.
    writeFileSync(
      join(
        repoRoot,
        'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
      ),
      readFileSync(join(repoRoot, 'docs/spec/m.requirements.json')),
    );
    writeFileSync(join(repoRoot, 'specs/cap/tasks.md'), '- [x] T001\n- [ ] T002 next\n');
    const cap = deriveCapsule({ repoRoot, packageId: 'cap', artifactsDir: null });
    expect(cap.risk).toBe('HIGH');
    expect(cap.requirementIds).toEqual(['FR-TST-001']);
    expect(cap.acceptanceIds).toEqual(['AC-900', 'AC-901']); // other packages excluded
    expect(cap.prdReferences).toEqual([
      {
        requirementId: 'FR-TST-001',
        section: '38. Functional requirements catalogue',
        subsection: '38.1',
        line: 100,
      },
    ]);
    expect(cap.adrReferences).toEqual([
      { id: 'ADR-007', title: 'Isolation', section: 'Appendix D' },
    ]);
    expect(cap.affectedTestRefs).toEqual(['tests/acceptance/AC-900.spec.ts']);
    expect(cap.specKitArtifacts).toEqual(['specs/cap/tasks.md']);
    expect(cap.firstUnfinishedTask).toEqual({ line: 2, text: 'T002 next' });
    expect(cap.profile).toBe('OPTIMIZED');
  });

  it('degrades to empty capsule fields instead of throwing when authority is absent', () => {
    const empty = mkdtempSync(join(tmpdir(), 'foresift-v2-empty-'));
    try {
      const cap = deriveCapsule({ repoRoot: empty, packageId: 'ghost', artifactsDir: empty });
      expect(cap.risk).toBeNull();
      expect(cap.acceptanceIds).toEqual([]);
      expect(cap.firstUnfinishedTask).toBeNull();
      expect(cap.previousFast).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('records the previous FAST outcome as a summary, not volatile bulk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foresift-v2-prevfast-'));
    try {
      writeFileSync(
        join(dir, 'fast-verify-result.json'),
        JSON.stringify({
          schema: 'foresift/fast-verify@2',
          escalatedToFullSuite: false,
          results: [{ result: 'PASS' }],
          timestamp: '2026-08-23T00:00:00.000Z',
        }),
      );
      const cap = deriveCapsule({ repoRoot: dir, packageId: 'p', artifactsDir: dir });
      expect(cap.previousFast).toEqual({
        schema: 'foresift/fast-verify@2',
        escalatedToFullSuite: false,
        failed: false,
        timestamp: '2026-08-23T00:00:00.000Z',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('source-hash invalidation contract is unchanged by the capsule (PR #19 semantics)', () => {
    const absent = write('capsule-absent/placeholder', 'x');
    rmSync(absent);
    const cp = buildCheckpoint({
      packageId: 'p',
      headSha: 'h',
      tasks: { completed: 0, total: 0, remaining: 0 },
      slice: {},
      sources: { optionalPlan: absent },
      context: deriveCapsule({ repoRoot: fx, packageId: 'ghost', artifactsDir: null }),
    });
    expect(cp.sourceHashes.optionalPlan?.sha256).toBeNull();
    expect(validateCheckpoint(cp).valid).toBe(true); // absent at build + still absent
    write('capsule-absent/placeholder', 'appeared\n');
    expect(validateCheckpoint(cp).valid).toBe(false); // appeared ⇒ drift
    expect(sha256File(absent)).not.toBeNull();
  });
});
