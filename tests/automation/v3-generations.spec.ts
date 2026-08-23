// V3-A ACCEPTANCE: durable execution generations, supported fresh-restart
// command, and generation salvage (V3 §6–§8 + live override §§4–16).
//
// Two layers, both hermetic:
//   1. Pure units — identity math, schema validation, salvage classification /
//      reconciliation / ADR renumbering / task reconstruction.
//   2. CLI flows — the REAL `--restart-package` subprocess against a seeded
//      git fixture repo + stub archon CLI: success with salvage seeding,
//      §7 duplicate-invocation replay ("second invocation cannot create
//      generation 2"), deliberate --confirm-new-generation advance, and the
//      fail-closed refusals (tracked live run, live current-generation row,
//      stale intent, bad manifest).
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  generationBranch,
  generationMessage,
  packageGeneration,
  parseGenerationMessage,
  usesOptimizedWorkflow,
  workPackageWorkflowFor,
} from '../../scripts/automation/package-generations.mjs';
import { validateMilestoneState } from '../../scripts/automation/schema.mjs';
import {
  buildSalvageInventory,
  classifyPath,
  planAdrRenames,
  reconcileJsonManifest,
  reconcileWorkspaceYaml,
  reconstructTasks,
} from '../../scripts/automation/generation-salvage.mjs';
import { disposeGitFixtureBase, gitFixture, type GitFixture } from '../helpers/git-fixture.js';

const AUTOPILOT = fileURLToPath(
  new URL('../../scripts/automation/foresift-autopilot.mjs', import.meta.url),
);
const PKG = 'pkg-alpha';

// ── pure units: generation identity ─────────────────────────────────────────
describe('generation identity math', () => {
  it('gen 0 keeps historical branch/message surfaces', () => {
    expect(packageGeneration({ id: PKG })).toBe(0);
    expect(packageGeneration({ id: PKG, generation: 0 })).toBe(0);
    expect(generationBranch(PKG, 0)).toBe(`foresift/${PKG}`);
    expect(generationMessage(PKG, 0)).toBe(PKG);
  });

  it('gen N>=1 carries the generation in every surface', () => {
    expect(generationBranch(PKG, 1)).toBe(`foresift/${PKG}-g1`);
    expect(generationBranch(PKG, 12)).toBe(`foresift/${PKG}-g12`);
    expect(generationMessage(PKG, 1)).toBe(`${PKG}@g1`);
    expect(generationMessage(PKG, 12)).toBe(`${PKG}@g12`);
  });

  it('message parsing round-trips and degrades legacy messages to gen 0', () => {
    expect(parseGenerationMessage(`${PKG}@g3`)).toEqual({ packageId: PKG, generation: 3 });
    expect(parseGenerationMessage(PKG)).toEqual({ packageId: PKG, generation: 0 });
    // Package ids may themselves contain hyphens/digits; only @g<N> is the marker.
    expect(parseGenerationMessage('g0-contracts-data-truth')).toEqual({
      packageId: 'g0-contracts-data-truth',
      generation: 0,
    });
    expect(parseGenerationMessage('')).toBeNull();
    expect(parseGenerationMessage(null)).toBeNull();
    expect(parseGenerationMessage(42)).toBeNull();
    for (let g = 0; g <= 5; g++) {
      const m = generationMessage('x', g);
      expect(parseGenerationMessage(m)).toEqual({ packageId: 'x', generation: g });
    }
  });

  it('routes gen>=1 to the single optimized topology regardless of legacy profile', () => {
    // g0-contracts-data-truth is LEGACY forever at generation 0...
    expect(usesOptimizedWorkflow({ id: 'g0-contracts-data-truth' })).toBe(false);
    expect(workPackageWorkflowFor({ id: 'g0-contracts-data-truth', generation: 0 })).toBe(
      'foresift-work-package',
    );
    // ...but EVERY package at generation >= 1 runs the one optimized workflow.
    expect(usesOptimizedWorkflow({ id: 'g0-contracts-data-truth', generation: 1 })).toBe(true);
    expect(workPackageWorkflowFor({ id: 'g0-contracts-data-truth', generation: 1 })).toBe(
      'foresift-work-package-optimized',
    );
    expect(workPackageWorkflowFor({ id: 'some-other-package', generation: 0 })).toBe(
      'foresift-work-package-optimized',
    );
    expect(workPackageWorkflowFor(null)).toBe('foresift-work-package');
  });
});

