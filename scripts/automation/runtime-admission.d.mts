export declare function providersForProfile(profile: string): Array<'claude' | 'codex' | 'agy'>;
export declare function supervisorProvidersForProfile(): Array<never>;
export declare function productEnginesForProfile(profile: string): Array<'claude' | 'codex'>;
export declare function admitPackageLaunch(
  stateDir: string,
  pkg: { id: string; writeScopes?: string[] } | null | undefined,
  executionProfile: string,
  opts?: { now?: number },
): {
  ok: boolean;
  providers: Array<'claude' | 'codex' | 'agy'>;
  fallback: Array<'claude' | 'codex' | 'agy'>;
  leases: string[];
  reason: string;
};
export declare function releasePackageRuntime(
  stateDir: string,
  entry:
    { providers?: string[]; packageId?: string | null; runId?: string | null } | null | undefined,
): { providers: string[]; leases: number };
