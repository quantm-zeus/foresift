-- g0_data_0002_observations_revisions.sql
-- Immutable observations and revisions (FR-DATA-002), point-in-time replay
-- substrate (FR-DATA-003), backfill receipts (§13.6), watermarks (§13.5).
--
-- Originals are immutable via BEFORE UPDATE/DELETE triggers; corrections are
-- new revision rows; reorg/finality corrections are compensating events that
-- preserve the original receipt hash. Raw amounts are TEXT digit strings —
-- quantities never live as floating point (§11.5).

CREATE TABLE observations (
    observation_id           text PRIMARY KEY,
    subject_pool_id          text REFERENCES pools(pool_id),
    subject_asset_id         text REFERENCES assets(asset_id),
    -- §13.1 required timestamps (absent = genuinely inapplicable).
    event_at                 timestamptz NOT NULL,
    available_at             timestamptz NOT NULL,
    source_observed_at       timestamptz,
    source_published_at      timestamptz,
    authorized_at            timestamptz,
    requested_at             timestamptz,
    fetched_at               timestamptz,
    ingested_at              timestamptz,
    finalized_at             timestamptz,
    revised_at               timestamptz,
    -- §13.2 provenance class; never inferred from event_at.
    availability_provenance  text NOT NULL CHECK (availability_provenance IN (
                                 'FIRST_PARTY_LIVE_OBSERVED',
                                 'PROVIDER_LIVE_RESPONSE',
                                 'AUTHORIZED_PUSH_RECEIVED',
                                 'HISTORICAL_QUERY_FETCHED_LATER',
                                 'MANUAL_IMPORT_AVAILABLE',
                                 'DERIVED_FROM_AVAILABLE_INPUTS',
                                 'LEARNED_ARTIFACT_PUBLISHED')),
    -- §11.5 quantity: raw integer amount + decimals, or explicit absence.
    raw_amount               text CHECK (raw_amount ~ '^[0-9]+$'),
    decimals                 integer CHECK (decimals BETWEEN 0 AND 36),
    -- §13.3 chain coordinates. NULLABLE columns record "not applicable to
    -- this observation kind"; this schema cannot express which combinations
    -- of coordinates are mandatory per event class — that coherence is a
    -- producer-side obligation.
    coordinates_chain_id     text,
    block_number_or_slot     numeric,
    block_hash               text,
    parent_block_hash_or_parent_slot text,
    transaction_hash         text,
    transaction_index        integer,
    instruction_index        integer,
    inner_instruction_index  integer,
    confirmation_level       text,
    reorg_version            integer NOT NULL DEFAULT 0 CHECK (reorg_version >= 0),
    collector_or_provider_cursor text,
    quality_codes            text[] NOT NULL DEFAULT ARRAY[]::text[]
        CHECK (quality_codes <@ ARRAY[
            'VALID','MISSING_PROVIDER','NOT_REQUESTED_BY_POLICY',
            'UNSUPPORTED_CHAIN','UNSUPPORTED_PROGRAM_VERSION','STALE',
            'PARTIAL','ESTIMATED','CONFLICTING','REORG_PENDING',
            'GAP_AFFECTED','LOW_SAMPLE','DECIMAL_UNCERTAIN',
            'LICENSE_RESTRICTED','SCHEMA_DEGRADED','DEPRECATED_OPERATION',
            'COST_BLOCKED','QUOTA_RESERVE_PROTECTED','CAPACITY_BLOCKED',
            'EXECUTION_UNAVAILABLE','EXECUTION_PARTIAL','POOL_MATH_UNSUPPORTED',
            'QUOTE_PARITY_FAILED','TOKEN_EXTENSION_UNKNOWN','SUPPLY_UNCERTAIN',
            'SYSTEM_ADDRESS_UNCERTAIN','SOCIAL_UNAVAILABLE',
            'SOURCE_DEPENDENCE_HIGH','OUTCOME_PENDING','OUTCOME_CENSORED',
            'RETROSPECTIVE_ONLY']::text[]),
    receipt_hash             text NOT NULL UNIQUE,
    created_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT observations_quantity_pair_complete
        CHECK ((raw_amount IS NULL) = (decimals IS NULL)),
    CONSTRAINT observations_null_quantity_requires_explicit_code
        CHECK (raw_amount IS NOT NULL OR (
            array_length(quality_codes, 1) >= 1
            AND NOT quality_codes <@ ARRAY['VALID']::text[]))
);

