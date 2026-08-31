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
import { acquirePermit, releasePermit, providerAdmissionView } from './provider-pool.mjs';

/**
 * Providers a launch of `profile` may dispatch, in acquisition order. Claude
 * is listed where the profile's lanes may legitimately fall back to it (§20)
 * — but listing is descriptive ONLY: runtime capacity is owned by LANE
 * permits (acquireLanePermit at dispatch time), never by package-level
 * reservations, and NO profile requires an unrelated provider to be healthy
 * at admission (H3 P0-3 provider independence: CODEX_AGY launches without
 * Claude headroom; CLAUDE_AGY launches without Codex capacity; HYBRID_AGY
 * refuses only when NO compatible product engine can service ready work).
 */
export function providersForProfile(profile) {
  switch (profile) {
    case 'CODEX_AGY':
      return ['codex', 'agy'];
    case 'CLAUDE_AGY':
      return ['claude', 'agy'];
    case 'HYBRID_AGY':
      return ['claude', 'codex', 'agy'];
    default:
      throw new Error(`UNKNOWN_EXECUTION_PROFILE: ${String(profile)}`);
  }
}

/**
 * Providers the SUPERVISOR reserves at the package-level gate: NONE, ever
 * (H3 P0-2 — CODEX_AGY double-count removal). Lane-bearing engines are NOT
 * reserved at package level: every writer and repair lane acquires its OWN
 * lane permit from the same global pool immediately before its provider
 * invocation (ONE actual provider invocation = ONE permit, never a package
 * permit + a lane permit). A run-level reservation would double-count
 * against the launch's own lanes and — under default policy (codex 1) —
 * deterministically deny the first Codex lane (POOL_AT_LIMIT) and fail the
 * wave. Kept as a documented constant-return API for the supervisor's
 * bookkeeping; returns no held providers for any profile.
 */
export function supervisorProvidersForProfile() {
  return [];
}

/**
 * Compatible PRODUCT engines for a profile (the engines its lanes may
 * actually dispatch): CODEX_AGY ⇒ codex; CLAUDE_AGY ⇒ claude; HYBRID_AGY ⇒
 * claude + codex. AGY is the test engine and never gates a launch. Used for
 * the H3 P0-3 provider-independence admission check.
 */
export function productEnginesForProfile(profile) {
  switch (profile) {
    case 'CODEX_AGY':
      return ['codex'];
    case 'CLAUDE_AGY':
      return ['claude'];
    case 'HYBRID_AGY':
      return ['claude', 'codex'];
    default:
      throw new Error(`UNKNOWN_EXECUTION_PROFILE: ${String(profile)}`);
  }
}

/**
 * Deterministic pre-launch admission for ONE package. Returns
 * { ok, providers, fallback, reason } — ok:false leaves NO partial state
 * (leases granted before a later failure are released again).
 *
 *   providers — every provider permit HELD for the run (always [] since the
 *               H3 P0-2 change: lane permits own ALL runtime capacity)
 *   fallback  — providers skipped because the pool reroutes their work
 *               (Codex exhausted under HYBRID/CLAUDE_AGY ⇒ Claude fallback)
 *
 * Provider independence (H3 P0-3): an explicit profile requires only ITS OWN
 * compatible product engine to have headroom. CODEX_AGY does not probe
 * Claude; CLAUDE_AGY does not probe Codex. HYBRID_AGY refuses only when NO
 * compatible product engine (claude OR codex) can service ready work — one
 * pressured provider never fails the launch while the other has headroom.
 * Capacity decisions stay close to actual lane dispatch: the probe is
 * acquire+release against the SAME pool the lanes use, so capacity freed by
 * lane completion is immediately visible to the lanes themselves; quota
 * latches (CODEX_QUOTA_*) are lane-level facts observed per invocation and
 * reroute/hand off at the lane, never at the package gate.
 */
export function admitPackageLaunch(stateDir, pkg, executionProfile, opts = {}) {
  if (!pkg?.id) return { ok: false, providers: [], fallback: [], reason: 'INVALID_PACKAGE' };
  // Profile validation first (fail closed before touching any pool state).
  let productEngines;
  try {
    productEngines = productEnginesForProfile(executionProfile);
  } catch {
    return { ok: false, providers: [], fallback: [], reason: 'INVALID_PROFILE' };
  }
  // Provider-independence admission probe: acquire+release against the SAME
  // pool the lanes do, holding nothing. The launch is refused ONLY when
  // EVERY compatible product engine is unusable right now (zero headroom,
  // backoff, or quota latch). A single healthy engine admits the launch —
  // its lanes that prefer the other engine reroute or hand off at dispatch.
  // A quota LATCH is never a launch refusal for a profile whose lanes can
  // hand off (H3 P0-4): the latch self-heals at its bounded reset, and lane
  // dispatch observes it per invocation — so a latched codex still counts as
  // "serviceable" for the profile's engine-mix check; transient capacity
  // (POOL_AT_LIMIT/PROVIDER_BACKOFF) DOES count as unserviceable here.
  const now = opts.now ?? Date.now();
  const quotaLatched = (stateDir2, engine, at) => {
    if (engine !== 'codex') return false;
    const view = providerAdmissionView(stateDir2, { now: at });
    return ['EXHAUSTED', 'RESET_WAIT'].includes(view.codex?.state ?? '');
  };
  const anyEngineServiceable = productEngines.some((engine) => {
    try {
      const probe = acquirePermit(stateDir, engine, { now });
      if (probe.ok) {
        releasePermit(stateDir, engine);
        return true;
      }
      return quotaLatched(stateDir, engine, now);
    } catch {
      return false;
    }
  });
  if (!anyEngineServiceable) {
    return {
      ok: false,
      providers: [],
      fallback: [],
      reason: `${executionProfile}_NO_PRODUCT_ENGINE_SERVICEABLE: ${productEngines.join('|')}`,
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
