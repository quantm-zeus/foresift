-- g0_mcp_0001_sessions.sql
-- Stateful MCP transport bindings (FR-MCP-009, AC-251).
--
-- Session identifiers are opaque visible-ASCII values. They are bound to all
-- authenticated transport dimensions used by the protocol guard; possession
-- of an id alone therefore cannot change actor, profile, Origin policy, or
-- protocol revision. Termination is a timestamped state transition so DELETE
-- can be idempotent without erasing the binding evidence.

CREATE SCHEMA IF NOT EXISTS mcp;

CREATE TABLE mcp.sessions (
    session_id         text PRIMARY KEY
                         CHECK (session_id ~ '^[!-~]{32,256}$'),
    credential_id      text NOT NULL CHECK (length(credential_id) > 0),
    actor_id            text NOT NULL CHECK (length(actor_id) > 0),
    tool_profile_id     text NOT NULL CHECK (length(tool_profile_id) > 0),
    origin_policy_ref   text NOT NULL CHECK (length(origin_policy_ref) > 0),
    normalized_origin   text,
    protocol_revision   text NOT NULL
                         CHECK (protocol_revision ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'),
    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    terminated_at       timestamptz,
    CONSTRAINT mcp_session_expiry_shape CHECK (expires_at > created_at),
    CONSTRAINT mcp_session_termination_shape CHECK (
        terminated_at IS NULL OR terminated_at >= created_at),
    CONSTRAINT mcp_session_origin_shape CHECK (
        normalized_origin IS NULL OR
        normalized_origin ~ '^https?://[^/?#]+$')
);

CREATE INDEX mcp_sessions_credential_idx
    ON mcp.sessions (credential_id);
CREATE INDEX mcp_sessions_expiry_idx
    ON mcp.sessions (expires_at)
    WHERE terminated_at IS NULL;
