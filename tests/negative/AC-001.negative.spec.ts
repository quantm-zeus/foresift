/**
 * AC-001 negative / failure-path — TOOL-CORE FACET.
 * Traces: FR-CORE-001, FR-CORE-002, FR-CORE-003, FR-CORE-004.
 *
 * The tool-core facet of AC-001 must FAIL closed on its two exposure axes:
 *   - NO SILENT GAP: an unavailable optional source may never surface as a
 *     success-shaped envelope or skip the audit trail — the degradation is a
 *     typed blocked exit, audited, with no evidence claimed;
 *   - NO OUT-OF-PROFILE EXPOSURE: scoped listing and scoped execution both
 *     refuse tools outside the caller's profile (§16.9 exclusion rule).
 *
 * Facets later packages add to this AC's negative space (out of scope here):
 * MCP transport-level refusal framing (FR-MCP-001…012) and real-adapter
 * egress refusals behind the perimeter.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { utcTimestamp, type ToolProfileId, type UtcTimestamp } from '@foresift/domain';
import type { ToolDefinitionMetadata } from '@foresift/shared-schemas';
import {
  closeTestDatabase,
  makeTestDatabase,
  type TestDatabase,
} from '../acceptance/helpers.ts';
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

function stubAuthn(): AuthnPrimitive {
  return {
    async authenticate({ token }) {
      if (token !== 'credential-1') throw new Error('bad credential');
      return {
        actorId: 'user-1',
        holderMode: 'CHATGPT' as const,
        // The credential carries the DISCOVERY profile — narrower than any
        // holder-wallet/admin surface by construction of these scenarios.
        profileId: 'discovery' as ToolProfileId,
        scopes: ['assets:read'],
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
}

function compose(): Scenario {
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
        return {
          allowed: true,
          policyVersion: freshLicenseVersion(),
          reason: 'fixture verified rights',
        };
      },
    },
    quota: new ReferenceQuotaAdapter(tdb.engine),
    screen: new ProhibitedCapabilityScreen(),
    egress: allowEgress(),
  });
  return { core, registry };
}

async function registerDefinition(
  registry: ToolCoreRegistry,
  opts: {
    profiles?: ToolProfileId[];
    execute?: (input: unknown) => Promise<unknown>;
  } = {},
): Promise<string> {
  const name = `get_asset_identity_${Math.random().toString(36).slice(2, 8)}`;
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

interface AuditRow {
  seq: number;
  action_class: string;
  payload: Record<string, unknown>;
}

async function auditRows(): Promise<AuditRow[]> {
  const result = await tdb.engine.query<{
    seq: number;
    action_class: string;
    payload_canonical: string;
  }>(`SELECT seq, action_class, payload_canonical FROM sec.sec_audit_events ORDER BY seq ASC`);
  return result.rows.map((row) => ({
    seq: row.seq,
    action_class: row.action_class,
    payload: JSON.parse(row.payload_canonical) as Record<string, unknown>,
  }));
}

// ── suites ───────────────────────────────────────────────────────────────────

describe('AC-001 negative · tool-core facet', () => {
  it('an unavailable optional source leaves NO silent gap — typed exit, audited, zero evidence claimed', async () => {
    const scenario = compose();
    const toolName = await registerDefinition(scenario.registry, {
      execute: async () => {
        throw new Error('source unavailable');
      },
    });

    const before = (await auditRows()).length;
    const execution = await scenario.core.execute(discoveryRequest(toolName));
    const rows = await auditRows();

    // A silent gap would be ANY of: a success-shaped envelope, missing audit
    // row, or evidence claimed for data that was never retrieved. None occur.
    expect(execution.result.meta.partial).toBe(true);
    expect(execution.result.meta.cache).toBe('MISS');
    expect(execution.result.meta.evidenceIds).toEqual([]);
    const data = execution.result.data as Record<string, unknown>;
    expect(data['acquisitionState']).toBe('PROVIDER_UNAVAILABLE');

    expect(rows.length).toBe(before + 1); // exactly one explicit audit record
    const last = rows[rows.length - 1]!;
    expect(last.action_class).toBe('BLOCKED_OPERATION');
    expect(last.payload['outcome']).toBe('BLOCKED');
  });

  it('profile-scoped listing never exposes out-of-profile tools', async () => {
    const scenario = compose();
    await registerDefinition(scenario.registry); // discovery-bound
    const walletBound = await registerDefinition(scenario.registry, {
      profiles: ['holder-wallet' as ToolProfileId],
    });
    const adminBound = await registerDefinition(scenario.registry, {
      profiles: ['admin-read' as ToolProfileId],
    });

    const listedNames = scenario.registry.listByProfile('discovery').map((e) => e.metadata.name);
    expect(listedNames).not.toContain(walletBound);
    expect(listedNames).not.toContain(adminBound);
  });

  it('execution with a credential outside the tool bound profiles is refused and audited', async () => {
    const scenario = compose();
    // Tool bound ONLY to holder-wallet; the credential carries discovery.
    const toolName = await registerDefinition(scenario.registry, {
      profiles: ['holder-wallet' as ToolProfileId],
    });

    const before = (await auditRows()).length;
    const execution = await scenario.core.execute(discoveryRequest(toolName));

    const data = execution.result.data as { acquisitionState: string; machineReason: string };
    expect(data.acquisitionState).toBe('RIGHTS_BLOCKED');
    expect(data.machineReason).toContain('AUTHZ_PROFILE_NOT_BOUND');
    expect(execution.result.meta.partial).toBe(true);
    expect(execution.result.meta.evidenceIds).toEqual([]);

    const rows = await auditRows();
    expect(rows.length).toBe(before + 1);
    expect(rows[rows.length - 1]!.action_class).toBe('BLOCKED_OPERATION');
  });
});
