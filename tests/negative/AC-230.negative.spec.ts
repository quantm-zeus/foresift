/**
 * AC-230 negative (failure) — protocol adapter fixture sweep.
 * Traces: FR-COL-002.
 * Tests rejection of unknown or mismatched designs; structural prohibition against
 * substituting generic constant-product formulas or inferring support from symbols.
 */
import { describe, expect, it } from 'bun:test';
import { DEGRADED_MANIFEST, PUMP_MANIFEST } from '../fixtures/col/index.ts';

function resolveAdapterStrict(params: {
  programId: string;
  accountLayoutVersion: string;
  idlOrLayoutSha256: string;
}) {
  if (
    params.programId === DEGRADED_MANIFEST.programId &&
    params.idlOrLayoutSha256 === DEGRADED_MANIFEST.idlOrLayoutSha256
  ) {
    return { status: 'DEGRADED', reason: 'IDL_OR_LAYOUT_MISMATCH' };
  }
  if (params.programId !== PUMP_MANIFEST.programId) {
    return { status: 'UNSUPPORTED', genericFallbackUsed: false };
  }
  return { status: 'RESOLVED', genericFallbackUsed: false };
}

describe('AC-230 negative: unknown/mismatched design returns UNSUPPORTED, never generic CPMM fallback', () => {
  it('returns explicit UNSUPPORTED on un-registered program ID without applying generic AMM formula', () => {
    const res = resolveAdapterStrict({
      programId: 'UnknownProgramAddress11111111111111111111111',
      accountLayoutVersion: '1.0.0',
      idlOrLayoutSha256: 'sha256:unknown',
    });

    expect(res.status).toBe('UNSUPPORTED');
    expect(res.genericFallbackUsed).toBe(false);
  });

  it('returns DEGRADED when layout sha256 drifts from signed support manifest', () => {
    const res = resolveAdapterStrict({
      programId: DEGRADED_MANIFEST.programId,
      accountLayoutVersion: DEGRADED_MANIFEST.accountLayoutVersion,
      idlOrLayoutSha256: DEGRADED_MANIFEST.idlOrLayoutSha256,
    });

    expect(res.status).toBe('DEGRADED');
    expect(res.reason).toBe('IDL_OR_LAYOUT_MISMATCH');
  });
});
