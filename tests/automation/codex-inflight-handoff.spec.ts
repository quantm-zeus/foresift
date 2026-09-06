// In-flight Codex→Claude quota handoff (directive 2026-09-06, §8) + live
// 401 auth-dead misclassification (runs 56ff5563/e9631c56): a Codex lane
// invocation that ITSELF discovers provider death — daily quota exhaustion
// ("out of credits") or auth failure (401 Unauthorized / refresh-token reuse)
// — must (a) classify as a PROVIDER failure, not a semantic one, (b) latch
// the Codex pool so the next acquire denies, and (c) hand the SAME logical
// lane to Claude inside the same writer invocation instead of throwing the
// whole wave into a package-level QUOTA_DAILY park.
//
// Laws under test:
//   1. classifyCodexExit: 401/Unauthorized/refresh-token-reuse =>
//      AUTH_PROVIDER_FAILURE (never SEMANTIC_OR_PROVIDER_FAILURE).
//   2. codexProviderEvent: auth-dead detail maps to an event that latches
//      the pool unavailable (observedCodexOutcome must deny the next acquire).
//   3. runCodexWriter in-flight handoff: permit acquired → invocation fails
//     with a proven provider-death classification → SAME invocation executes
//     the Claude handoff (engine-handoff.json persisted, telemetry records
//     the handoff, no CODEX_WRITER_* throw escapes).
//   4. Fail-closed: a genuine semantic failure (no provider-death signal)
//     still throws — no handoff, no masked verdict.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { classifyCodexExit, codexProviderEvent, runCodexWriter } =
  await import('../../scripts/automation/exec-codex-writer.mjs');
let ROOT: string;

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'codex-inflight-'));
  // Isolated pool state per test: the real host pool carries live backoff
  // latches that would deny the claude acquire spuriously.
  process.env.FORESIFT_PROVIDER_POOL_STATE_DIR = join(ROOT, 'pool');
  // The lane core scans git evidence in the worktree: give it a minimal repo.
  const git = (...args: string[]) =>
    Bun.spawnSync(['git', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(ROOT, 'seed.txt'), 'seed\n');
  git('add', '.');
  git('commit', '-qm', 'seed');
});

afterEach(() => {
  try {
    rmSync(ROOT, { recursive: true, force: true });
  } catch {}
});

describe('classifyCodexExit: provider death is not a semantic failure', () => {
  test('401 Unauthorized / refresh-token reuse => AUTH_PROVIDER_FAILURE', () => {
    const authDead = {
      status: 1,
      stderr:
        'HTTP error: 401 Unauthorized, url: wss://chatgpt.com/backend-api/codex/responses\nFailed to refresh token: your refresh token was already used',
    };
    expect(classifyCodexExit(authDead)).toBe('AUTH_PROVIDER_FAILURE');
  });

  test('genuine semantic failure stays semantic (fail-closed)', () => {
    const semantic = { status: 1, stderr: 'writer failed: invalid routing table shape' };
    expect(classifyCodexExit(semantic)).toBe('SEMANTIC_OR_PROVIDER_FAILURE');
    expect(classifyCodexExit({ status: 1, stderr: '' })).toBe('SEMANTIC_OR_PROVIDER_FAILURE');
  });

  test('existing classifications preserved', () => {
    expect(classifyCodexExit({ error: { code: 'ETIMEDOUT' } })).toBe('TIMEOUT');
    expect(classifyCodexExit({ status: 0 })).toBe('SUCCESS');
    expect(classifyCodexExit({ status: 1, stderr: '429 rate limit hit' })).toBe(
      'TRANSIENT_PROVIDER_FAILURE',
    );
  });
});

describe('codexProviderEvent: auth-dead latches the pool unavailable', () => {
  test('AUTH_PROVIDER_FAILURE with 401 detail => unavailable-latch event', () => {
    const ev = codexProviderEvent(
      'AUTH_PROVIDER_FAILURE',
      'HTTP error: 401 Unauthorized\nFailed to refresh token: your refresh token was already used',
    );
    // The event must be one the pool machine treats as provider-unavailable,
    // not 'unknown' (unknown clears the latch and burns retry churn).
    expect(ev.event).toBe('unavailable');
  });

  test('quota exhaustion still latches exhausted', () => {
    const ev = codexProviderEvent(
      'SEMANTIC_OR_PROVIDER_FAILURE',
      'Your workspace is out of credits. Add credits to continue.',
    );
    expect(ev.event).toBe('exhausted');
  });
});

