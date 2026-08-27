#!/usr/bin/env node
// Deterministic PR → exact-head CI → squash-merge lander (task spec §18–§21).
//
//   package-land.mjs --branch <branch> --title <title> [--body-file <f>]
//                    [--check-name <n>] [--deadline-s <s>] [--poll-s <s>]
//
// Mechanical contract:
//   1. refuse on dirty TRACKED tree (untracked evidence dirs don't block)
//   2. BASE ADMISSION (V3-D §11): the branch must CARRY current origin/main
//      (`merge-base --is-ancestor`); a sibling landing meanwhile ⇒ refuse
//      'base-drift' BEFORE any push — never land code validated against an
//      older world
//   3. push branch (idempotent when already current)
//   4. discover an OPEN PR for the branch or create exactly one
//   5. pin the LOCAL HEAD sha; wait for the named check AT THAT SHA
//      (never "latest run": a later push invalidates everything)
//   6. red CI ⇒ exit 1 with the failure names. NEVER bypassed, NEVER retried
//      into greenness — the only repair is new commits producing a NEW head
//   7. zero check-runs at the pinned head ⇒ diagnose-and-fail-fast when the
//      merge ref conflicts with main (the silent-CI squash-base trap);
//      otherwise bounded patience, then fail with the same hint
//   8. immediately before merging: RE-RUN base admission (closes the window
//      where a sibling merged while CI ran), re-confirm origin branch ==
//      pinned sha, then squash-merge. Any drift ⇒ abort, never merge a
//      moving target
//
// Exit codes: 0 merged · 1 refused/failed (with reason) · 2 usage error.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  landingAdmission,
  isAncestorSha,
  isShallowCheckout,
  BASE_DRIFT_REASON,
} from './base-drift.mjs';
import {
  getExactHeadCiStatus,
  captureCiIncident,
  DEFAULT_REQUIRED_CHECK,
  DEFAULT_REQUIRED_APP_ID,
  DEFAULT_REPO,
} from './ci-authority.mjs';
import { executeCiRepair } from './ci-repair-executor.mjs';

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();
}
function shAllowFail(cmd, args) {
  try {
    return { ok: true, out: sh(cmd, args) };
  } catch (e) {
    return { ok: false, out: String(e.stdout ?? e.message) };
  }
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--branch':
        a.branch = argv[++i];
        break;
      case '--title':
        a.title = argv[++i];
        break;
      case '--body-file':
        a.bodyFile = argv[++i];
        break;
      case '--check-name':
        a.checkName = argv[++i];
        break;
      case '--deadline-s':
        a.deadlineS = Number(argv[++i]);
        break;
      case '--poll-s':
        a.pollS = Number(argv[++i]);
        break;
    }
  }
  return a;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.branch || !a.title) {
    console.error('usage: package-land.mjs --branch <branch> --title <title> [--body-file <f>]');
    process.exit(2);
  }
  const checkName = a.checkName ?? DEFAULT_REQUIRED_CHECK;
  const deadlineMs = (a.deadlineS ?? 1800) * 1000;
  const pollMs = Math.max((a.pollS ?? 20) * 1000, 5000);
  if (a.bodyFile && !existsSync(a.bodyFile)) {
    console.error(`--body-file '${a.bodyFile}' does not exist`);
    process.exit(2);
  }
  const trace = [];
  const step = (event, detail) => {
    trace.push({ ts: new Date().toISOString(), event, detail });
    console.log(`LAND ▸ ${event}: ${detail}`);
  };

  // 1. Clean tracked tree.
  const dirty = sh('git', ['status', '--porcelain', '--untracked-files=no']);
  if (dirty) {
    step('refused', `dirty tracked tree:\n${dirty}`);
    console.log(JSON.stringify({ merged: false, reason: 'dirty-tree', trace }, null, 2));
    process.exit(1);
  }

  // 2. BASE ADMISSION before any push (V3-D §11): refuse branches that do not
  // carry current origin/main — they would land code never validated against
  // the world it joins after a sibling's parallel landing. A SHALLOW checkout
  // cannot answer the ancestry question at all, so it refuses fail-closed
  // rather than guessing.
  const gitArgs = (...args) => sh('git', args);
  const admitBase = () => {
    let verdict;
    try {
      sh('git', ['fetch', 'origin', 'main']);
      const mainSha = sh('git', ['rev-parse', 'FETCH_HEAD']);
      const head = sh('git', ['rev-parse', 'HEAD']);
      const contains = isAncestorSha(gitArgs, mainSha, head);
      if (contains === null) throw new Error('merge-base unverifiable');
      if (!contains && isShallowCheckout(gitArgs)) {
        // The "false" is untrustworthy here — the base commit may simply be
        // absent from a truncated history. Landing needs a full checkout.
        return {
          ok: false,
          reason: BASE_DRIFT_REASON,
          detail:
            'shallow checkout cannot prove base containment — run the lander from a full clone/worktree',
        };
      }
      verdict = landingAdmission({
        currentMainResolved: true,
        branchContainsCurrentMain: contains,
      });
    } catch (e) {
      verdict = landingAdmission({ currentMainResolved: false });
      verdict.detail = `${verdict.detail} (${String(e?.message ?? e).split('\n')[0]})`;
    }
    return verdict;
  };
  const refuseBase = (verdict, at) => {
    step(`aborted-${at}`, `${verdict.reason}: ${verdict.detail}`);
    console.log(
      JSON.stringify(
        { merged: false, reason: verdict.reason, detail: verdict.detail, trace },
        null,
        2,
      ),
    );
    process.exit(1);
  };
  {
    const v = admitBase();
    if (!v.ok) refuseBase(v, 'base-admission');
  }
  step('base-admitted', 'branch carries current origin/main');

  // 3. Push (idempotent).
  sh('git', ['push', '-u', 'origin', a.branch]);
  step('pushed', a.branch);

  // 4. Discover or create the PR.
  let prNum = null;
  try {
    const listed = sh('gh', [
      'pr',
      'list',
      '--head',
      a.branch,
      '--state',
      'open',
      '--json',
      'number',
      '--jq',
      '.[0].number',
    ]);
    if (listed) prNum = listed;
  } catch {
    /* fall through to create */
  }
  if (!prNum) {
    const bodyArgs = a.bodyFile ? ['--body-file', a.bodyFile] : ['--fill'];
    prNum = sh('gh', ['pr', 'create', '--head', a.branch, '--title', a.title, ...bodyArgs]);
    // `gh pr create` prints the URL; extract the number deterministically.
    const m = /\/pull\/(\d+)/.exec(prNum.split('\n').pop() ?? '');
    if (!m) {
      step('failed', `could not parse PR number from: ${prNum}`);
      process.exit(1);
    }
    prNum = m[1];
  }
  step('pr-ready', `#${prNum}`);

  // 5. Pin the head; wait for the check AT THAT SHA.
  let pinSha = sh('git', ['rev-parse', 'HEAD']);
  step('head-pinned', pinSha);

  const start = Date.now();
  let sawAnyCheckRun = false;
  while (Date.now() - start < deadlineMs) {
    const verdict = getExactHeadCiStatus({
      sha: pinSha,
      repo: DEFAULT_REPO,
      checkName,
      requiredAppId: DEFAULT_REQUIRED_APP_ID,
      cwd: process.cwd(),
    });

    if (verdict.runs && verdict.runs.length > 0) sawAnyCheckRun = true;

    if (verdict.ok && verdict.state === 'SUCCESS') {
      step('ci-green', `${checkName} succeeded at ${pinSha}`);
      break;
    }

    if (verdict.state === 'FAILURE' || verdict.state === 'UNTRUSTED') {
      const incident = captureCiIncident({
        sha: pinSha,
        repo: DEFAULT_REPO,
        checkName,
        requiredAppId: DEFAULT_REQUIRED_APP_ID,
        cwd: process.cwd(),
      });
      const failureReason = verdict.state === 'UNTRUSTED' ? 'ci-untrusted' : 'ci-red';
      step(failureReason, `${verdict.reason || verdict.failureSummary} at ${pinSha}`);

      // ── Execute bounded repair if available ─────────────────────────────────
      if (incident?.capsule) {
        const repairResult = executeCiRepair({
          incident,
          branch: a.branch,
          worktreeDir: process.cwd(),
          log: (msg) => step('repair', msg),
        });
        step(
          'repair-result',
          JSON.stringify({
            action: repairResult.action,
            result: repairResult.result,
            newHead: repairResult.newHead,
          }),
        );

        if (repairResult.retry && repairResult.newHead) {
          // FORMAT repair pushed a new HEAD — update pinSha and continue CI polling
          pinSha = repairResult.newHead;
          step('head-updated', `new HEAD after repair: ${pinSha}`);
          // Reset sawAnyCheckRun so the deadline heuristic doesn't fire prematurely
          sawAnyCheckRun = false;
          sleepSync(pollMs); // brief pause before next CI check
          continue;
        }

        if (repairResult.retry && !repairResult.newHead) {
          // INFRA retry: wait the backoff period then loop
          if (repairResult.waitMs) sleepSync(repairResult.waitMs);
          continue;
        }
      }

      // Not retryable — emit incident info and fail
      console.log(
        JSON.stringify(
          {
            merged: false,
            reason: failureReason,
            failures: verdict.failureSummary,
            pinnedHead: pinSha,
            incidentId: incident?.capsule?.eventId,
            incidentPath: incident?.filePath,
            repairRoute: incident?.capsule?.repairRoute,
            trace,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }

    if (verdict.state === 'API_ERROR') {
      step('api-transient', verdict.reason || 'unknown API error');
    } else if (verdict.state === 'API_UNPARSEABLE') {
      step('api-unparseable', verdict.reason || 'unparseable API response');
    }

    // Still running (or not yet reported).
    const elapsed = Date.now() - start;
    if (!sawAnyCheckRun && elapsed > Math.min(deadlineMs / 2, 300000)) {
      const ms = shAllowFail('gh', [
        'pr',
        'view',
        prNum,
        '--json',
        'mergeStateStatus',
        '--jq',
        '.mergeStateStatus',
      ]);
      const state = ms.ok ? ms.out : 'UNKNOWN';
      step(
        'no-check-runs',
        `no '${checkName}' check-run appeared for ${pinSha} after ${Math.round(elapsed / 1000)}s ` +
          `(mergeStateStatus=${state}). Known cause: branch based on a since-squashed commit → ` +
          'recreate the branch from updated origin/main.',
      );
      console.log(
        JSON.stringify(
          {
            merged: false,
            reason: 'no-check-runs',
            mergeStateStatus: state,
            pinnedHead: pinSha,
            trace,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    step('waiting', `${Math.round(elapsed / 1000)}s elapsed for ${checkName} at ${pinSha}`);
    sleepSync(pollMs);
  }
  if (Date.now() - start >= deadlineMs) {
    step('timeout', `deadline exceeded waiting for ${checkName} at ${pinSha}`);
    console.log(
      JSON.stringify({ merged: false, reason: 'timeout', pinnedHead: pinSha, trace }, null, 2),
    );
    process.exit(1);
  }

  // 7. Final drift guard + squash merge. Base admission RE-RUNS here to close
  // the TOCTOU window: a sibling package may have merged while CI ran.
  {
    const v = admitBase();
    if (!v.ok) refuseBase(v, 'pre-merge-base');
  }
  sh('git', ['fetch', 'origin', a.branch]);
  const remoteSha = sh('git', ['rev-parse', 'origin/' + a.branch]);
  if (remoteSha !== pinSha) {
    step('aborted-drift', `origin/${a.branch} moved (${remoteSha}) ≠ pinned ${pinSha}`);
    console.log(
      JSON.stringify(
        { merged: false, reason: 'head-moved', pinnedHead: pinSha, remoteHead: remoteSha, trace },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  sh('gh', ['pr', 'merge', prNum, '--squash']);
  step('merged', `PR #${prNum} squash-merged at pinned head ${pinSha}`);
  console.log(
    JSON.stringify(
      { merged: true, pr: Number(prNum), squashSha: pinSha, checkName, trace },
      null,
      2,
    ),
  );
}

const invokedDirectly = process.argv[1]?.endsWith('package-land.mjs');
if (invokedDirectly) main();
