-- g0_col_0004_health_ceiling.sql
-- Apply as one transaction. Rollback: DROP the two tables and the local
-- append-only trigger function declared below.
-- Collector health snapshots and Sustainable Capacity Contract ceiling
-- counters (FR-COL-008, FR-COL-010).

CREATE SCHEMA IF NOT EXISTS col;

CREATE TABLE col.collector_health (
    partition_id              text NOT NULL,
    measured_at               timestamptz NOT NULL,
    connected                 boolean NOT NULL,
    endpoint_generation       bigint NOT NULL CHECK (endpoint_generation >= 0),
    head_slot                 bigint NOT NULL CHECK (head_slot >= 0),
    finalized_slot            bigint NOT NULL CHECK (finalized_slot >= 0),
    checkpoint_lag            bigint NOT NULL CHECK (checkpoint_lag >= 0),
    gap_count                 integer NOT NULL CHECK (gap_count >= 0),
    oldest_gap_duration_ms    bigint NOT NULL CHECK (oldest_gap_duration_ms >= 0),
    backfill_status           text NOT NULL CHECK (backfill_status IN (
                                  'IDLE', 'QUEUED', 'RUNNING', 'PARTIAL', 'BLOCKED')),
    decode_failure_rate       double precision NOT NULL
                                  CHECK (decode_failure_rate >= 0 AND decode_failure_rate <= 1),
    streamed_bytes            bigint NOT NULL CHECK (streamed_bytes >= 0),
    event_rate                double precision NOT NULL CHECK (event_rate >= 0),
    deduplication_rate        double precision NOT NULL
                                  CHECK (deduplication_rate >= 0 AND deduplication_rate <= 1),
    resource_consumption      jsonb NOT NULL
                                  CHECK (jsonb_typeof(resource_consumption) = 'object'
                                     AND resource_consumption ?& ARRAY[
                                         'cpuPercent', 'memoryBytes', 'networkBytes',
                                         'subscriptions', 'rawStorageBytes', 'retries',
                                         'monthlyCredits']
                                     AND jsonb_typeof(resource_consumption -> 'cpuPercent') = 'number'
                                     AND jsonb_typeof(resource_consumption -> 'memoryBytes') = 'number'
                                     AND jsonb_typeof(resource_consumption -> 'networkBytes') = 'number'
                                     AND jsonb_typeof(resource_consumption -> 'subscriptions') = 'number'
                                     AND jsonb_typeof(resource_consumption -> 'rawStorageBytes') = 'number'
                                     AND jsonb_typeof(resource_consumption -> 'retries') = 'number'
                                     AND jsonb_typeof(resource_consumption -> 'monthlyCredits') = 'number'),
    created_at                timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (partition_id, measured_at),
    FOREIGN KEY (partition_id) REFERENCES col.collector_partitions(partition_id),
    CONSTRAINT collector_health_finality_not_ahead
        CHECK (finalized_slot <= head_slot),
    CONSTRAINT collector_health_gap_duration_requires_gap
        CHECK (gap_count > 0 OR oldest_gap_duration_ms = 0)
);

CREATE INDEX collector_health_partition_time_idx
    ON col.collector_health (partition_id, measured_at DESC);

-- Health is historical evidence, not an in-place status projection.
CREATE FUNCTION col.refuse_health_snapshot_mutation() RETURNS trigger AS $fn$
BEGIN
    RAISE EXCEPTION 'collector health snapshots are append-only'
        USING ERRCODE = 'restrict_violation';
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER collector_health_append_only
    BEFORE UPDATE OR DELETE ON col.collector_health
    FOR EACH ROW EXECUTE FUNCTION col.refuse_health_snapshot_mutation();
CREATE TRIGGER collector_health_append_only_truncate
    BEFORE TRUNCATE ON col.collector_health
    FOR EACH STATEMENT EXECUTE FUNCTION col.refuse_health_snapshot_mutation();

CREATE TABLE col.collector_ceiling_counters (
    scope_id                       text NOT NULL,
    dimension                      text NOT NULL CHECK (dimension IN (
                                       'CPU_PERCENT',
                                       'MEMORY_BYTES',
                                       'NETWORK_BYTES',
                                       'SUBSCRIPTIONS',
                                       'EVENT_RATE',
                                       'RAW_STORAGE_BYTES',
                                       'RETRIES',
                                       'MONTHLY_CREDITS')),
    period_started_at              timestamptz NOT NULL,
    period_ends_at                 timestamptz NOT NULL,
    used                           numeric NOT NULL DEFAULT 0 CHECK (used >= 0),
    cap                            numeric NOT NULL CHECK (cap >= 0),
    unit                           text NOT NULL CHECK (length(unit) > 0),
    -- Immutable provenance for the exact active Sustainable Capacity
    -- Contract slice from which `cap` was copied.
    capacity_contract_id           text NOT NULL CHECK (length(capacity_contract_id) > 0),
    capacity_contract_version      text NOT NULL CHECK (length(capacity_contract_version) > 0),
    capacity_contract_slice_hash   text NOT NULL
                                       CHECK (capacity_contract_slice_hash ~ '^sha256:[0-9a-f]{64}$'),
    contract_verified_at           timestamptz NOT NULL,
    contract_expires_at            timestamptz NOT NULL,
    paid_overage_allowed           boolean NOT NULL DEFAULT false CHECK (NOT paid_overage_allowed),
    reserve_consumption_allowed    boolean NOT NULL DEFAULT false CHECK (NOT reserve_consumption_allowed),
    ceiling_exceeded_at            timestamptz,
    updated_at                     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope_id, dimension, period_started_at),
    CONSTRAINT collector_ceiling_period_order
        CHECK (period_ends_at > period_started_at),
    CONSTRAINT collector_ceiling_contract_active_for_period
        CHECK (contract_expires_at > contract_verified_at
               AND period_started_at >= contract_verified_at
               AND period_started_at < contract_expires_at),
    CONSTRAINT collector_ceiling_never_exceeded
        CHECK (used <= cap),
    CONSTRAINT collector_ceiling_timestamp_only_at_cap
        CHECK (ceiling_exceeded_at IS NULL OR used = cap),
    CONSTRAINT collector_ceiling_timestamp_in_period
        CHECK (ceiling_exceeded_at IS NULL
               OR (ceiling_exceeded_at >= period_started_at
                   AND ceiling_exceeded_at <= period_ends_at))
);

CREATE INDEX collector_ceiling_contract_idx
    ON col.collector_ceiling_counters
       (capacity_contract_id, capacity_contract_version, capacity_contract_slice_hash);
