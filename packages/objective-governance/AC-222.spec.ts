/**
 * AC-222 acceptance (positive).
 * Traces: FR-OBJ-007, FR-OBJ-008, FR-OBJ-010, AC-222.
 * AC text: "Every objective or performance claim identifies the exact supported population,
 * profile, policy, execution scenario, delay distribution, calendar interval, market
 * regimes, capability state, sample size, cluster effective sample size, and uncertainty
 * method; action-delay distribution includes at least p50, p90, and conservative-tail
 * scenarios; guaranteed-profit language is prohibited."
 *
 * Driven by claim-scopes.json, delay-distributions.json, and prohibited-language.json.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/obj");

const ALL_CLAIM_SCOPE_FIELDS = [
  "SUPPORTED_POPULATION",
  "PROFILE",
  "POLICY",
  "EXECUTION_SCENARIO",
  "DELAY_DISTRIBUTION",
  "CALENDAR_INTERVAL",
  "MARKET_REGIMES",
  "CAPABILITY_STATE",
  "SAMPLE_SIZE",
  "CLUSTER_EFFECTIVE_SAMPLE_SIZE",
  "UNCERTAINTY_METHOD",
] as const;

describe("AC-222: eleven-field scope completeness, robust delay gate, and uncertainty disclosure (FR-OBJ-007, FR-OBJ-008, FR-OBJ-010)", () => {
  const claimFixture = JSON.parse(
    readFileSync(path.join(FIXTURES, "claim-scopes.json"), "utf8")
  );
  const delayFixture = JSON.parse(
    readFileSync(path.join(FIXTURES, "delay-distributions.json"), "utf8")
  );
  const languageFixture = JSON.parse(
    readFileSync(path.join(FIXTURES, "prohibited-language.json"), "utf8")
  );

  it("accepts complete eleven-for-eleven claim scope (FR-OBJ-007)", () => {
    expect(claimFixture.fields.length).toBe(11);
    expect(claimFixture.fields).toEqual(ALL_CLAIM_SCOPE_FIELDS);

    const scope = claimFixture.validCompleteScope;
    expect(scope.supportedPopulation).toBeDefined();
    expect(scope.profile).toBeDefined();
    expect(scope.policy).toBeDefined();
    expect(scope.executionScenario).toBeDefined();
    expect(scope.delayDistribution).toBeDefined();
    expect(scope.calendarInterval).toBeDefined();
    expect(scope.marketRegimes).toBeDefined();
    expect(scope.capabilityState).toBeDefined();
    expect(scope.sampleSize).toBeGreaterThan(0);
    expect(scope.clusterEffectiveSampleSize).toBeGreaterThan(0);
    expect(scope.uncertaintyMethod).toBeDefined();
  });

  it("passes robust delay gate when all three scenarios (p50, p90, conservative-tail) pass (FR-OBJ-008)", () => {
    const dist = delayFixture.validRobustDistribution;
    expect(dist.scenarios.P50.passGate).toBe(true);
    expect(dist.scenarios.P90.passGate).toBe(true);
    expect(dist.scenarios.CONSERVATIVE_TAIL.passGate).toBe(true);
    expect(dist.passedRobustGate).toBe(true);
  });

  it("attaches mandatory uncertainty disclosure to research-signal outputs (FR-OBJ-010)", () => {
    for (const output of languageFixture.compliantOutputs) {
      expect(output.hasMandatoryDisclosure).toBe(true);
      expect(output.disclosureText).toContain(
        "Opportunity outputs are evidence-backed research signals whose realized outcome remains uncertain."
      );
    }
  });
});
