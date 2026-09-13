/**
 * §28.13 fail-closed global kill switches
 * (T012, FR-ADM-007, PRD §28.13, §35.1; AC-061, AC-262).
 *
 * The six controls are append-only, scope-exact, and fail-closed: a state that
 * is missing, unreadable, expired, or unknown resolves to the CLOSED state
 * (ENGAGED), so absence is never permission. `assertCallAllowed(kind, scope)`
 * is the single gate every admin/control downstream call consults before
 * constructing a provider, model, notification, or MCP-client call.
 *
 * `EMERGENCY_READ_ONLY_MODE` dominates every other switch: while it is closed
 * (engaged) it permits reads and refuses every write/automation path. Engage
 * and release append a new state row plus an immutable event row (never an
 * UPDATE of state/scope), require the full §35.1 evidence set through
 * `control-safety.ts`, and have no automatic reactivation and no fail-open
 * branch. Enforcement at foreign call sites is a port seam (plan D4): those
 * packages consume `assertCallAllowed`; this module never edits them.
 */
import { randomUUID } from 'node:crypto';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import { AdminErrorCode } from '@foresift/shared-schemas';
import {
  KillSwitchKindSchema,
  KillSwitchScopeSchema,
  KillSwitchStateSchema,
  type KillSwitchKind,
  type KillSwitchScope,
  type KillSwitchState,
} from '@foresift/shared-schemas';
import type { CsrfEvaluationInput } from '@foresift/security';
import type { StepUpPolicy, StepUpProof } from '@foresift/shared-schemas';
import { AdminControlError, type AdminControlGuard, stateHash } from './control-safety.ts';

/** Read vs write/automation access for a gated call. */
export type KillSwitchAccess = 'READ' | 'WRITE';

/** The scope a gated call presents to `assertCallAllowed`. */
export interface KillSwitchCallScope {
  readonly access: KillSwitchAccess;
  readonly scope: KillSwitchScope;
  readonly callRef?: string | undefined;
}

/** The effective, fail-closed resolution of one switch for one scope. */
export interface KillSwitchResolution {
  readonly switchKind: KillSwitchKind;
  readonly scope: KillSwitchScope;
  /** Effective state; `ENGAGED` is the closed state. */
  readonly state: KillSwitchState;
  readonly closed: boolean;
  /** True when resolution fell back to closed (unreadable/expired/unknown). */
  readonly degraded: boolean;
  readonly reason: string | null;
  readonly stateRowId: string | null;
  readonly resolvedAt: string;
}

export interface KillSwitchTransitionInput {
  readonly switchKind: KillSwitchKind;
  readonly scope: KillSwitchScope;
  readonly actorRef: string;
  readonly reason?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly stepUpProof?: StepUpProof | undefined;
  readonly csrf?: CsrfEvaluationInput | undefined;
  readonly authorizedScopes: readonly string[];
  readonly policy: StepUpPolicy;
  /** Optional expiry; an expired state resolves closed. */
  readonly expiresAt?: string | null | undefined;
}

export interface KillSwitchTransitionResult {
  /** True when the idempotency key already recorded this transition. */
  readonly replayed: boolean;
  readonly eventId: string | null;
  readonly resolution: KillSwitchResolution;
}

export interface CreateKillSwitchResolverOptions {
  readonly engine: DatabaseEngine;
  /** The §35.1 guard; required for engage/release, optional for read-only use. */
  readonly guard?: AdminControlGuard | undefined;
  readonly clock?: (() => number) | undefined;
}

interface KillSwitchStateDbRow {
  readonly state_row_id: string;
  readonly state: string;
  readonly reason: string | null;
  readonly expires_at: string | null;
}

interface KillSwitchEventDbRow {
  readonly event_id: string;
  readonly switch_kind: string;
  readonly to_state: string;
  readonly scope_hash: string;
}

/** The closed (blocked) resolution used for every fail-closed fallback. */
function closedResolution(
  switchKind: KillSwitchKind,
  scope: KillSwitchScope,
  resolvedAt: string,
  reason: string,
  degraded: boolean,
): KillSwitchResolution {
  return {
    switchKind,
    scope,
    state: 'ENGAGED',
    closed: true,
    degraded,
    reason,
    stateRowId: null,
    resolvedAt,
  };
}

function parseKillSwitchKind(value: unknown): KillSwitchKind {
  const parsed = KillSwitchKindSchema.safeParse(value);
  if (!parsed.success) {
    throw new AdminControlError(
      AdminErrorCode.ADMIN_KILL_SWITCH_KIND_UNKNOWN,
      `unknown kill-switch kind '${String(value)}'`,
      { switchKind: String(value) },
    );
  }
  return parsed.data;
}

function parseKillSwitchScope(value: unknown): KillSwitchScope {
  const parsed = KillSwitchScopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new AdminControlError(
      AdminErrorCode.ADMIN_ACTION_REQUEST_INVALID,
      'a kill-switch scope must be an exact {scopeKind, scopeRef} object',
      { issues: parsed.error.issues.map((issue) => issue.message) },
    );
  }
  return parsed.data;
}

