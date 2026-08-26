/**
 * T108 completeness proof: the §12.11 alphabet and every CHECK-pinned
 * vocabulary agree value-for-value across THREE representations — the SQL
 * CHECK constraints in g0_prov_* (source of truth), this package's TS
 * constants, and their Zod schemas. A divergence in any one representation
 * fails here instead of at 3 a.m. in production.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseEngine } from '@foresift/persistence';
import {
  ALLOWED_CAPABILITY_CLASSES,
  DEPENDENCY_CONSUMER_KINDS,
  PROVIDER_COST_CLASSES,
  PROVIDER_FINGERPRINT_KINDS,
  PROVIDER_HEALTH_STATUSES,
  PROVIDER_VERIFICATION_KINDS,
  ProviderAllowedCapabilityClassSchema,
  ProviderCostClassSchema,
  ProviderFingerprintKindSchema,
  ProviderHealthStatusSchema,
  ProviderVerificationKindSchema,
  QUARANTINE_CLASSES,
  QuarantineClassSchema,
  RIGHTS_ACTION_KINDS,
  RIGHTS_USE_PATHS,
  RightsActionKindSchema,
  RightsUsePathSchema,
  VERIFICATION_OUTCOMES,
  VERIFICATION_SOURCES,
  VerificationOutcomeSchema,
  VerificationSourceSchema,
  DependencyConsumerKindSchema,
} from '../src/vocabulary.ts';
import {
  LIFECYCLE_TRANSITIONS,
  PROVIDER_LIFECYCLE_STATES,
  ProviderLifecycleStateSchema,
  TERMINAL_LIFECYCLE_STATES,
  assertLegalLifecycleTransition,
} from '../src/lifecycle-states.ts';
import { makeProvEngine } from './helpers.ts';

interface CheckRow {
  table_name: string;
  conname: string;
  def: string;
}

let engine: DatabaseEngine;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  const { db, engine: eng } = await makeProvEngine();
  engine = eng;
  closeDb = () => db.close();
});

afterAll(async () => {
  await closeDb();
});

/** Quoted literals inside a CHECK definition = the alphabet values. */
function alphabetOf(def: string): string[] {
  return (def.match(/'([^']*)'/g) ?? []).map((q) => q.slice(1, -1)).sort();
}

async function checkConstraints(): Promise<CheckRow[]> {
  const rows = await engine.query<{
    table_name: string;
    conname: string;
    def: string;
  }>(
    `SELECT c.conrelid::regclass::text AS table_name, c.conname,
            pg_get_constraintdef(c.oid) AS def
     FROM pg_constraint c
     WHERE c.contype = 'c' AND c.connamespace = 'prov'::regnamespace`,
  );
  return rows.rows;
}

function findDef(
  constraints: CheckRow[],
  table: string,
  column: string,
): string {
  const hits = constraints.filter(
    (c) => c.table_name === `prov.${table}` && c.def.includes(column),
  );
  expect(hits.length, `exactly one CHECK for ${table}.${column}`).toBe(1);
  return hits[0]?.def ?? '';
}

