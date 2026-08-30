-- g0_mcp_0002_rate_state.sql
-- Per-credential MCP rate and concurrency admission state
-- (FR-MCP-009; INV-009; AC-251).
--
-- One row owns the token bucket and in-flight counter for an independently
-- attributable credential/rate-class pair.  Callers mutate it with a single
-- WHERE-guarded UPDATE over fencing_token; a stale or replayed transition
-- therefore matches no row.  Counter bounds are also enforced in SQL so a
-- race cannot over-admit or manufacture tokens.

CREATE TABLE mcp.mcp_rate_state (
    -- Intentionally not a SQL FK: the `mcp` migration family sorts before
    -- `sec`, while application code resolves this identifier through the
    -- credential store on every request (including revocation checks).
    credential_id      text NOT NULL CHECK (length(credential_id) > 0),
    rate_limit_class   text NOT NULL CHECK (length(rate_limit_class) > 0),
    available_tokens   numeric NOT NULL CHECK (available_tokens >= 0),
    bucket_capacity    numeric NOT NULL CHECK (bucket_capacity > 0),
    refill_per_second  numeric NOT NULL CHECK (refill_per_second > 0),
    last_refill_at     timestamptz NOT NULL,
    in_flight          integer NOT NULL DEFAULT 0 CHECK (in_flight >= 0),
    concurrency_limit  integer NOT NULL CHECK (concurrency_limit > 0),
    fencing_token      bigint NOT NULL DEFAULT 1 CHECK (fencing_token > 0),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (credential_id, rate_limit_class),
    CONSTRAINT mcp_rate_state_token_ceiling
        CHECK (available_tokens <= bucket_capacity),
    CONSTRAINT mcp_rate_state_concurrency_ceiling
        CHECK (in_flight <= concurrency_limit)
);

CREATE INDEX mcp_rate_state_updated_idx
    ON mcp.mcp_rate_state (updated_at);
