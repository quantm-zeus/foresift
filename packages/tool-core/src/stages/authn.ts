/**
 * Pipeline stages 1–2 (FR-CORE-002, FR-CORE-004; PRD §16.2):
 *
 *   1. authenticate actor            — via the injected perimeter primitive
 *   2. authorize scope, action class, tool profile, tenant/entity scope, rights
 *
 * Both primitives are INJECTED at the composition root; the shipped defaults
 * refuse everything (deny-closed), so an uncomposed core can never let a call
 * through. Authorization resolves the registry entry, checks profile binding,
 * scope coverage, tenant-entity containment, and evaluates the license-policy
 * seam (rights). Every failure exit carries a typed blocked state whose
 * machineReason distinguishes AUTHN / SCOPE / PROFILE / TENANT / LICENSE.
 */
import { ForesiftError } from '@foresift/domain';
import type { ActionClass, HolderMode, ToolProfileId } from '@foresift/domain';
import type { LicenseVerdict } from '@foresift/shared-schemas';
import { block, exited, type ToolCallContext } from '../run-context.ts';

export interface AuthenticatedActor {
  readonly actorId: string;
  readonly holderMode: HolderMode;
  readonly profileId: ToolProfileId;
  readonly scopes: readonly string[];
  /** Entity ids this actor may observe; undefined = unrestricted by entity. */
  readonly tenantEntityScope?: readonly string[];
}

/** Perimeter-owned authentication primitive (injected at composition). */
export interface AuthnPrimitive {
  authenticate(request: { token: unknown }): Promise<AuthenticatedActor>;
}

/** Perimeter-owned authorization primitive (injected at composition). */
export interface AuthzPrimitive {
  authorize(request: {
    actor: AuthenticatedActor;
    toolName: string;
    actionClass: ActionClass;
    requiredScopes: readonly string[];
    profileId: ToolProfileId;
    tenantEntity?: string;
  }): Promise<{ allowed: boolean; reason: string }>;
}

/** Default authn primitive: nothing authenticates until the perimeter binds. */
export class DenyClosedAuthn implements AuthnPrimitive {
  async authenticate(_request: { token: unknown }): Promise<AuthenticatedActor> {
    throw new ForesiftError(
      'AUTHENTICATION_REFUSED',
      'no authentication primitive is composed; refusing fail-closed',
      {},
    );
  }
}

/** Default authz primitive: nobody is authorized until the perimeter binds. */
export class DenyClosedAuthz implements AuthzPrimitive {
  async authorize(_request: Parameters<AuthzPrimitive['authorize']>[0]): Promise<{
    allowed: boolean;
    reason: string;
  }> {
    return { allowed: false, reason: 'AUTHZ_UNBOUND: no authorization primitive is composed' };
  }
}

function blockedExit(ctx: ToolCallContext, acquisitionState: 'RIGHTS_BLOCKED' | 'CAPABILITY_UNAVAILABLE', reason: string): void {
  block(ctx, {
    payload: {
      acquisitionState,
      machineReason: reason,
      toolName: ctx.request.toolName,
      toolVersion: ctx.entry?.metadata.version ?? ctx.request.toolVersion ?? 'unknown',
      pipelineRunId: ctx.runId,
      at: ctx.now(),
    },
    auditOutcome: 'BLOCKED',
    persistAcquisitionRow: acquisitionState === 'RIGHTS_BLOCKED' && ctx.entry !== null,
  });
}

/** Stage 1 — authenticate actor. */
export async function authenticateActor(ctx: ToolCallContext, authn: AuthnPrimitive): Promise<void> {
  if (exited(ctx)) return;
  try {
    ctx.actor = await authn.authenticate({ token: ctx.request.actorToken });
  } catch (error) {
    const reason =
      error instanceof ForesiftError
        ? `AUTHN_REFUSED:${error.code}`
        : 'AUTHN_REFUSED:credential rejected';
    blockedExit(ctx, 'RIGHTS_BLOCKED', reason);
  }
  // The authenticated holder mode/profile are authoritative when the request
  // disagrees with them — a caller cannot self-declare a broader mode.
  if (ctx.actor !== null) {
    if (ctx.actor.holderMode !== ctx.request.holderMode) {
      blockedExit(
        ctx,
        'RIGHTS_BLOCKED',
        `AUTHN_HOLDER_MODE_MISMATCH:request declared ${ctx.request.holderMode}, credential carries ${ctx.actor.holderMode}`,
      );
    } else if (ctx.actor.profileId !== ctx.request.profileId) {
      blockedExit(
        ctx,
        'RIGHTS_BLOCKED',
        `AUTHN_PROFILE_MISMATCH:request declared ${ctx.request.profileId}, credential carries ${ctx.actor.profileId}`,
      );
    }
  }
}

