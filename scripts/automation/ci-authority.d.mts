export const DEFAULT_REQUIRED_CHECK: string;
export const DEFAULT_REQUIRED_APP_ID: number;
export const DEFAULT_REPO: string;
export const STATE_ONLY_WHITELIST: readonly RegExp[];

export interface WhitelistValidationResult {
  allowed: boolean;
  reason?: string;
  violations?: string[];
}

export interface CiCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  html_url?: string;
  id?: number;
  app_id?: number;
  app_slug?: string;
}

export type ExactHeadCiState =
  'SUCCESS' | 'FAILURE' | 'PENDING' | 'MISSING' | 'UNTRUSTED' | 'API_ERROR' | 'API_UNPARSEABLE';

export interface CiStatusResult {
  ok: boolean;
  state: ExactHeadCiState;
  sha: string | null;
  checkName?: string;
  requiredAppId?: number | null;
  reason?: string;
  failureSummary?: string | null;
  runs?: CiCheckRun[];
  failedRuns?: CiCheckRun[];
}

export type MainCiState =
  'GREEN' | 'RED' | 'FETCH_ERROR' | 'REV_PARSE_ERROR' | 'UNKNOWN' | ExactHeadCiState;

export interface MainCiStatusResult {
  ok: boolean;
  state: MainCiState;
  sha: string | null;
  reason?: string;
  verdict?: CiStatusResult;
}

export interface ClassifiedCiFailure {
  category: 'FORMAT' | 'SPEC' | 'LINT' | 'TYPECHECK' | 'TESTS' | 'INFRA' | 'UNKNOWN';
  repairable: boolean;
  failedFiles: string[];
  logTail: string;
}

export interface CiRepairRoute {
  route:
    | 'DETERMINISTIC_FORMAT'
    | 'INFRASTRUCTURE_WAIT'
    | 'AGY_TEST_REPAIR'
    | 'CODEX_IMPLEMENTATION_REPAIR'
    | 'SPEC_INTEGRITY_REPAIR'
    | 'TEST_DISPUTE'
    | 'MAINTAINER_ESCALATION'
    | 'MAINTAINER_INCIDENT';
  engine: 'FORMATTER' | 'NONE' | 'AGY' | 'CODEX' | 'CLAUDE';
  role: 'mechanical' | 'infra' | 'test' | 'implementation' | 'dispute' | 'maintainer';
  action: string;
  reason: string;
  needsAi: boolean;
}

export interface CiIncidentCapsule {
  schema: string;
  eventId: string;
  package: string | null;
  prNumber: number | string | null;
  baseSha: string | null;
  prChangedFiles: string[];
  runId: number | string | null;
  runUrl: string | null;
  workflow: string | null;
  executionProfile: string;
  sha: string;
  repo: string;
  checkName: string;
  requiredAppId: number | null;
  failureSummary?: string | null;
  classification: ClassifiedCiFailure;
  repairRoute: CiRepairRoute;
  attempts: number;
  capturedAt: string;
}

export interface CiIncidentRecord {
  filePath: string;
  capsule: CiIncidentCapsule;
  deduplicated: boolean;
}

export function validateDirectMainPushWhitelist(files?: string[]): WhitelistValidationResult;

export function getExactHeadCiStatus(opts?: {
  sha?: string | null;
  repo?: string;
  checkName?: string;
  requiredAppId?: number | null;
  cwd?: string;
  ghFn?: (
    args: string[],
    opts?: { cwd?: string },
  ) => { ok: boolean; stdout: string; stderr?: string; status?: number };
}): CiStatusResult;

export function getMainCiStatus(opts?: {
  repo?: string;
  checkName?: string;
  requiredAppId?: number | null;
  cwd?: string;
  ghFn?: (
    args: string[],
    opts?: { cwd?: string },
  ) => { ok: boolean; stdout: string; stderr?: string; status?: number };
  gitFn?: (
    args: string[],
    opts?: { cwd?: string },
  ) => { ok: boolean; stdout: string; stderr?: string; status?: number };
}): MainCiStatusResult;

export function classifyCiFailure(logText?: string): ClassifiedCiFailure;

export function selectCiRepairRoute(opts?: {
  classification?: ClassifiedCiFailure | string;
  executionProfile?: string;
  failedFiles?: string[];
  prChangedFiles?: string[];
  attempts?: number;
  maxAttempts?: number;
}): CiRepairRoute;

export interface TestDisputeResult {
  decision: 'TEST_VALID' | 'TEST_DEFECT' | 'INCONCLUSIVE';
  nextRoute: CiRepairRoute;
}

export function triageTestDispute(opts?: {
  disputeAssessment?: 'TEST_VALID' | 'TEST_DEFECT' | 'INCONCLUSIVE' | string;
  productFiles?: string[];
  testFiles?: string[];
}): TestDisputeResult;

export function captureCiIncident(opts?: {
  sha?: string;
  headSha?: string | null;
  prNumber?: number | string | null;
  baseSha?: string | null;
  prChangedFiles?: string[];
  repo?: string;
  checkName?: string;
  requiredAppId?: number | null;
  packageId?: string | null;
  runId?: number | string | null;
  workflow?: string | null;
  executionProfile?: string;
  attempts?: number;
  stateDir?: string;
  cwd?: string;
  ghFn?: (
    args: string[],
    opts?: { cwd?: string },
  ) => { ok: boolean; stdout: string; stderr?: string; status?: number };
}): CiIncidentRecord | null;

/**
 * Classify a diff (list of changed file paths) as STATE_ONLY or FULL.
 * Fail-closed: empty or unknown files → FULL.
 */
export function classifyDiff(files?: string[]): 'STATE_ONLY' | 'FULL';

/**
 * Increment the durable repair attempt counter in an existing incident capsule.
 * Returns the new count. Survives supervisor restarts.
 */
export function incrementIncidentRepairAttempts(filePath: string): number;

/** Whitelist of regex patterns for state-only file paths. */
export declare const STATE_ONLY_WHITELIST: RegExp[];
