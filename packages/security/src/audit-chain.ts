/**
 * Append-only hash-chained audit with continuous verification (FR-SEC-002,
 * §35.9, ADR-056; AC-259).
 *
 * Chain math: `entry_hash = sha256(prev_entry_hash || canonical_payload)`
 * where the payload is THE canonical JSON of this repository (single
 * serializer, key-sorted, byte-stable). The first entry chains from
 * `'GENESIS'`. Appends are fenced: head selection happens inside a
 * transaction guarded by a transaction-scope advisory lock PLUS `FOR UPDATE`
 * on the head row, so two concurrent appends cannot both claim the same
 * predecessor — including at genesis, where no row exists to lock
 * (INV-009 fencing).
 *
 * Checkpoints are periodic batch anchors written BOTH to SQL truth and
 * through the ObjectStoreAdapter (plan material decision 5) so verification
 * has an independently located, hash-verifiable copy outside the database
 * failure domain. Checkpoint rows and event rows are append-only in SQL
 * (immutability triggers raise messages prefixed AUDIT_IMMUTABLE).
 *
 * The verifier walks a range and classifies the FIRST divergence:
 *   DELETION   — a seq discontinuity (rows removed)
 *   MUTATION   — stored hashes no longer match recomputed content
 *   REORDERING — an entry's predecessor hash exists but not at its side
 *   CHAIN_BREAK— an entry's predecessor hash matches nothing on the chain
 *   GAP        — an explicitly requested range contains no rows at all
 * Every failed run is recorded in sec_audit_verify_runs; `verifyOrRaise`
 * couples failure to opening the critical incident (§35.9 block rule).
 */
import { canonicalJson, sha256Text } from '@foresift/persistence';
import { randomUUID } from 'node:crypto';
import type { ObjectStoreAdapter } from '@foresift/object-store';
import {
  AuditEventRecordSchema,
  type AuditActionClass,
  type AuditCheckpointRecord,
  type AuditEventRecord,
  type AuditVerifyRunRecord,
} from '@foresift/shared-schemas';
import type { UtcTimestamp } from '@foresift/domain';
import { AuditChainError, SecErrorCode } from './errors.ts';

export interface AuditAppendInput {
  readonly occurredAt: UtcTimestamp;
  readonly actor: string;
  readonly actionClass: AuditActionClass;
  readonly subject: string;
  /** Structured payload; hashed as THIS repository's canonical JSON. */
  readonly payload: Record<string, unknown>;
}

interface HeadRow {
  seq: string | number;
  entry_hash: string;
}

function toEntryHash(prevEntryHash: string, canonicalPayload: string): string {
  return sha256Text(`${prevEntryHash}${canonicalPayload}`);
}

export interface VerifyOutcome {
  readonly run: AuditVerifyRunRecord;
}

export interface AuditChainOptions {
  /** Persistence engine over a database with the g0_sec migrations applied. */
  readonly engine: import('@foresift/persistence').DatabaseEngine;
  /**
   * Independently verifiable checkpoint location (ADR-003 object store).
   * Optional only because verification can run without it; checkpointing
   * REQUIRES it.
   */
  readonly objectStore?: ObjectStoreAdapter;
}

const CHECKPOINT_RETENTION_CLASS = 'AUDIT_CHECKPOINT_PERMANENT';

/**
 * Transaction-scope advisory lock serializing chain appends AND checkpoint
 * anchoring (INV-009 fencing). The row-level `FOR UPDATE` head lock alone
 * does not hold under READ COMMITTED: `LockRows` sits above `Limit`, so a
 * blocked appender resumes with its ORIGINAL statement snapshot and can
 * never re-fetch a competing entry committed after it started (EvalPlanQual
 * re-fetch needs an updatable row; the immutability triggers make these rows
 * un-updatable) — and at genesis there is NO row to lock at all, so two
 * entries could both claim `'GENESIS'` and fork the chain permanently. The
 * advisory key makes predecessor selection linearizable instead. Value is an
 * arbitrary namespaced constant ('FSEC' + slot 1); only stability matters.
 */
