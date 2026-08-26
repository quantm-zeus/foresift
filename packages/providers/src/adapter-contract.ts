/**
 * The adapter contract (FR-PROV-004/005): every provider adapter is a pure,
 * declarative descriptor — no I/O, no methods — plus thin request builders.
 *
 * Safety properties encoded here:
 *  - exactly ONE capability class per exposed operation; any attempt to claim
 *    additional classes is a wholesale data-bundle exposure and is refused;
 *  - prohibited §15.2 capability classes are unrepresentable (validated away);
 *  - every operation declares its EXACT egress allowlist dimensions (host +
 *    port, always https, always COLLECTOR plane); an operation without that
 *    declaration cannot be registered;
 *  - query parameters, response content types, and byte ceilings are declared
 *    per operation and enforced per request by the FetchPort.
 */
import {
  ALLOWED_CAPABILITY_CLASSES,
  COST_CLASSES,
  ProviderLifecycleError,
  ProvErrorCode,
  isProhibitedCapabilityClass,
  type AllowedCapabilityClass,
  type CostClass,
} from '@foresift/provider-lifecycle';
import type { UtcTimestamp } from '@foresift/domain';

/** Exact egress dimensions for one operation. Scheme and plane are NOT free
 * variables: collection is always https over the COLLECTOR plane. */
export interface AdapterAllowlistEntry {
  readonly host: string;
  readonly port: number;
}

export interface OperationWireDescriptor {
  readonly operationId: string;
  readonly version: string;
  /** Overrides the adapter-level base URL for THIS operation when it lives
   * on a different declared host than the adapter default. */
  readonly baseUrl?: string | undefined;
  readonly displayName: string;
  /** The single capability class this operation exposes. */
  readonly capabilityClass: string;
  /** A wholesale-bundle attempt: claiming further classes alongside the first.
   * Any non-empty value is refused at registration. */
  readonly additionalCapabilityClasses?: readonly string[] | undefined;
  readonly costClass: string;
  /** Path appended to the adapter base URL; starts with '/'. */
  readonly pathTemplate: string;
  /** The exact query-parameter names requests may carry (deny-by-default). */
  readonly declaredQueryParams: readonly string[];
  readonly expectedContentTypes: readonly string[];
  readonly maxResponseBytes: number;
  readonly allowlistEntries: readonly AdapterAllowlistEntry[];
  readonly allowedInStrictFree: boolean;
  /** Plan-gated operations are disabled under STRICT_FREE entirely. */
  readonly planGated?: boolean | undefined;

  // --- remaining §15.3 definition fields carried declaratively so the wire
  // --- descriptor is the single source for lifecycle registration.
  readonly supportedChains: readonly string[];
  readonly supportedPrograms?: ReadonlyArray<{
    programId: string;
    versions: readonly string[];
  }> | undefined;
  readonly inputSchemaId: string;
  readonly rawOutputSchemaId: string;
  readonly normalizedOutputSchemaId: string;
  readonly quotaModelId: string;
  readonly cachePolicyId: string;
  readonly timeoutMs: number;
  readonly retryPolicyId: string;
  readonly declaredIndependenceGroup: string;
  readonly upstreamLineage: readonly string[];
  readonly licensePolicyId: string;
  readonly estimatedQuotaUnits: number;
  readonly quotaResetPolicyId: string;
  readonly protectedReserveEligible: boolean;
  readonly paidFallbackAllowed: boolean;
  readonly verificationExpiresAt: UtcTimestamp;
  readonly forbiddenOutputFields?: readonly string[] | undefined;
  readonly deprecatedAt?: UtcTimestamp | undefined;
  readonly sunsetAt?: UtcTimestamp | undefined;
  readonly replacementOperationId?: string | undefined;
}

export interface ProviderAdapterDescriptor {
  readonly providerId: string;
  readonly displayName: string;
  readonly providerGroup: string;
  readonly baseUrl: string;
  readonly operations: readonly OperationWireDescriptor[];
}

function provFailure(
  code: string,
  message: string,
  detail: Record<string, string | number | boolean | null>,
): ProviderLifecycleError {
  return new ProviderLifecycleError(code, message, detail);
}

