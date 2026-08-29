export interface AdversarialLayoutFixture {
  readonly testCaseId: string;
  readonly protocolFamily: string;
  readonly programId: string;
  readonly description: string;
  readonly rawAccountDataBase64: string;
  readonly expectedFailureReason: string;
  readonly expectedQualityCode: string;
}

export const ADVERSARIAL_PUMP_CORRUPTED_DISCRIMINATOR: AdversarialLayoutFixture = {
  testCaseId: 'adv_pump_bad_discriminator',
  protocolFamily: 'PUMP',
  programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  description: '8-byte Anchor discriminator modified to match unknown struct',
  rawAccountDataBase64:
    '/////////////////////wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  expectedFailureReason: 'INVALID_ACCOUNT_DISCRIMINATOR',
  expectedQualityCode: 'SCHEMA_DEGRADED',
};

export const ADVERSARIAL_RAYDIUM_TRUNCATED_LAYOUT: AdversarialLayoutFixture = {
  testCaseId: 'adv_raydium_truncated',
  protocolFamily: 'RAYDIUM',
  programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  description: 'AmmInfo buffer truncated before reserve fields',
  rawAccountDataBase64: 'AQIDBAUGCAkKCwwNDg8Q',
  expectedFailureReason: 'UNEXPECTED_EOF_TRUNCATED_ACCOUNT',
  expectedQualityCode: 'SCHEMA_DEGRADED',
};

export const ADVERSARIAL_UNKNOWN_INSTRUCTION_VARIANT: AdversarialLayoutFixture = {
  testCaseId: 'adv_unknown_ix_variant',
  protocolFamily: 'ORCA',
  programId: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  description: 'Instruction index 255 does not match any recognized Whirlpool instruction',
  rawAccountDataBase64: '/wAAAAAAAAAAAAAAAAAAAA==',
  expectedFailureReason: 'UNKNOWN_INSTRUCTION_VARIANT',
  expectedQualityCode: 'UNSUPPORTED_PROGRAM_VERSION',
};
