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
export declare const TEST_MEMORY_HIGH_DEFAULT: string;
export declare const TEST_MEMORY_MAX_DEFAULT: string;
export declare function testMemoryBounds(
  policy?: Record<string, unknown>,
  env?: Record<string, string | undefined>,
): { high: string; max: string };
export declare function systemdUserScopeAvailable(
  run?: (cmd: string, args: string[], opts?: Record<string, unknown>) => { status: number | null },
): boolean;
export declare function buildGroupCommand(input: {
  bun: string;
  args: string[];
  bounds: { high: string; max: string };
  scoped: boolean;
  unit: string;
}): { command: string[]; scoped: boolean; unit: string | null };
export function runBunTestPlan(input: {
  root: string;
  plan: BunTestGroup[];
  policy: Record<string, unknown>;
  bun?: string;
  spawn?: ((cmd: string, args: string[], opts?: Record<string, unknown>) => unknown) | null;
}): { ok: boolean; wallTimeMs: number; results: unknown[]; [key: string]: unknown };
