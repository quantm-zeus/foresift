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
  return MATERIAL_PATTERNS.filter((pattern) => pattern.regex.test(text)).map((p) => p.id);
}

// --- Context-envelope guard -----------------------------------------------------

/**
 * §35.x hard rule: classified secret material never enters model context.
 * Refuses on BOTH explicit classification and detected material shapes.
 */
export function refuseSecretTowardModelContext(input: {
  readonly content: string;
  readonly declaredClassifications?: readonly SecretClassification[];
}): void {
  const detected = detectMaterial(input.content);
  if (detected.length > 0 || (input.declaredClassifications?.length ?? 0) > 0) {
    throw new SecretsPolicyError(
      'classified or secret-shaped material refused toward model context',
      { detected: detected.join(',') },
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
  let output = text;
  for (const known of [...knownValues].sort((a, b) => b.value.length - a.value.length)) {
    if (known.value === '') continue;
    while (output.includes(known.value)) {
      output = output.replace(known.value, `[REDACTED:${known.label}]`);
    }
  }
  for (const pattern of MATERIAL_PATTERNS) {
    output = output.replace(pattern.regex, `[REDACTED:${pattern.id}]`);
  }
  return output;
}

// --- Export / UI denial rules ------------------------------------------------------

export function assertExportAllowed(
  classification: SecretClassification,
  channel: 'ALPHA_LAB' | 'PUBLIC_API' | 'OPERATOR_UI',
): void {
  if (EXPORT_PROHIBITED_CLASSES.includes(classification)) {
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
  record(event: SecretLifecycleEvent): SecretLifecycleEvent {
    const parsed = SecretLifecycleEventSchema.parse(event);
    this.events.push(parsed);
    return parsed;
  }

  /**
   * Rotation with overlap window: the OLD reference stays valid until
   * overlapUntil; records must carry a strictly ordered overlap end.
   */
  recordRotation(input: {
    secretRef: string;
    classification: SecretClassification;
    at: string;
    overlapUntil?: string | undefined;
    environment: 'PRODUCTION' | 'COLLECTOR' | 'ALPHA_LAB';
  }): SecretLifecycleEvent {
    if (
      input.overlapUntil !== undefined &&
      Date.parse(input.overlapUntil) <= Date.parse(input.at)
    ) {
      throw new SecretsPolicyError(
        'rotation overlap window must extend beyond the rotation instant',
        {},
        SecErrorCode.SEC_SECRET_LIFECYCLE_INVALID,
      );
    }
    return this.record({
      secretRef: input.secretRef as never,
      classification: input.classification,
      event: 'ROTATED',
      at: input.at as never,
      overlapUntil: input.overlapUntil === undefined ? null : (input.overlapUntil as never),
      invalidatedByIncidentId: null,
      environment: input.environment,
    });
  }

  /** Incident-triggered invalidation hookup (§35.x coupling). */
  invalidateForIncident(input: {
    secretRefs: readonly string[];
    classification: SecretClassification;
    incidentId: string;
    at: string;
    environment: 'PRODUCTION' | 'COLLECTOR' | 'ALPHA_LAB';
  }): readonly SecretLifecycleEvent[] {
    return input.secretRefs.map((secretRef) =>
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
    return [...this.events];
  }
}

// --- Configuration validation --------------------------------------------------------------

/** Prohibited-secret-class configuration validation: config ⊆ registry. */
export function validateSecretClassConfiguration(requestedClasses: readonly string[]): void {
  const unknown = requestedClasses.filter(
    (c) => !SECRET_CLASSIFICATIONS.includes(c as SecretClassification),
  );
  if (unknown.length > 0) {
    throw new SecretsPolicyError(
      'secret-class configuration names classes outside the registry',
      { unknown: unknown.join(',') },
      SecErrorCode.SEC_SECRET_LIFECYCLE_INVALID,
    );
  }
}