describe('runCodexWriter in-flight handoff: provider death executes Claude, same lane', () => {
  test('codex 401 mid-lane → handoff record + claude engine telemetry + no throw', () => {
    const resultDir = join(ROOT, 'results');
    const briefPath = join(ROOT, 'brief.md');
    const routingPath = join(ROOT, 'routing.json');
    const graphPath = join(ROOT, 'task-graph.json');
    mkdirSync(resultDir, { recursive: true });
    writeFileSync(briefPath, 'do the lane');
    writeFileSync(
      routingPath,
      JSON.stringify({
        executionProfile: 'HYBRID_AGY',
        testEngine: 'CLAUDE',
        lanes: [
          {
            lane: 'core-batch-1',
            role: 'implementation',
            engine: 'CODEX',
            model: 'gpt-5.6-sol',
            reasoning: 'high',
            serviceTier: 'standard',
            taskIds: ['T001'],
          },
        ],
      }),
    );
    writeFileSync(
      graphPath,
      JSON.stringify({ units: [{ id: 'T001', predictedWritePaths: ['packages/x/a.ts'] }] }),
    );
    // Deterministic codex death + handoff seam injection: the writer must use
    // the injected invoker (test seam) so no real codex/claude runs.
    const result = runCodexWriter({
      package: 'pkg-x',
      generation: '0',
      lane: 'core-batch-1',
      brief: briefPath,
      worktree: ROOT,
      'results-dir': resultDir,
      routing: routingPath,
      'task-graph': graphPath,
      'timeout-ms': '1000',
      'codex-invoker': () => ({
        status: 1,
        stderr:
          'HTTP error: 401 Unauthorized\nFailed to refresh token: refresh token was already used',
      }),
      'claude-invoker': () => ({ status: 0, stdout: '{}' }),
    });
    // Same logical lane completed — engine now CLAUDE.
    expect(result.ok).toBe(true);
    expect(result.result?.engine ?? result.engine).toBe('CLAUDE');
    // Durable handoff trace records the in-flight provenance.
    const handoff = JSON.parse(readFileSync(join(resultDir, 'engine-handoff.json'), 'utf8'));
    expect(handoff.from).toBe('CODEX');
    expect(handoff.to).toBe('CLAUDE');
    expect(handoff.reason).toMatch(/401|auth|unavailable|quota/i);
    // Telemetry names the executing engine.
    const tel = JSON.parse(readFileSync(join(resultDir, 'telemetry.json'), 'utf8'));
    expect(tel.engine ?? tel.implementationEngine).toBe('CLAUDE');
  });

  test('genuine semantic failure still throws (no handoff, verdict preserved)', () => {
    const resultDir = join(ROOT, 'results2');
    const briefPath = join(ROOT, 'brief2.md');
    const routingPath = join(ROOT, 'routing2.json');
    const graphPath = join(ROOT, 'graph2.json');
    mkdirSync(resultDir, { recursive: true });
    writeFileSync(briefPath, 'do the lane');
    writeFileSync(
      routingPath,
      JSON.stringify({
        executionProfile: 'HYBRID_AGY',
        testEngine: 'CLAUDE',
        lanes: [
          {
            lane: 'core-batch-2',
            role: 'implementation',
            engine: 'CODEX',
            model: 'gpt-5.6-sol',
            reasoning: 'high',
            serviceTier: 'standard',
            taskIds: ['T002'],
          },
        ],
      }),
    );
    writeFileSync(
      graphPath,
      JSON.stringify({ units: [{ id: 'T002', predictedWritePaths: ['packages/x/b.ts'] }] }),
    );
    expect(() =>
      runCodexWriter({
        package: 'pkg-x',
        generation: '0',
        lane: 'core-batch-2',
        brief: briefPath,
        worktree: ROOT,
        'results-dir': resultDir,
        routing: routingPath,
        'task-graph': graphPath,
        'timeout-ms': '1000',
        'codex-invoker': () => ({
          status: 1,
          stderr: 'writer failed: invalid routing table shape',
        }),
      }),
    ).toThrow(/CODEX_WRITER_SEMANTIC_OR_PROVIDER_FAILURE/);
    expect(existsSync(join(resultDir, 'engine-handoff.json'))).toBe(false);
  });
});
