#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyOwnedPath } from './path-ownership.mjs';

export const DEFAULT_REQUIRED_CHECK = 'Verify (spec, format, lint, types, tests)';
export const DEFAULT_REQUIRED_APP_ID = 15368; // GitHub Actions
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
 * Evaluate exact-head CI status for a specific commit SHA, bound by check name and trusted GitHub App.
 */
export function getExactHeadCiStatus({
  sha,
  repo = DEFAULT_REPO,
  checkName = DEFAULT_REQUIRED_CHECK,
  requiredAppId = DEFAULT_REQUIRED_APP_ID,
  cwd = process.cwd(),
  ghFn = defaultGh,
} = {}) {
  if (!sha) {
    return {
      ok: false,
      state: 'MISSING',
      sha: null,
      checkName,
      requiredAppId,
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
      '[.check_runs[] | {name: .name, status: .status, conclusion: .conclusion, html_url: .html_url, id: .id, app_id: .app.id, app_slug: .app.slug}]',
    ],
    { cwd },
  );

  if (!res.ok) {
    return {
      ok: false,
      state: 'API_ERROR',
      sha,
      checkName,
      requiredAppId,
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
      checkName,
      requiredAppId,
      reason: `parse-error: ${error.message}`,
      failureSummary: null,
    };
  }

  const sameNameRuns = runs.filter((r) => r.name === checkName);
  if (sameNameRuns.length === 0) {
    return {
      ok: false,
      state: 'MISSING',
      sha,
      checkName,
      requiredAppId,
      reason: `no check-run named '${checkName}' found for commit ${sha}`,
      runs,
      failureSummary: null,
    };
  }

  const matched = sameNameRuns.filter((r) => requiredAppId == null || r.app_id === requiredAppId);

  if (matched.length === 0) {
    return {
      ok: false,
      state: 'UNTRUSTED',
      sha,
      checkName,
      requiredAppId,
      reason: `check-run '${checkName}' found but from untrusted app (expected app id ${requiredAppId})`,
      runs: sameNameRuns,
      failureSummary: null,
    };
  }

  const completed = matched.filter((r) => r.status === 'completed');
  if (completed.length === matched.length && completed.every((r) => r.conclusion === 'success')) {
    return {
      ok: true,
      state: 'SUCCESS',
      sha,
      checkName,
      requiredAppId,
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
      requiredAppId,
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
    requiredAppId,
    reason: `check '${checkName}' still in progress at ${sha}`,
    runs: matched,
    failureSummary: null,
  };
}

/**
 * Determine whether origin/main CI is currently green, red, or pending.
 * Fails closed on any fetch failure, rev-parse failure, missing/untrusted checks, or API errors.
 */
export function getMainCiStatus({
  repo = DEFAULT_REPO,
  checkName = DEFAULT_REQUIRED_CHECK,
  requiredAppId = DEFAULT_REQUIRED_APP_ID,
  cwd = process.cwd(),
  ghFn = defaultGh,
  gitFn = defaultGit,
} = {}) {
  const fetchRes = gitFn(['fetch', 'origin', 'main', '--quiet'], { cwd });
  if (!fetchRes.ok) {
    return {
      ok: false,
      state: 'FETCH_ERROR',
      sha: null,
      reason: `git fetch origin main failed: ${fetchRes.stderr || fetchRes.stdout}`,
    };
  }

  const rev = gitFn(['rev-parse', 'origin/main'], { cwd });
  if (!rev.ok || !rev.stdout) {
    return {
      ok: false,
      state: 'REV_PARSE_ERROR',
      sha: null,
      reason: 'unable to resolve origin/main commit sha',
    };
  }

  const mainSha = rev.stdout.trim();

  if (process.env.FORESIFT_HERMETIC_CI_GREEN === '1') {
    return {
      ok: true,
      state: 'GREEN',
      sha: mainSha,
      verdict: { ok: true, state: 'SUCCESS', sha: mainSha, checkName, requiredAppId },
    };
  }

  const verdict = getExactHeadCiStatus({
    sha: mainSha,
    repo,
    checkName,
    requiredAppId,
    cwd,
    ghFn,
  });

  if (verdict.ok && verdict.state === 'SUCCESS') {
    return { ok: true, state: 'GREEN', sha: mainSha, verdict };
  }

  return {
    ok: false,
    state: verdict.state,
    sha: mainSha,
    reason:
      verdict.reason ||
      `origin/main (${mainSha.slice(0, 10)}) required CI '${checkName}' is not GREEN (state: ${verdict.state})`,
    verdict,
  };
}

/**
 * Classify a CI log failure into a category and extract affected files/log tail.
 */
export function classifyCiFailure(logText = '') {
  const text = String(logText);
  if (
    /ECONNRESET|ETIMEDOUT|GitHub Actions has encountered an internal error|runner.*disconnected|API rate limit exceeded/i.test(
      text,
    )
  ) {
    return {
      category: 'INFRA',
      repairable: false,
      failedFiles: [],
      logTail: text.slice(-4000),
    };
  }
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
 * Deterministically select a repair route based on failure classification and path ownership.
 */
export function selectCiRepairRoute({
  classification,
  executionProfile = 'CODEX_AGY',
  failedFiles = [],
  attempts = 0,
  maxAttempts = 2,
} = {}) {
  const category =
    typeof classification === 'string' ? classification : (classification?.category ?? 'UNKNOWN');

  if (attempts >= maxAttempts) {
    return {
      route: 'MAINTAINER_ESCALATION',
      engine: 'CLAUDE',
      role: 'maintainer',
      action: 'BLOCKED_OPERATOR_REQUIRED',
      reason: `repair attempts exhausted (${attempts}/${maxAttempts})`,
      needsAi: true,
    };
  }

  if (category === 'FORMAT') {
    return {
      route: 'DETERMINISTIC_FORMAT',
      engine: 'FORMATTER',
      role: 'mechanical',
      action: 'RUN_FORMATTER',
      reason: 'formatting error resolvable deterministically via prettier',
      needsAi: false,
    };
  }

  if (category === 'INFRA' || category === 'API_ERROR' || category === 'API_UNPARSEABLE') {
    return {
      route: 'INFRASTRUCTURE_WAIT',
      engine: 'NONE',
      role: 'infra',
      action: 'RETRY_CI_OBSERVATION',
      reason: 'transient infrastructure/API failure; avoid consuming AI repair turns',
      needsAi: false,
    };
  }

  // Check file ownership if files are identified
  const hasTestFiles = failedFiles.some((f) => classifyOwnedPath(f) === 'TEST');
  const hasProductFiles = failedFiles.some((f) => classifyOwnedPath(f) === 'PRODUCT');

  if (hasTestFiles && !hasProductFiles) {
    return {
      route: 'AGY_TEST_REPAIR',
      engine: 'AGY',
      role: 'test',
      action: 'RETRY_AGY_TEST',
      reason: 'test-owned failure scope routed to AGY test authority',
      needsAi: true,
    };
  }

  if (
    category === 'LINT' ||
    category === 'TYPECHECK' ||
    category === 'TESTS' ||
    category === 'PRODUCT'
  ) {
    if (executionProfile === 'CODEX_AGY') {
      return {
        route: 'CODEX_IMPLEMENTATION_REPAIR',
        engine: 'CODEX',
        role: 'implementation',
        action: 'RETRY_CODEX',
        reason: 'product implementation defect routed to Codex repair path',
        needsAi: true,
      };
    }
  }

  if (category === 'SPEC') {
    return {
      route: 'SPEC_INTEGRITY_REPAIR',
      engine: 'CLAUDE',
      role: 'maintainer',
      action: 'REPAIR_CONTROL_PLANE',
      reason: 'spec verification failure requires maintainer control-plane repair',
      needsAi: true,
    };
  }

  return {
    route: 'MAINTAINER_INCIDENT',
    engine: 'CLAUDE',
    role: 'maintainer',
    action: 'BLOCKED_OPERATOR_REQUIRED',
    reason: `unclassified failure (${category}) escalated to maintainer`,
    needsAi: true,
  };
}

/**
 * Capture a compact, deduplicated incident capsule for a CI failure.
 */
export function captureCiIncident({
  sha,
  repo = DEFAULT_REPO,
  checkName = DEFAULT_REQUIRED_CHECK,
  requiredAppId = DEFAULT_REQUIRED_APP_ID,
  packageId = null,
  runId: inputRunId = null,
  workflow = null,
  executionProfile = 'CODEX_AGY',
  attempts = 0,
  stateDir = join(process.env.HOME || '', '.local', 'state', 'foresift'),
  cwd = process.cwd(),
  ghFn = defaultGh,
} = {}) {
  const verdict = getExactHeadCiStatus({
    sha,
    repo,
    checkName,
    requiredAppId,
    cwd,
    ghFn,
  });
  if (verdict.state !== 'FAILURE' && verdict.state !== 'UNTRUSTED') return null;

  const incidentsDir = join(stateDir, 'maintainer-incidents');
  if (!existsSync(incidentsDir)) {
    mkdirSync(incidentsDir, { recursive: true });
  }
  const filePath = join(incidentsDir, `ci-failure-${sha}.json`);

  // Deduplication: if an incident capsule for this exact SHA already exists, return it
  if (existsSync(filePath)) {
    try {
      const existing = JSON.parse(readFileSync(filePath, 'utf8'));
      return { capsule: existing, filePath, deduplicated: true };
    } catch {}
  }

  // Retrieve failed logs via gh run view or job logs
  let logText = '';
  let runId = inputRunId;
  let runUrl = null;

  if (!runId) {
    const runsRes = ghFn(
      ['run', 'list', '--commit', sha, '--json', 'databaseId,url,conclusion,status'],
      { cwd },
    );
    if (runsRes.ok) {
      try {
        const runsList = JSON.parse(runsRes.stdout || '[]');
        if (runsList.length > 0) {
          runId = runsList[0].databaseId;
          runUrl = runsList[0].url;
        }
      } catch {}
    }
  }

  if (runId) {
    const logRes = ghFn(['run', 'view', String(runId), '--log-failed'], {
      cwd,
    });
    if (logRes.ok) logText = logRes.stdout;
  }

  const classification = classifyCiFailure(logText);
  const repairRoute = selectCiRepairRoute({
    classification,
    executionProfile,
    failedFiles: classification.failedFiles,
    attempts,
  });

  const eventId = `CI_FAILURE/${sha}/${checkName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  const capsule = {
    schema: 'foresift/ci-failure-incident@1',
    eventId,
    package: packageId,
    runId,
    runUrl,
    workflow,
    executionProfile,
    sha,
    repo,
    checkName,
    requiredAppId,
    failureSummary: verdict.failureSummary,
    classification,
    repairRoute,
    attempts,
    capturedAt: new Date().toISOString(),
  };

  writeFileSync(filePath, JSON.stringify(capsule, null, 2) + '\n');
  return { capsule, filePath, deduplicated: false };
}
