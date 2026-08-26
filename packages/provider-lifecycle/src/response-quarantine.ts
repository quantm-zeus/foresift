/**
 * Response quarantine (FR-PROV-008; AC-271; plan material decision 6).
 *
 * The scanner detects all FIVE malicious-response classes in a parsed
 * provider response:
 *
 *   TRANSACTION_PAYLOAD        — serialized transaction bodies / builder shapes
 *   SIGNING_REQUEST            — requests that the caller sign anything
 *   EXECUTABLE_INSTRUCTION     — encoded program instruction payloads
 *   PRIVATE_KEY_FIELD          — private-key / seed / mnemonic material
 *   WRITE_CAPABILITY           — unexpected write methods/endpoints advertised
 *
 * A rejected response produces a METADATA-ONLY quarantine record (classes,
 * field paths, sha256, byte size, audit reference) — no payload-body column
 * exists anywhere in the storage path, so persisting hazardous material is
 * structurally impossible. Rejections are audited through the security chain
 * bridge and hard-excluded from model-context envelopes via the
 * untrusted-content integration hook (exclusion constant ENFORCED).
 * Transaction-building output fields are stripped before any persistence.
 */
import { canonicalJson, sha256Text } from '@foresift/persistence';
import type { DatabaseEngine } from '@foresift/persistence';
import type { UtcTimestamp } from '@foresift/domain';
import type { OperationRef } from './operation-registry.ts';
import type { QuarantineClass } from './vocabularies.ts';
import { QuarantineError, ProvErrorCode } from './errors.ts';
import type { LifecycleAuditBridge } from './audit-bridges.ts';

export const DETECTOR_VERSION = 'prov-quarantine-1';

export interface ScanFinding {
  readonly detectedClass: QuarantineClass;
  readonly fieldPaths: readonly string[];
}

export interface ScanOutcome {
  readonly clean: boolean;
  readonly findings: readonly ScanFinding[];
}

/** Keys whose presence marks transaction-builder material (§15.8 DEX rule). */
const TRANSACTION_PAYLOAD_KEYS = [
  'swaptransaction',
  'serializedtransaction',
  'serializedtx',
  'rawtransaction',
  'unsignedtransaction',
  'signedtransaction',
  'transactionsignaturerequest',
];

/** Solana-style transaction structural keys (co-occurring = payload body). */
const SOLANA_TX_STRUCTURE_KEYS = new Set([
  'instructions',
  'recentblockhash',
  'feePayer'.toLowerCase(),
  'signatures',
]);

const SIGNING_REQUEST_KEYS = [
  'signtxn',
  'signandsendtxn',
  'signmessage',
  'signpayload',
];

const PRIVATE_KEY_KEY_PATTERN =
  /(private[_-]?key|secret[_-]?key|seed[_-]?phrase|mnemonic|keystore[_-]?json|wallet[_-]?import)/i;

const PRIVATE_KEY_MARKER_PATTERN = /FAKE_PRIVATE_KEY|BEGIN[ ]?(RSA|EC|OPENSSH)?[ ]?PRIVATE[ ]?KEY/i;

const INSTRUCTION_DATA_KEYS = ['instructiondata', 'instruction_data'];

const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/**
 * Deterministic content scanner over parsed JSON. Declarative key/shape rules
 * only — no execution, no interpretation of values beyond classification.
 */
