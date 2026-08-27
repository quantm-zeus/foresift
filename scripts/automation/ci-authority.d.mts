export const STATE_ONLY_WHITELIST: readonly RegExp[];
export const REQUIRED_CHECK_NAME: string;

export interface WhitelistValidationResult {
  allowed: boolean;
  reason?: string;
  violations?: string[];
}

export interface CiCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface CiStatusResult {
  ok: boolean;
  state: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'MISSING' | 'API_ERROR';
  sha: string;
  check?: CiCheckRun;
  reason?: string;
  failureSummary?: string;
  allChecks?: CiCheckRun[];
}

export interface MainCiStatusResult {
  ok: boolean;
  state: 'GREEN' | 'RED' | 'PENDING' | 'MISSING' | 'API_ERROR';
  sha?: string;
  reason?: string;
  advisory?: boolean;
  verdict?: CiStatusResult;
}

export interface ClassifiedCiFailure {
  category: 'FORMAT' | 'LINT' | 'TYPECHECK' | 'TESTS' | 'SPEC' | 'INFRA';
  repairable: boolean;
  failedFiles: string[];
  summary: string;
}

export interface CiIncidentRecord {
  filePath: string;
  capsule: {
    schema: string;
    incidentId: string;
    sha: string;
    url: string | null;
    classification: ClassifiedCiFailure;
    capturedAt: string;
  };
}

export function validateDirectMainPushWhitelist(
  paths: string[],
  whitelist?: readonly RegExp[],
): WhitelistValidationResult;

export function getExactHeadCiStatus(opts: {
  sha: string;
  repo?: string;
  checkName?: string;
  ghFn?: (args: string[]) => { ok: boolean; stdout: string; stderr?: string };
}): CiStatusResult;

export function getMainCiStatus(opts?: {
  repo?: string;
  cwd?: string;
  checkName?: string;
  gitFn?: (cmd: string) => { ok: boolean; stdout: string; stderr?: string };
  ghFn?: (args: string[]) => { ok: boolean; stdout: string; stderr?: string };
}): MainCiStatusResult;

export function classifyCiFailure(logText: string): ClassifiedCiFailure;

export function captureCiIncident(opts: {
  sha: string;
  repo?: string;
  stateDir?: string;
  ghFn?: (args: string[]) => { ok: boolean; stdout: string; stderr?: string };
}): CiIncidentRecord | null;
