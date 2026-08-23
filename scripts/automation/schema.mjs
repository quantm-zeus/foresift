// Shared deterministic state model for the Foresift autonomous control plane.
// Pure functions + JSON schema validation, Node stdlib only.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const PACKAGE_STATUSES = [
  'PENDING',
  'RUNNING',
  'VERIFYING',
  'REVIEWING',
  'CI',
  'PROVEN',
  'BLOCKED',
];
export const MILESTONE_STATUSES = ['PLANNED', 'ACTIVE', 'CONVERGED', 'PROVEN'];
export const RISKS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export function repoRoot() {
  // This file lives at <root>/scripts/automation/schema.mjs
  return join(import.meta.dirname, '..', '..');
}

export function implementationDir(root = repoRoot()) {
  return join(root, 'specs', 'implementation');
}

export function loadJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`invalid JSON in ${path}: ${err.message}`);
  }
}

export function loadRoadmap(root = repoRoot()) {
  const roadmap = loadJson(join(implementationDir(root), 'roadmap.json'));
  if (!roadmap) throw new Error('specs/implementation/roadmap.json is missing');
  return roadmap;
}

export function loadCurrentMilestone(root = repoRoot()) {
  return loadJson(join(implementationDir(root), 'current-milestone.json'));
}

export function validateRoadmap(rm) {
  const errs = [];
  const push = (m) => errs.push(`roadmap: ${m}`);
  if (rm.schemaVersion !== '1.0.0') push('unsupported schemaVersion');
  for (const f of ['milestones', 'policy']) if (!(f in rm)) push(`missing field ${f}`);
  if (!Array.isArray(rm.milestones) || rm.milestones.length === 0)
    push('milestones must be a non-empty array');
  const ids = new Set();
  for (const m of rm.milestones ?? []) {
    for (const f of ['id', 'name', 'dependsOn', 'status'])
      if (!(f in m)) push(`milestone missing field ${f}`);
    if (ids.has(m.id)) push(`duplicate milestone id ${m.id}`);
    ids.add(m.id);
    if (!['PLANNED', 'ACTIVE', 'CONVERGED', 'PROVEN'].includes(m.status))
      push(`milestone ${m.id}: invalid status ${m.status}`);
  }
  for (const m of rm.milestones ?? [])
    for (const dep of m.dependsOn ?? [])
      if (!ids.has(dep)) push(`milestone ${m.id} depends on unknown ${dep}`);
  if (rm.currentMilestoneId !== null && !ids.has(rm.currentMilestoneId))
    push(`currentMilestoneId ${rm.currentMilestoneId} is not a known milestone`);
  return errs;
}

