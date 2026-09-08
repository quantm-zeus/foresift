// Directive 2026-09-07 (live VPS verification) — model admission preflight.
//
// Live evidence (run b659eef0): the lane burned wall clock against
// "OpenCode Zen/muse-spark-1.3-contributor-free", a model id claude-code
// rejects CLIENT-side ([claude-code:unrecognized_model] at
// generate_session_title). The gateway would have routed it fine — the
// refusal happens inside the CLI before any request leaves. A model id the
// invoking binary cannot recognize must never be admitted to a lane.
//
// Laws under test:
//   1. A model id containing a whitespace-separated provider prefix with a
//      space (e.g. "OpenCode Zen/x") is UNADMITTABLE for claude-code —
//      claude-code's client-side model parser rejects ids containing spaces.
//   2. The classic claude model ids (claude-*), plain ids without spaces, and
//      gateway ids of the form "vendor/model" are admissible.
//   3. admitModelForClaude(model) returns { ok, reason } — fail-closed on any
//      id claude-code demonstrably cannot invoke; the reason names the law.
//   4. buildLaneEnv(model, env): the lane env the writer hands the CLI must
//      never carry an unadmittable id — it throws instead of launching a lane
//      that can only burn its ceiling.
import { describe, test, expect } from 'bun:test';

const { admitModelForClaude, buildLaneEnv, CLAUDE_INVOKABLE_MODEL_LAW } =
  await import('../../scripts/automation/model-admission.mjs');

describe('admitModelForClaude: no model id claude-code cannot invoke reaches a lane', () => {
  test('rejects ids with spaces (live b659eef0 unrecognized_model regression)', () => {
    const r = admitModelForClaude('OpenCode Zen/muse-spark-1.3-contributor-free');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('space');
    expect(r.reason).toContain(CLAUDE_INVOKABLE_MODEL_LAW);
  });

  test('accepts canonical claude ids and vendor/model ids without spaces', () => {
    for (const m of [
      'claude-opus-4-8',
      'claude-haiku-4-5',
      'B.AI/glm-5.3-flash',
      'openrouter/z-ai/glm-5.3-flash',
    ]) {
      const r = admitModelForClaude(m);
      expect(r.ok).toBe(true);
    }
  });

  test('rejects empty/undefined models (fail closed)', () => {
    expect(admitModelForClaude('').ok).toBe(false);
    expect(admitModelForClaude(undefined).ok).toBe(false);
  });

  test('buildLaneEnv throws on an unadmittable model instead of launching a doomed lane', () => {
    expect(() =>
      buildLaneEnv('OpenCode Zen/muse-spark-1.3-contributor-free', {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:3456',
      }),
    ).toThrow(/MODEL_NOT_INVOKABLE/);
  });

  test('buildLaneEnv passes admittable models through with the base env intact', () => {
    const env = buildLaneEnv('B.AI/glm-5.3-flash', {
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:3456',
      PATH: '/usr/bin',
    });
    expect(env.ANTHROPIC_MODEL).toBe('B.AI/glm-5.3-flash');
    expect(env.PATH).toBe('/usr/bin');
  });
});
