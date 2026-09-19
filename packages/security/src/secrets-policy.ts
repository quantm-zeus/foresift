/**
 * Secrets policy (FR-SEC-007; AC-052). Classification registry + the
 * guards keeping classified material OUT of model context, logs, traces,
 * exports, and UI; environment separation checks; rotation/revocation/
 * overlap-window lifecycle records over KEYED references only (never
 * material); incident-triggered invalidation hookup; prohibited-secret-class
 * configuration validation.
 */
import {
  SecretLifecycleEventSchema,
  type SecretClassification,
  type SecretLifecycleEvent,
} from '@foresift/shared-schemas';
import { SecErrorCode, SecretsPolicyError } from './errors.ts';
import {
  appendSafe,
  isArraySafe,
  numericCopy,
  numericFilter,
  numericIncludes,
  numericJoin,
  numericMap,
  numericSortWith,
  snapshotCallerInput,
} from './shadow-safe.ts';

/** The full classification registry (single source: shared schema). */
export const SECRET_CLASSIFICATIONS: readonly SecretClassification[] = [
  'PROVIDER_API_KEY',
  'DATABASE_CREDENTIAL',
  'MCP_CREDENTIAL_HASH',
  'ADMIN_SESSION_SECRET',
  'ENCRYPTION_KEY_REFERENCE',
  'PRODUCER_SIGNING_KEY_REFERENCE',
];

/**
 * Alpha Lab export prohibition: raw provider credentials and database
 * credentials NEVER leave toward the Alpha Lab surface. Keyed references
 * (hashes / key IDs) are the ONLY classes with an export path at all.
 */
const EXPORT_PROHIBITED_CLASSES: readonly SecretClassification[] = [
  'PROVIDER_API_KEY',
  'DATABASE_CREDENTIAL',
  'ADMIN_SESSION_SECRET',
];

