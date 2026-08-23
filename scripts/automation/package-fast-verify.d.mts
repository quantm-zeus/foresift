export declare function resolveFastBase(opts: {
  repoRoot: string;
  packageId: string;
  artifactsDir: string;
  base?: string | null;
}): { baseRef: string | null; source: 'explicit' | 'checkpoint' | 'merge-base' | 'unknown' };
