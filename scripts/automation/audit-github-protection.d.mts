export interface GitHubProtectionAuditResult {
  ok: boolean;
  repo?: string;
  branch?: string;
  enforceAdmins?: boolean;
  strictChecks?: boolean;
  checkFound?: boolean;
  appIdMatches?: boolean;
  requiredCheck?: string;
  expectedAppId?: number;
  actualAppId?: number | null;
  checks?: Array<{ context: string; app_id?: number }>;
  error?: string;
}

export function auditGitHubProtection(opts?: {
  repo?: string;
  branch?: string;
  ghFn?: (
    args: string[],
    opts?: { cwd?: string },
  ) => { ok: boolean; stdout: string; stderr?: string; status?: number };
}): GitHubProtectionAuditResult;
