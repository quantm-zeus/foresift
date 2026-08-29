-- g0_disc_0002_cheap_monitor.sql
-- Apply as one transaction. Rollback: DROP the observation, batch, and row
-- tables below.
-- Finite, batch-oriented cheap monitoring (FR-DISC-004, §12.7, §18.2).

CREATE SCHEMA IF NOT EXISTS disc;

CREATE TABLE disc.cheap_monitor_rows (
    monitor_id              text PRIMARY KEY,
    candidate_id            text NOT NULL,
    state                   text NOT NULL CHECK (state IN (
                                'NEW',
                                'MONITORING_CHEAP',
                                'PROMOTED_TO_VERIFY',
                                'REJECTED_CHEAP',
                                'EXPIRED_CHEAP')),
    checks_completed        integer NOT NULL DEFAULT 0 CHECK (checks_completed >= 0),
    max_checks              integer NOT NULL CHECK (max_checks > 0),
    next_check_at           timestamptz NOT NULL,
    expires_at              timestamptz NOT NULL,
    backoff_ms              bigint NOT NULL CHECK (backoff_ms >= 0),
    max_staleness_ms        bigint NOT NULL CHECK (max_staleness_ms >= 0),
    resource_budget_class   text NOT NULL CHECK (length(resource_budget_class) > 0),
    provider_id             text NOT NULL CHECK (length(provider_id) > 0),
    operation_id            text NOT NULL CHECK (length(operation_id) > 0),
    last_observation_at     timestamptz,
    retained_at             timestamptz NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (candidate_id),
    CONSTRAINT cheap_monitor_rows_finite_checks
        CHECK (checks_completed <= max_checks)
);

CREATE INDEX cheap_monitor_rows_due_idx
    ON disc.cheap_monitor_rows (next_check_at)
    WHERE state IN ('NEW', 'MONITORING_CHEAP');

-- A scheduler invocation persists one bounded batch descriptor. Candidates
-- point to no scheduler messages; all returned entities point to this batch.
CREATE TABLE disc.monitor_batches (
    batch_id                 text PRIMARY KEY,
    provider_id              text NOT NULL CHECK (length(provider_id) > 0),
    operation_id             text NOT NULL CHECK (length(operation_id) > 0),
    monitor_ids              text[] NOT NULL CHECK (cardinality(monitor_ids) > 0),
    max_batch_size           integer NOT NULL CHECK (max_batch_size > 0),
    scheduled_at             timestamptz NOT NULL,
    started_at               timestamptz,
    completed_at             timestamptz,
    due_before               timestamptz NOT NULL,
    selected_count           integer NOT NULL DEFAULT 0 CHECK (selected_count >= 0),
    returned_entity_count    integer NOT NULL DEFAULT 0 CHECK (returned_entity_count >= 0),
    status                   text NOT NULL CHECK (status IN (
                                 'PLANNED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),
    created_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT monitor_batches_bounded
        CHECK (cardinality(monitor_ids) <= max_batch_size
               AND selected_count <= max_batch_size
               AND returned_entity_count <= selected_count),
    CONSTRAINT monitor_batches_time_order
        CHECK ((started_at IS NULL OR started_at >= scheduled_at)
               AND (completed_at IS NULL OR started_at IS NOT NULL)
               AND (completed_at IS NULL OR completed_at >= started_at)),
    CONSTRAINT monitor_batches_terminal_completion
        CHECK (status IN ('PLANNED', 'RUNNING') OR completed_at IS NOT NULL)
);

CREATE TABLE disc.monitor_observations (
    observation_id           text PRIMARY KEY,
    batch_id                 text NOT NULL REFERENCES disc.monitor_batches(batch_id),
    monitor_id               text NOT NULL REFERENCES disc.cheap_monitor_rows(monitor_id),
    entity_id                text NOT NULL CHECK (length(entity_id) > 0),
    source_id                text NOT NULL CHECK (length(source_id) > 0),
    source_observed_at       timestamptz,
    observed_at              timestamptz NOT NULL,
    available_at             timestamptz NOT NULL,
    snapshot                 jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    artifact_hash            text CHECK (
                                 artifact_hash IS NULL
                                 OR artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
    created_at               timestamptz NOT NULL DEFAULT now(),
    -- Exactly one point-in-time snapshot per returned entity in a batch.
    UNIQUE (batch_id, entity_id),
    CONSTRAINT monitor_observations_no_backdating
        CHECK (available_at >= observed_at)
);

CREATE INDEX monitor_observations_row_time_idx
    ON disc.monitor_observations (monitor_id, available_at);
