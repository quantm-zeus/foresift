-- g0_data_0007_checkpoints_gaps.sql
-- Collector continuity storage contract (§34.7, INV-009, AC-263): persistent
-- per-shard checkpoints with fencing tokens and an explicit gap registry.
-- The exactly-once canonical event ledger itself is `canonical_event_keys`,
-- created by g0_data_0005_object_artifact_index.sql; the migration split is
-- intentional — this file owns checkpoint/gap state only.

CREATE TABLE collector_checkpoints (
    shard_id        text PRIMARY KEY,
    fencing_token   bigint NOT NULL CHECK (fencing_token >= 1),
    cursor_position bigint NOT NULL CHECK (cursor_position >= 0),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Explicit gap registry: detected discontinuities are registered, never
-- silently skipped. Replay across a range is only legitimate once every gap
-- inside it has been recovered (or explicitly declared unrecoverable).
CREATE TABLE collector_gaps (
    gap_id          text PRIMARY KEY,
    shard_id        text NOT NULL,
    gap_start_slot  bigint NOT NULL CHECK (gap_start_slot >= 0),
    gap_end_slot    bigint NOT NULL,
    reason          text NOT NULL,
    recovery_status text NOT NULL DEFAULT 'UNRECOVERED' CHECK (recovery_status IN (
                        'UNRECOVERED',
                        'RECOVERING',
                        'RECOVERED',
                        'DECLARED_UNRECOVERABLE')),
    registered_at   timestamptz NOT NULL DEFAULT now(),
    resolved_at     timestamptz,
    CONSTRAINT collector_gaps_bounds_ordered CHECK (gap_start_slot <= gap_end_slot),
    CONSTRAINT collector_gaps_resolution_requires_instant
        CHECK (recovery_status NOT IN ('RECOVERED', 'DECLARED_UNRECOVERABLE') OR resolved_at IS NOT NULL)
);

CREATE INDEX collector_gaps_shard_idx ON collector_gaps (shard_id, recovery_status);
