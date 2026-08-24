/**
 * Observations repository (FR-DATA-002): append-only writes, revision chains,
 * and reorg/finality compensating events that preserve the original receipt
 * hash. The database refuses mutation of originals; every correction here is
 * a NEW row.
 *
 * Receipt hashes are content addresses over the flattened stored columns
 * (recursively key-sorted canonical JSON), so "originals survive byte-for-byte"
 * is checkable against the row itself, not a narrative.
 */
import { ErrorCode, ForesiftError, type UtcTimestamp } from '@foresift/domain';
import { availabilityProvenanceClass, qualityCode, utcTimestamp } from '@foresift/domain';
import { canonicalJson, sha256Text } from '../canonical-json.ts';
import type { DatabaseEngine } from '../db.ts';

export interface ObservationInput {
  readonly observationId: string;
  readonly subjectPoolId?: string;
  readonly subjectAssetId?: string;
  readonly eventAt: UtcTimestamp;
  readonly availableAt: UtcTimestamp;
  readonly sourceObservedAt?: UtcTimestamp;
  readonly sourcePublishedAt?: UtcTimestamp;
  readonly authorizedAt?: UtcTimestamp;
  readonly requestedAt?: UtcTimestamp;
  readonly fetchedAt?: UtcTimestamp;
  readonly ingestedAt?: UtcTimestamp;
  readonly finalizedAt?: UtcTimestamp;
  readonly revisedAt?: UtcTimestamp;
  readonly availabilityProvenance: string;
  /** Raw integer amount as decimal digits, with its decimals — or absent. */
  readonly rawAmount?: string;
  readonly decimals?: number;
  readonly coordinates?: ChainCoordinatesColumns | undefined;
  readonly qualityCodes?: readonly QualityCodeInput[];
}

/** Minimal structural shape so callers need not import domain brands. */
export type QualityCodeInput = string;

export interface ChainCoordinatesColumns {
  readonly chainId: string;
  readonly blockNumberOrSlot?: string | null;
  readonly blockHash?: string | null;
  readonly parentBlockHashOrParentSlot?: string | null;
  readonly transactionHash?: string | null;
  readonly transactionIndex?: number | null;
  readonly instructionIndex?: number | null;
  readonly innerInstructionIndex?: number | null;
  readonly confirmationLevel: string;
  readonly reorgVersion?: number;
  readonly collectorOrProviderCursor?: string | null;
}

/** Stable content address over the record (sorted-key canonical JSON). */
export function receiptHashOf(record: Record<string, unknown>): string {
  return sha256Text(canonicalJson(record));
}

/**
 * The exact flattened projection that lands in the observations table — this
 * (plus the observation id) is what the receipt hash commits to.
 */
function storedProjection(input: ObservationInput): Record<string, unknown> {
  const c = input.coordinates;
  return {
    subjectPoolId: input.subjectPoolId ?? null,
    subjectAssetId: input.subjectAssetId ?? null,
    eventAt: input.eventAt,
    availableAt: input.availableAt,
    sourceObservedAt: input.sourceObservedAt ?? null,
    sourcePublishedAt: input.sourcePublishedAt ?? null,
    authorizedAt: input.authorizedAt ?? null,
    requestedAt: input.requestedAt ?? null,
    fetchedAt: input.fetchedAt ?? null,
    ingestedAt: input.ingestedAt ?? null,
    finalizedAt: input.finalizedAt ?? null,
    revisedAt: input.revisedAt ?? null,
    availabilityProvenance: availabilityProvenanceClass(input.availabilityProvenance),
    rawAmount: input.rawAmount ?? null,
    decimals: input.decimals ?? null,
    coordinatesChainId: c?.chainId ?? null,
    blockNumberOrSlot: c?.blockNumberOrSlot ?? null,
    blockHash: c?.blockHash ?? null,
    parentBlockHashOrParentSlot: c?.parentBlockHashOrParentSlot ?? null,
    transactionHash: c?.transactionHash ?? null,
    transactionIndex: c?.transactionIndex ?? null,
    instructionIndex: c?.instructionIndex ?? null,
    innerInstructionIndex: c?.innerInstructionIndex ?? null,
    confirmationLevel: c?.confirmationLevel ?? null,
    reorgVersion: c?.reorgVersion ?? 0,
    collectorOrProviderCursor: c?.collectorOrProviderCursor ?? null,
    qualityCodes: (input.qualityCodes ?? []).map((code) => qualityCode(code)),
  };
}

