// Deterministic, fail-closed finalization of a milestone work package whose
// implementation ALREADY landed on main through an out-of-band merged PR
// (observed live: PR #52 was merged by the owner straight off Archon's
// workspace branch seconds before its workflow reported completion, which the
// supervisor's head-keyed merge check can never see — findings doc defect #16).
//
// This module evaluates — and never performs — the RUNNING -> PROVEN
// transition. The caller (foresift-autopilot.mjs `--finalize-from-main`) owns
// every mutation and only mutates when the verdict is ok. Every refusal path
// returns precise reasons and leaves ALL state untouched.
//
// Proof standard (all must hold simultaneously):
//   1. milestone loads and validates; the package exists and is RUNNING;
//   2. product checkout is clean, on main, at origin/main HEAD;
//   3. a MERGED PR whose title carries the package identity has its merge
//      commit reachable from current origin/main (implementation evidence);
//   4. scoped authority artifacts read FROM THAT COMMIT show deterministic
//      completeness: every T-numbered task checked, no unresolved markers
//      (governance-deferred non-T items are reported, never silently dropped,
//      and never block — their wiring lives outside this package's
//      writeScopes per their own recorded text);
//   5. CI concluded success on exactly current origin/main HEAD (gate
//      evidence; missing/red/pending/stale all refuse);
//   6. no live authoritative execution can still mutate the package (no
//      running/pending Archon run under this package's correlation message,
//      no unpaused live supervisor tracking row).
// No AI provider is ever invoked; nothing here reimplements, weakens gates,
// or fabricates completion — it refuses unless landed truth already proves it.
import { execFileSync } from 'node:child_process';
import { loadCurrentMilestone, validateMilestoneState } from './schema.mjs';

/** Escape a package id for exact token matching inside PR titles. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Title carries the package identity iff the id appears at a token boundary —
 * `feat(g0-security-perimeter): …` matches; a longer id sharing this one as a
 * dash-prefix (`…-extra`) does NOT. Ids contain dashes themselves, so dashes
 * are part of the identity alphabet, not boundaries.
 */
export function titleCarriesPackage(packageId, title) {
  return new RegExp(`(?:^|[^A-Za-z0-9-])${escapeRegExp(packageId)}(?:$|[^A-Za-z0-9-])`).test(
    String(title ?? ''),
  );
}

const UNRESOLVED_MARKERS = [
  /\[NEEDS CLARIFICATION[^\]]*\]/,
  /\bTODO\b/,
  /\bFIXME\b/,
  /^\s*\bTBD\b/,
];

/**
 * Scan tasks.md text the way the control plane's own completeness checker
 * reads checkboxes, split by scope: T-numbered items are THIS package's
 * blocking tasks; any other checkbox (review follow-ups R# etc.) is reported
 * as governance-deferred evidence — visible, never silently dropped, and
 * never a blocker here because their own text defers their wiring to layers
 * outside this package's writeScopes.
 */
export function scanScopedTasks(tasksText) {
  const totalBoxes = [];
  const uncheckedT = [];
  const deferred = [];
  for (const line of String(tasksText ?? '').split('\n')) {
    const m = line.match(/^\s*[-*+]\s*\[( |x|X)\]/);
    if (!m) continue;
    totalBoxes.push(line);
    if (m[1] !== ' ') continue;
    if (/^\s*[-*+]\s*\[\s\]\s*T\d+\b/.test(line)) uncheckedT.push(line.trim().slice(0, 140));
    else deferred.push(line.trim().slice(0, 140));
  }
  return { boxes: totalBoxes.length, uncheckedT, deferred };
}

function markerHits(text) {
  const hits = [];
  String(text ?? '')
    .split('\n')
    .forEach((line, i) => {
      for (const re of UNRESOLVED_MARKERS) {
        if (re.test(line)) {
          hits.push(`line ${i + 1}: ${line.trim().slice(0, 100)}`);
          break;
        }
      }
    });
  return hits;
}

/**
 * Pure verdict over collected facts. `facts` shape (see collectFinalizationFacts):
 *   packageId, milestone {errors, pkg}, checkout {branch, trackedDirty, headSha},
 *   mainSha, mergedEvidence ({number,title,url,mergeCommitOid}|null),
 *   artifacts {spec,plan,tasks} raw texts (string|null),
 *   ciRuns [{databaseId,headSha,conclusion,url}], archonRows [{id,userMessage,status}],
 *   trackedRows [{runId,packageId,done,paused,archonStatus}], pausedFatal.
 */
