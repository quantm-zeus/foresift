export const LAND_RESULT_SCHEMA: 'foresift/final-land@1';
export const LAND_RESULT_FILE: 'land-result.json';

export interface FinalLandResult {
  schema: 'foresift/final-land@1';
  merged: boolean;
  reason: string | null;
  packageId: string;
  branch: string;
  prNumber: number | null;
  gateMode?: 'ATTESTATION_REUSE' | 'FULL_RUN';
  fullGateExitCode?: number;
  landerExitCode?: number;
  timestamp: string;
}

export function runFinalLand(
  args: {
    package?: string;
    branch?: string;
    artifactsDir?: string;
    repoRoot?: string;
    deadlineS?: string;
  },
  deps?: {
    gateCheck?: (o: { packageId: string; artifactsDir: string }) => { status: number | null };
    gateRun?: (o: { packageId: string; artifactsDir: string }) => { status: number | null };
    lander?: (o: { branch: string; title: string; bodyFile: string; deadlineS?: string }) => {
      status: number | null;
      stdout?: string;
    };
    admission?: (branch: string) => AdmissionVerdict;
    now?: () => string;
  },
): { ok: boolean; usage?: boolean };

/** V3-D §11 base-drift admission probe. Advisory when the environment cannot
 *  prove anything (no remote/offline): the mechanical lander stays the
 *  authoritative fail-closed enforcement point. */
export interface AdmissionVerdict {
  ok: boolean;
  advisory?: boolean;
  reason?: string;
  detail?: string;
}
export declare function assessFinalLandAdmission(branch: string, cwd?: string): AdmissionVerdict;
