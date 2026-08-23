export const TARGETED_SCHEMA: 'foresift/targeted-verify@1';
export const TARGETED_RESULT_FILE: 'targeted-verify-result.json';

export const CATEGORY_COMMANDS: Record<'SPEC' | 'FORMAT' | 'LINT' | 'TYPECHECK', string>;

export function extractFailingTestFiles(
  logText: string | null | undefined,
  exists?: (p: string) => boolean,
  cwd?: string,
): string[];

export interface TargetedPlan {
  mode: 'TARGETED' | 'ESCALATE_FULL';
  reason: string;
  checks: { label: string; command: string }[];
}

export function planTargetedChecks(opts: {
  manifest: {
    schema?: unknown;
    passed?: unknown;
    checks?: { status?: unknown; category?: unknown; command?: unknown }[] | unknown;
  } | null;
  gateLogText?: string | null;
  exists?: (p: string) => boolean;
}): TargetedPlan;
