#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyOwnedPath } from './path-ownership.mjs';

export const DEFAULT_REQUIRED_CHECK = 'Verify (spec, format, lint, types, tests)';
export const DEFAULT_REQUIRED_APP_ID = 15368; // GitHub Actions
export const DEFAULT_REPO = 'quantm-zeus/foresift';

/**
 * Files eligible for the reduced STATE_ONLY CI classifier. This is not a
 * direct-write allowance; all supervisor changes still land through PRs.
 */
export const STATE_ONLY_WHITELIST = [/^specs\/implementation\/current-milestone\.json$/];

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

  // NOTE: There is intentionally no environment variable that can bypass this
  // function and force CI to appear GREEN. Tests must use ghFn/gitFn injection
  // or a stub 'gh' binary in PATH. See ci-authority-hardening.spec.ts §K.
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
 *
 * Parses REAL current output patterns from:
 *   PRETTIER: [warn] path/file
 *   TYPESCRIPT: path/file.ts(line,col): error TSxxxx
 *   ESLINT: file path headings + ESLint diagnostic lines
 *   BUN/FORESIFT COORDINATOR: FAILED GROUP, .spec.ts/.test.ts paths, assertion stacks
 *   NODE COMPAT: compatibility test file paths
 *   SPEC: spec/planning/state verification paths
 *
 * Returns normalized repository-relative paths in failedFiles.
 */
