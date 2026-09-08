// Directive 2026-09-07 (live VPS verification) — model admission preflight.

export declare const CLAUDE_INVOKABLE_MODEL_LAW: string;

/**
 * Pure admission check: can the claude-code CLI invoke this model id?
 * Fail-closed on empty/undefined and any id containing whitespace.
 */
export declare function admitModelForClaude(model: string | undefined): {
  ok: boolean;
  reason: string;
};

/**
 * Lane env builder: refuses (throws MODEL_NOT_INVOKABLE) to construct an
 * environment launching a lane against a model the CLI cannot invoke.
 */
export declare function buildLaneEnv(
  model: string,
  baseEnv?: Record<string, string>,
): Record<string, string>;
