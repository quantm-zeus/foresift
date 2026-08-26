/**
 * Stage-16 normalization + stage-17 semantic invariants (FR-CORE-003; PRD
 * §16.2). The generic normalizer turns the documented raw collector shape
 *
 *   { observations: [{ identity?, observedAt, availableAt?, fetchedAt?,
 *      fields, qualityCodes?, lineageRef? }], conflicts?, partial?,
 *      missingCapabilities?, nextCursor?, resourceUris? }
 *
 * into typed NormalizedResult values: timestamps canonicalized to UTC ISO,
 * numeric fields validated finite, quality codes normalized to the
 * uppercase-delimited code shape, provider disagreements preserved as
 * conflict candidates — never silently replaced. Deployments override with a
 * per-operation normalizer at the route; this default keeps the pipeline
 * exercisable end-to-end without provider-specific code in tool-core.
 */
import type {
  NormalizedObservation,
  NormalizedResult,
  PayloadNormalizer,
} from './provider-contract.ts';

const QUALITY_CODE_SHAPE = /^[A-Z0-9][A-Z0-9_.:-]*$/;

interface RawObservation {
  readonly identity?: unknown;
  readonly observedAt?: unknown;
  readonly availableAt?: unknown;
  readonly fetchedAt?: unknown;
  readonly fields?: unknown;
  readonly qualityCodes?: unknown;
  readonly lineageRef?: unknown;
}

interface RawPayload {
  readonly observations?: unknown;
  readonly conflicts?: unknown;
  readonly partial?: unknown;
  readonly missingCapabilities?: unknown;
  readonly nextCursor?: unknown;
  readonly resourceUris?: unknown;
}

function fail(message: string): never {
  throw new TypeError(message);
}

function isoTimestamp(value: unknown, field: string, fallback: string | undefined): string {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return normalizeInstant(fallback);
    fail(`normalization requires ${field}`);
  }
  if (typeof value !== 'string') fail(`${field} must be an ISO-8601 string`);
  return normalizeInstant(value);
}

function normalizeInstant(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(`unparseable timestamp: ${value}`);
  return parsed.toISOString().replace('.000Z', 'Z');
}

function normalizedFields(raw: unknown, prefix: string): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) fail(`${prefix} must be an object`);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      fail(`${prefix}.${key} is not a finite number`);
    }
    out[key] = typeof value === 'number' ? value : value;
  }
  return out;
}

function normalizedQualityCodes(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) fail('qualityCodes must be an array');
  return raw.map((code) => {
    if (typeof code !== 'string') fail('quality codes must be strings');
    const normalized = code.trim().toUpperCase();
    if (!QUALITY_CODE_SHAPE.test(normalized)) fail(`malformed quality code: ${code}`);
    return normalized;
  });
}

/**
 * Conflict detection across observations of the SAME field path from
 * DIFFERENT providers carrying different values: every value survives
 * verbatim in the conflict record and the observations stay in the result —
 * nothing is replaced.
 */
export function detectConflicts(
  observations: readonly NormalizedObservation[],
): Array<{ providers: string[]; fieldPath: string; values: unknown[] }> {
  const byField = new Map<string, Map<string, string>>();
  for (const observation of observations) {
    for (const [fieldPath, value] of Object.entries(observation.fields)) {
      const perProvider = byField.get(fieldPath) ?? new Map<string, string>();
      perProvider.set(observation.provider, JSON.stringify(value));
      byField.set(fieldPath, perProvider);
    }
  }
  const conflicts: Array<{ providers: string[]; fieldPath: string; values: unknown[] }> = [];
  for (const [fieldPath, perProvider] of byField) {
    if (perProvider.size < 2 || new Set(perProvider.values()).size < 2) continue;
    conflicts.push({
      providers: [...perProvider.keys()],
      fieldPath,
      values: [...perProvider.values()].map((v) => JSON.parse(v) as unknown),
    });
  }
  return conflicts;
}