// ── pure units: milestone-state validation ──────────────────────────────────
describe('schema: packages[].generation', () => {
  const base = () => ({
    schemaVersion: '1.0.0',
    milestoneId: 'G0',
    status: 'ACTIVE',
    packages: [pkg(PKG, 'PENDING'), pkg('pkg-beta', 'PENDING')],
  });
  function pkg(id: string, status: string, extra: Record<string, unknown> = {}) {
    return {
      id,
      objective: `A meaningful objective sentence for ${id}.`,
      requirementIds: ['REQ-1'],
      dependencies: [],
      risk: 'LOW',
      parallelizable: true,
      writeScopes: [`packages/${id}/**`],
      verificationCommands: ['pnpm test'],
      status,
      ...extra,
    };
  }

  it('accepts absent generation (legacy state) and valid non-negative integers', () => {
    expect(validateMilestoneState(base())).toEqual([]);
    const ms = base();
    (ms.packages[0] as Record<string, unknown>).generation = 3;
    expect(validateMilestoneState(ms)).toEqual([]);
  });

  it('rejects negative, fractional, and non-numeric generations', () => {
    for (const bad of [-1, 1.5, '2', null]) {
      const ms = base();
      (ms.packages[0] as Record<string, unknown>).generation = bad;
      expect(validateMilestoneState(ms).join(' ')).toMatch(
        /generation must be a non-negative integer/,
      );
    }
  });
});

// ── pure units: salvage classification + reconciliation ─────────────────────
describe('classifyPath', () => {
  it('classifies the override taxonomy deterministically', () => {
    expect(classifyPath('packages/contracts/src/index.ts', PKG)).toBe('REUSE_AS_IS');
    expect(classifyPath('migrations/0001_init.sql', PKG)).toBe('REUSE_AS_IS');
    expect(classifyPath('tests/acceptance/AC-001.spec.ts', PKG)).toBe('REUSE_AS_IS');
    expect(classifyPath(`specs/${PKG}/tasks.md`, PKG)).toBe('REUSE_AS_IS');
    expect(classifyPath(`specs/${PKG}/plan.md`, PKG)).toBe('REUSE_AS_IS');
    expect(classifyPath('docs/adr/0008-x.md', PKG)).toBe('REUSE_WITH_RECONCILIATION');
    expect(classifyPath('package.json', PKG)).toBe('REUSE_WITH_RECONCILIATION');
    expect(classifyPath('pnpm-lock.yaml', PKG)).toBe('REUSE_WITH_RECONCILIATION');
    expect(classifyPath('docs/migration/SPEC_MIGRATION.md', PKG)).toBe('REUSE_WITH_RECONCILIATION');
    expect(classifyPath('scripts/automation/old-supervisor.mjs', PKG)).toBe(
      'OBSOLETE_CONTROL_PLANE',
    );
    expect(classifyPath('.archon/workflows/x.yaml', PKG)).toBe('OBSOLETE_CONTROL_PLANE');
    expect(classifyPath('.github/workflows/ci.yml', PKG)).toBe('OBSOLETE_CONTROL_PLANE');
    expect(classifyPath('tests/automation/old.spec.ts', PKG)).toBe('OBSOLETE_CONTROL_PLANE');
    expect(classifyPath('random/new-path.txt', PKG)).toBe('UNKNOWN');
  });

  it("another package's specs are not this package's authority", () => {
    expect(classifyPath('specs/some-other-package/tasks.md', PKG)).not.toBe('REUSE_AS_IS');
  });
});

