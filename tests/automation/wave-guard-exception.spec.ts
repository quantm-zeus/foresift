// Hyperdrive H2 — cross-lane scope-exception regression (live defect, runs
// 831d0819/99e8e23b, 2026-08-30): a plan-sanctioned scope exception (the
// central migration registry `packages/persistence/test/migrator.spec.ts`)
// appears in the allowedWritePaths of BOTH the implementation core shard (as
// an outOfScopeWrites exception) and the test-author lane (as testWrites).
// The wave-guard's cross-lane ownership clause treated the test lane's legal
// write as an "othersPredicted" violation, so EVERY restart of that package
// failed deterministically at guard-test-author with WRITE-AUTHORITY
// VIOLATION — a plan-induced self-collision, not writer misbehavior.
//
// Law under test: cross-lane exclusion must never fire on a graph-recorded
// scope exception; both the guard and the integrator admit exception paths
// on every side of the pairwise exclusion.
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const GUARD = join(repoRoot, 'scripts', 'automation', 'wave-guard.mjs');

// Build a hermetic git fixture whose graph carries the exact live shape:
// core shard (implementation, serial) holding migrator.spec.ts + migrator.ts
// as outOfScopeWrites-derived allowedWritePaths; test-author lane ALSO
// carrying migrator.spec.ts in allowedWritePaths; path recorded in
// graph.scopeExceptions.
function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'guard-exc-fx-'));
  const run = (cmd: string) => {
    const r = spawnSync(cmd, { shell: true, cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`fixture cmd failed: ${cmd}: ${r.stderr ?? r.stdout}`);
    return (r.stdout ?? '').trim();
  };
  run('git init -q');
  run('git config user.email t@t && git config user.name t');
  mkdirSync(join(root, 'packages/persistence/src'), { recursive: true });
  writeFileSync(join(root, 'packages/persistence/src/migrator.ts'), 'export const base = 1;\n');
  run('git add -A && git commit -qm base');
  const baseSha = run('git rev-parse HEAD');
  // Worktree-scoped runner: git commands inside a linked worktree must run
  // with cwd=worktree, or they silently act on the main repo instead.
  const runWt = (cmd: string, wt: string) => {
    const r = spawnSync(cmd, { shell: true, cwd: wt, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`wt cmd failed (${cmd}): ${r.stderr ?? r.stdout}`);
    return (r.stdout ?? '').trim();
  };
  return { root, baseSha, run, runWt };
}

function writeGraph(root: string, artifacts: string, baseSha: string) {
  const graph = {
    schema: 'foresift/impl-task-graph@1',
    package: {
      id: 'pkg-mcp',
      risk: 'HIGH',
      writeScopes: ['packages/mcp/**', 'migrations/g0_mcp_*.sql'],
    },
    bound: { mainHeadSha: baseSha, tasksFile: join(root, 'specs/pkg-mcp/tasks.md') },
    totals: { units: 2, done: 0, open: 2, openParallelizable: 0 },
    units: [
      {
        id: 'T001',
        done: false,
        parallelizable: false,
        phase: 'Phase 1',
        body: 'migrations',
        requirements: [],
        acceptanceCriteria: [],
        predictedWrites: ['migrations/g0_mcp_0001.sql'],
        productWrites: ['migrations/g0_mcp_0001.sql'],
        testWrites: [],
        testOnly: false,
        productWork: true,
        outOfScopeWrites: [
          'packages/persistence/src/migrator.ts',
          'packages/persistence/test/migrator.spec.ts',
        ],
        testRefs: [],
        dependsOn: [],
        estimatedSize: 'medium',
      },
      {
        id: 'T002',
        done: false,
        parallelizable: true,
        phase: 'Phase 6',
        body: 'registry tests',
        requirements: [],
        acceptanceCriteria: [],
        predictedWrites: [],
        productWrites: [],
        testWrites: ['packages/persistence/test/migrator.spec.ts'],
        testOnly: true,
        productWork: false,
        outOfScopeWrites: ['packages/persistence/test/migrator.spec.ts'],
        testRefs: ['packages/persistence/test/migrator.spec.ts'],
        dependsOn: [],
        estimatedSize: 'small',
      },
    ],
    shards: [
      {
        id: 'core',
        mode: 'serial',
        role: 'implementation',
        engine: 'CODEX',
        units: ['T001'],
        allowedWritePaths: [
          'migrations/g0_mcp_0001.sql',
          'packages/persistence/src/migrator.ts',
          'packages/persistence/test/migrator.spec.ts',
        ],
      },
    ],
    testLanes: [
      {
        id: 'test-author',
        mode: 'parallel',
        role: 'test',
        engine: 'AGY',
        units: ['T002'],
        allowedWritePaths: ['packages/persistence/test/migrator.spec.ts'],
      },
    ],
    scopeExceptions: [
      'package.json',
      'packages/persistence/src/migrator.ts',
      'packages/persistence/test/migrator.spec.ts',
      'pnpm-lock.yaml',
    ],
  };
  writeFileSync(join(artifacts, 'task-graph.json'), JSON.stringify(graph, null, 2) + '\n');
  writeFileSync(join(artifacts, 'base-head.txt'), baseSha + '\n');
  writeFileSync(
    join(artifacts, 'shard-meta.json'),
    JSON.stringify(
      {
        core: { branch: 'wave/core', worktree: join(artifacts, 'wt/core') },
        'test-author': { branch: 'wave/test-author', worktree: join(artifacts, 'wt/test-author') },
      },
      null,
      2,
    ),
  );
  return graph;
}

function guardVerdict(fx: ReturnType<typeof buildFixture>, artifacts: string, shard: string) {
  const r = spawnSync(
    process.execPath,
    [
      GUARD,
      '--shard',
      shard,
      '--artifacts',
      artifacts,
      '--graph',
      join(artifacts, 'task-graph.json'),
      '--root',
      fx.root,
    ],
    { encoding: 'utf8' },
  );
  const resPath = join(artifacts, 'writer-results', shard, 'result.json');
  return { r, verdict: exists(resPath) ? JSON.parse(readFileSync(resPath, 'utf8')) : null };
}

function exists(p: string) {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}

describe('scope-exception cross-lane admission (live guard self-collision fix)', () => {
  test('test lane may write a plan-sanctioned exception also predicted by core', () => {
    const fx = buildFixture();
    const artifacts = mkdtempSync(join(tmpdir(), 'guard-exc-art-'));
    writeGraph(fx.root, artifacts, fx.baseSha);
    // lane commits ONLY the shared exception path
    const wt = join(artifacts, 'wt/test-author');
    mkdirSync(wt, { recursive: true });
    fx.run(`git worktree add -q -b wave/test-author "${wt}" ${fx.baseSha}`);
    const regDir = join(wt, 'packages/persistence/test');
    mkdirSync(regDir, { recursive: true });
    writeFileSync(join(regDir, 'migrator.spec.ts'), '// registry update\n');
    fx.runWt('git add -A && git commit -qm "test: extend central migration registry"', wt);

    const { r, verdict } = guardVerdict(fx, artifacts, 'test-author');
    expect(r.status).toBe(0);
    expect(verdict?.authorityOk).toBe(true);
    fx.run('git worktree remove --force "' + wt + '"');
    fx.run('git branch -D wave/test-author');
    rmSync(fx.root, { recursive: true, force: true });
    rmSync(artifacts, { recursive: true, force: true });
  });

  test('core lane touching the same exception is equally admitted (symmetry)', () => {
    const fx = buildFixture();
    const artifacts = mkdtempSync(join(tmpdir(), 'guard-exc-art2-'));
    writeGraph(fx.root, artifacts, fx.baseSha);
    const wt = join(artifacts, 'wt/core');
    mkdirSync(wt, { recursive: true });
    fx.run(`git worktree add -q -b wave/core "${wt}" ${fx.baseSha}`);
    writeFileSync(join(wt, 'packages/persistence/src/migrator.ts'), 'export const base = 2;\n');
    fx.runWt('git add -A && git commit -qm "feat: migration scaffolding"', wt);

    const { r, verdict } = guardVerdict(fx, artifacts, 'core');
    expect(r.status).toBe(0);
    expect(verdict?.authorityOk).toBe(true);
    fx.run('git worktree remove --force "' + wt + '"');
    fx.run('git branch -D wave/core');
    rmSync(fx.root, { recursive: true, force: true });
    rmSync(artifacts, { recursive: true, force: true });
  });

  test('NON-exception cross-lane writes are still rejected (fail-closed preserved)', () => {
    const fx = buildFixture();
    const artifacts = mkdtempSync(join(tmpdir(), 'guard-exc-art3-'));
    writeGraph(fx.root, artifacts, fx.baseSha);
    const wt = join(artifacts, 'wt/test-author');
    mkdirSync(wt, { recursive: true });
    fx.run(`git worktree add -q -b wave/test-author "${wt}" ${fx.baseSha}`);
    // write a path the OTHER lane predicts but that is NOT an exception:
    // core predicts migrations/g0_mcp_0001.sql (an in-scope path, no exception)
    const mdir = join(wt, 'migrations');
    mkdirSync(mdir, { recursive: true });
    writeFileSync(join(mdir, 'g0_mcp_0001.sql'), 'CREATE TABLE x();\n');
    fx.runWt('git add -A && git commit -qm "test: unauthorized migration write"', wt);

    const { r, verdict } = guardVerdict(fx, artifacts, 'test-author');
    expect(r.status).toBe(1);
    expect(verdict?.violations?.length).toBeGreaterThan(0);
    expect(verdict?.violations).toContain('migrations/g0_mcp_0001.sql');
    fx.run('git worktree remove --force "' + wt + '" || true');
    fx.run('git branch -D wave/test-author || true');
    rmSync(fx.root, { recursive: true, force: true });
    rmSync(artifacts, { recursive: true, force: true });
  });
});

// H3 mission item 4 — chained serial batches share ONE write column BY DESIGN
// (live self-collision, run e44f577a, 2026-09-01): core-batch-1's guard refused
// T004/T005/T006/T007-class paths merely because core-batch-2/3 inherited the
// same column union. A batch's chain mates are not "other lanes" — a path
// predicted by a chained batch is a plan-sanctioned revisit, while a path
// predicted by an UNRELATED lane (test-author, parallel shards) stays a
// violation.
describe('chained core-batch lanes share the write column (mission item 4)', () => {
  const base = (baseSha: string) => ({
    schema: 'foresift/impl-task-graph@1',
    package: { id: 'pkg-trace', risk: 'HIGH', writeScopes: ['packages/trace/**'] },
    bound: { mainHeadSha: baseSha, tasksFile: 'tasks.md' },
    totals: { units: 3, done: 0, open: 3, openParallelizable: 0 },
    units: [
      {
        id: 'T001',
        done: false,
        parallelizable: false,
        phase: 'Phase 1',
        body: 'schema',
        requirements: [],
        acceptanceCriteria: [],
        predictedWrites: ['packages/trace/src/schema.ts'],
        productWrites: ['packages/trace/src/schema.ts'],
        testWrites: [],
        testOnly: false,
        productWork: true,
        outOfScopeWrites: [],
        testRefs: [],
        dependsOn: [],
        estimatedSize: 'medium',
      },
      {
        id: 'T002',
        done: false,
        parallelizable: false,
        phase: 'Phase 2',
        body: 'query',
        requirements: [],
        acceptanceCriteria: [],
        predictedWrites: ['packages/trace/src/query.ts'],
        productWrites: ['packages/trace/src/query.ts'],
        testWrites: [],
        testOnly: false,
        productWork: true,
        outOfScopeWrites: [],
        testRefs: [],
        dependsOn: ['T001'],
        estimatedSize: 'medium',
      },
    ],
    shards: [
      {
        id: 'core-batch-1',
        mode: 'serial',
        chainId: 'core',
        batchIndex: 1,
        batchOf: 2,
        chainsFrom: null,
        role: 'implementation',
        engine: 'CODEX',
        units: ['T001'],
        allowedWritePaths: ['packages/trace/src/schema.ts', 'packages/trace/src/query.ts'],
      },
      {
        id: 'core-batch-2',
        mode: 'serial',
        chainId: 'core',
        batchIndex: 2,
        batchOf: 2,
        chainsFrom: 'core-batch-1',
        role: 'implementation',
        engine: 'CODEX',
        units: ['T002'],
        allowedWritePaths: ['packages/trace/src/schema.ts', 'packages/trace/src/query.ts'],
      },
    ],
    scopeExceptions: [],
  });

  function writeGraph(_root: string, artifacts: string, baseSha: string, shardMeta: object) {
    writeFileSync(
      join(artifacts, 'task-graph.json'),
      JSON.stringify(base(baseSha), null, 2) + '\n',
    );
    writeFileSync(join(artifacts, 'base-head.txt'), baseSha + '\n');
    writeFileSync(join(artifacts, 'shard-meta.json'), JSON.stringify(shardMeta, null, 2));
  }

  test('batch-1 touching a path predicted by its chain mate core-batch-2 is admitted', () => {
    const fx = buildFixture();
    const artifacts = mkdtempSync(join(tmpdir(), 'guard-chain-art1-'));
    const meta = {
      'core-batch-1': { branch: 'wave/b1', worktree: join(artifacts, 'wt/b1') },
      'core-batch-2': { branch: 'wave/b2', worktree: join(artifacts, 'wt/b2') },
    };
    writeGraph(fx.root, artifacts, fx.baseSha, meta);
    // batch-1 writes ONLY a path that core-batch-2 also predicts (column union)
    const wt = join(artifacts, 'wt/b1');
    mkdirSync(wt, { recursive: true });
    fx.run(`git worktree add -q -b wave/b1 "${wt}" ${fx.baseSha}`);
    mkdirSync(join(wt, 'packages/trace/src'), { recursive: true });
    writeFileSync(join(wt, 'packages/trace/src/query.ts'), 'export const q = 1;\n');
    fx.runWt('git add -A && git commit -qm "feat(trace): query surface (batch-1)"', wt);

    const { r, verdict } = guardVerdict(fx, artifacts, 'core-batch-1');
    expect(r.status).toBe(0);
    expect(verdict?.authorityOk).toBe(true);
    fx.run('git worktree remove --force "' + wt + '"');
    fx.run('git branch -D wave/b1');
    rmSync(fx.root, { recursive: true, force: true });
    rmSync(artifacts, { recursive: true, force: true });
  });

  test('batch-1 touching a path predicted by an UNRELATED lane is still rejected', () => {
    const fx = buildFixture();
    const artifacts = mkdtempSync(join(tmpdir(), 'guard-chain-art2-'));
    const graph = base(fx.baseSha);
    // an unrelated parallel shard claims packages/trace/src/other.ts
    graph.shards.push({
      id: 'shard-1',
      mode: 'parallel',
      role: 'implementation',
      engine: 'CODEX',
      units: ['T099'],
      allowedWritePaths: ['packages/trace/src/other.ts'],
    } as (typeof graph.shards)[number]);
    writeFileSync(join(artifacts, 'task-graph.json'), JSON.stringify(graph, null, 2) + '\n');
    writeFileSync(join(artifacts, 'base-head.txt'), fx.baseSha + '\n');
    writeFileSync(
      join(artifacts, 'shard-meta.json'),
      JSON.stringify(
        {
          'core-batch-1': { branch: 'wave/b1', worktree: join(artifacts, 'wt/b1') },
          'core-batch-2': { branch: 'wave/b2', worktree: join(artifacts, 'wt/b2') },
          'shard-1': { branch: 'wave/s1', worktree: join(artifacts, 'wt/s1') },
        },
        null,
        2,
      ),
    );
    const wt = join(artifacts, 'wt/b1');
    mkdirSync(wt, { recursive: true });
    fx.run(`git worktree add -q -b wave/b1 "${wt}" ${fx.baseSha}`);
    mkdirSync(join(wt, 'packages/trace/src'), { recursive: true });
    writeFileSync(join(wt, 'packages/trace/src/other.ts'), 'export const o = 1;\n');
    fx.runWt('git add -A && git commit -qm "feat(trace): foreign write"', wt);

    const { r, verdict } = guardVerdict(fx, artifacts, 'core-batch-1');
    expect(r.status).toBe(1);
    expect(verdict?.violations).toContain('packages/trace/src/other.ts');
    fx.run('git worktree remove --force "' + wt + '" || true');
    fx.run('git branch -D wave/b1 || true');
    rmSync(fx.root, { recursive: true, force: true });
    rmSync(artifacts, { recursive: true, force: true });
  });
});
