-- g0_core_0002_single_flight_leases.sql
-- Cross-mode single-flight leases with monotonic fencing tokens
-- (FR-CORE-006; PRD §16.6; INV-009).
--
-- Rules encoded here:
--   * one CURRENT lease row per resource key (`resource_key_hash` primary
--     key — rows are leases, not history). Release stamps `released_at`;
--     the row stays as the generation marker so the next acquirer can bump
--     the fence strictly beyond every token ever issued for that key.
--   * fencing tokens come from a dedicated sequence: globally increasing,
--     therefore monotonic per key. An expired/released takeover ALWAYS
--     allocates a fresh token via nextval — a stale holder's token can
--     never re-match.
--   * holder_mode is CHECK-pinned to the four §16.6 modes; single-flight is
--     cross-mode (MCP manual, ChatGPT, admin chat, automation), never
--     in-memory alone.
--   * release is a WHERE-guarded UPDATE on (key, token, not-yet-released):
--     zero rows updated = refusal, which is how stale holders fail closed.

CREATE SCHEMA IF NOT EXISTS core;

CREATE SEQUENCE core.core_lease_fencing_seq AS bigint START WITH 1 INCREMENT BY 1;

CREATE TABLE core.core_single_flight_leases (
    resource_key_hash text PRIMARY KEY CHECK (resource_key_hash ~ '^sha256:[0-9a-f]{64}$'),
    fencing_token     bigint NOT NULL DEFAULT nextval('core.core_lease_fencing_seq')
                        CHECK (fencing_token > 0),
    holder_mode       text NOT NULL CHECK (holder_mode IN (
                        'MCP_MANUAL',
                        'CHATGPT',
                        'ADMIN_CHAT',
                        'AUTOMATION')),
    holder_id         text NOT NULL CHECK (length(holder_id) > 0),
    acquired_at       timestamptz NOT NULL DEFAULT now(),
    expires_at        timestamptz NOT NULL,
    released_at       timestamptz,
    CONSTRAINT core_lease_expiry_shape CHECK (expires_at > acquired_at),
    CONSTRAINT core_lease_release_shape
        CHECK (released_at IS NULL OR released_at >= acquired_at)
);
