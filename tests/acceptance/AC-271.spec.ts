// AC-271 (acceptance): sanitized clean provider responses flow to evidence
// envelopes while the audit chain keeps attesting security-relevant facts.
// Positive controls come from the fixture corpus; every clean response must
// scan clean, land as labeled PROVIDER_TEXT data, and leave an intact,
// verifiable audit trail.
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
  LifecycleMachine,
  OperationRegistry,
  ProviderAuditBridge,
  ResponseQuarantineService,
  providerEnvelopeFromScan,
} from '../../packages/provider-lifecycle/src/index.ts';
import { ALL_CLEAN_RESPONSES } from '../fixtures/prov/clean-responses.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

const NOW = '2026-06-01T12:00:00Z';

function movableClock(startEpochMs: number): { clock: ClockPort } {
  let current = startEpochMs;
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
  const bridge = new ProviderAuditBridge({ chain });
  quarantine = new ResponseQuarantineService({ engine, clock: movableClock(Date.parse(NOW)).clock, audit: bridge });

  // A real activation so the chain carries a PROVIDER_COLLECTOR_ACCESS fact.
  const registry = new OperationRegistry({ engine, clock: movableClock(Date.parse(NOW)).clock });
  await registry.registerProvider({
    providerId: 'ac271-prov',
    providerGroup: 'market-data',
    displayName: 'AC-271 Provider',
  });
  await registry.registerOperation({
    providerId: 'ac271-prov',
    operationId: 'ac271-op',
    version: '1.0.0',
    capabilityClass: 'READ_MARKET',
    supportedChains: ['solana-mainnet'],
    inputSchemaId: 'schema/in',
    rawOutputSchemaId: 'schema/raw',
    normalizedOutputSchemaId: 'schema/norm',
    quotaModelId: 'quota/basic',
    cachePolicyId: 'cache/ttl-60s',
    timeoutMs: 5000,
    retryPolicyId: 'retry/twice',
    declaredIndependenceGroup: 'indep/g1',
    upstreamLineage: [],
    licensePolicyId: 'license/default',
    healthStatus: 'HEALTHY',
    costClass: 'FREE_QUOTA',
    estimatedQuotaUnits: 10,
    quotaResetPolicyId: 'reset/daily',
    protectedReserveEligible: false,
    allowedInStrictFree: true,
    paidFallbackAllowed: false,
    verificationExpiresAt: '2026-07-01T00:00:00Z',
    forbiddenOutputFields: [],
    negativeCapabilities: ['no-trading'],
  });
  const machine = new LifecycleMachine({ engine, clock: movableClock(Date.parse(NOW)).clock, audit: bridge });
  for (const [toState, reasonClass] of [
    ['VERIFIED', 'VERIFICATION_PROMOTED'],
    ['ACTIVE', 'ACTIVATION_APPROVED'],
  ] as const) {
    await machine.transition({
      providerId: 'ac271-prov',
      operationId: 'ac271-op',
      operationVersion: '1.0.0',
      toState,
      reasonClass,
      actor: 'acceptance',
      idempotencyKey: `ac271:${toState}`,
    });
  }
});

afterAll(async () => {
  await db.close();
});

describe('AC-271: clean responses flow to evidence envelopes', () => {
  it('every sanitized positive control scans clean', async () => {
    expect(ALL_CLEAN_RESPONSES.length).toBeGreaterThanOrEqual(6);
    for (const response of ALL_CLEAN_RESPONSES) {
      const { scan, record } = await quarantine.screenResponse({
        providerId: response.providerId,
        operationId: response.operationId,
        bodyText: response.bodyText,
        contentType: response.contentType,
      });
      expect(scan.malicious, `${response.operationId} must be clean`).toBe(false);
      expect(record).toBeUndefined();
    }
  });

  it('clean content lands ONLY as labeled untrusted-data envelopes', async () => {
    for (const response of ALL_CLEAN_RESPONSES.slice(0, 4)) {
      const { scan } = await quarantine.screenResponse({
        providerId: response.providerId,
        operationId: response.operationId,
        bodyText: response.bodyText,
        contentType: response.contentType,
      });
      const envelope = providerEnvelopeFromScan({
        scan,
        content: response.bodyText,
        provenanceRef: `prov/${response.providerId}/${response.operationId}/resp`,
        acquiredAt: utcTimestamp(NOW),
      });
      expect(envelope.source).toBe('PROVIDER_TEXT');
      expect(envelope.content).toBe(response.bodyText);
    }
  });

  it('the audit chain stays intact and carries activation attestations', async () => {
    const verify = await chain.verifyRange();
    expect(verify.run.verdict).toBe('OK');
    const entries = await engine.query<{ action_class: string }>(
      "SELECT DISTINCT action_class FROM sec.sec_audit_events",
    );
    const classes = entries.rows.map((r) => r.action_class);
    expect(classes).toContain('PROVIDER_COLLECTOR_ACCESS');
    expect(classes).not.toContain('BLOCKED_OPERATION'); // nothing quarantined here
  });
});
