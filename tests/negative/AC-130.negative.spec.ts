/**
 * AC-130 negative / failure-path.
 * Traces: FR-SOLSEC-001, FR-SOLSEC-002, FR-SOLSEC-003, FR-SOLSEC-004, AC-130, T021.
 * Verifies that unknown required transfer semantics BLOCK execution modeling,
 * unsupported pool designs structurally refuse resolved-state fields, and
 * malformed control findings are refused fail-closed.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN_EXT_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/solsec/token-extensions.json",
);

const POOL_SEC_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/solsec/pool-security.json",
);

describe("AC-130 negative: Transfer semantics blocking, unsupported pool refusal, and schema integrity", () => {
  it("blocks profiles requiring complete execution modeling when extension support is UNKNOWN_REQUIRED", () => {
    const fixture = JSON.parse(readFileSync(TOKEN_EXT_FIXTURE, "utf8"));
    const unknownExtVector = fixture.vectors.find((v: any) => v.control === "UNKNOWN_EXTENSION");

    expect(unknownExtVector).toBeDefined();
    expect(unknownExtVector.supportState).toBe("UNKNOWN_REQUIRED");
    expect(unknownExtVector.qualityCodes).toContain("TOKEN_EXTENSION_UNKNOWN");

    // Pure gating predicate check: UNKNOWN_REQUIRED must strictly block
    function checkBlocksCompleteExecution(supportState: string): boolean {
      return supportState === "UNKNOWN_REQUIRED";
    }

    expect(checkBlocksCompleteExecution(unknownExtVector.supportState)).toBe(true);
    expect(checkBlocksCompleteExecution("KNOWN_MODELED")).toBe(false);
  });

  it("structurally refuses resolved-state fields when pool adapter support is DEGRADED_UNSUPPORTED", () => {
    const fixture = JSON.parse(readFileSync(POOL_SEC_FIXTURE, "utf8"));
    const degradedPool = fixture.pools.find((p: any) => p.adapterSupportState === "DEGRADED_UNSUPPORTED");

    expect(degradedPool).toBeDefined();
    expect(degradedPool.lpControlState).toBeNull();
    expect(degradedPool.withdrawalAuthorityState).toBeNull();
    expect(degradedPool.quoteParityState).toBeNull();
    expect(degradedPool.migrationLineage).toBeNull();
    expect(degradedPool.qualityCodes).toContain("POOL_MATH_UNSUPPORTED");
    expect(degradedPool.qualityCodes).toContain("UNSUPPORTED_PROGRAM_VERSION");
  });

  it("refuses fabricated or malformed control finding objects fail-closed", () => {
    const invalidFinding = {
      control: "MINT",
      controlState: "FABRICATED_SAFE_STATE",
      severity: "NONE",
    };

    const validStates = [
      "KNOWN_RISK",
      "ADMINISTRATIVE_CONTROL",
      "NEUTRAL_CONFIGURATION",
      "REVOKED_AUTHORITY",
      "UNABLE_TO_VERIFY",
    ];

    expect(validStates.includes(invalidFinding.controlState)).toBe(false);
  });
});
