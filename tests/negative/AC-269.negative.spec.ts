/**
 * AC-269 negative.
 * Traces: FR-TRACE-006.
 * Refusals proven: missing field or drifting recorded hash refuses release report
 * verification fail-closed.
 */
import { describe, expect, it } from 'bun:test';
// @ts-expect-error TS2307: module not yet implemented by implementation author
import { verifyReleaseReport } from '@foresift/release-conformance';
import { VALID_RELEASE_REPORT_FIXTURE } from '../fixtures/trace/index.ts';

describe('AC-269 negative (refusal of invalid release reports)', () => {
  it('refuses report missing documentHash', () => {
    const incomplete = {
      ...VALID_RELEASE_REPORT_FIXTURE,
      documentHash: undefined,
    };

    const result = verifyReleaseReport(incomplete as any);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e: string) => e.includes('documentHash'))).toBe(true);
  });

  it('refuses report missing manifestHash', () => {
    const incomplete = {
      ...VALID_RELEASE_REPORT_FIXTURE,
      manifestHash: undefined,
    };

    const result = verifyReleaseReport(incomplete as any);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e: string) => e.includes('manifestHash'))).toBe(true);
  });

  it('refuses report missing dependencySbomHash', () => {
    const incomplete = {
      ...VALID_RELEASE_REPORT_FIXTURE,
      dependencySbomHash: undefined,
    };

    const result = verifyReleaseReport(incomplete as any);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e: string) => e.includes('dependencySbomHash'))).toBe(true);
  });

  it('refuses report missing activationState or rollbackTarget', () => {
    const incomplete1 = {
      ...VALID_RELEASE_REPORT_FIXTURE,
      activationState: undefined,
    };
    expect(verifyReleaseReport(incomplete1 as any).isValid).toBe(false);

    const incomplete2 = {
      ...VALID_RELEASE_REPORT_FIXTURE,
      rollbackTarget: undefined,
    };
    expect(verifyReleaseReport(incomplete2 as any).isValid).toBe(false);
  });

  it('refuses report with hash disagreement or tampering', () => {
    const tampered = {
      ...VALID_RELEASE_REPORT_FIXTURE,
      manifestHash: 'badhash'.repeat(8),
    };

    const result = verifyReleaseReport(tampered);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
