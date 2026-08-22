#!/usr/bin/env node
// Deterministic validation of a generated milestone plan (foresift-milestone-control).
//
//   node scripts/automation/milestone-validate.mjs [--expect-next]
//
// --expect-next additionally enforces that the planned milestone is the first
// eligible one according to the roadmap dependency DAG (all deps PROVEN).
// Exit 0 = valid; exit 1 = invalid (reasons printed); never AI-judged.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadRoadmap,
  loadCurrentMilestone,
  validateRoadmap,
  validateMilestoneState,
  repoRoot,
} from './schema.mjs';

const expectNext = process.argv.includes('--expect-next');
const root = repoRoot();

const roadmap = loadRoadmap();
const errs = validateRoadmap(roadmap);
const ms = loadCurrentMilestone();
errs.push(...(ms ? validateMilestoneState(ms).map((e) => e) : ['current-milestone.json missing']));
if (errs.length) {
  console.error(JSON.stringify({ valid: false, errors: errs }, null, 2));
  process.exit(1);
}

// Requirement IDs must exist in the authoritative manifest.
const manifest = JSON.parse(
  readFileSync(
    join(
      root,
      'docs',
      'spec',
      'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
    ),
    'utf8',
  ),
);
const knownIds = new Set(manifest.requirements.map((r) => r.id));
for (const p of ms.packages) {
  for (const rid of p.requirementIds) {
    if (!knownIds.has(rid))
      errs.push(`package ${p.id}: requirement ${rid} does not exist in the authoritative manifest`);
  }
}

// Manifest hygiene: supersededBy must be an array. A truthy-but-empty value
// (e.g. [] being treated as present) would silently disable coverage
// accounting below, so fail loudly on the malformed shape.
for (const r of manifest.requirements) {
  if (!Array.isArray(r.supersededBy))
    errs.push(`manifest requirement ${r.id}: supersededBy must be an array`);
}

// Every manifest requirement assigned to this milestone must be covered by
// exactly one package — no gaps, no double-assignment. Only requirements with
// a non-empty supersededBy list are excluded from the coverage obligation.
const groupReqs = manifest.requirements
  .filter((r) => r.dependencyGroup === ms.milestoneId && (r.supersededBy ?? []).length === 0)
  .map((r) => r.id);
const assigned = new Map();
for (const p of ms.packages)
  for (const rid of p.requirementIds) {
    if (!assigned.has(rid)) assigned.set(rid, []);
    assigned.get(rid).push(p.id);
  }
for (const rid of groupReqs) {
  if (!assigned.has(rid)) errs.push(`milestone requirement ${rid} is not covered by any package`);
}
for (const [rid, pkgs] of assigned) {
  if (pkgs.length > 1)
    errs.push(`requirement ${rid} assigned to multiple packages: ${pkgs.join(', ')}`);
  if (!knownIds.has(rid)) continue; // already reported above
  const reqGroup = manifest.requirements.find((r) => r.id === rid)?.dependencyGroup;
  if (reqGroup !== ms.milestoneId)
    errs.push(`package assigns ${rid} from group ${reqGroup} to milestone ${ms.milestoneId}`);
}

// Risk / parallelism sanity.
for (const p of ms.packages) {
  if (p.risk === 'CRITICAL' && p.parallelizable)
    errs.push(`package ${p.id}: CRITICAL packages must be parallelizable=false`);
}

// Milestone identity + progression.
if (ms.milestoneId !== roadmap.currentMilestoneId)
  errs.push(
    `roadmap.currentMilestoneId (${roadmap.currentMilestoneId}) != planned milestone (${ms.milestoneId})`,
  );
if (expectNext) {
  const byId = Object.fromEntries(roadmap.milestones.map((m) => [m.id, m]));
  const eligible = roadmap.milestones.filter(
    (m) => m.status !== 'PROVEN' && (m.dependsOn ?? []).every((d) => byId[d]?.status === 'PROVEN'),
  );
  if (eligible.length === 0 || eligible[0].id !== ms.milestoneId)
    errs.push(
      `planned milestone ${ms.milestoneId} is not the first eligible milestone (${
        eligible[0]?.id ?? 'none pending'
      })`,
    );
}

if (errs.length) {
  console.error(JSON.stringify({ valid: false, errors: errs }, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify({
    valid: true,
    milestone: ms.milestoneId,
    packages: ms.packages.length,
    requirementsCovered: assigned.size,
    groupRequirements: groupReqs.length,
  }),
);
