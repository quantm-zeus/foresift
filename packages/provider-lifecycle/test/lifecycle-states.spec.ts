// T108 completeness: the seven-state lifecycle graph, the SQL CHECK
// constraint alphabet on prov.prov_operations.current_state, and the Zod
// LifecycleStateSchema must agree EXACTLY. A value legal in one layer and
// not the others is a silent boundary gap, so every pair is asserted here.
import { describe, expect, it } from 'vitest';
import {
  LifecycleStateSchema,
  PROVIDER_LIFECYCLE_STATES,
  EDGE_LIST,
  LEGAL_TRANSITIONS,
  TERMINAL_STATES,
  assertTransitionLegal,
  isActiveServiceState,
  isLegalTransition,
} from '../src/lifecycle-states.ts';
import { makeProvStack, closeProvStack } from './helpers.ts';

describe('lifecycle state completeness (T108)', () => {
  it('exposes exactly the seven §12.11 states', () => {
    expect(PROVIDER_LIFECYCLE_STATES).toEqual([
      'DISCOVERED',
      'VERIFIED',
      'ACTIVE',
      'DEGRADED',
      'DEPRECATED',
      'BLOCKED',
      'REMOVED',
    ]);
  });

  it('Zod schema accepts exactly the constant alphabet', () => {
    for (const state of PROVIDER_LIFECYCLE_STATES) {
      expect(LifecycleStateSchema.safeParse(state).success).toBe(true);
    }
    const outside = ['active', 'PAUSED', 'RETIRED', ''];
    for (const candidate of outside) {
      expect(LifecycleStateSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it('graph edges are exactly LEGAL_TRANSITIONS and none self-loop', () => {
    expect(LEGAL_TRANSITIONS.size).toBe(PROVIDER_LIFECYCLE_STATES.length);
    for (const state of PROVIDER_LIFECYCLE_STATES) {
      const targets = LEGAL_TRANSITIONS.get(state) ?? [];
      expect([...targets].sort()).toEqual(
        EDGE_LIST.filter((e) => e.from === state).map((e) => e.to).sort(),
      );
    }
    for (const edge of EDGE_LIST) {
      expect(edge.from).not.toBe(edge.to);
    }
  });

  it('REMOVED is terminal: no outgoing edges exist', () => {
    expect(TERMINAL_STATES).toEqual(['REMOVED']);
    expect(EDGE_LIST.filter((e) => e.from === 'REMOVED')).toEqual([]);
  });

  it('every non-terminal state has at least one outgoing edge (no dead ends)', () => {
    for (const state of PROVIDER_LIFECYCLE_STATES) {
      if (TERMINAL_STATES.includes(state)) continue;
      expect(EDGE_LIST.some((e) => e.from === state), state).toBe(true);
    }
  });

  it('isLegalTransition / assertTransitionLegal agree with the graph', () => {
    for (const edge of EDGE_LIST) {
      expect(isLegalTransition(edge.from, edge.to)).toBe(true);
      expect(() => assertTransitionLegal(edge.from, edge.to)).not.toThrow();
    }
    expect(isLegalTransition('ACTIVE', 'ACTIVE')).toBe(false);
    expect(isLegalTransition('DISCOVERED', 'DEGRADED')).toBe(false);
    expect(() => assertTransitionLegal('DISCOVERED', 'DEGRADED')).toThrowError(
      'PROV_LIFECYCLE_TRANSITION_ILLEGAL',
    );
  });

  it('assertTransitionLegal refuses values outside the alphabet entirely', () => {
    expect(() => assertTransitionLegal('SUSPENDED' as never, 'ACTIVE')).toThrowError(
      'PROV_LIFECYCLE_STATE_UNKNOWN',
    );
  });

  it('SQL CHECK alphabet on prov_operations matches the TS/Zod alphabet exactly', async () => {
    const stack = await makeProvStack();
    try {
      // The CHECK lives on prov_operations.current_state; read its raw
      // definition from pg_constraint rather than trusting any mirror.
      const rows = await stack.engine.query<{ conname: string; pg_get_constraintdef: string }>(
        `SELECT conname, pg_get_constraintdef(oid) AS pg_get_constraintdef
         FROM pg_constraint
         WHERE conrelid = 'prov.prov_operations'::regclass AND contype = 'c'`,
      );
      const stateChecks = rows.rows.filter((r) => r.conname.includes('current_state'));
      expect(stateChecks.length).toBeGreaterThanOrEqual(1);
      for (const check of stateChecks) {
        for (const state of PROVIDER_LIFECYCLE_STATES) {
          expect(check.pg_get_constraintdef, `${check.conname} allows ${state}`).toContain(`'${state}'`);
        }
        // No state outside the alphabet may appear in any state CHECK.
        for (const foreign of ['PAUSED', 'RETIRED', 'SUSPENDED', 'UNVERIFIED']) {
          expect(check.pg_get_constraintdef).not.toContain(`'${foreign}'`);
        }
      }
      // And the storage layer itself refuses an unknown state.
      await expect(
        stack.engine.query(
          `INSERT INTO prov.prov_operations (
             provider_id, operation_id, version, capability_class,
             cost_class, current_state, health_status, supported_chains, input_schema_id,
             raw_output_schema_id, normalized_output_schema_id, quota_model_id, cache_policy_id,
             timeout_ms, retry_policy_id, declared_independence_group, upstream_lineage,
             license_policy_id, estimated_quota_units, quota_reset_policy_id,
             protected_reserve_eligible, allowed_in_strict_free, paid_fallback_allowed,
             verification_expires_at, forbidden_output_fields, negative_capabilities)
           VALUES ('p-x', 'op-x', '1', 'READ_MARKET', 'FREE_QUOTA', 'PAUSED', 'HEALTHY',
                   '[]'::jsonb, 'i', 'r', 'n', 'q', 'c', 1000, 'rp', 'g', '[]'::jsonb, 'l', 1,
                   'qr', false, true, false, '2026-08-02T00:00:00Z', '[]'::jsonb, '[]'::jsonb)`,
        ),
      ).rejects.toThrowError(/current_state/);
    } finally {
      await closeProvStack(stack);
    }
  });
});

describe('service-state helper', () => {
  it('marks only ACTIVE as the full-service state', () => {
    expect(isActiveServiceState('ACTIVE')).toBe(true);
    expect(isActiveServiceState('DEGRADED')).toBe(false);
    expect(isActiveServiceState('DISCOVERED')).toBe(false);
    expect(isActiveServiceState('BLOCKED')).toBe(false);
  });
});
