export const BUN_MIGRATION_MANIFEST_SCHEMA: 'foresift/bun-migration-manifest@1';
export const BUN_DIRECT_IMPORTS: ReadonlySet<string>;

export interface BunMigrationEntry {
  path: string;
  package?: string;
  bytes?: number;
  lines?: number;
  sha256?: string;
  imports?: string[];
  vitestImports?: string[];
  features?: string[];
  workload: string;
  migrationType?: string;
  state: string;
  [key: string]: unknown;
}

export interface BunMigrationBatch {
  id: string;
  engine: string;
  state: string;
  files: string[];
  workload?: string;
  codexCalls?: number;
  claudeCalls?: number;
  verification?: {
    ok: boolean;
    wallTimeMs?: number;
    results?: unknown[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface BunMigrationManifest {
  schema: string;
  migrationId?: string;
  totalTestFiles?: number;
  files: BunMigrationEntry[];
  batches?: BunMigrationBatch[];
  [key: string]: unknown;
}

export function isTestFile(path: string): boolean;
export function analyzeTestFile(
  root: string,
  path: string,
  previous?: BunMigrationEntry | null,
): BunMigrationEntry;
export function buildBunMigrationManifest(input?: {
  root?: string;
  previousFile?: string | null;
}): BunMigrationManifest;
