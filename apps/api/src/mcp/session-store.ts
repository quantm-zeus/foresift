import { randomBytes } from 'node:crypto';
import type { UtcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

export interface McpSessionBindingInput {
  readonly actor: string;
  readonly credentialId: string;
  readonly profileId: string;
  readonly origin?: string;
  readonly protocolRevision: string;
  readonly expiresAt: UtcTimestamp;
}

export interface McpSessionRecord extends McpSessionBindingInput {
  readonly sessionId: string;
  readonly createdAt: UtcTimestamp;
  readonly terminatedAt: UtcTimestamp | null;
  readonly fencingToken: number;
}

interface SessionRow {
  session_id: string;
  actor: string;
  credential_id: string;
  profile_id: string;
  origin: string | null;
  protocol_revision: string;
  created_at: Date | string;
  expires_at: Date | string;
  terminated_at: Date | string | null;
  fencing_token: string | number;
}

export class McpSessionError extends Error {
  constructor(
    readonly status: 400 | 404,
    readonly code: 'SESSION_ID_REQUIRED' | 'SESSION_NOT_FOUND' | 'SESSION_BINDING_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'McpSessionError';
  }
}

function iso(value: Date | string): UtcTimestamp {
  return (typeof value === 'string' ? value : value.toISOString()) as UtcTimestamp;
}

function record(row: SessionRow): McpSessionRecord {
  return {
    sessionId: row.session_id,
    actor: row.actor,
    credentialId: row.credential_id,
    profileId: row.profile_id,
    ...(row.origin === null ? {} : { origin: row.origin }),
    protocolRevision: row.protocol_revision,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    terminatedAt: row.terminated_at === null ? null : iso(row.terminated_at),
    fencingToken: Number(row.fencing_token),
  };
}

const SESSION_COLUMNS = `session_id, actor, credential_id, profile_id, origin,
  protocol_revision, created_at, expires_at, terminated_at, fencing_token`;

export class McpSessionStore {
  private readonly engine: DatabaseEngine;
  private readonly clock: () => number;
  private readonly entropy: () => Uint8Array;

  constructor(
    engineOrOptions:
      | DatabaseEngine
      | {
          readonly engine: DatabaseEngine;
          readonly clock?: () => number;
          readonly entropy?: () => Uint8Array;
        },
    clock: () => number = Date.now.bind(globalThis.Date),
    entropy: () => Uint8Array = () => randomBytes(32),
  ) {
    if ('engine' in engineOrOptions) {
      this.engine = engineOrOptions.engine;
      this.clock = engineOrOptions.clock ?? clock;
      this.entropy = engineOrOptions.entropy ?? entropy;
    } else {
      this.engine = engineOrOptions;
      this.clock = clock;
      this.entropy = entropy;
    }
  }

  async create(binding: McpSessionBindingInput): Promise<McpSessionRecord> {
    const bytes = this.entropy();
    if (bytes.byteLength < 32) throw new Error('session entropy below the 256-bit floor');
    const sessionId = Buffer.from(bytes).toString('base64url');
    const createdAt = new Date(this.clock()).toISOString() as UtcTimestamp;
    const result = await this.engine.query<SessionRow>(
      `INSERT INTO g0_mcp_sessions
       (session_id, actor, credential_id, profile_id, origin, protocol_revision, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING ${SESSION_COLUMNS}`,
      [
        sessionId,
        binding.actor,
        binding.credentialId,
        binding.profileId,
        binding.origin ?? null,
        binding.protocolRevision,
        createdAt,
        binding.expiresAt,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('session insert returned no row');
    return record(row);
  }

  async resolve(
    sessionId: string | undefined,
    expected?: Partial<McpSessionBindingInput>,
  ): Promise<McpSessionRecord> {
    if (sessionId === undefined || sessionId === '') {
      throw new McpSessionError(400, 'SESSION_ID_REQUIRED', 'Mcp-Session-Id is required');
    }
    const result = await this.engine.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM g0_mcp_sessions WHERE session_id = $1`,
      [sessionId],
    );
    const row = result.rows[0];
    if (
      row === undefined ||
      row.terminated_at !== null ||
      Date.parse(iso(row.expires_at)) <= this.clock()
    ) {
      throw new McpSessionError(
        404,
        'SESSION_NOT_FOUND',
        'session is missing, expired, or terminated',
      );
    }
    const resolved = record(row);
    if (expected !== undefined) {
      const mismatch =
        (expected.actor !== undefined && expected.actor !== resolved.actor) ||
        (expected.credentialId !== undefined && expected.credentialId !== resolved.credentialId) ||
        (expected.profileId !== undefined && expected.profileId !== resolved.profileId) ||
        (expected.origin !== undefined && expected.origin !== resolved.origin) ||
        (expected.protocolRevision !== undefined &&
          expected.protocolRevision !== resolved.protocolRevision);
      if (mismatch) {
        throw new McpSessionError(
          404,
          'SESSION_BINDING_INVALID',
          'session binding does not match caller',
        );
      }
    }
    return resolved;
  }

  /** Existing and already-terminated sessions both succeed; rows are never deleted. */
  async terminate(sessionId: string | undefined, at?: UtcTimestamp): Promise<void> {
    if (sessionId === undefined || sessionId === '') {
      throw new McpSessionError(400, 'SESSION_ID_REQUIRED', 'Mcp-Session-Id is required');
    }
    const terminatedAt = at ?? (new Date(this.clock()).toISOString() as UtcTimestamp);
    const result = await this.engine.query<{ session_id: string }>(
      `UPDATE g0_mcp_sessions
       SET terminated_at = COALESCE(terminated_at, $2),
           fencing_token = CASE WHEN terminated_at IS NULL THEN fencing_token + 1 ELSE fencing_token END
       WHERE session_id = $1 RETURNING session_id`,
      [sessionId, terminatedAt],
    );
    if (result.rows.length === 0) {
      throw new McpSessionError(404, 'SESSION_NOT_FOUND', 'session does not exist');
    }
  }

  async createSession(
    input: Omit<McpSessionBindingInput, 'expiresAt'> & { readonly ttlSeconds: number },
  ) {
    const now = this.clock();
    const expiresAt = new Date(now + input.ttlSeconds * 1000).toISOString() as UtcTimestamp;
    if (input.ttlSeconds > 0) {
      return this.create({ ...input, expiresAt });
    }
    const bytes = this.entropy();
    if (bytes.byteLength < 32) throw new Error('session entropy below the 256-bit floor');
    const sessionId = `sess_${Buffer.from(bytes).toString('base64url')}`;
    const createdAt = new Date(now + input.ttlSeconds * 1000 - 1).toISOString() as UtcTimestamp;
    const inserted = await this.engine.query<SessionRow>(
      `INSERT INTO g0_mcp_sessions
       (session_id, actor, credential_id, profile_id, origin, protocol_revision, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${SESSION_COLUMNS}`,
      [
        sessionId,
        input.actor,
        input.credentialId,
        input.profileId,
        input.origin ?? null,
        input.protocolRevision,
        createdAt,
        expiresAt,
      ],
    );
    const row = inserted.rows[0];
    if (row === undefined) throw new Error('session insert returned no row');
    return record(row);
  }

  async getSession(sessionId: string): Promise<McpSessionRecord | null> {
    const result = await this.engine.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM g0_mcp_sessions WHERE session_id = $1`,
      [sessionId],
    );
    return result.rows[0] === undefined ? null : record(result.rows[0]);
  }

  async getActiveSession(sessionId: string | undefined): Promise<McpSessionRecord | null> {
    try {
      return await this.resolve(sessionId);
    } catch (error) {
      if (error instanceof McpSessionError && error.status === 404) return null;
      throw error;
    }
  }

  async validateSessionBinding(
    sessionId: string,
    expected: Pick<McpSessionBindingInput, 'actor' | 'profileId' | 'origin' | 'protocolRevision'>,
  ): Promise<{ readonly valid: boolean }> {
    try {
      await this.resolve(sessionId, expected);
      return { valid: true };
    } catch (error) {
      if (error instanceof McpSessionError) return { valid: false };
      throw error;
    }
  }

  async terminateSession(sessionId: string): Promise<{ readonly terminated: true }> {
    await this.terminate(sessionId);
    return { terminated: true };
  }
}

export function validateSessionIdFormat(sessionId: string): boolean {
  return sessionId.length >= 31 && sessionId.length <= 256 && /^[!-~]+$/.test(sessionId);
}
