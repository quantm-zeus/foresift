// AC-256 (negative): a Helius enhanced-parser fixture configured as SOLE or
// PRIMARY economic-event decoder REFUSES; so does any deprecated decoder
// running without the raw-operation local decoding pass.
import { describe, expect, it } from 'bun:test';
import { validateDecoderAuthority } from '../../packages/security/src/decoder-authority.ts';

const HELIUS_ENHANCED = {
  id: 'helius-enhanced',
  status: 'DEPRECATED' as const,
  domains: ['economic-events'],
};

describe('AC-256 negative: deprecated parsers can never hold authority', () => {
  it('refuses the Helius enhanced parser as SOLE decoder', () => {
    expect(() =>
      validateDecoderAuthority({
        decoders: [{ ...HELIUS_ENHANCED, authority: 'SOLE' }],
        rawOperationLocalDecodingEnabled: true,
      }),
    ).toThrow(/deprecated.*authoritative/i);
  });

  it('refuses the Helius enhanced parser as PRIMARY decoder', () => {
    expect(() =>
      validateDecoderAuthority({
        decoders: [
          { ...HELIUS_ENHANCED, authority: 'PRIMARY' },
          { id: 'raw-local', status: 'ACTIVE', authority: 'FALLBACK', domains: [] },
        ],
        rawOperationLocalDecodingEnabled: true,
      }),
    ).toThrow(/deprecated.*authoritative/i);
  });

  it('refuses RETIRED parsers holding authority identically', () => {
    expect(() =>
      validateDecoderAuthority({
        decoders: [{ ...HELIUS_ENHANCED, status: 'RETIRED', authority: 'SOLE' }],
        rawOperationLocalDecodingEnabled: true,
      }),
    ).toThrow(/deprecated.*authoritative/i);
  });

  it('refuses deprecated decoders WITHOUT the raw local decoding pass', () => {
    expect(() =>
      validateDecoderAuthority({
        decoders: [{ ...HELIUS_ENHANCED, authority: 'FALLBACK' }],
        rawOperationLocalDecodingEnabled: false,
      }),
    ).toThrow(/raw-operation local decoding/i);
  });
});
