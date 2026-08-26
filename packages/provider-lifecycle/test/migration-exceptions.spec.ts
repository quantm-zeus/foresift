// Migration exceptions (FR-PROV-003): time-bounded authorizations for
// deprecated operations that re-block AUTOMATICALLY at lapse — the boundary
// is strict (`expires_at > now`), no grace windows exist anywhere.
import { describe, expect, it } from 'vitest';
import type { UtcTimestamp } from '@foresift/domain';
import { makeProvStack, closeProvStack, seedOperation, T0 } from './helpers.ts';

const at = (iso: string) => iso as UtcTimestamp;

async function grantDefault(stack: Awaited<ReturnType<typeof makeProvStack>>) {
  const op = await seedOperation(stack, {
    deprecatedAt: T0,
    replacementOperationId: 'get-token-price-v2',
  });
  await stack.exceptions.grant({
    exceptionId: 'exc-1',
    ref: op,
    approver: 'ops-lead',
    replacementPlanRef: 'plan://migrate-price-feed',
    reason: 'downstream feature ships migration next sprint',
    createdAt: at('2026-08-01T00:00:00Z'),
    expiresAt: at('2026-08-10T00:00:00Z'),
  });
  return op;
}

describe('migration exceptions', () => {
  it('authorizes while valid and reports the stored record', async () => {
    const stack = await makeProvStack();
    try {
      await grantDefault(stack);
      const valid = await stack.exceptions.assertValid('exc-1', at('2026-08-05T00:00:00Z'));
      expect(valid.approver).toBe('ops-lead');
      expect(valid.replacementPlanRef).toBe('plan://migrate-price-feed');
      const found = await stack.exceptions.findValidForOperation(
        { providerId: 'prov-test', operationId: 'get-token-price', version: '1.0.0' },
        at('2026-08-05T00:00:00Z'),
      );
      expect(found?.exceptionId).toBe('exc-1');
    } finally {
      await closeProvStack(stack);
    }
  });

  it('re-blocks the INSTANT the window lapses — strict boundary, no grace', async () => {
    const stack = await makeProvStack();
    try {
      await grantDefault(stack);
      // Exactly AT expiry: already invalid (expires_at > now fails).
      await expect(stack.exceptions.assertValid('exc-1', at('2026-08-10T00:00:00Z'))).rejects.toMatchObject({
        code: 'PROV_MIGRATION_EXCEPTION_EXPIRED',
      });
      await expect(
        stack.exceptions.findValidForOperation(
          { providerId: 'prov-test', operationId: 'get-token-price', version: '1.0.0' },
          at('2026-08-11T00:00:00Z'),
        ),
      ).resolves.toBeUndefined();
    } finally {
      await closeProvStack(stack);
    }
  });

  it('revoked exceptions authorize nothing ever again', async () => {
    const stack = await makeProvStack();
    try {
      await grantDefault(stack);
      await stack.exceptions.revoke('exc-1', at('2026-08-02T00:00:00Z'), 'security-review');
      await expect(stack.exceptions.assertValid('exc-1', at('2026-08-03T00:00:00Z'))).rejects.toMatchObject({
        code: 'PROV_MIGRATION_EXCEPTION_REVOKED',
      });
      // Revoking twice refuses rather than silently overwriting.
      await expect(
        stack.exceptions.revoke('exc-1', at('2026-08-04T00:00:00Z'), 'security-review'),
      ).rejects.toMatchObject({ code: 'PROV_MIGRATION_EXCEPTION_UNKNOWN' });
    } finally {
      await closeProvStack(stack);
    }
  });

  it('unknown ids refuse distinctly; inverted windows are refused at grant time', async () => {
    const stack = await makeProvStack();
    try {
      await expect(stack.exceptions.assertValid('nope', T0)).rejects.toMatchObject({
        code: 'PROV_MIGRATION_EXCEPTION_UNKNOWN',
      });
      const op = await seedOperation(stack);
      await expect(
        stack.exceptions.grant({
          exceptionId: 'exc-bad-window',
          ref: op,
          approver: 'a',
          replacementPlanRef: 'p',
          reason: 'r',
          createdAt: at('2026-08-05T00:00:00Z'),
          expiresAt: at('2026-08-05T00:00:00Z'),
        }),
      ).rejects.toMatchObject({ code: 'PROV_MIGRATION_EXCEPTION_WINDOW_INVALID' });
    } finally {
      await closeProvStack(stack);
    }
  });
});
