/**
 * Helius decoding-path authority (FR-PROV-007; T117/T118).
 *
 * The normative configuration for every Helius-derived economic event:
 *  - the LOCAL decoder over raw-operation payloads is the SOLE authority;
 *  - the vendor enhanced parser is DEPRECATED and may run only as FALLBACK,
 *    with the raw+local decoding pass enabled and an explicit operator
 *    acknowledgement recorded;
 *  - the plan-gated enhanced operation is disabled under STRICT_FREE.
 *
 * This module produces the real `DecodingPathConfig` consumed by the
 * security perimeter's validateDecoderAuthority — the wiring test proves both
 * directions (normative config accepted; any authority inversion refused)
 * against THESE entries, not synthetic ones.
 */
import type { DecodingPathConfig } from '@foresift/security';

export const HELIUS_LOCAL_DECODER_ID = 'helius-local-decoder';
export const HELIUS_ENHANCED_PARSER_ID = 'helius-enhanced-parser';
export const HELIUS_DECODING_DOMAIN = 'solana.transaction.economic_events';
export const HELIUS_PLAN_GATED_OPERATION_ID = 'get-enhanced-token-data';

/** Normative Helius decoding path: LOCAL authoritative, parser fallback. */
export function buildHeliusDecodingConfig(): DecodingPathConfig {
  return {
    decoders: [
      {
        id: HELIUS_LOCAL_DECODER_ID,
        status: 'ACTIVE',
        authority: 'SOLE',
        domains: [HELIUS_DECODING_DOMAIN],
      },
      {
        id: HELIUS_ENHANCED_PARSER_ID,
        status: 'DEPRECATED',
        authority: 'FALLBACK',
        domains: [HELIUS_DECODING_DOMAIN],
      },
    ],
    rawOperationLocalDecodingEnabled: true,
    acknowledgedDeprecations: [HELIUS_ENHANCED_PARSER_ID],
  };
}

/** STRICT_FREE availability of the plan-gated operation is structural. */
export function heliusPlanGatedAllowedInStrictFree(): false {
  return false;
}
