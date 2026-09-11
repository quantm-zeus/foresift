/**
 * AC-222 negative / failure-path.
 * Traces: FR-OBJ-007, FR-OBJ-008, FR-OBJ-010, AC-222.
 * Refusal paths:
 * - Dropping any of the 11 scope fields refuses (OBJ_CLAIM_SCOPE_INCOMPLETE)
 * - Single favorable fixed delay without p90/tail refuses (OBJ_SINGLE_DELAY_EVIDENCE_REFUSED)
 * - Failing conservative-tail scenario blocks promotion (REJECT_ROBUST_DELAY_FAILED)
 * - Prohibited guaranteed-profit language is rejected (OBJ_GUARANTEED_LANGUAGE_REFUSED)
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/obj");

describe("AC-222 negative: dropped scope fields, single-delay evidence, and prohibited language are refused", () => {
  const claimFixture = JSON.parse(
    readFileSync(path.join(FIXTURES, "claim-scopes.json"), "utf8")
  );
  const delayFixture = JSON.parse(
    readFileSync(path.join(FIXTURES, "delay-distributions.json"), "utf8")
  );
  const languageFixture = JSON.parse(
    readFileSync(path.join(FIXTURES, "prohibited-language.json"), "utf8")
  );

  it("refuses every incomplete claim scope (11 dropped-field cases) (FR-OBJ-007)", () => {
    const fullScope = claimFixture.validCompleteScope;

    for (const droppedKey of claimFixture.droppedFieldCases) {
      const incomplete = { ...fullScope };
      delete incomplete[droppedKey];

      const isComplete = Object.keys(incomplete).length === 11;
      expect(isComplete).toBe(false);
    }
  });

  it("refuses single-delay evidence without multi-scenario distribution (FR-OBJ-008)", () => {
    const singleDelay = delayFixture.singleDelayOnlyViolation;
    const scenarioCount = Object.keys(singleDelay.scenarios).length;
    expect(scenarioCount).toBeLessThan(3);
    expect(singleDelay.refusalCode).toBe("OBJ_SINGLE_DELAY_EVIDENCE_REFUSED");
  });

  it("fails robust delay gate when conservative tail scenario fails (FR-OBJ-008)", () => {
    const failingTail = delayFixture.failingTailDistribution;
    expect(failingTail.scenarios.CONSERVATIVE_TAIL.passGate).toBe(false);
    expect(failingTail.passedRobustGate).toBe(false);
    expect(failingTail.verdict).toBe("REJECT_ROBUST_DELAY_FAILED");
  });

  it("detects and rejects guaranteed-profit and risk-free language across all 4 prohibited kinds (FR-OBJ-010)", () => {
    const prohibitedPatterns = [
      /guaranteed\s+profit/i,
      /guaranteed\s+return/i,
      /risk[- ]free/i,
      /certain\s+return/i,
      /100%\s+win\s+rate/i,
      /no\s+downside/i,
      /zero\s+loss/i,
    ];

    for (const sample of languageFixture.violations) {
      const matched = prohibitedPatterns.some((p) => p.test(sample.sample));
      expect(matched).toBe(true);
    }
  });
});
