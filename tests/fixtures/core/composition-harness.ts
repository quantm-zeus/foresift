/**
 * Composition-test harness fixtures (T801 substrate): permissive seam
 * implementations and canned payloads that let engine/AC suites drive the
 * exact 24-stage pipeline WITHOUT any provider network. Everything here is
 * inert and deterministic — no credentials, no live endpoints.
 */
import type { ActorIdentity } from '../../../packages/tool-core/src/run-context.ts';
import type {
  AuthnPrimitive,
  AuthzPrimitive,
} from '../../../packages/tool-core/src/stages/authn.ts';
import type { LicensePolicySource } from '../../../packages/tool-core/src/license-contract.ts';
import type {
  QuotaAdmissionDecision,
  QuotaEstimate,
  QuotaReservationAdapter,
} from '../../../packages/tool-core/src/quota-contract.ts';
import type {
  OperationRoute,
  ProviderCallRequest,
  ReadOnlyOperationAdapter,
} from '../../../packages/tool-core/src/provider-contract.ts';
import type { ToolDefinitionMetadata } from '@foresift/shared-schemas';

// ── Perimeter primitives ────────────────────────────────────────────────────

/** Authenticates ANY material into a stable deterministic actor identity. */
export class PermissiveAuthn implements AuthnPrimitive {
  async authenticate(request: {
    readonly material: unknown;
    readonly holderMode: import('@foresift/domain').HolderMode;
    readonly tenantId: string;
  }): Promise<ActorIdentity> {
    const material = (request.material ?? {}) as { actorId?: string };
    return {
      actorId: material.actorId ?? 'fixture-actor',
      profileId: material.actorId ?? 'discovery',
      scopes: ['assets:read', 'security:read', 'markets:read', '*'],
    };
  }
}

/** Authorizes EVERY tenant/entity pair (tests assert finer checks upstream). */
export class PermissiveAuthz implements AuthzPrimitive {
  async authorize(): Promise<{ allowed: boolean; reason: string }> {
    return { allowed: true, reason: 'fixture-permissive' };
  }
}

/**
 * License source mirroring the shipped reference semantics: allows ONLY the
 * pinned rights policy version, refuses everything else fail-closed.
 */
export class PinnedRightsLicenseSource implements LicensePolicySource {
  constructor(
    private readonly allowedVersion = 'rights-1',
    private readonly policyVersion = 'rights-1',
  ) {}
  async verdict(query: {
    readonly requestedVersion?: string;
    readonly provider: string;
    readonly operation: string;
  }): Promise<{ allowed: boolean; policyVersion: string; reason: string }> {
    if (query.requestedVersion !== undefined && query.requestedVersion !== this.allowedVersion) {
      return {
        allowed: false,
        policyVersion: query.requestedVersion,
        reason: `route pins ${query.requestedVersion}, policy admits ${this.allowedVersion}`,
      };
    }
    return {
      allowed: true,
      policyVersion: this.policyVersion,
      reason: `rights verified for ${query.provider}/${query.operation}`,
    };
  }
}

// ── Egress ──────────────────────────────────────────────────────────────────

/**
 * Permissive egress stand-in: schema-typed ALLOW with a pinned TEST-NET
 * address (RFC 5737 documentation range — never routable, never real).
 */
export class PermissiveEgressGuard {
  readonly authorized: Array<{ url: string; plane: string }> = [];
  constructor(private readonly pinned = ['192.0.2.10']) {}
  async authorize(
    url: string,
    plane: string,
  ): Promise<{ decision: 'ALLOW'; host: string; pinnedAddresses: string[] }> {
    this.authorized.push({ url, plane });
    const host = new URL(url).host;
    return { decision: 'ALLOW', host, pinnedAddresses: [...this.pinned] };
  }
}

// ── Object store ─────────────────────────────────────────────────────────────

/**
 * Minimal in-memory object store: content-addressed bytes with metadata
 * identity, sufficient for evidence/cache round-trips inside one process.
 */