const SEC_AUDIT_APPEND_LOCK_KEY = 0x4653454300000001n;

export class AuditChain {
  private readonly engine: import('@foresift/persistence').DatabaseEngine;
  private readonly objectStore: ObjectStoreAdapter | undefined;

  constructor(options: AuditChainOptions) {
    this.engine = options.engine;
    this.objectStore = options.objectStore;
  }

  /**
   * Append one entry. Fenced against concurrent appends by the transaction
   * advisory lock PLUS the head-row lock inside the append transaction; SQL
   * immutability triggers make every committed entry permanent.
   */
  async append(input: AuditAppendInput): Promise<AuditEventRecord> {
    const payloadCanonical = canonicalJson(input.payload);
    const payloadSha256 = sha256Text(payloadCanonical);

    return this.engine.transaction(async (tx) => {
      // Serialize predecessor selection BEFORE reading head — the row lock
      // alone cannot fence an INSERT-only chain (see SEC_AUDIT_APPEND_LOCK_KEY).
      await tx.query('SELECT pg_advisory_xact_lock($1)', [SEC_AUDIT_APPEND_LOCK_KEY]);
      const head = await tx.query<HeadRow>(
        'SELECT seq, entry_hash FROM sec.sec_audit_events ORDER BY seq DESC LIMIT 1 FOR UPDATE',
      );
      const prevEntryHash = head.rows[0]?.entry_hash ?? 'GENESIS';
      const entryHash = toEntryHash(prevEntryHash, payloadCanonical);
      const inserted = await tx.query<{
        seq: string;
        occurred_at: Date | string;
        actor: string;
        action_class: string;
        subject: string;
        payload_canonical: string;
        payload_sha256: string;
        prev_entry_hash: string;
        entry_hash: string;
      }>(
        `INSERT INTO sec.sec_audit_events
           (occurred_at, actor, action_class, subject, payload_canonical,
            payload_sha256, prev_entry_hash, entry_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING seq, occurred_at, actor, action_class, subject,
                   payload_canonical, payload_sha256, prev_entry_hash, entry_hash`,
        [
          input.occurredAt,
          input.actor,
          input.actionClass,
          input.subject,
          payloadCanonical,
          payloadSha256,
          prevEntryHash,
          entryHash,
        ],
      );
      const row = inserted.rows[0];
      if (row === undefined) {
        throw new AuditChainError('append returned no row', {});
      }
      return AuditEventRecordSchema.parse({
        seq: Number(row.seq),
        occurredAt: normalizeInstant(row.occurred_at),
        actor: row.actor,
        actionClass: row.action_class,
        subject: row.subject,
        payloadCanonical: row.payload_canonical,
        payloadSha256: row.payload_sha256,
        prevEntryHash: row.prev_entry_hash,
        entryHash: row.entry_hash,
      });
    });
  }

