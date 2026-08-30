// Global provider pool governor (Hyperdrive H1/H2, mission §14–§22).
//
// ONE global pool per provider across all concurrent package workflows —
// never per-package limits that multiply into oversubscription (§17). The
// Claude pool is AIMD (additive increase on sustained health, multiplicative
// decrease on pressure), optimizing for the accepted-work throughput knee
// rather than zero errors (§15/§16). Codex runs a separate, smaller pool
// with explicit quota states: exhaustion is PROVIDER CAPACITY, never a
// product failure or global-fatal (§19). AGY is a bounded test-writer pool.
//
// Durable: pool state persists as JSON under the autopilot state dir so a
// supervisor restart cannot forget held permits or a recently tripped
// backoff (§19: no retry storms after restart).
//
// Zero AI: every decision here is deterministic arithmetic over observed
// provider events.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const PROVIDER_POOL_SCHEMA = 'foresift/provider-pool@1';

export const CODEX_QUOTA_STATES = Object.freeze([
  'HEALTHY',
  'CONSERVE',
  'NEAR_LIMIT',
  'EXHAUSTED',
  'RESET_WAIT',
  'UNKNOWN',
]);

function invariant(condition, code, detail = '') {
  if (!condition) throw new Error(`${code}${detail ? `: ${detail}` : ''}`);
}

function poolFilePath(stateDir) {
  return join(stateDir, 'provider-pools.json');
}

export function createProviderPools(policy = {}) {
  const claude = policy.claude ?? { initial: 3, normalTarget: 5, burstTarget: 8, hardCap: 10 };
  const codex = policy.codex ?? { initial: 1, normalTarget: 2, burstTarget: 2, hardCap: 3 };
  const agy = policy.agy ?? { normalTarget: 3, burstTarget: 5, hardCap: 6 };
  return {
    schema: PROVIDER_POOL_SCHEMA,
    updatedAt: new Date().toISOString(),
    claude: {
      ...claude,
      limit: claude.initial,
      active: 0,
      backoffUntil: 0,
      healthyStreak: 0,
    },
    codex: {
      ...codex,
      limit: codex.initial,
      active: 0,
      quotaState: 'HEALTHY',
      quotaStateSince: Date.now(),
      resetAt: null,
      backoffUntil: 0,
    },
    agy: {
      ...agy,
      limit: agy.normalTarget,
      active: 0,
    },
  };
}

function loadPools(stateDir) {
  const file = poolFilePath(stateDir);
  if (!existsSync(file)) return createProviderPools();
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  invariant(parsed.schema === PROVIDER_POOL_SCHEMA, 'INVALID_POOL_SCHEMA', file);
  return parsed;
}

function savePools(stateDir, pools) {
  const file = poolFilePath(stateDir);
  mkdirSync(dirname(file), { recursive: true });
  pools.updatedAt = new Date().toISOString();
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(pools, null, 2) + '\n');
  renameSync(tmp, file);
}

function currentLimitField() {
  // All pools carry their effective limit in `limit`; the field indirection
  // keeps the door open for per-provider field names without a function map.
  return 'limit';
}

/**
 * Try to acquire one permit. Returns { ok, waitMs } — ok:false carries the
 * bounded wait the caller should re-check after (never an unbounded block).
 * EXHAUSTED/RESET_WAIT Codex never issues permits and reports the reset-wait
 * so the scheduler can reroute compatible work to Claude (§20) instead of
 * failing a package.
 */
export function acquirePermit(stateDir, provider, { now = Date.now() } = {}) {
  invariant(['claude', 'codex', 'agy'].includes(provider), 'UNKNOWN_PROVIDER', provider);
  const pools = loadPools(stateDir);
  const pool = pools[provider];
  if (provider === 'codex' && ['EXHAUSTED', 'RESET_WAIT'].includes(pool.quotaState)) {
    savePools(stateDir, pools);
    const waitMs = pool.resetAt ? Math.max(0, pool.resetAt - now) : 60 * 60_000;
    return { ok: false, waitMs, reason: `CODEX_QUOTA_${pool.quotaState}` };
  }
  if (pool.backoffUntil && pool.backoffUntil > now) {
    savePools(stateDir, pools);
    return { ok: false, waitMs: pool.backoffUntil - now, reason: 'PROVIDER_BACKOFF' };
  }
  if (pool.active >= pool[currentLimitField()]) {
    savePools(stateDir, pools);
    return { ok: false, waitMs: 10_000, reason: 'POOL_AT_LIMIT' };
  }
  pool.active += 1;
  savePools(stateDir, pools);
  return { ok: true, waitMs: 0 };
}

