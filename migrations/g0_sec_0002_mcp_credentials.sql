-- g0_sec_0002_mcp_credentials.sql
-- MCP credential lifecycle records (FR-SEC-001, §35.12, AC-053).
--
-- Rules encoded here:
--   * the secret itself NEVER lands in SQL truth — only a keyed
--     `sha256:<hex>` hash at rest (raw material is shown exactly once at mint).
--   * every credential is independently scoped and independently revocable:
--     per-row `revoked_at`, so revoking one credential leaves others intact.
--   * scope set, origin policy binding, profile/tool/resource/entity bounds,
--     rate-limit class, expiry, and optional IP constraints are all recorded
--     so any use can be validated against ALL of its dimensions.

CREATE TABLE sec.mcp_credentials (
    credential_id     text PRIMARY KEY,
    keyed_hash        text NOT NULL UNIQUE CHECK (keyed_hash ~ '^sha256:[0-9a-f]{64}$'),
    scopes            text[] NOT NULL CHECK (cardinality(scopes) >= 1),
    origin_policy_ref text NOT NULL,
    profile_bindings  text[] NOT NULL DEFAULT '{}',
    tool_bounds       text[] NOT NULL DEFAULT '{}',
    resource_bounds   text[] NOT NULL DEFAULT '{}',
    entity_bounds     text[] NOT NULL DEFAULT '{}',
    rate_limit_class  text NOT NULL,
    expires_at        timestamptz NOT NULL,
    ip_constraints    text[] NOT NULL DEFAULT '{}',
    created_at        timestamptz NOT NULL,
    revoked_at        timestamptz,
    last_used_at      timestamptz,
    last_used_origin  text,
    CONSTRAINT mcp_credentials_revoked_not_before_created CHECK (
        revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX mcp_credentials_keyed_hash_idx ON sec.mcp_credentials (keyed_hash);
