/**
 * Tenant context derivation and namespaced keys (FR-SEC-009, §35.15; T129).
 *
 * Every shared surface — cache, queues, sessions, quotas, logs, metrics,
 * model context — derives its partition key THROUGH this module, so a
 * surface can never "forget" the tenant namespace. Model-context partitions
 * are opaque (hash-derived): tenants cannot be enumerated from them.
 */
import {
  TENANT_ISOLATED_SURFACES,
  TenantContextSchema,
  type TenantContext,
  type TenantIsolatedSurface,
} from '@foresift/shared-schemas';
import { sha256Text } from '@foresift/persistence';
import { SecErrorCode, TenantIsolationError } from '@foresift/security';

export { TENANT_ISOLATED_SURFACES };
export type { TenantContext, TenantIsolatedSurface };

/** Parse-and-derive a TenantContext from untrusted input (fail-closed). */
export function deriveTenantContext(input: unknown): TenantContext {
  const result = TenantContextSchema.safeParse(input);
  if (!result.success) {
    throw new TenantIsolationError(
      'tenant context failed schema validation',
      {
        issues: result.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join('; '),
      },
      SecErrorCode.SEC_TENANT_CONTEXT_INVALID,
    );
  }
  return result.data;
}

/**
 * Isolation mode is ACTIVE unless the context is explicitly PUBLIC. While
 * active, unscoped queries are refused (row-scope) and every key below is
 * mandatory. PUBLIC rollout remains gated by later packages per ADR-057.
 */
export function isolationActive(context: TenantContext): boolean {
  return context.mode !== 'PUBLIC';
}

/** Readable prefix used by human-facing surfaces (logs, metrics labels). */
export function tenantKeyPrefix(context: TenantContext): string {
  return `tn/${context.tenantId}`;
}

/**
 * Derive the namespaced storage/log/metric key for one isolated surface.
 * Keys are relative, traversal-free, and always tenant-prefixed — even in
 * PUBLIC mode (PUBLIC relaxes READ scoping later, never write namespaces).
 */
export function deriveNamespacedKey(
  context: TenantContext,
  surface: TenantIsolatedSurface,
  relativeKey: string,
): string {
  const normalized = relativeKey.replaceAll('\\', '/');
  if (
    normalized === '' ||
    normalized.startsWith('/') ||
    normalized.split('/').includes('..') ||
    normalized.includes('\0')
  ) {
    throw new TenantIsolationError(
      `relative key for ${surface} must be traversal-free and non-empty`,
      {},
      SecErrorCode.SEC_TENANT_KEY_MALFORMED,
    );
  }
  return `${tenantKeyPrefix(context)}/${surface.toLowerCase()}/${normalized}`;
}

/**
 * Opaque model-context partition id: domain-separated hash of the tenant
 * identity. Prompt partitions never leak tenant ids into model-visible
 * storage names, and the partition cannot be guessed from a tenant list.
 */
export function deriveModelContextPartition(context: TenantContext): string {
  return `iso:v1:${sha256Text(`foresift/model-context-partition/v1\n${context.tenantId}\n`).slice(7)}`;
}

/** Queue/topic name for a tenant's async work (queue surface). */
export function deriveQueueName(context: TenantContext, purpose: string): string {
  return deriveNamespacedKey(context, 'QUEUES', purpose);
}

/** Session-store key namespace (sessions surface). */
export function deriveSessionKey(context: TenantContext, sessionLocalPart: string): string {
  return deriveNamespacedKey(context, 'SESSIONS', sessionLocalPart);
}
