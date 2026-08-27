#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { DEFAULT_REPO, DEFAULT_REQUIRED_CHECK, DEFAULT_REQUIRED_APP_ID } from './ci-authority.mjs';

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

export function auditGitHubProtection({ repo = DEFAULT_REPO, branch = 'main' } = {}) {
  let protection;
  try {
    const raw = sh('gh', ['api', `repos/${repo}/branches/${branch}/protection`]);
    protection = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: `Failed to query branch protection for ${repo}/${branch}: ${error.message}`,
    };
  }

  const enforceAdmins = protection?.enforce_admins?.enabled === true;
  const strictChecks = protection?.required_status_checks?.strict === true;
  const checks = protection?.required_status_checks?.checks ?? [];
  const requiredCheckObj = checks.find((c) => c.context === DEFAULT_REQUIRED_CHECK);
  const checkFound = Boolean(requiredCheckObj);
  const appIdMatches = requiredCheckObj?.app_id === DEFAULT_REQUIRED_APP_ID;

  const ok = enforceAdmins && strictChecks && checkFound && appIdMatches;

  return {
    ok,
    repo,
    branch,
    enforceAdmins,
    strictChecks,
    checkFound,
    appIdMatches,
    requiredCheck: DEFAULT_REQUIRED_CHECK,
    expectedAppId: DEFAULT_REQUIRED_APP_ID,
    actualAppId: requiredCheckObj?.app_id ?? null,
    checks,
  };
}

if (process.argv[1]?.endsWith('audit-github-protection.mjs')) {
  const result = auditGitHubProtection();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
}
