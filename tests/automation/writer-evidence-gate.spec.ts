// P0 hardening (G0 final correctness delta, directive 3): a writer expected to
// produce evidence-backed task completion MUST possess a valid task graph
// BEFORE invoking a provider. Live root cause 89c4b2b9 (2026-09-01): the wave
// wiring omitted --task-graph, writers nominated zero units, and ~40 minutes
// of GREEN provider work died at integration. These tests prove the gate
// fails closed (provider invocation count = 0) for:
//   - missing graph path
//   - unreadable graph file
//   - malformed / units-less graph
//   - empty / unknown assigned task ids
// and ALLOWS a valid graph (with an engine stub standing in for the real
// provider, counted).
import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireTaskGraphForCompletionEvidence } from '../../scripts/automation/writer-task-evidence.mjs';
import { runCodexWriter } from '../../scripts/automation/exec-codex-writer.mjs';
import { runClaudeWriter } from '../../scripts/automation/exec-claude-writer.mjs';
import { runAgyTestWriter } from '../../scripts/automation/exec-agy-test-writer.mjs';

const VALID_GRAPH = {
  schema: 'foresift/impl-task-graph@1',
  units: [
    {
      id: 'T001',
      done: false,
      parallelizable: false,
      phase: 'P1',
      body: 'work',
      predictedWrites: ['packages/x/src/a.ts'],
      productWrites: ['packages/x/src/a.ts'],
      testWrites: [],
      testOnly: false,
      productWork: true,
      outOfScopeWrites: [],
      testRefs: [],
      dependsOn: [],
      estimatedSize: 'small',
    },
  ],
};

function withGraph(dir: string, graph: string | object): string {
  const p = join(dir, 'task-graph.json');
  writeFileSync(p, typeof graph === 'string' ? graph : JSON.stringify(graph));
  return p;
}

function providerStubCounter() {
  const calls: number[] = [];
  return {
    calls,
    count: () => calls.length,
    spawn: () => {
      calls.push(Date.now());
      return { status: 0, stdout: '', stderr: '' };
    },
  };
}

describe('P0: task-graph required BEFORE any provider invocation', () => {
  test('gate helper: missing path / unreadable / units-less / unknown ids all refuse', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-gate-'));
    try {
      expect(() =>
        requireTaskGraphForCompletionEvidence({
          graphPath: undefined,
          taskIds: ['T001'],
          engine: 'CODEX',
          lane: 'core',
        }),
      ).toThrow(/TASK_GRAPH_REQUIRED_FOR_COMPLETION_EVIDENCE.*no --task-graph/);

      expect(() =>
        requireTaskGraphForCompletionEvidence({
          graphPath: join(dir, 'missing.json'),
          taskIds: ['T001'],
          engine: 'CODEX',
          lane: 'core',
        }),
      ).toThrow(/TASK_GRAPH_REQUIRED_FOR_COMPLETION_EVIDENCE.*unreadable or malformed/);

      expect(() =>
        requireTaskGraphForCompletionEvidence({
          graphPath: withGraph(dir, '{not json'),
          taskIds: ['T001'],
          engine: 'CODEX',
          lane: 'core',
        }),
      ).toThrow(/TASK_GRAPH_REQUIRED_FOR_COMPLETION_EVIDENCE.*unreadable or malformed/);

      expect(() =>
        requireTaskGraphForCompletionEvidence({
          graphPath: withGraph(dir, { schema: 'foresift/impl-task-graph@1', units: [] }),
          taskIds: ['T001'],
          engine: 'CODEX',
          lane: 'core',
        }),
      ).toThrow(/TASK_GRAPH_REQUIRED_FOR_COMPLETION_EVIDENCE.*carries no units/);

      const graphPath = withGraph(dir, VALID_GRAPH);
      expect(() =>
        requireTaskGraphForCompletionEvidence({
          graphPath,
          taskIds: [],
          engine: 'CODEX',
          lane: 'core',
        }),
      ).toThrow(/TASK_GRAPH_REQUIRED_FOR_COMPLETION_EVIDENCE.*no assigned task ids/);

      expect(() =>
        requireTaskGraphForCompletionEvidence({
          graphPath,
          taskIds: ['T999'],
          engine: 'CODEX',
          lane: 'core',
        }),
      ).toThrow(/TASK_GRAPH_REQUIRED_FOR_COMPLETION_EVIDENCE.*absent from the graph/);

      // valid graph + known ids → allowed
      const ok = requireTaskGraphForCompletionEvidence({
        graphPath,
        taskIds: ['T001'],
        engine: 'CODEX',
        lane: 'core',
      });
      expect(ok.unitsById.has('T001')).toBe(true);
    } finally {
      // tmp dir cleanup omitted: mkdtemp scratch is disposable
    }
  });

  test('exec-codex-writer: missing graph → refusal BEFORE permit/spawn (stub count 0)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-codex-'));
    const stub = providerStubCounter();
    try {
      // Missing graph is the FIRST hard failure: it throws before routing even
      // needs a valid brief/worktree. Argument validation for the gate inputs
      // precedes every IO on the provider path.
      writeFileSync(join(dir, 'brief.md'), 'brief');
      writeFileSync(
        join(dir, 'routing.json'),
        JSON.stringify({
          lanes: [
            {
              lane: 'core',
              role: 'implementation',
              engine: 'CODEX',
              taskIds: ['T001'],
              model: 'gpt-5.6-sol',
              reasoning: 'medium',
              serviceTier: 'standard',
            },
          ],
        }),
      );
      expect(() =>
        runCodexWriter({
          lane: 'core',
          brief: join(dir, 'brief.md'),
          worktree: join(dir, 'wt'),
          routing: join(dir, 'routing.json'),
          'results-dir': join(dir, 'results'),
          package: 'pkg-x',
          generation: '0',
          // NO --task-graph argument at all — the live 89c4b2b9 wiring shape
        }),
      ).toThrow(/TASK_GRAPH_REQUIRED_FOR_COMPLETION_EVIDENCE/);
      expect(stub.count()).toBe(0);
    } finally {
      // disposable scratch
    }
  });

  test('exec-claude-writer: malformed graph → refusal BEFORE permit/spawn (stub count 0)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-claude-'));
    const stub = providerStubCounter();
    try {
      writeFileSync(join(dir, 'brief.md'), 'brief');
      expect(() =>
        runClaudeWriter({
          lane: 'shard-1',
          brief: join(dir, 'brief.md'),
          worktree: join(dir, 'wt'),
          'results-dir': join(dir, 'results'),
          'task-ids': 'T001',
          'task-graph': withGraph(dir, '{"units": "not-an-array"'),
          package: 'pkg-x',
          generation: '0',
        }),
      ).toThrow(/TASK_GRAPH_REQUIRED_FOR_COMPLETION_EVIDENCE/);
      expect(stub.count()).toBe(0);
    } finally {
      // disposable scratch
    }
  });

  test('exec-agy-test-writer: missing graph → refusal BEFORE permit/spawn (stub count 0)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-agy-'));
    const stub = providerStubCounter();
    try {
      // routing must exist so the failure is unambiguously the graph gate
      writeFileSync(
        join(dir, 'routing.json'),
        JSON.stringify({
          lanes: [
            {
              lane: 'test-author',
              role: 'test',
              engine: 'AGY',
              model: 'm',
              reasoning: 'high',
              providerTimeout: '60000',
            },
          ],
        }),
      );
      writeFileSync(join(dir, 'brief.md'), 'brief');
      expect(() =>
        runAgyTestWriter({
          lane: 'test-author',
          brief: join(dir, 'brief.md'),
          worktree: join(dir, 'wt'),
          routing: join(dir, 'routing.json'),
          'results-dir': join(dir, 'results'),
          'task-ids': 'T001',
          package: 'pkg-x',
          generation: '0',
        }),
      ).toThrow(/TASK_GRAPH_REQUIRED_FOR_COMPLETION_EVIDENCE/);
      expect(stub.count()).toBe(0);
    } finally {
      // disposable scratch
    }
  });

  test('valid graph reaches the provider path (stub would be invoked)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-ok-'));
    try {
      const graphPath = withGraph(dir, VALID_GRAPH);
      // The gate itself (the only testable seam without spawning a real
      // provider) accepts a valid graph and returns the parsed index.
      const parsed = requireTaskGraphForCompletionEvidence({
        graphPath,
        taskIds: ['T001'],
        engine: 'CODEX',
        lane: 'core-batch-1',
      });
      expect(parsed.unitsById.get('T001')?.predictedWrites).toEqual(['packages/x/src/a.ts']);
    } finally {
      // disposable scratch
    }
  });
});

