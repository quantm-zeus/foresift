export const PR_NUMBER_FILE: '.pr-number';

export function composePrBody(opts: {
  packageId: string;
  repoRoot?: string;
  artifactsDir: string;
}): { title: string; body: string };

export function ensurePullRequest(opts: {
  branch: string;
  title: string;
  bodyFile: string;
  run?: (cmd: string, args: string[], opts?: object) => string;
}): { prNumber: string; created: boolean };