describe('reconcileJsonManifest (current main wins)', () => {
  it('adds keys absent from current and resolves conflicts to current', () => {
    const cur = JSON.stringify({ name: 'foresift', scripts: { verify: 'a' }, version: 9 });
    const sal = JSON.stringify({ name: 'OLD', scripts: { verify: 'OLD' }, added: 'new' });
    const merged = JSON.parse(reconcileJsonManifest(cur, sal)!);
    expect(merged.name).toBe('foresift'); // conflict -> current
    expect(merged.scripts.verify).toBe('a'); // nested conflict -> current
    expect(merged.added).toBe('new'); // absent key -> added
    expect(merged.version).toBe(9);
  });

  it('adds missing entries inside dependency maps without touching existing ones', () => {
    const cur = JSON.stringify({ devDependencies: { vitest: '4.1.11' } });
    const sal = JSON.stringify({ devDependencies: { vitest: '0.9', zod: '3.0.0' } });
    const merged = JSON.parse(reconcileJsonManifest(cur, sal)!);
    expect(merged.devDependencies.vitest).toBe('4.1.11'); // current wins
    expect(merged.devDependencies.zod).toBe('3.0.0'); // missing dep added
  });

  it('returns null on unparsable input instead of guessing', () => {
    expect(reconcileJsonManifest('{oops', '{}')).toBeNull();
    expect(reconcileJsonManifest('{}', 'nope')).toBeNull();
  });
});

describe('reconcileWorkspaceYaml', () => {
  it('unions package globs additively, preserving current order first', () => {
    const cur = "packages:\n  - 'packages/*'\n";
    const sal = "packages:\n  - 'packages/*'\n  - 'legacy/*'\n";
    const merged = reconcileWorkspaceYaml(cur, sal)!;
    expect(merged).toContain("'legacy/*'");
    expect(merged.indexOf("'packages/*'")).toBeLessThan(merged.indexOf("'legacy/*'"));
  });

  it('is a no-op when current already covers the globs', () => {
    const cur = "packages:\n  - 'packages/*'\n";
    expect(reconcileWorkspaceYaml(cur, cur)).toBe(cur);
  });
});

describe('planAdrRenames', () => {
  const f = (path: string) => ({ path, status: 'A' });

  it('renumbers colliding salvage ADRs above the union of BOTH sides', () => {
    const renames = planAdrRenames(
      [f('docs/adr/0008-colliding.md'), f('docs/adr/0009-fresh.md')],
      new Set(['docs/adr/0008-existing.md', 'docs/adr/0007-base.md']),
    );
    // Numbering against the salvage side alone would pick a "free" small number
    // that collides with base history; must go above max(8,9)=9.
    expect(renames['docs/adr/0008-colliding.md']).toBe('docs/adr/0010-colliding.md');
    expect(renames['docs/adr/0009-fresh.md']).toBeUndefined(); // no collision, no rename
  });

  it('renumbers same-number collisions above a base with far-future numbers', () => {
    const renames = planAdrRenames(
      [f('docs/adr/0042-salvage-topic.md'), f('docs/adr/0008-unrelated.md')],
      new Set(['docs/adr/0042-later.md']),
    );
    // Same NUMBER as a base ADR ⇒ forward collision, renumbered above max(42).
    expect(renames['docs/adr/0042-salvage-topic.md']).toBe('docs/adr/0043-salvage-topic.md');
    // Different number entirely ⇒ no collision, restored under its own name.
    expect(renames['docs/adr/0008-unrelated.md']).toBeUndefined();
  });
});

describe('reconstructTasks (fail-closed reopen rule)', () => {
  const TASKS = [
    '# Tasks',
    `- [x] T001 wire contracts (AC-001)`,
    `- [x] T002 guard decimals (AC-002)`,
    `- [x] T003 negative boundary (AC-003)`,
    `- [ ] T004 never started (AC-004)`,
    '',
  ].join('\n');

  it('keeps checked tasks only when every AC has locatable evidence', () => {
    const rec = reconstructTasks(TASKS, [
      'tests/acceptance/AC-001.spec.ts',
      'tests/negative/AC-003.negative.spec.ts',
    ]);
    expect(rec.reused).toBe(2);
    expect(rec.reopened).toBe(1);
    expect(rec.remaining).toBe(2); // reopened T002 + never-started T004
    expect(rec.content).toContain('[ ] T002 guard decimals (AC-002)');
    expect(rec.content).toMatch(/T002.*salvage: reopened/);
    expect(rec.content).toContain('- [x] T001 wire contracts (AC-001)');
    expect(rec.details.find((d) => d.task === 'T002')?.verdict).toBe('REOPENED');
  });

  it('is idempotent: already-reopened lines are left alone', () => {
    const once = reconstructTasks(TASKS, ['tests/acceptance/AC-001.spec.ts']);
    const twice = reconstructTasks(once.content, ['tests/acceptance/AC-001.spec.ts']);
    // The reopened T002 is now UNCHECKED, so no second-pass reopen can match
    // it — content converges instead of degrading further.
    expect(twice.content).toBe(once.content);
    expect(twice.reopened).toBe(0);
    expect(twice.reused).toBe(once.reused);
  });
});

