// H2 §2/§3 — lane-level provider permits + cross-process race safety.
//
// Mission contract: ONE actual AI process / request stream = ONE provider
// permit, acquired immediately BEFORE the provider invocation and released in
// a finally-equivalent path immediately AFTER that lane terminates. The
// package-level admission stays a coarse gate; the AUTHORITATIVE writer
// concurrency counter is the lane permit.
//
// Race safety (§3): 20 simultaneous acquisition attempts against hardCap N
// must never exceed N — proven by the concurrent stress test below using
// real child processes against one shared state dir.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  acquireLanePermit,
  releaseLanePermit,
  acquirePermit,
  releasePermit,
  observeClaudeOutcome,
  observeCodexOutcome,
  providerAdmissionView,
} from '../../scripts/automation/provider-pool.mjs';

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'lane-permits-'));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('lane-level permits (§2: one process = one permit)', () => {
  test('lane permit acquires and releases exactly one pool permit', () => {
    const a = acquireLanePermit(stateDir, 'pkg-a:core', 'claude');
    expect(a.ok).toBe(true);
    expect(providerAdmissionView(stateDir).claude.active).toBe(1);
    releaseLanePermit(stateDir, 'pkg-a:core', 'claude');
    expect(providerAdmissionView(stateDir).claude.active).toBe(0);
  });

  test('three Claude lanes consume three Claude permits (§22-C)', () => {
    const lanes = ['pkg-a:core', 'pkg-a:shard-1', 'pkg-a:shard-2'];
    for (const lane of lanes) {
      const r = acquireLanePermit(stateDir, lane, 'claude');
      expect(r.ok).toBe(true);
    }
    expect(providerAdmissionView(stateDir).claude.active).toBe(3);
    // a 4th lane is refused at the initial limit of 3
    expect(acquireLanePermit(stateDir, 'pkg-b:core', 'claude').ok).toBe(false);
    for (const lane of lanes) releaseLanePermit(stateDir, lane, 'claude');
    expect(providerAdmissionView(stateDir).claude.active).toBe(0);
  });

  test('holder-keyed release is idempotent and holder-scoped (no cross-holder release)', () => {
    acquireLanePermit(stateDir, 'pkg-a:core', 'claude');
    acquireLanePermit(stateDir, 'pkg-a:shard-1', 'claude');
    // releasing one holder twice only frees that holder's permit
    expect(releaseLanePermit(stateDir, 'pkg-a:core', 'claude').released).toBe(1);
    expect(releaseLanePermit(stateDir, 'pkg-a:core', 'claude').released).toBe(0);
    expect(providerAdmissionView(stateDir).claude.active).toBe(1);
    releaseLanePermit(stateDir, 'pkg-a:shard-1', 'claude');
    expect(providerAdmissionView(stateDir).claude.active).toBe(0);
  });
});

