/**
 * Telemetry catalogs are DECLARATIVE event contracts — the requirement
 * manifest maps requirements onto them (`telemetry/data.*`, `telemetry/dr.*`)
 * and observability-milestone emitters will be built against them. A catalog
 * naming a field no code path can produce invites implementers to fabricate
 * or mislabel values, so these specs pin catalog entries to the authoritative
 * shared schemas they describe (FR-DATA-002 contract honesty).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EvidenceAcquisitionDecisionSchema,
  ObservationRevisionSchema,
} from '@foresift/shared-schemas';

const REPO_ROOT = join(import.meta.dirname, '..');

/** Structural subset of a Zod object schema used for shape checks. */
interface MiniSchema {
  safeParse(value: unknown): { success: boolean };
}
type Shape = Record<string, MiniSchema>;

/** Unwrap `.refine()` wrappers (ZodEffects) down to the underlying object shape. */
function shapeOf(schema: { shape?: Shape; innerType?: () => unknown }): Shape {
  let current = schema;
  while (!('shape' in current) || current.shape === undefined) {
    const unwrapped = current.innerType?.();
    if (unwrapped === undefined) {
      throw new Error('could not unwrap schema to its object shape');
    }
    current = unwrapped as typeof current;
  }
  return current.shape;
}

interface CatalogField {
  name: string;
  type: string;
  required: boolean;
}

interface Catalog {
  catalog: string;
  contractStatus?: string;
  events: { name: string; fields: CatalogField[] }[];
}

function loadCatalog(name: string): Catalog {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'telemetry', name), 'utf8')) as Catalog;
}

const dataCatalog = loadCatalog('data.catalog.json');
const drCatalog = loadCatalog('dr.catalog.json');

function event(catalog: Catalog, name: string): { fields: CatalogField[] } {
  const found = catalog.events.find((e) => e.name === name);
  expect(found, `${name} present in the ${catalog.catalog} catalog`).toBeDefined();
  return found as { fields: CatalogField[] };
}

function field(parent: { fields: CatalogField[] }, name: string): CatalogField {
  const found = parent.fields.find((f) => f.name === name);
  expect(found, `field ${name} present`).toBeDefined();
  return found as CatalogField;
}

function shapeField(shape: Shape, name: string): MiniSchema {
  const found = shape[name];
  expect(found, `schema field ${name} present`).toBeDefined();
  return found as MiniSchema;
}

describe('telemetry/data.catalog.json parity with authoritative schemas', () => {
  it('revision.created names only fields ObservationRevisionSchema actually has', () => {
    const revisionShape = shapeOf(ObservationRevisionSchema);
    const revisionCreated = event(dataCatalog, 'revision.created');
    for (const f of revisionCreated.fields) {
      expect(
        Object.hasOwn(revisionShape, f.name),
        `revision.created.${f.name} must exist on ObservationRevisionSchema`,
      ).toBe(true);
    }
    // Revisions carry no receipt of their own — the immutable anchor retains
    // its original receipt, cited via supersededReceiptHash alone. Receipt-
    // style fields outside the schema were once listed here by mistake and
    // made the payload impossible to populate honestly.
    expect(Object.hasOwn(revisionShape, 'supersededReceiptHash')).toBe(true);
    expect(Object.hasOwn(revisionShape, 'receiptHash')).toBe(false);
    expect(Object.hasOwn(revisionShape, 'originalReceiptHash')).toBe(false);
  });

  it('observation.committed keeps both subject ids nullable and cites §13.2 provenance', () => {
    const committed = event(dataCatalog, 'observation.committed');
    // Asset-scoped observations exist; neither id is universally present.
    expect(field(committed, 'subjectPoolId').type).toBe('string|null');
    expect(field(committed, 'subjectAssetId').type).toBe('string|null');
    // Availability provenance vocabulary is §13.2 (13.4 is the reorg model).
    expect(field(committed, 'availabilityProvenance').type).toContain('§13.2');
  });

  it('acquisition.recorded.requestedAt is nullable — unrequested decisions carry no lifecycle', () => {
    const recorded = event(dataCatalog, 'acquisition.recorded');
    const requestedAt = field(recorded, 'requestedAt');
    expect(requestedAt.type).toBe('string<utc-timestamp>|null');
    // Authoritative truth: the decision schema accepts a missing requestedAt
    // (NOT_REQUESTED_BY_POLICY forbids lifecycle timestamps entirely), so the
    // contract cannot demand a non-null instant.
    const acquisitionShape = shapeOf(EvidenceAcquisitionDecisionSchema);
    expect(shapeField(acquisitionShape, 'requestedAt').safeParse(undefined).success).toBe(true);
  });

  it('both catalogs declare themselves contracts-only until emitter wiring lands', () => {
    for (const catalog of [dataCatalog, drCatalog]) {
      expect(
        catalog.contractStatus,
        `${catalog.catalog} catalog states its contract status`,
      ).toBeDefined();
      expect(catalog.contractStatus).toContain('DECLARATIVE_CONTRACT_ONLY');
    }
  });
});