  /**
   * Checkpoint the closed batch [fromSeq, toSeq]: write the chained anchor to
   * SQL AND mirror a verifiable copy through the object store. Refuses when
   * no object store is wired — an unverifiable checkpoint is not a checkpoint.
   */
  async checkpointBatch(
    fromSeq: number,
    toSeq: number,
    storedAt: UtcTimestamp,
  ): Promise<AuditCheckpointRecord> {
    if (this.objectStore === undefined) {
      throw new AuditChainError(
        'checkpointing requires an independently verifiable object-store location',
        {},
      );
    }
    if (!Number.isInteger(fromSeq) || !Number.isInteger(toSeq) || fromSeq > toSeq || fromSeq < 1) {
      throw new AuditChainError('checkpoint range must be ascending positive integers', {
        fromSeq,
        toSeq,
      });
    }
    return this.engine.transaction(async (tx) => {
      // Same fence as append(): two concurrent checkpoints must not both
      // claim the same prevCheckpointHash predecessor.
      await tx.query('SELECT pg_advisory_xact_lock($1)', [SEC_AUDIT_APPEND_LOCK_KEY]);
      const entries = await tx.query<{ seq: string; entry_hash: string }>(
        `SELECT seq, entry_hash FROM sec.sec_audit_events
         WHERE seq BETWEEN $1 AND $2 ORDER BY seq`,
        [fromSeq, toSeq],
      );
      if (entries.rows.length !== toSeq - fromSeq + 1) {
        throw new AuditChainError('checkpoint range does not cover a contiguous entry set', {
          fromSeq,
          toSeq,
          found: entries.rows.length,
        });
      }
      const chainHeadHash = entries.rows[entries.rows.length - 1]?.entry_hash ?? '';
      if (!/^sha256:[0-9a-f]{64}$/.test(chainHeadHash)) {
        throw new AuditChainError('chain head hash missing for checkpoint range', {
          fromSeq,
          toSeq,
        });
      }
      const prior = await tx.query<{ checkpoint_hash: string }>(
        `SELECT checkpoint_hash FROM sec.sec_audit_checkpoints
         ORDER BY to_seq DESC LIMIT 1`,
      );
      const prevCheckpointHash = prior.rows[0]?.checkpoint_hash ?? 'GENESIS';
      const checkpointHash = toEntryHash(prevCheckpointHash, chainHeadHash);

      // Independent copy: the full hash ledger of the batch, verifiable
      // WITHOUT the database (ADR-003 staged object store).
      const mirrorBytes = new TextEncoder().encode(
        canonicalJson({
          fromSeq,
          toSeq,
          chainHeadHash,
          prevCheckpointHash,
          checkpointHash,
          entryHashes: entries.rows.map((r) => r.entry_hash),
        }),
      );
      await this.objectStore?.put({
        artifactId: `audit-checkpoint-${fromSeq}-${toSeq}`,
        bytes: mirrorBytes,
        metadata: {
          contentType: 'application/json',
          compression: 'NONE',
          encryptionStatus: 'PLAINTEXT',
          retentionClass: CHECKPOINT_RETENTION_CLASS,
        },
      });

      const inserted = await tx.query<{ checkpoint_id: string }>(
        `INSERT INTO sec.sec_audit_checkpoints
           (checkpoint_id, from_seq, to_seq, chain_head_hash, prev_checkpoint_hash,
            checkpoint_hash, batch_signature, stored_at, object_ref)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)
         RETURNING checkpoint_id`,
        [
          `cp-${fromSeq}-${toSeq}`,
          fromSeq,
          toSeq,
          chainHeadHash,
          prevCheckpointHash,
          checkpointHash,
          storedAt,
          `sha256:${chainHeadHash.slice('sha256:'.length)}`,
        ],
      );
      if (inserted.rows.length !== 1) {
        throw new AuditChainError('checkpoint insert returned no row', { fromSeq, toSeq });
      }
      return {
        checkpointId: inserted.rows[0]!.checkpoint_id,
        fromSeq,
        toSeq,
        chainHeadHash,
        prevCheckpointHash,
        checkpointHash,
        signature: null,
        storedAt,
        objectRef: chainHeadHash,
      };
    });
  }

