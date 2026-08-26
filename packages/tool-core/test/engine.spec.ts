/**
 * Engine units over PGlite (FR-CORE-002…008; PRD §16.2): the composition-root
 * defaults, the pinned stage order, the success path end-to-end (including
 * exact-cache serving without re-dispatch), fault tolerance, and the
 * every-exit-audited property across the blocked taxonomy. Quota semantics
 * arrive via THE reference adapter fixture that lives outside
 * packages/tool-core/** (milestone boundary).
 *
 * Each test composes a fresh core and registers uniquely named tools so the
 * shared database never sees colliding (name, version) rows across registries.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PIPELINE_STAGE_ORDER,
  utcTimestamp,
  type ToolProfileId,
  type UtcTimestamp,
} from '@foresift/domain';
import {
  closeTestDatabase,
  makeTestDatabase,
  type TestDatabase,
} from '../../../tests/acceptance/helpers.ts';
import { ReferenceQuotaAdapter } from '../../../tests/fixtures/core/reference-adapters.ts';
import { createToolCore, type ToolCoreEngine } from '../src/index.ts';
import { RUNTIME_STAGE_SEQUENCE } from '../src/pipeline.ts';
import { ToolCoreRegistry } from '../src/registry.ts';
import { CacheStageChain } from '../src/stages/cache.ts';
import type { CacheStageChain as CacheStageChainType } from '../src/stages/cache.ts';
import { SingleFlightManager } from '../src/single-flight.ts';
import { ProhibitedCapabilityScreen } from '../src/prohibited.ts';
import type { ToolDefinitionMetadata } from '@foresift/shared-schemas';
import type { BoundSchema } from '../src/schema.ts';
import type { AuthenticatedActor, AuthnPrimitive, AuthzPrimitive } from '../src/stages/authn.ts';
import type { EgressGuardLike } from '../src/stages/dispatch.ts';
import type { LicensePolicySource } from '../src/license-contract.ts';
import type { QuotaReservationAdapter } from '../src/quota-contract.ts';

const T0 = Date.parse('2026-08-01T00:00:00Z');

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

// ── fixture doubles ──────────────────────────────────────────────────────────

/** Schema-shaped BoundSchema double: accepts everything, echoes the input. */
const passthroughSchema: BoundSchema = {
  safeParse: (data: unknown) => ({ success: true, data }),
};

const refusingSchema: BoundSchema = {
  safeParse: () => ({
    success: false,
    error: { issues: [{ path: ['assetId'], message: 'required' }] },
  }),
};

interface ActorOverrides {
  scopes?: string[];
}

