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

export const ALLOWED_STATUS_TRANSITIONS = new Set([
  'PENDING->RUNNING',
  'RUNNING->PROVEN',
  'RUNNING->PENDING',
  'PROVEN->RUNNING',
  'PENDING->PROVEN',
]);

export function serializeMilestoneState(ms) {
  // Synchronous immutable snapshot — callers continue mutating `ms` after this
  // returns, so it must capture the state NOW. Prettier formatting (which is
  // async in prettier v3) is applied later, inside the serialized queue, via
  // formatMilestoneText(). Falls back to plain stringify if prettier is
  // unavailable (observed live 2026-08-30: unformatted state PR #102 failed
  // the format:check gate).
  return JSON.stringify(ms, null, 2) + '\n';
}

export async function formatMilestoneText(text) {
  // Prettier collapses short arrays; raw JSON.stringify does not. Formatting
  // state-landing content keeps the format:check gate green.
  try {
    const { format } = await import('prettier');
    return await format(text, { filepath: 'current-milestone.json' });
  } catch {
    return text;
  }
}

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
    // V3 §6: durable execution generation. Optional for legacy state; once
    // present it must be a non-negative integer and is bumped ONLY by the
    // supported fresh-restart command — never hand-edited.
    if (p.generation !== undefined && (!Number.isInteger(p.generation) || p.generation < 0))
      push(`package ${p.id}: generation must be a non-negative integer`);
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
 * failure message ("… resets at 2026-08-24T00:00:00Z …", epoch seconds/ms near
 * reset wording). Returns epoch milliseconds or null when the provider gave
 * no usable timing — callers must then apply their own bounded backoff policy.
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

// Root/shared mechanical surfaces: files whose mutation is order-sensitive
// across ANY package pair (every workspace scaffold regenerates the lockfile;
// root configs re-shape every build). Declaring ownership of any of these is
// therefore a GLOBAL serialization claim — no second coding package may start
// while either side declares one, even when the package-scoped globs are
// disjoint. Pair-concurrency audit 2026-08-26: this is exactly how the
// provider-lifecycle × tool-core collision manifests (both waves regenerate
// pnpm-lock.yaml and extend the shared migration registry), so the admission
// gate refuses such pairs by DECLARATION instead of by merge accident.
const ROOT_SHARED_SURFACES = new Set([
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package.json',
  'tsconfig.json',
  'tsconfig.base.json',
  'eslint.config.js',
]);

function declaresRootSharedSurface(pkg) {
  return (Array.isArray(pkg.writeScopes) ? pkg.writeScopes : []).some((s) =>
    ROOT_SHARED_SURFACES.has(s),
  );
}

function knownWriteScopes(pkg) {
  return Array.isArray(pkg.writeScopes) && pkg.writeScopes.length > 0;
}

/**
 * Concurrency policy (roadmap.policy) — the deterministic pairwise admission
 * gate (canRunTogether law): two packages co-run only when every
 * concurrentRequiresAllOf condition holds between them, evaluated here as a
 * total, fail-closed decision:
 * - foundation milestones: max 1 concurrent coding package; otherwise max 2;
 * - CRITICAL packages (either side) always serialize;
 * - both sides must be declared parallelizable;
 * - no direct or transitive dependency relation in either direction;
 * - BOTH sides must declare known write scopes (unknown ⇒ deny);
 * - neither side may claim a root/shared mechanical surface (global
 *   serialization claim ⇒ deny);
 * - effective writeScopes must be disjoint.
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
    // Fail closed on unknown scope truth: a pair may only co-run when BOTH
    // sides declare provably disjoint ownership. Missing/empty declarations
    // are UNKNOWN, never safe-by-default.
    if (!knownWriteScopes(candidate) || !knownWriteScopes(run))
      return { ok: false, reason: `unknown write-scope truth vs ${run.id}` };
    // Either side claiming a root/shared mechanical surface serializes the
    // whole system — co-run denied regardless of package-scope disjointness.
    if (declaresRootSharedSurface(candidate) || declaresRootSharedSurface(run))
      return { ok: false, reason: `root/shared surface serialization with ${run.id}` };
    if (scopesOverlap(candidate.writeScopes, run.writeScopes))
      return { ok: false, reason: `writeScopes overlap with ${run.id}` };
  }
  return { ok: true, reason: 'co-run permitted' };
}
