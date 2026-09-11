import { describe, expect, it } from 'bun:test';
import { TransferSemanticsSupport } from '@foresift/domain';
import { parseSolsecSchema } from '@foresift/shared-schemas';
import {
  transferExtensionVerdict,
  getTransferExtensionVerdict,
  evaluateTransferSemantics,
  buildTokenExtensionSupportRows,
  blocksCompleteExecutionModeling,
  DEFAULT_TRANSFER_SEMANTICS_POLICY,
  TRANSFER_VERDICT_POLICY_VERSION,
  TOKEN_2022_PROGRAM_ID,
  type TransferSemanticsPolicy,
  type TransferSemanticsInput,
} from '../src/index.ts';

describe('transfer-semantics: versioned support verdicts and pure blocking gate (FR-SOLSEC-004, AC-130)', () => {
  const assessmentId = 'token-assessment:test-assessment-001';
  const baseInput: TransferSemanticsInput = {
    assessmentId,
    programId: TOKEN_2022_PROGRAM_ID,
    programVersion: '1.0.0',
    extensions: ['transferFeeConfig', 'defaultAccountState'],
    verdictPolicyVersion: TRANSFER_VERDICT_POLICY_VERSION,
    observedAt: '2026-01-01T00:00:00.000Z',
    availableAt: '2026-01-01T00:00:01.000Z',
  };

  it('evaluates transferExtensionVerdict truth table correctly for known and unknown extensions', () => {
    // When not present -> NOT_PRESENT
    expect(
      transferExtensionVerdict({
        programId: TOKEN_2022_PROGRAM_ID,
        programVersion: '1.0.0',
        extension: 'TRANSFER_FEE',
        present: false,
        verdictPolicyVersion: TRANSFER_VERDICT_POLICY_VERSION,
      }),
    ).toBe(TransferSemanticsSupport.NOT_PRESENT);

    // Modeled extensions
    expect(
      transferExtensionVerdict({
        programId: TOKEN_2022_PROGRAM_ID,
        programVersion: '1.0.0',
        extension: 'transferFeeConfig',
        present: true,
        verdictPolicyVersion: TRANSFER_VERDICT_POLICY_VERSION,
      }),
    ).toBe(TransferSemanticsSupport.KNOWN_MODELED);

    expect(
      transferExtensionVerdict({
        programId: TOKEN_2022_PROGRAM_ID,
        programVersion: '1.0.0',
        extension: 'defaultAccountState',
        present: true,
        verdictPolicyVersion: TRANSFER_VERDICT_POLICY_VERSION,
      }),
    ).toBe(TransferSemanticsSupport.KNOWN_MODELED);

    expect(
      transferExtensionVerdict({
        programId: TOKEN_2022_PROGRAM_ID,
        programVersion: '1.0.0',
        extension: 'nonTransferable',
        present: true,
        verdictPolicyVersion: TRANSFER_VERDICT_POLICY_VERSION,
      }),
    ).toBe(TransferSemanticsSupport.KNOWN_MODELED);

    // Unmodeled extensions
    expect(
      transferExtensionVerdict({
        programId: TOKEN_2022_PROGRAM_ID,
        programVersion: '1.0.0',
        extension: 'transferHook',
        present: true,
        verdictPolicyVersion: TRANSFER_VERDICT_POLICY_VERSION,
      }),
    ).toBe(TransferSemanticsSupport.KNOWN_UNMODELED);

    expect(
      transferExtensionVerdict({
        programId: TOKEN_2022_PROGRAM_ID,
        programVersion: '1.0.0',
        extension: 'confidentialTransferMint',
        present: true,
        verdictPolicyVersion: TRANSFER_VERDICT_POLICY_VERSION,
      }),
    ).toBe(TransferSemanticsSupport.KNOWN_UNMODELED);

    // Unknown extension fails closed to UNKNOWN_REQUIRED
    expect(
      transferExtensionVerdict({
        programId: TOKEN_2022_PROGRAM_ID,
        programVersion: '1.0.0',
        extension: 'unsupportedFutureExtension',
        present: true,
        verdictPolicyVersion: TRANSFER_VERDICT_POLICY_VERSION,
      }),
    ).toBe(TransferSemanticsSupport.UNKNOWN_REQUIRED);

    // Unsupported program version fails closed to UNKNOWN_REQUIRED
    expect(
      transferExtensionVerdict({
        programId: TOKEN_2022_PROGRAM_ID,
        programVersion: '9.9.9',
        extension: 'transferFeeConfig',
        present: true,
        verdictPolicyVersion: TRANSFER_VERDICT_POLICY_VERSION,
      }),
    ).toBe(TransferSemanticsSupport.UNKNOWN_REQUIRED);

    // Unknown verdict policy version fails closed to UNKNOWN_REQUIRED
    expect(
      transferExtensionVerdict({
        programId: TOKEN_2022_PROGRAM_ID,
        programVersion: '1.0.0',
        extension: 'transferFeeConfig',
        present: true,
        verdictPolicyVersion: 'unknown-policy@9',
      }),
    ).toBe(TransferSemanticsSupport.UNKNOWN_REQUIRED);
  });

  it('evaluates full token extension support rows with schema compliance and non-present complement', () => {
    const rows = evaluateTransferSemantics(baseInput);

    expect(rows.length).toBeGreaterThanOrEqual(2);

    // Present rows
    const feeRow = rows.find((r) => r.extensionType === 'TRANSFER_FEE');
    expect(feeRow).toBeDefined();
    expect(feeRow!.support).toBe(TransferSemanticsSupport.KNOWN_MODELED);
    expect(feeRow!.qualityCodes).toEqual(['VALID']);
    expect(feeRow!.verdictPolicyVersion).toBe(TRANSFER_VERDICT_POLICY_VERSION);

    const defaultStateRow = rows.find((r) => r.extensionType === 'DEFAULT_STATE');
    expect(defaultStateRow).toBeDefined();
    expect(defaultStateRow!.support).toBe(TransferSemanticsSupport.KNOWN_MODELED);

    // Not present complement rows
    const notPresentHook = rows.find((r) => r.extensionType === 'TRANSFER_HOOK');
    expect(notPresentHook).toBeDefined();
    expect(notPresentHook!.support).toBe(TransferSemanticsSupport.NOT_PRESENT);

    // Verify all rows against shared-schemas
    for (const row of rows) {
      expect(() => parseSolsecSchema('TokenExtensionSupport', row)).not.toThrow();
    }
  });

  it('marks unknown extension rows with UNKNOWN_REQUIRED and TOKEN_EXTENSION_UNKNOWN quality', () => {
    const rows = evaluateTransferSemantics({
      ...baseInput,
      extensions: ['unknownExtensionX'],
    });

    const unknownRow = rows.find((r) => r.extensionType === 'unknownExtensionX');
    expect(unknownRow).toBeDefined();
    expect(unknownRow!.support).toBe(TransferSemanticsSupport.UNKNOWN_REQUIRED);
    expect(unknownRow!.qualityCodes).toContain('TOKEN_EXTENSION_UNKNOWN');
  });

  it('pure predicate blocksCompleteExecutionModeling accurately detects blocking condition', () => {
    // Single string
    expect(blocksCompleteExecutionModeling(TransferSemanticsSupport.UNKNOWN_REQUIRED)).toBe(true);
    expect(blocksCompleteExecutionModeling(TransferSemanticsSupport.KNOWN_MODELED)).toBe(false);
    expect(blocksCompleteExecutionModeling(TransferSemanticsSupport.KNOWN_UNMODELED)).toBe(false);
    expect(blocksCompleteExecutionModeling(TransferSemanticsSupport.NOT_PRESENT)).toBe(false);

    // Object with support field
    expect(
      blocksCompleteExecutionModeling({ support: TransferSemanticsSupport.UNKNOWN_REQUIRED }),
    ).toBe(true);
    expect(
      blocksCompleteExecutionModeling({ support: TransferSemanticsSupport.KNOWN_MODELED }),
    ).toBe(false);

    // Array of supports / rows
    expect(
      blocksCompleteExecutionModeling([
        TransferSemanticsSupport.KNOWN_MODELED,
        TransferSemanticsSupport.NOT_PRESENT,
      ]),
    ).toBe(false);

    expect(
      blocksCompleteExecutionModeling([
        TransferSemanticsSupport.KNOWN_MODELED,
        TransferSemanticsSupport.UNKNOWN_REQUIRED,
      ]),
    ).toBe(true);

    expect(
      blocksCompleteExecutionModeling([
        { support: TransferSemanticsSupport.KNOWN_MODELED },
        { support: TransferSemanticsSupport.UNKNOWN_REQUIRED },
      ]),
    ).toBe(true);
  });

  it('supports custom policy versions without mutating or rewriting historical policy rows', () => {
    const customPolicy: TransferSemanticsPolicy = {
      version: 'solsec-transfer-semantics@2-custom',
      programVersions: {
        [TOKEN_2022_PROGRAM_ID]: ['1.0.0'],
      },
      extensionVerdicts: {
        TRANSFER_HOOK: 'KNOWN_MODELED', // Newly modeled in policy v2
      },
    };

    const v1Rows = evaluateTransferSemantics({
      ...baseInput,
      extensions: ['transferHook'],
      verdictPolicyVersion: TRANSFER_VERDICT_POLICY_VERSION,
    });
    const v1Hook = v1Rows.find((r) => r.extensionType === 'TRANSFER_HOOK');
    expect(v1Hook!.support).toBe(TransferSemanticsSupport.KNOWN_UNMODELED);
    expect(v1Hook!.verdictPolicyVersion).toBe(TRANSFER_VERDICT_POLICY_VERSION);

    const v2Rows = evaluateTransferSemantics({
      ...baseInput,
      extensions: ['transferHook'],
      verdictPolicyVersion: customPolicy.version,
      policies: [DEFAULT_TRANSFER_SEMANTICS_POLICY, customPolicy],
    });
    const v2Hook = v2Rows.find((r) => r.extensionType === 'TRANSFER_HOOK');
    expect(v2Hook!.support).toBe(TransferSemanticsSupport.KNOWN_MODELED);
    expect(v2Hook!.verdictPolicyVersion).toBe(customPolicy.version);
  });

  it('enforces temporal invariant availableAt >= observedAt', () => {
    expect(() =>
      evaluateTransferSemantics({
        ...baseInput,
        observedAt: '2026-01-01T00:00:10.000Z',
        availableAt: '2026-01-01T00:00:01.000Z',
      }),
    ).toThrow('AVAILABLE_AT_PRECEDES_OBSERVED_AT');
  });

  it('exposes aliases getTransferExtensionVerdict and buildTokenExtensionSupportRows', () => {
    expect(getTransferExtensionVerdict).toBe(transferExtensionVerdict);
    expect(buildTokenExtensionSupportRows).toBe(evaluateTransferSemantics);
  });
});
