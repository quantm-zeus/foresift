/**
 * Outcome profiles suite (T031, FR-EVAL-001, AC-040).
 * Tests versioned outcome profile schemas and stress pass matrices.
 */
import { describe, expect, it } from 'bun:test';
import { GOLDEN_PROFILES } from '../../../tests/fixtures/eval/profiles.ts';

describe('Evaluation Profiles (FR-EVAL-001, AC-040)', () => {
  it('validates all 5 golden outcome profile definitions (§8.3–§8.7)', () => {
    expect(GOLDEN_PROFILES.length).toBe(5);
    const profileIds = GOLDEN_PROFILES.map((p) => p.profileId);
    expect(profileIds).toContain('HG-EM-1@1');
    expect(profileIds).toContain('HG-OG-1@1');
    expect(profileIds).toContain('HG-SM-1@1');
    expect(profileIds).toContain('HG-LR-1@1');
    expect(profileIds).toContain('RW-CR-1@1');

    for (const profile of GOLDEN_PROFILES) {
      expect(profile.isVersionLocked).toBe(true);
      expect(profile.clauses.length).toBeGreaterThanOrEqual(2);
      expect(profile.stressPassMatrix.length).toBe(4);
    }
  });
});
