// Runtime admission bridge (Hyperdrive H2, mission §17/§20/§41): joins the
// global provider pools (provider-pool.mjs) and the exact-file lease manager
// (exact-leases.mjs) into the supervisor's real launch/finish paths.
//
// Contract:
//   - ONE global pool per provider across all concurrent packages (§17) — a
//     launch probes/admits against the SAME pool every other launch uses.
//   - Runtime provider concurrency is owned by LANE PERMITS (provider-pool
//     acquireLanePermit): ONE actual provider invocation = ONE permit, held
//     exactly for the invocation's lifetime by the lane wrapper. The
//     supervisor holds NO run-level reservations for lane-bearing engines —
//     a package-level reservation would double-count against its own lanes
//     and deterministically deny lanes under default pool policy (review
//     finding 2).
//   - Claude is required in every profile: it is the fallback engine (§20),
//     so a launch is refused when the Claude pool has zero headroom — probed
//     acquire+release, nothing held. Codex quota health is observed per-lane
//     (observeCodexOutcome); a CODEX_QUOTA_* latched pool reroutes compatible
//     work to Claude via the wave's routing.
//   - Unknown/empty exact write sets fail closed to a conservative scope
//     lease over the package's declared writeScopes (§41).
//   - Release is idempotent and total: leases always travel through
//     releasePackageRuntime so a terminal run can never strand a lease across
//     a supervisor restart. (Held provider permits no longer exist at run
//     level; releasePackageRuntime stays compatible with old entries.)
//
// Zero AI: admission is deterministic arithmetic over durable state files.

import { acquireLeases, releaseLeases, SHARED_SURFACE_FILES } from './exact-leases.mjs';
import { acquirePermit, releasePermit } from './provider-pool.mjs';

/** Providers a launch of `profile` may dispatch, in acquisition order. */
export function providersForProfile(profile) {
  switch (profile) {
    // Claude first in every profile: it is the §20 fallback engine, so its
    // health gates every launch. Codex and AGY are the writer/test pools —
    // under the H2 lane-permit model their runtime counts live in per-lane
    // permits, not in package-level reservations.
    case 'CODEX_AGY':
      return ['claude', 'codex', 'agy'];
    case 'CLAUDE_AGY':
      return ['claude', 'agy'];
    case 'HYBRID_AGY':
      return ['claude', 'codex', 'agy'];
    default:
      throw new Error(`UNKNOWN_EXECUTION_PROFILE: ${String(profile)}`);
  }
}

/**
 * Providers the SUPERVISOR admits for the package-level gate. Lane-bearing
 * engines are NOT reserved at package level (review finding 2): every writer
 * and repair lane acquires its OWN lane permit from the same global pool
 * immediately before its provider invocation, so a run-level reservation for
 * claude/codex would double-count against the lanes and — under default
 * policy (claude 3, codex 1) with up to 3 concurrent lanes — deny lanes
 * deterministically (POOL_AT_LIMIT) and fail the wave. Only CODEX_AGY keeps
 * a run-level codex reservation: the legacy Codex-only wave dispatches one
 * serialized codex stream that is the run itself.
 */
export function supervisorProvidersForProfile(profile) {
  // CODEX_AGY: the legacy Codex-only wave dispatches one serialized codex
  // stream that IS the run, so its codex permit is held at package level.
  // Every other engine dispatches per-lane writers that hold their own lane
  // permits — no run-level reservation (review finding 2).
  return providersForProfile(profile).filter((p) => p === 'codex' && profile === 'CODEX_AGY');
}

/**
 * Deterministic pre-launch admission for ONE package. Returns
 * { ok, providers, fallback, reason } — ok:false leaves NO partial state
 * (leases granted before a later failure are released again).
 *
 *   providers — every provider permit HELD for the run (only CODEX_AGY's
 *               codex reservation today; lane-bearing engines hold none)
 *   fallback  — providers skipped because the pool reroutes their work
 *               (Codex exhausted under HYBRID/CLAUDE_AGY ⇒ Claude fallback)
 */
