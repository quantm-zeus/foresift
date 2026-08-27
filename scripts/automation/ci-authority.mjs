#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_REQUIRED_CHECK = 'Verify (spec, format, lint, types, tests)';
export const DEFAULT_REPO = 'quantm-zeus/foresift';

/**
 * Deterministic whitelist of files that autopilot is permitted to commit directly to main.
 * Product code, tests, configs, workflows, and root dependencies are strictly prohibited.
 */
export const STATE_ONLY_WHITELIST = [
  /^specs\/implementation\/current-milestone\.json$/,
  /^specs\/implementation\/roadmap\.json$/,
  /^specs\/g0-[a-zA-Z0-9_-]+\/(?:plan|spec|tasks)\.md$/,
];

export function validateDirectMainPushWhitelist(files = []) {
  const violations = files.filter(
    (file) => !STATE_ONLY_WHITELIST.some((pattern) => pattern.test(file.trim())),
  );
  if (violations.length > 0) {
    return {
      allowed: false,
      violations,
      reason: `Direct main mutation attempted with non-state files: ${violations.join(', ')}`,
    };
  }
  return { allowed: true, violations: [] };
}

function defaultGh(args, { cwd } = {}) {
  try {
    return {
      ok: true,
      stdout: execFileSync('gh', args, { encoding: 'utf8', cwd }).trim(),
    };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ? String(error.stdout).trim() : '',
      stderr: error.stderr ? String(error.stderr).trim() : error.message,
      status: error.status ?? 1,
    };
  }
}

function defaultGit(args, { cwd } = {}) {
  try {
    return {
      ok: true,
      stdout: execFileSync('git', args, { encoding: 'utf8', cwd }).trim(),
    };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ? String(error.stdout).trim() : '',
      stderr: error.stderr ? String(error.stderr).trim() : error.message,
      status: error.status ?? 1,
    };
  }
}

/**
 * Evaluate exact-head CI status for a specific commit SHA.
 */
export function getExactHeadCiStatus({
  sha,
  repo = DEFAULT_REPO,
  checkName = DEFAULT_REQUIRED_CHECK,
  cwd = process.cwd(),
  ghFn = defaultGh,
} = {}) {
  if (!sha) {
    return {
      ok: false,
      state: 'MISSING',
      sha: null,
      reason: 'no-sha-provided',
      failureSummary: null,
    };
  }

  const endpoint = `repos/${repo}/commits/${sha}/check-runs`;
  const res = ghFn(
    [
      'api',
      endpoint,
      '--jq',
      '[.check_runs[] | {name: .name, status: .status, conclusion: .conclusion, html_url: .html_url, id: .id}]',
    ],
    { cwd },
  );

  if (!res.ok) {
    return {
      ok: false,
      state: 'API_ERROR',
      sha,
      reason: `gh-api-error: ${res.stderr || res.stdout}`,
      failureSummary: null,
    };
  }

  let runs = [];
  try {
    runs = JSON.parse(res.stdout || '[]');
  } catch (error) {
    return {
      ok: false,
      state: 'API_UNPARSEABLE',
      sha,
      reason: `parse-error: ${error.message}`,
      failureSummary: null,
    };
  }

  const matched = runs.filter((r) => r.name === checkName);
  if (matched.length === 0) {
    return {
      ok: false,
      state: 'MISSING',
      sha,
      reason: `no check-run named '${checkName}' found for commit ${sha}`,
      runs,
      failureSummary: null,
    };
  }

  const completed = matched.filter((r) => r.status === 'completed');
  if (completed.length > 0 && completed.every((r) => r.conclusion === 'success')) {
    return {
      ok: true,
      state: 'SUCCESS',
      sha,
      checkName,
      runs: matched,
      failureSummary: null,
    };
  }

  const failing = completed.filter((r) => r.conclusion !== 'success');
  if (failing.length > 0) {
    const summary = failing.map((r) => `${r.name}:${r.conclusion}`).join(', ');
    return {
      ok: false,
      state: 'FAILURE',
      sha,
      checkName,
      reason: `check failed at ${sha}: ${summary}`,
      runs: matched,
      failureSummary: summary,
      failedRuns: failing,
    };
  }

  return {
    ok: false,
    state: 'PENDING',
    sha,
    checkName,
    reason: `check '${checkName}' still in progress at ${sha}`,
    runs: matched,
    failureSummary: null,
  };
}

/**
 * Determine whether origin/main CI is currently green, red, or pending.
 */
