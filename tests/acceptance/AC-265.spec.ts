/**
 * AC-265 acceptance (positive).
 * Traces: FR-TRACE-001, FR-TRACE-002.
 * AC text (manifest §39.25): "The generated requirement manifest contains every normative
 * FR, AC, invariant, and ADR exactly once with document anchor, dependency group, owner,
 * code/schema/surface/test/telemetry mapping, activation gate, and rollback target."
 */
import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error TS2307: module not yet implemented by implementation author
import {
  loadRequirementManifest,
  validateRequirementManifest,
  verifyFourWayCountAgreement,
  checkGlobalIdUniqueness,
} from '@foresift/requirement-manifest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
);
const AUDIT_PATH = path.join(
  REPO_ROOT,
  'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.audit.json',
);
const PRD_PATH = path.join(
  REPO_ROOT,
  'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md',
);
const SHA256SUMS_PATH = path.join(REPO_ROOT, 'docs/spec/SHA256SUMS');

describe('AC-265 acceptance (positive)', () => {
  it('loads and validates the manifest against authoritative PRD and audit artifacts', async () => {
    const manifest = await loadRequirementManifest({
      manifestPath: MANIFEST_PATH,
      auditPath: AUDIT_PATH,
      prdPath: PRD_PATH,
      sha256sumsPath: SHA256SUMS_PATH,
    });

    expect(manifest).toBeDefined();

    // 1. Every Functional Requirement contains document anchor, dependency group, owner, mappings, activation gate, rollback target
    expect(manifest.requirements.length).toBe(397);
    for (const fr of manifest.requirements) {
      expect(fr.id).toMatch(/^FR-[A-Z0-9]+-[0-9]{3,}$/);
      expect(fr.line).toBeGreaterThan(0);
      expect(fr.text).toBeDefined();
      expect(fr.textSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fr.dependencyGroup).toBeDefined();
      expect(fr.owner).toBeDefined();
      expect(fr.implementationRefs.length).toBeGreaterThan(0);
      expect(fr.schemaRefs.length).toBeGreaterThan(0);
      expect(fr.persistenceRefs.length).toBeGreaterThan(0);
      expect(fr.apiToolUiRefs.length).toBeGreaterThan(0);
      expect(fr.telemetryRefs.length).toBeGreaterThan(0);
      expect(fr.fixtureRefs.length).toBeGreaterThan(0);
      expect(fr.testRefs.length).toBeGreaterThan(0);
      expect(fr.activationGateRefs.length).toBeGreaterThan(0);
      expect(fr.rollbackRefs.length).toBeGreaterThan(0);
    }

    // 2. Every Acceptance Criterion contains document anchor, requirement refs, test refs, owner
    expect(manifest.acceptanceCriteria.length).toBe(204);
    for (const ac of manifest.acceptanceCriteria) {
      expect(ac.id).toMatch(/^AC-[0-9]{3,}$/);
      expect(ac.line).toBeGreaterThan(0);
      expect(ac.text).toBeDefined();
      expect(ac.textSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(ac.requirementRefs.length).toBeGreaterThan(0);
      expect(ac.positiveTestRef).toBeDefined();
      expect(ac.negativeOrFailureTestRef).toBeDefined();
      expect(ac.evidenceOwner).toBeDefined();
    }

    // 3. Every Invariant contains document anchor, rationale, test refs
    expect(manifest.invariants.length).toBe(44);
    for (const inv of manifest.invariants) {
      expect(inv.id).toMatch(/^INV-[0-9]{3,}$/);
      expect(inv.line).toBeGreaterThan(0);
      expect(inv.text).toBeDefined();
      expect(inv.textSha256).toMatch(/^[a-f0-9]{64}$/);
    }

    // 4. Every ADR contains document anchor, status, title
    expect(manifest.adrs.length).toBe(58);
    for (const adr of manifest.adrs) {
      expect(adr.id).toMatch(/^ADR-[0-9]{4}$/);
      expect(adr.line).toBeGreaterThan(0);
      expect(adr.title).toBeDefined();
    }

    // 5. Global uniqueness across all items
    const uniqueness = checkGlobalIdUniqueness(manifest);
    expect(uniqueness.isUnique).toBe(true);
    expect(uniqueness.duplicates).toEqual([]);
  });

  it('validates 4-way count agreement with audit and release conformance inventories', async () => {
    const counts = await verifyFourWayCountAgreement({
      manifestPath: MANIFEST_PATH,
      auditPath: AUDIT_PATH,
    });

    expect(counts.agreed).toBe(true);
    expect(counts.requirements).toBe(397);
    expect(counts.acceptanceCriteria).toBe(204);
    expect(counts.invariants).toBe(44);
    expect(counts.adrs).toBe(58);
  });
});
