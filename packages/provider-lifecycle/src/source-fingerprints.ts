/**
 * Source fingerprints — behavioral provenance over the six §15.7 kinds
 * (FR-PROV-010; T122). Fingerprints are CANONICAL-JSON payloads reduced to
 * sha256, stored append-only with an INV-009 retry fence: identical
 * recomputation of the same kind for the same operation version resolves to
 * the SAME row and never duplicates storage.
 */
import type { DatabaseEngine } from '@foresift/persistence';
import { canonicalJson, sha256Text } from '@foresift/persistence';
import type { ClockPort, UtcTimestamp } from '@foresift/domain';
import {
  ProviderFingerprintKindSchema,
  PROVIDER_FINGERPRINT_KINDS,
  type ProviderFingerprintKind,
} from './vocabulary.ts';
import { ProvErrorCode, SourceFingerprintError } from './errors.ts';
import type { OperationTarget } from './operation-registry.ts';

export interface RecordFingerprintInput {
  readonly target: OperationTarget;
  readonly kind: ProviderFingerprintKind;
  /** Structured estimator output; stored as canonical JSON + its sha256. */
  readonly payload: Record<string, unknown>;
  /**
   * Provenance references to the estimator inputs (e.g. observation or
   * artifact ids) so every fingerprint is recomputable.
   */
  readonly estimatorInputRefs?: readonly string[] | undefined;
  /** Explicit computation instant for deterministic retries; default clock.now(). */
  readonly computedAt?: UtcTimestamp | undefined;
}

export interface FingerprintRecord {
  readonly fingerprintId: string;
  readonly kind: ProviderFingerprintKind;
  readonly canonicalPayload: string;
  readonly fingerprintSha256: string;
  readonly computedAt: string;
  readonly created: boolean;
}

interface FingerprintRow {
  fingerprint_id: string;
  kind: string;
  fingerprint_payload_canonical: string;
  fingerprint_sha256: string;
  computed_at: Date | string;
}

function iso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}

export class SourceFingerprintStore {
  private readonly engine: DatabaseEngine;
  private readonly clock: ClockPort;

  constructor(options: { engine: DatabaseEngine; clock: ClockPort }) {
    this.engine = options.engine;
    this.clock = options.clock;
  }

  /**
   * Records one fingerprint. The retry fence is
   * (provider_id, operation_id, operation_version, kind, fingerprint_sha256):
   * a genuinely different recomputation (hash differs) is a NEW row —
   * behavior drift is EVIDENCE, never overwritten; only identical
   * recomputation dedupes.
   */
  async record(input: RecordFingerprintInput): Promise<FingerprintRecord> {
    const kind = ProviderFingerprintKindSchema.parse(input.kind);
    if (
      input.payload === null ||
      typeof input.payload !== 'object' ||
      Array.isArray(input.payload)
    ) {
      throw new SourceFingerprintError(
        `fingerprint payload must be a structured JSON object (kind ${kind})`,
        { ...input.target, kind },
        ProvErrorCode.PROV_FINGERPRINT_PAYLOAD_NOT_CANONICAL,
      );
    }
    const canonicalPayload = canonicalJson(input.payload);
    if (canonicalPayload.length === 0) {
      throw new SourceFingerprintError(
        'canonical fingerprint payload must not be empty',
        { ...input.target, kind },
        ProvErrorCode.PROV_FINGERPRINT_PAYLOAD_NOT_CANONICAL,
      );
    }
    const fingerprintSha256 = sha256Text(canonicalPayload);
    const computedAt = input.computedAt ?? this.clock.now();
    const fingerprintId = `psf:${sha256Text(
      [
        input.target.providerId,
        input.target.operationId,
        input.target.version,
        kind,
        fingerprintSha256,
      ].join('|'),
    )}`;

    const inserted = await this.engine.query<{ seq: number }>(
      `INSERT INTO prov.prov_source_fingerprints (
         fingerprint_id, provider_id, operation_id, operation_version, kind,
         fingerprint_payload_canonical, fingerprint_sha256, computed_at,
         estimator_input_refs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT ON CONSTRAINT prov_source_fingerprints_retry_fenced DO NOTHING
       RETURNING seq`,
      [
        fingerprintId,
        input.target.providerId,
        input.target.operationId,
        input.target.version,
        kind,
        canonicalPayload,
        fingerprintSha256,
        computedAt,
        JSON.stringify([...(input.estimatorInputRefs ?? [])]),
      ],
    );
    return {
      fingerprintId,
      kind,
      canonicalPayload,
      fingerprintSha256,
      computedAt: iso(computedAt),
      created: inserted.rows.length === 1,
    };
  }

  /** All recorded fingerprints for one operation version, newest first. */
  async list(target: OperationTarget): Promise<
    {
      fingerprintId: string;
      kind: ProviderFingerprintKind;
      canonicalPayload: string;
      fingerprintSha256: string;
      computedAt: string;
    }[]
  > {
    const rows = await this.engine.query<FingerprintRow>(
      `SELECT fingerprint_id, kind, fingerprint_payload_canonical,
              fingerprint_sha256, computed_at
       FROM prov.prov_source_fingerprints
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
       ORDER BY computed_at DESC, fingerprint_id`,
      [target.providerId, target.operationId, target.version],
    );
    return rows.rows.map((row) => ({
      fingerprintId: row.fingerprint_id,
      kind: ProviderFingerprintKindSchema.parse(row.kind),
      canonicalPayload: row.fingerprint_payload_canonical,
      fingerprintSha256: row.fingerprint_sha256,
      computedAt: iso(row.computed_at),
    }));
  }
}

/** The six kinds, exported for estimator wiring and tests. */
export { PROVIDER_FINGERPRINT_KINDS };