// ── CLI flows: --restart-package against fixture repo + stub archon ─────────
const scratch = mkdtempSync(join(tmpdir(), 'foresift-v3-gen-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  disposeGitFixtureBase();
});

const STUB_DIR = join(scratch, 'stub-bin');
const stubArchon = () => {
  mkdirSync(STUB_DIR, { recursive: true });
  const p = join(STUB_DIR, 'archon');
  writeFileSync(
    p,
    [
      '#!/usr/bin/env bash',
      'printf \'%s\\n\' "$*" >> "${FAKE_ARCHON_LOG:?}"',
      'case "$1 $2" in',
      '  "workflow runs") cat "${FAKE_RUNS_FILE:?}" ;;',
      '  "workflow abandon") printf \'{"ok":true}\\n\' ;;',
      '  *) printf \'{"id":"stub","status":"running","last_activity_at":0,"started_at":0}\\n\' ;;',
      'esac',
    ].join('\n'),
  );
  chmodSync(p, 0o755);
};

interface Sandbox {
  fx: GitFixture;
  stateDir: string;
  baseSha: string;
}
function restartSandbox(name: string): Sandbox {
  const fx = gitFixture(name);
  stubArchon();
  // Final-V3-main stand-in: an existing ADR that the salvage side will collide with.
  fx.writeFile('docs/adr/0008-existing.md', '# ADR-0008 (final V3 main)\n');
  fx.commitAll('base adr on main');
  fx.g(['push', '-q', 'origin', 'main']);
  const ms = {
    schemaVersion: '1.0.0',
    milestoneId: 'G0',
    status: 'ACTIVE',
    packages: [
      {
        id: PKG,
        objective: 'Implement the contracts and data truth foundation slice.',
        requirementIds: ['REQ-1'],
        dependencies: [],
        risk: 'HIGH',
        parallelizable: false,
        writeScopes: ['packages/**'],
        verificationCommands: ['pnpm test'],
        status: 'PENDING',
      },
      {
        id: 'pkg-beta',
        objective: 'Second package so milestone decomposition validates.',
        requirementIds: ['REQ-2'],
        dependencies: [PKG],
        risk: 'LOW',
        parallelizable: true,
        writeScopes: ['packages/beta/**'],
        verificationCommands: ['pnpm test'],
        status: 'PENDING',
      },
    ],
  };
  fx.writeFile('specs/implementation/current-milestone.json', JSON.stringify(ms, null, 2) + '\n');
  fx.writeFile(
    'specs/implementation/roadmap.json',
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        policy: {
          foundationMilestones: ['G0'],
          maxParallelCodingPackagesFoundation: 1,
          maxParallelCodingPackages: 2,
        },
        currentMilestoneId: 'G0',
        milestones: [{ id: 'G0', name: 'foundation', dependsOn: [], status: 'ACTIVE' }],
      },
      null,
      2,
    ) + '\n',
  );
  fx.commitAll('milestone fixtures');
  fx.g(['push', '-q', 'origin', 'main']);

  // Salvage source branch: mixed product + obsolete-control-plane content.
  fx.g(['switch', '-q', '-c', 'salvage-src']);
  fx.writeFile('packages/pkg-alpha/src/index.ts', 'export const truth = 1;\n');
  fx.writeFile('migrations/0001_init.sql', 'CREATE TABLE t(id int);\n');
  fx.writeFile('tests/acceptance/AC-001.spec.ts', 'it("ac1", () => {});\n');
  fx.writeFile('tests/negative/AC-003.negative.spec.ts', 'it("ac3 neg", () => {});\n');
  fx.writeFile(
    `specs/${PKG}/tasks.md`,
    [
      '# Tasks',
      '- [x] T001 wire contracts (AC-001)',
      '- [x] T002 guard decimals (AC-002)',
      '- [x] T003 negative boundary (AC-003)',
      '- [ ] T004 never started (AC-004)',
      '',
    ].join('\n'),
  );
  fx.writeFile('docs/adr/0008-colliding.md', '# ADR-0008 (salvage)\n');
  fx.writeFile('docs/adr/0009-fresh.md', '# ADR-0009 (salvage)\n');
  fx.writeFile('scripts/automation/OBSOLETE-SUPERVISOR.mjs', '// old control plane\n');
  fx.writeFile('docs/runbook-old.md', '# old ops prose\n');
  fx.commitAll('salvage source (mixed)');
  fx.g(['switch', '-q', 'main']);

  const stateDir = mkdtempSync(join(scratch, `${name}-state-`));
  return { fx, stateDir, baseSha: fx.baseSha() };
}

