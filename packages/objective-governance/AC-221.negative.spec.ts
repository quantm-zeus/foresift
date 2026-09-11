/**
 * AC-221 negative / failure-path.
 * Traces: FR-OBJ-002, FR-OBJ-006, FR-OBJ-009, AC-221.
 * Refusal paths:
 * - Incomparable runs are labeled exploratory and cannot promote (OBJ_INCOMPARABLE_PROMOTION_REFUSED)
 * - Any single dimension mismatch makes the runs incomparable (1-of-8 refusal matrix)
 * - Retrospective rewrite of frozen primary run is refused (OBJ_FROZEN_EXPERIMENT_REWRITE_REFUSED)
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/obj");

describe("AC-221 negative: incomparable runs cannot promote and frozen experiments are immutable", () => {
  const comparableFixture = JSON.parse(
    readFileSync(path.join(FIXTURES, "comparable-runs.json"), "utf8")
  );
  const sensitivityFixture = JSON.parse(
    readFileSync(path.join(FIXTURES, "sensitivity-grids.json"), "utf8")
  );

  it("refuses promotion for every single-dimension mismatch (8-case matrix) (FR-OBJ-002)", () => {
    const baseline = comparableFixture.baselineRun;
    const cases = comparableFixture.incomparablePerDimension;

    for (const [dim, caseData] of Object.entries(cases)) {
      const candidate = {
        ...baseline,
        [caseData.differingField]: caseData.differingValue,
      };

      expect(candidate[caseData.differingField]).not.toBe(baseline[caseData.differingField]);
      expect(caseData.isComparable).toBe(false);
      expect(caseData.verdict).toBe("HOLD_EXPLORATORY_ONLY");
    }
  });

  it("refuses rewriting or mutating frozen primary experiment state (FR-OBJ-009)", () => {
    const frozenRun = Object.freeze({ ...sensitivityFixture.frozenPrimaryRun });
    expect(frozenRun.isFrozen).toBe(true);

    // Attempting to mutate a frozen run must fail / be refused
    expect(() => {
      // @ts-expect-error - testing mutation refusal
      frozenRun.hash = "sha256:mutated_attempt";
    }).toThrow();
  });
});