function scopeHashOf(scope: KillSwitchScope): string {
  return sha256Text(canonicalJson(scope));
}

export class KillSwitchResolver {
  private readonly engine: DatabaseEngine;
  private readonly guard: AdminControlGuard | undefined;
  private readonly clock: () => number;

  constructor(options: CreateKillSwitchResolverOptions) {
    this.engine = options.engine;
    this.guard = options.guard;
    this.clock = options.clock ?? (() => Date.now());
  }

  private resolveNow(): string {
    return new Date(this.clock()).toISOString();
  }

  /**
   * Resolve one switch for one exact scope. Every unreadable/missing/expired/
   * unknown state resolves CLOSED (ENGAGED); an unknown switch KIND refuses
   * typed instead of guessing.
   */
  async resolve(kind: unknown, scope: unknown): Promise<KillSwitchResolution> {
    const switchKind = parseKillSwitchKind(kind);
    const parsedScope = parseKillSwitchScope(scope);
    const now = this.resolveNow();
    let row: KillSwitchStateDbRow | undefined;
    try {
      const result = await this.engine.query<KillSwitchStateDbRow>(
        `SELECT state_row_id, state, reason, expires_at
           FROM adm.kill_switch_states
          WHERE switch_kind = $1 AND scope_hash = $2 AND superseded_by IS NULL
          ORDER BY created_at DESC, state_row_id DESC
          LIMIT 1`,
        [switchKind, scopeHashOf(parsedScope)],
      );
      row = result.rows[0];
    } catch {
      return closedResolution(
        switchKind,
        parsedScope,
        now,
        'kill-switch state is unreadable: resolving closed',
        true,
      );
    }
    if (row === undefined) {
      return closedResolution(
        switchKind,
        parsedScope,
        now,
        'no kill-switch state recorded: resolving closed',
        false,
      );
    }
    const state = KillSwitchStateSchema.safeParse(row.state);
    if (!state.success) {
      return closedResolution(
        switchKind,
        parsedScope,
        now,
        'unknown kill-switch state: resolving closed',
        true,
      );
    }
    if (row.expires_at !== null && Date.parse(now) >= Date.parse(row.expires_at)) {
      return closedResolution(
        switchKind,
        parsedScope,
        now,
        'expired kill-switch state: resolving closed',
        true,
      );
    }
    return {
      switchKind,
      scope: parsedScope,
      state: state.data,
      closed: state.data === 'ENGAGED',
      degraded: false,
      reason: row.reason,
      stateRowId: row.state_row_id,
      resolvedAt: now,
    };
  }

  /**
   * The single gate every downstream call consults. Refuses typed when the
   * requested switch is engaged, and lets `EMERGENCY_READ_ONLY_MODE` dominate:
   * while that switch is closed, every WRITE/automation call is refused and
   * only reads proceed.
   */
  async assertCallAllowed(
    kind: unknown,
    callScope: KillSwitchCallScope,
  ): Promise<KillSwitchResolution> {
    const switchKind = parseKillSwitchKind(kind);
    if (
      callScope === null ||
      typeof callScope !== 'object' ||
      (callScope.access !== 'READ' && callScope.access !== 'WRITE')
    ) {
      throw new AdminControlError(
        AdminErrorCode.ADMIN_ACTION_REQUEST_INVALID,
        'assertCallAllowed requires an explicit READ or WRITE access scope',
      );
    }
    const resolution = await this.resolve(switchKind, callScope.scope);
    const emergency =
      switchKind === 'EMERGENCY_READ_ONLY_MODE'
        ? resolution
        : await this.resolve('EMERGENCY_READ_ONLY_MODE', callScope.scope);

    if (callScope.access === 'WRITE' && emergency.closed) {
      throw new AdminControlError(
        AdminErrorCode.ADMIN_KILL_SWITCH_ENGAGED,
        'EMERGENCY_READ_ONLY_MODE is engaged: write/automation calls are refused',
        {
          switchKind,
          access: callScope.access,
          degraded: emergency.degraded,
          callRef: callScope.callRef ?? null,
        },
      );
    }
    const blocked =
      resolution.closed &&
      !(switchKind === 'EMERGENCY_READ_ONLY_MODE' && callScope.access === 'READ');
    if (blocked) {
      throw new AdminControlError(
        AdminErrorCode.ADMIN_KILL_SWITCH_ENGAGED,
        `${switchKind} is engaged: ${callScope.access} calls are refused`,
        {
          switchKind,
          access: callScope.access,
          degraded: resolution.degraded,
          stateRowId: resolution.stateRowId,
          callRef: callScope.callRef ?? null,
        },
      );
    }
    return resolution;
  }

  /** Append a new ENGAGED state row plus its immutable event. */
  async engage(input: KillSwitchTransitionInput): Promise<KillSwitchTransitionResult> {
    return this.transition(input, 'ENGAGED');
  }

  /** Append a new DISENGAGED state row plus its immutable event. */
  async release(input: KillSwitchTransitionInput): Promise<KillSwitchTransitionResult> {
    return this.transition(input, 'DISENGAGED');
  }

