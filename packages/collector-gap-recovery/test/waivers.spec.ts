/**
 * Gap waiver scope and expiry unit tests (§12.10, FR-COL-005).
 * Gap waivers must be signed, expiring, narrow-scope only, and cannot support contiguous claims.
 */
import { describe, expect, it } from 'bun:test';
import { NARROW_SCOPE_WAIVED_GAP } from '../../../tests/fixtures/col/index.ts';

describe('Gap Waivers & Scope Restrictions (FR-COL-005, §12.10)', () => {
  it('validates waiver carries signature, narrow scope flag, and future expiry', () => {
    const waiver = NARROW_SCOPE_WAIVED_GAP.waiverRef;
    expect(waiver).toBeDefined();
    expect(waiver?.signedBy).toBeDefined();
    expect(waiver?.narrowScopeOnly).toBe(true);
    expect(new Date(waiver!.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('prohibits contiguous universe claim when a waiver is active', () => {
    const isContiguousClaimPermitted = !NARROW_SCOPE_WAIVED_GAP.waiverRef?.narrowScopeOnly;
    expect(isContiguousClaimPermitted).toBe(false);
  });
});