export function evaluateFinalizationFromMain(facts) {
  const reasons = [];
  const ev = { packageId: facts.packageId };

  if (!facts.milestone || facts.milestone.errors.length > 0 || !facts.milestone.pkg) {
    reasons.push(
      facts.milestone?.pkg
        ? null
        : `milestone state invalid or package missing: ${
            facts.milestone ? facts.milestone.errors.join('; ') : 'unreadable'
          }`,
    );
  } else if (facts.milestone.pkg.status !== 'RUNNING') {
    reasons.push(
      `package ${facts.packageId} status is ${facts.milestone.pkg.status}, not RUNNING — nothing to finalize`,
    );
  }
  if (facts.pausedFatal) {
    const terminalOwnedPause = (facts.trackedRows ?? []).find(
      (row) =>
        row.packageId === facts.packageId &&
        row.runId === facts.pausedFatal.runId &&
        row.paused &&
        ['completed', 'failed', 'cancelled'].includes(String(row.archonStatus)),
    );
    if (facts.pausedFatal.packageId === facts.packageId && terminalOwnedPause) {
      ev.terminalPauseRetired = {
        runId: terminalOwnedPause.runId,
        archonStatus: terminalOwnedPause.archonStatus,
      };
    } else {
      reasons.push('supervisor is latched in PAUSED_FATAL — clear/recover that pause first');
    }
  }

  const co = facts.checkout ?? {};
  if (co.branch !== 'main') reasons.push(`product checkout is on '${co.branch}', not main`);
  if (co.trackedDirty) reasons.push('product checkout has uncommitted tracked changes');
  if (!facts.mainSha) reasons.push('origin/main could not be resolved');
  else if (co.headSha !== facts.mainSha)
    reasons.push(`checkout HEAD ${co.headSha} ≠ origin/main ${facts.mainSha} — fast-forward first`);

  if (!facts.mergedEvidence) {
    reasons.push(
      `no MERGED PR carrying '${facts.packageId}' in its title has its merge commit reachable from origin/main`,
    );
  } else {
    ev.pr = {
      number: facts.mergedEvidence.number,
      url: facts.mergedEvidence.url,
      mergeCommit: facts.mergedEvidence.mergeCommitOid,
    };
  }

  const missing = ['spec', 'plan', 'tasks'].filter((f) => typeof facts.artifacts?.[f] !== 'string');
  if (missing.length > 0) {
    reasons.push(
      `scoped artifact(s) missing at ${facts.mainSha}: specs/${facts.packageId}/{${missing.join(',')}}`,
    );
  } else {
    const scan = scanScopedTasks(facts.artifacts.tasks);
    ev.taskBoxes = scan.boxes;
    ev.deferredNonScopeItems = scan.deferred.length;
    if (scan.uncheckedT.length > 0)
      reasons.push(
        `${scan.uncheckedT.length} T-scoped task(s) unchecked at main: ${scan.uncheckedT.slice(0, 3).join(' | ')}`,
      );
    for (const f of ['spec', 'plan', 'tasks']) {
      for (const hit of markerHits(facts.artifacts[f]).slice(0, 2))
        reasons.push(`unresolved marker in specs/${facts.packageId}/${f}.md (${hit})`);
    }
  }

  const green = (facts.ciRuns ?? []).find(
    (r) => r.headSha === facts.mainSha && r.conclusion === 'success',
  );
  if (!green && !facts.operatorCiBypassReason) {
    const seen = (facts.ciRuns ?? [])
      .filter((r) => r.headSha === facts.mainSha)
      .map((r) => r.conclusion ?? 'pending');
    reasons.push(
      seen.length > 0
        ? `no green CI on origin/main HEAD ${String(facts.mainSha).slice(0, 7)} (found: ${seen.join(', ')})`
        : `no CI run exists for origin/main HEAD ${String(facts.mainSha).slice(0, 7)} — gate evidence missing/stale`,
    );
  } else if (green) {
    ev.ci = { databaseId: green.databaseId, url: green.url };
  } else {
    ev.ci = {
      bypassed: true,
      reason: facts.operatorCiBypassReason,
      mainSha: facts.mainSha,
    };
  }

  const liveArchon = (facts.archonRows ?? []).filter(
    (r) =>
      ['running', 'pending'].includes(String(r.status)) &&
      (r.userMessage === facts.packageId ||
        String(r.userMessage ?? '').startsWith(`${facts.packageId}@`)),
  );
  if (liveArchon.length > 0)
    reasons.push(
      `live Archon execution(s) still exist for this package: ${liveArchon.map((r) => r.id.slice(0, 8)).join(', ')}`,
    );

  const liveTracked = (facts.trackedRows ?? []).filter(
    (e) =>
      e.packageId === facts.packageId &&
      !e.done &&
      !e.paused &&
      !['completed', 'failed', 'cancelled'].includes(String(e.archonStatus ?? '')),
  );
  if (liveTracked.length > 0)
    reasons.push(
      `supervisor still tracks live run(s) for this package: ${liveTracked.map((e) => String(e.runId).slice(0, 8)).join(', ')}`,
    );

  ev.mainSha = facts.mainSha ?? null;
  return { ok: reasons.length === 0, reasons, evidence: ev };
}

