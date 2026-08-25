// AC-271 (negative): every malicious-response class REJECTED + QUARANTINED +
// AUDITED + EXCLUDED from model context. The private-key fixture additionally
// proves payload-byte absence in durable storage; stripped transaction-
// building fields never persist.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { utcTimestamp, type ClockPort } from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import { AuditChain } from '../../packages/security/src/index.ts';
import {
  ProvErrorCode,
  ProviderAuditBridge,
  ResponseQuarantineService,
  providerEnvelopeFromScan,
  stripForbiddenOutputFields,
} from '../../packages/provider-lifecycle/src/index.ts';
import {
  ALL_FORBIDDEN_SAMPLES,
  PRIVATE_KEY_FIELD_SAMPLE,
} from '../fixtures/prov/forbidden-corpus.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

function fixedTimeline() {
  let current = Date.parse('2026-06-01T12:00:00Z');
  return {
    clock: {
      now: () => new Date(current).toISOString().replace('.000Z', 'Z') as ReturnType<ClockPort['now']>,
      nowEpochMs: () => current,
    },
  };
}

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
    clock: fixedTimeline().clock,
    audit: new ProviderAuditBridge({ chain }),
  });
});

afterAll(async () => {
  await db.close();
});

describe('AC-271 negative: all five classes rejected end-to-end', () => {
  it('each forbidden sample is scanned, quarantined, audited, envelope-excluded', async () => {
    for (const sample of ALL_FORBIDDEN_SAMPLES) {
      const { scan, record } = await quarantine.screenResponse({
        providerId: 'ac271n-prov',
        operationId: `ac271n-${sample.detectedClass.toLowerCase()}`,
        bodyText: sample.bodyText,
      });
      expect(scan.malicious, sample.detectedClass).toBe(true);
      expect(scan.detectedClasses).toContain(sample.detectedClass);

      // Quarantined metadata-only.
      expect(record).toBeDefined();
      expect(record!.disposition).toBe('REJECTED');
      expect(record!.modelContextExclusion).toBe('ENFORCED');

      // Audited through the chain bridge.
      const entry = await engine.query<{ payload_canonical: string }>(
        "SELECT payload_canonical FROM sec.sec_audit_events WHERE action_class = 'BLOCKED_OPERATION' ORDER BY seq DESC LIMIT 1",
      );
      expect(entry.rows[0]?.payload_canonical).toContain(record!.quarantineId);

      // Excluded from model context.
      try {
        providerEnvelopeFromScan({
          scan,
          content: sample.bodyText,
          provenanceRef: `prov/ac271n/${sample.detectedClass}`,
          acquiredAt: utcTimestamp('2026-06-01T12:00:00Z'),
        });
        expect.unreachable(`${sample.detectedClass} must never reach an envelope`);
      } catch (error) {
        expect((error as { code?: string }).code).toBe(
          ProvErrorCode.PROV_QUARANTINE_WRITE_THROUGH_REFUSED,
        );
      }
    }
    expect((await chain.verifyRange()).run.verdict).toBe('OK');
  });

  it('private-key fixture bytes are structurally absent from storage AND audit', async () => {
    const marker = 'REDACTED-NOT-A-REAL-KEY';
    const { record } = await quarantine.screenResponse({
      providerId: 'ac271n-keycheck',
      operationId: 'op-keycheck',
      bodyText: PRIVATE_KEY_FIELD_SAMPLE.bodyText,
    });
    expect(record).toBeDefined();

    const rows = await engine.query<Record<string, unknown>>(
      'SELECT * FROM prov.prov_response_quarantine WHERE quarantine_id = $1',
      [record!.quarantineId],
    );
    // Metadata-only by construction: the forensic FIELD PATH is stored (it
    // names WHERE the hazard was) but no payload VALUE ever persists.
    const rowJson = JSON.stringify(rows.rows[0]);
    expect(rowJson).not.toContain(marker);
    expect(rowJson).not.toContain(PRIVATE_KEY_FIELD_SAMPLE.bodyText);
    expect(rowJson).not.toContain('payload_body');

    const audits = await engine.query<{ payload_canonical: string }>(
      "SELECT payload_canonical FROM sec.sec_audit_events WHERE action_class = 'BLOCKED_OPERATION'",
    );
    for (const audit of audits.rows) {
      expect(audit.payload_canonical).not.toContain(marker);
      expect(audit.payload_canonical).not.toContain(PRIVATE_KEY_FIELD_SAMPLE.bodyText);
    }
  });

  it('stripped transaction-building fields can never persist', async () => {
    const hazardous = JSON.stringify({
      priceUsd: '1.02',
      quote: { serializedTransaction: 'AAAA', slippageBps: 50 },
      routes: [{ swapTransaction: 'BBBB' }, { poolId: 'p-1' }],
    });
    const stripped = stripForbiddenOutputFields(JSON.parse(hazardous), [
      'quote.serializedTransaction',
      'routes[0].swapTransaction',
    ]);
    const serialized = JSON.stringify(stripped);
    // The transaction-building surface is GONE from the persistable form…
    expect(serialized).not.toContain('serializedTransaction');
    expect(serialized).not.toContain('swapTransaction');
    expect(serialized).not.toContain('AAAA');
    // …so the persistence-boundary scan sees a CLEAN body.
    const { scan } = await quarantine.screenResponse({
      providerId: 'ac271n-strip',
      operationId: 'op-strip',
      bodyText: serialized,
    });
    expect(scan.malicious).toBe(false);
  });
});
