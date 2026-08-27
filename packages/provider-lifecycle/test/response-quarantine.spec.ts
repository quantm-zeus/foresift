/**
 * T119: malicious-response quarantine (FR-PROV-008, AC-271). Detection is
 * deterministic across the five classes; quarantined material is audited
 * metadata-only and HARD-EXCLUDED from model-context envelopes; retries
 * resolve to the same quarantine record.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { AuditChain } from '@foresift/security';
import { sha256Text } from '@foresift/persistence';
import {
  ResponseQuarantine,
  scanResponse,
  stripTransactionBuildingFields,
  ProvErrorCode,
} from '../src/index.ts';
import type { OperationTarget } from '../src/index.ts';
import { makeProvEngine, seedOperationRow, ts } from './helpers.ts';

let engine: Awaited<ReturnType<typeof makeProvEngine>>['engine'];
let closeDb: () => Promise<void>;
let quarantine: ResponseQuarantine;
let chain: AuditChain;

const TARGET: OperationTarget = {
  providerId: 'prov-test',
  operationId: 'op-q',
  version: 'v1',
};

beforeAll(async () => {
  const made = await makeProvEngine();
  engine = made.engine;
  closeDb = () => made.db.close();
  chain = new AuditChain({ engine });
  await seedOperationRow(engine, { providerId: 'prov-test', operationId: 'op-q', version: 'v1' });
  quarantine = new ResponseQuarantine({
    engine,
    clock: {
      now: () => ts('2026-08-26T12:00:00Z'),
      nowEpochMs: () => Date.parse('2026-08-26T12:00:00Z'),
    },
    auditChain: chain,
  });
});

afterAll(async () => {
  await closeDb();
});

describe('T119 deterministic response scanning', () => {
  it('detects a raw transaction payload field', () => {
    const report = scanResponse(JSON.stringify({ data: { raw_transaction: '0xdeadbeef' } }));
    expect(report.clean).toBe(false);
    expect(report.detections.map((d) => d.detectedClass)).toContain('TRANSACTION_PAYLOAD');
  });

  it('detects the message+signatures transaction skeleton', () => {
    const report = scanResponse(JSON.stringify({ tx: { message: 'AGV2', signatures: ['sig1'] } }));
    expect(report.detections.some((d) => d.detectedClass === 'TRANSACTION_PAYLOAD')).toBe(true);
  });

  it('does NOT flag an object with only one of the skeleton keys', () => {
    const report = scanResponse(JSON.stringify({ message: 'hello' }));
    expect(report.clean).toBe(true);
  });

  it('detects signing requests, executable content, and private-key fields', () => {
    const body = JSON.stringify({
      sign_request: 'please sign',
      wasm_module: 'AQID',
      wallet_export_blob: '{"k":1}',
    });
    const classes = scanResponse(body).detections.map((d) => d.detectedClass);
    expect(classes).toContain('SIGNING_REQUEST');
    expect(classes).toContain('EXECUTABLE_INSTRUCTION');
    expect(classes).toContain('PRIVATE_KEY_FIELD');
  });

  it('detects PEM key text and shebang scripts at the text level', () => {
    const pem = scanResponse('-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----');
    expect(pem.detections.map((d) => d.detectedClass)).toContain('PRIVATE_KEY_FIELD');
    const script = scanResponse('#!/bin/sh\nrm -rf /\n');
    expect(script.detections.map((d) => d.detectedClass)).toContain('EXECUTABLE_INSTRUCTION');
  });

  it('detects unexpected WRITE capability advertisements on a read-only surface', () => {
    const body = JSON.stringify({ capabilities: ['READ_MARKET', 'SUBMIT'] });
    const classes = scanResponse(body).detections.map((d) => d.detectedClass);
    expect(classes).toContain('UNEXPECTED_WRITE_CAPABILITY');
  });

  it('passes clean read-only market payloads', () => {
    const report = scanResponse(
      JSON.stringify({ address: 'So111', risk: 'low', holders: 1234, topTraders: [] }),
    );
    expect(report.clean).toBe(true);
  });

  it('stripTransactionBuildingFields removes payload keys and reports paths', () => {
    const input = { a: 1, swap_transaction: 'x', nested: { serialized_tx: 'y' }, keep: true };
    const { stripped, removedPaths } = stripTransactionBuildingFields(input);
    expect(removedPaths).toEqual(['nested.serialized_tx', 'swap_transaction']);
    expect(stripped as Record<string, unknown>).toEqual({ a: 1, nested: {}, keep: true });
  });
});

describe('T119 quarantine records + model-context exclusion', () => {
  const HAZARD = JSON.stringify({ raw_transaction: 'broadcast-me' });

  it('reject-and-quarantine persists metadata only and emits the audit bridge', async () => {
    const before = await countAudit();
    const scan = scanResponse(HAZARD);
    const record = await quarantine.rejectAndQuarantine({
      target: TARGET,
      responseBody: HAZARD,
      scan,
    });
    expect(record.disposition).toBe('REJECTED');
    expect(record.modelContextExclusion).toBe('ENFORCED');
    expect(record.detectedClasses).toEqual(['TRANSACTION_PAYLOAD']);
    expect(record.payloadSha256).toBe(sha256Text(HAZARD));
    // The hazardous body itself appears NOWHERE in the audit chain.
    const events = await recentAuditPayloads(before);
    expect(events.some((p) => p.includes('broadcast-me'))).toBe(false);
    expect(events.some((p) => p.includes('RESPONSE_QUARANTINED'))).toBe(true);
  });

  it('is idempotent: the same body re-quarantines to the SAME record without a second audit entry', async () => {
    const first = await quarantine.rejectAndQuarantine({
      target: TARGET,
      responseBody: HAZARD,
      scan: scanResponse(HAZARD),
    });
    const before = await countAudit();
    const again = await quarantine.rejectAndQuarantine({
      target: TARGET,
      responseBody: HAZARD,
      scan: scanResponse(HAZARD),
    });
    expect(again.quarantineId).toBe(first.quarantineId);
    expect(await countAudit()).toBe(before); // no duplicate emission
  });

  it('refuses to quarantine a clean scan (no detected class)', async () => {
    const clean = scanResponse(JSON.stringify({ ok: true }));
    await expect(
      quarantine.rejectAndQuarantine({ target: TARGET, responseBody: '{"ok":true}', scan: clean }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_QUARANTINE_RECORD_INVALID });
  });

  it('HARD-EXCLUDES the exact payload from model-context envelopes', async () => {
    await expect(
      quarantine.assertAdmissibleForModelContext(TARGET, sha256Text(HAZARD)),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_RESPONSE_QUARANTINED });
    // A different (clean) hash admits.
    await expect(
      quarantine.assertAdmissibleForModelContext(TARGET, sha256Text('{"clean":true}')),
    ).resolves.toBeUndefined();
  });

  it('lists quarantine history with detection metadata only', async () => {
    const rows = await quarantine.list(TARGET);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0];
    if (row === undefined) throw new Error('expected at least one quarantine row');
    expect(row.detectedClasses).toContain('TRANSACTION_PAYLOAD');
    expect(JSON.stringify(row)).not.toContain('broadcast-me');
  });
});

async function countAudit(): Promise<number> {
  const rows = await engine.query<{ n: string }>(
    'SELECT COUNT(*)::text AS n FROM sec.sec_audit_events',
  );
  return Number(rows.rows[0]?.n ?? '0');
}

async function recentAuditPayloads(sinceSeqCount: number): Promise<string[]> {
  const rows = await engine.query<{ payload_canonical: string }>(
    `SELECT payload_canonical FROM sec.sec_audit_events WHERE seq > $1 ORDER BY seq`,
    [sinceSeqCount],
  );
  return rows.rows.map((r) => r.payload_canonical);
}