const PROJECTION_COLUMNS: Record<string, string> = {
  subjectPoolId: 'subject_pool_id',
  subjectAssetId: 'subject_asset_id',
  eventAt: 'event_at',
  availableAt: 'available_at',
  sourceObservedAt: 'source_observed_at',
  sourcePublishedAt: 'source_published_at',
  authorizedAt: 'authorized_at',
  requestedAt: 'requested_at',
  fetchedAt: 'fetched_at',
  ingestedAt: 'ingested_at',
  finalizedAt: 'finalized_at',
  revisedAt: 'revised_at',
  availabilityProvenance: 'availability_provenance',
  rawAmount: 'raw_amount',
  decimals: 'decimals',
  coordinatesChainId: 'coordinates_chain_id',
  blockNumberOrSlot: 'block_number_or_slot',
  blockHash: 'block_hash',
  parentBlockHashOrParentSlot: 'parent_block_hash_or_parent_slot',
  transactionHash: 'transaction_hash',
  transactionIndex: 'transaction_index',
  instructionIndex: 'instruction_index',
  innerInstructionIndex: 'inner_instruction_index',
  confirmationLevel: 'confirmation_level',
  reorgVersion: 'reorg_version',
  collectorOrProviderCursor: 'collector_or_provider_cursor',
  qualityCodes: 'quality_codes',
};

export async function appendObservation(
  engine: DatabaseEngine,
  input: ObservationInput,
): Promise<{ receiptHash: string }> {
  const record = storedProjection(input);
  const receiptHash = receiptHashOf({ observationId: input.observationId, ...record });
  const columns = Object.keys(PROJECTION_COLUMNS);
  const placeholders = columns.map((_, i) => `$${i + 2}`).join(',');
  await engine.query(
    `INSERT INTO observations (
       observation_id, ${columns.map((k) => PROJECTION_COLUMNS[k]).join(',')}, receipt_hash)
     VALUES ($1,${placeholders},$${columns.length + 2})`,
    [input.observationId, ...columns.map((k) => record[k]), receiptHash],
  );
  return { receiptHash };
}

export interface RevisionInput {
  readonly revisionId: string;
  readonly observationId: string;
  readonly reason: string;
  readonly availableAt: UtcTimestamp;
  readonly availabilityProvenance: string;
  readonly rawAmount?: string;
  readonly decimals?: number;
  readonly qualityCodes?: readonly QualityCodeInput[];
}

/**
 * Provider correction: a NEW revision row whose superseded_receipt_hash is the
 * original observation's receipt (the immutable anchor being corrected; chain
 * order is revision_no). Originals never change.
 */
export async function appendRevision(
  engine: DatabaseEngine,
  input: RevisionInput,
): Promise<{ revisionNo: number; supersededReceiptHash: string }> {
  await engine.transaction(async (tx) => {
    const current = await tx.query<{ receipt_hash: string }>(
      `SELECT receipt_hash FROM observations WHERE observation_id = $1`,
      [input.observationId],
    );
    const baseHash = current.rows[0]?.receipt_hash;
    if (baseHash === undefined) {
      throw new ForesiftError(
        ErrorCode.REVISION_SUPERSEDES_UNKNOWN,
        `cannot revise unknown observation ${input.observationId}`,
        { observationId: input.observationId },
      );
    }

    const maxRow = await tx.query<{ max_no: number | null }>(
      `SELECT MAX(revision_no) AS max_no FROM observation_revisions WHERE observation_id = $1`,
      [input.observationId],
    );
    const nextNo = (maxRow.rows[0]?.max_no ?? 0) + 1;

    await tx.query(
      `INSERT INTO observation_revisions (
         revision_id, observation_id, revision_no, reason, available_at,
         availability_provenance, superseded_receipt_hash, raw_amount, decimals, quality_codes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.revisionId,
        input.observationId,
        nextNo,
        input.reason,
        input.availableAt,
        availabilityProvenanceClass(input.availabilityProvenance),
        baseHash,
        input.rawAmount ?? null,
        input.decimals ?? null,
        (input.qualityCodes ?? []).map((code) => qualityCode(code)),
      ],
    );
  });
  const no = await engine.query<{ revision_no: number; superseded_receipt_hash: string }>(
    `SELECT revision_no, superseded_receipt_hash FROM observation_revisions
     WHERE revision_id = $1`,
    [input.revisionId],
  );
  const row = no.rows[0];
  if (row === undefined) throw new Error('revision vanished after insert');
  return {
    revisionNo: Number(row.revision_no),
    supersededReceiptHash: row.superseded_receipt_hash,
  };
}

export async function appendCompensatingEvent(
  engine: DatabaseEngine,
  input: {
    compensationId: string;
    targetObservationId: string;
    kind: 'REORG_SUPERSEDING' | 'FINALITY_CORRECTION';
    availableAt: UtcTimestamp;
  },
): Promise<{ originalReceiptHash: string }> {
  const current = await engine.query<{ receipt_hash: string }>(
    `SELECT receipt_hash FROM observations WHERE observation_id = $1`,
    [input.targetObservationId],
  );
  const originalReceiptHash = current.rows[0]?.receipt_hash;
  if (originalReceiptHash === undefined) {
    throw new ForesiftError(
      ErrorCode.REORG_COMPENSATION_INVALID,
      `cannot compensate unknown observation ${input.targetObservationId}`,
      { targetObservationId: input.targetObservationId },
    );
  }
  await engine.query(
    `INSERT INTO compensating_events
       (compensation_id, target_observation_id, kind, original_receipt_hash, available_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.compensationId,
      input.targetObservationId,
      input.kind,
      originalReceiptHash,
      input.availableAt,
    ],
  );
  return { originalReceiptHash };
}

export interface StoredObservation {
  readonly observationId: string;
  readonly subjectPoolId: string | null;
  readonly subjectAssetId: string | null;
  readonly eventAt: string;
  readonly availableAt: string;
  readonly sourceObservedAt: string | null;
  readonly sourcePublishedAt: string | null;
  readonly authorizedAt: string | null;
  readonly requestedAt: string | null;
  readonly fetchedAt: string | null;
  readonly ingestedAt: string | null;
  readonly finalizedAt: string | null;
  readonly revisedAt: string | null;
  readonly availabilityProvenance: string;
  readonly rawAmount: string | null;
  readonly decimals: number | null;
  readonly coordinatesChainId: string | null;
  readonly blockNumberOrSlot: string | null;
  readonly blockHash: string | null;
  readonly parentBlockHashOrParentSlot: string | null;
  readonly transactionHash: string | null;
  readonly transactionIndex: number | null;
  readonly instructionIndex: number | null;
  readonly innerInstructionIndex: number | null;
  readonly confirmationLevel: string | null;
  readonly reorgVersion: number;
  readonly collectorOrProviderCursor: string | null;
  readonly qualityCodes: readonly string[];
  readonly receiptHash: string;
}

type Cell = unknown;

function isoOrNull(value: Cell): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value as Date | string);
}

