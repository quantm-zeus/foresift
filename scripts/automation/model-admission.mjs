// Model admission preflight (directive 2026-09-07, live VPS verification).
//
// Live evidence (run b659eef0): a lane burned wall clock against
// "OpenCode Zen/muse-spark-1.3-contributor-free", a model id the claude-code
// CLI rejects CLIENT-side ([claude-code:unrecognized_model] at
// generate_session_title) — the gateway would have routed it, but the refusal
// happens inside the binary before any request leaves. Provider/model routing
// must therefore admit only ids the INVOKING binary can actually address:
//
//   LAW: claude-code's client-side model parser rejects any id containing a
//   whitespace character. An id with a space can never be invoked by the CLI
//   and is refused here, before a lane exists to burn its ceiling on it.
//
//   admitModelForClaude(model) → { ok, reason }   (pure, fail-closed)
//   buildLaneEnv(model, baseEnv) → env            (throws MODEL_NOT_INVOKABLE)
export const CLAUDE_INVOKABLE_MODEL_LAW =
  'claude-code rejects model ids containing whitespace client-side (unrecognized_model)';

/**
 * Pure admission check: can the claude-code CLI invoke this model id?
 * Fail-closed on empty/undefined and on any id the CLI's own parser provably
 * refuses (whitespace). Vendor-prefixed ids without spaces (B.AI/x,
 * openrouter/a/b) are admissible — the gateway routes them.
 */
export function admitModelForClaude(model) {
  if (typeof model !== 'string' || model.trim() === '') {
    return { ok: false, reason: `empty model id — ${CLAUDE_INVOKABLE_MODEL_LAW}` };
  }
  if (/\s/.test(model)) {
    return {
      ok: false,
      reason: `model id "${model}" contains a space — ${CLAUDE_INVOKABLE_MODEL_LAW}`,
    };
  }
  return { ok: true, reason: 'admissible' };
}

/**
 * Lane env builder: refuses to construct an environment that would launch a
 * lane against a model the CLI cannot invoke (live b659eef0: 90m lanes burned
 * to their ceiling on an uninvokable id). Throws MODEL_NOT_INVOKABLE.
 */
export function buildLaneEnv(model, baseEnv = {}) {
  const admission = admitModelForClaude(model);
  if (!admission.ok) {
    throw new Error(`MODEL_NOT_INVOKABLE: ${admission.reason}`);
  }
  return { ...baseEnv, ANTHROPIC_MODEL: model };
}
