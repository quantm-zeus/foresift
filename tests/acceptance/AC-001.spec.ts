/**
 * AC-001 acceptance (positive) — TOOL-CORE FACET.
 * Traces: FR-CORE-001, FR-CORE-002, FR-CORE-003, FR-CORE-004.
 * AC text (manifest §39.1): "A manual MCP client initializes, lists a scoped
 * domain-tool profile, and analyzes a Solana asset using the configured free
 * discovery source plus at least one independent security source and one
 * selective Solana RPC/indexer adapter when those capabilities are available;
 * unavailable optional providers degrade explicitly."
 *
 * Facet covered here (@foresift/tool-core): the central versioned registry
 * lists exactly the tools bound to a scoped domain-tool profile (FR-CORE-001,
 * FR-CORE-004); a stubbed free-discovery analysis executes end-to-end through
 * ALL 24 pipeline stages and returns THE provenance/event-time/quality/
 * evidence envelope (FR-CORE-002, FR-CORE-003); an unavailable optional
 * source degrades EXPLICITLY as a typed blocked exit — never a silent gap,
 * never a raw thrown error.
 *
 * Facets LATER PACKAGES add to this AC (deliberately out of scope here):
 *   - the MCP client-facing transport surface — initialize / scoped tools-list
 *     framing / tool-call round-trip (FR-MCP-001…012);
 *   - real provider adapters behind the egress perimeter (independent security
 *     source, selective Solana RPC/indexer adapter);
 *   - cross-source independence analysis over multiple live sources.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PIPELINE_STAGE_ORDER,
  utcTimestamp,
  type ToolProfileId,
  type UtcTimestamp,
} from '@foresift/domain';
import type { ToolDefinitionMetadata } from '@foresift/shared-schemas';
import {
  closeTestDatabase,
  makeTestDatabase,
  type TestDatabase,
} from './helpers.ts';
import { ReferenceQuotaAdapter } from '../fixtures/core/reference-adapters.ts';
import {
  CacheStageChain,
  ProhibitedCapabilityScreen,
  SingleFlightManager,
  ToolCoreRegistry,
  createToolCore,
  type ToolCoreEngine,
} from '../../packages/tool-core/src/index.ts';
import type {
  AuthnPrimitive,
  AuthzPrimitive,
} from '../../packages/tool-core/src/stages/authn.ts';
import type { EgressGuardLike } from '../../packages/tool-core/src/stages/dispatch.ts';

const T0 = Date.parse('2026-08-01T00:00:00Z');

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

// ── composition fixtures ─────────────────────────────────────────────────────

interface ActorOverrides {
  scopes?: string[];
}

function stubAuthn(over: ActorOverrides = {}): AuthnPrimitive {
  return {
    async authenticate({ token }) {
      if (token !== 'credential-1') throw new Error('bad credential');
      return {
        actorId: 'user-1',
        holderMode: 'CHATGPT' as const,
        profileId: 'discovery' as ToolProfileId,
        scopes: over.scopes ?? ['assets:read'],
      };
    },
  };
}

function allowAuthz(): AuthzPrimitive {
  return {
    async authorize() {
      return { allowed: true, reason: 'fixture allow' };
    },
  };
}

/** Unique per-scenario marker so no two scenarios share exact cache keys. */
function freshLicenseVersion(): string {
  return `rights/v1-${Math.random().toString(36).slice(2, 10)}`;
}

function allowEgress(): EgressGuardLike {
  return {
    async authorize() {
      return { allowed: true, reason: 'fixture allowlist' };
    },
  };
}

interface Scenario {
  core: ToolCoreEngine;
  registry: ToolCoreRegistry;
  licenseVersion: string;
}

function compose(): Scenario {
  const licenseVersion = freshLicenseVersion();
  const now = (): UtcTimestamp => utcTimestamp(new Date(T0).toISOString());
  const registry = new ToolCoreRegistry({ engine: tdb.engine, screen: new ProhibitedCapabilityScreen(), now });
  const core = createToolCore({
    engine: tdb.engine,
    clock: () => new Date(T0).toISOString(),
    registry,
    cacheChain: new CacheStageChain({ engine: tdb.engine, now }),
    singleFlight: new SingleFlightManager({ engine: tdb.engine, now }),
    authn: stubAuthn(),
    authz: allowAuthz(),
    licenseSource: {
      async verdict() {
        return { allowed: true, policyVersion: licenseVersion, reason: 'fixture verified rights' };
      },
    },
    quota: new ReferenceQuotaAdapter(tdb.engine),
    screen: new ProhibitedCapabilityScreen(),
    egress: allowEgress(),
  });
  return { core, registry, licenseVersion };
}

async function registerDefinition(
  registry: ToolCoreRegistry,
  opts: {
    name?: string;
    profiles?: ToolProfileId[];
    execute?: (input: unknown) => Promise<unknown>;
  } = {},
): Promise<string> {
  const name = opts.name ?? `get_asset_identity_${Math.random().toString(36).slice(2, 8)}`;
  const metadata = {
    name,
    version: '1.0.0',
    title: name,
    description: `Fixture free-discovery definition for ${name}.`,
    actionClass: 'EXTERNAL_READ',
    profiles: opts.profiles ?? [('discovery' as ToolProfileId)],
    requiredScopes: ['assets:read'],
    cachePolicyId: 'exact-default',
    quotaPolicyId: 'strict-free-default',
    licensePolicyId: 'rights-verified-only',
    estimatedCost: {},
    inputSchemaJson: { type: 'object' },
    outputSchemaJson: { type: 'object' },
  } as unknown as ToolDefinitionMetadata;
  await registry.register({
    metadata,
    execute:
      opts.execute ??
      (async () => ({
        data: { chain: 'solana', address: 'So11111111111111111111111111111111111111112' },
        observedAt: '2026-08-01T00:00:00Z',
        availableAt: '2026-08-01T00:00:01Z',
        qualityCodes: ['OK'],
      })),
    inputSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
    outputSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
  });
  return name;
}

