/**
 * Response quarantine — the five malicious-response classes (FR-PROV-008,
 * AC-271; T119).
 *
 * A provider response containing transaction payloads, signing requests,
 * executable instructions, private-key fields, or unexpected write
 * capability is REJECTED, QUARANTINED, AUDITED, and EXCLUDED from model
 * context. Detection is deterministic field/value scanning; quarantine is
 * METADATA-ONLY by construction (the prov_response_quarantine table has no
 * payload column), the audit bridge carries classes and hashes only, and
 * the envelope gate refuses quarantined material from EVER entering an
 * untrusted-content model-context envelope.
 */
import type { DatabaseEngine } from '@foresift/persistence';
import { sha256Text } from '@foresift/persistence';
import type { ClockPort } from '@foresift/domain';
import { QuarantineClassSchema, type QuarantineClass } from './vocabulary.ts';
import { ProvErrorCode, ResponseQuarantineError } from './errors.ts';
import { ResponseQuarantineAuditBridge } from './audit-bridges.ts';
import type { AuditChain } from '@foresift/security';
import type { OperationTarget } from './lifecycle-machine.ts';

export interface QuarantineDetection {
  readonly detectedClass: QuarantineClass;
  /** JSON field paths (or `<text>` markers) that triggered detection. */
  readonly fieldPaths: readonly string[];
}

export interface ScanReport {
  readonly clean: boolean;
  readonly detections: readonly QuarantineDetection[];
}

export interface QuarantineRecordInput {
  readonly target: OperationTarget;
  /** The RAW hazardous response body (hashed, never stored). */
  readonly responseBody: string;
  readonly scan: ScanReport;
  readonly details?: string | undefined;
}

export interface QuarantineRecord {
  readonly quarantineId: string;
  readonly payloadSha256: string;
  readonly byteSize: number;
  readonly detectedClasses: readonly QuarantineClass[];
  readonly fieldPaths: readonly string[];
  readonly disposition: 'REJECTED';
  readonly modelContextExclusion: 'ENFORCED';
  readonly auditChainRef: string;
}

// --- Deterministic detection patterns ------------------------------------------

/** Field names that carry ready-to-broadcast transactions. */
const TRANSACTION_PAYLOAD_FIELD =
  /(raw[-_]?transaction|signed[-_]?transaction|swap[-_]?transaction|serialized[-_]?tx|txn[-_]?payload|transaction[-_]?payload)/i;

/** A Solana/JSON transaction skeleton: message + signatures together. */
const TRANSACTION_SKELETON_KEYS = ['message', 'signatures'];

/** Field names requesting a signature. */
const SIGNING_REQUEST_FIELD =
  /(sign[-_]?request|sign[-_]?message|sign[-_]?txn|personal[-_]?sign|eth[-_]?sign|solana[-_]?sign|signing[-_]?request|signing[-_]?instruction)/i;

/** Field names carrying executable content. */
const EXECUTABLE_FIELD = /((?:java)?script|shellcode|wasm|executable[-_]?code|eval[-_]?payload)/i;

/** Field names carrying key material. */
const PRIVATE_KEY_FIELD =
  /(private[-_]?key|secret[-_]?key|seed[-_]?phrase|mnemonic|keystore[-_]?json|wallet[-_]?export)/i;

/** Text markers: PEM private keys and shebang scripts. */
const PRIVATE_KEY_TEXT = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const SHEBANG_TEXT = /^#![^\n]*\n?/;

/** Values inside declared capability/method lists that mean WRITE access. */
const WRITE_CAPABILITY_VALUES = new Set([
  'WRITE',
  'SUBMIT',
  'EXECUTE',
  'SIGN',
  'POST',
  'PUT',
  'DELETE',
  'TRANSACTION_SEND',
]);

function addDetection(
  map: Map<QuarantineClass, Set<string>>,
  cls: QuarantineClass,
  path: string,
): void {
  const bucket = map.get(cls) ?? new Set<string>();
  bucket.add(path);
  map.set(cls, bucket);
}

/**
 * Deterministic recursive scan of a decoded provider response. Field paths
 * are dotted; array members are `[n]`. Raw non-JSON text is scanned with the
 * text-level markers only.
 */
