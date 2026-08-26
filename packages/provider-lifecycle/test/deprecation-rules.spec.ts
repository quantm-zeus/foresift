// Deprecation rules (FR-PROV-003/007; §15.4 rules 1/2/4/6): new-dependency
// blocking with exception escape, sunset incidents carrying migration
// deadlines, sole-critical-source refusal, and STRICT_FREE availability.
import { describe, expect, it } from 'vitest';
import type { UtcTimestamp } from '@foresift/domain';
import { DeprecationRules } from '../src/deprecation-rules.ts';
import { makeProvStack, closeProvStack, seedOperation, T0 } from './helpers.ts';

const at = (iso: string) => iso as UtcTimestamp;

async function seedDeprecated(stack: Awaited<ReturnType<typeof makeProvStack>>) {
  const op = await seedOperation(stack, {
    deprecatedAt: T0,
    sunsetAt: at('2026-12-31T00:00:00Z'),
    replacementOperationId: 'get-token-price-v2',
  });
  return op;
}

describe('deprecation rules', () => {
  it('rule 1 — blocks NEW dependency registration on deprecated ops without a valid exception', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedDeprecated(stack);
      await expect(
        stack.deprecation.assertDependencyRegistrationAllowed(op, at('2026-08-02T00:00:00Z')),
      ).rejects.toMatchObject({ code: 'PROV_DEPRECATED_REGISTRATION_REFUSED' });

      // With an in-window exception the registration is allowed…
      await stack.exceptions.grant({
        exceptionId: 'exc-dep',
        ref: op,
        approver: 'ops',
        replacementPlanRef: 'plan://x',
        reason: 'r',
        createdAt: T0,
        expiresAt: at('2026-08-05T00:00:00Z'),
      });
      await expect(
        stack.deprecation.assertDependencyRegistrationAllowed(op, at('2026-08-02T00:00:00Z')),
      ).resolves.toBeUndefined();

      // …and it re-blocks automatically once the window lapses — the lapsed
      // exception is filtered out, so the plain registration refusal returns.
      await expect(
        stack.deprecation.assertDependencyRegistrationAllowed(op, at('2026-08-06T00:00:00Z')),
      ).rejects.toMatchObject({ code: 'PROV_DEPRECATED_REGISTRATION_REFUSED' });
    } finally {
      await closeProvStack(stack);
    }
  });

  it('rule 1 — non-deprecated operations register freely', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await expect(
        stack.deprecation.assertDependencyRegistrationAllowed(op, T0),
      ).resolves.toBeUndefined();
    } finally {
      await closeProvStack(stack);
    }
  });

  it('rule 2 — sunset dates open an incident carrying the migration deadline', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedDeprecated(stack);
      const { incidentId, migrationDeadline } = await stack.deprecation.evaluateSunset({
        ref: op,
        at: T0,
      });
      expect(migrationDeadline).toBe('2026-12-31T00:00:00Z');
      expect(incidentId).toBe('prov-sunset-prov-test-get-token-price-1.0.0');
      const incidents = await stack.engine.query<{ evidence_refs: string[]; kind: string }>(
        'SELECT evidence_refs, kind FROM sec.security_incidents WHERE incident_id = $1',
        [incidentId],
      );
      expect(incidents.rows[0]?.kind).toBe('OTHER');
      expect(incidents.rows[0]?.evidence_refs).toContain('migration-deadline:2026-12-31T00:00:00Z');
      // Re-evaluation is idempotent on the deterministic id (no duplicates).
      await stack.deprecation.evaluateSunset({ ref: op, at: at('2026-08-02T00:00:00Z') as UtcTimestamp });
      const count = await stack.engine.query<{ n: string }>(
        'SELECT COUNT(*)::text AS n FROM sec.security_incidents WHERE incident_id = $1',
        [incidentId],
      );
      expect(count.rows[0]?.n).toBe('1');
    } finally {
      await closeProvStack(stack);
    }
  });

  it('rule 2 — refuses to evaluate when there is no sunset AND no notice', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await expect(stack.deprecation.evaluateSunset({ ref: op, at: T0 })).rejects.toMatchObject({
        code: 'PROV_SUNSET_INCIDENT_REQUIRED',
      });
    } finally {
      await closeProvStack(stack);
    }
  });

  it('rule 6 — refuses when the operation is the SOLE source of a critical field', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await stack.registry.registerDependency({
        dependencyId: 'dep-sole',
        consumerKind: 'FEATURE',
        consumerKey: 'feature:price',
        criticalField: 'token_price',
        target: op,
        registeredAt: T0,
      });
      await expect(
        stack.deprecation.assertNotSoleCriticalSource(op, 'token_price'),
      ).rejects.toMatchObject({ code: 'PROV_SOLE_CRITICAL_SOURCE_REFUSED' });
      // A second ACTIVE source clears the refusal…
      const second = await seedOperation(stack, {
        ref: { providerId: 'prov-test', operationId: 'get-token-price-mirror', version: '1.0.0' },
      });
      await stack.registry.registerDependency({
        dependencyId: 'dep-second',
        consumerKind: 'FEATURE',
        consumerKey: 'feature:price-fallback',
        criticalField: 'token_price',
        target: second,
        registeredAt: T0,
      });
      await expect(
        stack.deprecation.assertNotSoleCriticalSource(op, 'token_price'),
      ).resolves.toBeUndefined();
      // …and an operation serving nothing is never blocked by the rule.
      await expect(
        stack.deprecation.assertNotSoleCriticalSource(second, 'unrelated_field'),
      ).resolves.toBeUndefined();
    } finally {
      await closeProvStack(stack);
    }
  });

  it('rule 4 — STRICT_FREE needs both the declaration flag and proven plan verification', () => {
    // Rule 4 is pure: construct the rules with unused placeholder deps.
    const rules = new DeprecationRules(null as never, null as never);
    const declared = { allowedInStrictFree: true, providerId: 'p', operationId: 'o', version: '1' };
    const undeclared = { allowedInStrictFree: false, providerId: 'p', operationId: 'o', version: '1' };
    // Not declared → disabled regardless of verification.
    expect(rules.strictFreeAvailability(undeclared, true)).toMatchObject({
      available: false,
      disabledMetadata: { reason: 'NOT_DECLARED_STRICT_FREE' },
    });
    // Declared but plan verification unproven → disabled.
    expect(rules.strictFreeAvailability(declared, false)).toMatchObject({
      available: false,
      disabledMetadata: { reason: 'PLAN_VERIFICATION_NOT_PROVEN' },
    });
    // Both → available with no disabled metadata.
    expect(rules.strictFreeAvailability(declared, true)).toEqual({
      available: true,
      disabledMetadata: null,
    });
  });
});