/** Validate descriptor shape and safety invariants; throws typed refusals. */
export function validateAdapterDescriptor(descriptor: ProviderAdapterDescriptor): void {
  if (descriptor.operations.length === 0) {
    throw provFailure(ProvErrorCode.PROV_DEFINITION_INVALID, 'adapter exposes zero operations', {
      providerId: descriptor.providerId,
    });
  }
  try {
    const base = new URL(descriptor.baseUrl);
    if (base.protocol !== 'https:') {
      throw provFailure(
        ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
        'adapter base URL is not https',
        { baseUrl: descriptor.baseUrl },
      );
    }
  } catch (error) {
    if (error instanceof ProviderLifecycleError) throw error;
    throw provFailure(ProvErrorCode.PROV_DEFINITION_INVALID, 'adapter base URL is unparseable', {
      baseUrl: descriptor.baseUrl,
    });
  }

  const seen = new Set<string>();
  for (const operation of descriptor.operations) {
    // Wholesale-bundle exposure FIRST: one operation claiming many classes.
    if (operation.additionalCapabilityClasses && operation.additionalCapabilityClasses.length > 0) {
      throw provFailure(
        ProvErrorCode.PROV_ADAPTER_BUNDLE_EXPOSURE_REFUSED,
        `operation ${operation.operationId} attempts a wholesale capability bundle`,
        {
          operationId: operation.operationId,
          claimed: [operation.capabilityClass, ...operation.additionalCapabilityClasses].join(','),
        },
      );
    }
    if (isProhibitedCapabilityClass(operation.capabilityClass)) {
      throw provFailure(
        ProvErrorCode.PROV_CAPABILITY_CLASS_PROHIBITED,
        `capability class ${operation.capabilityClass} is prohibited product-wide`,
        { operationId: operation.operationId, capabilityClass: operation.capabilityClass },
      );
    }
    if (!(ALLOWED_CAPABILITY_CLASSES as readonly string[]).includes(operation.capabilityClass)) {
      throw provFailure(
        ProvErrorCode.PROV_CAPABILITY_CLASS_UNKNOWN,
        `capability class ${operation.capabilityClass} is outside the §15.2 alphabet`,
        { operationId: operation.operationId, capabilityClass: operation.capabilityClass },
      );
    }
    if (!(COST_CLASSES as readonly string[]).includes(operation.costClass)) {
      throw provFailure(ProvErrorCode.PROV_DEFINITION_INVALID, `unknown cost class ${operation.costClass}`, {
        operationId: operation.operationId,
        costClass: operation.costClass,
      });
    }
    if (!operation.pathTemplate.startsWith('/')) {
      throw provFailure(ProvErrorCode.PROV_DEFINITION_INVALID, 'path template must start with "/"', {
        operationId: operation.operationId,
        pathTemplate: operation.pathTemplate,
      });
    }
    if (operation.expectedContentTypes.length === 0 || operation.maxResponseBytes <= 0) {
      throw provFailure(
        ProvErrorCode.PROV_DEFINITION_INVALID,
        'operations declare at least one expected content type and a positive byte ceiling',
        { operationId: operation.operationId },
      );
    }
    if (operation.allowlistEntries.length === 0) {
      throw provFailure(
        ProvErrorCode.PROV_ADAPTER_ALLOWLIST_DESCRIPTOR_MISSING,
        `operation ${operation.operationId} carries no allowlist descriptor`,
        { operationId: operation.operationId },
      );
    }
    for (const entry of operation.allowlistEntries) {
      if (entry.host.trim().length === 0 || !Number.isInteger(entry.port) || entry.port < 1 || entry.port > 65535) {
        throw provFailure(
          ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
          'allowlist entries declare a concrete https host and port',
          { operationId: operation.operationId, host: entry.host, port: entry.port },
        );
      }
    }
    const key = `${operation.operationId}@${operation.version}`;
    if (seen.has(key)) {
      throw provFailure(
        ProvErrorCode.PROV_OPERATION_ALREADY_REGISTERED,
        `duplicate operation ${key} within one adapter descriptor`,
        {},
      );
    }
    seen.add(key);
  }
}