/** THE default stage-16 payload normalizer. */
export const normalizeRawPayload: PayloadNormalizer = (raw, context) => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('raw payload must be a JSON object');
  }
  const payload = raw as RawPayload;
  if (!Array.isArray(payload.observations)) fail('raw payload carries no observations array');

  const observations: NormalizedObservation[] = payload.observations.map(
    (entry: unknown, index: number): NormalizedObservation => {
      if (entry === null || typeof entry !== 'object')
        fail(`observation ${String(index)} is not an object`);
      const obs = entry as RawObservation;
      const identity =
        obs.identity === undefined
          ? ''
          : typeof obs.identity === 'string'
            ? obs.identity
            : JSON.stringify(obs.identity);
      const observedAt = isoTimestamp(
        obs.observedAt,
        `observations[${index}].observedAt`,
        undefined,
      );
      const availableAt = isoTimestamp(
        obs.availableAt,
        `observations[${index}].availableAt`,
        context.fetchedAt,
      );
      const fetchedAt = isoTimestamp(
        obs.fetchedAt,
        `observations[${index}].fetchedAt`,
        context.fetchedAt,
      );
      return {
        evidenceId: `ev-${context.runId}-${String(index)}`,
        provider: context.provider,
        observedAt,
        availableAt,
        fetchedAt,
        fields: {
          ...(identity !== '' ? { identity } : {}),
          ...normalizedFields(obs.fields, `observations[${index}].fields`),
        },
        qualityCodes: normalizedQualityCodes(obs.qualityCodes),
        ...(obs.lineageRef === undefined ? {} : { lineageRef: String(obs.lineageRef) }),
      };
    },
  );

  const conflicts: Array<{ providers: string[]; fieldPath: string; values: unknown[] }> = [];
  const declared = Array.isArray(payload.conflicts) ? payload.conflicts : [];
  for (const conflict of declared) {
    const c = conflict as { providers?: unknown; fieldPath?: unknown; values?: unknown };
    if (
      !Array.isArray(c.providers) ||
      c.providers.length < 2 ||
      typeof c.fieldPath !== 'string' ||
      !Array.isArray(c.values)
    ) {
      fail('declared conflict entries are malformed');
    }
    conflicts.push({
      providers: c.providers.map(String),
      fieldPath: c.fieldPath,
      values: [...c.values],
    });
  }
  conflicts.push(...detectConflicts(observations));

  const missingCapabilities = Array.isArray(payload.missingCapabilities)
    ? payload.missingCapabilities.map(String)
    : [];

  return {
    observations,
    conflicts,
    partial:
      typeof payload.partial === 'boolean'
        ? payload.partial
        : missingCapabilities.length > 0 || conflicts.length > 0,
    missingCapabilities,
    ...(typeof payload.nextCursor === 'string' ? { nextCursor: payload.nextCursor } : {}),
    ...(Array.isArray(payload.resourceUris)
      ? { resourceUris: payload.resourceUris.map(String) }
      : {}),
  };
};

/**
 * Stage-17 semantic invariants: event-time ordering (observed ≤ available ≤
 * fetched ≤ decision time), finite numbers only, and explicit degradation
 * truth whenever a capability is missing.
 */
export function validateNormalizedInvariants(
  result: NormalizedResult,
  limits: { readonly now: string },
): string[] {
  const problems: string[] = [];
  const nowMs = Date.parse(limits.now);
  const evidenceIds = new Set<string>();
  for (const observation of result.observations) {
    if (!observation.evidenceId || evidenceIds.has(observation.evidenceId)) {
      problems.push(`evidence id ${observation.evidenceId || '<empty>'} is empty or duplicated`);
    }
    evidenceIds.add(observation.evidenceId);
    if (!observation.provider) problems.push(`${observation.evidenceId}: provider is empty`);
    const observed = Date.parse(observation.observedAt);
    const available = Date.parse(observation.availableAt);
    const fetched = Date.parse(observation.fetchedAt);
    if ([observed, available, fetched, nowMs].some((n) => Number.isNaN(n))) {
      problems.push(`observation ${observation.evidenceId} has unparseable timestamps`);
      continue;
    }
    if (observed > available) {
      problems.push(`${observation.evidenceId}: observedAt exceeds availableAt`);
    }
    if (available > fetched + 60_000) {
      problems.push(
        `${observation.evidenceId}: availableAt exceeds fetchedAt beyond skew tolerance`,
      );
    }
    if (fetched > nowMs + 60_000) {
      problems.push(`${observation.evidenceId}: fetchedAt lies in the future`);
    }
  }
  if (result.missingCapabilities.length > 0 && !result.partial) {
    problems.push('missing capabilities must mark the result partial');
  }
  for (const capability of result.missingCapabilities) {
    if (capability.trim().length === 0) problems.push('missing capability names must not be empty');
  }
  for (const conflict of result.conflicts) {
    if (conflict.providers.length < 2 || new Set(conflict.providers).size < 2) {
      problems.push(`conflict ${conflict.fieldPath} must name at least two distinct providers`);
    }
    if (!conflict.fieldPath || conflict.values.length < 2) {
      problems.push('conflicts require a field path and at least two values');
    }
  }
  return problems;
}
