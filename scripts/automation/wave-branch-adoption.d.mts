// Type declarations for wave-branch-adoption.mjs (sharded-wave continuation
// adoption of the launched package branch).

export declare const ADOPTION_SCHEMA: 'foresift/wave-branch-adoption@1';

export declare function waveAdoptLaunchBranch(opts: {
  message: string;
  repoRoot?: string;
  run?: ((args: string[]) => { status: number; stdout?: string; stderr?: string }) | null;
}): {
  schema: 'foresift/wave-branch-adoption@1';
  adopted: boolean;
  mode: 'REFUSED' | 'FRESH_FROM_MAIN' | 'ADOPTED_SEED' | 'ADOPTED_WITH_MAIN_ABSORBED';
  branch: string | null;
  head: string | null;
  detail?: string;
  mergedMain?: string;
};