/** Expand exact per-operation entries into security-guard allowlist rows. */
export function expandAllowlistEntries(operation: OperationWireDescriptor) {
  return operation.allowlistEntries.map((entry) => ({
    host: entry.host,
    port: entry.port,
    scheme: 'https' as const,
    plane: 'COLLECTOR' as const,
  }));
}

/** Union of every operation's entries: the adapter-level guard allowlist is
 * EXACTLY what the descriptor declared — nothing ambient, nothing inherited. */
export function buildAdapterGuardAllowlist(descriptor: ProviderAdapterDescriptor) {
  const merged = new Map<string, ReturnType<typeof expandAllowlistEntries>[number]>();
  for (const operation of descriptor.operations) {
    for (const entry of expandAllowlistEntries(operation)) {
      merged.set(`${entry.host}:${String(entry.port)}`, entry);
    }
  }
  return [...merged.values()];
}

/** Per-request exactness: the URL's host:port must be one of THIS operation's
 * own entries — a wider adapter-level allowlist does not leak across ops. */
export function assertOperationTargetDeclared(
  operation: OperationWireDescriptor,
  url: string,
): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw provFailure(
      ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
      'request URL is unparseable',
      { operationId: operation.operationId },
    );
  }
  if (parsed.protocol !== 'https:') {
    throw provFailure(
      ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
      'request URL is not https',
      { operationId: operation.operationId },
    );
  }
  const port = parsed.port.length > 0 ? Number(parsed.port) : 443;
  const declared = operation.allowlistEntries.some(
    (entry) => entry.host === parsed.hostname && entry.port === port,
  );
  if (!declared) {
    throw provFailure(
      ProvErrorCode.PROV_ALLOWLIST_DIMENSION_UNDECLARED,
      `target ${parsed.hostname}:${String(port)} is not declared for operation ${operation.operationId}`,
      { operationId: operation.operationId, targetHost: parsed.hostname, targetPort: port },
    );
  }
}

export function isAllowedCapabilityClass(value: string): value is AllowedCapabilityClass {
  return (ALLOWED_CAPABILITY_CLASSES as readonly string[]).includes(value);
}

export function isKnownCostClass(value: string): value is CostClass {
  return (COST_CLASSES as readonly string[]).includes(value);
}

/** Everything the FetchPort needs for one call, resolved from a descriptor. */
export interface PreparedAdapterRequest {
  readonly operation: OperationWireDescriptor;
  /** Absolute https URL without query (query travels via FetchPortRequest). */
  readonly url: string;
  readonly plane: 'COLLECTOR';
}

/** Resolve an operation by id inside a descriptor and assemble its request
 * URL from the declared base + path template (+ substituted `{name}` path
 * parameters). Refuses unknown operation ids, unsubstituted placeholders, and
 * targets outside the operation's OWN allowlist declaration. */
export function prepareOperationRequest(
  descriptor: ProviderAdapterDescriptor,
  operationId: string,
  pathParams?: Readonly<Record<string, string>> | undefined,
): PreparedAdapterRequest {
  const operation = descriptor.operations.find((op) => op.operationId === operationId);
  if (operation === undefined) {
    throw provFailure(
      ProvErrorCode.PROV_OPERATION_UNKNOWN,
      `adapter ${descriptor.providerId} exposes no operation "${operationId}"`,
      { providerId: descriptor.providerId, operationId },
    );
  }
  const substitutions = pathParams ?? {};
  const resolvedPath = operation.pathTemplate.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = substitutions[name];
    if (value === undefined) {
      throw provFailure(
        ProvErrorCode.PROV_DEFINITION_INVALID,
        `path parameter {${name}} of ${operationId} was not supplied`,
        { operationId, pathParameter: name },
      );
    }
    return encodeURIComponent(value);
  });
  if (resolvedPath.includes('{') || resolvedPath.includes('}')) {
    throw provFailure(
      ProvErrorCode.PROV_DEFINITION_INVALID,
      `path template of ${operationId} contains malformed placeholders`,
      { operationId, pathTemplate: operation.pathTemplate },
    );
  }
  const url = `${(operation.baseUrl ?? descriptor.baseUrl).replace(/\/+$/, '')}${resolvedPath}`;
  assertOperationTargetDeclared(operation, url);
  return { operation, url, plane: 'COLLECTOR' };
}
