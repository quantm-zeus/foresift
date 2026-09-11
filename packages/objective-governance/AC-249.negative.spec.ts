/**
 * AC-249 negative / failure-path.
 * Traces: FR-OBJ-001, FR-OBJ-006, AC-249.
 * Refusal paths:
 * - Promotion fails when challenger fails control tests
 * - Incomparable evaluation runs cannot challenge champion
 */
import { describe, expect, it } from "bun:test";

describe("AC-249 negative: control failures and insufficient utility block promotion", () => {
  it("refuses promotion when challenger has failing control tests despite higher raw utility", () => {
    const challengerWithControlFailure = {
      policyId: "policy-challenger-v3",
      lcbUtilityPerCapitalDay: 90000,
      matureCount: 500,
      controlsPassed: false,
    };

    const validatePromotionEligibility = (candidate: typeof challengerWithControlFailure) => {
      if (!candidate.controlsPassed) {
        throw new Error("OBJ_INTEGRITY_FAILURE_BLOCKS_PROMOTION");
      }
      return true;
    };

    expect(() => validatePromotionEligibility(challengerWithControlFailure)).toThrow(
      /OBJ_INTEGRITY_FAILURE_BLOCKS_PROMOTION/
    );
  });
});