export class InMemoryObjectStore {
  private readonly objects = new Map<
    string,
    {
      bytes: Uint8Array;
      stored: {
        artifactId: string;
        contentHash: string;
        version: number;
        sizeBytes: number;
        metadata: Record<string, unknown>;
        storedAt: string;
      };
    }
  >();

  async put(request: {
    artifactId: string;
    bytes: Uint8Array;
    metadata: Record<string, unknown>;
  }): Promise<{ artifactId: string; contentHash: string; version: number; sizeBytes: number }> {
    const { createHash } = await import('node:crypto');
    const contentHash = `sha256:${createHash('sha256').update(request.bytes).digest('hex')}`;
    const existing = this.objects.get(contentHash);
    if (existing !== undefined) return existing.stored;
    const stored = {
      artifactId: request.artifactId,
      contentHash,
      version: 1,
      sizeBytes: request.bytes.byteLength,
      metadata: request.metadata,
      storedAt: new Date(0).toISOString(),
    };
    this.objects.set(contentHash, { bytes: request.bytes, stored });
    return stored;
  }

  async get(lookup: {
    contentHash: string;
  }): Promise<{ bytes: Uint8Array; stored: { contentHash: string } } | null> {
    const found = this.objects.get(lookup.contentHash);
    if (found === undefined) return null;
    return { bytes: found.bytes, stored: found.stored };
  }

  async verify(): Promise<never> {
    throw new Error('InMemoryObjectStore.verify not used in these suites');
  }

  async versions(): Promise<never> {
    throw new Error('InMemoryObjectStore.versions not used in these suites');
  }
}

// ── Quota adapter ────────────────────────────────────────────────────────────

export interface QuotaCallLog {
  estimates: number;
  admissions: number;
  reservations: number;
  commits: Array<{ reservationId: string; actualUnits: number }>;
  releases: string[];
}

/**
 * Deterministic quota adapter: every operation costs 1 RATE_ONLY unit and is
 * always admitted. Calls are recorded for idempotency/race assertions.
 */
export class CountingQuotaAdapter implements QuotaReservationAdapter {
  readonly log: QuotaCallLog = {
    estimates: 0,
    admissions: 0,
    reservations: 0,
    commits: [],
    releases: [],
  };
  constructor(private readonly reservationPrefix = 'res') {}

  async estimate(): Promise<QuotaEstimate> {
    this.log.estimates += 1;
    return { quotaModel: 'RATE_ONLY', estimatedUnits: 1 };
  }

  async admit(): Promise<QuotaAdmissionDecision> {
    this.log.admissions += 1;
    return { allowed: true, reason: 'fixture-capacity-available' };
  }

  async reserve(request: { readonly pipelineRunId: string }): Promise<string> {
    this.log.reservations += 1;
    return `${this.reservationPrefix}-${request.pipelineRunId}`;
  }

  async commit(request: {
    readonly reservationId: string;
    readonly actualUnits: number;
  }): Promise<void> {
    this.log.commits.push({ ...request });
  }

  async release(request: { readonly reservationId: string }): Promise<void> {
    this.log.releases.push(request.reservationId);
  }
}

// ── Collector adapters + canned payloads ─────────────────────────────────────

export interface RawObservationShape {
  readonly identity?: unknown;
  readonly observedAt: string;
  readonly availableAt?: string;
  readonly fetchedAt?: string;
  readonly fields: Record<string, unknown>;
  readonly qualityCodes?: string[];
}

/** Build one documented-shape raw collector payload. */
export function rawPayload(
  observations: readonly RawObservationShape[],
  extra: {
    conflicts?: unknown[];
    partial?: boolean;
    missingCapabilities?: string[];
    nextCursor?: string;
  } = {},
): Record<string, unknown> {
  return {
    observations,
    ...(extra.conflicts !== undefined ? { conflicts: extra.conflicts } : {}),
    ...(extra.partial !== undefined ? { partial: extra.partial } : {}),
    ...(extra.missingCapabilities !== undefined
      ? { missingCapabilities: extra.missingCapabilities }
      : {}),
    ...(extra.nextCursor !== undefined ? { nextCursor: extra.nextCursor } : {}),
  };
}

/**
 * Inert collector: replays ONE canned JSON payload for every call, recording
 * the requests it saw (deadline/byte-limit/projection assertions).
 */
