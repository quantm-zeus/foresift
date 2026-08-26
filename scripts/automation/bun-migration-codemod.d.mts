import type { BunMigrationEntry, BunMigrationManifest } from './bun-migration-manifest.mjs';

export function migrateMechanicalFile(
  root: string,
  entry: BunMigrationEntry,
  options?: { write?: boolean },
): { path: string; changed: boolean; output: string };
export function runMechanicalCodemod(input: {
  root: string;
  manifest: BunMigrationManifest;
  paths?: string[] | null;
  write?: boolean;
}): { changed: string[]; unchanged: string[] };
