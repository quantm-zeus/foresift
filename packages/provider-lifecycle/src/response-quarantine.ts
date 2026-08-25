/**
 * Response quarantine (FR-PROV-008; §15.8 DEX/quote-SDK rule generalized,
 * AC-271). A provider response containing transaction payloads, signing
 * requests, executable instructions, private-key fields, or unexpected
 * write capability is REJECTED: scanned deterministically, quarantined as a
 * METADATA-ONLY record (classes, field paths, sha256, byte size — never the
 * payload material itself), audited through the chain bridge, and hard-
 * excluded from model-context envelopes. Transaction-building output fields
 * are stripped before any persistence path can see them.
 */
import { createHash, randomUUID } from 'node:crypto';
import { utcTimestamp, type ClockPort, type UtcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import type { UntrustedContentEnvelope } from '@foresift/shared-schemas';
import { envelopeContent } from '@foresift/security';
import { ProvErrorCode, ResponseQuarantineError } from './errors.ts';
import {
  QuarantineRecordSchema,
  type QuarantineClass,
  type QuarantineRecord,
} from './schemas.ts';
import type { ProviderAuditBridge } from './audit-bridges.ts';

export interface ResponseScanResult {
  readonly malicious: boolean;
  readonly detectedClasses: readonly QuarantineClass[];
  readonly fieldPaths: readonly string[];
}

/** Key-name rules: a field NAMED like this is hazardous whatever its value. */
const NAME_RULES: ReadonlyArray<{ readonly className: QuarantineClass; readonly pattern: RegExp }> = [
  { className: 'PRIVATE_KEY_FIELD', pattern: /private[-_]?key|secret[-_]?key|seed[-_]?phrase|mnemonic|keystore|wallet[-_]?dat/i },
  {
    className: 'TRANSACTION_PAYLOAD',
    pattern:
      /serialized[-_]?transaction|raw[-_]?transaction|transaction[-_]?payload|signed[-_]?t[rx]x?|unsigned[-_]?t[rx]x?|swap[-_]?transaction|tx[-_]?blob/i,
  },
  {
    className: 'SIGNING_REQUEST',
    pattern: /sign[-_]?request|signing[-_]?request|sign[-_]?message|sign[-_]?transaction|to[-_]?sign|payload[-_]?to[-_]?sign/i,
  },
  {
    className: 'EXECUTABLE_INSTRUCTION',
    pattern: /(deploy|install)[-_]?(program|script)|executable[-_]?payload|eval[-_]?script|shell[-_]?command|command[-_]?injection/i,
  },
  {
    className: 'UNEXPECTED_WRITE_CAPABILITY',
    pattern: /send[-_]?transaction|submit[-_]?transaction|(write|post|submit)[-_]?(url|endpoint)|order[-_]?placement|routing[-_]?submission/i,
  },
];

/**
 * String-value rules: content that hides outside well-named fields —
 * wallet-signing RPC method invitations, encoded executable headers
 * (ELF \x7fELF → f0VMRg, PE MZ → TVqQAAMAA), shebangs, and write-method
 * invitations. Applied to string VALUES during JSON walks and to raw body
 * text when the payload is not parseable JSON.
 */
const VALUE_RULES: ReadonlyArray<{ readonly className: QuarantineClass; readonly pattern: RegExp }> = [
  {
    className: 'SIGNING_REQUEST',
    pattern: /\bsolana_(?:sign|send)Transaction\b|\bpersonal_sign\b|\beth_sendTransaction\b|\beth_signTypedData(?:_v4)?\b/i,
  },
  {
    className: 'EXECUTABLE_INSTRUCTION',
    pattern: /(^|\s)(#!\/|f0VMRg|TVqQAAMAA)/,
  },
  {
    className: 'UNEXPECTED_WRITE_CAPABILITY',
    pattern: /\b(?:send|submit|place|execute)[A-Za-z]*?(?:Transaction|Order)\b/i,
  },
];

interface WalkAccumulator {
  readonly classes: Set<QuarantineClass>;
  readonly paths: Set<string>;
}

function note(acc: WalkAccumulator, className: QuarantineClass, path: string): void {
  acc.classes.add(className);
  acc.paths.add(`${className}:${path}`);
}

function inspectValue(acc: WalkAccumulator, path: string, key: string, value: unknown): void {
  if (typeof value === 'string') {
    for (const rule of VALUE_RULES) {
      if (rule.pattern.test(value)) note(acc, rule.className, `${path}<value>`);
    }
    return;
  }
  void key;
}

function walk(acc: WalkAccumulator, node: unknown, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(acc, item, `${path}[${String(index)}]`));
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path === '' ? key : `${path}.${key}`;
      for (const rule of NAME_RULES) {
        if (rule.pattern.test(key)) note(acc, rule.className, childPath);
      }
      inspectValue(acc, childPath, key, value);
      walk(acc, value, childPath);
    }
  }
}

