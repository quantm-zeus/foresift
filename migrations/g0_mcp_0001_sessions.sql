-- g0_mcp_0001_sessions.sql
-- Stateful MCP transport sessions (FR-MCP-009; PRD section 17.7; AC-251).
--
-- Stateful transport is disabled by default. When explicitly enabled, each
-- opaque session identifier is bound to the complete authenticated transport
-- context. A caller cannot move a session between actors, credentials, tool
-- profiles, origins, or protocol revisions. Termination is represented by a
-- timestamp so DELETE can be an idempotent guarded update rather than a row
-- deletion.

CREATE TABLE g0_mcp_sessions (
    session_id        text PRIMARY KEY
                      CHECK (length(session_id) BETWEEN 32 AND 256)
                      CHECK (session_id ~ '^[!-~]+$'),
    actor             text NOT NULL CHECK (length(actor) > 0),
    credential_id     text NOT NULL CHECK (length(credential_id) > 0),
    profile_id        text NOT NULL CHECK (length(profile_id) > 0),
    origin            text,
    protocol_revision text NOT NULL
                      CHECK (protocol_revision ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
    created_at        timestamptz NOT NULL DEFAULT now(),
    expires_at        timestamptz NOT NULL,
    terminated_at     timestamptz,
    fencing_token     bigint NOT NULL DEFAULT 1 CHECK (fencing_token > 0),
    CONSTRAINT g0_mcp_sessions_expiry_shape
        CHECK (expires_at > created_at),
    CONSTRAINT g0_mcp_sessions_termination_shape
        CHECK (terminated_at IS NULL OR terminated_at >= created_at)
);

CREATE INDEX g0_mcp_sessions_actor_expiry_idx
    ON g0_mcp_sessions (actor, expires_at);

CREATE INDEX g0_mcp_sessions_credential_expiry_idx
    ON g0_mcp_sessions (credential_id, expires_at);
