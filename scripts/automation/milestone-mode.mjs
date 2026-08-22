#!/usr/bin/env node
// Deterministic mode selection for foresift-milestone-control.
// Emits {"mode":"PLAN"|"AUDIT"|"NONE","milestoneId":...,"isFinal":bool} on stdout.
// Exit non-zero on invalid repository state (fail closed). Never AI-judged.

import {
  loadRoadmap,
  loadCurrentMilestone,
  validateRoadmap,
  validateMilestoneState,
} from './schema.mjs';

const FINAL_MILESTONE_ID = 'G7';

const roadmap = loadRoadmap();
const rmErrs = validateRoadmap(roadmap);
if (rmErrs.length) {
  console.error(JSON.stringify({ error: 'invalid roadmap', errors: rmErrs }));
  process.exit(1);
}

const ms = loadCurrentMilestone();
const msErrs = ms ? validateMilestoneState(ms) : ['missing'];

if (!ms || msErrs.length > 0) {
  // Plan (or re-plan) the first eligible milestone per the dependency DAG.
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
      replan: Boolean(ms),
    }),
  );
  process.exit(0);
}

if (ms.packages.every((p) => p.status === 'PROVEN')) {
  console.log(
    JSON.stringify({
      mode: 'AUDIT',
      milestoneId: ms.milestoneId,
      isFinal: ms.milestoneId === FINAL_MILESTONE_ID,
    }),
  );
  process.exit(0);
}

// Work packages still in flight — the work-package workflow/supervisor owns that.
console.log(JSON.stringify({ mode: 'NONE', milestoneId: ms.milestoneId, isFinal: false }));
