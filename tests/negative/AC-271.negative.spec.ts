/**
 * AC-271 negative.
 * Traces: FR-PROV-008.
 * Every malicious-response class is REJECTED + QUARANTINED + AUDITED +
 * EXCLUDED from model context; quarantine storage carries NO payload bytes
 * (proved for the private-key fixture); stripped transaction-building fields
 * never persist.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { sha256Text } from '@foresift/persistence';
import { AuditChain } from '@foresift/security';
import {
  OperationRegistry,
  ProvErrorCode,
  ResponseQuarantine,
  scanResponse,
  stripTransactionBuildingFields,
} from '@foresift/provider-lifecycle';
import type { OperationTarget } from '@foresift/provider-lifecycle';
import {
  closeProvTestDatabase,
  loadForbiddenFixtureCorpus,
  makeFixedClock,
  makeProvTestDatabase,
  provOperationDefinition,
  type ProvTestDatabase,
} from '../helpers/prov.ts';

const TARGET: OperationTarget = {
  providerId: 'gmgn',
  operationId: 'token.security',
  version: 'v1',
};
const clock = makeFixedClock('2026-08-26T12:00:00Z');

let tdb: ProvTestDatabase;
let quarantine: ResponseQuarantine;

beforeAll(async () => {
  tdb = await makeProvTestDatabase();
  // The quarantine table FKs onto the registered operation, so seed the
  // gmgn/token.security row the fixtures target.
  const registry = new OperationRegistry(tdb.engine, clock);
  await registry.registerProvider({
    providerId: 'gmgn',
    displayName: 'GMGN fixture provider',
    providerGroup: 'fixtures',
  });
  await registry.registerOperation(provOperationDefinition(TARGET));
  quarantine = new ResponseQuarantine({
    engine: tdb.engine,
    clock,
    auditChain: new AuditChain({ engine: tdb.engine }),
  });
});

afterAll(async () => {
  await closeProvTestDatabase(tdb);
});

describe('AC-271 refusals per malicious-response class', () => {
  it('every forbidden fixture is DETECTED under its declared class', () => {
    const fixtures = loadForbiddenFixtureCorpus();
    expect(fixtures.length).toBeGreaterThanOrEqual(5);
    for (const { file, fixture, bodyText } of fixtures) {
      const report = scanResponse(bodyText);
      expect(report.clean, `${file} must not scan clean`).toBe(false);
      expect(
        report.detections.some((d) => d.detectedClass === fixture.detectedClass),
        `${file} must be detected as ${fixture.detectedClass}`,
      ).toBe(true);
    }
  });

  it('each class is REJECTED + QUARANTINED + AUDITED + EXCLUDED from model context', async () => {
    const fixtures = loadForbiddenFixtureCorpus();
    for (const { file, fixture, bodyText } of fixtures) {
      const scan = scanResponse(bodyText);
      const record = await quarantine.rejectAndQuarantine({
        target: TARGET,
        responseBody: bodyText,
        scan,
        details: `fixture:${file}`,
      });
      // QUARANTINED — metadata-only record persisted.
      expect(record.disposition).toBe('REJECTED');
      expect(record.modelContextExclusion).toBe('ENFORCED');
      expect(record.detectedClasses as readonly string[]).toContain(fixture.detectedClass);

      // AUDITED — one BLOCKED_OPERATION entry naming the quarantine id.
      const auditRows = await tdb.engine.query<{ payload_canonical: string }>(
        `SELECT payload_canonical FROM sec.sec_audit_events
         WHERE action_class = 'BLOCKED_OPERATION' AND payload_canonical LIKE '%RESPONSE_QUARANTINED%'
           AND subject = $1`,
        ['gmgn/token.security@v1'],
      );
      expect(
        auditRows.rows.some((r) => r.payload_canonical.includes(record.quarantineId)),
        `${file} must be audited`,
      ).toBe(true);

      // EXCLUDED — the exact payload can never re-enter a model-context
      // envelope: every assembler MUST consult this gate BEFORE calling
      // envelopeContent, so quarantined bytes never reach labeling.
      await expect(
        quarantine.assertAdmissibleForModelContext(TARGET, record.payloadSha256),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_RESPONSE_QUARANTINED });
    }
  });

  it('quarantine storage holds NO payload bytes for the private-key fixture', async () => {
    const { bodyText } = loadForbiddenFixtureCorpus().find((f) =>
      f.file.startsWith('private-key'),
    )!;
    const record = await quarantine.rejectAndQuarantine({
      target: TARGET,
      responseBody: bodyText,
      scan: scanResponse(bodyText),
    });

    // 1. The table has NO payload column at all (metadata-only by schema).
    const columns = await tdb.engine.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'prov' AND table_name = 'prov_response_quarantine'`,
    );
    const names = columns.rows.map((c) => c.column_name).sort();
    for (const banned of ['payload', 'body', 'raw_response', 'response_body', 'content']) {
      expect(names).not.toContain(banned);
    }

    // 2. No stored text anywhere in the row contains the fake key marker.
    const rows = await tdb.engine.query<Record<string, unknown>>(
      `SELECT * FROM prov.prov_response_quarantine WHERE quarantine_id = $1`,
      [record.quarantineId],
    );
    const serialized = JSON.stringify(rows.rows[0]);
    // field_paths DO carry the PATH 'account.private_key' — a location, not
    // material — so the assertion targets VALUE absence:
    expect(serialized).toContain('account.private_key'); // path only
    expect(serialized).not.toContain('QUAAAQUFB'); // fake marker VALUE absent

    // 3. Only the HASH identifies the payload.
    expect(serialized).toContain(sha256Text(bodyText));
  });

  it('stripped transaction-building fields NEVER persist', async () => {
    const skeleton = loadForbiddenFixtureCorpus().find((f) =>
      f.file.startsWith('transaction-payload-skeleton'),
    )!;
    const parsed = JSON.parse(skeleton.bodyText) as Record<string, unknown>;
    const { stripped, removedPaths } = stripTransactionBuildingFields(parsed);

    // Payload-NAMED broadcast material is removed and reported...
    expect(removedPaths).toEqual(['swap_transaction']);
    expect(JSON.stringify(stripped)).not.toContain('FAKEENCODEDBROADCAST');
    // ...while the message+signatures SKELETON is detection/quarantine
    // territory (strip never silently rewrites provider response shape).
    const result = stripped.result as Record<string, unknown>;
    expect(result.message).toBe('FAKEBASE58MESSAGEBODY');
    expect(result.signatures).toEqual(['FAKESIGX', 'FAKESIGY']);
    expect('swap_transaction' in stripped).toBe(false);

    // The ORIGINAL body is quarantined; its stored row is metadata-only — no
    // hazard VALUE from either class persists anywhere in the record.
    await quarantine.rejectAndQuarantine({
      target: TARGET,
      responseBody: skeleton.bodyText,
      scan: scanResponse(skeleton.bodyText),
    });
    const stored = await tdb.engine.query<Record<string, unknown>>(
      `SELECT * FROM prov.prov_response_quarantine
       WHERE provider_id='gmgn' AND operation_id='token.security'`,
    );
    for (const row of stored.rows) {
      const flat = JSON.stringify(row);
      expect(flat).not.toContain('FAKEBASE58MESSAGEBODY'); // skeleton message VALUE
      expect(flat).not.toContain('FAKESIGX'); // signature VALUE
      expect(flat).not.toContain('FAKEENCODEDBROADCAST'); // payload field VALUE
    }
  });
});
