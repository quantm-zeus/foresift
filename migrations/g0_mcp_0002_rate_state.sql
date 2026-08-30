-- g0_mcp_0002_rate_state.sql
-- Independent per-client token-bucket and concurrency state
-- (FR-MCP-009, AC-251; INV-009).
--
-- One row is the durable admission state for one credential/client. The
-- fencing token must be compared and incremented by guarded updates so stale
-- admit/release attempts cannot overwrite a newer transition. Bounds prevent
-- over-crediting a bucket and negative or over-limit in-flight counts even if
-- an application bug reaches SQL.

CREATE TABLE mcp.client_rate_state (
    credential_id          text PRIMARY KEY CHECK (length(credential_id) > 0),
    rate_limit_class       text NOT NULL CHECK (length(rate_limit_class) > 0),
    token_capacity         numeric NOT NULL CHECK (token_capacity > 0),
    available_tokens       numeric NOT NULL,
    refill_tokens_per_sec  numeric NOT NULL CHECK (refill_tokens_per_sec > 0),
    last_refilled_at       timestamptz NOT NULL,
    concurrent_requests    integer NOT NULL DEFAULT 0,
    concurrency_limit      integer NOT NULL CHECK (concurrency_limit > 0),
    fencing_token          bigint NOT NULL DEFAULT 1 CHECK (fencing_token > 0),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mcp_rate_available_tokens_bounds CHECK (
        available_tokens >= 0 AND available_tokens <= token_capacity),
    CONSTRAINT mcp_rate_concurrency_bounds CHECK (
        concurrent_requests >= 0 AND concurrent_requests <= concurrency_limit),
    CONSTRAINT mcp_rate_refill_time_shape CHECK (updated_at >= last_refilled_at)
);

CREATE INDEX mcp_client_rate_class_idx
    ON mcp.client_rate_state (rate_limit_class);