export function getMainCiStatus({
  repo = DEFAULT_REPO,
  checkName = DEFAULT_REQUIRED_CHECK,
  cwd = process.cwd(),
  ghFn = defaultGh,
  gitFn = defaultGit,
} = {}) {
  // Fetch origin/main
  gitFn(['fetch', 'origin', 'main', '--quiet'], { cwd });
  const rev = gitFn(['rev-parse', 'origin/main'], { cwd });
  if (!rev.ok || !rev.stdout) {
    return {
      ok: false,
      state: 'UNKNOWN',
      sha: null,
      reason: 'unable to resolve origin/main commit sha',
    };
  }

  const mainSha = rev.stdout.trim();
  const verdict = getExactHeadCiStatus({
    sha: mainSha,
    repo,
    checkName,
    cwd,
    ghFn,
  });

  if (verdict.state === 'SUCCESS') {
    return { ok: true, state: 'GREEN', sha: mainSha, verdict };
  }
  if (verdict.state === 'FAILURE') {
    return {
      ok: false,
      state: 'RED',
      sha: mainSha,
      reason: `origin/main (${mainSha.slice(0, 10)}) required CI '${checkName}' FAILED: ${verdict.failureSummary}`,
      verdict,
    };
  }
  if (verdict.state === 'PENDING') {
    return {
      ok: false,
      state: 'PENDING',
      sha: mainSha,
      reason: `origin/main (${mainSha.slice(0, 10)}) required CI '${checkName}' is PENDING`,
      verdict,
    };
  }

  return {
    ok: true,
    advisory: true,
    state: verdict.state,
    sha: mainSha,
    reason: verdict.reason,
    verdict,
  };
}

/**
 * Classify a CI log failure into a category and extract affected files/log tail.
 */
export function classifyCiFailure(logText = '') {
  const text = String(logText);
  if (/Code style issues found|prettier --check/i.test(text)) {
    const files = [];
    for (const match of text.matchAll(/\[warn\]\s+(\S+)/g)) {
      files.push(match[1]);
    }
    return {
      category: 'FORMAT',
      repairable: true,
      failedFiles: files,
      logTail: text.slice(-4000),
    };
  }
  if (/Specification integrity verification|spec:verify failed/i.test(text)) {
    return {
      category: 'SPEC',
      repairable: false,
      failedFiles: [],
      logTail: text.slice(-4000),
    };
  }
  if (/ESLint|@typescript-eslint/i.test(text)) {
    return {
      category: 'LINT',
      repairable: false,
      failedFiles: [],
      logTail: text.slice(-4000),
    };
  }
  if (/error TS\d+:|TypeScript check/i.test(text)) {
    return {
      category: 'TYPECHECK',
      repairable: false,
      failedFiles: [],
      logTail: text.slice(-4000),
    };
  }
  if (
    /\b(?:FAIL|fail)\b.*(?:spec|test)\.[cm]?[jt]sx?/i.test(text) ||
    /Tests\s+failed/i.test(text)
  ) {
    return {
      category: 'TESTS',
      repairable: false,
      failedFiles: [],
      logTail: text.slice(-4000),
    };
  }
  return {
    category: 'UNKNOWN',
    repairable: false,
    failedFiles: [],
    logTail: text.slice(-4000),
  };
}

/**
 * Capture a compact incident capsule for a CI failure.
 */
export function captureCiIncident({
  sha,
  repo = DEFAULT_REPO,
  checkName = DEFAULT_REQUIRED_CHECK,
  stateDir = join(process.env.HOME || '', '.local', 'state', 'foresift'),
  cwd = process.cwd(),
  ghFn = defaultGh,
} = {}) {
  const verdict = getExactHeadCiStatus({ sha, repo, checkName, cwd, ghFn });
  if (verdict.state !== 'FAILURE') return null;

  // Retrieve failed logs via gh run view or job logs
  let logText = '';
  const runsRes = ghFn(
    ['run', 'list', '--commit', sha, '--json', 'databaseId,url,conclusion,status'],
    { cwd },
  );
  let runId = null;
  let runUrl = null;
  if (runsRes.ok) {
    try {
      const runsList = JSON.parse(runsRes.stdout || '[]');
      if (runsList.length > 0) {
        runId = runsList[0].databaseId;
        runUrl = runsList[0].url;
      }
    } catch {}
  }

  if (runId) {
    const logRes = ghFn(['run', 'view', String(runId), '--log-failed'], { cwd });
    if (logRes.ok) logText = logRes.stdout;
  }

  const classification = classifyCiFailure(logText);
  const capsule = {
    schema: 'foresift/ci-failure-incident@1',
    ts: Date.now(),
    sha,
    repo,
    checkName,
    runId,
    runUrl,
    failureSummary: verdict.failureSummary,
    classification,
  };

  const incidentsDir = join(stateDir, 'maintainer-incidents');
  if (!existsSync(incidentsDir)) {
    mkdirSync(incidentsDir, { recursive: true });
  }
  const filePath = join(incidentsDir, `ci-failure-${sha}.json`);
  writeFileSync(filePath, JSON.stringify(capsule, null, 2) + '\n');
  return { capsule, filePath };
}