/**
 * Deterministic scan of one provider response body. JSON bodies are walked
 * field-by-field; non-JSON bodies are text-scanned by the value rules with
 * the synthetic path `<body>`. Pure function of the input bytes.
 */
export function scanProviderResponse(input: {
  readonly bodyText: string;
  readonly contentType?: string | undefined;
}): ResponseScanResult {
  const acc: WalkAccumulator = { classes: new Set(), paths: new Set() };
  const isJson = (input.contentType ?? 'application/json').split(';')[0]?.trim().toLowerCase().includes('json') ?? true;
  let parsed: unknown;
  let jsonOk = false;
  try {
    parsed = JSON.parse(input.bodyText) as unknown;
    jsonOk = true;
  } catch {
    parsed = undefined;
  }
  if (isJson && jsonOk) {
    walk(acc, parsed, '');
  } else {
    for (const rule of VALUE_RULES) {
      if (rule.pattern.test(input.bodyText)) note(acc, rule.className, '<body>');
    }
    // Text responses still leak hazardous FIELD NAMES.
    for (const rule of NAME_RULES) {
      if (rule.pattern.test(input.bodyText)) note(acc, rule.className, '<body>');
    }
  }
  return {
    malicious: acc.classes.size > 0,
    detectedClasses: [...acc.classes],
    fieldPaths: [...acc.paths].sort(),
  };
}

export interface QuarantineServiceOptions {
  readonly engine: DatabaseEngine;
  /** Injected clock (Constitution XI). */
  readonly clock?: ClockPort;
  /** REQUIRED chain bridge: every quarantine is audited (AC-259/AC-271). */
  readonly audit: ProviderAuditBridge;
}

interface QuarantineRow {
  quarantine_id: string;
  provider_id: string;
  operation_id: string;
  detected_classes: unknown;
  field_paths: unknown;
  payload_sha256: string;
  byte_size: string | number;
  disposition: string;
  audit_ref: string;
  model_context_exclusion: string;
  detected_at: Date | string;
}

function rowToRecord(row: QuarantineRow): QuarantineRecord {
  return QuarantineRecordSchema.parse({
    quarantineId: row.quarantine_id,
    providerId: row.provider_id,
    operationId: row.operation_id,
    detectedClasses: row.detected_classes,
    fieldPaths: row.field_paths,
    payloadSha256: row.payload_sha256,
    byteSize: Number(row.byte_size),
    disposition: row.disposition,
    auditRef: row.audit_ref,
    modelContextExclusion: row.model_context_exclusion,
    detectedAt:
      typeof row.detected_at === 'string'
        ? row.detected_at.replace(' ', 'T')
        : row.detected_at.toISOString().replace('.000Z', 'Z'),
  });
}

export class ResponseQuarantineService {
  private readonly engine: DatabaseEngine;
  private readonly clock: ClockPort;
  private readonly audit: ProviderAuditBridge;

  constructor(options: QuarantineServiceOptions) {
    this.engine = options.engine;
    this.clock = options.clock ?? utcClockEpoch();
    this.audit = options.audit;
  }

  /**
   * Scan + conditional quarantine. Clean responses return `record:
   * undefined` and MAY proceed toward envelopes; malicious ones are
   * persisted metadata-only and audited BEFORE anything downstream runs.
   */
  async screenResponse(input: {
    readonly providerId: string;
    readonly operationId: string;
    readonly bodyText: string;
    readonly contentType?: string | undefined;
  }): Promise<{ scan: ResponseScanResult; record?: QuarantineRecord }> {
    const scan = scanProviderResponse({ bodyText: input.bodyText, contentType: input.contentType });
    if (!scan.malicious) return { scan };

    const now = this.clock.now();
    const quarantineId = `pqr-${randomUUID()}`;
    const payloadSha256 = `sha256:${createHash('sha256').update(input.bodyText, 'utf8').digest('hex')}`;
    const byteSize = Buffer.byteLength(input.bodyText, 'utf8');

    // Audit FIRST: the refusal is attested even if the INSERT fails.
    const auditEntry = await this.audit.responseQuarantined({
      occurredAt: now,
      actor: 'response-quarantine',
      providerId: input.providerId,
      operationId: input.operationId,
      detectedClasses: scan.detectedClasses,
      fieldPaths: scan.fieldPaths,
      payloadSha256,
      byteSize,
      quarantineId,
    });
    const auditRef = `sec-audit:${String(auditEntry.seq)}:${auditEntry.entryHash.slice(0, 16)}`;

    const inserted = await this.engine.query<QuarantineRow>(
      `INSERT INTO prov.prov_response_quarantine (
         quarantine_id, provider_id, operation_id, detected_classes,
         field_paths, payload_sha256, byte_size, audit_ref, detected_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
       RETURNING *`,
      [
        quarantineId,
        input.providerId,
        input.operationId,
        scan.detectedClasses,
        JSON.stringify(scan.fieldPaths),
        payloadSha256,
        byteSize,
        auditRef,
        now,
      ],
    );
    return { scan, record: rowToRecord(inserted.rows[0]!) };
  }

