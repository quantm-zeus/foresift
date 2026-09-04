// Maintainer incident wave 2026-09-03 — deterministic regressions for the
// four defects observed live on g1-data-truth-extensions runs e3ccffb5 /
// 258232f3 / 32917dda:
//
//   1. AGY test sharding — write-disjoint test units may split into at most
//      two AGY lanes; any shared write collapses to one lane (fail closed).
//   2. Generation-agnostic preflight migration duties (ADR-0022 alignment) —
//      launch-preflight must record g1_*/g2_* predictions, not just g0_*.
//   3. Mechanical bookkeeping stays coordinator-owned — a unit whose body
//      names the coordinator manifest must never reach a writer brief when
//      marked [executor: COORDINATOR] (ADR-0020 contract, T029 class).
//   4. Adaptive-lane boundary — a serial core plus exactly one independent
//      [P] unit resolves ≥1 lane but is capacity-capped; exact shardNeed
//      overrides both. Pinned here so the boundary behavior stays explicit.
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAdaptiveLaneCount } from '../../scripts/automation/adaptive-lanes.mjs';
import { splitSymlinks } from '../../scripts/automation/writer-task-evidence.mjs';

const GRAPH = join(
  import.meta.dir,
  '..',
  '..',
  'scripts',
  'automation',
  'build-implementation-task-graph.mjs',
);
const PREFLIGHT = join(
  import.meta.dir,
  '..',
  '..',
  'scripts',
  'automation',
  'launch-preflight.mjs',
);

function scratchRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'maintainer-wave-fx-'));
  mkdirSync(join(root, 'specs', 'pkg-t'), { recursive: true });
  mkdirSync(join(root, 'specs', 'implementation'), { recursive: true });
  return root;
}

function writeTasks(root: string, body: string) {
  writeFileSync(join(root, 'specs', 'pkg-t', 'tasks.md'), body);
  writeFileSync(
    join(root, 'specs', 'implementation', 'current-milestone.json'),
    JSON.stringify({
      schemaVersion: '1.0.0',
      milestoneId: 'MX',
      status: 'ACTIVE',
      packages: [
        {
          id: 'pkg-t',
          objective: 'Implement fixture subsystem t end to end with full evidence coverage.',
          requirementIds: ['FR-X-001'],
          dependencies: [],
          risk: 'MEDIUM',
          parallelizable: false,
          writeScopes: ['packages/t/**', 'tests/**', 'migrations/'],
          verificationCommands: ['pnpm test'],
          status: 'RUNNING',
        },
        {
          id: 'pkg-t2',
          objective: 'Implement independent fixture subsystem t2 behind its own boundary.',
          requirementIds: ['FR-X-002'],
          dependencies: ['pkg-t'],
          risk: 'LOW',
          parallelizable: true,
          writeScopes: ['packages/t2/**'],
          verificationCommands: ['pnpm test'],
          status: 'PENDING',
        },
      ],
    }),
  );
}

