// Shared derivation layer for deterministic, authority-bound planning inputs
// (throughput mission §8/§20). Both CLIs — build-plan-context.mjs (context
// capsule) and bootstrap-package-spec.mjs (mechanical spec seeding) — MUST go
// through this module so they can never drift apart.
//
// Everything here is a CACHE/index derived from the authoritative inputs
// (requirement manifest, committed milestone state, PRD bytes). It is never
// product authority. All outputs are byte-stable given identical inputs: no
// timestamps, sorted where order is not fixed by the source document.
//
// Fails closed by throwing PlanContextError; CLIs translate that to exit 1.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, loadCurrentMilestone, validateMilestoneState, findPackage } from './schema.mjs';

export const CAPSULE_SCHEMA = 'foresift/plan-context@1';
export const BUILDER_VERSION = 1;

export const PRD_PATH = 'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md';
export const MANIFEST_PATH =
  'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json';

export class PlanContextError extends Error {}

function gitOut(cmd, cwd) {
  const r = spawnSync(`git ${cmd}`, { shell: true, cwd, encoding: 'utf8' });
  return r.status === 0 ? (r.stdout ?? '').trim() : null;
}

const sha256File = (absPath) => createHash('sha256').update(readFileSync(absPath)).digest('hex');

/**
 * Derive every deterministic input one package's planning needs.
 *
 * @param {string} root repository/worktree root (defaults to the real repo)
 * @param {string} packageId work-package id from the current milestone
 */
export function derivePackageContext(root = repoRoot(), packageId) {
  if (!packageId) throw new PlanContextError('missing package id');
  const rel = (...p) => join(root, ...p);

  // ── authoritative manifest ──────────────────────────────────────────────────
  const manifestAbs = rel(MANIFEST_PATH);
  if (!existsSync(manifestAbs))
    throw new PlanContextError(`missing requirement manifest ${MANIFEST_PATH}`);
  const manifest = JSON.parse(readFileSync(manifestAbs, 'utf8'));
  const manifestRaw = manifest.requirements ?? manifest;
  const requirements = Array.isArray(manifestRaw) ? manifestRaw : Object.values(manifestRaw);
  const byId = new Map(requirements.map((r) => [r.id ?? r.requirementId, r]));
  const acCatalog = (() => {
    const raw = manifest.acceptanceCriteria;
    if (!raw) return new Map();
    const arr = Array.isArray(raw) ? raw : Object.values(raw);
    return new Map(arr.map((a) => [a.id, a]));
  })();

  // ── committed milestone state ───────────────────────────────────────────────
  const ms = loadCurrentMilestone(root);
  if (!ms || validateMilestoneState(ms).length > 0)
    throw new PlanContextError('current milestone state invalid or missing');
  const pkg = findPackage(ms, packageId);
  if (!pkg)
    throw new PlanContextError(`package ${packageId} not found in milestone ${ms.milestoneId}`);

  const prdAbs = rel(PRD_PATH);
  if (!existsSync(prdAbs)) throw new PlanContextError(`missing authoritative PRD ${PRD_PATH}`);

  const headSha = gitOut('rev-parse HEAD', root);
  if (!headSha) throw new PlanContextError('not inside a git repository');

  const assignedReqs = pkg.requirementIds.map((id) => {
    const r = byId.get(id);
    if (!r)
      throw new PlanContextError(`requirement ${id} assigned to package not found in manifest`);
    return {
      id,
      text: r.text ?? '',
      normativeLevel: r.normativeLevel ?? null,
      section: r.section ?? null,
      line: r.line ?? null,
      securityRightsCostControls: r.securityRightsCostControls ?? null,
      acs: (r.acceptanceCriteria ?? []).map((a) => {
        const acid = typeof a === 'string' ? a : a.id;
        const cat = acCatalog.get(acid) ?? {};
        return {
          id: acid,
          positiveTestRef: cat.positiveTestRef ?? null,
          negativeOrFailureTestRef: cat.negativeOrFailureTestRef ?? null,
          evidenceOwner: cat.evidenceOwner ?? null,
          crossCutting: (cat.requirementRefs?.length ?? 0) > 1,
        };
      }),
      schemaRefs: r.schemaRefs ?? [],
      fixtureRefs: r.fixtureRefs ?? [],
      telemetryRefs: r.telemetryRefs ?? [],
      testRefs: r.testRefs ?? [],
    };
  });

  const depStatus = (pkg.dependencies ?? []).map((d) => {
    const dep = findPackage(ms, d);
    return { id: d, status: dep?.status ?? 'UNKNOWN' };
  });

  const adrFiles = existsSync(rel('docs', 'adr'))
    ? readdirSync(rel('docs', 'adr'))
        .filter((f) => f.endsWith('.md') && f !== 'README.md')
        .sort()
    : [];

  const otherPackages = ms.packages
    .filter((p) => p.id !== packageId)
    .map((p) => ({ id: p.id, objective: p.objective }));

  // Acceptance-criteria sharing WITHIN this package drives downstream layout:
  // an AC attached to several requirements is documented once, not per requirement.
  const acDetail = new Map();
  const acCounts = new Map();
  for (const r of assignedReqs) {
    for (const a of r.acs) {
      if (!acDetail.has(a.id)) acDetail.set(a.id, a);
      acCounts.set(a.id, (acCounts.get(a.id) ?? 0) + 1);
    }
  }
  const ownAcs = (r) => r.acs.filter((a) => (acCounts.get(a.id) ?? 0) === 1);
  const sharedAcs = [...acCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, count]) => ({
      id,
      requirementCount: count,
      positiveTestRef: acDetail.get(id)?.positiveTestRef ?? null,
      negativeOrFailureTestRef: acDetail.get(id)?.negativeOrFailureTestRef ?? null,
    }));

  const bound = {
    mainHeadSha: headSha,
    prdSha256: sha256File(prdAbs),
    prdPath: PRD_PATH,
    manifestSha256: sha256File(manifestAbs),
    manifestPath: MANIFEST_PATH,
    milestoneFileSha256: sha256File(rel('specs', 'implementation', 'current-milestone.json')),
    adrFiles,
  };

  return {
    root,
    pkg,
    ms,
    assignedReqs,
    depStatus,
    adrFiles,
    otherPackages,
    ownAcs,
    sharedAcs,
    bound,
  };
}