/** Material-shape detectors used by the context/log guards (best effort). */
const MATERIAL_PATTERNS: ReadonlyArray<{ id: string; regex: RegExp }> = [
  { id: 'openai-style-key', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { id: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { id: 'aws-access-key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'slack-token', regex: /\bxox[abp]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'pem-private-block', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'hex-secret', regex: /\b[0-9a-f]{64}\b/i },
];

export function detectMaterial(text: string): string[] {
  return numericMap(
    numericFilter(MATERIAL_PATTERNS, (pattern) => pattern.regex.test(text)),
    (p) => p.id,
  );
}

// --- Context-envelope guard -----------------------------------------------------

/**
 * §35.x hard rule: classified secret material never enters model context.
 * Refuses on BOTH explicit classification and detected material shapes.
 */
export function refuseSecretTowardModelContext(rawInput: {
  readonly content: string;
  readonly declaredClassifications?: readonly SecretClassification[];
}): void {
  // Single-read binding (V7 accessor class): the detected-material decision and
  // the declared-classification refusal must observe the same read.
  const input = snapshotCallerInput(rawInput);
  // Residual CRITICAL (partial-Proxy): `snapshotCallerInput` cannot recover a
  // key a hostile Proxy omitted from `ownKeys`, so every REQUIRED field is
  // bound and type-checked explicitly — absent `content` refuses instead of
  // reading as "nothing to detect".
  const content = input.content;
  if (typeof content !== 'string') {
    throw new SecretsPolicyError(
      'secret-context guard requires string content',
      {},
      SecErrorCode.SEC_SECRET_CONTEXT_INSERTION_REFUSED,
    );
  }
  const declaredClassifications = input.declaredClassifications;
  if (declaredClassifications !== undefined && !isArraySafe(declaredClassifications)) {
    throw new SecretsPolicyError(
      'declaredClassifications must be an array of secret classes',
      {},
      SecErrorCode.SEC_SECRET_CONTEXT_INSERTION_REFUSED,
    );
  }
  const detected = detectMaterial(content);
  if (detected.length > 0 || (declaredClassifications?.length ?? 0) > 0) {
    throw new SecretsPolicyError(
      'classified or secret-shaped material refused toward model context',
      { detected: numericJoin(detected) },
      SecErrorCode.SEC_SECRET_CONTEXT_INSERTION_REFUSED,
    );
  }
}

// --- Log / trace redaction -------------------------------------------------------

/**
 * Log/trace redaction: replace every occurrence of a keyed reference's
 * VALUE (or any material shape) with a stable marker carrying no material.
 */
export function redactForLogs(
  text: string,
  knownValues: ReadonlyArray<{ value: string; label: string }> = [],
): string {
  // Single-read binding (V7 accessor class): each known value/label is read
  // repeatedly by the replace loop; a getter could otherwise flip the value
  // between the match check and the replacement and leak material.
  const boundKnownValues = snapshotCallerInput(knownValues);
  for (let index = 0; index < boundKnownValues.length; index += 1) {
    const entry = boundKnownValues[index] as { value: unknown; label: unknown } | undefined;
    if (
      entry === undefined ||
      entry === null ||
      typeof entry !== 'object' ||
      typeof entry.value !== 'string' ||
      typeof entry.label !== 'string'
    ) {
      throw new SecretsPolicyError(
        'known redaction values must be {value: string, label: string}',
        {},
        SecErrorCode.SEC_SECRET_LOG_EXPOSURE_REFUSED,
      );
    }
  }
  let output = text;
  const sortedKnown = numericSortWith(
    numericCopy(boundKnownValues),
    (a, b) => b.value.length - a.value.length,
  );
  for (let index = 0; index < sortedKnown.length; index += 1) {
    const known = sortedKnown[index] as { value: string; label: string };
    if (known.value === '') continue;
    // H6b single-pass termination: the previous `while (includes) replace`
    // loop never terminated when the replacement text itself contained the
    // searched value (e.g. value "REDACTED"). A split+join pass replaces every
    // occurrence exactly once and always terminates.
    output = numericJoin(output.split(known.value), `[REDACTED:${known.label}]`);
  }
  for (let index = 0; index < MATERIAL_PATTERNS.length; index += 1) {
    const pattern = MATERIAL_PATTERNS[index] as { id: string; regex: RegExp };
    // H6 global redaction: the shared patterns carry no `g` flag, so a plain
    // `.replace` redacted only the FIRST occurrence and a second copy of the
    // secret survived into logs. Build a FRESH global regex per call (never a
    // shared stateful `lastIndex`) and replace every occurrence in one pass.
    const global = new RegExp(pattern.regex.source, `${pattern.regex.flags.replace(/g/g, '')}g`);
    output = output.replace(global, `[REDACTED:${pattern.id}]`);
  }
  return output;
}

// --- Export / UI denial rules ------------------------------------------------------

export function assertExportAllowed(
  classification: SecretClassification,
  channel: 'ALPHA_LAB' | 'PUBLIC_API' | 'OPERATOR_UI',
): void {
  if (numericIncludes(EXPORT_PROHIBITED_CLASSES, classification)) {
    throw new SecretsPolicyError(
      `classification ${classification} is prohibited from export channel ${channel}`,
      {},
      SecErrorCode.SEC_SECRET_EXPORT_REFUSED,
    );
  }
}

export function assertUiDisplayAllowed(classification: SecretClassification): void {
  // Only keyed REFERENCES may render in UI, masked — never raw credentials.
  if (
    classification !== 'MCP_CREDENTIAL_HASH' &&
    classification !== 'ENCRYPTION_KEY_REFERENCE' &&
    classification !== 'PRODUCER_SIGNING_KEY_REFERENCE'
  ) {
    throw new SecretsPolicyError(
      `classification ${classification} may not be displayed in UI`,
      {},
      SecErrorCode.SEC_SECRET_UI_DISPLAY_REFUSED,
    );
  }
}

// --- Environment separation ----------------------------------------------------------

type EnvironmentName = 'PRODUCTION' | 'COLLECTOR' | 'ALPHA_LAB';

/**
 * Environment separation: PRODUCTION secrets are never referenced from
 * lower environments. Cross-references flow downward only when the source
 * is NOT production-bound.
 */
export function assertEnvironmentSeparation(
  secretEnvironment: EnvironmentName,
  referencingSurface: EnvironmentName,
): void {
  if (secretEnvironment === 'PRODUCTION' && referencingSurface !== 'PRODUCTION') {
    throw new SecretsPolicyError(
      `production secret referenced from ${referencingSurface} surface`,
      {},
      SecErrorCode.SEC_SECRET_MATERIAL_STORAGE_REFUSED,
    );
  }
}

// --- Lifecycle records -----------------------------------------------------------------

export class SecretLifecycleLedger {
  private readonly events: SecretLifecycleEvent[] = [];

  /** Parse-and-record one lifecycle event (keyed references only). */
  record(rawEvent: SecretLifecycleEvent): SecretLifecycleEvent {
    // Single-read binding (V7 accessor class): the schema parse and the stored
    // event must see the same caller values.
    const event = snapshotCallerInput(rawEvent);
    const parsed = SecretLifecycleEventSchema.parse(event);
    appendSafe(this.events, parsed);
    return parsed;
  }

  /**
   * Rotation with overlap window: the OLD reference stays valid until
   * overlapUntil; records must carry a strictly ordered overlap end.
   */
  recordRotation(rawInput: {
    secretRef: string;
    classification: SecretClassification;
    at: string;
    overlapUntil?: string | undefined;
    environment: 'PRODUCTION' | 'COLLECTOR' | 'ALPHA_LAB';
  }): SecretLifecycleEvent {
    // Single-read binding (V7 accessor class): the overlap check and the
    // recorded event must observe the same instants.
    const input = snapshotCallerInput(rawInput);
    // Residual CRITICAL (partial-Proxy) + M9/M10: bind and validate every
    // REQUIRED rotation field once. `Date.parse` of an absent/garbage instant
    // is NaN, and `NaN <= NaN` is false, so the old overlap check silently
    // admitted a malformed window.
    const secretRef = input.secretRef;
    const classification = input.classification;
    const at = input.at;
    const overlapUntil = input.overlapUntil;
    const environment = input.environment;
    const atMs = typeof at === 'string' ? Date.parse(at) : Number.NaN;
    if (typeof secretRef !== 'string' || secretRef.trim() === '') {
      throw new SecretsPolicyError(
        'rotation requires a non-empty keyed secret reference',
        {},
        SecErrorCode.SEC_SECRET_LIFECYCLE_INVALID,
      );
    }
    if (
      typeof classification !== 'string' ||
      !numericIncludes(SECRET_CLASSIFICATIONS, classification as SecretClassification)
    ) {
      throw new SecretsPolicyError(
        'rotation names a classification outside the registry',
        {},
        SecErrorCode.SEC_SECRET_LIFECYCLE_INVALID,
      );
    }
    if (!Number.isFinite(atMs)) {
      throw new SecretsPolicyError(
        'rotation instant is missing or not a finite instant',
        {},
        SecErrorCode.SEC_SECRET_LIFECYCLE_INVALID,
      );
    }
    if (
      environment !== 'PRODUCTION' &&
      environment !== 'COLLECTOR' &&
      environment !== 'ALPHA_LAB'
    ) {
      throw new SecretsPolicyError(
        'rotation names an unknown environment',
        {},
        SecErrorCode.SEC_SECRET_LIFECYCLE_INVALID,
      );
    }
    if (overlapUntil !== undefined) {
      const overlapMs = typeof overlapUntil === 'string' ? Date.parse(overlapUntil) : Number.NaN;
      if (!Number.isFinite(overlapMs) || overlapMs <= atMs) {
        throw new SecretsPolicyError(
          'rotation overlap window must extend beyond the rotation instant',
          {},
          SecErrorCode.SEC_SECRET_LIFECYCLE_INVALID,
        );
      }
    }
    return this.record({
      secretRef: secretRef as never,
      classification,
      event: 'ROTATED',
      at: at as never,
      overlapUntil: overlapUntil === undefined ? null : (overlapUntil as never),
      invalidatedByIncidentId: null,
      environment,
    });
  }

  /** Incident-triggered invalidation hookup (§35.x coupling). */
  invalidateForIncident(rawInput: {
    secretRefs: readonly string[];
    classification: SecretClassification;
    incidentId: string;
    at: string;
    environment: 'PRODUCTION' | 'COLLECTOR' | 'ALPHA_LAB';
  }): readonly SecretLifecycleEvent[] {
    // Single-read binding (V7 accessor class): every emitted revocation record
    // must carry the same classification/incident/environment values.
    const input = snapshotCallerInput(rawInput);
    // Residual CRITICAL (partial-Proxy): bind and type-check each required
    // field once; an omitted `secretRefs` inventory must refuse rather than
    // read as "nothing to revoke".
    const rawSecretRefs: unknown = input.secretRefs;
    if (!isArraySafe(rawSecretRefs) || rawSecretRefs.length === 0) {
      throw new SecretsPolicyError(
        'incident invalidation requires a non-empty secret-reference list',
        {},
        SecErrorCode.SEC_SECRET_LIFECYCLE_INVALID,
      );
    }
    const secretRefs = rawSecretRefs as readonly string[];
    if (typeof input.incidentId !== 'string' || input.incidentId.trim() === '') {
      throw new SecretsPolicyError(
        'incident invalidation requires a non-empty incident id',
        {},
        SecErrorCode.SEC_SECRET_LIFECYCLE_INVALID,
      );
    }
    if (
      typeof input.classification !== 'string' ||
      !numericIncludes(SECRET_CLASSIFICATIONS, input.classification as SecretClassification)
    ) {
      throw new SecretsPolicyError(
        'incident invalidation names a classification outside the registry',
        {},
        SecErrorCode.SEC_SECRET_LIFECYCLE_INVALID,
      );
    }
    if (typeof input.at !== 'string' || !Number.isFinite(Date.parse(input.at))) {
      throw new SecretsPolicyError(
        'incident invalidation instant is missing or not a finite instant',
        {},
        SecErrorCode.SEC_SECRET_LIFECYCLE_INVALID,
      );
    }
    return numericMap(secretRefs, (secretRef) =>
      this.record({
        secretRef: secretRef as never,
        classification: input.classification,
        event: 'REVOKED',
        at: input.at as never,
        overlapUntil: null,
        invalidatedByIncidentId: input.incidentId,
        environment: input.environment,
      }),
    );
  }

  all(): readonly SecretLifecycleEvent[] {
    return numericCopy(this.events);
  }
}

// --- Configuration validation --------------------------------------------------------------

/** Prohibited-secret-class configuration validation: config ⊆ registry. */
export function validateSecretClassConfiguration(rawRequestedClasses: readonly string[]): void {
  // Single-read binding (V7 accessor class): the unknown-class filter must see
  // the same element set it reports on.
  const requestedClasses = snapshotCallerInput(rawRequestedClasses);
  const unknown = numericFilter(
    requestedClasses,
    (c) => !numericIncludes(SECRET_CLASSIFICATIONS, c as SecretClassification),
  );
  if (unknown.length > 0) {
    throw new SecretsPolicyError(
      'secret-class configuration names classes outside the registry',
      { unknown: numericJoin(unknown) },
      SecErrorCode.SEC_SECRET_LIFECYCLE_INVALID,
    );
  }
}