export function scanProviderResponse(value: unknown): ScanOutcome {
  const findings = new Map<QuarantineClass, Set<string>>();
  const add = (cls: QuarantineClass, path: string) => {
    const bucket = findings.get(cls) ?? new Set<string>();
    bucket.add(path);
    findings.set(cls, bucket);
  };

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (node === null || typeof node !== 'object') {
      if (
        typeof node === 'string' &&
        path !== '' &&
        PRIVATE_KEY_MARKER_PATTERN.test(node)
      ) {
        add('PRIVATE_KEY_FIELD', path);
      }
      return;
    }
    const record = node as Record<string, unknown>;
    const lowerKeys = Object.keys(record).map((k) => ({ raw: k, lower: k.toLowerCase() }));

    // TRANSACTION_PAYLOAD: named builder fields…
    for (const { raw, lower } of lowerKeys) {
      if (TRANSACTION_PAYLOAD_KEYS.includes(lower)) add('TRANSACTION_PAYLOAD', `${path}.${raw}`);
    }
    // …or the co-occurring Solana structure (instructions + blockhash/feePayer/signatures).
    const presentLower = new Set(lowerKeys.map(({ lower }) => lower));
    if (
      presentLower.has('instructions') &&
      [...SOLANA_TX_STRUCTURE_KEYS].filter((k) => presentLower.has(k)).length >= 3
    ) {
      add('TRANSACTION_PAYLOAD', `${path}.instructions`);
    }

    // SIGNING_REQUEST: explicit signing verbs or a typed request object.
    for (const { raw, lower } of lowerKeys) {
      if (SIGNING_REQUEST_KEYS.some((k) => lower === k || lower.startsWith(`${k}_`))) {
        add('SIGNING_REQUEST', `${path}.${raw}`);
      }
    }
    if (record['type'] === 'signing_request') add('SIGNING_REQUEST', `${path}.type`);

    // EXECUTABLE_INSTRUCTION: program+accounts+data encoding triple.
    const hasProgramId = presentLower.has('programid');
    const accountsValue = Object.entries(record).find(([k]) => k.toLowerCase() === 'accounts')?.[1];
    const hasAccounts = Array.isArray(accountsValue);
    for (const { raw, lower } of lowerKeys) {
      if (
        INSTRUCTION_DATA_KEYS.includes(lower) ||
        (hasProgramId && hasAccounts && lower === 'data' && typeof record[raw] === 'string')
      ) {
        add('EXECUTABLE_INSTRUCTION', `${path}.${raw}`);
      }
    }

    // PRIVATE_KEY_FIELD: hazardous key names.
    for (const { raw } of lowerKeys) {
      if (PRIVATE_KEY_KEY_PATTERN.test(raw)) add('PRIVATE_KEY_FIELD', `${path}.${raw}`);
    }

    // WRITE_CAPABILITY: advertised write methods/endpoints on a read-only surface.
    for (const { raw, lower } of lowerKeys) {
      const value = record[raw];
      if ((lower === 'writeenabled' || lower === 'canwrite') && value === true) {
        add('WRITE_CAPABILITY', `${path}.${raw}`);
      }
      if (
        (lower === 'allowedmethods' || lower === 'supportedmethods' || lower === 'httpmethods') &&
        Array.isArray(value) &&
        value.some((m) => typeof m === 'string' && WRITE_METHODS.has(m.toUpperCase()))
      ) {
        add('WRITE_CAPABILITY', `${path}.${raw}`);
      }
      if (lower === 'httpmethod' && typeof value === 'string' && WRITE_METHODS.has(value.toUpperCase())) {
        add('WRITE_CAPABILITY', `${path}.${raw}`);
      }
    }

    for (const [raw, child] of Object.entries(record)) {
      walk(child, path === '' ? raw : `${path}.${raw}`);
    }
  };

  walk(value, '');
  return {
    clean: findings.size === 0,
    findings: [...findings.entries()].map(([detectedClass, paths]) => ({
      detectedClass,
      fieldPaths: [...paths].sort(),
    })),
  };
}

/** Transaction-building field names stripped before ANY persistence. */
export const TRANSACTION_BUILDING_FIELD_NAMES = [
  'swapTransaction',
  'serializedTransaction',
  'serializedTx',
  'rawTransaction',
  'unsignedTransaction',
  'signedTransaction',
  'transactions',
] as const;

/** Deep-clone removal of transaction-building output fields (§15.8 DEX rule). */
export function stripTransactionBuildingFields(
  value: unknown,
): { cleaned: unknown; removedPaths: readonly string[] } {
  const removedPaths: string[] = [];
  const clean = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) {
      return node.map((item, i) => clean(item, `${path}[${i}]`));
    }
    if (node === null || typeof node !== 'object') return node;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (
        (TRANSACTION_BUILDING_FIELD_NAMES as readonly string[]).includes(key) ||
        (TRANSACTION_PAYLOAD_KEYS as readonly string[]).includes(key.toLowerCase())
      ) {
        removedPaths.push(path === '' ? key : `${path}.${key}`);
        continue;
      }
      result[key] = clean(child, path === '' ? key : `${path}.${key}`);
    }
    return result;
  };
  return { cleaned: clean(value, ''), removedPaths };
}

export interface QuarantineRecord {
  readonly quarantineId: string;
  readonly detectedClasses: readonly QuarantineClass[];
  readonly fieldPaths: readonly string[];
  readonly payloadSha256: string;
  readonly byteSize: number;
  readonly disposition: 'REJECTED';
  readonly auditEntrySeq: number | null;
}

export class ResponseQuarantine {
  private readonly engine: DatabaseEngine;
  private readonly bridge: LifecycleAuditBridge;

  constructor(engine: DatabaseEngine, bridge: LifecycleAuditBridge) {
    this.engine = engine;
    this.bridge = bridge;
  }