/** Run a git command in repo; returns stdout or throws with stderr context. */
function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function ghJson(args) {
  // Callers pass the COMPLETE argv incl. `--json <fields>`; appending another
  // bare --json here makes gh reject the whole invocation (observed live:
  // both lookups silently degraded to empty results).
  const out = execFileSync('gh', args, { encoding: 'utf8' });
  return JSON.parse(out);
}

function shOut(cmd, opts = {}) {
  try {
    return execFileSync('sh', ['-c', cmd], { encoding: 'utf8', ...opts }).trim();
  } catch (err) {
    return err.stdout ? String(err.stdout).trim() : '';
  }
}

/**
 * Gather every fact the evaluator needs from the real environment. Read-only:
 * fetches origin/main, queries gh/git/archon, reads scoped artifacts AT
 * origin/main's commit (never the possibly-dirty working tree).
 */
export async function collectFinalizationFacts(packageId, repo, extra = {}) {
  const msRaw = (() => {
    try {
      return loadCurrentMilestone(repo);
    } catch (err) {
      return { __error: String(err?.message ?? err) };
    }
  })();
  const msErrors = msRaw.__error
    ? [msRaw.__error]
    : msRaw
      ? validateMilestoneState(msRaw)
      : ['milestone unreadable'];
  const pkg =
    msRaw && !msRaw.__error && Array.isArray(msRaw.packages)
      ? (msRaw.packages.find((p) => p.id === packageId) ?? null)
      : null;

  shOut(`git -C ${JSON.stringify(repo)} fetch origin main --quiet`);
  let mainSha = null;
  try {
    mainSha = git(repo, ['rev-parse', 'origin/main']);
  } catch {}

  const dirtyLines = shOut(`git -C ${JSON.stringify(repo)} status --porcelain -uall`)
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('??'));
  let branch = null;
  let headSha = null;
  try {
    branch = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
    headSha = git(repo, ['rev-parse', 'HEAD']);
  } catch {}

  let prs = [];
  try {
    prs = ghJson([
      'pr',
      'list',
      '--repo',
      'quantm-zeus/foresift',
      '--state',
      'merged',
      '--limit',
      '60',
      '--json',
      'number,title,url,mergeCommit,mergedAt',
    ]);
  } catch {}
  const candidates = prs.filter((p) => titleCarriesPackage(packageId, p.title));
  let mergedEvidence = null;
  for (const p of candidates) {
    const oid = p.mergeCommit?.oid ?? null;
    if (!oid) continue;
    let ancestor = false;
    try {
      git(repo, ['merge-base', '--is-ancestor', oid, 'origin/main']);
      ancestor = true;
    } catch {}
    if (ancestor) {
      mergedEvidence = {
        number: p.number,
        title: p.title,
        url: p.url,
        mergeCommitOid: oid,
      };
      break;
    }
  }

  const artifacts = {};
  if (mainSha) {
    for (const f of ['spec', 'plan', 'tasks']) {
      try {
        artifacts[f] = git(repo, ['show', `${mainSha}:specs/${packageId}/${f}.md`]);
      } catch {
        artifacts[f] = null;
      }
    }
  }

  let ciRuns = [];
  try {
    ciRuns = ghJson([
      'run',
      'list',
      '--repo',
      'quantm-zeus/foresift',
      '--branch',
      'main',
      '--limit',
      '15',
      '--json',
      'databaseId,headSha,conclusion,url,startedAt',
    ]);
  } catch {}

  let archonRows = [];
  try {
    const raw = execFileSync('archon', ['workflow', 'runs', '--json', '--limit', '30'], {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(raw);
    archonRows = Array.isArray(parsed) ? parsed : (parsed.runs ?? []);
  } catch {}
  archonRows = archonRows.map((r) => ({
    id: r.id ?? '',
    userMessage: r.user_message ?? r.userMessage ?? '',
    status: r.status ?? '',
  }));

  const byId = new Map(archonRows.map((r) => [r.id, r.status]));
  const trackedRows = [...(extra.activeRuns ?? []), ...(extra.milestoneRuns ?? [])].map((e) => ({
    runId: e.runId ?? null,
    packageId: e.packageId ?? null,
    done: Boolean(e.done),
    paused: Boolean(e.paused),
    archonStatus: e.runId ? (byId.get(e.runId) ?? 'unknown') : 'unknown',
  }));

  return {
    packageId,
    milestone: { errors: msErrors, pkg },
    checkout: { branch, trackedDirty: dirtyLines.length > 0, headSha },
    mainSha,
    mergedEvidence,
    artifacts,
    ciRuns,
    archonRows,
    trackedRows,
    pausedFatal: extra.pausedFatal ?? null,
    operatorCiBypassReason: extra.operatorCiBypassReason ?? null,
  };
}
