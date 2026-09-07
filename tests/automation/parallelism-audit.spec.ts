// Directive 2026-09-06 §5 — minimal parallelism quality gate (canary).
//
// Live evidence: g1-capacity-contracts (run b659eef0) plans a serial column of
// 13 units (core-batch-3, load 21, laneTooLarge) although the graph's own
// write-truth proves most of them pairwise write-disjoint and dependency-free.
// The wave would burn provider wall clock serially on work that the plan
// itself proves could run beside it.
//
// Laws under test:
//   1. A PRODUCT unit that is NOT [P], carries NO [serial-reason: …] marker,
//      and has ≥1 sibling unit with EXACT disjoint predicted/test writes and
//      no direct dependency edge either way is a MISSED_PARALLELISM_OPPORTUNITY.
//   2. Exemptions: [P] markers, and exactly the six-vocabulary serial reasons
//      (SEMANTIC_DEPENDENCY | SHARED_FILE | ORDERED_MIGRATION | SHARED_INVARIANT |
//      COORDINATOR_BOUNDARY | SAFETY_SERIALIZATION).
//   3. Fail closed on ambiguity: empty write sets, glob writes, and shared
//      paths never count as disjointness; a non-PRODUCT unit is never flagged.
//   4. Fail closed on vocabulary: an unknown serial-reason value is a hard
//      error (exit 3 from the CLI), never silently accepted.
//   5. Wire-blindness is forbidden: the wave prep node runs the audit after
//      the pre-provider reconciliation and BEFORE briefs (structural yaml
//      proof), mirroring a machine-readable report for telemetry.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { missedParallelismOpportunities } =
  await import('../../scripts/automation/parallelism-audit.mjs');

let ROOT: string;

// productUnits declare BOTH write columns (predictedWrites like the graph
// builder emits, productWrites like the filter uses) unless overridden.
function productUnit(id: string, writes: string[], extra: Record<string, unknown> = {}) {
  const { productWrites = writes, ...rest } = extra as {
    productWrites?: string[];
  };
  return {
    id,
    done: false,
    executor: 'PRODUCT',
    parallelizable: false,
    body: id,
    predictedWrites: writes,
    productWrites,
    ...rest,
  };
}

function unit(id: string, executor: string, writes: string[], extra: Record<string, unknown> = {}) {
  return {
    id,
    done: false,
    executor,
    parallelizable: false,
    body: id,
    ...extra,
    productWrites: executor === 'PRODUCT' ? writes : [],
    predictedWrites: writes,
  };
}

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'parallelism-audit-'));
});

afterEach(() => {
  try {
    rmSync(ROOT, { recursive: true, force: true });
  } catch {}
});