describe('cross-process race safety (§3: 20 attempts ≤ hardCap)', () => {
  test('20 concurrent child-process acquisitions never exceed the configured cap', () => {
    // hardCap 5 via policy override; one bash orchestrates 20 racing children
    // that acquire WITHOUT releasing (leak semantics — the strictest probe of
    // the counter), then the durable pool file must read exactly 5 active.
    const policy = JSON.stringify({
      claude: { initial: 5, normalTarget: 5, burstTarget: 5, hardCap: 5 },
      codex: { initial: 1, normalTarget: 2, burstTarget: 2, hardCap: 3 },
      agy: { normalTarget: 3, burstTarget: 5, hardCap: 6 },
    });
    writeFileSync(join(stateDir, 'provider-pools.policy.json'), policy);
    const moduleUrl = new URL('../../scripts/automation/provider-pool.mjs', import.meta.url).href;
    const child = `
const { acquireLanePermit } = await import(${JSON.stringify(moduleUrl)});
const r = await acquireLanePermit(process.argv[2], 'pkg:' + process.argv[3], 'claude');
console.log(JSON.stringify({ ok: r.ok }));
`.trim();
    const childFile = join(stateDir, 'race-child.mjs');
    writeFileSync(childFile, child);
    // Single orchestrator: spawn all 20 children concurrently, wait, count.
    const sh = `
set -u
ok=0
pids=()
outs=$(mktemp -d)
for i in $(seq 1 20); do
  ( bun "$1" "$2" "$i" > "$outs/$i" 2>/dev/null ) &
  pids+=($!)
done
for p in "\${pids[@]}"; do wait "$p"; done
for f in "$outs"/*; do
  grep -q '"ok":true' "$f" && ok=$((ok+1))
done
rm -rf "$outs"
echo "ADMITTED=$ok"
`.trim();
    const shFile = join(stateDir, 'race.sh');
    writeFileSync(shFile, sh);
    const r = spawnSync('bash', [shFile, childFile, stateDir], {
      encoding: 'utf8',
      timeout: 100_000,
    });
    const admitted = Number(
      (r.stdout ?? '')
        .split('\n')
        .find((l) => l.startsWith('ADMITTED='))
        ?.slice(9) ?? '0',
    );
    expect(admitted).toBe(5); // exactly hardCap admissions of 20 racing attempts
    const pools = JSON.parse(readFileSync(join(stateDir, 'provider-pools.json'), 'utf8'));
    expect(pools.claude.active).toBe(5); // no lost increments, no oversubscription
    expect(pools.claude.active).toBeLessThanOrEqual(pools.claude.hardCap);
  }, 120_000);

  test('stale lock from a dead holder is reconciled (crash recovery)', () => {
    // Plant a stale lock: dead pid AND mtime older than the stale window.
    const lock = join(stateDir, 'provider-pools.lock');
    writeFileSync(lock, '2147483000');
    const ancient = new Date(Date.now() - 60_000);
    utimesSync(lock, ancient, ancient);
    const r = acquirePermit(stateDir, 'claude');
    expect(r.ok).toBe(true);
    releasePermit(stateDir, 'claude');
  });

  test('negative active is impossible: excess releases clamp at zero', () => {
    releasePermit(stateDir, 'claude');
    releasePermit(stateDir, 'claude');
    const pools = JSON.parse(readFileSync(join(stateDir, 'provider-pools.json'), 'utf8'));
    expect(pools.claude.active).toBe(0);
  });
});

describe('engine-specific attribution (§5/§6)', () => {
  test('healthy Claude lane outcome feeds AIMD recovery gradually (§22-E)', () => {
    // Drive down: pressure halves 3→2
    observeClaudeOutcome(stateDir, { healthy: false });
    expect(providerAdmissionView(stateDir).claude.limit).toBe(2);
    // Recovery is gradual: +1 per completed 3-healthy streak, never a jump.
    for (let i = 0; i < 3; i++) observeClaudeOutcome(stateDir, { healthy: true });
    expect(providerAdmissionView(stateDir).claude.limit).toBe(3); // streak 3 → +1
    for (let i = 0; i < 3; i++) observeClaudeOutcome(stateDir, { healthy: true });
    expect(providerAdmissionView(stateDir).claude.limit).toBe(4); // streak 6 → +1
    // two more healthy results: streak 8, no multiple of 3 → unchanged
    for (let i = 0; i < 2; i++) observeClaudeOutcome(stateDir, { healthy: true });
    expect(providerAdmissionView(stateDir).claude.limit).toBe(4);
  });

  test('Codex 429/quota affects ONLY Codex (§22-F/G); Claude pool untouched', () => {
    observeCodexOutcome(stateDir, { event: 'exhausted', resetAt: Date.now() + 3_600_000 });
    expect(providerAdmissionView(stateDir).codex.blocked).toBe(true);
    expect(providerAdmissionView(stateDir).claude.blocked).toBe(false);
    const claude = acquirePermit(stateDir, 'claude');
    expect(claude.ok).toBe(true);
    releasePermit(stateDir, 'claude');
  });

  test('unknown provider attribution poisons no pool (fail closed to UNKNOWN)', () => {
    observeCodexOutcome(stateDir, { event: 'unknown' });
    const view = providerAdmissionView(stateDir);
    expect(view.codex.state).toBe('UNKNOWN');
    expect(view.codex.blocked).toBe(false); // UNKNOWN probes before trusting
    expect(view.claude.state).toBe('OK');
  });
});
