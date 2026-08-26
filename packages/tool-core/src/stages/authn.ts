/**
 * Pipeline stages 1–2 (FR-CORE-002, FR-CORE-004; PRD §16.2): authenticate the
 * actor through the INJECTED perimeter primitive and authorize scope / action
 * class / profile / tenant-entity / rights. Both primitives are fail-closed
 * seams: the shipped defaults refuse EVERY actor, so nothing executes until a
 * real perimeter implementation is composed (deny-closed by construction).
 *
 * Failure exits produce typed blocked states — never thrown past the engine.
 */
import { ForesiftError, isAdmissibleActionClass, toolProfileId } from '@foresift/domain';
import type { BackpressureAction, HolderMode } from '@foresift/domain';
import type {
  RefusedAcquisitionState,
  ToolRunContext,
  ActorIdentity,
  ToolExecutionRequest,
} from '../run-context.ts';
import type { ToolCoreRegistry } from '../registry.ts';
import type { LicensePolicySource } from '../license-contract.ts';
import type { OperationRoute } from '../provider-contract.ts';
import { isVisibleToProfile, type ProfileBinding } from '../profiles.ts';

/** Authentication seam implemented by the security perimeter consumer. */
export interface AuthnPrimitive {
  authenticate(request: {
    readonly material: unknown;
    readonly holderMode: HolderMode;
    readonly tenantId: string;
  }): Promise<ActorIdentity>;
}

/**
 * Authorization seam: verifies scope / tenant-entity reach for an
 * authenticated actor over one tool. Profile visibility and action-class
 * admissibility are checked HERE in tool-core regardless of the primitive's
 * own verdicts (defense in depth).
 */
export interface AuthzPrimitive {
  authorize(request: {
    readonly actor: ActorIdentity;
    readonly toolName: string;
    readonly tenantId: string;
    readonly canonicalEntityIdentity: string;
  }): Promise<{ readonly allowed: boolean; readonly reason: string }>;
}

/** Deny-closed default: no actor authenticates until a perimeter is bound. */
export class DenyClosedAuthn implements AuthnPrimitive {
  async authenticate(_request: {
    readonly material: unknown;
    readonly holderMode: HolderMode;
    readonly tenantId: string;
  }): Promise<ActorIdentity> {
    throw new ForesiftError(
      'AUTHENTICATION_REFUSED',
      'no authentication primitive is composed; refusing every actor',
      {},
    );
  }
}

/** Deny-closed default: no tenant-entity pair is authorized. */
export class DenyClosedAuthz implements AuthzPrimitive {
  async authorize(_request: {
    readonly actor: ActorIdentity;
    readonly toolName: string;
    readonly tenantId: string;
    readonly canonicalEntityIdentity: string;
  }): Promise<{ readonly allowed: boolean; readonly reason: string }> {
    return { allowed: false, reason: 'AUTHZ_UNBOUND: no authorization primitive is composed' };
  }
}

export interface AuthnStageDeps {
  readonly registry: ToolCoreRegistry;
  readonly authn: AuthnPrimitive;
  readonly authz: AuthzPrimitive;
}

/** Record a typed blocked exit on the context (later functional stages skip). */
export function block(
  ctx: ToolRunContext,
  state: RefusedAcquisitionState,
  machineReason: string,
  atStage: string,
  backpressure?: BackpressureAction,
): void {
  ctx.blocked = { state, machineReason, atStage, ...(backpressure ? { backpressure } : {}) };
}

/** Stage 1 — AUTHENTICATE_ACTOR. */
export function makeAuthenticateStage(deps: AuthnStageDeps) {
  return async (ctx: ToolRunContext): Promise<void> => {
    let identity: ActorIdentity;
    try {
      identity = await deps.authn.authenticate({
        material: ctx.request.authnMaterial,
        holderMode: ctx.request.holderMode,
        tenantId: ctx.request.tenantId,
      });
    } catch (error) {
      // Refusals are DATA here too: an unbound or refusing perimeter is a
      // rights block, never a crash past the pipeline.
      const message = error instanceof Error ? error.message : String(error);
      block(ctx, 'RIGHTS_BLOCKED', `AUTHENTICATION_REFUSED: ${message}`, 'AUTHENTICATE_ACTOR');
      return;
    }
    if (!identity.actorId || !identity.profileId || !Array.isArray(identity.scopes)) {
      block(
        ctx,
        'RIGHTS_BLOCKED',
        'AUTHENTICATION_REFUSED: authentication primitive returned an incomplete identity',
        'AUTHENTICATE_ACTOR',
      );
      return;
    }
    ctx.actor = identity;
  };
}

export interface AuthorizeStageDeps extends AuthnStageDeps {
  readonly licenseSource: LicensePolicySource;
  /** Resolve the operation route bound to a tool version (unrouted ⇒ unavailable). */
  readonly resolveRoute: (
    request: ToolExecutionRequest,
    entryName: string,
  ) => OperationRoute | undefined;
}