function writeRunsFile(stateDir: string, rows: unknown[]): string {
  const p = join(stateDir, 'fake-runs.json');
  writeFileSync(p, JSON.stringify({ runs: rows }));
  return p;
}

function runRestartCli(
  sb: Sandbox,
  args: string[],
  opts: { rows?: unknown[]; env?: Record<string, string> } = {},
) {
  const runsFile = writeRunsFile(sb.stateDir, opts.rows ?? []);
  return spawnSync('node', [AUTOPILOT, ...args], {
    cwd: sb.fx.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORESIFT_AUTOPILOT_REPO: sb.fx.root,
      FORESIFT_AUTOPILOT_STATE_DIR: sb.stateDir,
      FORESIFT_SALVAGE_SKIP_INSTALL: '1', // fixture repos carry no pnpm workspace
      PATH: `${STUB_DIR}:${process.env.PATH ?? ''}`,
      FAKE_ARCHON_LOG: join(sb.stateDir, 'archon.log'),
      FAKE_RUNS_FILE: runsFile,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      ...opts.env,
    },
  });
}

const readMs = (sb: Sandbox) =>
  JSON.parse(
    readFileSync(join(sb.fx.root, 'specs', 'implementation', 'current-milestone.json'), 'utf8'),
  );

describe('--restart-package CLI flows', () => {
  let sb: Sandbox;
  let manifestPath: string;
  beforeAll(() => {
    sb = restartSandbox('restart-flows');
    const inv = buildSalvageInventory({
      repoRoot: sb.fx.root,
      pkgId: PKG,
      salvageRef: 'salvage-src',
      baseRef: 'origin/main',
      sourceSalvagePr: 22,
    });
    manifestPath = join(scratch, 'restart-flows-manifest.json');
    writeFileSync(manifestPath, JSON.stringify(inv, null, 2) + '\n');
  });

  it('inventory classifies the mixed salvage source correctly', () => {
    expect(invSummary(manifestPath)).toMatchObject({
      reuseAsIs: 5, // packages, migrations, AC-001, AC-003-neg, tasks.md
      obsoleteControlPlane: 1, // scripts/automation/OBSOLETE-SUPERVISOR.mjs
      reuseWithReconciliation: 3, // two ADRs + docs/runbook-old.md
      unknown: 0,
      commitsFullyProduct: 0,
      commitsMixed: 1,
    });
  });

  it('performs a fresh-generation restart with a seeded, pushed salvage branch', () => {
    const r = runRestartCli(sb, [
      '--restart-package',
      PKG,
      '--fresh-generation',
      '--reason',
      'V3 controlled reset of retired generation 0',
      '--salvage-manifest',
      manifestPath,
    ]);
    expect(r.status).toBe(0);
    const receipt = JSON.parse(r.stdout.trim());
    expect(receipt.schema).toBe('foresift/restart-receipt@1');
    expect(receipt.packageId).toBe(PKG);
    expect(receipt.retiredGeneration).toBe(0);
    expect(receipt.toGeneration).toBe(1);
    expect(receipt.retiredBranch).toBe(`foresift/${PKG}`);
    expect(receipt.generationBranch).toBe(`foresift/${PKG}-g1`);
    expect(receipt.sourceSalvagePr).toBe(22);
    expect(receipt.sourceSalvageHead).toBeTruthy();

    // Seeded branch exists locally AND on origin, descends from final V3 main,
    // and its seed head is recorded in the receipt.
    const localHead = sb.fx.g(['rev-parse', `foresift/${PKG}-g1`]).trim();
    const originHead = sb.fx.g(['rev-parse', `origin/foresift/${PKG}-g1`]).trim();
    expect(localHead).toBe(originHead);
    expect(receipt.generationSeedHead).toBe(localHead);
    expect(localHead).not.toBe(sb.baseSha);

    // Transplanted tree: product paths + renamed ADRs present…
    const changed = sb.fx
      .g(['diff', '--name-only', `${sb.baseSha}..${localHead}`])
      .split('\n')
      .filter(Boolean);
    expect(changed).toContain('packages/pkg-alpha/src/index.ts');
    expect(changed).toContain('migrations/0001_init.sql');
    expect(changed).toContain(`specs/${PKG}/tasks.md`);
    // …obsolete control plane and unreconciled prose are NOT transplanted…
    expect(changed).not.toContain('scripts/automation/OBSOLETE-SUPERVISOR.mjs');
    expect(changed).not.toContain('docs/runbook-old.md');
    // …the colliding ADR was renumbered above both sides' numbers.
    expect(changed).toContain('docs/adr/0010-colliding.md');
    expect(changed).not.toContain('docs/adr/0008-colliding.md');

    // Task reconstruction applied fail-closed inside the seeded tree (read the
    // seeded BLOB — the fixture working tree stays on main).
    const seededBlob = sb.fx.g(['show', `${localHead}:specs/${PKG}/tasks.md`]);
    expect(seededBlob).toMatch(/T002 guard decimals \(AC-002\)/);
    expect(seededBlob).toMatch(/-\s+\[ \]\s+T002.*salvage: reopened/);
    expect(seededBlob).toContain('- [x] T001 wire contracts (AC-001)');

    // Receipt counts match the reconstruction.
    expect(receipt.reusedTaskCount).toBe(2);
    expect(receipt.reopenedTaskCount).toBe(1);
    expect(receipt.remainingTaskCount).toBe(2);
    expect(receipt.reusedCommits).toBe(0);
    expect(receipt.partiallyReusedCommits).toBe(1);
    expect(receipt.rejectedCommits).toBe(0);

    // Milestone state bumped exactly once through the versioned-commit path.
    const msAfter = readMs(sb);
    const alpha = msAfter.packages.find((p: { id: string }) => p.id === PKG);
    expect(alpha.generation).toBe(1);
    expect(alpha.status).toBe('PENDING');

    // Crash-safety artifacts cleaned up: intent consumed.
    expect(() => readFileSync(join(sb.stateDir, `restart-intent-${PKG}.json`), 'utf8')).toThrow();
  });

  it('§7: second identical invocation replays the receipt and cannot create generation 2', () => {
    const r = runRestartCli(sb, [
      '--restart-package',
      PKG,
      '--fresh-generation',
      '--reason',
      'duplicate invocation immediately after success',
      '--salvage-manifest',
      manifestPath,
    ]);
    expect(r.status).toBe(0);
    const receipt = JSON.parse(r.stdout.trim());
    expect(receipt.toGeneration).toBe(1); // replayed, NOT advanced
    const msNow = readMs(sb);
    const alpha = msNow.packages.find((p: { id: string }) => p.id === PKG);
    expect(alpha.generation).toBe(1); // still 1 — no double bump
  });

  it('§30 Case B: a tracked live active run refuses the restart', () => {
    writeFileSync(
      join(sb.stateDir, 'autopilot-state.json'),
      JSON.stringify({
        activeRuns: [
          { kind: 'package', packageId: PKG, message: `${PKG}@g1`, done: false, paused: false },
        ],
        milestoneRuns: [],
        pausedFatal: null,
        history: [],
      }),
    );
    const r = runRestartCli(sb, ['--restart-package', PKG, '--fresh-generation']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/RESTART REFUSED/);
    expect(r.stderr).toMatch(/tracked active run/);
  });

  it('§30: a live CURRENT-generation run row blocks retirement', () => {
    // Clean tracking state, but the runs table shows a live gen-1 row.
    writeFileSync(
      join(sb.stateDir, 'autopilot-state.json'),
      JSON.stringify({ activeRuns: [], milestoneRuns: [], pausedFatal: null, history: [] }),
    );
    const r = runRestartCli(sb, ['--restart-package', PKG, '--fresh-generation'], {
      rows: [
        {
          id: 'r-live',
          workflow_name: 'foresift-work-package-optimized',
          user_message: `${PKG}@g1`,
          status: 'running',
        },
      ],
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/current-generation run\(s\) still live/);
  });

  it('refuses a stale intent targeting a different generation', () => {
    writeFileSync(
      join(sb.stateDir, 'autopilot-state.json'),
      JSON.stringify({ activeRuns: [], milestoneRuns: [], pausedFatal: null, history: [] }),
    );
    writeFileSync(
      join(sb.stateDir, `restart-intent-${PKG}.json`),
      JSON.stringify({
        schema: 'foresift/restart-intent@1',
        packageId: PKG,
        fromGeneration: 0,
        toGeneration: 7,
        reason: 'crashed attempt at a different target',
      }),
    );
    const r = runRestartCli(sb, ['--restart-package', PKG, '--fresh-generation']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/stale intent targets generation 7/);
    // Operator remediation after inspecting the anomaly (the command itself
    // never deletes a foreign intent — that is what makes the refusal sticky).
    rmSync(join(sb.stateDir, `restart-intent-${PKG}.json`), { force: true });
  });

  it('refuses a salvage manifest with a foreign schema BEFORE mutating anything', () => {
    const bad = join(scratch, 'bad-manifest.json');
    writeFileSync(bad, JSON.stringify({ schema: 'nope/v0', packageId: PKG }));
    const before = readMs(sb);
    const r = runRestartCli(sb, [
      '--restart-package',
      PKG,
      '--fresh-generation',
      '--salvage-manifest',
      bad,
    ]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/has schema nope\/v0/);
    expect(readMs(sb)).toEqual(before); // nothing mutated
  });

  it('requires --fresh-generation (exit 2 usage failure)', () => {
    const r = runRestartCli(sb, ['--restart-package', PKG]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/only --fresh-generation restarts are supported/);
  });

  it('--confirm-new-generation deliberately advances past the duplicate gate', () => {
    const r = runRestartCli(sb, [
      '--restart-package',
      PKG,
      '--fresh-generation',
      '--confirm-new-generation',
      '--reason',
      'deliberate second reset after generation 1 executed',
    ]);
    expect(r.status).toBe(0);
    const receipt = JSON.parse(r.stdout.trim());
    expect(receipt.toGeneration).toBe(2);
    expect(receipt.retiredGeneration).toBe(1);
    expect(receipt.generationBranch).toBe(`foresift/${PKG}-g2`);
    const alpha = readMs(sb).packages.find((p: { id: string }) => p.id === PKG);
    expect(alpha.generation).toBe(2);
  });
});

// --recover-fatal: resuming across generations must refuse (identity safety).
describe('cross-generation recover refusal', () => {
  it('refuses recovery whose paused identity is from another generation', () => {
    const sb = restartSandbox('recover-crossgen');
    writeFileSync(
      join(sb.stateDir, 'autopilot-state.json'),
      JSON.stringify({
        activeRuns: [],
        milestoneRuns: [],
        pausedFatal: {
          reason: 'fatal: provider unauthorized',
          runId: null,
          kind: 'package',
          packageId: PKG,
          workflow: 'foresift-work-package-optimized',
          branch: `foresift/${PKG}-g9`,
          message: `${PKG}@g9`,
          since: Date.now() - 1000,
        },
        history: [],
      }),
    );
    const r = runRestartCli(sb, ['--recover-fatal']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/RECOVERY REFUSED/);
    expect(r.stderr).toMatch(/paused identity is generation 9/);
    expect(r.stderr).toMatch(/--restart-package --fresh-generation/);
  });
});

function invSummary(path: string) {
  return (JSON.parse(readFileSync(path, 'utf8')) as { summary: unknown }).summary;
}
