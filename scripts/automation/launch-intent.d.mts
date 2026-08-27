// launch-intent.d.mts — Type declarations for package launch intent.

export declare const LAUNCH_INTENTS_DIR_NAME: string;

export interface LaunchIntent {
  schema: 'foresift/launch-intent@1';
  intentId: string;
  packageId: string;
  generation: number;
  executionProfile: string;
  workflow: string;
  branch: string;
  sourceSha?: string | null;
  runId: string | null;
  status: 'INTENT_DURABLE' | 'RUN_ASSOCIATED' | 'MERGED' | 'FAILED' | 'RECONCILIATION_BLOCKED';
  mergedSha?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function createLaunchIntent(
  stateDir: string,
  opts: {
    packageId: string;
    generation?: number;
    executionProfile?: string;
    workflow: string;
    branch: string;
    sourceSha?: string | null;
  },
): LaunchIntent;

export function readIntent(stateDir: string, intentId: string): LaunchIntent | null;

export function associateRunIdWithIntent(
  stateDir: string,
  intentId: string,
  runId: string,
): LaunchIntent;

export function markIntentComplete(
  stateDir: string,
  intentId: string,
  mergedSha?: string | null,
): LaunchIntent | null;

export function discoverPendingLaunchIntents(stateDir: string): LaunchIntent[];

export function isPackageLaunchInFlight(stateDir: string, packageId: string): boolean;

export function runMatchesLaunchIntent(intent: LaunchIntent, run: Record<string, unknown>): boolean;

export function reconcileLaunchIntentsOnStartup(
  stateDir: string,
  opts?: {
    archonRuns?: Record<string, unknown>[];
    milestoneState?: Record<string, unknown> | null;
    log?: (msg: string) => void;
  },
): { adopted: LaunchIntent[]; dangling: LaunchIntent[] };
