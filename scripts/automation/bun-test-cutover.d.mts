import type { BunMigrationManifest } from './bun-migration-manifest.mjs';

export function activeVitestRuntimeReferences(root: string): string[];
export function assertMigrationReady(root: string, manifestFile: string): BunMigrationManifest;
export function applyBunCutover(input: { root: string; manifestFile: string }): {
  manifest: BunMigrationManifest;
  references: string[];
  bunVersion: string;
};
