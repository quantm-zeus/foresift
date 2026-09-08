// Directive 2026-09-07 (live VPS verification) — ownership-routing preflight.
//
// Live evidence (run b659eef086310d5a0c41696786bfadf9, g1-capacity-contracts):
//   - writer-serial-1 and writer-serial-2 died ×3 each on
//     CLAUDE_TEST_OWNERSHIP_VIOLATION: their assigned tasks (T001/T004-class)
//     bundle colocated tests with product code, so an implementation lane's
//     evidence diff inevitably contains TEST-owned paths and the guard legally
//     refuses the lane AFTER the provider spend is sunk.
//   - core-batch-3 attempt-3 landed T020 with tests/telemetry-catalog.spec.ts
//     and died on the same guard at lane end — after result.json claimed SUCCESS.
//   - Lane commits were authored with the ambient git identity
//     (TA MINH QUAN) instead of the lane identity.
//   - The lane also burned wall clock against a model id claude-code rejects
//     client-side (OpenCode Zen/muse-spark-1.3-contributor-free,
//     [claude-code:unrecognized_model]).
//
// Laws under test:
//   1. implementationAdmissionErrors(graph): every OPEN unit assigned to an
//      implementation shard whose TEST-classified writes exist (testWrites ∪
//      predictedWrites test paths) is a hard, deterministic preflight error —
//      fail BEFORE any writer brief/dispatch, with a message naming the unit,
//      the violating paths, and the fix (split test work into a test-owned
//      task). Coordinator tasks ([executor: COORDINATOR]) are exempt: the
//      coordinator owns mechanical test-manifest bookkeeping by law.
//   2. A plan whose implementation lanes are all clean produces no errors —
//      pure audit, no mutation.
//   3. The graph builder invokes the admission audit at build time (before
//      emitting the graph), so an unschedulable plan fails at prep, before
//      any provider spend (structural proof: builder source contains the call
//      before the emit block).
//   4. laneGitIdentity(worktree): worktree creation must pin a repo-local
//      lane identity so every lane commit carries it (pure function contract
//      test on the command list).
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { implementationAdmissionErrors } =
  await import('../../scripts/automation/ownership-preflight.mjs');
const { laneGitIdentityCommands } =
  await import('../../scripts/automation/ownership-preflight.mjs');

function unit(id: string, extra: Record<string, unknown> = {}) {
  return { id, done: false, executor: 'PRODUCT', ...extra };
}

describe('implementationAdmissionErrors: test writes never route to implementation lanes', () => {
  test('flags an implementation unit whose testWrites are non-empty', () => {
    const graph = {
      units: [
        unit('T001', {
          predictedWrites: ['packages/a/src/x.ts'],
          testWrites: ['packages/a/test/x.spec.ts'],
        }),
      ],
      shards: [{ id: 'core', mode: 'serial', units: ['T001'] }],
    };
    const errs = implementationAdmissionErrors(graph);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('T001');
    expect(errs[0]).toContain('packages/a/test/x.spec.ts');
    expect(errs[0]).toContain('test-owned');
  });

  test('flags a test path hiding in predictedWrites (misclassified body)', () => {
    const graph = {
      units: [
        unit('T004', {
          predictedWrites: ['packages/shared-schemas/test/capacity.spec.ts'],
          testWrites: [],
        }),
      ],
      shards: [{ id: 'core-batch-2', mode: 'serial', units: ['T004'] }],
    };
    const errs = implementationAdmissionErrors(graph);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('T004');
    expect(errs[0]).toContain('test-owned');
  });

  test('clean implementation lanes produce no errors (pure audit)', () => {
    const graph = {
      units: [
        unit('T009', {
          predictedWrites: ['packages/cost-router/src/budget-policy.ts'],
          testWrites: [],
        }),
      ],
      shards: [{ id: 'core', mode: 'serial', units: ['T009'] }],
    };
    expect(implementationAdmissionErrors(graph)).toEqual([]);
  });

  test('coordinator executor units are exempt (mechanical bookkeeping is coordinator-owned)', () => {
    const graph = {
      units: [
        unit('T022', {
          executor: 'COORDINATOR',
          predictedWrites: ['evidence/bun-migration/bun-migration-manifest.json'],
          testWrites: [],
        }),
      ],
      shards: [],
    };
    expect(implementationAdmissionErrors(graph)).toEqual([]);
  });

  test('test-written units NOT in an implementation shard are out of scope', () => {
    const graph = {
      units: [
        unit('T018', {
          predictedWrites: ['tests/acceptance/AC-101.spec.ts'],
          testWrites: ['tests/acceptance/AC-101.spec.ts'],
        }),
      ],
      shards: [], // test lanes carry them; no implementation shard references T018
    };
    expect(implementationAdmissionErrors(graph)).toEqual([]);
  });

  test('live-run regression: batch-3 unit writing tests/telemetry-catalog.spec.ts is flagged', () => {
    const graph = {
      units: [
        unit('T020', {
          predictedWrites: ['telemetry/cost.catalog.json', 'tests/telemetry-catalog.spec.ts'],
          testWrites: [],
        }),
      ],
      shards: [{ id: 'core-batch-3', mode: 'serial', units: ['T020'] }],
    };
    const errs = implementationAdmissionErrors(graph);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('tests/telemetry-catalog.spec.ts');
  });
});

describe('laneGitIdentityCommands: lane commits carry the lane identity', () => {
  test('returns the two repo-local config commands with the lane identity', () => {
    const cmds = laneGitIdentityCommands('core-batch-3');
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toMatch(/config user\.name/);
    expect(cmds.join(' ')).toContain('core-batch-3');
    expect(cmds.join(' ')).toContain('noreply@foresift.local');
  });
});

describe('production wiring: the graph builder fails the plan BEFORE provider spend', () => {
  test('build-implementation-task-graph.mjs invokes the admission audit before emitting', () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'scripts',
        'automation',
        'build-implementation-task-graph.mjs',
      ),
      'utf8',
    );
    const auditCall = src.indexOf('assertImplementationAdmission');
    const emit = src.indexOf('const graph = {');
    expect(auditCall).toBeGreaterThan(-1);
    expect(emit).toBeGreaterThan(auditCall);
  });
});
