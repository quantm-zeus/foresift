-- g0_core_0004_exact_cache.sql
-- Exact cache entries (FR-CORE-006; PRD §16.4/§16.5; INV-005/006).
--
-- Rules encoded here:
--   * entries are keyed by `cache_key_hash` = sha256 over THE canonical JSON
--     of the nine mandated §16.4 components (provider, operation, operation
--     version, chain, canonical entity identity, normalized arguments, field
--     projection, as-of semantics, license policy). The as-of component is
--     INSIDE the key, so a replay read can never collide with a live-time
--     entry for the same entity.
--   * payloads are REFERENCED (`payload_ref` into the object/artifact layer),
--     never inlined — cache rows stay small and rights metadata travels with
--     the reference.
--   * freshness windows: `fresh_until` and `stale_until` are stored per entry
--     (computed from the §16.5 policy row at write time); stale_until must
--     never precede fresh_until.
--   * `license_policy_version` and `rights_permitted` ride on every entry:
--     stage 20 writes ONLY when rights and cache policy permit, and lookups
--     refuse entries whose license component no longer matches.
--   * point-in-time visibility is a lookup predicate (stored_at <= decision
--     time), asserted by tests — a reader at T never sees an entry written
--     after T (no backdating through the cache).

CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE core.core_exact_cache_entries (
    cache_key_hash         text PRIMARY KEY CHECK (cache_key_hash ~ '^sha256:[0-9a-f]{64}$'),
    payload_ref            text NOT NULL CHECK (length(payload_ref) > 0),
    stored_at              timestamptz NOT NULL,
    fresh_until            timestamptz NOT NULL,
    stale_until            timestamptz NOT NULL,
    license_policy_version text NOT NULL CHECK (length(license_policy_version) > 0),
    rights_permitted       boolean NOT NULL,
    CONSTRAINT core_exact_cache_window_shape CHECK (
        fresh_until <= stale_until AND stored_at <= fresh_until)
);

CREATE INDEX core_exact_cache_stored_idx ON core.core_exact_cache_entries (stored_at);
