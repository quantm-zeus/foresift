import { describe, expect, it } from 'bun:test';
import {
  TokenControl,
  TokenControlState,
  SecuritySeverity,
  TransferSemanticsSupport,
} from '@foresift/domain';
import { parseSolsecSchema } from '@foresift/shared-schemas';
import {
  assessTokenControls,
  analyzeTokenAssessment,
  tokenFindingsAvailableAt,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_ASSESSMENT_ANALYZER_VERSION,
  type TokenAssessmentInput,
} from '../src/token-assessment.ts';

describe('token-assessment: deterministic SPL/Token-2022 control analysis (FR-SOLSEC-001, FR-SOLSEC-002, AC-130)', () => {
  const baseInput: TokenAssessmentInput = {
    assetRepresentationId: 'solana:mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    chainId: 'solana:mainnet',
    programId: SPL_TOKEN_PROGRAM_ID,
    programVersion: '1.0.0',
    layoutVersion: 'mint-v1',
    mintAuthority: '2wmVCSFeUFdSeqoWDBBa25pqAPHghSEztA8C34rF23dD',
    freezeAuthority: '2wmVCSFeUFdSeqoWDBBa25pqAPHghSEztA8C34rF23dD',
    decimals: 6,
    totalSupplyRaw: '1000000000000',
    evidenceRef: 'evidence:tx:001',
    observedAt: '2026-01-01T00:00:00.000Z',
    availableAt: '2026-01-01T00:00:01.000Z',
  };

  it('analyzes standard SPL Token mint with active authorities and produces schema-valid output', () => {
    const result = assessTokenControls(baseInput);

    expect(result.programSupported).toBe(true);
    expect(result.qualityCodes).toEqual(['VALID']);
    expect(result.assessment.decimals).toBe(6);
    expect(result.assessment.totalSupplyRaw).toBe('1000000000000');
    expect(result.assessment.programOwner).toBe(SPL_TOKEN_PROGRAM_ID);
    expect(result.assessment.analyzerVersion).toBe(TOKEN_ASSESSMENT_ANALYZER_VERSION);

    // Schema validation
    expect(() => parseSolsecSchema('TokenProgramAssessment', result.assessment)).not.toThrow();

    const mintFinding = result.findings.find((f) => f.control === TokenControl.MINT);
    expect(mintFinding).toBeDefined();
    expect(mintFinding!.controlState).toBe(TokenControlState.ADMINISTRATIVE_CONTROL);
    expect(mintFinding!.authorityAddress).toBe('2wmVCSFeUFdSeqoWDBBa25pqAPHghSEztA8C34rF23dD');
    expect(() => parseSolsecSchema('TokenControlFinding', mintFinding!)).not.toThrow();

    const freezeFinding = result.findings.find((f) => f.control === TokenControl.FREEZE);
    expect(freezeFinding).toBeDefined();
    expect(freezeFinding!.controlState).toBe(TokenControlState.ADMINISTRATIVE_CONTROL);
    expect(freezeFinding!.authorityAddress).toBe('2wmVCSFeUFdSeqoWDBBa25pqAPHghSEztA8C34rF23dD');
    expect(() => parseSolsecSchema('TokenControlFinding', freezeFinding!)).not.toThrow();
  });

  it('correctly classifies revoked (null) mint and freeze authorities', () => {
    const result = assessTokenControls({
      ...baseInput,
      mintAuthority: null,
      freezeAuthority: null,
    });

    const mintFinding = result.findings.find((f) => f.control === TokenControl.MINT);
    expect(mintFinding).toBeDefined();
    expect(mintFinding!.controlState).toBe(TokenControlState.REVOKED_AUTHORITY);
    expect(mintFinding!.authorityAddress).toBeNull();
    expect(mintFinding!.severity).toBeNull();

    const freezeFinding = result.findings.find((f) => f.control === TokenControl.FREEZE);
    expect(freezeFinding).toBeDefined();
    expect(freezeFinding!.controlState).toBe(TokenControlState.REVOKED_AUTHORITY);
    expect(freezeFinding!.authorityAddress).toBeNull();
    expect(freezeFinding!.severity).toBeNull();
  });

  it('marks undefined authorities as UNABLE_TO_VERIFY with PARTIAL quality code', () => {
    const { mintAuthority: _m, freezeAuthority: _f, ...inputWithoutAuthorities } = baseInput;
    const result = assessTokenControls(inputWithoutAuthorities);

    const mintFinding = result.findings.find((f) => f.control === TokenControl.MINT);
    expect(mintFinding!.controlState).toBe(TokenControlState.UNABLE_TO_VERIFY);
    expect(mintFinding!.qualityCodes).toContain('PARTIAL');

    const freezeFinding = result.findings.find((f) => f.control === TokenControl.FREEZE);
    expect(freezeFinding!.controlState).toBe(TokenControlState.UNABLE_TO_VERIFY);
    expect(freezeFinding!.qualityCodes).toContain('PARTIAL');
  });

  it('parses Token-2022 extensions: permanent delegate, transfer hook, default state, non-transferable, close', () => {
    const result = assessTokenControls({
      ...baseInput,
      programId: TOKEN_2022_PROGRAM_ID,
      programVersion: '1.0.0',
      layoutVersion: 'mint-tlv-v1',
      extensions: [
        {
          type: 'permanentDelegate',
          data: { delegate: 'DelegatePubkey1111111111111111111111111111111' },
        },
        {
          type: 'transferFeeConfig',
          data: {
            withdrawWithheldAuthority: 'FeeAuthority1111111111111111111111111111111',
            transferFeeConfigAuthority: 'FeeAuthority1111111111111111111111111111111',
          },
        },
        {
          type: 'transferHook',
          data: { hookProgramId: 'HookProgram11111111111111111111111111111111' },
        },
        {
          type: 'defaultAccountState',
          data: { state: 'Frozen' },
        },
        {
          type: 'nonTransferable',
        },
        {
          type: 'mintCloseAuthority',
          data: { closeAuthority: 'ClosePubkey1111111111111111111111111111111' },
        },
        {
          type: 'metadataPointer',
          data: { updateAuthority: 'MetadataAuth1111111111111111111111111111111' },
        },
        {
          type: 'confidentialTransferMint',
          data: { authority: 'ConfidentialAuth111111111111111111111111111' },
        },
      ],
    });

    expect(result.programSupported).toBe(true);

    // Permanent Delegate
    const permDel = result.findings.find((f) => f.control === TokenControl.PERMANENT_DELEGATE);
    expect(permDel).toBeDefined();
    expect(permDel!.controlState).toBe(TokenControlState.ADMINISTRATIVE_CONTROL);
    expect(permDel!.authorityAddress).toBe('DelegatePubkey1111111111111111111111111111111');

    // Transfer Fee
    const xferFee = result.findings.find((f) => f.control === TokenControl.TRANSFER_FEE);
    expect(xferFee).toBeDefined();
    expect(xferFee!.controlState).toBe(TokenControlState.ADMINISTRATIVE_CONTROL);

    // Transfer Hook
    const xferHook = result.findings.find((f) => f.control === TokenControl.TRANSFER_HOOK);
    expect(xferHook).toBeDefined();
    expect(xferHook!.controlState).toBe(TokenControlState.ADMINISTRATIVE_CONTROL);

    // Default Account State: Frozen -> KNOWN_RISK
    const defState = result.findings.find((f) => f.control === TokenControl.DEFAULT_STATE);
    expect(defState).toBeDefined();
    expect(defState!.controlState).toBe(TokenControlState.KNOWN_RISK);
    expect(defState!.severity).toBe(SecuritySeverity.HIGH);

    // Non-transferable -> KNOWN_RISK
    const nonXfer = result.findings.find((f) => f.control === TokenControl.NON_TRANSFERABLE);
    expect(nonXfer).toBeDefined();
    expect(nonXfer!.controlState).toBe(TokenControlState.KNOWN_RISK);
    expect(nonXfer!.severity).toBe(SecuritySeverity.HIGH);

    // Close Authority
    const closeAuth = result.findings.find((f) => f.control === TokenControl.CLOSE);
    expect(closeAuth).toBeDefined();
    expect(closeAuth!.controlState).toBe(TokenControlState.ADMINISTRATIVE_CONTROL);

    // Metadata
    const metadata = result.findings.find((f) => f.control === TokenControl.METADATA_UPDATE);
    expect(metadata).toBeDefined();
    expect(metadata!.controlState).toBe(TokenControlState.ADMINISTRATIVE_CONTROL);

    // Confidential transfer
    const confXfer = result.findings.find((f) => f.control === TokenControl.CONFIDENTIAL_TRANSFER);
    expect(confXfer).toBeDefined();
    expect(confXfer!.controlState).toBe(TokenControlState.NEUTRAL_CONFIGURATION);

    // Validate all findings against shared-schemas
    for (const finding of result.findings) {
      expect(() => parseSolsecSchema('TokenControlFinding', finding)).not.toThrow();
    }
  });

  it('fails closed when unknown/unsupported extension is encountered (FR-SOLSEC-004)', () => {
    const result = assessTokenControls({
      ...baseInput,
      programId: TOKEN_2022_PROGRAM_ID,
      programVersion: '1.0.0',
      layoutVersion: 'mint-tlv-v1',
      extensions: [
        {
          type: 'futureExoticExtensionV9',
          data: { customField: 'secret' },
        },
      ],
    });

    expect(result.qualityCodes).toContain('TOKEN_EXTENSION_UNKNOWN');

    const unknownFinding = result.findings.find((f) => f.control === TokenControl.UNKNOWN_EXTENSION);
    expect(unknownFinding).toBeDefined();
    expect(unknownFinding!.controlState).toBe(TokenControlState.UNABLE_TO_VERIFY);
    expect(unknownFinding!.qualityCodes).toContain('TOKEN_EXTENSION_UNKNOWN');

    expect(result.supportRows.length).toBeGreaterThan(0);
    const unkSupport = result.supportRows.find((r) => r.extensionType === 'futureExoticExtensionV9');
    expect(unkSupport).toBeDefined();
    expect(unkSupport!.support).toBe(TransferSemanticsSupport.UNKNOWN_REQUIRED);
    expect(unkSupport!.qualityCodes).toContain('TOKEN_EXTENSION_UNKNOWN');

    expect(result.assessment.transferSemanticsSupport).toBe(TransferSemanticsSupport.UNKNOWN_REQUIRED);
  });

  it('handles unsupported program or layout version fail-closed', () => {
    const result = assessTokenControls({
      ...baseInput,
      programId: 'UnknownProgram1111111111111111111111111111111',
      programVersion: '9.9.9',
      layoutVersion: 'unknown-v1',
    });

    expect(result.programSupported).toBe(false);
    expect(result.qualityCodes).toContain('UNSUPPORTED_PROGRAM_VERSION');

    const unknownFinding = result.findings.find((f) => f.control === TokenControl.UNKNOWN_EXTENSION);
    expect(unknownFinding).toBeDefined();
    expect(unknownFinding!.qualityCodes).toContain('UNSUPPORTED_PROGRAM_VERSION');

    const unkSupport = result.supportRows.find((r) => r.extensionType === 'PROGRAM_OR_LAYOUT');
    expect(unkSupport).toBeDefined();
    expect(unkSupport!.support).toBe(TransferSemanticsSupport.UNKNOWN_REQUIRED);
  });

  it('enforces input validation invariants', () => {
    // availableAt precedes observedAt
    expect(() =>
      assessTokenControls({
        ...baseInput,
        observedAt: '2026-01-01T00:00:05.000Z',
        availableAt: '2026-01-01T00:00:01.000Z',
      }),
    ).toThrow('AVAILABLE_AT_PRECEDES_OBSERVED_AT');

    // invalid decimals
    expect(() =>
      assessTokenControls({
        ...baseInput,
        decimals: -1,
      }),
    ).toThrow('INVALID_DECIMALS');

    expect(() =>
      assessTokenControls({
        ...baseInput,
        decimals: 256,
      }),
    ).toThrow('INVALID_DECIMALS');

    // invalid total supply
    expect(() =>
      assessTokenControls({
        ...baseInput,
        totalSupplyRaw: '-100',
      }),
    ).toThrow('INVALID_TOTAL_SUPPLY');

    expect(() =>
      assessTokenControls({
        ...baseInput,
        totalSupplyRaw: '100.5',
      }),
    ).toThrow('INVALID_TOTAL_SUPPLY');
  });

  it('filters point-in-time findings correctly with tokenFindingsAvailableAt', () => {
    const result = assessTokenControls({
      ...baseInput,
      availableAt: '2026-01-01T12:00:00.000Z',
    });

    // Replay before availableAt -> 0 findings
    const beforeFindings = tokenFindingsAvailableAt(result.findings, '2026-01-01T11:59:59.000Z');
    expect(beforeFindings.length).toBe(0);

    // Replay at availableAt -> all findings
    const exactFindings = tokenFindingsAvailableAt(result.findings, '2026-01-01T12:00:00.000Z');
    expect(exactFindings.length).toBe(result.findings.length);

    // Replay after availableAt -> all findings
    const afterFindings = tokenFindingsAvailableAt(result.findings, '2026-01-01T12:00:01.000Z');
    expect(afterFindings.length).toBe(result.findings.length);

    // Invalid timestamp throws
    expect(() => tokenFindingsAvailableAt(result.findings, 'invalid-date')).toThrow(
      'INVALID_REPLAY_TIMESTAMP',
    );
  });

  it('exposes analyzeTokenAssessment alias identical to assessTokenControls', () => {
    expect(analyzeTokenAssessment).toBe(assessTokenControls);
  });
});
