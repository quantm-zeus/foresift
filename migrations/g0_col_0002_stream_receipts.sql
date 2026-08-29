-- g0_col_0002_stream_receipts.sql
-- Apply as one transaction. Rollback: DROP TABLE col.collector_stream_receipts.
-- Immutable first-party stream receipts and their object-store artifact anchors
-- (FR-COL-003, §13.1–§13.3).

CREATE SCHEMA IF NOT EXISTS col;

CREATE TABLE col.collector_stream_receipts (
    record_id                      text PRIMARY KEY,
    scope_id                       text NOT NULL,
    scope_version                  integer NOT NULL CHECK (scope_version > 0),
    chain_id                       text NOT NULL,
    program_id                     text NOT NULL,
    program_version                text NOT NULL,
    event_family                   text NOT NULL,
    endpoint_id                    text NOT NULL CHECK (length(endpoint_id) > 0),
    subscription_version           text NOT NULL CHECK (length(subscription_version) > 0),
    filter_version                 text NOT NULL CHECK (length(filter_version) > 0),
    connection_generation          bigint NOT NULL CHECK (connection_generation >= 0),

    -- Chain and event coordinates. Nullable sub-coordinates mean "not
    -- applicable" for that allowlisted event family, never "unknown by
    -- default"; producers validate the event-family-specific combination.
    slot                           numeric NOT NULL CHECK (slot >= 0),
    block_hash                     text NOT NULL CHECK (length(block_hash) > 0),
    transaction_signature         text NOT NULL CHECK (length(transaction_signature) > 0),
    transaction_index             integer CHECK (transaction_index IS NULL OR transaction_index >= 0),
    instruction_index             integer CHECK (instruction_index IS NULL OR instruction_index >= 0),
    inner_instruction_index       integer CHECK (inner_instruction_index IS NULL OR inner_instruction_index >= 0),
    log_index                     integer CHECK (log_index IS NULL OR log_index >= 0),
    account_address               text,
    account_write_version         bigint CHECK (account_write_version IS NULL OR account_write_version >= 0),

    received_at                   timestamptz NOT NULL,
    available_at                  timestamptz NOT NULL,
    availability_provenance       text NOT NULL CHECK (availability_provenance IN (
                                      'FIRST_PARTY_LIVE_OBSERVED',
                                      'PROVIDER_LIVE_RESPONSE',
                                      'AUTHORIZED_PUSH_RECEIVED',
                                      'HISTORICAL_QUERY_FETCHED_LATER',
                                      'MANUAL_IMPORT_AVAILABLE',
                                      'DERIVED_FROM_AVAILABLE_INPUTS',
                                      'LEARNED_ARTIFACT_PUBLISHED')),
    finality                      text NOT NULL CHECK (finality IN (
                                      'PROCESSED', 'CONFIRMED', 'FINALIZED')),

    -- The raw payload itself remains in immutable object storage. This row
    -- stores both its content address and its opaque object-artifact id; it
    -- intentionally stores no credentials, signed URLs, or payload material.
    raw_artifact_hash             text NOT NULL
                                      CHECK (raw_artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
    raw_artifact_ref              text NOT NULL CHECK (length(raw_artifact_ref) > 0),
    normalized_event_hash         text NOT NULL
                                      CHECK (normalized_event_hash ~ '^sha256:[0-9a-f]{64}$'),
    decoder_version               text NOT NULL CHECK (length(decoder_version) > 0),
    rights_policy_ref             text NOT NULL CHECK (length(rights_policy_ref) > 0),
    receipt_hash                  text NOT NULL UNIQUE
                                      CHECK (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
    created_at                    timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (scope_id, scope_version)
        REFERENCES col.collector_scopes(scope_id, scope_version),
    -- §13.2: first-party availability cannot be backdated before durable
    -- receipt/commit, even when the event's slot is historical.
    CONSTRAINT collector_stream_receipts_no_backdating
        CHECK (available_at >= received_at),
    CONSTRAINT collector_stream_receipts_instruction_parent
        CHECK (inner_instruction_index IS NULL OR instruction_index IS NOT NULL)
);

CREATE INDEX collector_stream_receipts_partition_slot_idx
    ON col.collector_stream_receipts (scope_id, scope_version, slot, connection_generation);
CREATE INDEX collector_stream_receipts_availability_idx
    ON col.collector_stream_receipts (available_at);
CREATE INDEX collector_stream_receipts_raw_artifact_idx
    ON col.collector_stream_receipts (raw_artifact_hash, raw_artifact_ref);
