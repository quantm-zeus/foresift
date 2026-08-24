/**
 * Decoder-authority configuration validator (FR-SEC-003; AC-256).
 *
 * The PRD's decoder-authority rule: a DEPRECATED parser may never be
 * marked the sole/authoritative economic-event decoder while the
 * raw-operation + local decoding path is available. Configurations that
 * do so are refused BEFORE any event flows through them — silently
 * trusting an obsolete parser is exactly the authority inversion §41.x
 * prohibits.
 */
import { ProhibitedCapabilityError, SecErrorCode } from './errors.ts';

export interface DecoderConfigEntry {
  readonly id: string;
  readonly status: 'ACTIVE' | 'DEPRECATED' | 'RETIRED';
  /** SOLE = authoritative economic-event decoder for its domain. */
  readonly authority: 'SOLE' | 'PRIMARY' | 'FALLBACK' | 'NONE';
  readonly domains: readonly string[];
}

export interface DecodingPathConfig {
  readonly decoders: readonly DecoderConfigEntry[];
  /** Raw-operation + LOCAL decoding path enabled? */
  readonly rawOperationLocalDecodingEnabled: boolean;
  /** Explicit operator acknowledgement required when deprecating authority. */
  readonly acknowledgedDeprecations?: readonly string[] | undefined;
}

export function validateDecoderAuthority(config: DecodingPathConfig): {
  ok: true;
  authoritativeDecoderIds: string[];
} {
  const deprecatedAuthoritative = config.decoders.filter(
    (decoder) =>
      (decoder.status === 'DEPRECATED' || decoder.status === 'RETIRED') &&
      (decoder.authority === 'SOLE' || decoder.authority === 'PRIMARY'),
  );
  if (deprecatedAuthoritative.length > 0) {
    throw new ProhibitedCapabilityError(
      'a deprecated parser is configured as an authoritative economic-event decoder',
      {
        offenders: deprecatedAuthoritative.map((d) => d.id).join(','),
        code: SecErrorCode.SEC_DECODER_AUTHORITY_INVALID,
      },
      SecErrorCode.SEC_DECODER_AUTHORITY_INVALID,
    );
  }
  // The safe path must exist whenever anything deprecated still runs.
  const anyDeprecatedRunning = config.decoders.some((d) => d.status === 'DEPRECATED');
  if (anyDeprecatedRunning && !config.rawOperationLocalDecodingEnabled) {
    throw new ProhibitedCapabilityError(
      'deprecated decoders present without the raw-operation local decoding pass enabled',
      { code: SecErrorCode.SEC_DECODER_AUTHORITY_INVALID },
      SecErrorCode.SEC_DECODER_AUTHORITY_INVALID,
    );
  }
  const authoritativeDecoderIds = config.decoders
    .filter((d) => d.authority === 'SOLE' || d.authority === 'PRIMARY')
    .map((d) => d.id);
  return { ok: true, authoritativeDecoderIds };
}
