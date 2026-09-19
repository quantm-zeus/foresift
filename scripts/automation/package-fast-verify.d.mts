export declare function resolveFastBase(opts: {
  repoRoot: string;
  packageId: string;
  artifactsDir: string;
  base?: string | null;
}): { baseRef: string | null; source: 'explicit' | 'checkpoint' | 'merge-base' | 'unknown' };

export declare interface VitestRelatedStep {
  kind: string;
  files: string[];
  database?: boolean;
}

export declare function runVitestRelatedStep(
  step: VitestRelatedStep,
  deps?: {
    repoRoot: string;
    sh?: (
      repoRoot: string,
      cmd: string,
      args: string[],
    ) => {
      command: string;
      result: string;
      stdoutTail?: string;
    };
  },
): {
  logs: string[];
  result?: { command: string; result: string; stdoutTail?: string };
  escalateReason?: string;
};
