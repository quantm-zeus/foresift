// Zero-AI host resource governor (Hyperdrive H3, P1-8). Classifies the host
// into GREEN/YELLOW/ORANGE/RED from real memory availability and heavy
// (PGlite/bun-test/AI-gate) process counts, and gates new supervisor
// launches accordingly — the fail-closed floor under project-wide scale-up.
//
//   GREEN   — normal adaptive expansion
//   YELLOW  — no concurrency increase
//   ORANGE  — no new heavy/PGlite work, reduced new AI starts
//   RED     — no new launches at all

export declare const RESOURCE_GOVERNOR_DEFAULTS: {
  redMemoryFrac: number;
  redHeavyProcesses: number;
  orangeMemoryFrac: number;
  orangeHeavyProcesses: number;
  yellowMemoryFrac: number;
  yellowHeavyProcesses: number;
};
export declare function classifyHostState(
  sample?: {
    total: number;
    available: number;
    heavyProcesses: number;
  } | null,
): {
  state: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
  availableFrac: number;
  heavyProcesses: number;
  reason: string;
};
export declare function admitUnderGovernor(
  hostState: { state: string },
  action?: { heavy?: boolean },
): { allow: boolean; reason: string };
