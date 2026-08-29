-- g0_disc_0001_universe_entries.sql
-- Point-in-time discovery universe, subsequent-source attribution, and
-- coverage population manifests (FR-DISC-002, FR-DISC-003, §63.5, §63.7).

CREATE SCHEMA IF NOT EXISTS disc;

CREATE TABLE disc.discovery_universe_entries (
    entry_id                       text PRIMARY KEY,
    asset_representation_id        text NOT NULL CHECK (
                                       length(asset_representation_id) > 0),
    source_id                      text NOT NULL CHECK (length(source_id) > 0),
    source_class                   text NOT NULL CHECK (length(source_class) > 0),
    -- Stable identity assigned by the source adapter to this exact sighting.
    sighting_id                    text NOT NULL CHECK (length(sighting_id) > 0),
    source_observed_at             timestamptz,
    source_published_at            timestamptz,
    source_available_at            timestamptz NOT NULL,
    first_fetched_at               timestamptz,
    first_received_at              timestamptz,
    first_ingested_at              timestamptz NOT NULL,
    chain_coordinates              text,
    source_rank                    integer CHECK (source_rank >= 0),
    source_metadata_hash           text NOT NULL CHECK (
                                       length(source_metadata_hash) > 0),
    discovery_policy_version       text NOT NULL CHECK (
                                       length(discovery_policy_version) > 0),
    collector_coverage_manifest_id text,
    quality_codes                  text[] NOT NULL CHECK (
                                       array_length(quality_codes, 1) >= 1),
    CONSTRAINT discovery_universe_entries_sighting_unique UNIQUE (
        asset_representation_id, source_id, sighting_id),
    CONSTRAINT discovery_universe_entries_availability_order CHECK (
        source_observed_at IS NULL
        OR source_available_at >= source_observed_at),
    CONSTRAINT discovery_universe_entries_publication_order CHECK (
        source_published_at IS NULL
        OR source_available_at >= source_published_at),
    CONSTRAINT discovery_universe_entries_fetch_order CHECK (
        first_fetched_at IS NULL
        OR first_fetched_at >= source_available_at),
    CONSTRAINT discovery_universe_entries_receive_order CHECK (
        first_received_at IS NULL
        OR first_received_at >= source_available_at),
    CONSTRAINT discovery_universe_entries_ingest_order CHECK (
        first_ingested_at >= source_available_at)
);

CREATE INDEX discovery_universe_entries_asset_time_idx
    ON disc.discovery_universe_entries (
        asset_representation_id, source_available_at, first_ingested_at);

CREATE INDEX discovery_universe_entries_source_time_idx
    ON disc.discovery_universe_entries (source_id, source_available_at);

-- Later sightings attach to the candidate's first valid universe entry. They
-- retain the same source/system timing surface so lead/lag and source overlap
-- remain reproducible at any historical cut-off.
CREATE TABLE disc.discovery_attribution (
    attribution_id       text PRIMARY KEY,
    universe_entry_id    text NOT NULL REFERENCES
                             disc.discovery_universe_entries(entry_id),
    source_id            text NOT NULL CHECK (length(source_id) > 0),
    source_class         text NOT NULL CHECK (length(source_class) > 0),
    sighting_id          text NOT NULL CHECK (length(sighting_id) > 0),
    source_observed_at   timestamptz,
    source_published_at  timestamptz,
    source_available_at  timestamptz NOT NULL,
    first_received_at    timestamptz,
    first_ingested_at    timestamptz NOT NULL,
    source_rank          integer CHECK (source_rank >= 0),
    source_metadata_hash text NOT NULL CHECK (length(source_metadata_hash) > 0),
    quality_codes        text[] NOT NULL CHECK (array_length(quality_codes, 1) >= 1),
    CONSTRAINT discovery_attribution_sighting_unique UNIQUE (
        universe_entry_id, source_id, sighting_id),
    CONSTRAINT discovery_attribution_availability_order CHECK (
        source_observed_at IS NULL
        OR source_available_at >= source_observed_at),
    CONSTRAINT discovery_attribution_publication_order CHECK (
        source_published_at IS NULL
        OR source_available_at >= source_published_at),
    CONSTRAINT discovery_attribution_receive_order CHECK (
        first_received_at IS NULL
        OR first_received_at >= source_available_at),
    CONSTRAINT discovery_attribution_ingest_order CHECK (
        first_ingested_at >= source_available_at)
);

CREATE INDEX discovery_attribution_entry_time_idx
    ON disc.discovery_attribution (universe_entry_id, source_available_at);

-- Shared immutability guard for discovery history. Corrections are additional
-- sightings; a previously observed attribution is never rewritten or erased.
CREATE FUNCTION disc.refuse_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'DISCOVERY_HISTORY_IMMUTABLE: % on % is refused',
        TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER discovery_attribution_append_only
    BEFORE UPDATE OR DELETE ON disc.discovery_attribution
    FOR EACH ROW EXECUTE FUNCTION disc.refuse_mutation();

CREATE TRIGGER discovery_attribution_immutable_truncate
    BEFORE TRUNCATE ON disc.discovery_attribution
    FOR EACH STATEMENT EXECUTE FUNCTION disc.refuse_mutation();

CREATE TABLE disc.coverage_population_manifests (
    manifest_id                  text PRIMARY KEY,
    population                   text NOT NULL CHECK (population IN (
                                     'SUPPORTED_PROGRAM_UNIVERSE',
                                     'PROSPECTIVELY_OBSERVED_UNIVERSE',
                                     'AGGREGATE_PROVIDER_UNIVERSE',
                                     'AUTHORIZED_LAUNCH_UNIVERSE',
                                     'STRATIFIED_SAMPLED_UNIVERSE',
                                     'CURRENTLY_OBSERVED_SUBSET_ONLY')),
    source_scope                 jsonb NOT NULL CHECK (
                                     jsonb_typeof(source_scope) = 'object'),
    collector_scope              jsonb NOT NULL CHECK (
                                     jsonb_typeof(collector_scope) = 'object'),
    window_start                 timestamptz NOT NULL,
    window_end                   timestamptz NOT NULL,
    gaps                         jsonb NOT NULL CHECK (
                                     jsonb_typeof(gaps) = 'array'),
    rights_exclusions            jsonb NOT NULL CHECK (
                                     jsonb_typeof(rights_exclusions) = 'array'),
    program_versions             jsonb NOT NULL CHECK (
                                     jsonb_typeof(program_versions) = 'array'),
    selection_probabilities      jsonb NOT NULL CHECK (
                                     jsonb_typeof(selection_probabilities) = 'object'),
    known_missing_sources        jsonb NOT NULL CHECK (
                                     jsonb_typeof(known_missing_sources) = 'array'),
    source_dependence_assessment jsonb NOT NULL CHECK (
                                     jsonb_typeof(source_dependence_assessment) = 'object'),
    created_at                   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT coverage_population_manifests_window_order CHECK (
        window_end >= window_start)
);

CREATE INDEX coverage_population_manifests_population_time_idx
    ON disc.coverage_population_manifests (population, window_start, window_end);

