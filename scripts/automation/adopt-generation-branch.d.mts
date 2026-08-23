export declare const ADOPTION_SCHEMA: 'foresift/generation-adoption@1';

export interface AdoptionVerdict {
  schema: 'foresift/generation-adoption@1';
  adopted: boolean;
  mode: 'LEGACY_GEN0' | 'FRESH_FROM_MAIN' | 'ADOPTED_SEED' | 'REFUSED';
  branch: string | null;
  head: string | null;
  detail?: string;
}

/** First deterministic workflow node: adopt a seeded `foresift/<id>-g<N>`
 *  branch into the fresh archon worktree (probe-proven archon never does). */
export declare function adoptGenerationBranch(opts: {
  message: string;
  repoRoot?: string;
  run?: (args: string[]) => { status: number | null; stdout?: string; stderr?: string };
}): AdoptionVerdict;