function buildGraph(root: string, profile = 'HYBRID_AGY') {
  const r = spawnSync(
    process.execPath,
    [GRAPH, '--package', 'pkg-t', '--root', root, '--execution-profile', profile],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error((r.stderr ?? '').slice(0, 300));
  return JSON.parse(r.stdout) as {
    testLanes: Array<{
      id: string;
      units: string[];
      role: string;
      engine: string;
      allowedWritePaths: string[];
    }>;
  };
}

const TWO_DISJOINT_TEST_UNITS = [
  '# Tasks: pkg-t',
  '',
  '- [ ] T101 Author `tests/a/one.spec.ts` covering FR-X-001. Traces: FR-X-001.',
  '- [ ] T102 Author `tests/b/two.spec.ts` covering FR-X-001. Traces: FR-X-001.',
  '',
].join('\n');

describe('maintainer wave 2026-09-03 regressions', () => {
  it('splits exactly-disjoint test units into two AGY lanes (canary cap 2)', () => {
    const root = scratchRepo();
    writeTasks(root, TWO_DISJOINT_TEST_UNITS);
    const g = buildGraph(root);
    expect(g.testLanes.map((t) => t.id).sort()).toEqual(['test-author-1', 'test-author-2']);
    const laneUnits = g.testLanes
      .map((t) => t.units.sort())
      .sort((a, b) => a[0].localeCompare(b[0]));
    expect(laneUnits).toEqual([['T101'], ['T102']]);
    for (const lane of g.testLanes) {
      expect(lane.role).toBe('test');
      expect(lane.engine).toBe('AGY');
      // AGY test lanes never receive product write authority.
      expect(lane.allowedWritePaths.every((p) => p.startsWith('tests/'))).toBe(true);
    }
  });

  it('collapses test units that share a write into one lane (fail closed)', () => {
    const root = scratchRepo();
    writeTasks(
      root,
      [
        '# Tasks: pkg-t',
        '',
        '- [ ] T101 Author `tests/shared.spec.ts` and `tests/a/one.spec.ts`. Traces: FR-X-001.',
        '- [ ] T102 Author `tests/shared.spec.ts`. Traces: FR-X-001.',
        '',
      ].join('\n'),
    );
    const g = buildGraph(root);
    expect(g.testLanes.map((t) => t.id)).toEqual(['test-author']);
    expect(g.testLanes[0].units.sort()).toEqual(['T101', 'T102']);
  });

  it('keeps a single lane when any test unit has unknown writes', () => {
    const root = scratchRepo();
    writeTasks(
      root,
      [
        '# Tasks: pkg-t',
        '',
        '- [ ] T101 Author `tests/a/one.spec.ts`. Traces: FR-X-001.',
        '- [ ] T102 Verify the regression story for FR-X-001 and update the suite.',
        '',
      ].join('\n'),
    );
    const g = buildGraph(root);
    expect(g.testLanes.map((t) => t.id)).toEqual(['test-author']);
  });

  it('records G1-class migration predictions as preflight migration duties (ADR-0022)', () => {
    const root = scratchRepo();
    mkdirSync(join(root, 'migrations'), { recursive: true });
    writeTasks(
      root,
      [
        '# Tasks: pkg-t',
        '',
        '- [ ] T103 Author `migrations/g1_t_0001_fixtures.sql` and register it in',
        '  `packages/persistence/test/migrator.spec.ts` (plan-sanctioned exception).',
        '  Traces: FR-X-001.',
        '',
      ].join('\n'),
    );
    const r = spawnSync(process.execPath, [PREFLIGHT, '--package', 'pkg-t', '--root', root], {
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(r.stderr.slice(0, 300));
    const record = JSON.parse(r.stdout);
    expect(record.exact).toBe(true);
    expect(record.migrationDuties).toContain('migrations/g1_t_0001_fixtures.sql');
  });

  it('still records G0-class migration predictions (no weakening)', () => {
    const root = scratchRepo();
    mkdirSync(join(root, 'migrations'), { recursive: true });
    writeTasks(
      root,
      [
        '# Tasks: pkg-t',
        '',
        '- [ ] T103 Author `migrations/g0_t_0001_fixtures.sql` and register it in',
        '  `packages/persistence/test/migrator.spec.ts` (plan-sanctioned exception).',
        '  Traces: FR-X-001.',
        '',
      ].join('\n'),
    );
    const r = spawnSync(process.execPath, [PREFLIGHT, '--package', 'pkg-t', '--root', root], {
      encoding: 'utf8',
    });
    const record = JSON.parse(r.stdout);
    expect(record.migrationDuties).toContain('migrations/g0_t_0001_fixtures.sql');
  });

  it('excludes coordinator-marked mechanical bookkeeping from every writer lane', () => {
    const root = scratchRepo();
    writeTasks(
      root,
      [
        '# Tasks: pkg-t',
        '',
        '- [ ] T103 [executor: COORDINATOR] Regenerate the manifest at',
        '  `evidence/bun-migration/bun-migration-manifest.json`. Traces: FR-X-001.',
        '- [ ] T101 Author `tests/a/one.spec.ts`. Traces: FR-X-001.',
        '',
      ].join('\n'),
    );
    const g = buildGraph(root);
    const laneUnits = g.testLanes.flatMap((t) => t.units);
    expect(laneUnits).not.toContain('T103');
    expect(laneUnits).toContain('T101');
  });

  it('lane evidence never counts a symlink as authorship (live 486a44d0 node_modules law)', () => {
    const root = scratchRepo();
    // Real lane work + a tooling symlink (the exact live shape: node_modules
    // reused from the task worktree; gitignore `node_modules/` matches the
    // DIRECTORY but not a symlink blob, so `git add --all` swallowed it).
    symlinkSync('/nonexistent/target-for-fixture', join(root, 'node_modules'));
    mkdirSync(join(root, 'tests'), { recursive: true });
    writeFileSync(join(root, 'tests', 'authored.spec.ts'), 'it("x", () => {});\n');
    // laneEvidencePaths is diff/status driven; exercise splitSymlinks — the
    // commit-safety filter every writer's add/commit path must use.
    const { clean, symlinked } = splitSymlinks(root, ['node_modules', 'tests/authored.spec.ts']);
    expect(symlinked).toEqual(['node_modules']);
    expect(clean).toEqual(['tests/authored.spec.ts']);
  });

  it('adaptive lanes: core + one independent [P] unit stays explicit and capacity-capped', () => {
    // Boundary pinned from live evidence (Part F): 1 [P]-ready unit resolves
    // 1 lane; capacity caps are reported, and exact shardNeed overrides.
    const one = resolveAdaptiveLaneCount({
      openTaskCount: 10,
      parallelizableReadyCount: 1,
      governorState: 'GREEN',
      codexLimit: 2,
      claudeLimit: 3,
    });
    expect(one.lanes).toBe(1);
    const shardNeedDriven = resolveAdaptiveLaneCount({
      openTaskCount: 30,
      parallelizableReadyCount: 6,
      disjointShardNeed: 8,
      governorState: 'GREEN',
      codexLimit: 2,
      claudeLimit: 3,
    });
    expect(shardNeedDriven.lanes).toBe(3);
    expect(shardNeedDriven.capped).toBe(false);
    const capacityCapped = resolveAdaptiveLaneCount({
      openTaskCount: 30,
      parallelizableReadyCount: 6,
      disjointShardNeed: 8,
      governorState: 'GREEN',
      codexLimit: 1,
      claudeLimit: 1,
    });
    expect(capacityCapped.lanes).toBe(2);
    expect(capacityCapped.capped).toBe(true);
  });

  it('re-roots package-relative backticks into scope-resolved predicted writes (run b20e5ea8)', () => {
    // Live defect: bodies naming package files RELATIVELY (`src/foo.ts`,
    // `package.json`) were dropped by the repo-rooted prefix filter, so whole
    // serial columns derived ZERO predicted writes — empty lane write
    // columns, no evidence nominations, §6 audit starvation. Re-rooting
    // targets the package's PRIMARY scope (namesake `packages/<pkg-leaf>`,
    // leaf = id with the generation prefix stripped) and must NOT explode
    // prose symbols or fabricate cross-package writes.
    const root = scratchRepo();
    // Dedicated inline milestone: package id `g1-t` (generation prefix
    // stripped → leaf `t`) whose binding scope IS `packages/t/**` — the
    // namesake shape the rule resolves against.
    mkdirSync(join(root, 'specs', 'g1-t'), { recursive: true });
    writeFileSync(
      join(root, 'specs', 'implementation', 'current-milestone.json'),
      JSON.stringify({
        schemaVersion: '1.0.0',
        milestoneId: 'MX2',
        status: 'ACTIVE',
        packages: [
          {
            id: 'g1-t',
            objective: 'Implement fixture subsystem t end to end with full evidence coverage.',
            requirementIds: ['FR-X-001'],
            dependencies: [],
            risk: 'MEDIUM',
            parallelizable: false,
            writeScopes: ['packages/t/**', 'tests/**', 'migrations/'],
            verificationCommands: ['pnpm test'],
            status: 'RUNNING',
          },
          {
            id: 'g1-t2',
            objective: 'Implement independent fixture subsystem t2 behind its own boundary.',
            requirementIds: ['FR-X-002'],
            dependencies: ['g1-t'],
            risk: 'LOW',
            parallelizable: true,
            writeScopes: ['packages/t2/**'],
            verificationCommands: ['pnpm test'],
            status: 'PENDING',
          },
        ],
      }),
    );
    writeFileSync(
      join(root, 'specs', 'g1-t', 'tasks.md'),
      [
        '# Tasks: g1-t',
        '',
        '- [ ] T201 Implement `src/tokenizer.ts` with helper `TokenKind` and',
        '      call `parse(...)`; see `@scope/thing` and `dotted.symbol`. Also',
        '      extend the root `package.json`. Traces: FR-X-001.',
        '',
      ].join('\n'),
    );
    const r = spawnSync(
      process.execPath,
      [GRAPH, '--package', 'g1-t', '--root', root, '--execution-profile', 'HYBRID_AGY'],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error((r.stderr ?? '').slice(0, 300));
    const g = JSON.parse(r.stdout) as {
      units: Array<{ id: string; predictedWrites: string[] }>;
    };
    const u = g.units.find((x) => x.id === 'T201');
    // `src/tokenizer.ts` resolves against the PRIMARY scope `packages/t/`
    // only — never against other packages/* scopes the package merely
    // touches (live recovery sim: multi-root re-rooting predicted the same
    // analyzer under packages/domain and packages/shared-schemas, roots
    // whose files cannot exist).
    expect(u?.predictedWrites).toEqual(['packages/t/src/tokenizer.ts']);
    // Prose symbols never become pseudo-paths.
    for (const w of u?.predictedWrites ?? []) {
      expect(w).not.toContain('TokenKind');
      expect(w).not.toContain('dotted.symbol');
      expect(w).not.toContain('@scope/thing');
      expect(w).not.toContain('parse(');
    }
  });
});