function numOrNull(value: Cell): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function strOrNull(value: Cell): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

/** Full row projection — everything needed to recompute the receipt hash. */
export async function loadObservation(
  engine: DatabaseEngine,
  observationId: string,
): Promise<StoredObservation | null> {
  const rows = await engine.query<Record<string, Cell>>(
    `SELECT * FROM observations WHERE observation_id = $1`,
    [observationId],
  );
  const r = rows.rows[0];
  if (r === undefined) return null;
  return {
    observationId: String(r.observation_id),
    subjectPoolId: strOrNull(r.subject_pool_id),
    subjectAssetId: strOrNull(r.subject_asset_id),
    eventAt: isoOrNull(r.event_at) ?? '',
    availableAt: isoOrNull(r.available_at) ?? '',
    sourceObservedAt: isoOrNull(r.source_observed_at),
    sourcePublishedAt: isoOrNull(r.source_published_at),
    authorizedAt: isoOrNull(r.authorized_at),
    requestedAt: isoOrNull(r.requested_at),
    fetchedAt: isoOrNull(r.fetched_at),
    ingestedAt: isoOrNull(r.ingested_at),
    finalizedAt: isoOrNull(r.finalized_at),
    revisedAt: isoOrNull(r.revised_at),
    availabilityProvenance: String(r.availability_provenance),
    rawAmount: strOrNull(r.raw_amount),
    decimals: numOrNull(r.decimals),
    coordinatesChainId: strOrNull(r.coordinates_chain_id),
    blockNumberOrSlot: strOrNull(r.block_number_or_slot),
    blockHash: strOrNull(r.block_hash),
    parentBlockHashOrParentSlot: strOrNull(r.parent_block_hash_or_parent_slot),
    transactionHash: strOrNull(r.transaction_hash),
    transactionIndex: numOrNull(r.transaction_index),
    instructionIndex: numOrNull(r.instruction_index),
    innerInstructionIndex: numOrNull(r.inner_instruction_index),
    confirmationLevel: strOrNull(r.confirmation_level),
    reorgVersion: Number(r.reorg_version ?? 0),
    collectorOrProviderCursor: strOrNull(r.collector_or_provider_cursor),
    qualityCodes: Array.isArray(r.quality_codes) ? r.quality_codes.map(String) : [],
    receiptHash: String(r.receipt_hash),
  };
}

function toIso(value: Date | string): string {
  if (typeof value === 'string') return value;
  return value.toISOString().replace('.000Z', 'Z');
}

export function asUtc(value: Date | string): UtcTimestamp {
  return utcTimestamp(toIso(value));
}
