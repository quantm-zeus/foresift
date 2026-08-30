-- g0_mcp_0001_sessions.sql
-- Stateful MCP transport sessions (FR-MCP-009; PRD §17.7; AC-251).
--
-- Stateful sessions are disabled by default at the API configuration layer,
-- but, when enabled, every opaque session id is bound to all security claims
-- that must remain stable for its lifetime.  Session ids contain visible
-- ASCII only and carry no encoded credential or other secret.
--
-- Termination is a guarded, idempotent UPDATE performed by the session store:
-- only a live row moves from terminated_at IS NULL to a timestamp.  Rows are
-- retained so expired and terminated ids can deterministically resolve as
-- not found without allowing an id to be reused.

CREATE SCHEMA IF NOT EXISTS mcp;

CREATE TABLE mcp.mcp_sessions (
    session_id          text PRIMARY KEY
                            CHECK (session_id ~ '^[!-~]{32,128}$'),
    actor               text NOT NULL CHECK (length(actor) > 0),
    profile_id          text NOT NULL CHECK (length(profile_id) > 0),
    origin              text NOT NULL CHECK (length(origin) > 0),
    protocol_revision   text NOT NULL CHECK (length(protocol_revision) > 0),
    expires_at          timestamptz NOT NULL,
    terminated_at       timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mcp_sessions_expiry_shape
        CHECK (expires_at > created_at),
    CONSTRAINT mcp_sessions_termination_shape
        CHECK (terminated_at IS NULL OR terminated_at >= created_at)
);

CREATE INDEX mcp_sessions_expiry_idx
    ON mcp.mcp_sessions (expires_at)
    WHERE terminated_at IS NULL;

