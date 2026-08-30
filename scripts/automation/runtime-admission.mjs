// Runtime admission bridge (Hyperdrive H2, mission §17/§20/§41): joins the
// global provider pools (provider-pool.mjs) and the exact-file lease manager
// (exact-leases.mjs) into the supervisor's real launch/finish paths.
//
// Contract:
//   - ONE global pool per provider across all concurrent packages (§17) — a
//     launch acquires its permits from the SAME pool every other launch uses.
//   - Claude is required in every profile: it is the fallback engine (§20),
//     so a Claude-blocked pool denies the launch outright. Codex-blocked only
//     denies CODEX_AGY launches; HYBRID/CLAUDE_AGY proceed Claude-only and
//     the wave's routing reroutes Codex lanes to Claude (quota fallback).
//   - Unknown/empty exact write sets fail closed to a conservative scope
//     lease over the package's declared writeScopes (§41).
//   - Release is idempotent and total: permits + leases always travel
//     together through releasePackageRuntime so a terminal run can never leak
//     a permit or strand a lease across a supervisor restart.
//
// Zero AI: admission is deterministic arithmetic over durable state files.

import { acquireLeases, releaseLeases, SHARED_SURFACE_FILES } from './exact-leases.mjs';
import { acquirePermit, releasePermit } from './provider-pool.mjs';

/** Providers a launch of `profile` may dispatch, in acquisition order. */
export function providersForProfile(profile) {
  switch (profile) {
    // Claude first in every profile: it is the §20 fallback engine, so its
    // permit is the one prerequisite no launch may proceed without. AGY is
    // the TEST-writer pool — its single permit is held by the RUN (test lanes
    // dispatch per wave), so it rides along here as a run-level reservation.
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
 * Providers the SUPERVISOR admits for the package-level gate. Codex is not
 * among them unless the profile is Codex-only: under HYBRID the per-lane
 * router owns which lanes consume Codex inside the wave, and reserving a
 * package-wide Codex permit here would both over-block (one lane ≠ one
 * package) and under-observe (the pool never sees release until the whole
 * package ends).
 */
export function supervisorProvidersForProfile(profile) {
  return providersForProfile(profile).filter((p) => p !== 'codex' || profile === 'CODEX_AGY');
}

/**
 * Deterministic pre-launch admission for ONE package. Returns
 * { ok, providers, fallback, reason } — ok:false leaves NO partial state
 * (permits acquired before a later failure are released again).
 *
 *   providers — every provider a permit was acquired for (held for the run)
 *   fallback  — providers skipped because the pool reroutes their work
 *               (Codex exhausted under HYBRID/CLAUDE_AGY ⇒ Claude fallback)
 */
export function admitPackageLaunch(stateDir, pkg, executionProfile, opts = {}) {
  if (!pkg?.id) return { ok: false, providers: [], fallback: [], reason: 'INVALID_PACKAGE' };
  let wantedAll;
  try {
    wantedAll = providersForProfile(executionProfile);
  } catch {
    return { ok: false, providers: [], fallback: [], reason: 'INVALID_PROFILE' };
  }
  // Supervisor gate: Claude (mandatory fallback engine) + AGY; Codex rides
  // the package gate only for Codex-only profiles. HYBRID waves consume
  // Codex per-lane inside the run, observed via observeCodexOutcome.
  const wanted =
    executionProfile === 'CODEX_AGY' ? wantedAll : wantedAll.filter((p) => p !== 'codex');
  const acquired = [];
  const fallback = [];
  const unwind = () => {
    // Fail-closed: a non-admitted launch must not leak permits it grabbed.
    for (const provider of acquired) {
      try {
        releasePermit(stateDir, provider);
      } catch {}
    }
  };
  for (const provider of wanted) {
    const permit = acquirePermit(stateDir, provider, { now: opts.now ?? Date.now() });
    if (permit.ok) {
      acquired.push(provider);
      continue;
    }
    const codexFallback =
      provider === 'codex' &&
      executionProfile !== 'CODEX_AGY' &&
      String(permit.reason ?? '').startsWith('CODEX_QUOTA_');
    if (codexFallback) {
      // §20: quota exhaustion is provider capacity, never a product failure
      // — compatible work reroutes to Claude (which every profile already
      // holds a permit for) via the wave's per-lane CLAUDE tokens.
      fallback.push(provider);
      continue;
    }
    unwind();
    return {
      ok: false,
      providers: [],
      fallback,
      reason: `${permit.reason ?? 'POOL_AT_LIMIT'}: provider ${provider}`,
    };
  } // Exact-file leases: the supervisor cannot know per-lane exact writes
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
    unwind();
    return {
      ok: false,
      providers: [],
      fallback,
      reason: `LEASE_ERROR: ${String(err?.message ?? err)}`,
    };
  }
  if (!leases.ok) {
    unwind();
    const heldBy = (leases.conflicts ?? []).map((c) => `${c.file} (${c.heldBy})`).join(', ');
    return { ok: false, providers: [], fallback, reason: `LEASE_CONFLICT: ${heldBy}` };
  }
  return { ok: true, providers: acquired, fallback, reason: 'admitted', leases: sharedSurfaces };
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