function discoveryRequest(toolName: string) {
  return {
    toolName,
    toolVersion: '1.0.0',
    // The reference quota adapter prices THIS operation; it stands in for the
    // configured free-discovery source's cost semantics.
    operation: 'token_security',
    input: {
      chain: 'solana',
      address: 'So11111111111111111111111111111111111111112',
    },
    actorToken: 'credential-1',
    workloadClass: 'SCHEDULED_NORMAL' as const,
    holderMode: 'CHATGPT' as const,
    profileId: 'discovery' as ToolProfileId,
  };
}

// ── suites ───────────────────────────────────────────────────────────────────

describe('AC-001 · tool-core facet', () => {
  it('lists exactly the tools bound to a scoped domain-tool profile (FR-CORE-001, FR-CORE-004)', async () => {
    const scenario = compose();
    const discoveryA = await registerDefinition(scenario.registry);
    const discoveryB = await registerDefinition(scenario.registry);
    // An atomic diagnostic bound ONLY to the admin profile must never appear
    // in a discovery-profile listing (§16.9 exclusion rule).
    const adminOnly = await registerDefinition(scenario.registry, {
      profiles: ['admin-read' as ToolProfileId],
    });

    const listed = scenario.registry.listByProfile('discovery');
    const listedNames = listed.map((entry) => entry.metadata.name);
    expect(listedNames).toContain(discoveryA);
    expect(listedNames).toContain(discoveryB);
    expect(listedNames).not.toContain(adminOnly);
    for (const entry of listed) {
      expect(entry.metadata.version).toBe('1.0.0'); // versioned registry
      expect(entry.retiredAt).toBeNull();
    }

    // Retirement is additive and immediately reflected in the scoped listing.
    await scenario.registry.retire(discoveryB, '1.0.0', new Date(T0).toISOString());
    const afterRetire = scenario.registry.listByProfile('discovery').map((e) => e.metadata.name);
    expect(afterRetire).toContain(discoveryA);
    expect(afterRetire).not.toContain(discoveryB);
  });

  it('a stubbed free-discovery Solana analysis runs all 24 stages into the provenance envelope (FR-CORE-002, FR-CORE-003)', async () => {
    const scenario = compose();
    const toolName = await registerDefinition(scenario.registry);
    const execution = await scenario.core.execute(discoveryRequest(toolName));

    // Exact pinned order, every stage executed once.
    expect(execution.context.completedTrace).toEqual([...PIPELINE_STAGE_ORDER]);

    // THE envelope carries provenance, event time, quality, and evidence.
    const meta = execution.result.meta;
    expect(meta.partial).toBe(false);
    expect(meta.evidenceIds.length).toBeGreaterThanOrEqual(1);
    expect(meta.observedAt).toBe('2026-08-01T00:00:00Z');
    expect(meta.availableAt).toBe('2026-08-01T00:00:01Z');
    expect(meta.fetchedAt).toBeDefined();
    expect(meta.cache).toBe('REFRESHED');
    expect(meta.qualityCodes).toContain('OK');
    expect(meta.conflicts).toEqual([]);
    expect(meta.quota.reservationState).toBe('COMMITTED');

    // The acquisition decision completed RETURNED with evidence attached.
    expect(execution.context.retrievalCompleted).toBe(true);
    const acq = await tdb.engine.query<{ state: string; evidence_ids: string[] }>(
      `SELECT state, evidence_ids FROM evidence_acquisition_decisions WHERE decision_id = $1`,
      [execution.context.decisionId],
    );
    expect(acq.rows[0]?.state).toBe('RETURNED');
    expect((acq.rows[0]?.evidence_ids ?? []).length).toBeGreaterThanOrEqual(1);

    // The result data is the normalized provider payload, not raw plumbing.
    expect(execution.result.data).toEqual({
      chain: 'solana',
      address: 'So11111111111111111111111111111111111111112',
    });
  });

  it('an unavailable optional source degrades explicitly in the envelope (FR-CORE-002, FR-CORE-003)', async () => {
    const scenario = compose();
    const toolName = await registerDefinition(scenario.registry, {
      // The optional source's adapter is down: the failure surfaces as a typed
      // provider-unavailable degradation — never a raw throw across the seam.
      execute: async () => {
        throw new Error('connection refused by optional source');
      },
    });

    const before = await countAuditRows();
    const execution = await scenario.core.execute(discoveryRequest(toolName));

    const data = execution.result.data as { acquisitionState: string; machineReason: string };
    expect(data.acquisitionState).toBe('PROVIDER_UNAVAILABLE');
    expect(data.machineReason).toContain('ADAPTER_FAILURE');
    expect(execution.result.meta.partial).toBe(true);
    expect(execution.result.meta.qualityCodes).toContain('PIPELINE_BLOCKED');
    expect(execution.result.meta.evidenceIds).toEqual([]);

    // The degradation is audited as an explicit BLOCKED operation.
    const after = await countAuditRows();
    expect(after).toBe(before + 1);
  });

  async function countAuditRows(): Promise<number> {
    const rows = await tdb.engine.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sec.sec_audit_events`,
    );
    return Number(rows.rows[0]?.n ?? '0');
  }
});
