export const BUN_MIGRATION_PROOF_SCHEMA: 'foresift/bun-migration-proof@1';
export const BUN_MIGRATION_STATES: readonly string[];

export interface BunMigrationPolicy {
  migrationRequired: boolean;
  migrationId: string;
  bunVersion: string;
  barrierAfterPackage: string;
  [key: string]: unknown;
}

export interface BunMigrationProof {
  schema?: unknown;
  migrationId?: unknown;
  bunVersion?: unknown;
  testAuthority?: unknown;
  totalTestFiles?: unknown;
  verifiedFiles?: unknown;
  blockedFiles?: unknown;
  nestedFullExecutions?: unknown;
  nestedFullGuard?: { active?: unknown };
  vitestRuntimeReferences?: unknown;
  finalBunFull?: { passed?: unknown };
  nodeCompatibility?: { passed?: unknown };
  healthyMigrationCodexCalls?: unknown;
  healthyMigrationClaudeCalls?: unknown;
  [key: string]: unknown;
}

export function validateBunMigrationProof(
  proof: BunMigrationProof | null,
  policy: BunMigrationPolicy,
): { valid: boolean; reasons: string[] };

export function evaluateBunMigrationBarrier(input: {
  policy: BunMigrationPolicy;
  milestone: {
    milestoneId?: string;
    packages?: { id: string; status: string; [key: string]: unknown }[];
    [key: string]: unknown;
  } | null;
  runtimeState: { status?: string; [key: string]: unknown } | null;
  proof: BunMigrationProof | null;
}): { state: string; reason: string; proof?: BunMigrationProof };

export function loadBunMigrationInputs(root?: string): {
  policy: BunMigrationPolicy;
  proof: BunMigrationProof | null;
  proofFile: string;
};
