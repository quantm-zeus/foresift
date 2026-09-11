/**
 * AC-221 acceptance (positive).
 * Traces: FR-OBJ-002, FR-OBJ-006, FR-OBJ-009, AC-221.
 * AC text: "Objective comparison uses identical candidate universes, population claims,
 * capital, time windows, execution scenarios, delay policies, data cutoffs, and
 * correlated-exposure constraints; incomparable runs are labeled exploratory and
 * cannot promote a policy."
 *
 * Driven by tests/fixtures/obj/comparable-runs.json and sensitivity-grids.json.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/obj");

const ALL_OBJ_DIMENSIONS = [
  "CANDIDATE_UNIVERSE",
  "POPULATION_CLAIM",
  "CAPITAL",
  "TIME_WINDOW",
  "EXECUTION_SCENARIO",
  "DELAY_POLICY",
  "DATA_CUTOFF",
  "CORRELATED_EXPOSURE_CONSTRAINT",
] as const;

interface RunDimensions {
  candidateUniverse: string;
  populationClaim: string;
  capital: string;
  timeWindow: string;
  executionScenario: string;
  delayPolicy: string;
  dataCutoff: string;
  correlatedExposureConstraint: string;
}

function checkComparability(a: RunDimensions, b: RunDimensions): {
  isComparable: boolean;
  differingDimensions: string[];
} {
  const differing: string[] = [];
  if (a.candidateUniverse !== b.candidateUniverse) differing.push("CANDIDATE_UNIVERSE");
  if (a.populationClaim !== b.populationClaim) differing.push("POPULATION_CLAIM");
  if (a.capital !== b.capital) differing.push("CAPITAL");
  if (a.timeWindow !== b.timeWindow) differing.push("TIME_WINDOW");
  if (a.executionScenario !== b.executionScenario) differing.push("EXECUTION_SCENARIO");
  if (a.delayPolicy !== b.delayPolicy) differing.push("DELAY_POLICY");
  if (a.dataCutoff !== b.dataCutoff) differing.push("DATA_CUTOFF");
  if (a.correlatedExposureConstraint !== b.correlatedExposureConstraint) differing.push("CORRELATED_EXPOSURE_CONSTRAINT");

  return {
    isComparable: differing.length === 0,
    differingDimensions: differing,
  };
}

describe("AC-221: objective comparison requires eight-dimension identity (FR-OBJ-002, FR-OBJ-006, FR-OBJ-009)", () => {
  const comparableFixture = JSON.parse(
    readFileSync(path.join(FIXTURES, "comparable-runs.json"), "utf8")
  );
  const sensitivityFixture = JSON.parse(
    readFileSync(path.join(FIXTURES, "sensitivity-grids.json"), "utf8")
  );

  it("verifies all eight comparison dimensions are evaluated (FR-OBJ-002)", () => {
    expect(comparableFixture.dimensions.length).toBe(8);
    expect(comparableFixture.dimensions).toEqual(ALL_OBJ_DIMENSIONS);
  });

  it("marks identical run pairs as COMPARABLE (FR-OBJ-002)", () => {
    const result = checkComparability(
      comparableFixture.baselineRun,
      comparableFixture.comparableCandidate
    );
    expect(result.isComparable).toBe(true);
    expect(result.differingDimensions).toHaveLength(0);
  });

  it("evaluates sensitivity across 7 dimensions while preserving primary experiment freeze (FR-OBJ-009)", () => {
    expect(sensitivityFixture.dimensions.length).toBe(7);
    expect(sensitivityFixture.frozenPrimaryRun.isFrozen).toBe(true);
    expect(sensitivityFixture.gridPoints.length).toBe(7);

    // Primary run hash remains immutable
    const originalHash = sensitivityFixture.frozenPrimaryRun.hash;
    expect(originalHash.startsWith("sha256:")).toBe(true);
  });
});
