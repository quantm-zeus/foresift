-- g1_trd_0001_economic_trade_events.sql
-- Auditable economic-trade normalization (§66.2/§66.3, FR-TRD-001/002).

CREATE TABLE economic_trade_events (
    event_id                  text PRIMARY KEY,
    chain_id                 text NOT NULL REFERENCES chains(chain_id),
    transaction_hash         text NOT NULL,
    actor_entity_id          text,
    actor_resolution_state   text NOT NULL CHECK (actor_resolution_state IN (
                                  'RESOLVED', 'PARTIALLY_RESOLVED', 'UNRESOLVED')),
    asset_representation_id  text NOT NULL,
    net_asset_delta_raw      text NOT NULL CHECK (
                                  net_asset_delta_raw ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'
                                  AND net_asset_delta_raw !~ '^-0(\.0+)?$'),
    net_quote_delta_usd      text CHECK (
                                  net_quote_delta_usd IS NULL OR (
                                    net_quote_delta_usd ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'
                                    AND net_quote_delta_usd !~ '^-0(\.0+)?$')),
    side                      text NOT NULL CHECK (side IN (
                                  'BUY', 'SELL', 'ROUND_TRIP',
                                  'INVENTORY_NEUTRAL', 'UNKNOWN')),
    route_leg_ids             text[] NOT NULL CHECK (cardinality(route_leg_ids) > 0),
    classification_confidence double precision NOT NULL
                                  CHECK (classification_confidence BETWEEN 0 AND 1),
    event_at                  timestamptz NOT NULL,
    available_at              timestamptz NOT NULL,
    quality_codes             text[] NOT NULL,
    created_at                timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT economic_trade_events_availability_order
        CHECK (available_at >= event_at),
    CONSTRAINT economic_trade_events_resolved_actor_present
        CHECK (actor_resolution_state <> 'RESOLVED' OR actor_entity_id IS NOT NULL),
    CONSTRAINT economic_trade_events_quality_nonempty
        CHECK (cardinality(quality_codes) > 0),
    CONSTRAINT economic_trade_events_quality_known
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
    UNIQUE (chain_id, transaction_hash, asset_representation_id, actor_entity_id)
);

CREATE INDEX economic_trade_events_asset_time_idx
    ON economic_trade_events (asset_representation_id, event_at);
CREATE INDEX economic_trade_events_available_idx ON economic_trade_events (available_at);

CREATE TABLE economic_route_legs (
    route_leg_id            text PRIMARY KEY,
    event_id                text NOT NULL REFERENCES economic_trade_events(event_id),
    leg_index               integer NOT NULL CHECK (leg_index >= 0),
    kind                    text NOT NULL CHECK (kind IN (
                                'SWAP', 'TRANSFER', 'AGGREGATOR_HOP', 'MIGRATION')),
    from_account            text,
    to_account              text,
    asset_representation_id text NOT NULL,
    net_asset_delta_raw     text NOT NULL CHECK (
                                net_asset_delta_raw ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'
                                AND net_asset_delta_raw !~ '^-0(\.0+)?$'),
    raw_observation_ids     text[] NOT NULL CHECK (cardinality(raw_observation_ids) > 0),
    event_at                timestamptz NOT NULL,
    available_at            timestamptz NOT NULL,
    quality_codes           text[] NOT NULL CHECK (cardinality(quality_codes) > 0),
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT economic_route_legs_availability_order CHECK (available_at >= event_at),
    CONSTRAINT economic_route_legs_event_position_unique UNIQUE (event_id, leg_index)
);

CREATE INDEX economic_route_legs_event_idx ON economic_route_legs (event_id, leg_index);

CREATE TRIGGER economic_trade_events_immutable
    BEFORE UPDATE OR DELETE ON economic_trade_events
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER economic_trade_events_immutable_truncate
    BEFORE TRUNCATE ON economic_trade_events
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER economic_route_legs_immutable
    BEFORE UPDATE OR DELETE ON economic_route_legs
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER economic_route_legs_immutable_truncate
    BEFORE TRUNCATE ON economic_route_legs
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();