/**
 * Stage 2 — AUTHORIZE_SCOPE_ACTION_CLASS_PROFILE_TENANT_ENTITY_RIGHTS.
 * Order is fail-closed: registry resolution → action-class admissibility →
 * profile visibility → required scopes → tenant-entity authorization →
 * license verdict (rights). Every refusal names its exact check.
 */
export function makeAuthorizeStage(deps: AuthorizeStageDeps) {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (ctx.blocked) return;
    const req = ctx.request;
    const actor = ctx.actor;
    if (!actor) throw new Error('authorize ran without an authenticated actor');

    const entry = deps.registry.resolve(req.toolName, req.toolVersion);
    if (entry === undefined || entry.retiredAt !== null) {
      block(ctx, 'CAPABILITY_UNAVAILABLE', `tool ${req.toolName} is not registered`, 'AUTHORIZE');
      return;
    }
    ctx.registryEntryName = entry.metadata.name;
    ctx.registryEntryVersion = entry.metadata.version;
    ctx.toolDescription = entry.metadata.description;
    ctx.inputSchemaJson = entry.metadata.inputSchemaJson;
    ctx.actionClass = entry.metadata.actionClass;

    // Route binding: an unrouted tool is an explicitly unavailable capability
    // even when registered (its provider operation has not been composed).
    const route = deps.resolveRoute(req, entry.metadata.name);
    if (route === undefined) {
      block(
        ctx,
        'CAPABILITY_UNAVAILABLE',
        `tool ${req.toolName} has no composed operation route`,
        'AUTHORIZE',
      );
      return;
    }
    ctx.route = route;

    // Action class must be a registered READ-ONLY class (FR-CORE-005 gate 1).
    if (!isAdmissibleActionClass(entry.metadata.actionClass)) {
      block(
        ctx,
        'RIGHTS_BLOCKED',
        `action class ${entry.metadata.actionClass} is not admissible`,
        'AUTHORIZE',
      );
      return;
    }

    // Narrow-profile visibility (FR-CORE-004): the binding decides, not the
    // definition's self-declared profile list alone. Unknown profile ids are
    // fail-closed refusals — never an empty toolset.
    let binding: ProfileBinding;
    try {
      binding = { id: toolProfileId(actor.profileId), klass: 'STANDARD' };
    } catch {
      block(ctx, 'RIGHTS_BLOCKED', `unknown profile ${actor.profileId}`, 'AUTHORIZE');
      return;
    }
    if (
      !entry.metadata.profiles.includes(binding.id) ||
      !isVisibleToProfile(
        {
          name: entry.metadata.name,
          ...(entry.metadata.atomic !== undefined ? { atomic: entry.metadata.atomic } : {}),
        },
        binding,
      )
    ) {
      block(
        ctx,
        'RIGHTS_BLOCKED',
        `tool ${req.toolName} is not visible to profile ${binding.id}`,
        'AUTHORIZE',
      );
      return;
    }

    // Required scopes must be a subset of the actor's granted scopes.
    const missing = entry.metadata.requiredScopes.filter((s) => !actor.scopes.includes(s));
    if (missing.length > 0) {
      block(ctx, 'RIGHTS_BLOCKED', `missing required scopes: ${missing.join(',')}`, 'AUTHORIZE');
      return;
    }

    // Tenant-entity reach through the injected primitive.
    let verdict: { readonly allowed: boolean; readonly reason: string };
    try {
      verdict = await deps.authz.authorize({
        actor,
        toolName: req.toolName,
        tenantId: req.tenantId,
        canonicalEntityIdentity: req.canonicalEntityIdentity,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      block(ctx, 'RIGHTS_BLOCKED', `AUTHORIZATION_REFUSED: ${message}`, 'AUTHORIZE');
      return;
    }
    if (!verdict.allowed) {
      block(ctx, 'RIGHTS_BLOCKED', verdict.reason, 'AUTHORIZE');
      return;
    }

    // Rights status feeds both admission and the cache-key license component.
    let rights;
    try {
      rights = await deps.licenseSource.verdict({
        licensePolicyId: entry.metadata.licensePolicyId,
        provider: route.provider,
        operation: route.operation,
        ...(route.licenseRequestedVersion !== undefined
          ? { requestedVersion: route.licenseRequestedVersion }
          : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      block(ctx, 'RIGHTS_BLOCKED', `LICENSE_UNVERIFIABLE: ${message}`, 'AUTHORIZE');
      return;
    }
    if (!rights.allowed) {
      block(ctx, 'RIGHTS_BLOCKED', `LICENSE_REFUSED: ${rights.reason}`, 'AUTHORIZE');
      return;
    }
    ctx.licenseVerdict = rights;
  };
}