export function classifyCiFailure(logText = '') {
  const text = String(logText);

  // ── INFRA: transient GitHub Actions / network failures ───────────────────
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

  // ── FORMAT: Prettier output ───────────────────────────────────────────────
  // Prettier --check outputs: [warn] path/to/file
  // Also: "Code style issues found in N files. Run Prettier with --write to fix."
  if (/Code style issues found|prettier --check|\[warn\]\s+\S/i.test(text)) {
    const files = [];
    // [warn] path/file — match file-looking lines (with extension or slash)
    for (const match of text.matchAll(/\[warn\]\s+((?:\S+\/\S+|\S+\.\S+))/g)) {
      const candidate = match[1].trim();
      // Exclude summary messages like "Code style issues found in 2 files."
      if (!/^\d|found|issues|style/i.test(candidate)) {
        files.push(candidate);
      }
    }
    return {
      category: 'FORMAT',
      repairable: true,
      failedFiles: [...new Set(files)],
      logTail: text.slice(-4000),
    };
  }

  // ── SPEC: specification integrity ────────────────────────────────────────
  if (/Specification integrity verification|spec:verify failed/i.test(text)) {
    const files = [];
    // Look for spec file paths in the output
    for (const match of text.matchAll(/\b(specs\/[^\s:,'"]+(?:\.json|\.md))/g)) {
      files.push(match[1]);
    }
    return {
      category: 'SPEC',
      repairable: false,
      failedFiles: [...new Set(files)],
      logTail: text.slice(-4000),
    };
  }

  // ── LINT: ESLint output ───────────────────────────────────────────────────
  // ESLint output: file paths at start of diagnostic blocks, then indented errors
  // Pattern: "/repo/path/file.ts" or "packages/foo/src/bar.ts" as line headings
  if (/ESLint|@typescript-eslint/i.test(text)) {
    const files = [];
    // ESLint outputs bare file paths as headings before diagnostics
    for (const match of text.matchAll(
      /^((?:packages|src|scripts|tests|apps)\/[^\s:]+(?:\.ts|\.tsx|\.js|\.mjs))/gm,
    )) {
      files.push(match[1]);
    }
    // Also match absolute paths that contain known repo structure
    for (const match of text.matchAll(
      /\/(packages|src|scripts|tests|apps)\/[^\s:]+(?:\.ts|\.tsx|\.js|\.mjs)/g,
    )) {
      // Normalize to relative by stripping leading absolute path prefix
      const rel = match[0].replace(/^.*?\/(packages|src|scripts|tests|apps)\//, '$1/');
      files.push(rel);
    }
    return {
      category: 'LINT',
      repairable: false,
      failedFiles: [...new Set(files)],
      logTail: text.slice(-4000),
    };
  }

  // ── TYPECHECK: TypeScript compiler output ────────────────────────────────
  // tsc outputs: path/to/file.ts(line,col): error TSxxxx: message
  if (/error TS\d+:|TypeScript check/i.test(text)) {
    const files = [];
    // Standard tsc format: path(line,col): error TSxxxx
    for (const match of text.matchAll(
      /([^\s(]+\.(?:ts|tsx|mts|cts))\(\d+,\d+\):\s+error\s+TS\d+/g,
    )) {
      files.push(match[1]);
    }
    // Also: path.ts: error TSxxxx (without position)
    for (const match of text.matchAll(/([^\s('"]+\.(?:ts|tsx|mts|cts)):\s+error\s+TS\d+/g)) {
      files.push(match[1]);
    }
    return {
      category: 'TYPECHECK',
      repairable: false,
      failedFiles: [...new Set(files)],
      logTail: text.slice(-4000),
    };
  }

  // ── TESTS: Bun / FORESIFT coordinator test output ────────────────────────
  // Bun outputs:
  //   FAILED GROUP: <description>
  //   Listed group files / .spec.ts paths
  //   Assertion stack: at <file>:<line>:<col>
  //   × <test-name> [.../path/file.spec.ts]
  if (
    /\b(?:FAIL|fail)\b.*(?:spec|test)\.[cm]?[jt]sx?/i.test(text) ||
    /Tests\s+failed/i.test(text) ||
    /FAILED\s+GROUP/i.test(text) ||
    /bun test --/i.test(text)
  ) {
    const files = [];
    // Bun: × test-name [.../path/file.spec.ts]
    for (const match of text.matchAll(/\[([^\]]+\.spec\.[cm]?[jt]sx?)\]/g)) {
      files.push(match[1].replace(/^.*?\/tests\//, 'tests/').replace(/^.*?\/test\//, 'test/'));
    }
    // Bun: at path/file.spec.ts:line:col (assertion stacks)
    for (const match of text.matchAll(/at\s+([^\s:]+\.(?:spec|test)\.[cm]?[jt]sx?):\d+:\d+/g)) {
      files.push(match[1]);
    }
    // General .spec.ts/.test.ts paths in output
    for (const match of text.matchAll(
      /((?:tests?|__tests__)\/[^\s:'"]+\.(?:spec|test)\.[cm]?[jt]sx?)/g,
    )) {
      files.push(match[1]);
    }
    // FORESIFT COORDINATOR: group file listings (plain relative paths)
    for (const match of text.matchAll(/^\s+(tests?\/[^\s]+\.(?:spec|test)\.[cm]?[jt]sx?)$/gm)) {
      files.push(match[1].trim());
    }
    return {
      category: 'TESTS',
      repairable: false,
      failedFiles: [...new Set(files)],
      logTail: text.slice(-4000),
    };
  }

  // ── NODE COMPAT: Node runtime compatibility tests ─────────────────────────
  if (/node.*compat|node-compat|runtime.*compat/i.test(text)) {
    const files = [];
    for (const match of text.matchAll(/(scripts\/[^\s:]+\.(?:mjs|js|cjs))/g)) {
      files.push(match[1]);
    }
    return {
      category: 'NODE_COMPAT',
      repairable: false,
      failedFiles: [...new Set(files)],
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
 * Classify whether a set of changed file paths is state-only or requires full CI.
 * Returns 'STATE_ONLY' if ALL files are on the STATE_ONLY_WHITELIST, 'FULL' otherwise.
 * This is used by the CI workflow and state-landing lane.
 *
 * Fail-closed: empty file list → 'FULL' (unknown change set).
 */
export function classifyDiff(files = []) {
  if (files.length === 0) return 'FULL';
  const allState = files.every((f) => STATE_ONLY_WHITELIST.some((p) => p.test(f.trim())));
  return allState ? 'STATE_ONLY' : 'FULL';
}

/**
 * Deterministically select a repair route based on failure classification and path ownership.
 */
export function selectCiRepairRoute({
  classification,
  executionProfile = 'CODEX_AGY',
  failedFiles = [],
  prChangedFiles = [],
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

  const prHasProduct = prChangedFiles.some((f) => classifyOwnedPath(f) === 'PRODUCT');
  const prHasTest = prChangedFiles.some((f) => classifyOwnedPath(f) === 'TEST');

  const diagHasProduct = failedFiles.some((f) => classifyOwnedPath(f) === 'PRODUCT');
  const diagHasTest = failedFiles.some((f) => classifyOwnedPath(f) === 'TEST');

  // CASE A: Syntax/type/lint in test file
  if (category === 'TYPECHECK' || category === 'LINT') {
    if (diagHasTest && !diagHasProduct && !prHasProduct) {
      return {
        route: 'AGY_TEST_REPAIR',
        engine: 'AGY',
        role: 'test',
        action: 'RETRY_AGY_TEST',
        reason: 'test helper/fixture syntax or type defect routed to AGY test authority',
        needsAi: true,
      };
    }
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

  // TESTS assertion failures (Section 13):
  if (category === 'TESTS') {
    // CASE D: Both product and test modified in PR -> TEST_DISPUTE
    if (prHasProduct && prHasTest) {
      return {
        route: 'TEST_DISPUTE',
        engine: 'NONE',
        role: 'dispute',
        action: 'TRIAGE_TEST_DISPUTE',
        reason:
          'both product and test files modified in PR — requires structured TEST_DISPUTE triage',
        needsAi: true,
      };
    }

    // CASE B: Product code modified in PR, test was NOT modified -> CODEX
    if (prHasProduct && !prHasTest) {
      if (executionProfile === 'CODEX_AGY') {
        return {
          route: 'CODEX_IMPLEMENTATION_REPAIR',
          engine: 'CODEX',
          role: 'implementation',
          action: 'RETRY_CODEX',
          reason:
            'product assertion failure with unchanged test expectation routed to Codex repair path',
          needsAi: true,
        };
      }
    }

    // CASE C: Only test code modified in PR -> AGY
    if (!prHasProduct && prHasTest) {
      return {
        route: 'AGY_TEST_REPAIR',
        engine: 'AGY',
        role: 'test',
        action: 'RETRY_AGY_TEST',
        reason: 'test-owned failure scope routed to AGY test authority',
        needsAi: true,
      };
    }

    // If PR changed files unavailable, always TEST_DISPUTE for TESTS failures
    if (prChangedFiles.length === 0) {
      return {
        route: 'TEST_DISPUTE',
        engine: 'NONE',
        role: 'dispute',
        action: 'TRIAGE_TEST_DISPUTE',
        reason: 'PR changed-file evidence unavailable — routed to TEST_DISPUTE',
        needsAi: true,
      };
    }

    // If PR changed files unknown / not provided, check diagnostics
    if (diagHasProduct) {
      if (executionProfile === 'CODEX_AGY') {
        return {
          route: 'CODEX_IMPLEMENTATION_REPAIR',
          engine: 'CODEX',
          role: 'implementation',
          action: 'RETRY_CODEX',
          reason: 'product failure routed to Codex',
          needsAi: true,
        };
      }
    }

    if (diagHasTest && !diagHasProduct) {
      return {
        route: 'AGY_TEST_REPAIR',
        engine: 'AGY',
        role: 'test',
        action: 'RETRY_AGY_TEST',
        reason: 'test-owned failure scope routed to AGY test authority',
        needsAi: true,
      };
    }

    // Unclear causal ownership: never blindly AGY -> TEST_DISPUTE
    return {
      route: 'TEST_DISPUTE',
      engine: 'NONE',
      role: 'dispute',
      action: 'TRIAGE_TEST_DISPUTE',
      reason: 'ambiguous assertion failure ownership — routed to structured TEST_DISPUTE',
      needsAi: true,
    };
  }

  if (category === 'PRODUCT' || category === 'NODE_COMPAT') {
    if (executionProfile === 'CODEX_AGY') {
      return {
        route: 'CODEX_IMPLEMENTATION_REPAIR',
        engine: 'CODEX',
        role: 'implementation',
        action: 'RETRY_CODEX',
        reason: 'product defect routed to Codex repair path',
        needsAi: true,
      };
    }
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
 * Triage a TEST_DISPUTE into structured next action.
 */
export function triageTestDispute({ disputeAssessment } = {}) {
  if (disputeAssessment === 'TEST_VALID') {
    return {
      decision: 'TEST_VALID',
      nextRoute: {
        route: 'CODEX_IMPLEMENTATION_REPAIR',
        engine: 'CODEX',
        role: 'implementation',
        action: 'RETRY_CODEX',
        reason: 'test validated as correct; product implementation defect routed to Codex',
        needsAi: true,
      },
    };
  }

  if (disputeAssessment === 'TEST_DEFECT') {
    return {
      decision: 'TEST_DEFECT',
      nextRoute: {
        route: 'AGY_TEST_REPAIR',
        engine: 'AGY',
        role: 'test',
        action: 'RETRY_AGY_TEST',
        reason: 'test defect confirmed by triage; routed to AGY test repair',
        needsAi: true,
      },
    };
  }

  return {
    decision: 'INCONCLUSIVE',
    nextRoute: {
      route: 'MAINTAINER_ESCALATION',
      engine: 'CLAUDE',
      role: 'maintainer',
      action: 'BLOCKED_OPERATOR_REQUIRED',
      reason: 'dispute triage inconclusive; escalated to maintainer',
      needsAi: true,
    },
  };
}

/**
 * Capture a compact, deduplicated incident capsule for a CI failure.
 *
 * Incident identity is keyed by: SHA + required check name + trusted app id.
 * This ensures:
 *   - Same exact failure event → one capsule (deduplicated)
 *   - New HEAD → new incident identity
 *   - Different authoritative check → different incident identity
 *
 * repair_attempts is persisted durably in the capsule so supervisor restarts
 * do not reset the budget.
 */
export function captureCiIncident({
  sha,
  headSha = null,
  prNumber = null,
  baseSha = null,
  prChangedFiles = [],
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
  const actualSha = sha || headSha;
  const verdict = getExactHeadCiStatus({
    sha: actualSha,
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

  // Incident identity: SHA + check name slug + app id
  // This ensures different checks on the same SHA get different capsules,
  // and prevents any deduplication key collision across check authorities.
  const checkSlug = checkName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const incidentKey = `ci-failure-${actualSha}-${checkSlug}-${requiredAppId}`;
  const filePath = join(incidentsDir, `${incidentKey}.json`);

  // Deduplication: if an incident capsule for this exact (SHA, check, appId) already exists, return it
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
      ['run', 'list', '--commit', actualSha, '--json', 'databaseId,url,conclusion,status'],
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
    prChangedFiles,
    attempts,
  });

  // eventId includes SHA + check name + app id for strong identity
  const eventId = `CI_FAILURE/${actualSha}/${checkSlug}/${requiredAppId}`;

  const capsule = {
    schema: 'foresift/ci-failure-incident@1',
    eventId,
    package: packageId,
    prNumber,
    baseSha,
    prChangedFiles,
    runId,
    runUrl,
    workflow,
    executionProfile,
    sha: actualSha,
    repo,
    checkName,
    requiredAppId,
    failureSummary: verdict.failureSummary,
    classification,
    repairRoute,
    attempts,
    repairAttempts: 0, // durable counter: incremented by ci-repair-executor on each attempt
    capturedAt: new Date().toISOString(),
  };

  writeFileSync(filePath, JSON.stringify(capsule, null, 2) + '\n');
  return { capsule, filePath, deduplicated: false };
}

/**
 * Increment the repair attempt counter in an existing incident capsule.
 * Returns the new count. This is the authoritative budget tracker that
 * survives supervisor restarts.
 *
 * NOTE: This is also exported from ci-repair-executor.mjs which delegates here.
 */
export function incrementIncidentRepairAttempts(filePath) {
  try {
    const capsule = JSON.parse(readFileSync(filePath, 'utf8'));
    capsule.repairAttempts = (capsule.repairAttempts ?? 0) + 1;
    capsule.lastRepairAttemptAt = new Date().toISOString();
    writeFileSync(filePath, JSON.stringify(capsule, null, 2) + '\n');
    return capsule.repairAttempts;
  } catch {
    return 1;
  }
}