describe('missedParallelismOpportunities: the write-truth parallelism law', () => {
  test('flags a non-[P] product unit that has a disjoint independent sibling', () => {
    const units = [
      productUnit('T001', ['packages/a/src/x.ts']),
      productUnit('T002', ['packages/b/src/y.ts']),
    ];
    const missed = missedParallelismOpportunities({ units });
    expect(missed.map((m: { taskId: string }) => m.taskId).sort()).toEqual(['T001', 'T002']);
    expect(missed[0].disjointWith).toContain('T002');
  });

  test('exempt: [P] units are never flagged', () => {
    // T001 is [P] — never flagged itself. T002 stays serial with a legal
    // disjoint sibling (the [P] unit), so T002 IS a missed opportunity: the
    // [P] exemption covers only the flagged unit, not its siblings.
    const units = [
      productUnit('T001', ['packages/a/src/x.ts'], { parallelizable: true }),
      productUnit('T002', ['packages/b/src/y.ts']),
    ];
    const missed = missedParallelismOpportunities({ units });
    expect(missed.map((m: { taskId: string }) => m.taskId)).toEqual(['T002']);
    expect(missed[0].disjointWith).toEqual(['T001']);
  });

  test('exempt: each of the six serial-reason vocabulary values', () => {
    const reasons = [
      'SEMANTIC_DEPENDENCY',
      'SHARED_FILE',
      'ORDERED_MIGRATION',
      'SHARED_INVARIANT',
      'COORDINATOR_BOUNDARY',
      'SAFETY_SERIALIZATION',
    ];
    for (const reason of reasons) {
      const units = [
        productUnit('T001', ['packages/a/src/x.ts'], {
          body: `T001 [serial-reason: ${reason}]`,
        }),
        productUnit('T002', ['packages/b/src/y.ts'], {
          body: `T002 [serial-reason: ${reason}]`,
        }),
      ];
      const missed = missedParallelismOpportunities({ units });
      expect(missed.map((m: { taskId: string }) => m.taskId)).toEqual([]);
    }
  });

  test('fail closed: unknown serial-reason value is a hard error', () => {
    const units = [
      productUnit('T001', ['packages/a/src/x.ts'], {
        body: 'T001 [serial-reason: BECAUSE_I_FELT_LIKE_IT]',
      }),
      productUnit('T002', ['packages/b/src/y.ts']),
    ];
    expect(() => missedParallelismOpportunities({ units })).toThrow(/SERIAL_REASON_UNKNOWN/);
  });

  test('fail closed: overlapping writes are never "disjoint"', () => {
    const units = [
      productUnit('T001', ['packages/a/src/x.ts', 'packages/shared.ts']),
      productUnit('T002', ['packages/b/src/y.ts', 'packages/shared.ts']),
    ];
    const missed = missedParallelismOpportunities({ units });
    expect(missed).toEqual([]);
  });

  test('fail closed: empty write sets never count as disjointness', () => {
    const units = [productUnit('T001', ['packages/a/src/x.ts']), unit('T002', 'COORDINATOR', [])];
    const missed = missedParallelismOpportunities({ units });
    expect(missed).toEqual([]);
  });

  test('fail closed: glob writes are ambiguous and never pair', () => {
    const units = [
      productUnit('T001', ['packages/a/src/*.ts']),
      productUnit('T002', ['packages/b/src/y.ts']),
    ];
    const missed = missedParallelismOpportunities({ units });
    expect(missed).toEqual([]);
  });

  test('fail closed: a dependency edge in either direction defeats the pairing', () => {
    const units = [
      productUnit('T001', ['packages/a/src/x.ts'], { dependsOn: ['T002'] }),
      productUnit('T002', ['packages/b/src/y.ts']),
    ];
    expect(
      missedParallelismOpportunities({ units }).map((m: { taskId: string }) => m.taskId),
    ).toEqual([]);

    const units2 = [
      productUnit('T001', ['packages/a/src/x.ts']),
      productUnit('T002', ['packages/b/src/y.ts'], { dependsOn: ['T001'] }),
    ];
    expect(
      missedParallelismOpportunities({ units: units2 }).map((m: { taskId: string }) => m.taskId),
    ).toEqual([]);
  });

  test('non-PRODUCT executors are never flagged; done units are out of scope', () => {
    const units = [
      unit('T001', 'TEST', ['tests/a/x.spec.ts']),
      unit('T002', 'COORDINATOR', ['evidence/m.json'], { productWrites: ['evidence/m.json'] }),
      productUnit('T003', ['packages/a/src/z.ts'], { done: true }),
      productUnit('T004', ['packages/b/src/w.ts']),
    ];
    const missed = missedParallelismOpportunities({ units });
    expect(missed.map((m: { taskId: string }) => m.taskId)).toEqual([]);
  });

  test('a [P] product unit is still missed when its only sibling is a TEST-executor unit', () => {
    // TEST-executor lanes are scheduled separately (AGY test-author) — a
    // product unit serial because it lacks a PRODUCT sibling to pair with is a
    // planning defect the plan must own: T001 [P] is fine, but T003's only
    // potential sibling is non-PRODUCT, so the serial T003 IS missed.
    const units = [
      productUnit('T001', ['packages/a/src/x.ts']),
      unit('T002', 'TEST', ['tests/a/x.spec.ts']),
      productUnit('T003', ['packages/c/src/z.ts']),
      productUnit('T004', ['packages/b/src/w.ts']),
    ];
    const missed = missedParallelismOpportunities({ units });
    expect(missed.map((m: { taskId: string }) => m.taskId).sort()).toEqual([
      'T001',
      'T003',
      'T004',
    ]);
    expect(missed.find((m: { taskId: string }) => m.taskId === 'T001')!.disjointWith).toEqual([
      'T003',
      'T004',
    ]);
  });
});

describe('CLI + production wiring', () => {
  test('CLI mirrors a machine-readable report', () => {
    const graph = {
      units: [
        productUnit('T001', ['packages/a/src/x.ts']),
        productUnit('T002', ['packages/b/src/y.ts']),
      ],
    };
    const graphPath = join(ROOT, 'task-graph.json');
    const reportPath = join(ROOT, 'parallelism-audit.json');
    writeFileSync(graphPath, JSON.stringify(graph));
    const r = Bun.spawnSync(
      [
        'node',
        join(import.meta.dir, '..', '..', 'scripts', 'automation', 'parallelism-audit.mjs'),
        '--graph',
        graphPath,
        '--report',
        reportPath,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    expect(r.exitCode).toBe(0);
    const persisted = JSON.parse(readFileSync(reportPath, 'utf8'));
    expect(persisted.schema).toBe('foresift/parallelism-audit@1');
    expect(persisted.missed.map((m: { taskId: string }) => m.taskId).sort()).toEqual([
      'T001',
      'T002',
    ]);
  });

  test('CLI exits 3 on an unknown serial-reason value (fail-closed)', () => {
    const graph = {
      units: [
        productUnit('T001', ['packages/a/src/x.ts'], { body: 'T001 [serial-reason: BOGUS]' }),
        productUnit('T002', ['packages/b/src/y.ts']),
      ],
    };
    const graphPath = join(ROOT, 'task-graph.json');
    writeFileSync(graphPath, JSON.stringify(graph));
    const r = Bun.spawnSync(
      [
        'node',
        join(import.meta.dir, '..', '..', 'scripts', 'automation', 'parallelism-audit.mjs'),
        '--graph',
        graphPath,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    expect(r.exitCode).toBe(3);
  });

  test('sharded-wave prep runs the audit after reconciliation and before briefs', () => {
    const yaml = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        '.archon',
        'workflows',
        'foresift',
        'foresift-sharded-wave.yaml',
      ),
      'utf8',
    );
    const prepStart = yaml.indexOf('  - id: prep');
    const prepEnd = yaml.indexOf('\n  - id: brief-serial-1', prepStart);
    const prep = yaml.slice(prepStart, prepEnd);
    const reconciler = prep.indexOf('pre-provider-reconciliation.mjs');
    const audit = prep.indexOf('parallelism-audit.mjs');
    const briefBuild = prep.indexOf('build-writer-briefs.mjs');
    expect(audit).toBeGreaterThan(reconciler);
    expect(briefBuild).toBeGreaterThan(audit);
  });
});
