import type { UtcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import { AbuseController, type AuditChain } from '@foresift/security';

export interface McpRateClass {
  readonly name: string;
  readonly bucketCapacity: number;
  readonly refillTokensPerSecond: number;
  readonly concurrencyLimit: number;
}

export interface RateAdmissionLease {
  readonly credentialId: string;
  readonly rateClass: string;
  readonly fencingToken: number;
  readonly released: boolean;
}

interface RateRow {
  available_tokens: string | number;
  last_refilled_at: Date | string;
  in_flight: number;
  fencing_token: string | number;
}

export class McpRateLimitError extends Error {
  constructor(
    readonly code: 'RATE_LIMIT_EXCEEDED' | 'CONCURRENCY_LIMIT_EXCEEDED' | 'RATE_STATE_FENCED',
    readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'McpRateLimitError';
  }
}

export class McpRateLimiter {
  private readonly released = new Set<string>();
  private readonly engine?: DatabaseEngine;
  private readonly abuse: AbuseController | undefined;
  private readonly auditChain: AuditChain | undefined;
  private readonly clock: () => number;
  private readonly memoryConfig?: {
    readonly defaultCapacity: number;
    readonly refillPerSecond: number;
    readonly concurrencyLimit: number;
  };
  private readonly memoryState = new Map<
    string,
    { tokens: number; lastRefill: number; inFlight: number }
  >();

  constructor(
    engineOrOptions:
      | DatabaseEngine
      | {
          readonly defaultCapacity: number;
          readonly refillPerSecond: number;
          readonly concurrencyLimit: number;
          readonly clock?: () => number;
        },
    abuse?: AbuseController,
    auditChain?: AuditChain,
    clock: () => number = Date.now.bind(globalThis.Date),
  ) {
    this.clock = 'defaultCapacity' in engineOrOptions ? (engineOrOptions.clock ?? clock) : clock;
    if ('defaultCapacity' in engineOrOptions) {
      this.memoryConfig = engineOrOptions;
    } else {
      this.engine = engineOrOptions;
      this.abuse = abuse;
      this.auditChain = auditChain;
    }
  }

  async admit(
    credentialOrInput:
      | string
      | { readonly credentialId: string; readonly rateLimitClass: string; readonly cost: number },
    rateClass?: McpRateClass,
    cost = 1,
  ): Promise<
    | RateAdmissionLease
    | {
        readonly admitted: boolean;
        readonly remainingTokens?: number;
        readonly currentInFlight?: number;
        readonly refusalReason?: string;
        readonly retryAfterSeconds?: number;
      }
  > {
    if (typeof credentialOrInput !== 'string') return this.admitInMemory(credentialOrInput);
    const credentialId = credentialOrInput;
    if (rateClass === undefined || this.engine === undefined || this.abuse === undefined) {
      throw new Error('durable rate admission dependencies are not configured');
    }
    try {
      this.abuse.admit(credentialId, cost);
    } catch (error) {
      await this.audit(credentialId, 'RATE_LIMIT_EXCEEDED', { cost });
      const retryAfterMs = (error as { detail?: { retryAfterMs?: number } }).detail?.retryAfterMs;
      throw new McpRateLimitError('RATE_LIMIT_EXCEEDED', retryAfterMs);
    }
    const now = this.clock();
    const nowIso = new Date(now).toISOString();
    try {
      return await this.engine.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO g0_mcp_rate_state
         (credential_id, rate_limit_class, bucket_capacity, available_tokens,
          refill_tokens_per_sec, last_refilled_at, concurrency_limit, updated_at)
         VALUES ($1,$2,$3,$3,$4,$5,$6,$5)
         ON CONFLICT (credential_id, rate_limit_class) DO NOTHING`,
          [
            credentialId,
            rateClass.name,
            rateClass.bucketCapacity,
            rateClass.refillTokensPerSecond,
            nowIso,
            rateClass.concurrencyLimit,
          ],
        );
        const selected = await tx.query<RateRow>(
          `SELECT available_tokens, last_refilled_at, in_flight, fencing_token
         FROM g0_mcp_rate_state WHERE credential_id = $1 AND rate_limit_class = $2 FOR UPDATE`,
          [credentialId, rateClass.name],
        );
        const row = selected.rows[0];
        if (row === undefined) throw new McpRateLimitError('RATE_STATE_FENCED');
        const elapsedSeconds = Math.max(0, now - Date.parse(String(row.last_refilled_at))) / 1000;
        const available = Math.min(
          rateClass.bucketCapacity,
          Number(row.available_tokens) + elapsedSeconds * rateClass.refillTokensPerSecond,
        );
        if (available < cost) {
          throw new McpRateLimitError(
            'RATE_LIMIT_EXCEEDED',
            Math.ceil(((cost - available) / rateClass.refillTokensPerSecond) * 1000),
          );
        }
        if (row.in_flight >= rateClass.concurrencyLimit) {
          throw new McpRateLimitError('CONCURRENCY_LIMIT_EXCEEDED');
        }
        const fence = Number(row.fencing_token);
        const updated = await tx.query<{ fencing_token: string | number }>(
          `UPDATE g0_mcp_rate_state
         SET available_tokens = $4, last_refilled_at = $5, in_flight = in_flight + 1,
             fencing_token = fencing_token + 1, updated_at = $5
         WHERE credential_id = $1 AND rate_limit_class = $2 AND fencing_token = $3
         RETURNING fencing_token`,
          [credentialId, rateClass.name, fence, available - cost, nowIso],
        );
        const nextFence = updated.rows[0]?.fencing_token;
        if (nextFence === undefined) throw new McpRateLimitError('RATE_STATE_FENCED');
        return {
          credentialId,
          rateClass: rateClass.name,
          fencingToken: Number(nextFence),
          released: false,
        };
      });
    } catch (error) {
      if (error instanceof McpRateLimitError && error.code !== 'RATE_STATE_FENCED') {
        await this.audit(credentialId, error.code, { cost });
      }
      throw error;
    }
  }

  async release(lease: RateAdmissionLease): Promise<void> {
    if (!('fencingToken' in lease)) {
      const input = lease as unknown as {
        readonly credentialId: string;
        readonly rateLimitClass: string;
      };
      const state = this.memoryState.get(`${input.credentialId}:${input.rateLimitClass}`);
      if (state !== undefined) state.inFlight = Math.max(0, state.inFlight - 1);
      return;
    }
    if (this.engine === undefined) throw new Error('durable rate admission is not configured');
    const key = `${lease.credentialId}:${lease.rateClass}:${lease.fencingToken}`;
    if (this.released.has(key)) return;
    const result = await this.engine.query<{ fencing_token: string | number }>(
      `UPDATE g0_mcp_rate_state SET in_flight = in_flight - 1,
       fencing_token = fencing_token + 1, updated_at = $4
       WHERE credential_id = $1 AND rate_limit_class = $2
         AND fencing_token >= $3 AND in_flight > 0 RETURNING fencing_token`,
      [
        lease.credentialId,
        lease.rateClass,
        lease.fencingToken,
        new Date(this.clock()).toISOString(),
      ],
    );
    if (result.rows.length === 0) {
      if (this.released.has(key)) return;
      throw new McpRateLimitError('RATE_STATE_FENCED');
    }
    this.released.add(key);
  }

  private async audit(
    actor: string,
    reason: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (this.auditChain === undefined) return;
    await this.auditChain.append({
      occurredAt: new Date(this.clock()).toISOString() as UtcTimestamp,
      actor,
      actionClass: 'BLOCKED_OPERATION',
      subject: 'mcp.rate-admission',
      payload: { reason, ...payload },
    });
  }

  private admitInMemory(input: {
    readonly credentialId: string;
    readonly rateLimitClass: string;
    readonly cost: number;
  }) {
    const config = this.memoryConfig;
    if (config === undefined) throw new Error('in-memory rate admission is not configured');
    const key = `${input.credentialId}:${input.rateLimitClass}`;
    const now = this.clock();
    const state = this.memoryState.get(key) ?? {
      tokens: config.defaultCapacity,
      lastRefill: now,
      inFlight: 0,
    };
    state.tokens = Math.min(
      config.defaultCapacity,
      state.tokens + (Math.max(0, now - state.lastRefill) / 1000) * config.refillPerSecond,
    );
    state.lastRefill = now;
    if (state.inFlight >= config.concurrencyLimit) {
      this.memoryState.set(key, state);
      return { admitted: false, refusalReason: 'CONCURRENCY_LIMIT_EXCEEDED' };
    }
    if (state.tokens < input.cost) {
      this.memoryState.set(key, state);
      return {
        admitted: false,
        refusalReason: 'RATE_LIMIT_EXCEEDED',
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((input.cost - state.tokens) / config.refillPerSecond),
        ),
      };
    }
    state.tokens -= input.cost;
    state.inFlight += 1;
    this.memoryState.set(key, state);
    return { admitted: true, remainingTokens: state.tokens, currentInFlight: state.inFlight };
  }

  async getState(
    credentialId: string,
    rateLimitClass: string,
  ): Promise<{ readonly inFlight: number; readonly availableTokens: number }> {
    const state = this.memoryState.get(`${credentialId}:${rateLimitClass}`);
    return {
      inFlight: state?.inFlight ?? 0,
      availableTokens: state?.tokens ?? this.memoryConfig?.defaultCapacity ?? 0,
    };
  }
}
