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

import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
  closeSync,
  fsyncSync,
} from 'node:fs';
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
  if (!existsSync(file)) return createProviderPools(loadPoolPolicy(stateDir));
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  invariant(parsed.schema === PROVIDER_POOL_SCHEMA, 'INVALID_POOL_SCHEMA', file);
  return parsed;
}

/** Optional operator/test policy override: <stateDir>/provider-pools.policy.json. */
function loadPoolPolicy(stateDir) {
  try {
    return JSON.parse(readFileSync(join(stateDir, 'provider-pools.policy.json'), 'utf8'));
  } catch {
    return {};
  }
}

function savePools(stateDir, pools) {
  const file = poolFilePath(stateDir);
  mkdirSync(dirname(file), { recursive: true });
  pools.updatedAt = new Date().toISOString();
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(pools, null, 2) + '\n');
  renameSync(tmp, file);
}

/**
 * Cross-process serialization for pool read-modify-write (H2 mission §3).
 * Independent lane PROCESSES acquire permits concurrently; plain
 * read-modify-write loses increments under that race (two processes read
 * active=2, both write 3 for a hardCap of 3 → oversubscription). The lock is
 * a deterministic lockfile transaction: O_CREAT|O_EXCL is atomic on POSIX,
 * a writer proves it holds the lock by writing its pid, stale locks from
 * dead holders are reconciled by pid liveness, and every mutation happens
 * under both the lock and a bounded spin (never blocks unbounded).
 */
const POOL_LOCK_FILE = 'provider-pools.lock';
const POOL_LOCK_TIMEOUT_MS = 10_000;
const POOL_LOCK_STALE_MS = 30_000;

function poolLockPath(stateDir) {
  return join(stateDir, POOL_LOCK_FILE);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function withPoolLock(stateDir, fn) {
  const file = poolLockPath(stateDir);
  mkdirSync(stateDir, { recursive: true });
  const deadline = Date.now() + POOL_LOCK_TIMEOUT_MS;
  let fd = null;
  for (;;) {
    try {
      fd = openSync(file, 'wx'); // O_CREAT|O_EXCL — atomic create-or-fail
      writeSync(fd, String(process.pid));
      fsyncSync(fd);
      break;
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      // Existing lock: stale-holder reconciliation. A lock older than the
      // stale window whose holder pid is provably dead (or whose mtime is
      // ancient regardless of a pid that cannot be probed) is broken and
      // removed; otherwise back off briefly and retry until the deadline.
      try {
        const stat = statSync(file);
        const age = Date.now() - stat.mtimeMs;
        const holder = parseInt(readFileSync(file, 'utf8').trim(), 10);
        const dead = Number.isInteger(holder) && !pidAlive(holder);
        if (age > POOL_LOCK_STALE_MS && (dead || Number.isNaN(holder))) {
          rmSync(file, { force: true });
        }
      } catch {
        /* lock vanished between stat and read: just retry */
      }
      if (Date.now() >= deadline) {
        // Fail closed: refuse the mutation rather than racing without the
        // lock (a lost increment here is exactly the §3 defect).
        throw new Error('POOL_LOCK_TIMEOUT');
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } catch {}
    try {
      rmSync(file, { force: true });
    } catch {}
  }
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
 * Mutation runs under the cross-process pool lock (H2 §3): independent lane
 * processes acquire concurrently, so the check-and-increment is serialized.
 */
export function acquirePermit(stateDir, provider, { now = Date.now() } = {}) {
  return withPoolLock(stateDir, () => acquirePermitLocked(stateDir, provider, { now }));
}

/** Locking-contract: caller holds withPoolLock. */
function acquirePermitLocked(stateDir, provider, { now = Date.now() } = {}) {
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
  return withPoolLock(stateDir, () => releasePermitLocked(stateDir, provider));
}

/** Locking contract: caller holds withPoolLock. Idempotent floor 0. */
function releasePermitLocked(stateDir, provider) {
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
  return withPoolLock(stateDir, () => {
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
  });
}

/**
 * Codex quota state machine (§19). Transitions:
 *   HEALTHY/UNKNOWN → CONSERVE → NEAR_LIMIT → EXHAUSTED → RESET_WAIT → HEALTHY
 * Any *_LIMIT/EXHAUSTED event with a reset time latches RESET_WAIT until then.
 * Unknown failures map to UNKNOWN (probe before trusting). Quota exhaustion
 * is NEVER a package failure — callers reroute or wait.
 */
export function observeCodexOutcome(stateDir, { event, resetAt = null, now = Date.now() } = {}) {
  return withPoolLock(stateDir, () => {
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
  });
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

// ── lane-level permits (H2 mission §2: ONE AI process = ONE permit) ──────────
// The AUTHORITATIVE writer concurrency counter. A lane process (codex/agy/
// claude writer, repair writer) acquires immediately before its provider
// invocation and releases in a finally-equivalent path after termination.
// holder = packageId:generation:laneId. The permit IS the pool permit (never
// a second counter); the holder registry makes releases holder-scoped — a
// crashed holder's stale registration cannot free a live holder's permit.

function holdersPath(stateDir) {
  return join(stateDir, 'provider-pools.holders.json');
}

function loadHolders(stateDir) {
  try {
    return JSON.parse(readFileSync(holdersPath(stateDir), 'utf8'));
  } catch {
    return {};
  }
}

function saveHolders(stateDir, holders) {
  const tmp = `${holdersPath(stateDir)}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(holders, null, 2) + '\n');
  renameSync(tmp, holdersPath(stateDir));
}

/**
 * Acquire one provider permit for ONE lane process. On ok:false the caller
 * must NOT dispatch the provider and may retry after waitMs (or reroute
 * per §20 — the reason distinguishes quota from capacity).
 */
export function acquireLanePermit(stateDir, holder, provider, opts = {}) {
  invariant(holder && typeof holder === 'string', 'INVALID_LANE_HOLDER', String(holder));
  const r = acquirePermit(stateDir, provider, opts);
  if (r.ok) {
    return withPoolLock(stateDir, () => {
      const holders = loadHolders(stateDir);
      holders[`${provider}\u0000${holder}`] = { at: new Date().toISOString() };
      saveHolders(stateDir, holders);
      return { ...r, holder };
    });
  }
  return r;
}

/**
 * Finally-equivalent release for ONE lane process, scoped to that holder:
 * decrements the pool ONLY if this holder still holds a registered permit.
 * Idempotent — a holder with no registration releases nothing (floor 0).
 */
export function releaseLanePermit(stateDir, holder, provider) {
  invariant(holder && typeof holder === 'string', 'INVALID_LANE_HOLDER', String(holder));
  return withPoolLock(stateDir, () => {
    const holders = loadHolders(stateDir);
    const key = `${provider}\u0000${holder}`;
    if (!holders[key]) return { released: 0, active: undefined };
    delete holders[key];
    saveHolders(stateDir, holders);
    const r = releasePermitLocked(stateDir, provider);
    return { released: 1, active: r.active };
  });
}

/**
 * Canonical pool state dir for writer-side lane permits (H2 §2). Writers run
 * as independent lane processes outside the supervisor, so they must land on
 * the SAME durable pools file the supervisor's admission gate mutates.
 * FORESIFT_PROVIDER_POOL_STATE_DIR > FORESIFT_AUTOPILOT_STATE_DIR > XDG default.
 */
export function resolvePoolStateDir(env = process.env) {
  return (
    env.FORESIFT_PROVIDER_POOL_STATE_DIR ??
    env.FORESIFT_AUTOPILOT_STATE_DIR ??
    join(env.HOME ?? '', '.local', 'state', 'foresift')
  );
}