export function releasePermit(stateDir, provider) {
  invariant(['claude', 'codex', 'agy'].includes(provider), 'UNKNOWN_PROVIDER', provider);
  const pools = loadPools(stateDir);
  const pool = pools[provider];
  pool.active = Math.max(0, pool.active - 1);
  savePools(stateDir, pools);
  return { active: pool.active };
}

/**
 * Record one observed provider outcome and adapt (§15/§16):
 *  - healthy: streak+1; every 3 consecutive healthy results, +1 (additive),
 *    capped at burstTarget. Never above hardCap.
 *  - pressure (429/503/overload/sustained latency): halve the limit (floor 1),
 *    clear the streak, apply bounded backoff (Retry-After honored when sane).
 */
export function observeClaudeOutcome(
  stateDir,
  { healthy, retryAfterMs = null, now = Date.now() } = {},
) {
  const pools = loadPools(stateDir);
  const pool = pools.claude;
  if (healthy) {
    pool.healthyStreak += 1;
    pool.backoffUntil = 0;
    if (pool.healthyStreak > 0 && pool.healthyStreak % 3 === 0) {
      pool.limit = Math.min(pool.limit + 1, pool.burstTarget, pool.hardCap);
    }
  } else {
    pool.healthyStreak = 0;
    pool.limit = Math.max(1, Math.ceil(pool.limit * 0.5));
    // Bounded backoff with jitter: Retry-After honored when it is a sane
    // duration (5s..30m); otherwise 30s..2m exponential-ish with jitter.
    let backoffMs;
    if (retryAfterMs && retryAfterMs >= 5_000 && retryAfterMs <= 30 * 60_000)
      backoffMs = retryAfterMs;
    else backoffMs = 30_000 + Math.floor(Math.random() * 90_000);
    pool.backoffUntil = now + backoffMs;
  }
  savePools(stateDir, pools);
  return { limit: pool.limit, active: pool.active, backoffUntil: pool.backoffUntil };
}

/**
 * Codex quota state machine (§19). Transitions:
 *   HEALTHY/UNKNOWN → CONSERVE → NEAR_LIMIT → EXHAUSTED → RESET_WAIT → HEALTHY
 * Any *_LIMIT/EXHAUSTED event with a reset time latches RESET_WAIT until then.
 * Unknown failures map to UNKNOWN (probe before trusting). Quota exhaustion
 * is NEVER a package failure — callers reroute or wait.
 */
export function observeCodexOutcome(stateDir, { event, resetAt = null, now = Date.now() } = {}) {
  const pools = loadPools(stateDir);
  const pool = pools.codex;
  const prev = pool.quotaState;
  let next = prev;
  switch (event) {
    case 'healthy':
      next = 'HEALTHY';
      break;
    case 'conserve':
      if (['HEALTHY', 'UNKNOWN'].includes(prev)) next = 'CONSERVE';
      break;
    case 'near_limit':
      next = 'NEAR_LIMIT';
      break;
    case 'exhausted':
      next = 'RESET_WAIT';
      break;
    case 'reset_elapsed':
      next = 'HEALTHY';
      break;
    case 'unknown':
      next = prev === 'HEALTHY' ? 'UNKNOWN' : prev;
      break;
    default:
      invariant(false, 'UNKNOWN_CODEX_EVENT', String(event));
  }
  if (event === 'exhausted' && !(resetAt && resetAt > now)) next = 'EXHAUSTED';
  if (next !== prev) {
    pool.quotaState = next;
    pool.quotaStateSince = now;
  }
  if (next === 'RESET_WAIT' && resetAt) pool.resetAt = resetAt;
  if (next === 'HEALTHY') pool.resetAt = null;
  savePools(stateDir, pools);
  return { quotaState: pool.quotaState, resetAt: pool.resetAt, previous: prev };
}

/** Can a lane of this engine start right now (permit-level, no side effects)? */
export function providerAdmissionView(stateDir, { now = Date.now() } = {}) {
  const pools = loadPools(stateDir);
  const view = {};
  for (const provider of ['claude', 'codex', 'agy']) {
    const pool = pools[provider];
    const blocked =
      pool.active >= pool[currentLimitField()] ||
      (pool.backoffUntil ?? 0) > now ||
      (provider === 'codex' && ['EXHAUSTED', 'RESET_WAIT'].includes(pool.quotaState));
    view[provider] = {
      limit: pool[currentLimitField()],
      active: pool.active,
      state:
        provider === 'codex' ? pool.quotaState : (pool.backoffUntil ?? 0) > now ? 'BACKOFF' : 'OK',
      blocked,
    };
  }
  return view;
}