  /** Full quarantine history for one operation (metadata only, by design). */
  async history(providerId: string, operationId: string): Promise<QuarantineRecord[]> {
    const rows = await this.engine.query<QuarantineRow>(
      `SELECT * FROM prov.prov_response_quarantine
       WHERE provider_id = $1 AND operation_id = $2 ORDER BY detected_at ASC`,
      [providerId, operationId],
    );
    return rows.rows.map(rowToRecord);
  }
}

/**
 * Model-context integration hook (AC-258): clean provider text reaches the
 * landed untrusted-content envelope labeled PROVIDER_TEXT; a malicious scan
 * REFUSES here — quarantined content provably never reaches any envelope.
 */
export function providerEnvelopeFromScan(input: {
  readonly scan: ResponseScanResult;
  readonly content: string;
  readonly provenanceRef: string;
  readonly acquiredAt: UtcTimestamp;
}): UntrustedContentEnvelope {
  if (input.scan.malicious) {
    throw new ResponseQuarantineError(
      'quarantined response excluded from model context — envelope construction refuses',
      {
        detectedClasses: input.scan.detectedClasses.join(','),
      },
      ProvErrorCode.PROV_QUARANTINE_WRITE_THROUGH_REFUSED,
    );
  }
  return envelopeContent({
    source: 'PROVIDER_TEXT',
    content: input.content,
    provenanceRef: input.provenanceRef,
    acquiredAt: input.acquiredAt,
  });
}

/**
 * Strip forbidden output fields (dotted paths, array indices as numbers)
 * from parsed provider output BEFORE any persistence. The DEX/quote-SDK
 * rule: transaction-building output fields are rejected from durable state
 * and unavailable to the agent, whatever the scanner saw at the boundary.
 */
export function stripForbiddenOutputFields(
  parsed: unknown,
  forbiddenDottedPaths: readonly string[],
): unknown {
  /**
   * Path grammar: dot-separated keys; array positions appear either as a
   * numeric segment (`routes.0`) or a bracket suffix (`routes[0].x`).
   */
  function toSegments(dottedPath: string): string[] {
    const segments: string[] = [];
    for (const part of dottedPath.split('.')) {
      const match = part.match(/^([^\[\]]*)((?:\[\d+\])*)$/);
      const base = match?.[1] ?? part;
      if (base !== '') segments.push(base);
      for (const bracket of (match?.[2] ?? '').matchAll(/\[(\d+)\]/g)) {
        segments.push(`@${bracket[1]}`);
      }
    }
    return segments;
  }

  function isIndexSegment(segment: string): boolean {
    return segment.startsWith('@') || /^\d+$/.test(segment);
  }

  function remove(node: unknown, segments: readonly string[]): unknown {
    if (segments.length === 0 || node === null || typeof node !== 'object') return node;
    const head = segments[0]!;
    const tail = segments.slice(1);
    if (isIndexSegment(head)) {
      if (!Array.isArray(node)) return node;
      const index = Number(head.replace('@', ''));
      if (!Number.isInteger(index) || index < 0 || index >= node.length) return node;
      if (tail.length === 0) {
        return [...node.slice(0, index), ...node.slice(index + 1)];
      }
      return node.map((item, i) => (i === index ? remove(item, tail) : item));
    }
    if (Array.isArray(node)) return node;
    const record = node as Record<string, unknown>;
    if (!(head in record)) return node;
    if (tail.length === 0) {
      const clone = { ...record };
      delete clone[head];
      return clone;
    }
    return { ...record, [head]: remove(record[head], tail) };
  }

  let current = parsed;
  for (const dottedPath of forbiddenDottedPaths) {
    current = remove(current, toSegments(dottedPath));
  }
  return current;
}

function utcClockEpoch(): ClockPort {
  const fixed = utcTimestamp('1970-01-01T00:00:00Z');
  return { now: () => fixed, nowEpochMs: () => 0 };
}