CREATE INDEX observations_available_at_idx ON observations (available_at);
CREATE INDEX observations_subject_idx ON observations (subject_pool_id, subject_asset_id);

-- Immutability of originals (§13.4): corrections create revisions, never edits.
CREATE FUNCTION foresift_refuse_mutation() RETURNS trigger AS $fn$
BEGIN
    RAISE EXCEPTION 'observations are immutable: use revisions/compensating events'
        USING ERRCODE = 'restrict_violation';
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER observations_immutable
    BEFORE UPDATE OR DELETE ON observations
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();

-- Row-level triggers do not fire on TRUNCATE; refuse it statement-wise too.
CREATE TRIGGER observations_immutable_truncate
    BEFORE TRUNCATE ON observations
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();

CREATE TABLE observation_revisions (
    revision_id            text PRIMARY KEY,
    observation_id         text NOT NULL REFERENCES observations(observation_id),
    revision_no            integer NOT NULL CHECK (revision_no >= 1),
    reason                 text NOT NULL,
    available_at           timestamptz NOT NULL,
    availability_provenance text NOT NULL CHECK (availability_provenance IN (
                               'FIRST_PARTY_LIVE_OBSERVED',
                               'PROVIDER_LIVE_RESPONSE',
                               'AUTHORIZED_PUSH_RECEIVED',
                               'HISTORICAL_QUERY_FETCHED_LATER',
                               'MANUAL_IMPORT_AVAILABLE',
                               'DERIVED_FROM_AVAILABLE_INPUTS',
                               'LEARNED_ARTIFACT_PUBLISHED')),
    superseded_receipt_hash text NOT NULL,
    raw_amount             text CHECK (raw_amount ~ '^[0-9]+$'),
    decimals               integer CHECK (decimals BETWEEN 0 AND 36),
    quality_codes          text[] NOT NULL DEFAULT ARRAY[]::text[]
        CHECK (quality_codes <@ ARRAY[
            'VALID','MISSING_PROVIDER','NOT_REQUESTED_BY_POLICY',
            'UNSUPPORTED_CHAIN','UNSUPPORTED_PROGRAM_VERSION','STALE',
            'PARTIAL','ESTIMATED','CONFLICTING','REORG_PENDING',
            'GAP_AFFECTED','LOW_SAMPLE','DECIMAL_UNCERTAIN',
            'LICENSE_RESTRICTED','SCHEMA_DEGRADED','DEPRECATED_OPERATION',
            'COST_BLOCKED','QUOTA_RESERVE_PROTECTED','CAPACITY_BLOCKED',
            'EXECUTION_UNAVAILABLE','EXECUTION_PARTIAL','POOL_MATH_UNSUPPORTED',
            'QUOTE_PARITY_FAILED','TOKEN_EXTENSION_UNKNOWN','SUPPLY_UNCERTAIN',
            'SYSTEM_ADDRESS_UNCERTAIN','SOCIAL_UNAVAILABLE',
            'SOURCE_DEPENDENCE_HIGH','OUTCOME_PENDING','OUTCOME_CENSORED',
            'RETROSPECTIVE_ONLY']::text[]),
    created_at             timestamptz NOT NULL DEFAULT now(),
    UNIQUE (observation_id, revision_no),
    CONSTRAINT observation_revisions_quantity_pair_complete
        CHECK ((raw_amount IS NULL) = (decimals IS NULL))
);

CREATE TRIGGER observation_revisions_immutable
    BEFORE UPDATE OR DELETE ON observation_revisions
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();

CREATE TRIGGER observation_revisions_immutable_truncate
    BEFORE TRUNCATE ON observation_revisions
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();