export function validateMilestoneState(ms) {
  const errs = [];
  const push = (m) => errs.push(`current-milestone: ${m}`);
  if (ms.schemaVersion !== '1.0.0') push('unsupported schemaVersion');
  for (const f of ['milestoneId', 'status', 'packages']) if (!(f in ms)) push(`missing field ${f}`);
  if (!Array.isArray(ms.packages) || ms.packages.length < 2 || ms.packages.length > 8)
    push('a milestone decomposes into 2-8 work packages');
  const ids = new Set();
  for (const p of ms.packages ?? []) {
    for (const f of [
      'id',
      'objective',
      'requirementIds',
      'dependencies',
      'risk',
      'parallelizable',
      'writeScopes',
      'verificationCommands',
      'status',
    ])
      if (!(f in p)) push(`package ${p.id ?? '?'}: missing field ${f}`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.id ?? ''))
      push(`package ${p.id ?? '?'}: id must be kebab-case`);
    if (ids.has(p.id)) push(`duplicate package id ${p.id}`);
    ids.add(p.id);
    if (!RISKS.includes(p.risk)) push(`package ${p.id}: invalid risk ${p.risk}`);
    if (!PACKAGE_STATUSES.includes(p.status)) push(`package ${p.id}: invalid status ${p.status}`);
    if (typeof p.parallelizable !== 'boolean')
      push(`package ${p.id}: parallelizable must be boolean`);
    if (!Array.isArray(p.requirementIds) || p.requirementIds.length === 0)
      push(`package ${p.id}: requirementIds must be non-empty`);
    if (!Array.isArray(p.writeScopes) || p.writeScopes.length === 0)
      push(`package ${p.id}: writeScopes must be non-empty`);
    if (!Array.isArray(p.verificationCommands) || p.verificationCommands.length === 0)
      push(`package ${p.id}: verificationCommands must be non-empty`);
    if (typeof p.objective !== 'string' || p.objective.trim().length < 10)
      push(`package ${p.id}: objective must be a meaningful sentence`);
  }
  for (const p of ms.packages ?? [])
    for (const dep of p.dependencies ?? []) {
      if (dep === p.id) push(`package ${p.id}: depends on itself`);
      if (!ids.has(dep)) push(`package ${p.id}: unknown dependency ${dep}`);
    }
  // Acyclic dependency check (deterministic topo sort).
  const pending = new Set((ms.packages ?? []).map((p) => p.id));
  const depsOf = Object.fromEntries(
    (ms.packages ?? []).map((p) => [p.id, (p.dependencies ?? []).filter((d) => pending.has(d))]),
  );
  let progress = true;
  while (progress && pending.size > 0) {
    progress = false;
    for (const id of [...pending]) {
      if (depsOf[id].every((d) => !pending.has(d))) {
        pending.delete(id);
        progress = true;
      }
    }
  }
  if (pending.size > 0) push(`circular dependency involving: ${[...pending].join(', ')}`);
  return errs;
}

/**
 * Parse foresift-gate CLI arguments. Pure so the gate's strict arg contract is
 * unit-testable without executing verification.
 *
 * A bare `--` is an end-of-options separator, not a positional: package
 * managers forward it verbatim (`pnpm foresift:gate -- --package <id>`), and
 * node passes it through when running a script file. Any other unrecognized
 * token stays in `_` so the caller can fail closed on unexpected arguments.
 */
export function parseGateArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a === '--package') args.package = argv[++i];
    else if (a === '--milestone') args.milestone = true;
    else args._.push(a);
  }
  return args;
}

/**
 * Deterministic failure classification per the recovery policy.
 *
 * QUOTA_DAILY is matched BEFORE the transient patterns because provider quota
 * errors usually embed generic rate-limit wording ("Request rejected (429) ·
 * Rate limit exceeded: free-models-per-day-stealth") — the daily-quota token
 * is the discriminating evidence, and burning the ordinary transient retry
 * budget against a once-a-day limit is exactly the defect this separates.
 */
export function classifyFailure(message = '') {
  const m = String(message).toLowerCase();
  const fatal = [
    'unauthorized',
    'forbidden',
    'permission denied',
    'invalid token',
    'authentication',
    '401',
    '403',
    'credit balance',
    'invalid workflow definition',
    'workflow not found',
  ];
  const quotaDaily = [
    'free-models-per-day',
    'per-day',
    'per day',
    'daily quota',
    'daily rate limit',
    'daily limit',
    'quota exhausted',
    'quota exceeded',
  ];
  const transient = [
    'timeout',
    'etimedout',
    'rate limit',
    'too many requests',
    '429',
    '502',
    '503',
    'econnrefused',
    'econnreset',
    'connection reset',
    'network error',
    'socket hang up',
    'sigterm',
    'fetch failed',
    'temporarily unavailable',
  ];
  if (fatal.some((p) => m.includes(p))) return 'FATAL';
  if (quotaDaily.some((p) => m.includes(p))) return 'QUOTA_DAILY';
  if (transient.some((p) => m.includes(p))) return 'TRANSIENT';
  return 'UNKNOWN';
}

/**
 * Best-effort extraction of a provider-supplied quota reset time from a
 * failure message ("… resets at 2026-08-24T00:00:00Z …"). Only ISO-8601
 * timestamps are recognized — bare epoch numbers are NOT parsed. Returns epoch
 * milliseconds or null when the provider gave no usable timing — callers must
 * then apply their own bounded backoff policy.
 */