describe('T108 §12.11 completeness: graph ↔ SQL CHECK ↔ Zod', () => {
  it('SQL CHECK alphabets equal the TS/Zod vocabularies value-for-value', async () => {
    const constraints = await checkConstraints();

    const expectations: {
      table: string;
      column: string;
      values: readonly string[];
      schema: { options: readonly string[] };
    }[] = [
      { table: 'prov_operations', column: 'current_state', values: PROVIDER_LIFECYCLE_STATES, schema: ProviderLifecycleStateSchema },
      { table: 'prov_lifecycle_events', column: 'from_state', values: PROVIDER_LIFECYCLE_STATES, schema: ProviderLifecycleStateSchema },
      { table: 'prov_lifecycle_events', column: 'to_state', values: PROVIDER_LIFECYCLE_STATES, schema: ProviderLifecycleStateSchema },
      { table: 'prov_operations', column: 'health_status', values: PROVIDER_HEALTH_STATUSES, schema: ProviderHealthStatusSchema },
      { table: 'prov_operations', column: 'capability_class', values: ALLOWED_CAPABILITY_CLASSES, schema: ProviderAllowedCapabilityClassSchema },
      { table: 'prov_operations', column: 'cost_class', values: PROVIDER_COST_CLASSES, schema: ProviderCostClassSchema },
      { table: 'prov_operation_dependencies', column: 'consumer_kind', values: DEPENDENCY_CONSUMER_KINDS, schema: DependencyConsumerKindSchema },
      { table: 'prov_verification_records', column: 'kind', values: PROVIDER_VERIFICATION_KINDS, schema: ProviderVerificationKindSchema },
      { table: 'prov_verification_ttl_configs', column: 'kind', values: PROVIDER_VERIFICATION_KINDS, schema: ProviderVerificationKindSchema },
      { table: 'prov_verification_records', column: 'source', values: VERIFICATION_SOURCES, schema: VerificationSourceSchema },
      { table: 'prov_verification_records', column: 'outcome', values: VERIFICATION_OUTCOMES, schema: VerificationOutcomeSchema },
      { table: 'prov_response_quarantine', column: 'detected_classes', values: QUARANTINE_CLASSES, schema: QuarantineClassSchema },
      { table: 'prov_rights_changes', column: 'newly_prohibited_uses', values: RIGHTS_USE_PATHS, schema: RightsUsePathSchema },
      { table: 'prov_provider_artifacts', column: 'state', values: ['ACTIVE', 'QUARANTINED', 'RETIRED'], schema: { options: ['ACTIVE', 'QUARANTINED', 'RETIRED'] } },
      { table: 'prov_rights_change_actions', column: 'action', values: RIGHTS_ACTION_KINDS, schema: RightsActionKindSchema },
      { table: 'prov_source_fingerprints', column: 'kind', values: PROVIDER_FINGERPRINT_KINDS, schema: ProviderFingerprintKindSchema },
    ];

    const failures: string[] = [];
    for (const e of expectations) {
      const sqlValues = alphabetOf(findDef(constraints, e.table, e.column));
      if (JSON.stringify(sqlValues) !== JSON.stringify([...e.values].sort())) {
        failures.push(
          `${e.table}.${e.column}: SQL [${sqlValues.join(',')}] != TS [${[...e.values].sort().join(',')}]`,
        );
        continue;
      }
      if (JSON.stringify([...e.schema.options].sort()) !== JSON.stringify(sqlValues)) {
        failures.push(`${e.table}.${e.column}: Zod options diverge from SQL`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('the transition graph matches the task-pinned shape exactly', () => {
    expect(LIFECYCLE_TRANSITIONS).toEqual({
      DISCOVERED: ['VERIFIED', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
      VERIFIED: ['ACTIVE', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
      ACTIVE: ['DEGRADED', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
      DEGRADED: ['ACTIVE', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
      DEPRECATED: [],
      BLOCKED: [],
      REMOVED: [],
    });
    for (const terminal of TERMINAL_LIFECYCLE_STATES) {
      expect(LIFECYCLE_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it('guards representative legal and illegal edges', () => {
    expect(() => assertLegalLifecycleTransition('DISCOVERED', 'VERIFIED')).not.toThrow();
    expect(() => assertLegalLifecycleTransition('ACTIVE', 'DEGRADED')).not.toThrow();
    expect(() => assertLegalLifecycleTransition('DEGRADED', 'ACTIVE')).not.toThrow();
    expect(() => assertLegalLifecycleTransition('ACTIVE', 'BLOCKED')).not.toThrow();
    expect(() => assertLegalLifecycleTransition('DISCOVERED', 'ACTIVE')).toThrow(
      /DISCOVERED → ACTIVE/,
    );
    expect(() => assertLegalLifecycleTransition('BLOCKED', 'ACTIVE')).toThrow(/BLOCKED → ACTIVE/);
    expect(() => assertLegalLifecycleTransition('REMOVED', 'DISCOVERED')).toThrow();
  });
});