/** Stage 2 — authorize scope, action class, tool profile, tenant/entity, rights. */
export async function authorizeCall(
  ctx: ToolCallContext,
  deps: {
    resolveEntry: () => RegistryEntryForAuthz | null;
    authz: AuthzPrimitive;
    licenseVerdict: () => Promise<LicenseVerdict>;
  },
): Promise<void> {
  if (exited(ctx)) return;

  // Resolve the exact (or newest non-retired) registry entry.
  const entry = deps.resolveEntry();
  if (entry === null || entry.retiredAt !== null) {
    blockedExit(ctx, 'CAPABILITY_UNAVAILABLE', 'TOOL_UNKNOWN:not registered or retired');
    return;
  }
  ctx.entry = entry as ToolCallContext['entry'];
  ctx.actionClass = entry.metadata.actionClass;

  if (ctx.actor === null) {
    blockedExit(ctx, 'RIGHTS_BLOCKED', 'AUTHZ_NO_ACTOR:no authenticated actor');
    return;
  }

  // Profile binding: the requested profile must be one of the tool's bound
  // profiles AND must be the credential's own profile (narrow profiles).
  if (!entry.metadata.profiles.includes(ctx.actor.profileId)) {
    blockedExit(
      ctx,
      'RIGHTS_BLOCKED',
      `AUTHZ_PROFILE_NOT_BOUND:tool is not visible to profile ${ctx.actor.profileId}`,
    );
    return;
  }

  const verdict = await deps.authz.authorize({
    actor: ctx.actor,
    toolName: entry.metadata.name,
    actionClass: entry.metadata.actionClass,
    requiredScopes: entry.metadata.requiredScopes,
    profileId: ctx.actor.profileId,
    ...(ctx.request.tenantEntity === undefined ? {} : { tenantEntity: ctx.request.tenantEntity }),
  });
  if (!verdict.allowed) {
    blockedExit(ctx, 'RIGHTS_BLOCKED', `AUTHZ_REFUSED:${verdict.reason}`);
    return;
  }

  // Scope coverage: the actor's scopes must cover every required scope.
  const missing = entry.metadata.requiredScopes.filter(
    (scope) => !ctx.actor!.scopes.includes(scope),
  );
  if (missing.length > 0) {
    blockedExit(ctx, 'RIGHTS_BLOCKED', `AUTHZ_SCOPE_MISSING:${missing.join(',')}`);
    return;
  }

  // Tenant/entity containment.
  if (
    ctx.request.tenantEntity !== undefined &&
    ctx.actor.tenantEntityScope !== undefined &&
    !ctx.actor.tenantEntityScope.includes(ctx.request.tenantEntity)
  ) {
    blockedExit(
      ctx,
      'RIGHTS_BLOCKED',
      `AUTHZ_TENANT_ENTITY_OUT_OF_SCOPE:${ctx.request.tenantEntity}`,
    );
    return;
  }

  // Rights via THE license seam (FR-CORE-008). The verdict also becomes the
  // cache-key license component downstream.
  try {
    const license = await deps.licenseVerdict();
    ctx.licenseVerdict = license;
    if (!license.allowed) {
      blockedExit(ctx, 'RIGHTS_BLOCKED', `LICENSE_POLICY_REFUSED:${license.reason}`);
    }
  } catch (error) {
    blockedExit(
      ctx,
      'RIGHTS_BLOCKED',
      `LICENSE_POLICY_UNVERIFIABLE:${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Minimal structural view of a registry entry needed for authorization. */
export interface RegistryEntryForAuthz {
  readonly metadata: {
    readonly name: string;
    readonly version: string;
    readonly actionClass: ActionClass;
    readonly profiles: readonly ToolProfileId[];
    readonly requiredScopes: readonly string[];
  };
  readonly retiredAt: string | null;
}
