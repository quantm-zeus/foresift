// Decoder-authority wiring (FR-PROV-007; T117/T118): the REAL Helius decoding
// configuration passes validateDecoderAuthority, and both failure directions
// are proven against these actual entries — a deprecated parser promoted to
// authority is refused, as is running it without the raw+local pass or
// without an explicit acknowledgement. Also proves the plan-gated operation
// is structurally unavailable under STRICT_FREE.
import { describe, expect, it, vi } from 'vitest';
import { ProvErrorCode } from '@foresift/provider-lifecycle';
import { validateDecoderAuthority } from '@foresift/security';
import {
  EgressFetchPort,
  HELIUS_DESCRIPTOR,
  HELIUS_ENHANCED_PARSER_ID,
  HELIUS_LOCAL_DECODER_ID,
  HeliusAdapter,
  buildHeliusDecodingConfig,
  type ProviderHttpResponse,
} from '../src/index.ts';

type TransportInput = Parameters<import('../src/index.ts').TransportFn>[0];

describe('Helius decoding-path authority (real registry entries)', () => {
  it('accepts the normative config: LOCAL decoder is the sole authoritative path', () => {
    const verdict = validateDecoderAuthority(buildHeliusDecodingConfig());
    expect(verdict.ok).toBe(true);
    expect(verdict.authoritativeDecoderIds).toEqual([HELIUS_LOCAL_DECODER_ID]);
  });

  it('refuses promoting the deprecated enhanced parser to SOLE or PRIMARY authority', () => {
    const base = buildHeliusDecodingConfig();
    const promoteTo = (authority: 'SOLE' | 'PRIMARY') => ({
      ...base,
      decoders: base.decoders.map((decoder) =>
        decoder.id === HELIUS_ENHANCED_PARSER_ID ? { ...decoder, authority } : decoder,
      ),
    });
    expect(() => validateDecoderAuthority(promoteTo('SOLE'))).toThrowError(/deprecated parser/);
    expect(() =>
      validateDecoderAuthority(promoteTo('PRIMARY')),
    ).toThrowError(/SEC_DECODER_AUTHORITY_INVALID|deprecated/);
    try {
      validateDecoderAuthority(promoteTo('SOLE'));
      expect.unreachable('promotion must be refused');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('SEC_DECODER_AUTHORITY_INVALID');
    }
  });

  it('refuses running the deprecated parser without the raw+local decoding pass', () => {
    const config = { ...buildHeliusDecodingConfig(), rawOperationLocalDecodingEnabled: false };
    expect(() => validateDecoderAuthority(config)).toThrowError(/raw-operation local decoding/);
  });

  it('refuses running the deprecated parser without its explicit acknowledgement', () => {
    const config = { ...buildHeliusDecodingConfig(), acknowledgedDeprecations: [] };
    expect(() => validateDecoderAuthority(config)).toThrowError(/acknowledgement/);
  });

  it('keeps the raw and history operations separate from vendor parsing surfaces', () => {
    const byId = new Map(HELIUS_DESCRIPTOR.operations.map((op) => [op.operationId, op]));
    // Raw operation: LOCAL decoding is normative, response stays unparsed.
    expect(byId.get('get-raw-transaction')?.capabilityClass).toBe('READ_TRANSACTION_RAW');
    // Enhanced-parser operation exists only as a bounded fallback surface.
    expect(byId.get('get-parsed-transactions')?.capabilityClass).toBe('READ_TRANSACTION_HISTORY');
    // The plan-gated operation is disabled for STRICT_FREE by construction.
    const planGated = byId.get('get-enhanced-token-data');
    expect(planGated?.planGated).toBe(true);
    expect(planGated?.allowedInStrictFree).toBe(false);
  });

  it('refuses plan-gated operations outright under a STRICT_FREE deployment', async () => {
    const transport = vi.fn(
      async (_input: TransportInput): Promise<ProviderHttpResponse> => {
        throw new Error('network must never be reached');
      },
    );
    const port = new EgressFetchPort({
      guard: {
        authorize: async () => ({ decision: 'ALLOW', host: 'api.helius.dev', pinnedAddresses: ['203.0.113.20'] }),
        verifyPin: async () => ({ decision: 'ALLOW', host: 'api.helius.dev', pinnedAddresses: ['203.0.113.20'] }),
        authorizeRedirect: async () => ({
          decision: 'REFUSE',
          reason: 'REDIRECT_UNAPPROVED',
          detail: 'no redirects in tests',
        }),
      },
      transport,
    });
    const adapter = new HeliusAdapter(port, { strictFree: true });
    await expect(
      adapter.getEnhancedTokenData({ 'api-key': 'k', mint: 'MintKe111111111111111111111111111111111' }),
    ).rejects.toMatchObject({
      code: ProvErrorCode.PROV_STRICT_FREE_UNAVAILABLE,
      detail: { operationId: 'get-enhanced-token-data' },
    });
    expect(transport).not.toHaveBeenCalled();

    // Outside STRICT_FREE the call proceeds into the guarded port.
    const adapterPaid = new HeliusAdapter(port, { strictFree: false });
    transport.mockResolvedValueOnce({
      status: 200,
      contentType: 'application/json',
      bodyBytes: new TextEncoder().encode('{}'),
      locationHeader: null,
    });
    const response = await adapterPaid.getEnhancedTokenData({
      'api-key': 'k',
      mint: 'MintKe111111111111111111111111111111111',
    });
    expect(response.status).toBe(200);
  });
});
