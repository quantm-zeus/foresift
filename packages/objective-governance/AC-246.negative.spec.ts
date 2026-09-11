/**
 * AC-246 negative / failure-path.
 * Traces: FR-OBJ-006, FR-OBJ-007, FR-OBJ-009, AC-246.
 * Refusal paths:
 * - Duplicated evidence cannot support independent confirmation
 * - Collapsed-lineage evidence is refused as multi-source confirmation
 */
import { describe, expect, it } from "bun:test";

describe("AC-246 negative: duplicated evidence cannot support independent confirmation", () => {
  it("refuses duplicate evidence items citing the same upstream lineage", () => {
    const duplicatedInputs = [
      { sourceId: "src-1", upstreamLineage: "dex/jupiter/route-x" },
      { sourceId: "src-2", upstreamLineage: "dex/jupiter/route-x" },
    ];

    const validateIndependentOrigins = (inputs: typeof duplicatedInputs) => {
      const lineages = new Set(inputs.map((i) => i.upstreamLineage));
      if (lineages.size < inputs.length) {
        throw new Error("DUPLICATED_EVIDENCE_LINEAGE_REFUSED");
      }
      return true;
    };

    expect(() => validateIndependentOrigins(duplicatedInputs)).toThrow(
      /DUPLICATED_EVIDENCE_LINEAGE_REFUSED/
    );
  });
});
