-- g1_disc_0001_source_profiles.sql
-- Additive discovery-source profiles, per-entry provenance, and population
-- riders (FR-DISC-009, FR-DISC-011). Replay is intentionally idempotent.

CREATE SCHEMA IF NOT EXISTS disc;

CREATE TABLE IF NOT EXISTS disc.disc_source_profiles (
    source_id             text NOT NULL CHECK (length(source_id) > 0),
    profile_version       integer NOT NULL CHECK (profile_version >= 1),
    source_class          text NOT NULL CHECK (source_class IN (
                              'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
                              'FREE_AGGREGATE_DISCOVERY',
                              'AUTHORIZED_LAUNCH_FEED',
                              'USER_WATCHLIST_OR_MCP',
                              'AUTHORIZED_SOCIAL_AGGREGATE',
                              'SELECTIVE_CHAIN_VERIFICATION',
                              'RETROSPECTIVE_UNIVERSE_ENUMERATION',
                              'STRATIFIED_UNIVERSE_SAMPLE')),
    coverage_scope        jsonb NOT NULL CHECK (
                              jsonb_typeof(coverage_scope) = 'object'),
    rights_basis          text NOT NULL CHECK (rights_basis IN (
                              'FIRST_PARTY_COLLECTOR',
                              'AUTHORIZED_FEED_CONTRACT',
                              'FREE_PUBLIC_TERMS',
                              'USER_PROVIDED',
                              'EXCLUDED')),
    query_filter_version  text NOT NULL CHECK (length(query_filter_version) > 0),
    upstream_dependence   jsonb NOT NULL CHECK (
                              jsonb_typeof(upstream_dependence) = 'object'),
    upstream_lineage_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
    manipulation_policy   text NOT NULL CHECK (manipulation_policy IN (
                              'LABEL_AND_RETAIN',
                              'LABEL_AND_DOWNWEIGHT',
                              'EXCLUDE_PAID_PLACEMENTS')),
    collector_scope_ids   text[] NOT NULL DEFAULT ARRAY[]::text[],
    effective_from        timestamptz NOT NULL,
    superseded_at         timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_id, profile_version),
    CONSTRAINT disc_source_profiles_window CHECK (
        superseded_at IS NULL OR superseded_at > effective_from)
);

CREATE INDEX IF NOT EXISTS disc_source_profiles_effective_idx
    ON disc.disc_source_profiles (source_id, effective_from, superseded_at);

CREATE TABLE IF NOT EXISTS disc.universe_entry_provenance (
    entry_id                       text PRIMARY KEY REFERENCES
                                       disc.discovery_universe_entries(entry_id),
    normalized_identity_id         text NOT NULL CHECK (
                                       length(normalized_identity_id) > 0),
    entry_reason                   text NOT NULL CHECK (entry_reason IN (
                                       'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
                                       'FREE_AGGREGATE_OBSERVATION',
                                       'AUTHORIZED_LAUNCH_NOTIFICATION',
                                       'USER_WATCHLIST_ADDITION',
                                       'AUTHORIZED_SOCIAL_MENTION',
                                       'SELECTIVE_VERIFICATION_HIT',
                                       'RETROSPECTIVE_ENUMERATION_HIT',
                                       'STRATIFIED_SAMPLE_DRAW')),
    coverage_scope_ref             text NOT NULL CHECK (
                                       length(coverage_scope_ref) > 0),
    rights_record                  text NOT NULL CHECK (rights_record IN (
                                       'FIRST_PARTY_COLLECTOR',
                                       'AUTHORIZED_FEED_CONTRACT',
                                       'FREE_PUBLIC_TERMS',
                                       'USER_PROVIDED',
                                       'EXCLUDED')),
    query_filter_version           text NOT NULL CHECK (
                                       length(query_filter_version) > 0),
    upstream_dependence_disclosed  jsonb NOT NULL CHECK (
                                       jsonb_typeof(upstream_dependence_disclosed) = 'object'),
    first_party_observed           boolean NOT NULL,
    recorded_at                    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE disc.cheap_monitor_rows
    ADD COLUMN IF NOT EXISTS population_manifest_id text,
    ADD COLUMN IF NOT EXISTS entry_provenance_id text;

ALTER TABLE disc.promotion_decisions
    ADD COLUMN IF NOT EXISTS population_manifest_id text,
    ADD COLUMN IF NOT EXISTS entry_provenance_id text;

-- Riders are separate append-only truth so the G0 scheduler and promotion
-- state machines need no mutation. The compatibility columns above remain
-- nullable projections for older readers.
CREATE TABLE IF NOT EXISTS disc.cheap_monitor_population_riders (
    monitor_id             text PRIMARY KEY REFERENCES disc.cheap_monitor_rows(monitor_id),
    population_manifest_id text NOT NULL REFERENCES
                               disc.coverage_population_manifests(manifest_id),
    entry_provenance_id    text NOT NULL REFERENCES
                               disc.universe_entry_provenance(entry_id),
    recorded_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS disc.promotion_population_riders (
    promotion_decision_id  text PRIMARY KEY REFERENCES
                               disc.promotion_decisions(promotion_decision_id),
    population_manifest_id text NOT NULL REFERENCES
                               disc.coverage_population_manifests(manifest_id),
    entry_provenance_id    text NOT NULL REFERENCES
                               disc.universe_entry_provenance(entry_id),
    monitor_id             text NOT NULL REFERENCES
                               disc.cheap_monitor_population_riders(monitor_id),
    recorded_at            timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER disc_monitor_riders_append_only
    BEFORE UPDATE OR DELETE ON disc.cheap_monitor_population_riders
    FOR EACH ROW EXECUTE FUNCTION disc.refuse_mutation();
CREATE OR REPLACE TRIGGER disc_promotion_riders_append_only
    BEFORE UPDATE OR DELETE ON disc.promotion_population_riders
    FOR EACH ROW EXECUTE FUNCTION disc.refuse_mutation();
