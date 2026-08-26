/**
 * T109: versioned registry truth — prohibited capability classes refuse at
 * the API layer (before any SQL), identical re-registration is idempotent,
 * conflicting re-registration refuses, dependencies fence retries.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeProvEngine, testDefinition, wireEngine } from './helpers.ts';
import type { OperationDefinition } from '../src/operation-registry.ts';
import { ProvErrorCode } from '../src/errors.ts';

let closeDb: () => Promise<void>;
let wired: ReturnType<typeof wireEngine>;

beforeAll(async () => {
  const { db, engine } = await makeProvEngine();
  closeDb = () => db.close();
  wired = wireEngine(engine);
});

afterAll(async () => {
  await closeDb();
});

const TARGET = {
  providerId: 'prov-test',
  operationId: 'op-test',
  version: 'v1',
} as const;

async function seed(): Promise<void> {
  await wired.registry.registerProvider({
    providerId: 'prov-test',
    displayName: 'Test Provider',
    providerGroup: 'group-a',
    disabledByDefault: false,
  });
}

describe('T109 operation registry', () => {
  it('registers a definition and starts it DISCOVERED / HEALTHY', async () => {
    await seed();
    const result = await wired.registry.registerOperation(testDefinition());
    expect(result.created).toBe(true);
    expect(result.currentState).toBe('DISCOVERED');
    const op = await wired.registry.getOperation(TARGET);
    expect(op.currentState).toBe('DISCOVERED');
    expect(op.healthStatus).toBe('HEALTHY');
    // Negative-capability metadata is forced onto every registration.
    expect(op.negativeCapabilities).toEqual(
      expect.arrayContaining(['PROHIBITED_TRANSACTION_BUILD', 'PROHIBITED_SIGN', 'PROHIBITED_SUBMIT', 'PROHIBITED_CUSTODY']),
    );
  });

  it('refuses prohibited and unknown capability classes outright', async () => {
    for (const capabilityClass of [
      'PROHIBITED_TRANSACTION_BUILD',
      'PROHIBITED_SIGN',
      'PROHIBITED_SUBMIT',
      'PROHIBITED_CUSTODY',
    ]) {
      await expect(
        wired.registry.registerOperation(testDefinition({ ...{}, capabilityClass } as Partial<OperationDefinition>)),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_CAPABILITY_CLASS_PROHIBITED });
    }
    await expect(
      wired.registry.registerOperation(
        testDefinition({ capabilityClass: 'WRITE_EVERYTHING' } as unknown as Partial<OperationDefinition>),
      ),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_CAPABILITY_CLASS_UNKNOWN });
  });

  it('resolves an identical re-registration idempotently but refuses a conflicting one', async () => {
    await seed();
    await wired.registry.registerOperation(testDefinition({ operationId: 'op-idem' }));
    const retry = await wired.registry.registerOperation(testDefinition({ operationId: 'op-idem' }));
    expect(retry.created).toBe(false);

    const conflict = testDefinition({ operationId: 'op-idem', timeoutMs: 9999 });
    await expect(wired.registry.registerOperation(conflict)).rejects.toMatchObject({
      code: ProvErrorCode.PROV_OPERATION_ALREADY_REGISTERED,
    });
    // Stored truth unchanged by the refusal.
    const op = await wired.registry.getOperation({ ...TARGET, operationId: 'op-idem' });
    expect(op.timeoutMs).toBe(1000);
  });

  it('refuses operations for unknown providers', async () => {
    await expect(
      wired.registry.registerOperation(testDefinition({ providerId: 'ghost' })),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_PROVIDER_UNKNOWN });
  });

  it('registers affected-feature dependencies with INV-009 replay fencing', async () => {
    await seed();
    await wired.registry.registerOperation(testDefinition({ operationId: 'op-dep' }));
    const target = { ...TARGET, operationId: 'op-dep' };
    const first = await wired.registry.registerDependency({
      consumerKind: 'FEATURE',
      consumerKey: 'whale-alerts',
      target,
    });
    expect(first.created).toBe(true);
    const retry = await wired.registry.registerDependency({
      consumerKind: 'FEATURE',
      consumerKey: 'whale-alerts',
      target,
    });
    expect(retry.created).toBe(false);
    expect(retry.dependencyId).toBe(first.dependencyId);

    const deps = await wired.registry.dependents(target);
    expect(deps).toHaveLength(1);

    await wired.registry.setDependencyActive(first.dependencyId, false);
    expect((await wired.registry.dependents(target))[0]?.active).toBe(false);
  });
});
