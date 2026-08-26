import type { BunMigrationManifest } from './bun-migration-manifest.mjs';

export interface BunTestGroup {
  id: string;
  workload: string;
  files: string[];
  fileWorkers: number;
  testConcurrency: number;
}

export function buildBunTestPlan(
  manifest: BunMigrationManifest,
  policy: Record<string, unknown>,
  requestedPaths?: string[] | null,
  workloads?: string[] | null,
): BunTestGroup[];
export function bunTestArgs(group: BunTestGroup, policy: Record<string, unknown>): string[];
export function runBunTestPlan(input: {
  root: string;
  plan: BunTestGroup[];
  policy: Record<string, unknown>;
  bun?: string;
}): { ok: boolean; wallTimeMs: number; results: unknown[]; [key: string]: unknown };