  /**
   * Continuous verification over [fromSeq?, toSeq?] (default: everything).
   * Records the run in sec_audit_verify_runs and returns the outcome.
   *
   * Fail-closed rules (M2): an EXPLICIT range containing no rows is a GAP;
   * a full-range request over an EMPTY chain is also a GAP — an unexamined
   * or wiped chain never reports health; inverted/non-integer arguments are
   * input errors refused before any query. The recorded run names the ACTUAL
   * walked bounds, never fabricated provenance.
   */
  async verifyRange(fromSeq?: number, toSeq?: number): Promise<VerifyOutcome> {
    if (
      (fromSeq !== undefined && (!Number.isInteger(fromSeq) || fromSeq < 1)) ||
      (toSeq !== undefined && (!Number.isInteger(toSeq) || toSeq < 1))
    ) {
      throw new AuditChainError('verify range must be positive integers', {
        fromSeq: fromSeq ?? -1,
        toSeq: toSeq ?? -1,
      });
    }
    if (fromSeq !== undefined && toSeq !== undefined && fromSeq > toSeq) {
      throw new AuditChainError('verify range must be ascending', { fromSeq, toSeq });
    }
    const outcome = this.engine.transaction(async (tx) => {
      const bounds = await tx.query<{ min: string | null; max: string | null }>(
        'SELECT min(seq)::text AS min, max(seq)::text AS max FROM sec.sec_audit_events',
      );
      const chainMin = bounds.rows[0]?.min === null ? undefined : Number(bounds.rows[0]?.min);
      const chainMax = bounds.rows[0]?.max === null ? undefined : Number(bounds.rows[0]?.max);
      // Full-range request over an empty chain: nothing was verifiable — GAP,
      // never OK (a wiped chain must not attest its own health).
      if (chainMin === undefined || chainMax === undefined) {
        return {
          verdict: 'FAILED' as const,
          kind: 'GAP' as const,
          firstDivergenceSeq: fromSeq ?? 1,
          walkedLo: fromSeq ?? 1,
          walkedHi: toSeq ?? 1,
        };
      }
      const lo = fromSeq ?? chainMin;
      const hi = toSeq ?? chainMax;
      // A window past the end of the chain (partial explicit args) verifies
      // nothing — an unexamined span is a GAP, never OK.
      if (lo > hi) {
        return {
          verdict: 'FAILED' as const,
          kind: 'GAP' as const,
          firstDivergenceSeq: lo,
          walkedLo: lo,
          walkedHi: lo,
        };
      }
      const rows = await tx.query<{
        seq: string;
        payload_canonical: string;
        payload_sha256: string;
        prev_entry_hash: string;
        entry_hash: string;
      }>(
        `SELECT seq, payload_canonical, payload_sha256, prev_entry_hash, entry_hash
         FROM sec.sec_audit_events WHERE seq BETWEEN $1 AND $2 ORDER BY seq`,
        [lo, hi],
      );
      const classification = await classifyRange(tx, lo, hi, rows.rows.map(rowToChainEntry));
      return { ...classification, walkedLo: lo, walkedHi: hi };
    });

    const { verdict, kind, firstDivergenceSeq, walkedLo, walkedHi } = await outcome;
    const ranAt = new Date().toISOString().replace('.000Z', 'Z') as UtcTimestamp;
    // House style: randomUUID from node:crypto — no Math.random downgrade path.
    const runId = `vr-${randomUUID()}`;
    const record: AuditVerifyRunRecord = {
      runId,
      verifiedFromSeq: walkedLo,
      verifiedToSeq: Math.max(walkedHi, walkedLo),
      verdict,
      firstDivergenceSeq: firstDivergenceSeq ?? null,
      divergenceKind: kind ?? null,
      ranAt,
    };
    await this.engine.query(
      `INSERT INTO sec.sec_audit_verify_runs
         (run_id, verified_from_seq, verified_to_seq, verdict, first_divergence_seq,
          divergence_kind, ran_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        record.runId,
        record.verifiedFromSeq,
        record.verifiedToSeq,
        record.verdict,
        record.firstDivergenceSeq,
        record.divergenceKind,
        record.ranAt,
      ],
    );
    return { run: record };
  }

  /**
   * Verify and REFUSE (fail-closed) on any divergence — the coupling point
   * §35.9 requires: callers wire the raised error to opening the critical
   * incident that blocks high-impact activation.
   */
  async verifyOrRaise(fromSeq?: number, toSeq?: number): Promise<VerifyOutcome> {
    const outcome = await this.verifyRange(fromSeq, toSeq);
    if (outcome.run.verdict === 'FAILED') {
      throw new AuditChainError(
        `audit chain ${outcome.run.divergenceKind} detected at seq ${outcome.run.firstDivergenceSeq}`,
        {
          divergenceKind: outcome.run.divergenceKind ?? '',
          firstDivergenceSeq: outcome.run.firstDivergenceSeq ?? -1,
        },
        SecErrorCode.SEC_AUDIT_CHAIN_VERIFICATION_FAILED,
      );
    }
    return outcome;
  }
}

interface ChainEntry {
  seq: number;
  payloadCanonical: string;
  payloadSha256: string;
  prevEntryHash: string;
  entryHash: string;
}

function rowToChainEntry(row: {
  seq: string;
  payload_canonical: string;
  payload_sha256: string;
  prev_entry_hash: string;
  entry_hash: string;
}): ChainEntry {
  return {
    seq: Number(row.seq),
    payloadCanonical: row.payload_canonical,
    payloadSha256: row.payload_sha256,
    prevEntryHash: row.prev_entry_hash,
    entryHash: row.entry_hash,
  };
}

type Tx = Pick<import('@foresift/persistence').DatabaseEngine, 'query'>;

async function classifyRange(
  tx: Tx,
  lo: number,
  hi: number,
  entries: readonly ChainEntry[],
): Promise<{
  verdict: 'OK' | 'FAILED';
  kind: AuditVerifyRunRecord['divergenceKind'];
  firstDivergenceSeq: number | null;
}> {
  if (lo <= hi && entries.length === 0) {
    return { verdict: 'FAILED', kind: 'GAP', firstDivergenceSeq: lo };
  }
  const knownHashes = new Set(entries.map((e) => e.entryHash));
  // Positional expectation starts at the REQUESTED window start — so a
  // leading-edge deletion inside an explicit range surfaces as a seq
  // discontinuity (DELETION), not as a confusing hash-link verdict.
  let expectedSeq = lo;
  let prevHash = 'GENESIS';
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    if (i === 0 && lo > 1) {
      // Continuing a chain: seed the expected predecessor from the prior row.
      const priorRow = await tx.query<{ entry_hash: string }>(
        'SELECT entry_hash FROM sec.sec_audit_events WHERE seq = $1',
        [lo - 1],
      );
      const prior = priorRow.rows[0];
      if (prior === undefined) {
        // The earliest present entry's predecessor is itself missing — that
        // is a DELETION at the window edge, not a broken hash link.
        return { verdict: 'FAILED', kind: 'DELETION', firstDivergenceSeq: lo - 1 };
      }
      prevHash = prior.entry_hash;
    }
    if (entry.seq !== expectedSeq) {
      return { verdict: 'FAILED', kind: 'DELETION', firstDivergenceSeq: expectedSeq };
    }
    const recomputedPayload = sha256Text(entry.payloadCanonical);
    const recomputedEntry = toEntryHash(entry.prevEntryHash, entry.payloadCanonical);
    if (recomputedPayload !== entry.payloadSha256 || recomputedEntry !== entry.entryHash) {
      return { verdict: 'FAILED', kind: 'MUTATION', firstDivergenceSeq: entry.seq };
    }
    if (entry.prevEntryHash !== prevHash) {
      const reordering = entry.prevEntryHash !== 'GENESIS' && knownHashes.has(entry.prevEntryHash);
      return {
        verdict: 'FAILED',
        kind: reordering ? 'REORDERING' : 'CHAIN_BREAK',
        firstDivergenceSeq: entry.seq,
      };
    }
    prevHash = entry.entryHash;
    expectedSeq += 1;
  }
  return { verdict: 'OK', kind: null, firstDivergenceSeq: null };
}

/** Normalize driver timestamp shapes into the ISO-8601 UTC string form. */
function normalizeInstant(value: Date | string): UtcTimestamp {
  if (typeof value === 'string') return value as UtcTimestamp;
  return value.toISOString().replace('.000Z', 'Z') as UtcTimestamp;
}