export class CannedPayloadAdapter implements ReadOnlyOperationAdapter {
  readonly requests: ProviderCallRequest[] = [];
  constructor(
    readonly provider: string,
    readonly operations: readonly string[],
    private readonly bodyText: string,
    private readonly delayMs = 0,
  ) {}

  async call(request: ProviderCallRequest): Promise<{ contentType: string; bodyText: string }> {
    this.requests.push(request);
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return { contentType: 'application/json', bodyText: this.bodyText };
  }
}

/** Adapter whose call always throws (provider failure classification). */
export class FailingAdapter implements ReadOnlyOperationAdapter {
  readonly requests: ProviderCallRequest[] = [];
  constructor(
    readonly provider: string,
    readonly operations: readonly string[],
    private readonly failure: Error,
  ) {}
  async call(request: ProviderCallRequest): Promise<never> {
    this.requests.push(request);
    throw this.failure;
  }
}

// ── Route + definition builders ──────────────────────────────────────────────

/** Schema-shaped tool definition matching the §16.9 catalog conventions. */
export function toolMetadataFixture(
  over: Partial<ToolDefinitionMetadata> = {},
): ToolDefinitionMetadata {
  const name = over.name ?? 'get_asset_identity';
  return {
    name,
    version: over.version ?? '1.0.0',
    title: over.title ?? name,
    description: over.description ?? `Fixture seed definition for ${name} (§16.9 catalog).`,
    actionClass: over.actionClass ?? 'EXTERNAL_READ',
    profiles: over.profiles ?? ['discovery'],
    requiredScopes: over.requiredScopes ?? ['assets:read'],
    cachePolicyId: over.cachePolicyId ?? 'exact-default',
    quotaPolicyId: over.quotaPolicyId ?? 'strict-free-default',
    licensePolicyId: over.licensePolicyId ?? 'rights-verified-only',
    estimatedCost: over.estimatedCost ?? {},
    inputSchemaJson: over.inputSchemaJson ?? { type: 'object' },
    outputSchemaJson: over.outputSchemaJson ?? { type: 'object' },
  } as ToolDefinitionMetadata;
}

const BASE_TIME = Date.parse('2026-08-01T00:00:00Z');

/** One well-formed observation at a deterministic instant (event-time ordered). */
export function observationFixture(
  fields: Record<string, unknown>,
  offsetSeconds = 0,
): RawObservationShape {
  const iso = new Date(BASE_TIME - offsetSeconds * 1000).toISOString().replace('.000Z', 'Z');
  return { observedAt: iso, availableAt: iso, fetchedAt: iso, fields, qualityCodes: ['OK'] };
}

/** Route binding a canned collector under the reference rights version. */
export function routeFixture(
  over: Partial<OperationRoute> & { adapter: ReadOnlyOperationAdapter },
): OperationRoute {
  return {
    provider: over.provider ?? 'gmgn',
    operation: over.operation ?? 'token_security',
    operationVersion: over.operationVersion ?? 'v1',
    chain: over.chain ?? 'solana',
    freshnessFamily: over.freshnessFamily ?? 'metadata',
    cachingPermitted: over.cachingPermitted ?? true,
    fieldProjection: over.fieldProjection ?? ['default'],
    licenseRequestedVersion: over.licenseRequestedVersion ?? 'rights-1',
    endpointUrl: over.endpointUrl ?? 'https://collector.fixture.internal/v1/token_security',
    egressPlane: over.egressPlane ?? 'COLLECTOR',
    deadlineMs: over.deadlineMs ?? 5_000,
    byteLimit: over.byteLimit ?? 1_048_576,
    ...(over.downgradedFieldProjection !== undefined
      ? { downgradedFieldProjection: over.downgradedFieldProjection }
      : {}),
    ...(over.inputSchema !== undefined ? { inputSchema: over.inputSchema } : {}),
    ...(over.rawSchema !== undefined ? { rawSchema: over.rawSchema } : {}),
    ...(over.normalizer !== undefined ? { normalizer: over.normalizer } : {}),
    adapter: over.adapter,
  };
}