  private async transition(
    input: KillSwitchTransitionInput,
    toState: KillSwitchState,
  ): Promise<KillSwitchTransitionResult> {
    const switchKind = parseKillSwitchKind(input.switchKind);
    const scope = parseKillSwitchScope(input.scope);
    const scopeHash = scopeHashOf(scope);

    // A replay collapses on the idempotency key BEFORE any authorization or
    // state write: it changes nothing, and reusing the key for a different
    // transition refuses typed rather than silently returning the prior result.
    if (input.idempotencyKey !== undefined && input.idempotencyKey.length > 0) {
      const prior = await this.engine.query<KillSwitchEventDbRow>(
        `SELECT event_id, switch_kind, to_state, scope_hash
           FROM adm.kill_switch_events WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      const existing = prior.rows[0];
      if (existing !== undefined) {
        if (
          existing.switch_kind !== switchKind ||
          existing.to_state !== toState ||
          existing.scope_hash !== scopeHash
        ) {
          throw new AdminControlError(
            AdminErrorCode.ADMIN_KILL_SWITCH_TRANSITION_INVALID,
            'the idempotency key was already used for a different kill-switch transition',
            { switchKind, idempotencyKey: input.idempotencyKey },
          );
        }
        return {
          replayed: true,
          eventId: existing.event_id,
          resolution: await this.resolve(switchKind, scope),
        };
      }
    }

    const guard = this.guard;
    if (guard === undefined) {
      throw new AdminControlError(
        AdminErrorCode.ADMIN_ACTION_REQUEST_INVALID,
        'a kill-switch transition requires the §35.1 control guard',
        { switchKind },
      );
    }
    const authorized = await guard.authorize({
      actionKind: toState === 'ENGAGED' ? 'KILL_SWITCH_ENGAGE' : 'KILL_SWITCH_DISENGAGE',
      targetRef: switchKind,
      targetVersionRef: null,
      actorRef: input.actorRef,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      stepUpProof: input.stepUpProof,
      csrf: input.csrf,
      authorizedScopes: input.authorizedScopes,
      policy: input.policy,
    });

    const now = this.resolveNow();
    const stateRowId = randomUUID();
    const eventId = randomUUID();
    const auditRef = `adm:kill-switch:${eventId}`;
    const expiresAt = input.expiresAt ?? null;
    const reason = input.reason ?? null;

    await this.engine.transaction(async (tx) => {
      const current = await tx.query<{ state_row_id: string; state: string }>(
        `SELECT state_row_id, state
           FROM adm.kill_switch_states
          WHERE switch_kind = $1 AND scope_hash = $2 AND superseded_by IS NULL
          ORDER BY created_at DESC, state_row_id DESC
          LIMIT 1
          FOR UPDATE`,
        [switchKind, scopeHash],
      );
      const currentRow = current.rows[0];
      // Close the prior open row FIRST (the open-row unique index forbids two
      // open rows; the superseded_by FK is deferred so it settles at commit).
      if (currentRow !== undefined) {
        await tx.query(
          `UPDATE adm.kill_switch_states SET superseded_by = $1
            WHERE state_row_id = $2 AND superseded_by IS NULL`,
          [stateRowId, currentRow.state_row_id],
        );
      }
      await tx.query(
        `INSERT INTO adm.kill_switch_states
           (state_row_id, switch_kind, scope, scope_hash, state, reason, actor_ref,
            step_up_ref, audit_ref, expires_at, created_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          stateRowId,
          switchKind,
          JSON.stringify(scope),
          scopeHash,
          toState,
          reason,
          authorized.request.actorRef,
          authorized.decision.stepUpProofId,
          auditRef,
          expiresAt,
          now,
        ],
      );
      await tx.query(
        `INSERT INTO adm.kill_switch_events
           (event_id, switch_kind, from_state, to_state, scope, scope_hash, reason,
            actor_ref, step_up_ref, csrf_ref, idempotency_key, audit_ref, occurred_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          eventId,
          switchKind,
          currentRow?.state ?? null,
          toState,
          JSON.stringify(scope),
          scopeHash,
          input.reason ?? `${toState === 'ENGAGED' ? 'engaged' : 'released'} by admin`,
          authorized.request.actorRef,
          authorized.decision.stepUpProofId,
          authorized.csrfRef,
          authorized.request.idempotencyKey,
          auditRef,
          now,
        ],
      );
      await guard.recordAllowed(tx, authorized, {
        beforeHash:
          currentRow === undefined
            ? null
            : stateHash({ switchKind, scopeHash, state: currentRow.state }),
        afterHash: stateHash({ switchKind, scopeHash, state: toState }),
        auditRef,
      });
    });

    return {
      replayed: false,
      eventId,
      resolution: {
        switchKind,
        scope,
        state: toState,
        closed: toState === 'ENGAGED',
        degraded: false,
        reason,
        stateRowId,
        resolvedAt: now,
      },
    };
  }
}

/** Build the fail-closed kill-switch resolver. */
export function createKillSwitchResolver(
  options: CreateKillSwitchResolverOptions,
): KillSwitchResolver {
  return new KillSwitchResolver(options);
}
