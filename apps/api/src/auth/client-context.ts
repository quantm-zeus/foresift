import type { UtcTimestamp } from '@foresift/domain';

/** Complete, non-secret per-client authorization context for one presentation. */
export interface McpClientContext {
  readonly actorId: string;
  readonly credentialId: string;
  readonly identificationPrefix: string;
  readonly scopes: readonly string[];
  readonly toolProfileId: string;
  readonly toolBounds: readonly string[];
  readonly resourceBounds: readonly string[];
  readonly entityBounds: readonly string[];
  readonly quotaClass: string;
  readonly originPolicyRef: string;
  readonly expiresAt: UtcTimestamp;
}

export interface CredentialRecordLike {
  readonly credential_id: string;
  readonly scopes: readonly string[];
  readonly origin_policy_ref: string;
  readonly profile_bindings: readonly string[];
  readonly tool_bounds: readonly string[];
  readonly resource_bounds: readonly string[];
  readonly entity_bounds: readonly string[];
  readonly rate_limit_class: string;
  readonly expires_at: Date | string;
}

export class ClientContextError extends Error {
  readonly code = 'CREDENTIAL_INVALID';
}

function asUtc(value: Date | string): UtcTimestamp {
  return (typeof value === 'string' ? value : value.toISOString()) as UtcTimestamp;
}

export function clientContextFromCredential(
  row: CredentialRecordLike,
  identificationPrefix: string,
): McpClientContext {
  const toolProfileId = row.profile_bindings[0];
  if (toolProfileId === undefined || row.profile_bindings.length !== 1) {
    throw new ClientContextError('a personal bearer credential must bind exactly one tool profile');
  }
  return {
    actorId: `mcp-client:${row.credential_id}`,
    credentialId: row.credential_id,
    identificationPrefix,
    scopes: [...row.scopes],
    toolProfileId,
    toolBounds: [...row.tool_bounds],
    resourceBounds: [...row.resource_bounds],
    entityBounds: [...row.entity_bounds],
    quotaClass: row.rate_limit_class,
    originPolicyRef: row.origin_policy_ref,
    expiresAt: asUtc(row.expires_at),
  };
}

export function clientCanAccessEntity(context: McpClientContext, entity: string): boolean {
  return context.entityBounds.some((bound) => {
    if (bound === '*') return true;
    if (bound.endsWith('*')) return entity.startsWith(bound.slice(0, -1));
    return entity === bound;
  });
}

export function buildClientContext(result: {
  readonly authenticated: boolean;
  readonly credentialId?: string;
  readonly identificationPrefix?: string;
  readonly scopes?: readonly string[];
  readonly profileBindings?: readonly string[];
  readonly toolBounds?: readonly string[];
  readonly resourceBounds?: readonly string[];
  readonly entityBounds?: readonly string[];
  readonly rateLimitClass?: string;
  readonly originPolicyRef?: string;
  readonly expiresAt?: UtcTimestamp;
}) {
  if (!result.authenticated || result.credentialId === undefined) {
    throw new ClientContextError('cannot build a context from a refused credential');
  }
  return {
    actorId: `mcp-client:${result.credentialId}`,
    credentialId: result.credentialId,
    identificationPrefix: result.identificationPrefix ?? '',
    scopes: [...(result.scopes ?? [])],
    toolProfileId: result.profileBindings?.[0] ?? 'discovery',
    toolBounds: [...(result.toolBounds ?? [])],
    resourceBounds: [...(result.resourceBounds ?? [])],
    entityBounds: [...(result.entityBounds ?? [])],
    quotaClass: result.rateLimitClass ?? 'STANDARD_FREE',
    rateLimitClass: result.rateLimitClass ?? 'STANDARD_FREE',
    originPolicyRef: result.originPolicyRef ?? '',
    expiresAt: result.expiresAt ?? ('1970-01-01T00:00:00Z' as UtcTimestamp),
  };
}
