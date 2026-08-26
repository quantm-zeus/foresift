// GMGN enumeration contract (FR-PROV-006; T116): the exposed-operation
// surface is strictly query-only. This test FAILS if any trading-related
// operation ever appears — by id, path, or display name — and fails if any
// operation drifts to a prohibited class, a paid cost class, or STRICT_FREE
// ineligibility.
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_CAPABILITY_CLASSES,
  PROHIBITED_CAPABILITY_CLASSES,
  ProvErrorCode,
  isProhibitedCapabilityClass,
} from '@foresift/provider-lifecycle';
import { closeRegistryStack, makeRegistryStack } from './helpers.ts';
import { GmgnAdapter, GMGN_DESCRIPTOR, registerAdapter } from '../src/index.ts';

/** Any of these substrings (case-insensitive) in an exposed operation's id,
 * path template, or display name marks a TRADING-surface operation. */
const TRADING_SURFACE_TOKENS = [
  'swap',
  'trade',
  'trading',
  'submit',
  'execute',
  'route',
  'bridge',
  'jupiter',
  'order',
  'sign-',
  '-sign',
  '/sign/',
  'sendtransaction',
  'serializetransaction',
  'buildtransaction',
] as const;

function assertQueryOnlySurface(): void {
  for (const operation of GMGN_DESCRIPTOR.operations) {
    const surfaces = [operation.operationId, operation.pathTemplate, operation.displayName];
    for (const surface of surfaces) {
      const haystack = surface.toLowerCase();
      for (const token of TRADING_SURFACE_TOKENS) {
        expect(
          haystack.includes(token),
          `GMGN exposed operation "${operation.operationId}" surface "${surface}" contains trading token "${token}"`,
        ).toBe(false);
      }
    }
  }
}

describe('GMGN strictly query-only catalog (enumeration contract)', () => {
  it('exposes ONLY operations with zero trading-related surface tokens', () => {
    expect(GMGN_DESCRIPTOR.operations.length).toBeGreaterThanOrEqual(4);
    assertQueryOnlySurface();
  });

  it('exposes only allowed, non-prohibited capability classes over free quota', () => {
    for (const operation of GMGN_DESCRIPTOR.operations) {
      expect(isProhibitedCapabilityClass(operation.capabilityClass)).toBe(false);
      expect(PROHIBITED_CAPABILITY_CLASSES).not.toContain(operation.capabilityClass);
      expect(ALLOWED_CAPABILITY_CLASSES).toContain(operation.capabilityClass);
      expect(['FREE_QUOTA', 'FREE_UNMETERED']).toContain(operation.costClass);
      expect(operation.allowedInStrictFree).toBe(true);
      // Query-only ⇒ no plan gate anywhere on this adapter.
      expect(operation.planGated ?? false).toBe(false);
    }
  });

  it('declares exact https allowlist entries and JSON content types for every operation', () => {
    for (const operation of GMGN_DESCRIPTOR.operations) {
      expect(operation.allowlistEntries.length).toBeGreaterThan(0);
      for (const entry of operation.allowlistEntries) {
        expect(entry.host).toBe('gmgn.ai');
        expect(entry.port).toBe(443);
      }
      expect(operation.expectedContentTypes).toEqual(['application/json']);
      expect(operation.maxResponseBytes).toBeGreaterThan(0);
    }
  });

  it('registers the whole catalog into the lifecycle registry end-to-end', async () => {
    const stack = await makeRegistryStack();
    try {
      const result = await registerAdapter(stack.registry, GMGN_DESCRIPTOR);
      expect(result.registered.map((ref) => ref.operationId)).toEqual([
        'get-token-price',
        'get-token-overview',
        'get-trending-pools',
        'get-address-activity',
      ]);
      const rows = await stack.engine.query<{ capability_class: string }>(
        'SELECT capability_class FROM prov.prov_operations ORDER BY operation_id',
      );
      expect(rows.rows.map((row) => row.capability_class)).toEqual([
        'READ_ACCOUNT_STATE',
        'READ_MARKET',
        'READ_MARKET',
        'READ_MARKET',
      ]);
    } finally {
      await closeRegistryStack(stack);
    }
  });

  it('refuses unknown operations at the adapter boundary before any egress', async () => {
    const adapter = new GmgnAdapter(
      new (class {
        execute = async () => {
          throw new Error('transport must never be reached');
        };
      })() as never,
    );
    expect(adapter.hasOperation('swap-tokens')).toBe(false);
    await expect(adapter.execute('swap-tokens')).rejects.toMatchObject({
      code: ProvErrorCode.PROV_OPERATION_UNKNOWN,
    });
  });
});
