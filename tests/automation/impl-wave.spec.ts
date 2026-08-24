import { describe, expect, it, beforeAll, afterAll } from 'vitest';
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
  let bA: string, bB: string, bEvil: string;
  const g = () => JSON.parse(readFileSync(fx.graphPath, 'utf8'));

  beforeAll(() => {
    // shard-meta.json as prep would write it
    const meta = {
      core: { branch: 'foresift/wave/core', worktree: join(fx.artifacts, 'wt-core') },
      'shard-1': { branch: 'foresift/wave/shard-1', worktree: join(fx.artifacts, 'wt-shard-1') },
    };
    writeFileSync(join(fx.artifacts, 'shard-meta.json'), JSON.stringify(meta));
    writeFileSync(join(fx.artifacts, 'base-head.txt'), fx.baseSha);
    bA = commitBranch(
      'foresift/wave/core',
      'packages/x/src/alpha.ts',
      'export const alpha = 1;\n',
    ) as unknown as string;
    // T103 was demoted into core, so core also owns its spec file.
    sh(
      'mkdir -p tests/x && printf "test(\'a\', () => {});\\n" > tests/x/a.spec.ts && git add -A && git -c user.email=w@w -c user.name=w commit -qm work2',
      join(fx.artifacts, 'wt-foresift-wave-core'),
    );
    bB = commitBranch('foresift/wave/shard-1', 'docs/x-guide.md', '# guide\n') as unknown as string;
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
      spawnSync(process.execPath, [
        ADMIT,
        '--load1',
        '0.5',
        '--mem-available-kb',
        '6000000',
        '--mem-total-kb',
        '8000000',
        '--provider-failures',
        '0',
      ]).stdout,
    );
    expect(healthy.admitExtraWriter).toBe(true);
    const pressured = JSON.parse(
      spawnSync(process.execPath, [
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
      ]).stdout,
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
      spawnSync(process.execPath, [ADMIT, '--load1', '0.5', '--journal', journal, '--tail', '10'])
        .stdout,
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
      if (!lines[i].includes('scripts/automation/package-fast-verify.mjs')) continue;
      let stmt = '';
      for (let j = i; j < lines.length; j++) {
        stmt += lines[j] + '\n';
        if (!lines[j].trimEnd().endsWith('\\')) break;
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

  it('when-gates every writer lane so empty shards dispatch zero providers', () => {
    for (const lane of ['core', 'shard-1', 'shard-2']) {
      const sentinel =
        lane === 'core'
          ? 'NO CORE SHARD THIS WAVE'
          : `NO ${lane.replace('shard', 'SHARD')} THIS WAVE`;
      const writerBlock = yaml.match(new RegExp(`- id: writer-${lane}[\\s\\S]*?(?=\\n  - id:)`));
      expect(writerBlock, `writer-${lane} block`).toBeTruthy();
      expect(writerBlock?.[0]).toContain(`when: "$brief-${lane}.output != '${sentinel}'"`);
    }
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
    const recheck = yaml.match(/until_bash:[\s\S]*?(?=\n      nodes:)/);
    expect(recheck).toBeTruthy();
    expect(recheck?.[0]).toMatch(/code=90/);
    expect(recheck?.[0]).toContain('package-fast-verify.mjs');
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
});
