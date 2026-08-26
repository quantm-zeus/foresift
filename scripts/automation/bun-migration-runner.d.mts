import type { BunMigrationBatch, BunMigrationManifest } from './bun-migration-manifest.mjs';

export function planMigrationBatches(manifest: BunMigrationManifest): BunMigrationBatch[];
export function prepareMigration(input: {
  root: string;
  manifestFile: string;
}): BunMigrationManifest & { batches: BunMigrationBatch[] };
