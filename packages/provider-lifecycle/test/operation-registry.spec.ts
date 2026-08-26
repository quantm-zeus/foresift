// Operation registry (FR-PROV-001/004): registration-time fail-closed gates
// for prohibited and unknown capability classes — the FIRST enforcement layer
// of the product's permanent read-only boundary — plus §15.3 field sanity.
import { describe, expect, it } from 'vitest';
import { PROHIBITED_CAPABILITY_CLASSES } from '../src/vocabularies.ts';
import { defaultOperationInput, makeProvStack, closeProvStack, T0 } from './helpers.ts';

describe('operation registry registration gates', () => {
  it('registers a valid operation into DISCOVERED/HEALTHY with normalized negative metadata', async () => {
    const stack = await makeProvStack();
    try {
      await stack.registry.registerProvider({
        providerId: 'prov-test',
        displayName: 'Test provider',
        providerGroup: 'g',
      });
      const op = await stack.registry.registerOperation(defaultOperationInput());
      expect(op.currentState).toBe('DISCOVERED');
      expect(op.healthStatus).toBe('HEALTHY');
      // Negative metadata ALWAYS covers all four prohibited classes.
      expect([...op.negativeCapabilities].sort()).toEqual(
        [...PROHIBITED_CAPABILITY_CLASSES].sort(),
      );
    } finally {
      await closeProvStack(stack);
    }
  });

  it('refuses every PROHIBITED_* capability class with PROV_CAPABILITY_CLASS_PROHIBITED', async () => {
    const stack = await makeProvStack();
    try {
      await stack.registry.registerProvider({
        providerId: 'prov-test',
        displayName: 'Test provider',
        providerGroup: 'g',
      });
      for (const prohibited of PROHIBITED_CAPABILITY_CLASSES) {
        await expect(
          stack.registry.registerOperation(
            defaultOperationInput({ capabilityClass: prohibited as never }),
          ),
        ).rejects.toMatchObject({ code: 'PROV_CAPABILITY_CLASS_PROHIBITED' });
      }
      // And NOTHING was persisted: the refusal precedes any row.
      const ops = await stack.engine.query('SELECT * FROM prov.prov_operations');
      expect(ops.rows).toHaveLength(0);
    } finally {
      await closeProvStack(stack);
    }
  });

  it('refuses capability classes outside BOTH alphabets with PROV_CAPABILITY_CLASS_UNKNOWN', async () => {
    const stack = await makeProvStack();
    try {
      await stack.registry.registerProvider({
        providerId: 'prov-test',
        displayName: 'Test provider',
        providerGroup: 'g',
      });
      await expect(
        stack.registry.registerOperation(
          defaultOperationInput({ capabilityClass: 'WRITE_LEDGER' as never }),
        ),
      ).rejects.toMatchObject({ code: 'PROV_CAPABILITY_CLASS_UNKNOWN' });
    } finally {
      await closeProvStack(stack);
    }
  });

  it('the SQL CHECK makes prohibited classes unrepresentable even via raw SQL', async () => {
    const stack = await makeProvStack();
    try {
      await stack.registry.registerProvider({
        providerId: 'p-x',
        displayName: 'x',
        providerGroup: 'g',
      });
      await expect(
        stack.engine.query(
          `INSERT INTO prov.prov_operations (
             provider_id, operation_id, version, capability_class, cost_class,
             supported_chains, input_schema_id, raw_output_schema_id,
             normalized_output_schema_id, quota_model_id, cache_policy_id, timeout_ms,
             retry_policy_id, declared_independence_group, upstream_lineage,
             license_policy_id, estimated_quota_units, quota_reset_policy_id,
             protected_reserve_eligible, allowed_in_strict_free, paid_fallback_allowed,
             verification_expires_at, forbidden_output_fields, negative_capabilities)
           VALUES ('p-x','op-x','1','PROHIBITED_SIGN','FREE_QUOTA','[]'::jsonb,'i','r','n',
                   'q','c',1000,'rp','g','[]'::jsonb,'l',1,'qr',false,true,false,
                   '2026-08-02T00:00:00Z','[]'::jsonb,'[]'::jsonb)`,
        ),
      ).rejects.toThrowError(/capability_class/);
    } finally {
      await closeProvStack(stack);
    }
  });

  it('refuses operations whose provider is unknown (PROV_PROVIDER_UNKNOWN)', async () => {
    const stack = await makeProvStack();
    try {
      await expect(
        stack.registry.registerOperation(
          defaultOperationInput({ ref: { providerId: 'never-registered' } }),
        ),
      ).rejects.toMatchObject({ code: 'PROV_PROVIDER_UNKNOWN' });
    } finally {
      await closeProvStack(stack);
    }
  });

  it('a deprecated definition requires a replacement operation id', async () => {
    const stack = await makeProvStack();
    try {
      await stack.registry.registerProvider({
        providerId: 'prov-test',
        displayName: 'Test provider',
        providerGroup: 'g',
      });
      // Deprecated WITHOUT a replacement (key omitted entirely).
      const { replacementOperationId: _omitted, ...noReplacement } = defaultOperationInput({
        deprecatedAt: T0,
      });
      void _omitted;
      await expect(
        stack.registry.registerOperation(noReplacement),
      ).rejects.toMatchObject({ code: 'PROV_DEFINITION_INVALID' });
      // With a replacement it registers.
      const op = await stack.registry.registerOperation(
        defaultOperationInput({
          deprecatedAt: T0,
          replacementOperationId: 'get-token-price-v2',
        }),
      );
      expect(op.replacementOperationId).toBe('get-token-price-v2');
    } finally {
      await closeProvStack(stack);
    }
  });

  it('sanity-checks timeout and quota units before persisting', async () => {
    const stack = await makeProvStack();
    try {
      await stack.registry.registerProvider({
        providerId: 'prov-test',
        displayName: 'Test provider',
        providerGroup: 'g',
      });
      await expect(
        stack.registry.registerOperation(defaultOperationInput({ timeoutMs: 0 })),
      ).rejects.toMatchObject({ code: 'PROV_DEFINITION_INVALID' });
      await expect(
        stack.registry.registerOperation(defaultOperationInput({ estimatedQuotaUnits: -1 })),
      ).rejects.toMatchObject({ code: 'PROV_DEFINITION_INVALID' });
    } finally {
      await closeProvStack(stack);
    }
  });

  it('dependencies validate their consumer kind and serve sole-source queries', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedDefault(stack);
      await stack.registry.registerDependency({
        dependencyId: 'dep-1',
        consumerKind: 'FEATURE',
        consumerKey: 'feature:price-card',
        criticalField: 'token_price',
        target: op,
        registeredAt: T0,
      });
      await expect(
        stack.registry.registerDependency({
          dependencyId: 'dep-bad',
          consumerKind: 'CRON' as never,
          consumerKey: 'k',
          target: op,
          registeredAt: T0,
        }),
      ).rejects.toThrowError(/consumer kind/);
      const serving = await stack.registry.listActiveDependenciesForCriticalField('token_price');
      expect(serving).toHaveLength(1);
      expect(serving[0]?.dependencyId).toBe('dep-1');
      expect(serving[0]?.target.operationId).toBe(op.operationId);
    } finally {
      await closeProvStack(stack);
    }
  });
});

async function seedDefault(stack: Awaited<ReturnType<typeof makeProvStack>>) {
  await stack.registry.registerProvider({
    providerId: 'prov-test',
    displayName: 'Test provider',
    providerGroup: 'g',
  });
  return stack.registry.registerOperation(defaultOperationInput());
}
