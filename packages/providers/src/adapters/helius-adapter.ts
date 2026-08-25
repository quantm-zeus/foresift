/**
 * Helius adapter (FR-PROV-007): raw getTransaction and standard signature
 * history as the authoritative paths, LOCAL supported-program decoding
 * separated from provider parsing, and the DEPRECATED enhanced parser gated
 * behind a valid migration exception (usable only as non-authoritative
 * evidence, never the sole economic-event source).
 */
import { DeprecationError, ProvErrorCode } from '@foresift/provider-lifecycle';
import type { DecodingPathConfig } from '@foresift/security';
import { AdapterContract, buildQueryUrl } from '../adapter-contract.ts';
import type { FetchPort } from '../fetch-port.ts';
import {
  ENHANCED_PARSE_OPERATION_ID,
  HELIUS_HOST,
  HELIUS_OPERATIONS,
} from '../operation-catalogs/helius.catalog.ts';
import type { LocalDecodingResult, RawTransactionShape } from '../helius-decoding.ts';
import { decodeInstructionsLocally } from '../helius-decoding.ts';

/** The fail-closed deprecation gate (FR-PROV-003 registry lookups). */
export interface EnhancedParserGate {
  assertNewUseAllowed(providerId: string, operationId: string): Promise<void>;
}

export interface HeliusAdapterOptions {
  readonly contract: AdapterContract;
  readonly fetch: FetchPort;
  /**
   * Deprecation gate for the enhanced parser. ABSENT → every enhanced
   * call refuses fail-closed: without a wired exception registry there is
   * no way to prove a valid migration exception exists.
   */
  readonly enhancedParserGate?: EnhancedParserGate | undefined;
}

interface SignatureInput {
  readonly signature: string;
}
interface HistoryInput {
  readonly address: string;
  readonly query?: Readonly<Record<string, string>>;
}

export class HeliusAdapter {
  private readonly contract: AdapterContract;
  private readonly fetch: FetchPort;
  private readonly gate: EnhancedParserGate | undefined;

  constructor(options: HeliusAdapterOptions) {
    this.contract = options.contract;
    this.fetch = options.fetch;
    this.gate = options.enhancedParserGate;
  }

  /** Raw getTransaction — THE authoritative transaction path. */
  async rawGetTransaction(input: SignatureInput): Promise<unknown> {
    const url = buildQueryUrl(`https://${HELIUS_HOST}`, `/v0/transactions/${input.signature}`, {
      encoding: 'json',
    });
    return this.contract.execute(this.fetch, 'helius/raw-get-transaction', url);
  }

  /** Standard signature history read. */
  async signatureHistory(input: HistoryInput): Promise<unknown> {
    const url = buildQueryUrl(
      `https://${HELIUS_HOST}`,
      `/v0/addresses/${input.address}/transactions`,
      input.query,
    );
    return this.contract.execute(this.fetch, 'helius/signature-history-standard', url);
  }

  /**
   * DEPRECATED enhanced parsing — non-authoritative supporting evidence
   * ONLY, and only while a VALID migration exception covers it (checked at
   * use time against the FR-PROV-003 registry; no grace window).
   */
  async enhancedTransactionParse(input: SignatureInput): Promise<unknown> {
    if (this.gate === undefined) {
      throw new DeprecationError(
        'enhanced parser gate not wired — refusing deprecated operation fail-closed',
        { operationId: ENHANCED_PARSE_OPERATION_ID },
        ProvErrorCode.PROV_DEPRECATED_NEW_USE_BLOCKED,
      );
    }
    await this.gate.assertNewUseAllowed('helius', ENHANCED_PARSE_OPERATION_ID);
    const url = buildQueryUrl(`https://${HELIUS_HOST}`, `/v0/enhanced/transactions/${input.signature}`);
    return this.contract.execute(this.fetch, ENHANCED_PARSE_OPERATION_ID, url);
  }

  /** Deterministic LOCAL decoding of a raw payload (never provider-parsed). */
  decodeLocally(raw: RawTransactionShape): LocalDecodingResult {
    return decodeInstructionsLocally(raw);
  }
}

/**
 * Build the decoder-authority configuration from THIS package's REAL
 * catalog entries (T118 / AC-256): raw+local remains the only authoritative
 * configuration; the deprecated entry's role comes straight from its
 * declared `decoderRole`, so drift between catalog and config is
 * structurally impossible.
 */
export function heliusDecoderAuthorityConfig(overrides?: {
  readonly authorityOverrides?: Readonly<Record<string, 'SOLE' | 'PRIMARY' | 'FALLBACK' | 'NONE'>>;
  readonly acknowledgedDeprecations?: readonly string[];
  readonly rawOperationLocalDecodingEnabled?: boolean;
}): DecodingPathConfig {
  return {
    decoders: HELIUS_OPERATIONS.filter((op) => op.decoderRole !== undefined).map((op) => ({
      id: op.definition.operationId,
      status: op.definition.deprecatedAt !== undefined ? ('DEPRECATED' as const) : ('ACTIVE' as const),
      authority:
        overrides?.authorityOverrides?.[op.definition.operationId] ??
        op.decoderRole!.authority,
      domains: [...op.decoderRole!.domains],
    })),
    rawOperationLocalDecodingEnabled: overrides?.rawOperationLocalDecodingEnabled ?? true,
    ...(overrides?.acknowledgedDeprecations === undefined
      ? {}
      : { acknowledgedDeprecations: overrides.acknowledgedDeprecations }),
  };
}
