-- g0_mcp_0001_sessions.sql
-- Optional stateful Streamable HTTP session bindings (FR-MCP-009, §17.7,
-- AC-251). Stateless transport remains the application default; this table is
-- the durable authority only when a tested client requires sessions.
--
-- Session identifiers are opaque, printable ASCII values. They carry no
-- credential material and are always re-bound to every security dimension on
-- lookup. Termination is a timestamped, idempotent state transition; rows are
-- retained so a terminated identifier can never be mistaken for a new one.

CREATE SCHEMA IF NOT EXISTS mcp;

CREATE TABLE mcp.mcp_sessions (
    session_id         text PRIMARY KEY
                         CHECK (session_id ~ '^[!-~]+$' AND length(session_id) >= 32),
    credential_id      text NOT NULL CHECK (length(credential_id) > 0),
    actor_id           text NOT NULL CHECK (length(actor_id) > 0),
    tool_profile_id    text NOT NULL CHECK (length(tool_profile_id) > 0),
    origin_policy_ref  text NOT NULL CHECK (length(origin_policy_ref) > 0),
    request_origin     text,
    protocol_revision  text NOT NULL CHECK (protocol_revision ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'),
    created_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL,
    terminated_at      timestamptz,
    CONSTRAINT mcp_sessions_expiry_shape CHECK (expires_at > created_at),
    CONSTRAINT mcp_sessions_termination_shape CHECK (
        terminated_at IS NULL OR terminated_at >= created_at)
);

CREATE INDEX mcp_sessions_credential_idx
    ON mcp.mcp_sessions (credential_id);
CREATE INDEX mcp_sessions_expiry_idx
    ON mcp.mcp_sessions (expires_at)
    WHERE terminated_at IS NULL;
