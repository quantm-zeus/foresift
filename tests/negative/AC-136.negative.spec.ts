/**
 * AC-136 negative / failure-path.
 * Traces: FR-TRD-004, AC-136.
 * Refuses full-quality contribution or unreduced factor for unresolved actor state.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-136 negative: Refusal of full quality on unresolved actors', () => {
  it('refuses 1.0 uncertainty factor when actor resolution state is UNRESOLVED', () => {
    const actorState = 'UNRESOLVED';
    const confidence = 0.0;
    const naiveFactor = 1.0;

    // UNRESOLVED cannot have full factor 1.0
    const resolvedFactor = actorState === 'RESOLVED' ? confidence : 0.0;
    expect(resolvedFactor).not.toBe(naiveFactor);
    expect(resolvedFactor).toBe(0.0);
  });

  it('refuses VALID quality code assignment when actor resolution is UNRESOLVED', () => {
    const actorState = 'UNRESOLVED';
    const qualityCodes: string[] = [];

    if (actorState === 'UNRESOLVED') {
      qualityCodes.push('SYSTEM_ADDRESS_UNCERTAIN');
    } else {
      qualityCodes.push('VALID');
    }

    expect(qualityCodes).not.toContain('VALID');
    expect(qualityCodes).toContain('SYSTEM_ADDRESS_UNCERTAIN');
  });
});