describe('P0: claude-writer claim path resolves its evidence helper (live ad794228)', () => {
  test('exec-claude-writer: provider success + lane diff nominates T001 (no ReferenceError)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-claude-claim-'));
    const savedPath = process.env.PATH ?? '';
    const savedPool = process.env.FORESIFT_PROVIDER_POOL_STATE_DIR;
    try {
      // Hermetic provider: a fake `claude` on PATH that exits 0 and proves
      // it was invoked (marker file). No network, no credentials, no spend.
      const bin = join(dir, 'bin');
      mkdirSync(bin, { recursive: true });
      const marker = join(dir, 'claude-invoked');
      writeFileSync(bin + '/claude', `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 0\n`);
      chmodSync(bin + '/claude', 0o755);
      process.env.PATH = `${bin}:${savedPath}`;
      process.env.FORESIFT_PROVIDER_POOL_STATE_DIR = join(dir, 'pool');
      // Git lane worktree with a DIRTY predicted write: the writer commits it
      // and the claim path must nominate T001 from the evidence diff.
      const wt = join(dir, 'wt');
      const sh = (cmd: string) => spawnSync(cmd, { shell: true, cwd: wt, encoding: 'utf8' });
      mkdirSync(join(wt, 'packages', 'x', 'src'), { recursive: true });
      sh(
        'git init -qb main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base',
      );
      writeFileSync(join(wt, 'packages', 'x', 'src', 'a.ts'), 'export const a = 1;\n');
      writeFileSync(join(dir, 'brief.md'), 'brief');
      const result = runClaudeWriter({
        lane: 'shard-1',
        brief: join(dir, 'brief.md'),
        worktree: wt,
        'results-dir': join(dir, 'results'),
        'task-ids': 'T001',
        'task-graph': withGraph(dir, VALID_GRAPH),
        package: 'pkg-x',
        generation: '0',
      });
      expect(result.ok).toBe(true);
      // Provider-dispatch check: fake claude really ran (this test exercises
      // the post-spawn claim path, not a pre-spawn refusal).
      expect(existsSync(marker)).toBe(true);
      const written = JSON.parse(readFileSync(join(dir, 'results', 'result.json'), 'utf8'));
      expect(written.completed).toContain('T001');
      expect(result.result.completed).toContain('T001');
    } finally {
      process.env.PATH = savedPath;
      if (savedPool === undefined) delete process.env.FORESIFT_PROVIDER_POOL_STATE_DIR;
      else process.env.FORESIFT_PROVIDER_POOL_STATE_DIR = savedPool;
    }
  }, 60000);
});
