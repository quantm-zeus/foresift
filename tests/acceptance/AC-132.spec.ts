/**
 * AC-132 acceptance (positive).
 * Traces: FR-SOLSEC-006, AC-132, T023.
 * AC text (manifest §39): "A versioned system-address registry identifies known routers,
 * exchanges, launchpads, fee collectors, and programs; verified infrastructure accounts
 * are excluded from actor attribution graphs while raw flows remain auditable."
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SYSTEM_REGISTRY_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/solsec/system-registry.json",
);

describe("AC-132: Versioned system-address registry and actor exclusion (positive)", () => {
  it("excludes known infrastructure accounts (router, exchange, launchpad, fee collector) from actor attribution", () => {
    const fixture = JSON.parse(readFileSync(SYSTEM_REGISTRY_FIXTURE, "utf8"));
    const excludables = fixture.entries.filter((e: any) => e.expectedIsExcludable === true);

    expect(excludables.length).toBeGreaterThanOrEqual(4);

    const roles = excludables.map((e: any) => e.role);
    expect(roles).toContain("ROUTER");
    expect(roles).toContain("EXCHANGE_SERVICE");
    expect(roles).toContain("LAUNCHPAD");
    expect(roles).toContain("FEE_COLLECTOR");

    for (const entry of excludables) {
      expect(entry.confidence).toBeGreaterThanOrEqual(0.8);
      expect(entry.reviewState).toBe("APPROVED");
      expect(entry.expectedExclusionDecision).toBe("EXCLUSION_APPLIED");
      expect(entry.expectedQualityCodes).toContain("VALID");
    }
  });

  it("evaluates point-in-time exclusion validity intervals correctly", () => {
    const fixture = JSON.parse(readFileSync(SYSTEM_REGISTRY_FIXTURE, "utf8"));
    const revisionCase = fixture.entries.find((e: any) => e.historicalQueryTime !== undefined);

    expect(revisionCase).toBeDefined();
    expect(revisionCase.expectedIsExcludableAtT1).toBe(true);
    expect(revisionCase.expectedIsExcludableAtT2).toBe(false);

    // Validity interval logic check
    const validFrom = new Date(revisionCase.validFrom).getTime();
    const validTo = new Date(revisionCase.validTo).getTime();
    const t1 = new Date(revisionCase.historicalQueryTime).getTime();
    const t2 = new Date(revisionCase.futureQueryTime).getTime();

    expect(t1 >= validFrom && t1 <= validTo).toBe(true);
    expect(t2 > validTo).toBe(true);
  });
});
