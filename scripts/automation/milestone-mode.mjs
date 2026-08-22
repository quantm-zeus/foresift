#!/usr/bin/env node
// Deterministic mode selection for foresift-milestone-control.
// Emits {"mode":"PLAN"|"AUDIT"|"NONE","milestoneId":...,"isFinal":bool} on stdout.
// Exit non-zero on invalid repository state (fail closed). Never AI-judged.
//
// DRAFT CONTINUATION: an UNCOMMITTED specs/implementation/current-milestone.json
// means milestone planning is still in progress (the planning workflow lands its
// result exclusively via PR). Such a state must resume PLAN — treating it as
// NONE would strand the draft forever (every relaunch cancels as "nothing to
// do"). A COMMITTED-CLEAN current milestone with unfinished packages is under
// implementation ownership (supervisor + foresift-work-package) → NONE.

import { execFileSync } from 'node:child_process';
import {
  repoRoot,
  loadRoadmap,
  loadCurrentMilestone,
  validateRoadmap,
  validateMilestoneState,
} from './schema.mjs';

const FINAL_MILESTONE_ID = 'G7';
const ROOT = process.env.FORESIFT_REPO_ROOT ?? repoRoot(); // test seam; default = script's own repo

/** True iff current-milestone.json is tracked by git AND has no local modifications. */
function milestoneIsCommittedClean() {
  const file = 'specs/implementation/current-milestone.json';
  try {
    execFileSync('git', ['-C', ROOT, 'ls-files', '--error-unmatch', file], { stdio: 'pipe' });
    const dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', file], {
      encoding: 'utf8',
    });
    return dirty.trim().length === 0;
  } catch {
    return false; // untracked or git unavailable ⇒ treat as draft/unlanded
  }
}

const roadmap = loadRoadmap(ROOT);
const rmErrs = validateRoadmap(roadmap);
if (rmErrs.length) {
  console.error(JSON.stringify({ error: 'invalid roadmap', errors: rmErrs }));
  process.exit(1);
}

let ms;
let msErrs;
try {
  ms = loadCurrentMilestone(ROOT);
} catch (err) {
  console.error(
    JSON.stringify({
      error: 'corrupt implementation state',
      detail: String(err?.message ?? err),
      failClosed: true,
    }),
  );
  process.exit(1);
}
msErrs = ms ? validateMilestoneState(ms) : ['missing'];

if (ms && msErrs.length > 0) {
  // CORRUPT STATE FAILS CLOSED: current-milestone.json exists but does not
  // validate. Never silently re-plan over possibly-corrupt implementation
  // state — surface the error so the supervisor pauses fatally instead.
  console.error(
    JSON.stringify({ error: 'corrupt implementation state', errors: msErrs, failClosed: true }),
  );
  process.exit(1);
}

if (!ms) {
  // Plan the first eligible milestone per the dependency DAG.
  const byId = Object.fromEntries(roadmap.milestones.map((m) => [m.id, m]));
  const eligible = roadmap.milestones.filter(
    (m) => m.status !== 'PROVEN' && (m.dependsOn ?? []).every((d) => byId[d]?.status === 'PROVEN'),
  );
  if (eligible.length === 0) {
    console.error(
      JSON.stringify({ error: 'no eligible milestone to plan and no valid current milestone' }),
    );
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      mode: 'PLAN',
      milestoneId: eligible[0].id,
      isFinal: eligible[0].id === FINAL_MILESTONE_ID,
    }),
  );
  process.exit(0);
}

if (ms.packages.every((p) => p.status === 'PROVEN')) {
  const isFinal = ms.milestoneId === FINAL_MILESTONE_ID;
  console.log(
    JSON.stringify({
      mode: isFinal ? 'AUDIT_FINAL' : 'AUDIT',
      milestoneId: ms.milestoneId,
      isFinal,
    }),
  );
  process.exit(0);
}

if (!milestoneIsCommittedClean()) {
  // Unlanded draft (untracked or locally modified): planning never completed
  // its PR. Resume PLAN so the bounded planning loop continues exactly this
  // milestone instead of cancelling.
  const isFinal = ms.milestoneId === FINAL_MILESTONE_ID;
  console.log(
    JSON.stringify({ mode: 'PLAN', milestoneId: ms.milestoneId, isFinal, resumingDraft: true }),
  );
  process.exit(0);
}

// Landed milestone with work packages still in flight — the work-package
// workflow/supervisor owns that; there is nothing to plan or audit here.
console.log(JSON.stringify({ mode: 'NONE', milestoneId: ms.milestoneId, isFinal: false }));