  /**
   * Inspect one provider response. Clean responses pass through; malicious
   * ones are REJECTED, persisted metadata-only, and audited. The refusal is
   * the contract: callers must treat the response as absent.
   */
  async inspectAndRoute(input: {
    readonly ref: OperationRef;
    readonly response: unknown;
    readonly detectedAt: UtcTimestamp;
    readonly actor: string;
    /** Caller-supplied identity; retries reuse it without double rows. */
    readonly idempotencyKey: string;
  }): Promise<{ disposition: 'ACCEPTED' } | { disposition: 'REJECTED'; record: QuarantineRecord }> {
    const outcome = scanProviderResponse(input.response);
    if (outcome.clean) return { disposition: 'ACCEPTED' };

    const canonical = canonicalJson(input.response);
    const payloadSha256 = sha256Text(canonical);
    const byteSize = new TextEncoder().encode(canonical).length;
    const detectedClasses = outcome.findings.map((f) => f.detectedClass);
    const fieldPaths = outcome.findings.flatMap((f) => [...f.fieldPaths]).sort();
    const quarantineId = `q-${input.idempotencyKey}`;

    const existing = await this.engine.query<{
      quarantine_id: string;
      detected_classes: string[];
      field_paths: unknown;
      payload_sha256: string;
      byte_size: number;
      audit_entry_seq: string | null;
    }>(
      'SELECT quarantine_id, detected_classes, field_paths, payload_sha256, byte_size, audit_entry_seq FROM prov.prov_response_quarantine WHERE quarantine_id = $1',
      [quarantineId],
    );
    const prior = existing.rows[0];
    if (prior !== undefined) {
      return {
        disposition: 'REJECTED',
        record: {
          quarantineId: prior.quarantine_id,
          detectedClasses: prior.detected_classes as QuarantineClass[],
          fieldPaths: Array.isArray(prior.field_paths)
            ? (prior.field_paths as string[])
            : [],
          payloadSha256: prior.payload_sha256,
          byteSize: prior.byte_size,
          disposition: 'REJECTED',
          auditEntrySeq: prior.audit_entry_seq === null ? null : Number(prior.audit_entry_seq),
        },
      };
    }

    // Metadata only: classes, paths, hash, size. The canonical text above is
    // used for hashing and then dropped — it is NEVER bound to a parameter.
    const auditEntry = await this.bridge.recordQuarantine({
      detectedAt: input.detectedAt,
      actor: input.actor,
      ref: input.ref,
      quarantineId,
      detectedClasses,
      payloadSha256,
      byteSize,
    });
    await this.engine.query(
      `INSERT INTO prov.prov_response_quarantine (
         quarantine_id, provider_id, operation_id, operation_version,
         detected_classes, field_paths, payload_sha256, byte_size, disposition,
         model_context_exclusion, detector_version, audit_entry_seq, detected_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'REJECTED', 'ENFORCED', $9, $10, $11)`,
      [
        quarantineId,
        input.ref.providerId,
        input.ref.operationId,
        input.ref.version,
        detectedClasses,
        JSON.stringify(fieldPaths),
        payloadSha256,
        byteSize,
        DETECTOR_VERSION,
        Number(auditEntry.seq),
        input.detectedAt,
      ],
    );
    return {
      disposition: 'REJECTED',
      record: {
        quarantineId,
        detectedClasses,
        fieldPaths,
        payloadSha256,
        byteSize,
        disposition: 'REJECTED',
        auditEntrySeq: Number(auditEntry.seq),
      },
    };
  }

  /**
   * Loud path for ingestion pipelines: route, then REFUSE with the typed
   * quarantine code when the response was rejected — the caller cannot
   * accidentally continue treating malicious material as present.
   */
  async requireClean(input: Parameters<ResponseQuarantine['inspectAndRoute']>[0]): Promise<void> {
    const routed = await this.inspectAndRoute(input);
    if (routed.disposition === 'REJECTED') {
      throw new QuarantineError(
        `provider response rejected: classes [${routed.record.detectedClasses.join(', ')}]; ` +
          'the response is quarantined metadata-only and absent from every downstream path',
        {
          quarantineId: routed.record.quarantineId,
          detectedClasses: routed.record.detectedClasses.join(','),
          payloadSha256: routed.record.payloadSha256,
        },
        ProvErrorCode.PROV_RESPONSE_QUARANTINED,
      );
    }
  }

  /**
   * Untrusted-content integration hook: the exclusion proof consumed by
   * envelope assembly. A quarantined id ALWAYS yields ENFORCED; asking about
   * an unknown id refuses rather than assuming inclusion.
   */
  async modelContextExclusionProof(quarantineId: string): Promise<{
    readonly quarantineId: string;
    readonly modelContextExclusion: 'ENFORCED';
  }> {
    const rows = await this.engine.query<{ quarantine_id: string }>(
      'SELECT quarantine_id FROM prov.prov_response_quarantine WHERE quarantine_id = $1',
      [quarantineId],
    );
    if (rows.rows.length === 0) {
      throw new QuarantineError(
        `unknown quarantine id ${quarantineId}; exclusion cannot be attested for what was never recorded`,
        { quarantineId },
        ProvErrorCode.PROV_QUARANTINE_PAYLOAD_PERSISTENCE_REFUSED,
      );
    }
    return { quarantineId, modelContextExclusion: 'ENFORCED' };
  }

  /** Every quarantine row carries NO payload bytes by construction — verify. */
  async assertNoPayloadMaterialStored(): Promise<void> {
    const columns = await this.engine.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'prov' AND table_name = 'prov_response_quarantine'`,
    );
    const forbidden = columns.rows
      .map((r) => r.column_name)
      .filter((name) =>
        /^(payload|response|body|raw|material|bytes)(_|$)/.test(name) && name !== 'payload_sha256',
      );
    if (forbidden.length > 0) {
      throw new QuarantineError(
        `quarantine storage grew payload-bearing columns: ${forbidden.join(', ')}`,
        { forbidden: forbidden.join(',') },
        ProvErrorCode.PROV_QUARANTINE_PAYLOAD_PERSISTENCE_REFUSED,
      );
    }
  }
}
