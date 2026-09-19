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
import {
  isArraySafe,
  numericFilter,
  numericIncludes,
  numericJoin,
  numericMap,
  numericSome,
  snapshotCallerInput,
} from './shadow-safe.ts';

const DECODER_STATUSES: readonly string[] = ['ACTIVE', 'DEPRECATED', 'RETIRED'];
const DECODER_AUTHORITIES: readonly string[] = ['SOLE', 'PRIMARY', 'FALLBACK', 'NONE'];

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

export function validateDecoderAuthority(rawConfig: DecodingPathConfig): {
  ok: true;
  authoritativeDecoderIds: string[];
} {
  // Single-read binding (V7 accessor class): the authority, deprecation and
  // acknowledgement checks must all observe the same decoder inventory.
  const config = snapshotCallerInput(rawConfig);
  // Residual CRITICAL (partial-Proxy): a Proxy can omit `decoders` from
  // `ownKeys`; an ABSENT/non-array inventory and an ABSENT/invalid per-decoder
  // `authority`/`status` must refuse rather than read as "nothing deprecated /
  // not authoritative". Validate every field once, before any classification.
  const rawDecoders: unknown = config.decoders;
  if (!isArraySafe(rawDecoders)) {
    throw new ProhibitedCapabilityError(
      'decoder inventory is missing or not an array',
      { code: SecErrorCode.SEC_DECODER_AUTHORITY_INVALID },
      SecErrorCode.SEC_DECODER_AUTHORITY_INVALID,
    );
  }
  const decoderInventory = rawDecoders as ReadonlyArray<DecoderConfigEntry>;
  for (let index = 0; index < decoderInventory.length; index += 1) {
    const decoder = decoderInventory[index] as
      | {
          readonly id?: unknown;
          readonly status?: unknown;
          readonly authority?: unknown;
          readonly domains?: unknown;
        }
      | undefined;
    if (
      decoder === undefined ||
      decoder === null ||
      typeof decoder !== 'object' ||
      typeof decoder.id !== 'string' ||
      typeof decoder.status !== 'string' ||
      !numericIncludes(DECODER_STATUSES, decoder.status) ||
      typeof decoder.authority !== 'string' ||
      !numericIncludes(DECODER_AUTHORITIES, decoder.authority) ||
      !isArraySafe(decoder.domains)
    ) {
      throw new ProhibitedCapabilityError(
        'decoder entry is missing or carries an invalid status/authority field',
        { index },
        SecErrorCode.SEC_DECODER_AUTHORITY_INVALID,
      );
    }
  }
  if (typeof config.rawOperationLocalDecodingEnabled !== 'boolean') {
    throw new ProhibitedCapabilityError(
      'raw-operation local decoding flag must be an explicit boolean',
      { code: SecErrorCode.SEC_DECODER_AUTHORITY_INVALID },
      SecErrorCode.SEC_DECODER_AUTHORITY_INVALID,
    );
  }
  const acknowledged = config.acknowledgedDeprecations;
  if (acknowledged !== undefined && !isArraySafe(acknowledged)) {
    throw new ProhibitedCapabilityError(
      'acknowledged deprecations must be an array of decoder ids',
      { code: SecErrorCode.SEC_DECODER_AUTHORITY_INVALID },
      SecErrorCode.SEC_DECODER_AUTHORITY_INVALID,
    );
  }
  const deprecatedAuthoritative = numericFilter(
    decoderInventory,
    (decoder) =>
      (decoder.status === 'DEPRECATED' || decoder.status === 'RETIRED') &&
      (decoder.authority === 'SOLE' || decoder.authority === 'PRIMARY'),
  );
  if (deprecatedAuthoritative.length > 0) {
    throw new ProhibitedCapabilityError(
      'a deprecated parser is configured as an authoritative economic-event decoder',
      {
        offenders: numericJoin(numericMap(deprecatedAuthoritative, (d) => d.id)),
        code: SecErrorCode.SEC_DECODER_AUTHORITY_INVALID,
      },
      SecErrorCode.SEC_DECODER_AUTHORITY_INVALID,
    );
  }
  // The safe path must exist whenever anything deprecated still runs.
  const anyDeprecatedRunning = numericSome(decoderInventory, (d) => d.status === 'DEPRECATED');
  if (anyDeprecatedRunning && !config.rawOperationLocalDecodingEnabled) {
    throw new ProhibitedCapabilityError(
      'deprecated decoders present without the raw-operation local decoding pass enabled',
      { code: SecErrorCode.SEC_DECODER_AUTHORITY_INVALID },
      SecErrorCode.SEC_DECODER_AUTHORITY_INVALID,
    );
  }
  // Operator acknowledgement (M22/L21): running a DEPRECATED parser demands
  // an explicit, recorded acknowledgement of THAT parser — the parameter is
  // enforced, not decorative.
  const unacknowledged = numericMap(
    numericFilter(
      decoderInventory,
      (d) =>
        d.status === 'DEPRECATED' && !numericIncludes(config.acknowledgedDeprecations ?? [], d.id),
    ),
    (d) => d.id,
  );
  if (unacknowledged.length > 0) {
    throw new ProhibitedCapabilityError(
      'deprecated decoders run without explicit operator acknowledgement',
      { unacknowledged: numericJoin(unacknowledged) },
      SecErrorCode.SEC_DECODER_AUTHORITY_INVALID,
    );
  }
  const authoritativeDecoderIds = numericMap(
    numericFilter(decoderInventory, (d) => d.authority === 'SOLE' || d.authority === 'PRIMARY'),
    (d) => d.id,
  );
  return { ok: true, authoritativeDecoderIds };
}
