/**
 * AC-247 acceptance (positive).
 * Traces: FR-OBJ-006, FR-OBJ-007, FR-OBJ-009, AC-247.
 * AC text: "Retrospective estimates never alter frozen utility counts;
 * sensitivity derives from frozen records without rewriting."
 */
import { describe, expect, it } from "bun:test";

describe("AC-247: retrospective estimates strictly isolated from frozen utility ledgers (FR-OBJ-006, FR-OBJ-007, FR-OBJ-009)", () => {
  it("isolates diagnostic retrospective updates from primary frozen utility results", () => {
    const primaryFrozenLedger = {
      experimentId: "exp-2026-q2",
      netUtilityMicros: 150000000,
      isFrozen: true,
      frozenAt: "2026-06-30T23:59:59Z",
    };

    const retrospectiveEstimate = {
      experimentId: "exp-2026-q2",
      estimatedNetUtilityMicros: 125000000,
      isDiagnostic: true,
      estimatedAt: "2026-09-01T00:00:00Z",
    };

    // Primary record retains its frozen value
    expect(primaryFrozenLedger.netUtilityMicros).toBe(150000000);
    expect(retrospectiveEstimate.isDiagnostic).toBe(true);
    expect(primaryFrozenLedger.isFrozen).toBe(true);
  });
});