export function admitPackageLaunch(stateDir, pkg, executionProfile, opts = {}) {
  if (!pkg?.id) return { ok: false, providers: [], fallback: [], reason: 'INVALID_PACKAGE' };
  const acquired = [];
  // Profile validation first (fail closed before touching any pool state).
  try {
    providersForProfile(executionProfile);
  } catch {
    return { ok: false, providers: [], fallback: [], reason: 'INVALID_PROFILE' };
  }
  // Claude admission PROBE (review finding 2): acquire+release against the
  // SAME pool the lanes do, holding nothing. Claude is the §20 fallback
  // engine, so a launch is refused when the Claude pool has zero headroom or
  // is in pressure backoff — but no run-level permit is held, and capacity
  // freed by lane completion is immediately visible to the lanes themselves.
  try {
    const claudeProbe = acquirePermit(stateDir, 'claude', { now: opts.now ?? Date.now() });
    if (claudeProbe.ok) {
      releasePermit(stateDir, 'claude');
    } else {
      return {
        ok: false,
        providers: [],
        fallback: [],
        reason: `${claudeProbe.reason ?? 'POOL_AT_LIMIT'}: provider claude`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      providers: [],
      fallback: [],
      reason: `CLAUDE_PROBE_ERROR: ${String(err?.message ?? err)}`,
    };
  }
  // Run-level reservations: ONLY the run-is-the-stream engines that do not
  // dispatch per-lane writers (CODEX_AGY's serialized codex stream). See
  // supervisorProvidersForProfile.
  const runLevel = supervisorProvidersForProfile(executionProfile).filter((p) => p === 'codex');
  for (const provider of runLevel) {
    const permit = acquirePermit(stateDir, provider, { now: opts.now ?? Date.now() });
    if (permit.ok) {
      acquired.push(provider);
      continue;
    }
    // Fail-closed unwind: a non-admitted launch never leaks permits.
    for (const held of acquired) {
      try {
        releasePermit(stateDir, held);
      } catch {}
    }
    return {
      ok: false,
      providers: [],
      fallback: [],
      reason: `${permit.reason ?? 'POOL_AT_LIMIT'}: provider ${provider}`,
    };
  }
  // Exact-file leases: the supervisor cannot know per-lane exact writes
  // before the wave's task graph exists, so it leases ONLY the root/shared
  // surfaces the package's scopes name (single-holder serialization where it
  // is provably needed) — package-level scope leases would serialize every
  // co-runner on distinct globs and defeat the H2 granularity this landing
  // exists for. Empty intersection ⇒ no lease needed; co-run safety remains
  // owned by canStartPackage's writeScopes overlap veto.
  const sharedSurfaces = (pkg.writeScopes ?? []).flatMap((scope) =>
    SHARED_SURFACE_FILES.filter((f) => scopeMatchesPath(scope, f)),
  );
  let leases;
  try {
    leases = sharedSurfaces.length
      ? acquireLeases(stateDir, pkg.id, sharedSurfaces)
      : { ok: true, granted: [], conflicts: [] };
  } catch (err) {
    releaseLeases(stateDir, pkg.id, { reason: 'admission refused (lease error)' });
    return {
      ok: false,
      providers: [],
      fallback: [],
      reason: `LEASE_ERROR: ${String(err?.message ?? err)}`,
    };
  }
  if (!leases.ok) {
    const heldBy = (leases.conflicts ?? []).map((c) => `${c.file} (${c.heldBy})`).join(', ');
    return { ok: false, providers: [], fallback: [], reason: `LEASE_CONFLICT: ${heldBy}` };
  }
  return { ok: true, providers: [], fallback: [], reason: 'admitted', leases: sharedSurfaces };
}

/** Does a package-level glob scope (e.g. `packages/a/**`) name `path`? */
function scopeMatchesPath(scope, path) {
  if (typeof scope !== 'string' || !scope) return false;
  const re = globToRegExp(scope);
  return re.test(path);
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += glob[i + 2] === '/' ? '(?:[^/]+/)*' : '.*';
        i += glob[i + 2] === '/' ? 2 : 1;
      } else re += '[^/]*';
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

/**
 * Idempotent total release for a terminal (or fatally paused) tracked run:
 * every provider permit the entry held plus every lease the package holds.
 * Safe on entries launched before this wiring existed (no providers field).
 */
export function releasePackageRuntime(stateDir, entry) {
  const released = { providers: [], leases: 0 };
  for (const provider of entry?.providers ?? []) {
    try {
      releasePermit(stateDir, provider);
      released.providers.push(provider);
    } catch {}
  }
  if (entry?.packageId) {
    try {
      released.leases = releaseLeases(stateDir, entry.packageId, {
        reason: entry?.runId ? `run ${entry.runId} terminal` : 'package terminal',
      }).released;
    } catch {}
  }
  return released;
}
