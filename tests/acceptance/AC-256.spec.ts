// AC-256 (acceptance): "A deprecated Helius enhanced parser cannot be
// configured as the sole or authoritative economic-event decoder; supported
// raw transaction/history operations plus local decoding remain the
// normative path." The decoder-authority validator admits exactly the
// raw-operation-plus-local-decoding configuration.
import { describe, expect, it } from 'bun:test';
import { validateDecoderAuthority } from '../../packages/security/src/decoder-authority.ts';

function normativeConfig() {
  return {
    decoders: [
      {
        id: 'raw-local',
        status: 'ACTIVE' as const,
        authority: 'PRIMARY' as const,
        domains: ['economic-events'],
      },
      {
        id: 'helius-enhanced',
        status: 'DEPRECATED' as const,
        authority: 'FALLBACK' as const,
        domains: ['economic-events'],
      },
    ],
    rawOperationLocalDecodingEnabled: true,
    acknowledgedDeprecations: ['helius-enhanced'],
  };
}

describe('AC-256: raw operations + local decoding is the normative decoding path', () => {
  it('admits the raw-operation + local-decoding configuration as authoritative', () => {
    const result = validateDecoderAuthority(normativeConfig());
    expect(result.ok).toBe(true);
    expect(result.authoritativeDecoderIds).toEqual(['raw-local']);
  });

  it('keeps the local pass authoritative even when a supplemental parser runs', () => {
    const result = validateDecoderAuthority({
      ...normativeConfig(),
      decoders: [
        {
          id: 'helius-enhanced',
          status: 'DEPRECATED',
          authority: 'NONE',
          domains: [],
        },
        {
          id: 'raw-local',
          status: 'ACTIVE',
          authority: 'SOLE',
          domains: ['economic-events'],
        },
      ],
    });
    expect(result.authoritativeDecoderIds).toEqual(['raw-local']);
  });

  it('admits an all-active configuration with no deprecation baggage', () => {
    const result = validateDecoderAuthority({
      decoders: [
        { id: 'raw-local', status: 'ACTIVE', authority: 'SOLE', domains: ['economic-events'] },
      ],
      rawOperationLocalDecodingEnabled: true,
    });
    expect(result.ok).toBe(true);
  });
});
