/**
 * Orca Whirlpools decoder vectors unit tests (FR-COL-002).
 */
import { describe, expect, it } from 'bun:test';
import {
  ADVERSARIAL_UNKNOWN_INSTRUCTION_VARIANT,
  ORCA_WHIRLPOOLS_MANIFEST,
} from '../../../tests/fixtures/col/index.ts';

describe('Orca Whirlpools Decoder (FR-COL-002)', () => {
  it('manifest requires Whirlpool and TickArray account families', () => {
    expect(ORCA_WHIRLPOOLS_MANIFEST.requiredAccountFamilies).toContain('Whirlpool');
    expect(ORCA_WHIRLPOOLS_MANIFEST.requiredAccountFamilies).toContain('TickArray');
  });

  it('rejects unknown instruction variant with UNSUPPORTED_PROGRAM_VERSION quality code', () => {
    expect(ADVERSARIAL_UNKNOWN_INSTRUCTION_VARIANT.expectedFailureReason).toBe(
      'UNKNOWN_INSTRUCTION_VARIANT',
    );
    expect(ADVERSARIAL_UNKNOWN_INSTRUCTION_VARIANT.expectedQualityCode).toBe(
      'UNSUPPORTED_PROGRAM_VERSION',
    );
  });
});
