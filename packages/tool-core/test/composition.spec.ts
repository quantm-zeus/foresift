/**
 * Composition-root units (FR-CORE-002, T701): createToolCore wiring with
 * deny-closed defaults — an unbound seam refuses at ITS stage as a typed
 * blocked envelope (never an improvised allow), the audit chain is a
 * REQUIRED binding, every blocked exit is audited AND enveloped even when an
 * unexpected internal error interrupts the sequence.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  sha256Text,
  type DatabaseEngine,
} from '@foresift/persistence';
import { AuditChain } from '@foresift/security';
import type { UtcTimestamp } from '@foresift/domain';
import type { BlockedStatePayload } from '@foresift/shared-schemas';
import { createToolCore } from '../src/engine.ts';
import type { ToolExecutionRequest } from '../src/run-context.ts';
import {
  CountingQuotaAdapter,
  PermissiveAuthn,
  PermissiveAuthz,
  PermissiveEgressGuard,
  PinnedRightsLicenseSource,
  CannedPayloadAdapter,
  observationFixture,
  rawPayload,
  routeFixture,
  toolMetadataFixture,
} from '../../../tests/fixtures/core/composition-harness.ts';

const MIGRATIONS_DIR = join(import.meta.dirname, '../../../migrations');
const T0 = '2026-08-01T00:00:00Z';

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
});

afterAll(async () => {
  await db.close();
});

function request(over: Partial<ToolExecutionRequest> = {}): ToolExecutionRequest {
  return {
    runId: over.runId ?? `run-${Math.random().toString(36).slice(2, 10)}`,
    authnMaterial: over.authnMaterial ?? { actorId: 'discovery' },
    holderMode: over.holderMode ?? 'MCP_MANUAL',
    workloadClass: over.workloadClass ?? 'INTERACTIVE_HIGH',
    toolName: over.toolName ?? 'get_asset_identity',
    toolVersion: over.toolVersion,
    tenantId: over.tenantId ?? 'tenant-a',
    arguments: over.arguments ?? {},
    canonicalEntityIdentity: over.canonicalEntityIdentity ?? 'solana:mint-fixture',
  };
}

function blockedData(envelope: { data?: unknown }): BlockedStatePayload {
  return envelope.data as BlockedStatePayload;
}

describe('deny-closed composition defaults', () => {
  it('refuses to compose without an audit chain', () => {
    expect(() =>
      createToolCore({
        engine,
        // @ts-expect-error — auditChain is REQUIRED by design
        auditChain: undefined,
      }),
    ).toThrow();
  });

  it('default authn refuses every actor as a RIGHTS_BLOCKED envelope + audit entry', async () => {
    const auditChain = new AuditChain({ engine });
    const core = createToolCore({ engine, auditChain });
    const envelope = await core.execute(request());
    const data = blockedData(envelope);
    expect(data.acquisitionState).toBe('RIGHTS_BLOCKED');
    expect(data.machineReason).toMatch(/^AUTHENTICATION_REFUSED/);
    expect(data.toolName).toBe('get_asset_identity');
    expect(envelope.meta.partial).toBe(true);
    expect(envelope.meta.qualityCodes).toEqual(['BLOCKED:RIGHTS_BLOCKED']);
    // The refusal is audited as a BLOCKED_OPERATION exit.
    const events = await engine.query<{ payload_canonical: string }>(
      `SELECT payload_canonical FROM sec.sec_audit_events ORDER BY seq DESC LIMIT 1`,
    );
    const payload = JSON.parse(events.rows[0]!.payload_canonical) as {
      outcome: string;
      machineReason: string;
    };
    expect(payload.outcome).toBe('BLOCKED');
    expect(payload.machineReason).toMatch(/^AUTHENTICATION_REFUSED/);
  });

  it('default authz refuses authenticated actors with AUTHZ_UNBOUND', async () => {
    const auditChain = new AuditChain({ engine });
    const core = createToolCore({
      engine,
      auditChain,
      authn: new PermissiveAuthn(),
      routes: [
        {
          toolName: 'get_asset_identity',
          route: routeFixture({ adapter: new CannedPayloadAdapter('gmgn', ['token_security'], '{}') }),
        },
      ],
    });
    await core.registry.register({
      metadata: toolMetadataFixture(),
      execute: async () => ({}),
    });
    const envelope = await core.execute(request());
    const data = blockedData(envelope);
    expect(data.acquisitionState).toBe('RIGHTS_BLOCKED');
    expect(data.machineReason).toContain('AUTHZ_UNBOUND');
  });

  it('unbound quota adapter exits COST_BLOCKED at the estimate stage', async () => {
    const auditChain = new AuditChain({ engine });
    const canned = new CannedPayloadAdapter(
      'gmgn',
      ['token_security'],
      JSON.stringify(rawPayload([observationFixture({ risk: 'low' })])),
    );
    const core = createToolCore({
      engine,
      auditChain,
      authn: new PermissiveAuthn(),
      authz: new PermissiveAuthz(),
      licenseSource: new PinnedRightsLicenseSource(),
      routes: [{ toolName: 'get_asset_identity', route: routeFixture({ adapter: canned }) }],
    });
    await core.registry.register({
      metadata: toolMetadataFixture(),
      execute: async () => ({}),
    });

    const envelope = await core.execute(request());
    const data = blockedData(envelope);
    // The collector was NEVER called — cost refusal precedes any dispatch.
    expect(canned.requests).toHaveLength(0);
    expect(data.acquisitionState).toBe('COST_BLOCKED');
    expect(data.machineReason).toContain('QUOTA_ADAPTER_UNBOUND');
    expect(envelope.meta.quota.quotaModel).toBe('UNKNOWN_CONFIGURABLE');
  });

  it('default license source refuses unverifiable rights before persistence', async () => {
    const auditChain = new AuditChain({ engine });
    const core = createToolCore({
      engine,
      auditChain,
      authn: new PermissiveAuthn(),
      authz: new PermissiveAuthz(),
      routes: [
        {
          toolName: 'get_asset_identity',
          route: routeFixture({
            adapter: new CannedPayloadAdapter('gmgn', ['token_security'], '{}'),
            licenseRequestedVersion: undefined,
          }),
        },
      ],
    });
    await core.registry.register({
      metadata: toolMetadataFixture(),
      execute: async () => ({}),
    });
    const envelope = await core.execute(request());
    const data = blockedData(envelope);
    expect(data.acquisitionState).toBe('RIGHTS_BLOCKED');
    expect(data.machineReason).toMatch(/^LICENSE_REFUSED/);
  });
});

describe('composed pipeline end-to-end (stubbed perimeter)', () => {
  it('executes all 24 stages, audits, settles quota, and returns a schema-valid success envelope', async () => {
    const auditChain = new AuditChain({ engine });
    const quota = new CountingQuotaAdapter();
    const egress = new PermissiveEgressGuard();
    const canned = new CannedPayloadAdapter(
      'gmgn',
      ['token_security'],
      JSON.stringify(
        rawPayload([observationFixture({ risk_score: 0.2 }, 60), observationFixture({ risk_score: 0.3 })]),
      ),
    );
    let clockMs = Date.parse(T0);
    const core = createToolCore({
      engine,
      auditChain,
      authn: new PermissiveAuthn(),
      authz: new PermissiveAuthz(),
      licenseSource: new PinnedRightsLicenseSource(),
      quotaAdapter: quota,
      egressGuard: egress,
      objectStore: {
        put: async (req) => ({
          artifactId: req.artifactId,
          contentHash: `sha256:${sha256Text(Buffer.from(req.bytes).toString('hex'))}`,
          version: 1,
          sizeBytes: req.bytes.byteLength,
          metadata: req.metadata,
          storedAt: T0,
        }),
        get: async () => null,
        verify: async () => {
          throw new Error('not used here');
        },
        versions: async () => [],
      },
      routes: [{ toolName: 'get_asset_identity', route: routeFixture({ adapter: canned }) }],
      now: () => new Date((clockMs += 1000)).toISOString() as UtcTimestamp,
    });
    await core.registry.register({
      metadata: toolMetadataFixture(),
      execute: async () => ({}),
    });

    const envelope = await core.execute(request({ runId: 'run-success-1' }));

    // Envelope shape and provenance.
    expect(envelope.meta.toolName).toBe('get_asset_identity');
    expect(envelope.meta.provider).toBe('gmgn');
    expect(envelope.meta.operation).toBe('token_security');
    expect(envelope.meta.cache).toBe('REFRESHED');
    expect(envelope.meta.partial).toBe(false);
    expect(envelope.meta.quota).toEqual({
      quotaModel: 'RATE_ONLY',
      reservationState: 'COMMITTED',
      estimatedUnits: 1,
      actualUnits: 1,
    });
    expect(envelope.meta.evidenceIds.length).toBeGreaterThan(0);

    // Exactly one provider call; quota committed once, never released.
    expect(canned.requests).toHaveLength(1);
    expect(quota.log.reservations).toBe(1);
    expect(quota.log.commits).toHaveLength(1);
    expect(quota.log.releases).toHaveLength(0);

    // The full §16.2 sequence executed in order.
    expect(core.stageSequence).toHaveLength(24);
  });

  it('unbound egress guard blocks dispatch AFTER reserve, releases the reservation, completes the outcome', async () => {
    const auditChain = new AuditChain({ engine });
    const quota = new CountingQuotaAdapter();
    const canned = new CannedPayloadAdapter('gmgn', ['token_security'], '{}');
    const core = createToolCore({
      engine,
      auditChain,
      authn: new PermissiveAuthn(),
      authz: new PermissiveAuthz(),
      licenseSource: new PinnedRightsLicenseSource(),
      quotaAdapter: quota,
      routes: [{ toolName: 'get_asset_identity', route: routeFixture({ adapter: canned }) }],
    });
    await core.registry.register({
      metadata: toolMetadataFixture(),
      execute: async () => ({}),
    });

    const envelope = await core.execute(request({ runId: 'run-no-egress' }));
    const data = blockedData(envelope);

    expect(canned.requests).toHaveLength(0); // never reached the adapter
    expect(data.acquisitionState).toBe('PROVIDER_UNAVAILABLE');
    expect(data.machineReason).toContain('EGRESS_UNCONFIGURED');
    // Reservation made then released; retrieval lifecycle completed lawfully.
    expect(quota.log.reservations).toBe(1);
    expect(quota.log.releases).toEqual(['res-run-no-egress']);
    const decisions = await engine.query<{ state: string }>(
      `SELECT state FROM evidence_acquisition_decisions WHERE decision_id = $1`,
      ['dec-run-no-egress'],
    );
    expect(decisions.rows[0]?.state).toBe('PROVIDER_UNAVAILABLE');
    expect(envelope.meta.quota.reservationState).toBe('RELEASED');
    expect(envelope.meta.partial).toBe(true);
  });
});
