/** Seeded deterministic negative-control harness (FR-MAT-004). */
import { ControlKind, IncidentTrigger, materialLiftDetector, type ControlKind as Control } from '@foresift/domain';

export interface FrozenControlRow {
  readonly stableId: string;
  readonly label: number;
  readonly availableAt: string;
  readonly features: Readonly<Record<string, number | string | null>>;
  readonly providerId?: string;
  readonly sourceId?: string;
  readonly assetId?: string;
  readonly entityId?: string;
  readonly windowId?: string;
}

export interface NegativeControlResult {
  readonly controlKind: Control;
  readonly transformed: readonly FrozenControlRow[];
  readonly detectedColumns: readonly string[];
  readonly observedLift: number;
  readonly materialLiftThreshold: number;
  readonly promotionBlocked: boolean;
  readonly incidentTrigger: typeof IncidentTrigger.LEAKAGE_OR_NEGATIVE_CONTROL_FAILURE | null;
  readonly seedProvenance: string;
}

function seedNumber(seed: string): number {
  let value = 2166136261;
  for (const character of seed) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
}

function generator(seed: string): () => number {
  let state = seedNumber(seed) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function shuffled<T>(values: readonly T[], seed: string): T[] {
  const result = [...values];
  const random = generator(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

const FORBIDDEN_COLUMN = /(future|outcome|target|realized|post[_-]?event|backfill)/i;

export function runNegativeControl(input: {
  readonly controlKind: Control;
  readonly rows: readonly FrozenControlRow[];
  readonly seedProvenance: string;
  readonly observedLift: number;
  readonly materialLiftThreshold: number;
  readonly shiftMilliseconds?: number;
}): NegativeControlResult {
  const ordered = [...input.rows].sort((left, right) => left.stableId.localeCompare(right.stableId));
  let transformed = ordered.map((row) => ({ ...row, features: { ...row.features } }));
  const detected = new Set<string>();
  switch (input.controlKind) {
    case ControlKind.OUTCOME_LABEL_PERMUTATION: {
      const labels = shuffled(ordered.map((row) => row.label), input.seedProvenance);
      transformed = transformed.map((row, index) => ({ ...row, label: labels[index]! }));
      break;
    }
    case ControlKind.FEATURE_TIMESTAMP_SHIFT:
    case ControlKind.DELAYED_PROVIDER_PLACEBO:
    case ControlKind.BACKFILLED_AVAILABILITY_PLACEBO: {
      const shift = input.shiftMilliseconds ?? 86_400_000;
      transformed = transformed.map((row) => ({ ...row, availableAt: new Date(Date.parse(row.availableAt) + shift).toISOString() }));
      break;
    }
    case ControlKind.SYNTHETIC_NULL_FEATURES: {
      const random = generator(input.seedProvenance);
      transformed = transformed.map((row) => ({ ...row, features: { ...row.features, syntheticNull: random() } }));
      break;
    }
    case ControlKind.FORBIDDEN_FUTURE_COLUMN_SCAN:
    case ControlKind.OUTCOME_COLUMN_SCAN:
      for (const row of ordered)
        for (const key of Object.keys(row.features)) if (FORBIDDEN_COLUMN.test(key)) detected.add(key);
      break;
    case ControlKind.PROVIDER_ID_ONLY_PREDICTOR:
      transformed = transformed.map((row) => ({ ...row, features: { providerId: row.providerId ?? null } }));
      break;
    case ControlKind.SOURCE_ID_ONLY_PREDICTOR:
      transformed = transformed.map((row) => ({ ...row, features: { sourceId: row.sourceId ?? null } }));
      break;
    case ControlKind.SAME_ASSET_LEAKAGE_SCAN:
      for (const row of ordered) if (row.assetId) detected.add(`asset:${row.assetId}`);
      break;
    case ControlKind.SAME_ENTITY_LEAKAGE_SCAN:
      for (const row of ordered) if (row.entityId) detected.add(`entity:${row.entityId}`);
      break;
    case ControlKind.OVERLAPPING_WINDOW_LEAKAGE_SCAN:
      for (const row of ordered) if (row.windowId) detected.add(`window:${row.windowId}`);
      break;
    case ControlKind.RANDOMIZED_MODEL_OUTPUT_CONTROL:
    case ControlKind.RANDOMIZED_TOOL_SELECTION_CONTROL: {
      const random = generator(input.seedProvenance);
      transformed = transformed.map((row) => ({ ...row, features: { randomizedControl: random() } }));
      break;
    }
  }
  const lift = materialLiftDetector(input.observedLift, input.materialLiftThreshold);
  const promotionBlocked = lift.promotionBlocked || detected.size > 0;
  return Object.freeze({
    controlKind: input.controlKind,
    transformed: Object.freeze(transformed.map((row) => Object.freeze(row))),
    detectedColumns: Object.freeze([...detected].sort()),
    observedLift: input.observedLift,
    materialLiftThreshold: input.materialLiftThreshold,
    promotionBlocked,
    incidentTrigger: promotionBlocked ? IncidentTrigger.LEAKAGE_OR_NEGATIVE_CONTROL_FAILURE : null,
    seedProvenance: input.seedProvenance,
  });
}
