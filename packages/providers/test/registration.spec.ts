// Adapter registration (FR-PROV-004/005; T115): wholesale bundles, prohibited
// capability classes, and missing allowlist descriptors are refused at the
// boundary; successful registration lands provider + operations with the
// four-class negative-capability surface attached.
import { describe, expect, it } from 'vitest';
import { PROHIBITED_CAPABILITY_CLASSES, ProvErrorCode } from '@foresift/provider-lifecycle';
import { closeRegistryStack, makeRegistryStack, minimalDescriptor } from './helpers.ts';
import { registerAdapter } from '../src/index.ts';

describe('registerAdapter', () => {
  it('registers a valid descriptor: provider row + operations carrying complete negative capabilities', async () => {
    const stack = await makeRegistryStack();
    try {
      const result = await registerAdapter(stack.registry, minimalDescriptor());
      expect(result.registered).toHaveLength(1);
      expect(result.registered[0]).toMatchObject({
        providerId: 'prov-sample',
        operationId: 'get-sample-price',
        version: '1.0.0',
      });
      const rows = await stack.engine.query<{
        capability_class: string;
        negative_capabilities: string[];
      }>('SELECT capability_class, negative_capabilities FROM prov.prov_operations');
      expect(rows.rows).toHaveLength(1);
      expect([...(rows.rows[0]?.negative_capabilities ?? [])].sort()).toEqual(
        [...PROHIBITED_CAPABILITY_CLASSES].sort(),
      );
    } finally {
      await closeRegistryStack(stack);
    }
  });

  it('refuses prohibited capability classes outright', async () => {
    const stack = await makeRegistryStack();
    try {
      await expect(
        registerAdapter(
          stack.registry,
          minimalDescriptor({ operation: { capabilityClass: 'PROHIBITED_SIGN' } }),
        ),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_CAPABILITY_CLASS_PROHIBITED });
      const rows = await stack.engine.query('SELECT * FROM prov.prov_operations');
      expect(rows.rows).toHaveLength(0);
    } finally {
      await closeRegistryStack(stack);
    }
  });

  it('refuses wholesale capability bundles (one operation claiming several classes)', async () => {
    const stack = await makeRegistryStack();
    try {
      await expect(
        registerAdapter(
          stack.registry,
          minimalDescriptor({
            operation: {
              additionalCapabilityClasses: ['READ_SECURITY'],
            },
          }),
        ),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_ADAPTER_BUNDLE_EXPOSURE_REFUSED });
    } finally {
      await closeRegistryStack(stack);
    }
  });

  it('refuses operations without an exact allowlist descriptor', async () => {
    const stack = await makeRegistryStack();
    try {
      await expect(
        registerAdapter(
          stack.registry,
          minimalDescriptor({ operation: { allowlistEntries: [] } }),
        ),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_ADAPTER_ALLOWLIST_DESCRIPTOR_MISSING });
    } finally {
      await closeRegistryStack(stack);
    }
  });

  it('refuses plan-gated operations that claim STRICT_FREE availability', async () => {
    const stack = await makeRegistryStack();
    try {
      const base = minimalDescriptor();
      const descriptor = {
        ...base,
        operations: [
          {
            ...base.operations[0]!,
            allowedInStrictFree: true,
            planGated: true,
            costClass: 'PAID_EXPLICIT',
          },
        ],
      };
      await expect(registerAdapter(stack.registry, descriptor)).rejects.toMatchObject({
        code: ProvErrorCode.PROV_DEFINITION_INVALID,
      });
    } finally {
      await closeRegistryStack(stack);
    }
  });

  it('refuses duplicate operation ids within one descriptor', async () => {
    const stack = await makeRegistryStack();
    try {
      const descriptor = minimalDescriptor();
      await expect(
        registerAdapter(stack.registry, { ...descriptor, operations: [descriptor.operations[0]!, descriptor.operations[0]!] }),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_OPERATION_ALREADY_REGISTERED });
    } finally {
      await closeRegistryStack(stack);
    }
  });
});
