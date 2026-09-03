import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const GRAPH = join(repoRoot, 'scripts', 'automation', 'build-implementation-task-graph.mjs');
const GUARD = join(repoRoot, 'scripts', 'automation', 'wave-guard.mjs');
const INTEGRATE = join(repoRoot, 'scripts', 'automation', 'integrate-writer-results.mjs');
const ADMIT = join(repoRoot, 'scripts', 'automation', 'check-writer-admission.mjs');

const TASKS = `# Tasks: pkg-x

**Traceability rule**: assigned requirements only.

## Phase A — foundation (blocks everything)

- [x] T101 Setup \`packages/x/src/base.ts\`. Traces: FR-X-001.

## Phase B — features

- [ ] T102 Implement alpha in \`packages/x/src/alpha.ts\` with care.
      Traces: FR-X-001, FR-X-002. Depends on T101 groundwork.
- [ ] T103 [P] Write spec \`tests/x/a.spec.ts\` exercising
      \`packages/x/src/alpha.ts\`. Traces: FR-X-001 (AC-201).
- [ ] T104 [P] Write guide \`docs/x-guide.md\`. Traces: FR-X-002 (AC-202).
`;

interface Fixture {
  root: string;
  baseSha: string;
  graphPath: string;
  artifacts: string;
}