-- No-backdating for the correction path (§13.6, FR-DATA-002): a revision may
-- never claim availability earlier than its immutable anchor observation.
-- Cross-row logic cannot be a CHECK, so it lives in a BEFORE INSERT trigger —
-- mirroring how the backfill path's no-backdating rule is structural.
CREATE FUNCTION foresift_refuse_revision_backdating() RETURNS trigger AS $fn$
BEGIN
    IF NEW.available_at < (SELECT available_at FROM observations
                            WHERE observation_id = NEW.observation_id) THEN
        RAISE EXCEPTION 'revision available_at backdates the anchor observation'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER observation_revisions_no_backdating
    BEFORE INSERT ON observation_revisions
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_revision_backdating();

-- Reorg/finality compensation: supersedes without rewriting receipt history.
CREATE TABLE compensating_events (
    compensation_id       text PRIMARY KEY,
    target_observation_id text NOT NULL REFERENCES observations(observation_id),
    kind                  text NOT NULL CHECK (kind IN (
                              'REORG_SUPERSEDING', 'FINALITY_CORRECTION')),
    original_receipt_hash text NOT NULL,
    available_at          timestamptz NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER compensating_events_immutable
    BEFORE UPDATE OR DELETE ON compensating_events
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();

CREATE TRIGGER compensating_events_immutable_truncate
    BEFORE TRUNCATE ON compensating_events
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();

-- §13.6 backfill receipts: the exact required fields, with the no-backdating
-- rules encoded structurally.
CREATE TABLE backfill_receipts (
    backfill_receipt_id           text PRIMARY KEY,
    backfill_job_id               text NOT NULL,
    backfill_reason               text NOT NULL,
    historical_event_at           timestamptz NOT NULL,
    retrieved_at                  timestamptz NOT NULL,
    available_at                  timestamptz NOT NULL,
    retrospective_only            boolean NOT NULL,
    would_have_been_observable_live boolean,
    availability_proof_method     text NOT NULL CHECK (availability_proof_method IN (
                                      'LIVE_RECEIPT_REFERENCE',
                                      'RECOVERY_FETCH_COMMIT',
                                      'MANUAL_IMPORT_RECEIPT')),
    live_receipt_ref              text,
    created_at                    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT backfill_live_receipt_requires_ref
        CHECK (availability_proof_method <> 'LIVE_RECEIPT_REFERENCE'
               OR live_receipt_ref IS NOT NULL),
    CONSTRAINT backfill_no_backdating_without_live_receipt
        CHECK (availability_proof_method = 'LIVE_RECEIPT_REFERENCE'
               OR available_at >= retrieved_at),
    CONSTRAINT backfill_event_not_after_availability
        CHECK (historical_event_at <= available_at)
);

CREATE INDEX backfill_receipts_job_idx ON backfill_receipts (backfill_job_id);

-- §13.5 watermarks keyed by provider/operation/shard/program-version/chain.
-- Mutable state: updates advance the watermark; a non-contiguous watermark
-- must carry an explicit open gap.
CREATE TABLE watermarks (
    provider                text NOT NULL,
    operation               text NOT NULL,
    collector_shard         text NOT NULL,
    program_version         text NOT NULL,
    chain_id                text NOT NULL,
    highest_observed_slot   numeric NOT NULL,
    highest_contiguous_slot numeric NOT NULL,
    highest_finalized_slot  numeric,
    oldest_open_gap_start   numeric,
    oldest_open_gap_end     numeric,
    maximum_lateness_seen_ms bigint NOT NULL DEFAULT 0 CHECK (maximum_lateness_seen_ms >= 0),
    gap_recovery_status     text NOT NULL DEFAULT 'NONE' CHECK (gap_recovery_status IN (
                                'NONE', 'IN_PROGRESS', 'RECOVERED', 'ACCEPTED_LOSS')),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, operation, collector_shard, program_version, chain_id),
    CONSTRAINT watermarks_gap_bounds
        CHECK ((oldest_open_gap_start IS NULL) = (oldest_open_gap_end IS NULL)),
    CONSTRAINT watermarks_gap_ordered
        CHECK (oldest_open_gap_start IS NULL OR oldest_open_gap_end >= oldest_open_gap_start),
    CONSTRAINT watermarks_non_contiguous_requires_gap
        CHECK (highest_contiguous_slot >= highest_observed_slot
               OR oldest_open_gap_start IS NOT NULL)
);
