/**
 * AC-271 negative.
 * Traces: FR-PROV-008.
 * Every malicious-response class is REJECTED + QUARANTINED + AUDITED +
 * EXCLUDED from model context; quarantine storage carries NO payload bytes
 * (proved for the private-key fixture); stripped transaction-building fields
 * never persist.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256Text } from '@foresift/persistence';
import { utcTimestamp, type ClockPort, type UtcTimestamp } from '@foresift/domain';
import { AuditChain } from '@foresift/security';
import {
  OperationRegistry,
  ProvErrorCode,
  REQUIRED_NEGATIVE_CAPABILITIES,
  ResponseQuarantine,
  scanResponse,
  stripTransactionBuildingFields,
} from '@foresift/provider-lifecycle';
import type { OperationDefinition, OperationTarget } from '@foresift/provider-lifecycle';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';

const TARGET: OperationTarget = { providerId: 'gmgn', operationId: 'token.security', version: 'v1' };
const NOW = '2026-08-26T12:00:00Z';
const clock: ClockPort = {
  now: () => utcTimestamp(NOW),
  nowEpochMs: () => Date.parse(NOW),
};
const FORBIDDEN_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/prov/forbidden',
);

interface ForbiddenFixture {
  fixtureClass: string;
  detectedClass: string;
  comment?: string;
  body: Record<string, unknown>;
}

let tdb: TestDatabase;
let quarantine: ResponseQuarantine;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  // The quarantine table FKs onto the registered operation, so seed the
  // gmgn/token.security row the fixtures target.
  const registry = new OperationRegistry(tdb.engine, clock);
  await registry.registerProvider({
    providerId: 'gmgn',
    displayName: 'GMGN fixture provider',
    providerGroup: 'fixtures',
  });
  await registry.registerOperation(definition());
  quarantine = new ResponseQuarantine({
    engine: tdb.engine,
    clock,
    auditChain: new AuditChain({ engine: tdb.engine }),
  });
});

function definition(): OperationDefinition {
  return {
    providerId: TARGET.providerId,
    operationId: TARGET.operationId,
    version: TARGET.version,
    capabilityClass: 'READ_MARKET',
    costClass: 'FREE_UNMETERED',
    supportedChains: ['solana'],
    supportedPrograms: [],
    inputSchemaId: 'in@1',
    rawOutputSchemaId: 'raw@1',
    normalizedOutputSchemaId: 'norm@1',
    quotaModelId: 'qm@1',
    cachePolicyId: 'cp@1',
    timeoutMs: 1000,
    retryPolicyId: 'rp@1',
    declaredIndependenceGroup: 'group-ac271neg',
    upstreamLineage: [],
    licensePolicyId: 'lic@1',
    estimatedQuotaUnits: 0,
    quotaResetPolicyId: 'qrp@1',
    batchCapability: null,
    minimumCandidateStage: null,
    protectedReserveEligible: false,
    allowedInStrictFree: false,
    paidFallbackAllowed: false,
    deprecatedAt: null,
    sunsetAt: null,
    replacementOperationId: null,
    verificationExpiresAt: utcTimestamp('2020-01-01T00:00:00Z'),
    forbiddenOutputFields: [],
    negativeCapabilities: [...REQUIRED_NEGATIVE_CAPABILITIES],
  };
}

afterAll(async () => {
  await closeTestDatabase(tdb);
});

function loadFixtures(): { file: string; fixture: ForbiddenFixture; bodyText: string }[] {
  return readdirSync(FORBIDDEN_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const fixture = JSON.parse(readFileSync(path.join(FORBIDDEN_DIR, file), 'utf8')) as ForbiddenFixture;
      return { file, fixture, bodyText: JSON.stringify(fixture.body) };
    });
}

describe('AC-271 refusals per malicious-response class', () => {
  it('every forbidden fixture is DETECTED under its declared class', () => {
    const fixtures = loadFixtures();
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
    const fixtures = loadFixtures();
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
      expect(record.detectedClasses).toContain(fixture.detectedClass);

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
    const { bodyText } = loadFixtures().find((f) => f.file.startsWith('private-key'))!;
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
    const skeleton = loadFixtures().find((f) => f.file.startsWith('transaction-payload-skeleton'))!;
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