export function scanResponse(responseBody: string): ScanReport {
  const map = new Map<QuarantineClass, Set<string>>();

  if (PRIVATE_KEY_TEXT.test(responseBody)) {
    addDetection(map, 'PRIVATE_KEY_FIELD', '<text>');
  }
  if (SHEBANG_TEXT.test(responseBody)) {
    addDetection(map, 'EXECUTABLE_INSTRUCTION', '<text:shebang>');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody) as unknown;
  } catch {
    parsed = undefined;
  }
  if (parsed !== undefined) {
    const walk = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${String(index)}]`));
        return;
      }
      if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record);
        // Transaction SKELETON: one object carrying BOTH a message and a
        // signatures block (the broadcast-ready shape).
        const lowerKeys = new Set(keys.map((k) => k.toLowerCase()));
        if (TRANSACTION_SKELETON_KEYS.every((k) => lowerKeys.has(k))) {
          addDetection(map, 'TRANSACTION_PAYLOAD', `${path}{message+signatures}`);
        }
        for (const key of keys) {
          const childPath = path.length === 0 ? key : `${path}.${key}`;
          if (TRANSACTION_PAYLOAD_FIELD.test(key)) {
            addDetection(map, 'TRANSACTION_PAYLOAD', childPath);
          }
          if (SIGNING_REQUEST_FIELD.test(key)) {
            addDetection(map, 'SIGNING_REQUEST', childPath);
          }
          if (EXECUTABLE_FIELD.test(key)) {
            addDetection(map, 'EXECUTABLE_INSTRUCTION', childPath);
          }
          if (PRIVATE_KEY_FIELD.test(key)) {
            addDetection(map, 'PRIVATE_KEY_FIELD', childPath);
          }
          // Unexpected write capability: capability/method lists advertising
          // write-side verbs on a read-only integration.
          if (/capabilit|method|allowed[-_]?operation/i.test(key)) {
            const advertised = record[key];
            if (typeof advertised === 'string') {
              if (WRITE_CAPABILITY_VALUES.has(advertised.toUpperCase())) {
                addDetection(map, 'UNEXPECTED_WRITE_CAPABILITY', childPath);
              }
            } else if (Array.isArray(advertised)) {
              for (const item of advertised) {
                if (typeof item === 'string' && WRITE_CAPABILITY_VALUES.has(item.toUpperCase())) {
                  addDetection(map, 'UNEXPECTED_WRITE_CAPABILITY', childPath);
                }
              }
            }
          }
          walk(record[key], childPath);
        }
      }
    };
    walk(parsed, '');
  }

  const detections: QuarantineDetection[] = [...map.entries()]
    .map(([detectedClass, paths]) => ({
      detectedClass,
      fieldPaths: [...paths].sort(),
    }))
    .sort((a, b) => a.detectedClass.localeCompare(b.detectedClass));

  return { clean: detections.length === 0, detections };
}

/**
 * Transaction-building output fields are STRIPPED before any persistence
 * (FR-PROV-008): this walks a decoded object and removes every key matching
 * the transaction-payload alphabet, returning what was removed.
 */
export function stripTransactionBuildingFields<T>(value: T): {
  stripped: T;
  removedPaths: string[];
} {
  const removed: string[] = [];
  const walk = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) {
      return node.map((item, index) => walk(item, `${path}[${String(index)}]`));
    }
    if (node !== null && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      const output: Record<string, unknown> = {};
      for (const key of Object.keys(record)) {
        const childPath = path.length === 0 ? key : `${path}.${key}`;
        if (TRANSACTION_PAYLOAD_FIELD.test(key)) {
          removed.push(childPath);
          continue;
        }
        output[key] = walk(record[key], childPath);
      }
      return output;
    }
    return node;
  };
  return { stripped: walk(value, '') as T, removedPaths: removed.sort() };
}

export class ResponseQuarantine {
  private readonly engine: DatabaseEngine;
  private readonly clock: ClockPort;
  private readonly audit: ResponseQuarantineAuditBridge | undefined;

  constructor(options: { engine: DatabaseEngine; clock: ClockPort; auditChain?: AuditChain }) {
    this.engine = options.engine;
    this.clock = options.clock;
    this.audit =
      options.auditChain !== undefined
        ? new ResponseQuarantineAuditBridge(options.auditChain)
        : undefined;
  }

  /**
   * Rejects + quarantines one scanned-hazardous response. The record carries
   * detection metadata ONLY; the payload itself is reduced to its sha256.
   * Idempotent: the same body re-quarantines to the SAME record (INV-009).
   */
  async rejectAndQuarantine(input: QuarantineRecordInput): Promise<QuarantineRecord> {
    const classes = [...new Set(input.scan.detections.flatMap((d) => d.detectedClass))].map((c) =>
      QuarantineClassSchema.parse(c),
    );
    if (classes.length === 0) {
      throw new ResponseQuarantineError(
        'refusing to quarantine a response with no detected malicious class',
        { ...input.target },
        ProvErrorCode.PROV_QUARANTINE_RECORD_INVALID,
      );
    }
    const fieldPaths = [...new Set(input.scan.detections.flatMap((d) => [...d.fieldPaths]))].sort();
    const payloadSha256 = sha256Text(input.responseBody);
    const byteSize = Buffer.byteLength(input.responseBody, 'utf8');
    const quarantineId = `prq:${sha256Text(
      [input.target.providerId, input.target.operationId, input.target.version, payloadSha256].join(
        '|',
      ),
    )}`;

    const inserted = await this.engine.query<{ seq: number }>(
      `INSERT INTO prov.prov_response_quarantine (
         quarantine_id, provider_id, operation_id, operation_version,
         detected_classes, field_paths, payload_sha256, byte_size,
         audit_chain_ref, quarantined_at, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (quarantine_id) DO NOTHING
       RETURNING seq`,
      [
        quarantineId,
        input.target.providerId,
        input.target.operationId,
        input.target.version,
        classes.sort(),
        fieldPaths,
        payloadSha256,
        byteSize,
        `audit:${quarantineId}`,
        this.clock.now(),
        input.details ?? null,
      ],
    );
    const created = inserted.rows.length === 1;
    if (created && this.audit !== undefined) {
      await this.audit.responseQuarantined({
        target: input.target,
        quarantineId,
        detectedClasses: classes,
        fieldPaths,
        payloadSha256,
        byteSize,
        quarantinedAt: this.clock.now(),
      });
    }

    return {
      quarantineId,
      payloadSha256,
      byteSize,
      detectedClasses: classes.sort(),
      fieldPaths,
      disposition: 'REJECTED',
      modelContextExclusion: 'ENFORCED',
      auditChainRef: `audit:${quarantineId}`,
    };
  }

  /**
   * The hard-exclusion hook consumed by every model-context assembler:
   * given a response hash, REFUSES envelope creation when that material was
   * ever quarantined. Fail-closed — absence of a row admits; presence never
   * forgives.
   */
  async assertAdmissibleForModelContext(
    target: OperationTarget,
    responseBodySha256: string,
  ): Promise<void> {
    const rows = await this.engine.query<{ quarantine_id: string }>(
      `SELECT quarantine_id FROM prov.prov_response_quarantine
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
         AND payload_sha256 = $4`,
      [target.providerId, target.operationId, target.version, responseBodySha256],
    );
    if (rows.rows.length > 0) {
      throw new ResponseQuarantineError(
        'quarantined response material is HARD-EXCLUDED from model-context envelopes',
        { ...target, quarantinedRecordCount: rows.rows.length },
        ProvErrorCode.PROV_RESPONSE_QUARANTINED,
      );
    }
  }

  /** Quarantine history for one operation version (metadata only). */
  async list(target: OperationTarget): Promise<
    {
      quarantineId: string;
      detectedClasses: string[];
      fieldPaths: string[];
      quarantinedAt: string;
    }[]
  > {
    const rows = await this.engine.query<{
      quarantine_id: string;
      detected_classes: string[];
      field_paths: string[];
      quarantined_at: Date | string;
    }>(
      `SELECT quarantine_id, detected_classes, field_paths, quarantined_at
       FROM prov.prov_response_quarantine
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
       ORDER BY quarantined_at`,
      [target.providerId, target.operationId, target.version],
    );
    return rows.rows.map((r) => ({
      quarantineId: r.quarantine_id,
      detectedClasses: r.detected_classes,
      fieldPaths: r.field_paths,
      quarantinedAt:
        r.quarantined_at instanceof Date ? r.quarantined_at.toISOString() : r.quarantined_at,
    }));
  }
}