function stubAuthn(over: ActorOverrides = {}): AuthnPrimitive {
  return {
    async authenticate({ token }) {
      if (token !== 'credential-1') throw new Error('bad credential');
      const actor: AuthenticatedActor = {
        actorId: 'user-1',
        holderMode: 'CHATGPT',
        profileId: 'discovery' as ToolProfileId,
        scopes: over.scopes ?? ['assets:read'],
      };
      return actor;
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

function allowLicense(version = 'rights/v1'): LicensePolicySource {
  return {
    async verdict() {
      return { allowed: true, policyVersion: version, reason: 'fixture verified rights' };
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

function defaultPayload() {
  return {
    data: { assetId: 'a-1' },
    observedAt: '2026-08-01T00:00:00Z',
    availableAt: '2026-08-01T00:00:01Z',
    qualityCodes: ['OK'],
  };
}

function metadata(name: string): ToolDefinitionMetadata {
  return {
    name,
    version: '1.0.0',
    title: name,
    description: `Fixture definition for ${name}.`,
    actionClass: 'EXTERNAL_READ',
    profiles: [('discovery' as ToolProfileId)],
    requiredScopes: ['assets:read'],
    cachePolicyId: 'exact-default',
    quotaPolicyId: 'strict-free-default',
    licensePolicyId: 'rights-verified-only',
    estimatedCost: {},
    inputSchemaJson: { type: 'object' },
    outputSchemaJson: { type: 'object' },
  } as unknown as ToolDefinitionMetadata;
}

interface ComposeResult {
  core: ToolCoreEngine;
  registry: ToolCoreRegistry;
  tick: (ms: number) => void;
  /** The scenario's policy version — also its exact-cache-key namespace. */
  licenseVersion: string;
}

interface ComposeOverrides {
  /** Omit for the standard permissive stub; pass null for NO primitive at all. */
  authn?: AuthnPrimitive | null;
  authz?: AuthzPrimitive;
  /** Omit for the standard permissive stub; pass null to exercise the deny-closed default. */
  licenseSource?: LicensePolicySource | null;
  egress?: EgressGuardLike;
  quota?: QuotaReservationAdapter;
  cacheChain?: CacheStageChainType;
  deadlineMs?: number;
  leaseWaitDeadlineMs?: number;
  licenseVersion?: string;
  /** Reuse another scenario's registry (entries stay resolvable). */
  registry?: ToolCoreRegistry;
}

/** Full working composition on the shared test database with a stepped clock. */
function compose(over: ComposeOverrides = {}): ComposeResult {
  let t = T0;
  const licenseVersion = over.licenseVersion ?? freshLicenseVersion();
  const now = (): UtcTimestamp => utcTimestamp(new Date(t).toISOString());
  // A shared registry keeps entries resolvable across compositions (e.g. a
  // cold second core contending for a lease still resolves THE tool).
  const registry = over.registry ?? new ToolCoreRegistry({ engine: tdb.engine, now });
  const core = createToolCore({
    engine: tdb.engine,
    clock: () => new Date(t).toISOString(),
    registry,
    cacheChain: over.cacheChain ?? new CacheStageChain({ engine: tdb.engine, now }),
    singleFlight: new SingleFlightManager({ engine: tdb.engine, now }),
    ...(over.authn === null ? {} : { authn: over.authn ?? stubAuthn() }),
    authz: over.authz ?? allowAuthz(),
    ...(over.licenseSource === null
      ? {}
      : { licenseSource: over.licenseSource ?? allowLicense(licenseVersion) }),
    quota: over.quota ?? new ReferenceQuotaAdapter(tdb.engine),
    screen: new ProhibitedCapabilityScreen(),
    egress: over.egress ?? allowEgress(),
    ...(over.deadlineMs !== undefined ? { deadlineMs: over.deadlineMs } : {}),
    ...(over.leaseWaitDeadlineMs !== undefined
      ? { leaseWaitDeadlineMs: over.leaseWaitDeadlineMs }
      : {}),
  });
  return { core, registry, tick: (ms: number) => (t += ms), licenseVersion };
}

/** Register a uniquely named clean tool; returns its name for the request. */
async function registerTool(
  registry: ToolCoreRegistry,
  opts: {
    execute?: (input: unknown) => Promise<unknown>;
    inputSchema?: BoundSchema;
    suffix?: string;
  } = {},
): Promise<string> {
  const name = `get_asset_identity_${opts.suffix ?? Math.random().toString(36).slice(2, 8)}`;
  await registry.register({
    metadata: metadata(name),
    execute: opts.execute ?? (async () => defaultPayload()),
    inputSchema: opts.inputSchema ?? passthroughSchema,
    outputSchema: passthroughSchema,
  });
  return name;
}

type TestRequest = ReturnType<typeof makeRequest>;

function makeRequest(toolName: string, overrides: Record<string, unknown> = {}) {
  return {
    toolName,
    toolVersion: '1.0.0',
    // The reference quota adapter prices THIS operation; tool names stay
    // unique per test for registry isolation while the operation is shared.
    operation: 'token_security',
    input: { assetId: 'a-1' },
    actorToken: 'credential-1',
    workloadClass: 'SCHEDULED_NORMAL' as const,
    holderMode: 'CHATGPT' as const,
    profileId: 'discovery' as ToolProfileId,
    ...overrides,
  };
}

async function baseScenario(
  over: ComposeOverrides & {
    execute?: (input: unknown) => Promise<unknown>;
    inputSchema?: BoundSchema;
  } = {},
): Promise<{ scenario: ComposeResult; toolName: string }> {
  const scenario = compose(over);
  const toolName = await registerTool(scenario.registry, over);
  return { scenario, toolName };
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
    // The chain stores THE canonical JSON form — parse for assertions.
    payload: JSON.parse(row.payload_canonical) as Record<string, unknown>,
  }));
}

// ── suites ───────────────────────────────────────────────────────────────────

describe('pinned stage order', () => {
  it('exposes exactly the domain PIPELINE_STAGE_ORDER at runtime', () => {
    expect(RUNTIME_STAGE_SEQUENCE).toEqual(PIPELINE_STAGE_ORDER);
  });

  it('records every executed stage in pinned order on the run context', async () => {
    const { scenario, toolName } = await baseScenario();
    const execution = await scenario.core.execute(makeRequest(toolName));
    expect(execution.result.meta.partial).toBe(false);
    expect(execution.context.completedTrace).toEqual([...PIPELINE_STAGE_ORDER]);
  });
});

describe('deny-closed composition defaults', () => {
  it('refuses authentication when no authn primitive is bound', async () => {
    const { scenario, toolName } = await baseScenario({ authn: null });
    const before = (await auditRows()).length;
    const execution = await scenario.core.execute(makeRequest(toolName));
    const data = execution.result.data as { acquisitionState: string; machineReason: string };
    expect(data.acquisitionState).toBe('RIGHTS_BLOCKED');
    expect(data.machineReason).toContain('AUTHN_REFUSED');
    expect(execution.result.meta.partial).toBe(true);
    expect(execution.result.meta.qualityCodes).toContain('PIPELINE_BLOCKED');

    const rows = await auditRows();
    expect(rows.length).toBe(before + 1); // every exit audited — even authn
    expect(rows[rows.length - 1]!.action_class).toBe('BLOCKED_OPERATION');
  });

  it('refuses authorization when the authz primitive denies', async () => {
    const { scenario, toolName } = await baseScenario({
      authz: {
        async authorize() {
          return { allowed: false, reason: 'not on the call list' };
        },
      },
    });
    const execution = await scenario.core.execute(makeRequest(toolName));
    const data = execution.result.data as { acquisitionState: string; machineReason: string };
    expect(data.acquisitionState).toBe('RIGHTS_BLOCKED');
    expect(data.machineReason).toBe('AUTHZ_REFUSED:not on the call list');
  });

  it('refuses rights when no license source is composed', async () => {
    const { scenario, toolName } = await baseScenario({ licenseSource: null });
    const execution = await scenario.core.execute(makeRequest(toolName));
    const data = execution.result.data as { acquisitionState: string; machineReason: string };
    expect(data.acquisitionState).toBe('RIGHTS_BLOCKED');
    expect(data.machineReason).toContain('LICENSE_POLICY_REFUSED');
  });

  it('refuses unknown tools instead of guessing an entry', async () => {
    const { core } = compose();
    const execution = await core.execute(makeRequest('no_such_tool'));
    const data = execution.result.data as { acquisitionState: string; machineReason: string };
    expect(data.acquisitionState).toBe('CAPABILITY_UNAVAILABLE');
    expect(data.machineReason).toBe('TOOL_UNKNOWN:not registered or retired');
  });

  it('refuses input that fails the bound schema before any state is written', async () => {
    const { scenario, toolName } = await baseScenario({ inputSchema: refusingSchema });
    const execution = await scenario.core.execute(makeRequest(toolName));
    const data = execution.result.data as { machineReason: string };
    expect(data.machineReason).toContain('INPUT_SCHEMA_INVALID');
    // No well-formed acquisition target → no row persisted.
    expect(execution.context.acquisitionPersistedAs).toBeNull();
  });
});

describe('success path end-to-end', () => {
  it('dispatches once, freezes evidence, caches, commits quota, completes RETURNED', async () => {
    let calls = 0;
    const reference = new ReferenceQuotaAdapter(tdb.engine);
    let commitCount = 0;
    const countingQuota: QuotaReservationAdapter = {
      estimate: (r) => reference.estimate(r),
      admit: (r) => reference.admit(r),
      reserve: (r) => reference.reserve(r),
      commit: async (r) => {
        commitCount += 1;
        await reference.commit(r);
      },
      release: (r) => reference.release(r),
    };
    const { scenario, toolName } = await baseScenario({
      quota: countingQuota,
      execute: async () => {
        calls += 1;
        return {
          data: { assetId: 'a-1' },
          observedAt: '2026-08-01T00:00:00Z',
          availableAt: '2026-08-01T00:00:01Z',
        };
      },
    });
    const request = makeRequest(toolName);

    const first = await scenario.core.execute(request);
    expect(first.result.meta.partial).toBe(false);
    expect(first.result.data).toEqual({ assetId: 'a-1' });
    expect(first.result.meta.evidenceIds.length).toBeGreaterThanOrEqual(1);
    expect(first.result.meta.observedAt).toBe('2026-08-01T00:00:00Z');
    expect(first.result.meta.cache).toBe('REFRESHED');
    expect(first.result.meta.quota.reservationState).toBe('COMMITTED');
    expect(first.result.meta.quota.actualUnits).toBe(1);
    expect(calls).toBe(1);

    // Acquisition row completed RETURNED with evidence attached.
    expect(first.context.retrievalCompleted).toBe(true);
    const acq = await tdb.engine.query<{ state: string; evidence_ids: string[] }>(
      `SELECT state, evidence_ids FROM evidence_acquisition_decisions WHERE decision_id = $1`,
      [first.context.decisionId],
    );
    expect(acq.rows[0]?.state).toBe('RETURNED');
    expect((acq.rows[0]?.evidence_ids ?? []).length).toBeGreaterThanOrEqual(1);

    // Second identical call is SERVED by the exact cache — no re-dispatch,
    // no second reservation; freshness is computed from the stored entry.
    const second = await scenario.core.execute(request);
    expect(calls).toBe(1);
    expect(second.result.meta.cache).toBe('HIT_FRESH');
    expect(second.result.data).toEqual({ assetId: 'a-1' });
    expect(second.result.meta.evidenceIds.length).toBeGreaterThanOrEqual(1);
    expect(second.result.meta.freshnessSeconds).toBeDefined();
    expect(second.result.meta.observedAt).toBe('2026-08-01T00:00:00Z');
    expect(commitCount).toBe(1);
    expect(second.context.completedTrace).toEqual([...PIPELINE_STAGE_ORDER]);
  });

  it('audits exactly once per successful run with PROVIDER_COLLECTOR_ACCESS', async () => {
    const { scenario, toolName } = await baseScenario();
    const before = (await auditRows()).length;
    const execution = await scenario.core.execute(makeRequest(toolName));
    const rows = await auditRows();
    expect(rows.length).toBe(before + 1);
    const last = rows[rows.length - 1]!;
    expect(last.action_class).toBe('PROVIDER_COLLECTOR_ACCESS');
    expect(last.payload['outcome']).toBe('SUCCESS');
    // The audit append happens DURING stage 23 — its snapshot holds stages
    // 1–22; the post-run context carries all 24 (asserted above).
    expect(last.payload['trace']).toEqual([...PIPELINE_STAGE_ORDER.slice(0, 22)]);
    expect(execution.context.auditSeq).not.toBeNull();
  });
});

describe('every blocked exit is audited and returned structurally', () => {
  async function expectBlockedExit(
    core: ToolCoreEngine,
    request: TestRequest,
    expected: { state: string; reasonPart: string },
  ) {
    const before = (await auditRows()).length;
    const execution = await core.execute(request);
    const rows = await auditRows();
    expect(rows.length).toBe(before + 1);
    expect(rows[rows.length - 1]!.action_class).toBe('BLOCKED_OPERATION');
    expect(rows[rows.length - 1]!.payload['outcome']).toBe('BLOCKED');

    const data = execution.result.data as Record<string, unknown>;
    expect(data['acquisitionState']).toBe(expected.state);
    expect(String(data['machineReason'])).toContain(expected.reasonPart);
    expect(execution.result.meta.partial).toBe(true);
    return execution;
  }

  it('audits and structures the NOT_REQUESTED_BY_POLICY decision exit', async () => {
    const { scenario, toolName } = await baseScenario();
    const execution = await expectBlockedExit(
      scenario.core,
      makeRequest(toolName, {
        acquisitionDecision: {
          action: 'NOT_REQUESTED',
          policyVersion: 'policy/v9',
          reason: 'outside probe stratum',
        },
      }),
      { state: 'NOT_REQUESTED_BY_POLICY', reasonPart: 'NOT_REQUESTED_BY_POLICY:policy/v9' },
    );
    // The opening record IS the terminal verdict — persisted, never completed.
    expect(execution.context.acquisitionPersistedAs).toBe('NOT_REQUESTED_BY_POLICY');
    expect(execution.context.retrievalCompleted).toBe(false);
  });

  it('audits QUOTA_EXHAUSTED backpressure as an explicit typed outcome', async () => {
    const { scenario, toolName } = await baseScenario({
      quota: {
        estimate: async () => ({ quotaModel: 'CREDIT_BALANCE', estimatedUnits: 5 }),
        admit: async () => ({ allowed: false, reason: 'QUOTA_EXHAUSTED:budget drained' }),
        reserve: async () => {
          throw new Error('must not reserve');
        },
        commit: async () => {},
        release: async () => {},
      },
    });
    const execution = await expectBlockedExit(
      scenario.core,
      makeRequest(toolName),
      { state: 'QUOTA_BLOCKED', reasonPart: 'BACKPRESSURE_QUOTA_EXHAUSTED' },
    );
    expect(execution.context.backpressure).toBe('QUOTA_EXHAUSTED');
    expect(execution.result.meta.qualityCodes).toContain('PIPELINE_BLOCKED');
  });

  it('maps unknown cost to COST_BLOCKED through the seam refusal', async () => {
    const { scenario, toolName } = await baseScenario();
    await expectBlockedExit(
      scenario.core,
      // The reference adapter prices only its known operations — anything
      // else is refused fail-closed at the estimate seam.
      makeRequest(toolName, { operation: 'unknown_diagnostic_op' }),
      { state: 'COST_BLOCKED', reasonPart: 'UNKNOWN_COST' },
    );
  });

  it('maps a deadline overrun to TIMED_OUT and completes the REQUESTED row', async () => {
    const { scenario, toolName } = await baseScenario({
      deadlineMs: 5,
      execute: () =>
        new Promise((resolve) => setTimeout(resolve, 400)).then(() => ({ slow: true })),
    });
    const execution = await expectBlockedExit(
      scenario.core,
      makeRequest(toolName),
      { state: 'TIMED_OUT', reasonPart: 'TIMED_OUT:DEADLINE_EXCEEDED' },
    );
    const acq = await tdb.engine.query<{ state: string }>(
      `SELECT state FROM evidence_acquisition_decisions WHERE decision_id = $1`,
      [execution.context.decisionId],
    );
    expect(acq.rows[0]?.state).toBe('TIMED_OUT');
    expect(execution.context.reservationSettledAs).toBe('RELEASED');
    expect(execution.context.retrievalCompleted).toBe(true);
  });

  it('enforces the prohibited-financial gate at execution time regardless of registration', async () => {
    const { scenario, toolName } = await baseScenario({
      // An admitting quota seam isolates the gate: the run passes every
      // rights/quota check and STILL refuses at the execution boundary.
      quota: {
        estimate: async () => ({ quotaModel: 'RATE_ONLY', estimatedUnits: 1 }),
        admit: async () => ({ allowed: true, reason: 'fixture allow' }),
        reserve: async () => 'rsv-gate-spec',
        commit: async () => {},
        release: async () => {},
      },
    });
    // Clean registered definition … but the caller resolves a trading-shaped
    // OPERATION name — the gate re-checks the resolved identity at stage 14.
    const execution = await expectBlockedExit(
      scenario.core,
      makeRequest(toolName, { operation: 'execute_swap' }),
      { state: 'CAPABILITY_UNAVAILABLE', reasonPart: 'PROHIBITED_FINANCIAL_EXECUTION_REFUSED' },
    );
    expect(execution.context.rawResponse).toBeUndefined();
  });
});

describe('fault tolerance and settlement resilience', () => {
  it('converts an unexpected stage fault into a typed ERROR exit that is audited and still returned', async () => {
    const explodingChain = {
      lookup: async () => {
        throw new Error('cache chain boom');
      },
      postLeaseRecheck: async () => {
        throw new Error('unreachable');
      },
      storeIfPermitted: async () => false,
    } as unknown as CacheStageChainType;
    const { scenario, toolName } = await baseScenario({ cacheChain: explodingChain });
    const before = (await auditRows()).length;
    const execution = await scenario.core.execute(makeRequest(toolName));

    const data = execution.result.data as { machineReason: string };
    expect(data.machineReason).toContain('INTERNAL_ERROR:CHECK_REQUEST_LOCAL_MEMOIZATION');
    expect(data.machineReason).toContain('cache chain boom');
    expect(execution.context.degradedMarkers).toContain(
      'STAGE_FAULT:CHECK_REQUEST_LOCAL_MEMOIZATION',
    );

    const rows = await auditRows();
    expect(rows.length).toBe(before + 1); // even internal faults are audited
    const payload = rows[rows.length - 1]!.payload as Record<string, unknown>;
    expect(payload['outcome']).toBe('ERROR');
    expect(execution.result.meta.qualityCodes).toContain('PIPELINE_INTERNAL_ERROR');
  });

  it('survives a quota-commit fault without losing the structured result', async () => {
    const { scenario, toolName } = await baseScenario({
      quota: {
        estimate: async () => ({ quotaModel: 'RATE_ONLY', estimatedUnits: 1 }),
        admit: async () => ({ allowed: true, reason: 'ok' }),
        reserve: async () => 'rsv-engine-spec-faulty',
        commit: async () => {
          throw new Error('ledger write failed');
        },
        release: async () => {},
      },
      execute: async () => ({ plain: 'payload' }),
    });
    const execution = await scenario.core.execute(makeRequest(toolName));
    expect(execution.result.meta.partial).toBe(false);
    expect(execution.result.data).toEqual({ plain: 'payload' });
  });

  it('exits QUEUE backpressure on a contended lease instead of calling in parallel', async () => {
    const { scenario, toolName } = await baseScenario();
    const request = makeRequest(toolName);
    const first = await scenario.core.execute(request);
    expect(first.result.meta.cache).toBe('REFRESHED');
    const keyHash = first.context.cacheKey!.cacheKeyHash;

    // Expire the cached entry so the next same-key run MUST take the lease
    // path. The window-shape CHECK (stored_at <= fresh_until <= stale_until)
    // stays satisfied — all three move into the past together.
    await tdb.engine.query(
      `UPDATE core.core_exact_cache_entries
       SET stored_at = '1970-01-01T00:00:00Z',
           fresh_until = '1970-01-01T00:01:00Z',
           stale_until = '1970-01-01T00:02:00Z'
       WHERE cache_key_hash = $1`,
      [keyHash],
    );

    // A live lease from ANOTHER holder occupies the exact resource…
    const mgr = new SingleFlightManager({
      engine: tdb.engine,
      now: () => '2026-08-02T00:00:00Z',
    });
    await mgr.acquire({
      resourceKeyHash: keyHash,
      holderMode: 'AUTOMATION',
      holderId: 'other-runner',
      ttlSeconds: 3600,
    });

    // …so the contended run waits its bounded wait, then exits QUEUE —
    // it can never issue an uncontrolled parallel external call. A cold memo
    // chain forces the persisted lookup rather than in-memory reuse; the SAME
    // license version keeps the exact key identical to the first run's.
    const cold = compose({
      // Same registry instance — a cold core must still resolve THE tool.
      registry: scenario.registry,
      cacheChain: new CacheStageChain({
        engine: tdb.engine,
        now: () => utcTimestamp(new Date(T0 + 5000).toISOString()),
      }),
      leaseWaitDeadlineMs: 40,
      licenseVersion: scenario.licenseVersion,
    });
    cold.tick(5000);
    const execution = await cold.core.execute(request);
    expect(execution.context.backpressure).toBe('QUEUE');
    expect(execution.context.exit?.payload.acquisitionState).toBe('QUOTA_BLOCKED');
    expect(execution.context.exit?.payload.machineReason).toContain('BACKPRESSURE_QUEUE');
    expect(execution.result.data).toMatchObject({ acquisitionState: 'QUOTA_BLOCKED' });
  });
});
