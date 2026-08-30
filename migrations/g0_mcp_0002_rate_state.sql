-- g0_mcp_0002_rate_state.sql
-- Durable per-client token-bucket and concurrency admission state
-- (FR-MCP-009, INV-009, AC-251).
--
-- Admission updates this row atomically with a fencing-token compare-and-swap.
-- The non-negative bucket/count constraints make over-admission unrepresentable
-- in SQL truth; the credential key keeps every refusal and transition attributable
-- to the independently revocable client identity. Credential validity remains a
-- request-time admission check because the lexicographically later `sec` family
-- cannot be a migration-time foreign-key dependency.

CREATE TABLE mcp.mcp_rate_state (
    credential_id          text PRIMARY KEY CHECK (length(credential_id) > 0),
    rate_limit_class       text NOT NULL CHECK (length(rate_limit_class) > 0),
    bucket_capacity        numeric NOT NULL CHECK (bucket_capacity > 0),
    available_tokens       numeric NOT NULL CHECK (available_tokens >= 0),
    refill_tokens_per_sec  numeric NOT NULL CHECK (refill_tokens_per_sec >= 0),
    refilled_at            timestamptz NOT NULL,
    concurrent_requests    integer NOT NULL DEFAULT 0 CHECK (concurrent_requests >= 0),
    concurrency_limit      integer NOT NULL CHECK (concurrency_limit > 0),
    fencing_token          bigint NOT NULL DEFAULT 1 CHECK (fencing_token > 0),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mcp_rate_tokens_within_capacity
        CHECK (available_tokens <= bucket_capacity),
    CONSTRAINT mcp_rate_concurrency_within_limit
        CHECK (concurrent_requests <= concurrency_limit)
);

CREATE INDEX mcp_rate_state_class_idx
    ON mcp.mcp_rate_state (rate_limit_class);
