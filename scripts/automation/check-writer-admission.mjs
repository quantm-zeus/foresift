// Small deterministic admission check before dispatching an extra product
// writer slot (override §26): current load, memory headroom, swap pressure,
// and recent provider-failure signals. Deliberately NOT an orchestration
// platform — one function with explicit thresholds, testable via overrides.
//
// Usage: node scripts/automation/check-writer-admission.mjs
//        [--load1 X] [--mem-available-kb N] [--mem-total-kb N] [--swap-total-kb N]
//        [--swap-free-kb N] [--provider-failures N] [--journal <file>] [--tail N]
import { readFileSync } from 'node:fs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const num = (v) => (v === undefined ? null : Number(v));

let load1 = num(arg('--load1'));
if (load1 === null) {
  try {
    load1 = Number(readFileSync('/proc/loadavg', 'utf8').split(/\s+/)[0]);
  } catch {
    load1 = 0;
  }
}
let memAvailableKb = num(arg('--mem-available-kb'));
let memTotalKb = num(arg('--mem-total-kb'));
let swapTotalKb = num(arg('--swap-total-kb'));
let swapFreeKb = num(arg('--swap-free-kb'));
if ((memAvailableKb === null || memTotalKb === null || swapTotalKb === null) && !arg('--load1')) {
  try {
    const mi = readFileSync('/proc/meminfo', 'utf8');
    if (memAvailableKb === null)
      memAvailableKb = Number((mi.match(/^MemAvailable:\s+(\d+)/) ?? [])[1] ?? 0);
    if (memTotalKb === null) memTotalKb = Number((mi.match(/^MemTotal:\s+(\d+)/) ?? [])[1] ?? 1);
    if (swapTotalKb === null) swapTotalKb = Number((mi.match(/^SwapTotal:\s+(\d+)/) ?? [])[1] ?? 0);
    if (swapFreeKb === null) swapFreeKb = Number((mi.match(/^SwapFree:\s+(\d+)/) ?? [])[1] ?? 0);
  } catch {
    /* non-Linux or hidden /proc: fall back to permissive defaults below */
  }
}

let providerFailures = num(arg('--provider-failures'));
const journal = arg('--journal');
if (providerFailures === null && journal) {
  try {
    const lines = readFileSync(journal, 'utf8').trimEnd().split('\n');
    const tailN = Number(arg('--tail') ?? 200);
    providerFailures = lines
      .slice(-tailN)
      .filter((l) => /429|empty stream|rate limit|quota/i.test(l)).length;
  } catch {
    providerFailures = null;
  }
}

const os = await import('node:os');
const nproc = os.cpus().length;
const LOAD_FACTOR = 0.8;
const MIN_MEM_PCT = 25;
const MAX_PROVIDER_FAILURES = 3;

const memPct =
  memAvailableKb !== null && memTotalKb ? Math.round((memAvailableKb / memTotalKb) * 100) : 100;
const swapping =
  swapTotalKb !== null && swapFreeKb !== null
    ? swapTotalKb > 0 && swapFreeKb < swapTotalKb * 0.5
    : false;
const failures = providerFailures ?? 0;

const checks = {
  loadUnderFactor: load1 <= nproc * LOAD_FACTOR,
  memoryHeadroom: memPct >= MIN_MEM_PCT,
  noSwapPressure: !swapping,
  providerHealthy: failures <= MAX_PROVIDER_FAILURES,
};
const admitExtraWriter = Object.values(checks).every(Boolean);

console.log(
  JSON.stringify(
    {
      ok: true,
      admitExtraWriter,
      nproc,
      metrics: { load1, memPct, swapping, providerFailures: providerFailures },
      thresholds: {
        loadFactor: LOAD_FACTOR,
        minMemPct: MIN_MEM_PCT,
        maxProviderFailures: MAX_PROVIDER_FAILURES,
      },
      checks,
    },
    null,
    2,
  ),
);
