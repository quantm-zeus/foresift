/* eslint-disable @typescript-eslint/no-explicit-any */
export const PROVIDER_POOL_SCHEMA: string;
export declare const CODEX_QUOTA_STATES: readonly string[];
export declare function createProviderPools(policy?: Record<string, unknown>): Record<string, any>;
export declare function acquirePermit(
  stateDir: string,
  provider: 'claude' | 'codex' | 'agy',
  opts?: { now?: number },
): { ok: boolean; waitMs: number; reason: string | null };
export declare function releasePermit(
  stateDir: string,
  provider: 'claude' | 'codex' | 'agy',
): { active: number };
export declare function observeClaudeOutcome(
  stateDir: string,
  event: { healthy: boolean; retryAfterMs?: number | null; now?: number },
): { limit: number; active: number; backoffUntil: number };
export declare function observeCodexOutcome(
  stateDir: string,
  event: { event: string; resetAt?: number | null; now?: number },
): { quotaState: string; resetAt: number | null; previous: string };
export declare function providerAdmissionView(
  stateDir: string,
  opts?: {
    now?: number;
  },
): Record<string, { limit: number; active: number; state: string; blocked: boolean }>;
export declare function acquireLanePermit(
  stateDir: string,
  holder: string,
  provider: 'claude' | 'codex' | 'agy',
  opts?: {
    now?: number;
    packageId?: string | null;
    generation?: number | null;
    laneId?: string | null;
    pid?: number | null;
    runId?: string | null;
  },
): {
  ok: boolean;
  waitMs: number;
  reason: string | null;
  holder: string;
  alreadyHeld?: boolean;
};
export declare function releaseLanePermit(
  stateDir: string,
  holder: string,
  provider: 'claude' | 'codex' | 'agy',
): { released: 0 | 1; active: number | undefined };
export declare function reconcileLaneHolders(
  stateDir: string,
  liveProofFn?: (record: Record<string, any>, key: string) => boolean | null,
): { released: string[]; kept: string[]; unknown: string[] };
export declare function holderRegistryView(
  stateDir: string,
  liveProofFn?: (record: Record<string, any>, key: string) => boolean | null,
): Record<string, Record<string, any> & { liveness: boolean | null }>;
export declare function resolvePoolStateDir(env?: Record<string, string | undefined>): string;
