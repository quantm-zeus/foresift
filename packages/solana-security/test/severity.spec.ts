import { describe, expect, it } from 'bun:test';
import {
  SecuritySeverity,
  TokenControl,
  TokenControlState,
} from '@foresift/domain';
import {
  parseSolsecSchema,
  type TokenControlFinding,
} from '@foresift/shared-schemas';

import {
  baseFindingSeverity,
  computeFindingSeverity,
  poolAssessmentSeverity,
  evaluateCompositeSeverity,
  SEVERITY_POLICY_VERSION,
} from '../src/severity.ts';

describe('severity: Appendix Q.1-derived deterministic severity mapping policy (T014, AC-131)', () => {
  const assessmentId = 'token-assessment:test:token001';
  const observedAt = '2026-01-01T00:00:00.000Z';
  const availableAt = '2026-01-01T00:00:01.000Z';

  const makeFinding = (
    control: TokenControl,
    controlState: TokenControlState,
    authorityAddress: string | null = 'Auth1111111111111111111111111111111111111',
    severity: SecuritySeverity | null = null,
  ): TokenControlFinding => ({
    findingId: `finding:${control}`,
    assessmentId,
    control,
    controlState,
    authorityAddress,
    extensionDataHash: null,
    evidenceIds: ['evidence:test'],
    observedAt,
    availableAt,
    qualityCodes: ['VALID'],
    severity,
  });

  it('exposes SEVERITY_POLICY_VERSION', () => {
    expect(SEVERITY_POLICY_VERSION).toBe('solsec-severity@1');
  });

  it('maps non-transferability and transfer hook blocking exit to CRITICAL severity', () => {
    const nonXferFinding = makeFinding(
      TokenControl.NON_TRANSFERABLE,
      TokenControlState.KNOWN_RISK,
      null,
      SecuritySeverity.CRITICAL,
    );
    expect(() => parseSolsecSchema('TokenControlFinding', nonXferFinding)).not.toThrow();

    const hookFinding = makeFinding(
      TokenControl.TRANSFER_HOOK,
      TokenControlState.KNOWN_RISK,
      'HookProgram11111111111111111111111111111111',
      SecuritySeverity.CRITICAL,
    );
    expect(() => parseSolsecSchema('TokenControlFinding', hookFinding)).not.toThrow();

    const sevNonXfer = computeFindingSeverity(nonXferFinding);
    expect(sevNonXfer).toBe(SecuritySeverity.CRITICAL);

    const sevHook = computeFindingSeverity(hookFinding);
    expect(sevHook).toBe(SecuritySeverity.CRITICAL);
  });

  it('maps active freeze authority and permanent delegate to HIGH severity', () => {
    const freezeFinding = makeFinding(
      TokenControl.FREEZE,
      TokenControlState.ADMINISTRATIVE_CONTROL,
      'FreezeAuth111111111111111111111111111111111',
      SecuritySeverity.HIGH,
    );
    expect(() => parseSolsecSchema('TokenControlFinding', freezeFinding)).not.toThrow();

    const permDelFinding = makeFinding(
      TokenControl.PERMANENT_DELEGATE,
      TokenControlState.ADMINISTRATIVE_CONTROL,
      'Delegate1111111111111111111111111111111111',
      SecuritySeverity.HIGH,
    );
    expect(() => parseSolsecSchema('TokenControlFinding', permDelFinding)).not.toThrow();

    expect(computeFindingSeverity(freezeFinding)).toBe(SecuritySeverity.HIGH);
    expect(computeFindingSeverity(permDelFinding)).toBe(SecuritySeverity.HIGH);
  });

  it('maps active mint authority without observed abuse to MEDIUM severity (Appendix Q.1 non-malice caveat)', () => {
    // Q.1 caveat: An administrative authority is NOT automatically malicious.
    // Active mint authority alone -> MEDIUM (not CRITICAL)
    const mintFinding = makeFinding(
      TokenControl.MINT,
      TokenControlState.ADMINISTRATIVE_CONTROL,
      'MintAuth11111111111111111111111111111111111',
      null,
    );
    expect(mintFinding.controlState).toBe(TokenControlState.ADMINISTRATIVE_CONTROL);

    const sev = computeFindingSeverity(mintFinding);
    expect(sev).toBe(SecuritySeverity.MEDIUM);

    // Escalation with observed abuse raises active authority to CRITICAL
    const sevAbuse = computeFindingSeverity(mintFinding, { observedAbuse: true });
    expect(sevAbuse).toBe(SecuritySeverity.CRITICAL);
  });

  it('maps revoked authorities to NONE severity', () => {
    const revokedMint = makeFinding(
      TokenControl.MINT,
      TokenControlState.REVOKED_AUTHORITY,
      null,
      null,
    );
    const revokedFreeze = makeFinding(
      TokenControl.FREEZE,
      TokenControlState.REVOKED_AUTHORITY,
      null,
      null,
    );

    expect(revokedMint.controlState).toBe(TokenControlState.REVOKED_AUTHORITY);
    expect(revokedFreeze.controlState).toBe(TokenControlState.REVOKED_AUTHORITY);

    expect(computeFindingSeverity(revokedMint)).toBe(SecuritySeverity.NONE);
    expect(computeFindingSeverity(revokedFreeze)).toBe(SecuritySeverity.NONE);
    expect(baseFindingSeverity(TokenControl.MINT, TokenControlState.REVOKED_AUTHORITY)).toBe(
      SecuritySeverity.NONE,
    );
  });

  it('evaluates composite severity deterministically across findings and pool assessment', () => {
    // Highest severity across findings wins deterministically:
    // CRITICAL > HIGH > MEDIUM > LOW > NONE
    const mixedFindings: TokenControlFinding[] = [
      makeFinding(TokenControl.MINT, TokenControlState.ADMINISTRATIVE_CONTROL), // MEDIUM
      makeFinding(TokenControl.FREEZE, TokenControlState.ADMINISTRATIVE_CONTROL), // HIGH
      makeFinding(TokenControl.CLOSE, TokenControlState.REVOKED_AUTHORITY, null), // NONE
    ];

    const compositeSev = evaluateCompositeSeverity({
      findings: mixedFindings,
    });
    expect(compositeSev).toBe(SecuritySeverity.HIGH);
  });
});