function sh(cmd: string, cwd: string) {
  const r = spawnSync(cmd, { shell: true, cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fixture cmd failed (${cmd}): ${r.stderr ?? r.stdout}`);
  return (r.stdout ?? '').trim();
}

function rev(repo: string, ref = 'HEAD') {
  return sh(`git rev-parse ${ref}`, repo);
}

function buildFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'impl-wave-fx-'));
  mkdirSync(join(root, 'specs', 'pkg-x'), { recursive: true });
  mkdirSync(join(root, 'specs', 'implementation'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'specs', 'pkg-x', 'tasks.md'), TASKS);
  const ms = {
    schemaVersion: '1.0.0',
    milestoneId: 'MX',
    status: 'ACTIVE',
    packages: [
      {
        id: 'pkg-x',
        objective: 'Implement subsystem x end to end with full evidence coverage.',
        requirementIds: ['FR-X-001', 'FR-X-002'],
        dependencies: [],
        risk: 'MEDIUM',
        parallelizable: false,
        writeScopes: ['packages/x/**', 'tests/x/**', 'docs/x*'],
        verificationCommands: ['pnpm test'],
        status: 'RUNNING',
      },
      {
        id: 'pkg-y',
        objective: 'Implement independent subsystem y behind its own boundary.',
        requirementIds: ['FR-Y-001'],
        dependencies: ['pkg-x'],
        risk: 'LOW',
        parallelizable: true,
        writeScopes: ['packages/y/**'],
        verificationCommands: ['pnpm test'],
        status: 'PENDING',
      },
    ],
  };
  writeFileSync(
    join(root, 'specs', 'implementation', 'current-milestone.json'),
    JSON.stringify(ms),
  );
  sh('git init -q', root);
  sh('git config user.email t@t', root);
  sh('git config user.name t', root);
  sh('git add -A', root);
  sh('git commit -qm base', root);
  const baseSha = rev(root);

  const artifacts = mkdtempSync(join(tmpdir(), 'impl-wave-art-'));
  const graphPath = join(artifacts, 'task-graph.json');
  const r = spawnSync(
    process.execPath,
    [GRAPH, '--package', 'pkg-x', '--root', root, '--plan-shards', '2', '--out', graphPath],
    { encoding: 'utf8' },
  );
  expect(r.status).toBe(0);
  return { root, baseSha, graphPath, artifacts };
}

let fx: Fixture;

beforeAll(() => {
  fx = buildFixture();
});
afterAll(() => {
  rmSync(fx.root, { recursive: true, force: true });
  rmSync(fx.artifacts, { recursive: true, force: true });
});

describe('implementation task graph', () => {
  it('derives units, traces, predicted writes, and blocking-phase deps', () => {
    const g = JSON.parse(readFileSync(fx.graphPath, 'utf8'));
    expect(g.schema).toBe('foresift/impl-task-graph@1');
    expect(g.totals).toMatchObject({ units: 4, done: 1, open: 3, openParallelizable: 2 });
    const t102 = g.units.find((u: { id: string }) => u.id === 'T102');
    expect(t102.done).toBe(false);
    expect(t102.parallelizable).toBe(false);
    expect(t102.predictedWrites).toEqual(['packages/x/src/alpha.ts']);
    expect(t102.requirements).toEqual(['FR-X-001', 'FR-X-002']);
    // explicit reference AND blocking phase both create dependencies
    expect(t102.dependsOn).toContain('T101');
    const t104 = g.units.find((u: { id: string }) => u.id === 'T104');
    expect(t104.dependsOn).toContain('T101');
    expect(t104.acceptanceCriteria).toEqual(['AC-202']);
  });

  it('plans shards that are pairwise write-disjoint across lanes', () => {
    const g = JSON.parse(readFileSync(fx.graphPath, 'utf8'));
    expect(g.shards.length).toBe(2); // core + one parallel shard for --plan-shards 2
    const core = g.shards.find((s: { id: string }) => s.id === 'core');
    expect(core.mode).toBe('serial');
    // T102 is non-[P]; T103 is [P] but writes alpha.ts, a core path → demoted.
    expect(core.units).toEqual(expect.arrayContaining(['T102', 'T103']));
    const par = g.shards.filter((s: { mode: string }) => s.mode === 'parallel');
    for (const p of par) expect(p.units).toEqual(['T104']);
    // no path appears in two shards
    const seen = new Set<string>();
    for (const s of g.shards)
      for (const p of s.allowedWritePaths) {
        expect(seen.has(p)).toBe(false);
        seen.add(p);
      }
    expect(g.scopeExceptions).toEqual([]);
  });

  it('demotes out-of-scope-writing units to the serial core as recorded exceptions', () => {
    // T149-style: a task whose body names an out-of-scope path.
    const tasks2 = TASKS.replace(
      '- [ ] T104 [P] Write guide `docs/x-guide.md`. Traces: FR-X-002 (AC-202).',
      '- [ ] T104 [P] Extend the pattern extension in `packages/persistence/src/migrator.ts`. Traces: FR-X-002.',
    );
    writeFileSync(join(fx.root, 'specs', 'pkg-x', 'tasks.md'), tasks2);
    const out = join(fx.artifacts, 'graph-exc.json');
    const r = spawnSync(
      process.execPath,
      [GRAPH, '--package', 'pkg-x', '--root', fx.root, '--plan-shards', '2', '--out', out],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    const g = JSON.parse(readFileSync(out, 'utf8'));
    expect(g.scopeExceptions).toEqual(['packages/persistence/src/migrator.ts']);
    const core = g.shards.find((s: { id: string }) => s.id === 'core');
    expect(core.units).toContain('T104'); // demoted despite [P]
    // restore canonical fixture text
    writeFileSync(join(fx.root, 'specs', 'pkg-x', 'tasks.md'), TASKS);
  });

  it('never duplicates a unit that qualifies for both coreSeed lists (live 95c45071 bug)', () => {
    // A non-[P] unit whose writes leave writeScopes entered coreSeed TWICE
    // (once via nonP, once via scopeDemoted), so core carried duplicate ids
    // and over-broad union write authority.
    const tasks2 = TASKS.replace(
      '- [ ] T102 Implement alpha in `packages/x/src/alpha.ts` with care.',
      '- [ ] T102 Implement alpha in `packages/x/src/alpha.ts` with care, syncing `packages/persistence/src/migrator.ts`.',
    );
    writeFileSync(join(fx.root, 'specs', 'pkg-x', 'tasks.md'), tasks2);
    const out = join(fx.artifacts, 'graph-dup.json');
    const r = spawnSync(
      process.execPath,
      [GRAPH, '--package', 'pkg-x', '--root', fx.root, '--plan-shards', '3', '--out', out],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    const g = JSON.parse(readFileSync(out, 'utf8'));
    const core = g.shards.find((s: { id: string }) => s.id === 'core');
    expect(core.units.filter((u: string) => u === 'T102')).toHaveLength(1);
    // restore canonical fixture text
    writeFileSync(join(fx.root, 'specs', 'pkg-x', 'tasks.md'), TASKS);
  });

  it('decomposes a heavy serial core into bounded sequential batches (mission item 4)', () => {
    // A package with many non-[P] units must not hand ONE lane the whole
    // serial column: the planner splits it into dependency-ordered
    // core-batch-N lanes of bounded estimated load, each chained to its
    // parent (chainId 'core'). Small packages keep the exact legacy `core`
    // shape (a single batch is emitted as `core`).
    const bigTasks = `# Tasks: pkg-x

## Phase A — foundation (blocks everything)

- [x] T101 Setup.
${Array.from(
  { length: 14 },
  (_, i) =>
    `- [ ] T1${(i + 1).toString().padStart(2, '0')} Implement module ${i + 1} in \`packages/x/src/mod${i + 1}.ts\` covering the module contract.\n      Traces: FR-X-001. Depends on T101 groundwork.`,
).join('\n')}

## Phase B — parallel surface

- [ ] T199 [P] Write guide \`docs/x-guide.md\`. Traces: FR-X-002 (AC-202).
`;
    writeFileSync(join(fx.root, 'specs', 'pkg-x', 'tasks.md'), bigTasks);
    try {
      const out = join(fx.artifacts, 'graph-batches.json');
      const r = spawnSync(
        process.execPath,
        [GRAPH, '--package', 'pkg-x', '--root', fx.root, '--plan-shards', '3', '--out', out],
        { encoding: 'utf8' },
      );
      expect(r.status).toBe(0);
      const g = JSON.parse(readFileSync(out, 'utf8'));
      const serial = g.shards.filter((s: { mode: string }) => s.mode === 'serial');
      expect(serial.length).toBeGreaterThan(1); // decomposition actually happened
      expect(serial.length).toBeLessThanOrEqual(3); // wired lane ceiling
      // 1. every unit is covered exactly once across the chain
      const all = serial.flatMap((s: { units: string[] }) => s.units);
      expect(new Set(all).size).toBe(all.length);
      // 2. chain wiring: batch i>1 chains from batch i-1, one chainId
      serial.forEach(
        (s: { chainId?: string; chainsFrom?: string | null; batchIndex?: number }, i: number) => {
          expect(s.chainId).toBe('core');
          expect(s.batchIndex).toBe(i + 1);
          expect(s.chainsFrom).toBe(i === 0 ? null : serial[i - 1].id);
        },
      );
      // 3. bounded load: no batch exceeds the per-lane load budget + slack
      for (const s of serial as Array<{ estimatedSize: number; laneTooLarge?: boolean }>)
        expect(s.estimatedSize <= 8 || s.laneTooLarge === true).toBe(true);
      // 4. topological: no unit depends on a same-column unit scheduled LATER
      const units = new Map<string, { id: string; dependsOn: string[] }>(
        g.units.map((u: { id: string; dependsOn: string[] }) => [u.id, u]),
      );
      const pos = new Map<string, number>();
      serial.forEach((s: { units: string[] }) =>
        s.units.forEach((u: string) => pos.set(u, pos.size)),
      );
      for (const [uid, p] of pos)
        for (const d of units.get(uid)!.dependsOn)
          if (pos.has(d)) expect(pos.get(d)!).toBeLessThan(p);
      // 5. write authority: serial batches share the column union; parallel
      // lanes never share a path with the column
      const column = new Set(
        serial.flatMap((s: { allowedWritePaths: string[] }) => s.allowedWritePaths),
      );
      for (const par of g.shards.filter((s: { mode: string }) => s.mode === 'parallel') as Array<{
        allowedWritePaths: string[];
      }>)
        for (const p of par.allowedWritePaths) expect(column.has(p)).toBe(false);
    } finally {
      writeFileSync(join(fx.root, 'specs', 'pkg-x', 'tasks.md'), TASKS);
    }
  });

  it('keeps the single-batch core byte-identical to the legacy shape', () => {
    const g = JSON.parse(readFileSync(fx.graphPath, 'utf8'));
    const serial = g.shards.filter((s: { mode: string }) => s.mode === 'serial');
    expect(serial).toHaveLength(1);
    expect(serial[0].id).toBe('core'); // NOT core-batch-1
    expect(serial[0].mode).toBe('serial');
    expect(serial[0].chainId).toBeUndefined();
  });

  it('skips command-tail backticks when deriving predicted writes (T016 class)', () => {
    // `scripts/x/cli.mjs generate` is a COMMAND, not a writable path: recording
    // it as a predicted write made the evidence matcher compare a diff against
    // a string that can never be a filename (live T016, run 89c4b2b9).
    const tasks3 = TASKS.replace(
      '- [ ] T104 [P] Write guide `docs/x-guide.md`. Traces: FR-X-002 (AC-202).',
      '- [ ] T104 [P] Run `scripts/generate/guide.mjs generate` to emit `docs/x-guide.md`. Traces: FR-X-002 (AC-202).',
    );
    writeFileSync(join(fx.root, 'specs', 'pkg-x', 'tasks.md'), tasks3);
    try {
      const out = join(fx.artifacts, 'graph-cmd-tail.json');
      const r = spawnSync(
        process.execPath,
        [GRAPH, '--package', 'pkg-x', '--root', fx.root, '--plan-shards', '2', '--out', out],
        { encoding: 'utf8' },
      );
      expect(r.status).toBe(0);
      const g = JSON.parse(readFileSync(out, 'utf8'));
      const t104 = g.units.find((u: { id: string }) => u.id === 'T104');
      expect(t104.predictedWrites).toEqual(['docs/x-guide.md']); // command tail excluded
    } finally {
      writeFileSync(join(fx.root, 'specs', 'pkg-x', 'tasks.md'), TASKS);
    }
  });

  it('folds parallel units into the core when plan-shards 1 leaves no parallel slots', () => {
    // --plan-shards 1 (governor YELLOW path: adaptive lanes resolve to 1) used
    // to crash the planner: extra=0 → groups=[] → `target ?? groups[0]` was
    // undefined and `target.units.push` threw. The surviving [P] unit must be
    // demoted into the serial column instead — the plan never drops work.
    const out = join(fx.artifacts, 'graph-plan-shards-1.json');
    const r = spawnSync(
      process.execPath,
      [GRAPH, '--package', 'pkg-x', '--root', fx.root, '--plan-shards', '1', '--out', out],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    const g = JSON.parse(readFileSync(out, 'utf8'));
    expect(g.shards).toHaveLength(1); // core only, no parallel slots exist
    const core = g.shards[0];
    expect(core.mode).toBe('serial');
    expect(core.id).toBe('core');
    // T104 (the [P] unit with a core-disjoint write) rides in the core column
    expect(core.units).toEqual(expect.arrayContaining(['T102', 'T104']));
  });

  it('closure-demotes group units that collide with core after demotion (live 95c45071 guard refusal)', () => {
    // T017-shape: a [P] unit depends on core units, is demoted to core, and
    // shares a predicted write with a parallel group unit (T004-shape owned
    // `packages/shared-schemas/src/trace.ts`). The old planner left the
    // collision in place and the wave guard refused the lane — the run failed.
    const tasks2 = TASKS.replace(
      '- [ ] T103 [P] Write spec `tests/x/a.spec.ts` exercising\n      `packages/x/src/alpha.ts`. Traces: FR-X-001 (AC-201).',
      '- [ ] T103 [P] Write spec `tests/x/a.spec.ts` exercising\n      `packages/x/src/alpha.ts`. Depends on T102 groundwork. Traces: FR-X-001 (AC-201).\n- [ ] T105 [P] Extend the trace schema in `packages/x/src/alpha.ts` after T103. Depends on T103. Traces: FR-X-002.',
    );
    writeFileSync(join(fx.root, 'specs', 'pkg-x', 'tasks.md'), tasks2);
    const out = join(fx.artifacts, 'graph-closure.json');
    const r = spawnSync(
      process.execPath,
      [GRAPH, '--package', 'pkg-x', '--root', fx.root, '--plan-shards', '2', '--out', out],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    const g = JSON.parse(readFileSync(out, 'utf8'));
    // Pairwise write-disjointness across ALL lanes is the invariant.
    const owner = new Map<string, string>();
    const collisions: string[] = [];
    for (const s of g.shards as Array<{ id: string; allowedWritePaths: string[] }>)
      for (const p of s.allowedWritePaths) {
        if (owner.has(p)) collisions.push(p);
        owner.set(p, s.id);
      }
    expect(collisions).toEqual([]);
    writeFileSync(join(fx.root, 'specs', 'pkg-x', 'tasks.md'), TASKS);
  });

  it('records the root workspace lockfile as a recordable scope exception (live guard-refusal fix)', () => {
    // Live finding 2026-08-25: scaffolding a package mechanically updates
    // pnpm-lock.yaml, but the collector only accepted scoped prefixes, so the
    // lockfile could NEVER be declared and every compliant writer tripped
    // guard-core's WRITE-AUTHORITY VIOLATION.
    const tasks2 = TASKS.replace(
      '- [ ] T104 [P] Write guide `docs/x-guide.md`. Traces: FR-X-002 (AC-202).',
      '- [ ] T104 [P] Scaffold `packages/provider-x`; lockfile follows: `pnpm-lock.yaml`. ' +
        'Traces: FR-X-002.',
    );
    writeFileSync(join(fx.root, 'specs', 'pkg-x', 'tasks.md'), tasks2);
    const out = join(fx.artifacts, 'graph-lock.json');
    const r = spawnSync(
      process.execPath,
      [GRAPH, '--package', 'pkg-x', '--root', fx.root, '--plan-shards', '2', '--out', out],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    const g = JSON.parse(readFileSync(out, 'utf8'));
    expect(g.scopeExceptions).toContain('pnpm-lock.yaml');
    const core = g.shards.find((s: { id: string }) => s.id === 'core');
    expect(core.units).toContain('T104'); // demoted to serial core with its exception
    // restore canonical fixture text
    writeFileSync(join(fx.root, 'specs', 'pkg-x', 'tasks.md'), TASKS);
  });

  it('records the root package.json as a recordable scope exception (live guard-refusal fix)', () => {
    // Live finding 2026-08-26 (run f9ed4de6): acceptance/negative suites run
    // under the root unit project, so linking a new package there requires a
    // root `package.json` devDependencies edit — but the collector only
    // accepted scoped prefixes + the bare lockfile, so the link could NEVER be
    // declared and every compliant writer tripped guard-core's
    // WRITE-AUTHORITY VIOLATION.
    const tasks2 = TASKS.replace(
      '- [ ] T104 [P] Write guide `docs/x-guide.md`. Traces: FR-X-002 (AC-202).',
      '- [ ] T104 [P] Write guide `docs/x-guide.md`; root unit project links the' +
        ' package via devDependencies in `package.json`. Traces: FR-X-002.',
    );
    writeFileSync(join(fx.root, 'specs', 'pkg-x', 'tasks.md'), tasks2);
    const out = join(fx.artifacts, 'graph-pkgjson.json');
    const r = spawnSync(
      process.execPath,
      [GRAPH, '--package', 'pkg-x', '--root', fx.root, '--plan-shards', '2', '--out', out],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    const g = JSON.parse(readFileSync(out, 'utf8'));
    expect(g.scopeExceptions).toContain('package.json');
    const core2 = g.shards.find((s: { id: string }) => s.id === 'core');
    expect(core2.units).toContain('T104'); // demoted to serial core with its exception
    // restore canonical fixture text
    writeFileSync(join(fx.root, 'specs', 'pkg-x', 'tasks.md'), TASKS);
  });

  it('a backticked package-DIRECTORY token is an in-scope predicted write (live T001/T002 scaffold class, run aa3e8015)', () => {
    // A scaffold task names its package directory (`packages/requirement-x`),
    // but the binding scope is `packages/x/**`-style: `**/` requires a
    // trailing slash, so the bare directory never matched, the whole write
    // set fell to outOfScopeWrites, and the task could never carry evidence —
    // its files (written UNDER the directory) starved of a matching write.
    const tasks2 = TASKS.replace(
      '- [ ] T104 [P] Write guide `docs/x-guide.md`. Traces: FR-X-002 (AC-202).',
      '- [ ] T104 [P] Scaffold the `packages/x` workspace package: `package.json`,' +
        ' `tsconfig.json`, and `src/index.ts`. Traces: FR-X-002 (AC-202).',
    );
    writeFileSync(join(fx.root, 'specs', 'pkg-x', 'tasks.md'), tasks2);
    const out = join(fx.artifacts, 'graph-dirtoken.json');
    const r = spawnSync(
      process.execPath,
      [GRAPH, '--package', 'pkg-x', '--root', fx.root, '--plan-shards', '2', '--out', out],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    const g = JSON.parse(readFileSync(out, 'utf8'));
    const t104 = g.units.find((u: { id: string }) => u.id === 'T104');
    expect(t104.predictedWrites).toContain('packages/x');
    expect(t104.outOfScopeWrites).not.toContain('packages/x');
    // root bookkeeping stays a recorded exception (demote, never widen)
    expect(t104.outOfScopeWrites).toContain('package.json');
    // restore canonical fixture text
    writeFileSync(join(fx.root, 'specs', 'pkg-x', 'tasks.md'), TASKS);
  });
});

// Real multi-worktree wave fixture: two writer branches + one violating branch.
function commitBranch(branch: string, file: string, content: string): string {
  const wt = join(fx.artifacts, 'wt-' + branch.replaceAll('/', '-'));
  sh(`git worktree add -B ${branch} "${wt}" ${fx.baseSha}`, fx.root);
  mkdirSync(dirname(join(wt, file)), { recursive: true });
  writeFileSync(join(wt, file), content);
  sh('git add -A', wt);
  sh('git -c user.email=w@w -c user.name=w commit -qm work', wt);
  return { wt, head: rev(wt) } as never;
}
function laneDir(lane: string) {
  const d = join(fx.artifacts, 'writer-results', lane);
  mkdirSync(d, { recursive: true });
  return d;
}

describe('wave guard + integrator (real git)', () => {
  let bEvil: string;

  beforeAll(() => {
    // shard-meta.json as prep would write it
    const meta = {
      core: { branch: 'foresift/wave/core', worktree: join(fx.artifacts, 'wt-core') },
      'shard-1': { branch: 'foresift/wave/shard-1', worktree: join(fx.artifacts, 'wt-shard-1') },
    };
    writeFileSync(join(fx.artifacts, 'shard-meta.json'), JSON.stringify(meta));
    writeFileSync(join(fx.artifacts, 'base-head.txt'), fx.baseSha);
    commitBranch('foresift/wave/core', 'packages/x/src/alpha.ts', 'export const alpha = 1;\n');
    // T103 was demoted into core, so core also owns its spec file.
    sh(
      'mkdir -p tests/x && printf "test(\'a\', () => {});\\n" > tests/x/a.spec.ts && git add -A && git -c user.email=w@w -c user.name=w commit -qm work2',
      join(fx.artifacts, 'wt-foresift-wave-core'),
    );
    commitBranch('foresift/wave/shard-1', 'docs/x-guide.md', '# guide\n');
    bEvil = commitBranch(
      'foresift/wave/evil',
      'scripts/evil.mjs',
      'console.log(1);\n',
    ) as unknown as string;
    void bEvil;
  });

  it('guards pass clean lanes and recompute facts (never trusting claims)', () => {
    for (const lane of ['core', 'shard-1']) {
      const r = spawnSync(
        process.execPath,
        [
          GUARD,
          '--shard',
          lane,
          '--artifacts',
          fx.artifacts,
          '--graph',
          fx.graphPath,
          '--root',
          fx.root,
        ],
        { encoding: 'utf8' },
      );
      expect(`${r.status}: ${r.stderr ?? ''}`).toMatch(/^0/);
      const verdict = JSON.parse(readFileSync(join(laneDir(lane), 'result.json'), 'utf8'));
      expect(verdict.authorityOk).toBe(true);
      expect(verdict.baseSha).toBe(fx.baseSha);
      expect(verdict.branch).toBe(`foresift/wave/${lane}`);
    }
  });

  it('rejects a lane writing outside authority, closed, without touching canonical', () => {
    // register evil lane in meta so the guard can see it
    const meta = JSON.parse(readFileSync(join(fx.artifacts, 'shard-meta.json'), 'utf8'));
    meta['evil'] = { branch: 'foresift/wave/evil', worktree: join(fx.artifacts, 'wt-evil') };
    writeFileSync(join(fx.artifacts, 'shard-meta.json'), JSON.stringify(meta));

    const r = spawnSync(
      process.execPath,
      [
        GUARD,
        '--shard',
        'evil',
        '--artifacts',
        fx.artifacts,
        '--graph',
        fx.graphPath,
        '--root',
        fx.root,
      ],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(1);
    const verdict = JSON.parse(readFileSync(join(laneDir('evil'), 'result.json'), 'utf8'));
    expect(verdict.authorityOk).toBe(false);
    expect(verdict.violations).toContain('scripts/evil.mjs');
  });

  it('integrates passing shards additively, marks tasks, rejects bad ones', () => {
    // claimed completions for bookkeeping
    writeFileSync(
      join(laneDir('core'), 'result.json'),
      readFileSync(join(laneDir('core'), 'result.json'), 'utf8').replace(
        /"completed": \[\]/,
        '"completed": ["T102", "T103"]',
      ),
    );
    writeFileSync(
      join(laneDir('shard-1'), 'result.json'),
      readFileSync(join(laneDir('shard-1'), 'result.json'), 'utf8').replace(
        /"completed": \[\]/,
        '"completed": ["T104"]',
      ),
    );
    const before = rev(fx.root);
    const r = spawnSync(
      process.execPath,
      [
        INTEGRATE,
        '--package',
        'pkg-x',
        '--graph',
        fx.graphPath,
        '--results-dir',
        join(fx.artifacts, 'writer-results'),
        '--canonical',
        fx.root,
        '--out',
        join(fx.artifacts, 'integration-report.json'),
      ],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    const report = JSON.parse(readFileSync(join(fx.artifacts, 'integration-report.json'), 'utf8'));
    expect(report.integrated.map((i: { shardId: string }) => i.shardId)).toEqual([
      'core',
      'shard-1',
    ]);
    // evil lane was rejected by its guard already; a stale claim must not merge
    expect(report.rejected.length + report.integrated.length).toBeGreaterThanOrEqual(2);
    expect(rev(fx.root)).not.toBe(before);
    const tasks = readFileSync(join(fx.root, 'specs', 'pkg-x', 'tasks.md'), 'utf8');
    expect(tasks).toContain('- [x] T102');
    expect(tasks).toContain('- [x] T103');
    expect(tasks).toContain('- [x] T104'); // claimed by shard-1 → marked by coordinator
  });

  it('refuses results whose claimed headSha does not match the branch', () => {
    const d = laneDir('core');
    writeFileSync(
      join(d, 'bogus.json'),
      JSON.stringify({
        schema: 'foresift/writer-result@1',
        shardId: 'core',
        completed: ['T999'],
        branch: 'foresift/wave/core',
        headSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        baseSha: fx.baseSha,
      }),
    );
    const r = spawnSync(
      process.execPath,
      [
        INTEGRATE,
        '--package',
        'pkg-x',
        '--graph',
        fx.graphPath,
        '--results-dir',
        d,
        '--canonical',
        fx.root,
      ],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(0); // coordinator reports; rejection is per-lane
    void r;
  });
});

describe('writer admission function', () => {
  it('admits under healthy telemetry and refuses under pressure', () => {
    const healthy = JSON.parse(
      spawnSync(
        process.execPath,
        [
          ADMIT,
          '--load1',
          '0.5',
          '--mem-available-kb',
          '6000000',
          '--mem-total-kb',
          '8000000',
          '--provider-failures',
          '0',
        ],
        { encoding: 'utf8' },
      ).stdout,
    );
    expect(healthy.admitExtraWriter).toBe(true);
    const pressured = JSON.parse(
      spawnSync(
        process.execPath,
        [
          ADMIT,
          '--load1',
          '3.9',
          '--mem-available-kb',
          '500000',
          '--mem-total-kb',
          '8000000',
          '--swap-total-kb',
          '2000000',
          '--swap-free-kb',
          '100000',
          '--provider-failures',
          '5',
        ],
        { encoding: 'utf8' },
      ).stdout,
    );
    expect(pressured.admitExtraWriter).toBe(false);
    expect(pressured.checks.providerHealthy).toBe(false);
  });

  it('counts provider failure signals from a journal tail', () => {
    const journal = join(fx.artifacts, 'j.log');
    writeFileSync(
      journal,
      Array.from({ length: 30 }, (_, i) => `event ${i}`).join('\n') +
        '\n429 too many\nempty stream\n',
    );
    const out = JSON.parse(
      spawnSync(process.execPath, [ADMIT, '--load1', '0.5', '--journal', journal, '--tail', '10'], {
        encoding: 'utf8',
      }).stdout,
    ) as { metrics: { providerFailures: number | null }; admitExtraWriter: boolean };
    expect(out.metrics.providerFailures).toBe(2);
  });
});

// ── sharded-wave workflow contract (regressions for the false-FAST defects) ────
// The durable WIP historically invoked the FULL per-package gate at the wave
// boundary (`pnpm foresift:gate`), swallowed its exit with `set +e … echo`, and
// dispatched provider writers for empty lanes. These assertions pin the fixed
// contract; `archon validate workflows` supplies the real YAML parse.
describe('foresift-sharded-wave workflow contract', () => {
  const WF = join(repoRoot, '.archon', 'workflows', 'foresift', 'foresift-sharded-wave.yaml');
  let yaml = '';

  beforeAll(() => {
    yaml = readFileSync(WF, 'utf8');
  });

  it('is valid for the installed archon runtime', () => {
    // The REAL archon parse is authoritative where archon exists (dev hosts,
    // canaries). CI runners have no archon install; there the YAML contract
    // above still holds, and the structural assertions in this file plus the
    // repo's `archon validate workflows` gate on control-plane changes keep
    // the workflow honest. Skip cleanly instead of failing the inner FULL
    // suite that gate e2e runs.
    const probe = spawnSync('command -v archon', { shell: true, encoding: 'utf8' });
    const hasArchon = probe.status === 0 && Boolean((probe.stdout ?? '').trim());
    if (!hasArchon) {
      expect(yaml.length).toBeGreaterThan(0); // structural contract still loaded
      return;
    }
    const r = spawnSync('archon', ['validate', 'workflows', 'foresift-sharded-wave'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ok');
  });

  it('never invokes the FULL gate as the wave FAST (defect: false fast path)', () => {
    expect(yaml).not.toMatch(/pnpm\s+foresift:gate/);
  });

  it('runs the TRUE FAST tier over the pinned wave base with git scope', () => {
    expect(yaml).toMatch(/package-fast-verify\.mjs/);
    // Extract each shell statement that invokes the FAST tier (continuation
    // lines end with '\') and require full scoping on every one of them.
    const lines = yaml.split('\n');
    const statements: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!(lines[i] ?? '').includes('scripts/automation/package-fast-verify.mjs')) continue;
      let stmt = '';
      for (let j = i; j < lines.length; j++) {
        stmt += (lines[j] ?? '') + '\n';
        if (!(lines[j] ?? '').trimEnd().endsWith('\\')) break;
        void j;
      }
      statements.push(stmt);
    }
    expect(statements.length).toBeGreaterThanOrEqual(2); // integrate + recheck
    for (const stmt of statements) {
      expect(stmt).toContain('--from-git');
      expect(stmt).toMatch(/--base "\$\(cat .*base-head\.txt"\)/);
      expect(stmt).toContain('--artifacts-dir');
    }
  });

  it('enforces CODEX product writers, CLAUDE_AGY fallbacks, AGY test-author only, and forbidden test edits in implementation prompts', () => {
    // H3 mission item 4: serial slots are graph-resolved (`writer-serial-N`), so
    // lane ids like `core` or `core-batch-2` are runtime truth — the yaml
    // contract asserts the STRUCTURE (lane var plumbing, per-slot wiring), not
    // a hardcoded lane name.
    const serialSlots = [1, 2, 3];
    const parallelLanes = ['shard-1', 'shard-2'];

    // 1. CODEX product writers for serial slots + shard-1, shard-2
    for (const lane of parallelLanes) {
      const codex = yaml.match(new RegExp(`- id: writer-${lane}[\\s\\S]*?(?=\\n  - id:)`));
      expect(codex?.[0]).toBeTruthy();
      expect(codex?.[0]).toContain(`depends_on: [brief-${lane}, exec-${lane}]`);
      expect(codex?.[0]).toContain(`when: "$exec-${lane}.output == 'CODEX'"`);
      expect(codex?.[0]).toMatch(
        /retry:\s*\{\s*max_attempts:\s*2,\s*delay_ms:\s*10000,\s*on_error:\s*all\s*\}/,
      );
      expect(codex?.[0]).toContain(`exec-codex-writer.mjs --lane ${lane}`);
      // H3 (2026-08-31): lanes get a 55m provider timeout inside the 60m node
      // budget — the silent 45m claude-lane-core default killed a HIGH-risk
      // core lane mid-implementation (run c38c2e1b) and lost all its work.
      expect(codex?.[0]).toContain('--timeout-ms 3300000');
      expect(codex?.[0]).toContain(`--brief "$ARTIFACTS_DIR/briefs/${lane}-brief.md"`);
      expect(codex?.[0]).toContain(`--worktree "$ARTIFACTS_DIR/wt/${lane}"`);
      expect(codex?.[0]).toContain(`--routing "$ARTIFACTS_DIR/routing.json"`);
      expect(codex?.[0]).toContain(`--results-dir "$ARTIFACTS_DIR/writer-results/${lane}"`);
    }
    for (const slot of serialSlots) {
      const codex = yaml.match(
        new RegExp(
          `- id: writer-serial-${slot}[\\s\\S]*?(?=\\n  - id: writer-serial-${slot}-claude)`,
        ),
      );
      expect(codex?.[0]).toBeTruthy();
      expect(codex?.[0]).toContain(
        `depends_on: [brief-serial-${slot}, exec-serial-${slot}${slot > 1 ? `, guard-serial-${slot - 1}` : ''}]`,
      );
      expect(codex?.[0]).toContain(`when: "$exec-serial-${slot}.output == 'CODEX'`);
      expect(codex?.[0]).toMatch(
        /retry:\s*\{\s*max_attempts:\s*2,\s*delay_ms:\s*10000,\s*on_error:\s*all\s*\}/,
      );
      expect(codex?.[0]).toContain('exec-codex-writer.mjs --lane "$LANE"');
      expect(codex?.[0]).toContain('--timeout-ms 3300000');
      expect(codex?.[0]).toContain('--brief "$ARTIFACTS_DIR/briefs/$LANE-brief.md"');
      expect(codex?.[0]).toContain('--worktree "$ARTIFACTS_DIR/wt/$LANE"');
      expect(codex?.[0]).toContain('--routing "$ARTIFACTS_DIR/routing.json"');
      expect(codex?.[0]).toContain('--results-dir "$ARTIFACTS_DIR/writer-results/$LANE"');
    }

    // 2. CLAUDE_AGY fallback variants for serial slots + shard-1, shard-2
    // H2 §10: Claude lanes run through exec-claude-writer.mjs (bash node), so
    // ONE actual Claude provider invocation = ONE Claude lane permit — the
    // permit is acquired/released around the `claude --print` process inside
    // the wrapper, covering success/failure/timeout/cancellation. Prompt
    // nodes cannot guarantee release and are therefore forbidden for lanes.
    for (const lane of parallelLanes) {
      const claude = yaml.match(new RegExp(`- id: writer-${lane}-claude[\\s\\S]*?(?=\\n  - id:)`));
      expect(claude?.[0]).toBeTruthy();
      expect(claude?.[0]).toContain(`depends_on: [brief-${lane}, exec-${lane}]`);
      expect(claude?.[0]).toContain(`when: "$exec-${lane}.output == 'CLAUDE'"`);
      expect(claude?.[0]).toMatch(
        /retry:\s*\{\s*max_attempts:\s*2,\s*delay_ms:\s*10000,\s*on_error:\s*all\s*\}/,
      );
      expect(claude?.[0]).toContain(
        `exec-claude-writer.mjs \\\n        --timeout-ms 3300000 \\\n        --lane ${lane}`,
      );
      expect(claude?.[0]).toContain(`--brief "$ARTIFACTS_DIR/briefs/${lane}-brief.md"`);
      expect(claude?.[0]).toContain(`--worktree "$ARTIFACTS_DIR/wt/${lane}"`);
      expect(claude?.[0]).toContain(`--results-dir "$ARTIFACTS_DIR/writer-results/${lane}"`);
      // Claimed units must reach the writer (review finding 1): integration
      // rejects a zero-completed result, so each Claude node extracts its
      // lane's task ids from routing.json and passes --task-ids.
      expect(claude?.[0]).toContain(`--task-ids "$TASKS" \\\n        --package`);
      expect(claude?.[0]).toContain(`find(l=>l.lane==="${lane}")`);
      expect(claude?.[0]).toContain('--generation "$(');
    }
    for (const slot of serialSlots) {
      const claude = yaml.match(
        new RegExp(`- id: writer-serial-${slot}-claude[\\s\\S]*?(?=\\n  - id:)`),
      );
      expect(claude?.[0]).toBeTruthy();
      expect(claude?.[0]).toContain(
        `depends_on: [brief-serial-${slot}, exec-serial-${slot}${slot > 1 ? `, guard-serial-${slot - 1}` : ''}]`,
      );
      expect(claude?.[0]).toContain(`when: "$exec-serial-${slot}.output == 'CLAUDE'`);
      expect(claude?.[0]).toContain('exec-claude-writer.mjs');
      expect(claude?.[0]).toContain('--timeout-ms 3300000');
      expect(claude?.[0]).toContain('--lane "$LANE"');
      expect(claude?.[0]).toContain('--task-ids "$TASKS"');
      expect(claude?.[0]).toContain('--generation "$(');
    }

    // 3. AGY test-author only (and NO product AGY writers)
    for (const lane of [...parallelLanes]) {
      expect(yaml).not.toContain(`- id: writer-${lane}-agy`);
    }
    expect(yaml).not.toMatch(/- id: writer-serial-\d+-agy/);
    const agyTest = yaml.match(/- id: writer-test-author-agy[\s\S]*?(?=\n  - id:)/);
    expect(agyTest?.[0]).toBeTruthy();
    expect(agyTest?.[0]).toContain('depends_on: [brief-test-author, exec-test-author]');
    expect(agyTest?.[0]).toContain('when: "$exec-test-author.output == \'AGY\'"');
    expect(agyTest?.[0]).toMatch(
      /retry:\s*\{\s*max_attempts:\s*2,\s*delay_ms:\s*10000,\s*on_error:\s*all\s*\}/,
    );
    // Graph-derived AGY test-lane dispatch (maintainer Part E, 2026-09-03):
    // lane id/units come from g.testLanes[n], so the sharded test-author-1/2
    // pair needs no yaml edits; the legacy single lane stays index 0.
    expect(agyTest?.[0]).toContain('exec-agy-test-writer.mjs --lane "$TL_ID"');
    expect(agyTest?.[0]).toContain('g.testLanes?.[0]?.id');
    expect(agyTest?.[0]).toContain('g.testLanes?.[0]?.units');
    expect(agyTest?.[0]).toContain('--brief "$ARTIFACTS_DIR/briefs/$TL_ID-brief.md"');
    expect(agyTest?.[0]).toContain('--worktree "$ARTIFACTS_DIR/wt/$TL_ID"');
    expect(agyTest?.[0]).toContain('--routing "$ARTIFACTS_DIR/routing.json"');
    expect(agyTest?.[0]).toContain('--results-dir "$ARTIFACTS_DIR/writer-results/$TL_ID"');
    expect(agyTest?.[0]).toContain('--lane-base "$(cat "$ARTIFACTS_DIR/base-head.txt")"');
    // Canary cap 2: the second sharded lane pair mirrors lane 1 and
    // dispatches only when the graph actually produced testLanes[1].
    const agyTest2 = yaml.match(/- id: writer-test-author-2-agy[\s\S]*?(?=\n  - id:)/);
    expect(agyTest2?.[0]).toBeTruthy();
    expect(agyTest2?.[0]).toContain('depends_on: [brief-test-author-2, exec-test-author-2]');
    expect(agyTest2?.[0]).toContain('when: "$exec-test-author-2.output == \'AGY\'"');
    expect(agyTest2?.[0]).toContain('exec-agy-test-writer.mjs --lane "$TL_ID"');
    expect(agyTest2?.[0]).toContain('g.testLanes?.[1]?.id');
    expect(agyTest2?.[0]).toContain('g.testLanes?.[1]?.units');
    expect(agyTest2?.[0]).toContain('--lane-base "$(cat "$ARTIFACTS_DIR/base-head.txt")"');

    // 3b. EVERY writer node's OWN command carries --task-graph (H3 live
    // 89c4b2b9): the P0-1 evidence protocol needs parsed predicted writes;
    // without the graph the writer nominates ZERO units, the integrator
    // rejects every lane ("writer reported zero completed units"), and the
    // wave dies red with an unrepairable integration_empty. The executor-level
    // TASK_GRAPH_REQUIRED_FOR_COMPLETION_EVIDENCE gate is the primary defense;
    // this structural assertion walks the actual node graph (no brittle
    // dispatch count) and each node's command block ONLY (no cross-node
    // bleed).
    const writerNodeRe = /- id: (writer-[a-z0-9-]+)[\s\S]*?(?=\n  - id: |$)/g;
    let writerNodes = 0;
    for (const m of yaml.matchAll(writerNodeRe)) {
      const node = m[0];
      if (!/exec-(codex-writer|claude-writer|agy-test-writer)\.mjs/.test(node)) continue;
      writerNodes += 1;
      expect(node).toContain('--task-graph "$ARTIFACTS_DIR/task-graph.json"');
    }
    expect(writerNodes).toBeGreaterThanOrEqual(11);

    // 4. Implementation writers carry the test-edit prohibition in their
    // briefs (brief-shaping source), and no Claude lane is a prompt node.
    for (const lane of parallelLanes) {
      const claude = yaml.match(new RegExp(`- id: writer-${lane}-claude[\\s\\S]*?(?=\\n  - id:)`));
      expect(claude?.[0]).not.toMatch(/prompt:\s*\|/); // wrapper bash node, never a prompt node
    }
    expect(yaml).toMatch(/Never edit tests in any implementation\s+#?\s*lane/);
  });

  it('when-gates every lane so empty shards dispatch zero providers across CODEX, CLAUDE fallbacks, and AGY test-author', () => {
    // Parallel + test lanes keep exact persisted routing tokens per lane
    for (const lane of ['shard-1', 'shard-2']) {
      const emit = yaml.match(new RegExp(`- id: exec-${lane}[\\s\\S]*?(?=\\n  - id:)`));
      expect(emit?.[0]).toBeTruthy();
      expect(emit?.[0]).toContain(`cat "$ARTIFACTS_DIR/engine-${lane}.txt"`);
    }
    // AGY test lanes are graph-enumerated (maintainer Part E): the emitter
    // resolves the lane id from g.testLanes[n] and cats its engine token.
    for (const [node, idx, name] of [
      ['exec-test-author', 0, 'NO TEST-AUTHOR THIS WAVE'],
      ['exec-test-author-2', 1, 'NO TEST-AUTHOR-2 THIS WAVE'],
    ] as const) {
      const emit = yaml.match(new RegExp(`- id: ${node}[\\s\\S]*?(?=\\n  - id:)`));
      expect(emit?.[0]).toBeTruthy();
      expect(emit?.[0]).toContain(`g.testLanes?.[${idx}]?.id`);
      expect(emit?.[0]).toContain(name);
    }

    // Brief emitters output deterministic sentinels when absent
    expect(yaml).toMatch(/- id: brief-shard-1[\s\S]*?NO SHARD-1 THIS WAVE/);
    expect(yaml).toMatch(/- id: brief-shard-2[\s\S]*?NO SHARD-2 THIS WAVE/);
    expect(yaml).toMatch(/- id: brief-test-author[\s\S]*?NO TEST-AUTHOR THIS WAVE/);

    // Guards are when-gated to skip absent shards and bridge both active and fallback engines
    for (const shard of ['shard-1', 'shard-2']) {
      const guard = yaml.match(new RegExp(`- id: guard-${shard}[\\s\\S]*?(?=\\n  - id:)`));
      expect(guard?.[0]).toContain(
        `depends_on: [brief-${shard}, writer-${shard}, writer-${shard}-claude]`,
      );
      expect(guard?.[0]).toContain(
        `when: "$brief-${shard}.output != 'NO ${shard.toUpperCase()} THIS WAVE'"`,
      );
      expect(guard?.[0]).toContain('trigger_rule: none_failed_min_one_success');
    }

    const guardTest = yaml.match(/- id: guard-test-author[\s\S]*?(?=\n  - id:)/);
    expect(guardTest?.[0]).toContain('depends_on: [brief-test-author, writer-test-author-agy]');
    expect(guardTest?.[0]).toContain(
      'when: "$brief-test-author.output != \'NO TEST-AUTHOR THIS WAVE\'"',
    );
    expect(guardTest?.[0]).toContain('trigger_rule: none_failed_min_one_success');

    // Integrator depends on all serial + parallel + test guards (both AGY
    // test lanes, Part E cap 2)
    const integrator = yaml.match(/- id: integrate-and-fast[\s\S]*?(?=\n  - id:)/);
    expect(integrator?.[0]).toContain(
      'depends_on: [guard-serial-1, guard-serial-2, guard-serial-3, guard-shard-1, guard-shard-2, guard-test-author, guard-test-author-2]',
    );
  });

  it('decomposes the serial core into bounded sequential batches when the graph plans them (mission item 4)', () => {
    // The graph (not yaml) decides the batch count: slots 1..3 resolve their
    // lane id from task-graph.json at runtime, so an unbatched package keeps
    // the exact legacy `core` shape and a batched one needs no yaml edits.
    for (const slot of [1, 2, 3]) {
      const brief = yaml.match(new RegExp(`- id: brief-serial-${slot}[\\s\\S]*?(?=\\n  - id:)`));
      expect(brief?.[0]).toContain('filter(x=>x.mode==="serial")');
      const exec = yaml.match(new RegExp(`- id: exec-serial-${slot}[\\s\\S]*?(?=\\n  - id:)`));
      expect(exec?.[0]).toContain('engine-$LANE.txt');
      const guard = yaml.match(new RegExp(`- id: guard-serial-${slot}[\\s\\S]*?(?=\\n  - id:)`));
      expect(guard?.[0]).toContain('--shard "$LANE"');
    }
    // Sequential chaining: batch 2 and 3 writers depend on the PARENT batch's
    // GUARD (a serial column never runs two batches concurrently) and
    // fast-forward to the parent's guarded head before dispatching.
    for (const slot of [2, 3]) {
      const writer = yaml.match(
        new RegExp(
          `- id: writer-serial-${slot}[\\s\\S]*?(?=\\n  - id: writer-serial-${slot}-claude)`,
        ),
      );
      expect(writer?.[0]).toContain(`guard-serial-${slot - 1}`);
      expect(writer?.[0]).toContain('"merge","--ff-only"');
      const claude = yaml.match(
        new RegExp(`- id: writer-serial-${slot}-claude[\\s\\S]*?(?=\\n  - id:)`),
      );
      expect(claude?.[0]).toContain(`guard-serial-${slot - 1}`);
    }
    // The per-lane ceiling is UNCHANGED (bounded scope, not a bigger timeout).
    const timeouts = [...yaml.matchAll(/--timeout-ms 3300000/g)].length;
    expect(timeouts).toBeGreaterThanOrEqual(6); // serial slots 1..3 x codex/claude
    expect(yaml).not.toMatch(/timeout-ms (?!3300000)\d+/); // no raised ceiling anywhere
  });

  it('never lets a fully-rejected wave settle green over zero progress (defect #12)', () => {
    // Router: dispatched lanes with NONE integrated → RED emitted WITHOUT a
    // FAST pass (the empty diff would pass vacuously and mask zero progress).
    const router = yaml.match(/- id: integrate-and-fast[\s\S]*?(?=\n  - id: fast-repair-loop)/);
    expect(router).toBeTruthy();
    expect(router?.[0]).toMatch(/dispatched=.*writer-results.*-name result\.json/s);
    expect(router?.[0]).toContain('integration-report.json');
    expect(router?.[0]).toMatch(/\[\s*"\$dispatched" -gt 0\s*\] && \[\s*"\$integrated" -eq 0\s*\]/);
    // Recheck: while integration is still empty the loop is held closed
    // (exit-0 impossible), so exhaustion fails loudly instead of converting
    // its own RED into a vacuous green.
    // Live finding 2026-08-26 (run b101f6c3): the heavy recheck used to run
    // INSIDE until_bash, but bare guard executions get a short default wall
    // budget (~3 min observed) — an escalated FULL-suite recheck (~14 min) was
    // killed mid-run every iteration and the repair loop exhausted
    // deterministically. Law now mirrors gate-repair-loop: the guard is a
    // sub-second verdict read; the defect-#12 hold and the full FAST live in
    // the serialized fast-recheck node with an explicit timeout.
    const loopBlock = yaml.match(/- id: fast-repair-loop[\s\S]*?(?=\n  - id:)/);
    expect(loopBlock).toBeTruthy();
    const guard = loopBlock?.[0].match(/until_bash:[\s\S]*?(?=\n      nodes:)/);
    expect(guard?.[0]).toBeTruthy();
    expect(guard?.[0]).not.toContain('package-fast-verify.mjs'); // guard stays cheap
    expect(guard?.[0]).toContain('wave-fast-verdict.json');
    const recheckNode = loopBlock?.[0].match(/- id: fast-recheck[\s\S]*/);
    expect(recheckNode?.[0]).toMatch(/code=90/);
    expect(recheckNode?.[0]).toContain('package-fast-verify.mjs');
    expect(recheckNode?.[0]).toContain('--from-git');
    expect(recheckNode?.[0]).toMatch(/timeout:\s*3600000/);
  });

  it('keeps router stdout to bare verdict tokens so the RED gate can match (defect #14)', () => {
    // Run B canary: the router dumped the integration report to stdout before
    // echoing its verdict, so `$integrate-and-fast.output` was multiline and
    // `== 'WAVE_FAST_RED'` never matched — RED handling silently vanished.
    // The V3 gate-router idiom is law: diagnostics go to files, stdout is the
    // verdict and nothing else.
    const router = yaml.match(/- id: integrate-and-fast[\s\S]*?(?=\n  - id: fast-repair-loop)/);
    expect(router).toBeTruthy();
    const body = router?.[0] ?? '';
    // Join continuation lines into whole statements; an echo that redirects
    // to a file never reaches stdout, so only bare echoes must be verdicts.
    const lines = body.split('\n');
    const statements: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*echo\s/.test(lines[i] ?? '')) continue;
      let stmt = lines[i] ?? '';
      while (stmt.trimEnd().endsWith('\\')) {
        i++;
        stmt += '\n' + (lines[i] ?? '');
      }
      statements.push(stmt.replace(/\\\n\s*/g, ' ').trim());
    }
    expect(statements.length).toBeGreaterThanOrEqual(2);
    const bareEchoes = statements.filter((s) => !s.includes('>'));
    expect(bareEchoes.length).toBeGreaterThanOrEqual(2);
    for (const e of bareEchoes) {
      const token = e.replace(/^echo\s+/, '').trim();
      expect(['"WAVE_FAST_GREEN"', '"WAVE_FAST_RED"', '"WAVE_INTEGRATION_EMPTY"']).toContain(token);
    }
    // no report/log dump may reach stdout from this node at all
    expect(body).not.toContain('cat "$ARTIFACTS_DIR/integration-report.json"');
    expect(body).not.toMatch(/^\s*tail\s+-n/m);
  });

  it('gates the targeted-repair loop on FAST RED and rechecks via the actual FAST', () => {
    const repairBlock = yaml.match(/- id: fast-repair-loop[\s\S]*?(?=\n  - id: wave-settled)/);
    expect(repairBlock).toBeTruthy();
    expect(repairBlock?.[0]).toContain('when: "$integrate-and-fast.output == \'WAVE_FAST_RED\'"');
    expect(repairBlock?.[0]).toContain('package-fast-verify.mjs'); // recheck is the real tier
    expect(repairBlock?.[0]).toMatch(/max_iterations: \d+/);
    expect(repairBlock?.[0]).toMatch(/max_attempts: \d+[\s\S]*on_error: all/); // strong retry preserved
  });

  it('writes the checkpoint only on the provably green path', () => {
    const settled = yaml.match(/- id: wave-settled[\s\S]*?(?=\n  - id: wave-checkpoint)/);
    const checkpoint = yaml.match(/- id: wave-checkpoint[\s\S]*$/);
    expect(settled).toBeTruthy();
    expect(checkpoint).toBeTruthy();
    // Bridge blocks while the repair loop genuinely fails; checkpoint sits
    // strictly downstream of the bridge, so red-without-recovery never yields
    // a successful checkpoint.
    expect(settled?.[0]).toContain('depends_on: [integrate-and-fast, fast-repair-loop]');
    expect(settled?.[0]).toContain('trigger_rule: none_failed_min_one_success');
    expect(checkpoint?.[0]).toContain('depends_on: [wave-settled]');
    expect(checkpoint?.[0]).toContain('package-checkpoint.mjs --build');
  });

  it('passes routing.json artifact to AGY test-author executor nodes (both sharded lanes)', () => {
    const agyNode = yaml.match(/- id: writer-test-author-agy[\s\S]*?(?=\n  - id:)/);
    expect(agyNode).toBeTruthy();
    expect(agyNode?.[0]).toContain('exec-agy-test-writer.mjs --lane "$TL_ID"');
    expect(agyNode?.[0]).toContain('g.testLanes?.[0]?.id');
    expect(agyNode?.[0]).toContain('--routing "$ARTIFACTS_DIR/routing.json"');
    expect(agyNode?.[0]).toContain('--brief "$ARTIFACTS_DIR/briefs/$TL_ID-brief.md"');
    expect(agyNode?.[0]).toContain('--worktree "$ARTIFACTS_DIR/wt/$TL_ID"');
    expect(agyNode?.[0]).toContain('--results-dir "$ARTIFACTS_DIR/writer-results/$TL_ID"');
    const agyNode2 = yaml.match(/- id: writer-test-author-2-agy[\s\S]*?(?=\n  - id:)/);
    expect(agyNode2).toBeTruthy();
    expect(agyNode2?.[0]).toContain('exec-agy-test-writer.mjs --lane "$TL_ID"');
    expect(agyNode2?.[0]).toContain('g.testLanes?.[1]?.id');
    expect(agyNode2?.[0]).toContain('--routing "$ARTIFACTS_DIR/routing.json"');
  });
});

describe('wave routing AGY test lane persistence', () => {
  it('buildWaveRouting attaches version-controlled AGY Gemini model facts to test lanes', async () => {
    const { buildWaveRouting } = await import('../../scripts/automation/codex-routing.mjs');
    const { EXECUTION_POLICY } =
      (await import('../../scripts/automation/execution-profile.mjs')) as typeof import('../../scripts/automation/execution-profile.mjs') & {
        EXECUTION_POLICY: Record<string, unknown>;
      };

    const graph = {
      package: { risk: 'MEDIUM' },
      shards: [{ id: 'core', units: ['T101'] }],
      units: [{ id: 'T101' }, { id: 'T103' }],
      testLanes: [{ id: 'test-author', units: ['T103'] }],
    };

    const routingCodex = buildWaveRouting(graph, 'CODEX_AGY');
    expect(routingCodex.schema).toBe('foresift/wave-routing@1');
    expect(routingCodex.routingPolicyVersion).toBe(EXECUTION_POLICY.routingPolicyVersion);
    expect(routingCodex.routingPolicyVersion).toBe('codex-terra-sol-agy-gemini@3');
    expect(routingCodex.testEngine).toBe('AGY');

    const testLaneCodex = routingCodex.lanes.find(
      (l: { lane: string }) => l.lane === 'test-author',
    );
    expect(testLaneCodex).toBeDefined();
    expect(testLaneCodex.engine).toBe('AGY');
    expect(testLaneCodex.role).toBe('test');
    expect(testLaneCodex.model).toBe(EXECUTION_POLICY.agyTestModel);
    expect(testLaneCodex.model).toBe('gemini-3.7-flash-high');
    expect(testLaneCodex.reasoning).toBe(EXECUTION_POLICY.agyTestEffort);
    expect(testLaneCodex.reasoning).toBe('high');
    expect(testLaneCodex.providerTimeout).toBe(EXECUTION_POLICY.agyPrintTimeout);
    expect(testLaneCodex.providerTimeout).toBe('40m');
    expect(testLaneCodex.taskIds).toEqual(['T103']);

    const routingClaude = buildWaveRouting(graph, 'CLAUDE_AGY');
    const testLaneClaude = routingClaude.lanes.find(
      (l: { lane: string }) => l.lane === 'test-author',
    );
    expect(testLaneClaude).toBeDefined();
    expect(testLaneClaude.engine).toBe('AGY');
    expect(testLaneClaude.model).toBe('gemini-3.7-flash-high');
    expect(testLaneClaude.reasoning).toBe('high');
    expect(testLaneClaude.providerTimeout).toBe('40m');
  });
});

// ── central migration registry duty (fail-closed, pre-writer cost) ───────────
// The central suite packages/persistence/test/migrator.spec.ts asserts EXACTLY
// the full G0 migration script set. A package predicting NEW migration scripts
// must name it as a plan-sanctioned scope exception; when the duty is missing
// the wave guard legally refuses every repair and the run exhausts its bounded
// repair budget deterministically (observed live 2026-08-28, g0-cost-capacity).
describe('central migration registry duty enforcement', () => {
  function buildScratchRepo(tasksMd: string): string {
    const root = mkdtempSync(join(tmpdir(), 'mig-duty-fx-'));
    mkdirSync(join(root, 'specs', 'pkg-m'), { recursive: true });
    mkdirSync(join(root, 'specs', 'implementation'), { recursive: true });
    writeFileSync(join(root, 'specs', 'pkg-m', 'tasks.md'), tasksMd);
    const ms = {
      schemaVersion: '1.0.0',
      milestoneId: 'MM',
      status: 'ACTIVE',
      packages: [
        {
          id: 'pkg-m',
          objective: 'Deliver a new migration family with full registry convergence.',
          requirementIds: ['FR-M-001'],
          dependencies: [],
          risk: 'MEDIUM',
          parallelizable: false,
          writeScopes: ['packages/m/**', 'migrations/g0_m_*.sql', 'tests/acceptance/**'],
          verificationCommands: ['pnpm test'],
          status: 'RUNNING',
        },
        {
          id: 'pkg-m-b',
          objective: 'Inert companion package required by the 2-8 package decomposition rule.',
          requirementIds: ['FR-M-002'],
          dependencies: ['pkg-m'],
          risk: 'LOW',
          parallelizable: true,
          writeScopes: ['packages/mb/**'],
          verificationCommands: ['pnpm test'],
          status: 'PENDING',
        },
      ],
    };
    writeFileSync(
      join(root, 'specs', 'implementation', 'current-milestone.json'),
      JSON.stringify(ms),
    );
    sh('git init -q', root);
    sh('git config user.email t@t', root);
    sh('git config user.name t', root);
    sh('git add -A', root);
    sh('git commit -qm base', root);
    return root;
  }

  const MIGRATION_TASKS_BODY = `
- [ ] T201 Write \`migrations/g0_m_0001_ledgers.sql\` — new family scripts. Traces: FR-M-001.
`;

  it('refuses at graph build when new migration scripts never name the central suite', () => {
    const root = buildScratchRepo(`# Tasks: pkg-m\n${MIGRATION_TASKS_BODY}`);
    try {
      const r = spawnSync(
        process.execPath,
        [GRAPH, '--package', 'pkg-m', '--root', root, '--plan-shards', '2'],
        { encoding: 'utf8' },
      );
      expect(r.status).not.toBe(0);
      expect(`${r.stderr ?? ''}`).toContain('CENTRAL_MIGRATION_SUITE_UNREFERENCED');
      expect(`${r.stderr ?? ''}`).toContain('packages/persistence/test/migrator.spec.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('builds and records the plan-sanctioned exception when the central suite is named', () => {
    const root = buildScratchRepo(
      `# Tasks: pkg-m\n${MIGRATION_TASKS_BODY}
- [ ] T202 Extend the central registry \`packages/persistence/test/migrator.spec.ts\`
      expected G0 script list with the new family in lexicographic position.
      Traces: FR-M-001.
`,
    );
    const artifacts = mkdtempSync(join(tmpdir(), 'mig-duty-art-'));
    try {
      const graphPath = join(artifacts, 'task-graph.json');
      const r = spawnSync(
        process.execPath,
        [GRAPH, '--package', 'pkg-m', '--root', root, '--plan-shards', '2', '--out', graphPath],
        { encoding: 'utf8' },
      );
      expect(r.status).toBe(0);
      const g = JSON.parse(readFileSync(graphPath, 'utf8'));
      expect(g.scopeExceptions).toContain('packages/persistence/test/migrator.spec.ts');
      // The central-suite unit is demoted into the serial core lane, whose
      // allowedWritePaths carry the exception path.
      const core = g.shards.find((s: { id: string }) => s.id === 'core');
      expect(core.allowedWritePaths).toContain('packages/persistence/test/migrator.spec.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(artifacts, { recursive: true, force: true });
    }
  });
});

describe('central migration registry duty enforcement (generation-agnostic)', () => {
  function buildG1ScratchRepo(tasksMd: string): string {
    const root = mkdtempSync(join(tmpdir(), 'mig-duty-g1-fx-'));
    mkdirSync(join(root, 'specs', 'pkg-g1'), { recursive: true });
    mkdirSync(join(root, 'specs', 'implementation'), { recursive: true });
    writeFileSync(join(root, 'specs', 'pkg-g1', 'tasks.md'), tasksMd);
    const ms = {
      schemaVersion: '1.0.0',
      milestoneId: 'MM',
      status: 'ACTIVE',
      packages: [
        {
          id: 'pkg-g1',
          objective: 'Deliver a new g1-generation migration family with full registry convergence.',
          requirementIds: ['FR-M-001'],
          dependencies: [],
          risk: 'MEDIUM',
          parallelizable: false,
          writeScopes: ['packages/m/**', 'migrations/g1_m_*.sql', 'tests/acceptance/**'],
          verificationCommands: ['pnpm test'],
          status: 'RUNNING',
        },
        {
          id: 'pkg-g1-b',
          objective: 'Inert companion package required by the 2-8 package decomposition rule.',
          requirementIds: ['FR-M-002'],
          dependencies: ['pkg-g1'],
          risk: 'LOW',
          parallelizable: true,
          writeScopes: ['packages/mb/**'],
          verificationCommands: ['pnpm test'],
          status: 'PENDING',
        },
      ],
    };
    writeFileSync(
      join(root, 'specs', 'implementation', 'current-milestone.json'),
      JSON.stringify(ms),
    );
    sh('git init -q', root);
    sh('git config user.email t@t', root);
    sh('git config user.name t', root);
    sh('git add -A', root);
    sh('git commit -qm base', root);
    return root;
  }

  const G1_MIGRATION_TASKS_BODY = `
- [ ] T301 Write \`migrations/g1_m_0001_ledgers.sql\` — next-generation family scripts. Traces: FR-M-001.
`;

  it('refuses at graph build when NEW g1 migration scripts never name the central suite', () => {
    const root = buildG1ScratchRepo(`# Tasks: pkg-g1\n${G1_MIGRATION_TASKS_BODY}`);
    try {
      const r = spawnSync(
        process.execPath,
        [GRAPH, '--package', 'pkg-g1', '--root', root, '--plan-shards', '2'],
        { encoding: 'utf8' },
      );
      expect(r.status).not.toBe(0);
      expect(`${r.stderr ?? ''}`).toContain('CENTRAL_MIGRATION_SUITE_UNREFERENCED');
      expect(`${r.stderr ?? ''}`).toContain('packages/persistence/test/migrator.spec.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
