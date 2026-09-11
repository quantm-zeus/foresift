/**
 * Root-lockfile workspace-registration classifier (see wave-guard-lockfile.mjs
 * for the full law comment): the wave guard admits pnpm-lock.yaml ONLY when
 * the base..head diff is a pure additive importer-block registration that
 * exactly mirrors an existing package.json at head.
 */
export declare function lockfileWorkspaceRegistrationOnly(
  diffText: string,
  headWorktree: string,
  gitFn?: (cmd: string) => { ok: boolean; out: string },
): boolean;
