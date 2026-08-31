-- g0_mcp_0002_rate_state.sql
-- Durable per-client MCP rate and concurrency admission state
-- (FR-MCP-009; INV-009; AC-251).
--
-- One row is the current state for a credential and independently assigned
-- rate-limit class. Admission updates must compare-and-increment
-- `fencing_token`; stale or replayed updates therefore affect zero rows.
-- Token-bucket and in-flight counters share the same fenced transition so a
-- request cannot consume one control without the other.

CREATE TABLE g0_mcp_rate_state (
    credential_id         text NOT NULL CHECK (length(credential_id) > 0),
    rate_limit_class      text NOT NULL CHECK (length(rate_limit_class) > 0),
    bucket_capacity       numeric NOT NULL CHECK (bucket_capacity > 0),
    available_tokens      numeric NOT NULL CHECK (available_tokens >= 0),
    refill_tokens_per_sec numeric NOT NULL CHECK (refill_tokens_per_sec > 0),
    last_refilled_at      timestamptz NOT NULL,
    in_flight             integer NOT NULL DEFAULT 0 CHECK (in_flight >= 0),
    concurrency_limit     integer NOT NULL CHECK (concurrency_limit > 0),
    fencing_token         bigint NOT NULL DEFAULT 1 CHECK (fencing_token > 0),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (credential_id, rate_limit_class),
    CONSTRAINT g0_mcp_rate_state_bucket_bound
        CHECK (available_tokens <= bucket_capacity),
    CONSTRAINT g0_mcp_rate_state_concurrency_bound
        CHECK (in_flight <= concurrency_limit),
    CONSTRAINT g0_mcp_rate_state_refill_clock
        CHECK (updated_at >= last_refilled_at)
);

CREATE INDEX g0_mcp_rate_state_active_idx
    ON g0_mcp_rate_state (rate_limit_class, updated_at)
    WHERE in_flight > 0;
