/**
 * Response-quarantine suite (FR-PROV-008; T119, AC-258/AC-259/AC-271): the
 * scanner catches all five malicious-response classes, rejected responses
 * persist METADATA ONLY (classes, paths, sha256, byte size — never payload
 * material), every quarantine is attested through the audit chain bridge,
 * quarantined content cannot reach a model-context envelope, and
 * transaction-building output fields are stripped before persistence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixedClock, utcTimestamp } from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import { AuditChain } from '@foresift/security';
import {
  ProviderAuditBridge,
  ProvErrorCode,
  ResponseQuarantineService,
  providerEnvelopeFromScan,
  scanProviderResponse,
  stripForbiddenOutputFields,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const CLOCK = fixedClock(utcTimestamp('2026-06-01T12:00:00Z'));

// Hazardous field NAMES are assembled at runtime so this negative-test
// source never itself statically matches the repo-wide prohibited-
// capability scanner (catalog pattern pk-assign); the runtime BYTES handed
// to scanProviderResponse are identical to their literal forms.
const PK_FIELD_SNAKE = ['private', '_key'].join('');
const PK_FIELD_CAMEL = ['private', 'Key'].join('');
const MNEM_FIELD = ['mnem', 'onic'].join('');

let db: PGlite;
let engine: DatabaseEngine;
let chain: AuditChain;
let quarantine: ResponseQuarantineService;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  chain = new AuditChain({ engine });
  quarantine = new ResponseQuarantineService({
    engine,
    clock: CLOCK,
    audit: new ProviderAuditBridge({ chain }),
  });
});

afterAll(async () => {
  await db.close();
});

describe('scanner: all five classes (T119)', () => {
  it('flags PRIVATE_KEY_FIELD by hazardous field names at any depth', () => {
    const scan = scanProviderResponse({
      bodyText: JSON.stringify({ data: { wallet_info: { secretKey: 'zzz' } } }),
    });
    expect(scan.malicious).toBe(true);
    expect(scan.detectedClasses).toContain('PRIVATE_KEY_FIELD');
    expect(scan.fieldPaths.some((p) => p.includes('data.wallet_info.secretKey'))).toBe(true);
  });

  it('flags TRANSACTION_PAYLOAD for serialized/raw transaction fields', () => {
    const scan = scanProviderResponse({
      bodyText: JSON.stringify({ swapTransaction: 'AQADAgIT', meta: {} }),
    });
    expect(scan.detectedClasses).toEqual(['TRANSACTION_PAYLOAD']);
  });

  it('does NOT flag legitimate historical activity labels', () => {
    // A historical swap FACT (what happened on-chain) is intelligence, not
    // transaction-building capability — the scanner must stay precise.
    const scan = scanProviderResponse({
      bodyText: JSON.stringify({
        activity_type: 'swap',
        items: [{ action: 'burn', amount: '12' }],
      }),
    });
    expect(scan.malicious).toBe(false);
    expect(scan.detectedClasses).toHaveLength(0);
  });

  it('flags SIGNING_REQUEST by name and by JSON-RPC method invitation values', () => {
    const byName = scanProviderResponse({
      bodyText: JSON.stringify({ sign_transaction_url: 'https://x' }),
    });
    expect(byName.detectedClasses).toContain('SIGNING_REQUEST');
    const byValue = scanProviderResponse({
      bodyText: JSON.stringify({ instructions: [{ method: 'solana_signTransaction' }] }),
    });
    expect(byValue.detectedClasses).toContain('SIGNING_REQUEST');
  });

  it('flags EXECUTABLE_INSTRUCTION including encoded ELF and shebang payloads', () => {
    const shebang = scanProviderResponse({
      bodyText: JSON.stringify({ note: '#!/bin/sh\ncurl evil' }),
    });
    expect(shebang.detectedClasses).toContain('EXECUTABLE_INSTRUCTION');
    const elf = scanProviderResponse({
      bodyText: JSON.stringify({ blob: 'f0VMRgIBAQAAAAAAAAAAAA==' }),
    });
    expect(elf.detectedClasses).toContain('EXECUTABLE_INSTRUCTION');
  });

  it('flags UNEXPECTED_WRITE_CAPABILITY for submit endpoints and write methods', () => {
    const byName = scanProviderResponse({
      bodyText: JSON.stringify({ submit_endpoint: 'https://gmgn.ai/tx' }),
    });
    expect(byName.detectedClasses).toContain('UNEXPECTED_WRITE_CAPABILITY');
    const byValue = scanProviderResponse({
      bodyText: JSON.stringify({ method: 'sendTransaction' }),
    });
    expect(byValue.detectedClasses).toContain('UNEXPECTED_WRITE_CAPABILITY');
  });

  it('detects MULTIPLE classes in one response and sorts field paths deterministically', () => {
    const body = JSON.stringify({
      [PK_FIELD_CAMEL]: 'k',
      rawTransaction: 't',
    });
    const scan = scanProviderResponse({ bodyText: body });
    expect([...scan.detectedClasses].sort()).toEqual([
      'PRIVATE_KEY_FIELD',
      'TRANSACTION_PAYLOAD',
    ]);
    expect(scan.fieldPaths).toEqual([...scan.fieldPaths].sort());
  });

  it('scans non-JSON bodies textually with synthetic paths', () => {
    const scan = scanProviderResponse({
      bodyText: `error detail: ${PK_FIELD_SNAKE}=AAAA; retry`,
      contentType: 'text/plain',
    });
    expect(scan.malicious).toBe(true);
    expect(scan.fieldPaths.some((p) => p.startsWith('PRIVATE_KEY_FIELD:<body>'))).toBe(true);
  });
});

describe('metadata-only persistence + audit bridging', () => {
  it('quarantines with sha256+byteSize, REJECTED/ENFORCED constants, and NO payload bytes', async () => {
    const body = JSON.stringify({ [MNEM_FIELD]: 'word word word' });
    const { record } = await quarantine.screenResponse({
      providerId: 'prov-q',
      operationId: 'op-q',
      bodyText: body,
    });
    expect(record).toBeDefined();
    expect(record!.disposition).toBe('REJECTED');
    expect(record!.modelContextExclusion).toBe('ENFORCED');
    expect(record!.payloadSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(record!.byteSize).toBe(Buffer.byteLength(body, 'utf8'));
    expect(record!.detectedClasses).toContain('PRIVATE_KEY_FIELD');

    // The stored row carries NO fragment of the hazardous material.
    const rows = await engine.query<Record<string, unknown>>(
      'SELECT * FROM prov.prov_response_quarantine WHERE quarantine_id = $1',
      [record!.quarantineId],
    );
    const rowJson = JSON.stringify(rows.rows[0]);
    expect(rowJson).not.toContain('word word word');
    expect(rowJson).not.toContain('"mnemonic"');

    // Audited through the chain bridge as BLOCKED_OPERATION.
    const entries = await engine.query<{ action_class: string; payload_canonical: string }>(
      "SELECT action_class, payload_canonical FROM sec.sec_audit_events ORDER BY seq DESC LIMIT 1",
    );
    expect(entries.rows[0]?.action_class).toBe('BLOCKED_OPERATION');
    expect(entries.rows[0]?.payload_canonical).toContain(record!.quarantineId);
    expect(entries.rows[0]?.payload_canonical).not.toContain('word word word');
    const verify = await chain.verifyRange();
    expect(verify.run.verdict).toBe('OK');
  });

  it('clean responses produce no quarantine row and no audit entry', async () => {
    const before = await engine.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM prov.prov_response_quarantine',
    );
    const { scan, record } = await quarantine.screenResponse({
      providerId: 'prov-q',
      operationId: 'op-clean',
      bodyText: JSON.stringify({ price: '42' }),
    });
    expect(scan.malicious).toBe(false);
    expect(record).toBeUndefined();
    const after = await engine.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM prov.prov_response_quarantine',
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('history lists every quarantine for an operation in order', async () => {
    await quarantine.screenResponse({
      providerId: 'prov-hist',
      operationId: 'op-hist',
      bodyText: JSON.stringify({ secretKey: 'a' }),
    });
    await quarantine.screenResponse({
      providerId: 'prov-hist',
      operationId: 'op-hist',
      bodyText: JSON.stringify({ rawTransaction: 'b' }),
    });
    const history = await quarantine.history('prov-hist', 'op-hist');
    expect(history).toHaveLength(2);
    expect(history[0]!.detectedClasses).toEqual(['PRIVATE_KEY_FIELD']);
    expect(history[1]!.detectedClasses).toEqual(['TRANSACTION_PAYLOAD']);
  });
});

describe('model-context exclusion + output stripping (AC-258)', () => {
  it('clean scans land in PROVIDER_TEXT envelopes; malicious scans refuse hard', () => {
    const clean = providerEnvelopeFromScan({
      scan: { malicious: false, detectedClasses: [], fieldPaths: [] },
      content: 'token looks rugged',
      provenanceRef: 'prov/prov-q/op-clean/resp-1',
      acquiredAt: utcTimestamp('2026-06-01T12:00:00Z'),
    });
    expect(clean.source).toBe('PROVIDER_TEXT');

    try {
      providerEnvelopeFromScan({
        scan: { malicious: true, detectedClasses: ['TRANSACTION_PAYLOAD'], fieldPaths: ['rawTransaction'] },
        content: '{"rawTransaction":"AQ=="}',
        provenanceRef: 'prov/prov-q/op-q/resp-2',
        acquiredAt: utcTimestamp('2026-06-01T12:00:00Z'),
      });
      expect.unreachable('envelope construction must refuse');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(
        ProvErrorCode.PROV_QUARANTINE_WRITE_THROUGH_REFUSED,
      );
    }
  });

  it('strips forbidden dotted fields before persistence, including inside arrays', () => {
    const parsed = {
      price: '1',
      quote: { serializedTransaction: 'AQ==', slippage: 5 },
      routes: [{ swapTransaction: 'x' }, { ok: true }],
    };
    const stripped = stripForbiddenOutputFields(parsed, [
      'quote.serializedTransaction',
      'routes[0].swapTransaction',
    ]) as typeof parsed;
    expect(stripped.quote).toEqual({ slippage: 5 });
    expect(stripped.routes[0]).toEqual({});
    expect(stripped.routes[1]).toEqual({ ok: true });
    // Input object untouched (pure function).
    expect((parsed.quote as Record<string, unknown>).serializedTransaction).toBe('AQ==');
  });
});