export function extractQuotaResetAt(message = '') {
  const m = String(message);
  const iso =
    /\b(20\d{2}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/g;
  const kw = /(reset|resets|renew|renews|retry)\b.{0,40}?/gi;
  const candidates = [];
  for (const match of m.matchAll(iso)) candidates.push({ idx: match.index, raw: match[1] });
  if (candidates.length === 0) return null;
  // Prefer a candidate that follows reset-ish wording; else the first one.
  let pick = null;
  let bestKw = -1;
  for (const c of candidates) {
    let lastKw = -1;
    for (const k of m.matchAll(kw)) {
      if (k.index <= c.idx && k.index > lastKw) lastKw = k.index;
    }
    if (lastKw >= 0 && (pick === null || lastKw > bestKw)) {
      pick = c;
      bestKw = lastKw;
    }
  }
  if (!pick) pick = candidates[0];
  let v = String(pick.raw).trim().replace(' ', 'T');
  if (!/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(v)) v += 'Z';
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

export function findPackage(ms, packageId) {
  return (ms?.packages ?? []).find((p) => p.id === packageId) ?? null;
}

export function packageEligible(ms, pkg) {
  if (!pkg) return { eligible: false, reason: 'package not found' };
  if (pkg.status !== 'PENDING')
    return { eligible: false, reason: `status is ${pkg.status}, not PENDING` };
  for (const dep of pkg.dependencies ?? []) {
    const depPkg = findPackage(ms, dep);
    if (!depPkg || depPkg.status !== 'PROVEN')
      return { eligible: false, reason: `dependency ${dep} is not PROVEN` };
  }
  return { eligible: true, reason: 'ok' };
}

function scopesOverlap(a, b) {
  return a.some((sa) =>
    b.some(
      (sb) =>
        sa === sb ||
        sa.startsWith(sb.replace(/\*\*$/, '')) ||
        sb.startsWith(sa.replace(/\*\*$/, '')),
    ),
  );
}

function dependsTransitively(ms, fromId, toId) {
  const byId = Object.fromEntries(ms.packages.map((p) => [p.id, p]));
  const seen = new Set();
  const stack = [...(byId[fromId]?.dependencies ?? [])];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === toId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(byId[cur]?.dependencies ?? []));
  }
  return false;
}

/**
 * Concurrency policy (roadmap.policy), exactly as machine-checked below:
 * - foundation milestones: max 1 concurrent coding package;
 * - otherwise max 2, and a co-run additionally requires BOTH packages
 *   parallelizable, no CRITICAL member in the pair, no transitive dependency
 *   between them, and disjoint writeScopes.
 */
export function canStartPackage(roadmap, ms, candidate, runningPackages) {
  const foundation = roadmap.policy.foundationMilestones.includes(ms.milestoneId);
  const max = foundation
    ? roadmap.policy.maxParallelCodingPackagesFoundation
    : roadmap.policy.maxParallelCodingPackages;
  if (runningPackages.length >= max)
    return {
      ok: false,
      reason: `concurrency limit ${max} reached (${foundation ? 'foundation' : 'standard'} policy)`,
    };
  if (candidate.risk === 'CRITICAL' && runningPackages.length > 0)
    return { ok: false, reason: 'CRITICAL packages always run serially' };
  if (candidate.risk === 'CRITICAL') return { ok: true, reason: 'serial CRITICAL start' };
  for (const run of runningPackages) {
    if (run.risk === 'CRITICAL')
      return { ok: false, reason: `cannot co-run with CRITICAL package ${run.id}` };
    if (!run.parallelizable || !candidate.parallelizable)
      return { ok: false, reason: `co-run with ${run.id} requires both parallelizable` };
    if (
      dependsTransitively(ms, candidate.id, run.id) ||
      dependsTransitively(ms, run.id, candidate.id)
    )
      return { ok: false, reason: `dependency relationship with ${run.id}` };
    if (scopesOverlap(candidate.writeScopes, run.writeScopes))
      return { ok: false, reason: `writeScopes overlap with ${run.id}` };
  }
  return { ok: true, reason: 'co-run permitted' };
}
