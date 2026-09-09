-- g1_disc_0002_constraints_gateways.sql
-- Closed discovery vocabularies, population constraints, bounded chain access,
-- and recall-estimate truth (FR-DISC-006/008/010/013/014).

CREATE SCHEMA IF NOT EXISTS disc;

DO $$ BEGIN
    CREATE TYPE disc.disc_entry_reason AS ENUM (
        'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
        'FREE_AGGREGATE_OBSERVATION',
        'AUTHORIZED_LAUNCH_NOTIFICATION',
        'USER_WATCHLIST_ADDITION',
        'AUTHORIZED_SOCIAL_MENTION',
        'SELECTIVE_VERIFICATION_HIT',
        'RETROSPECTIVE_ENUMERATION_HIT',
        'STRATIFIED_SAMPLE_DRAW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE disc.disc_rights_basis AS ENUM (
        'FIRST_PARTY_COLLECTOR',
        'AUTHORIZED_FEED_CONTRACT',
        'FREE_PUBLIC_TERMS',
        'USER_PROVIDED',
        'EXCLUDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE disc.disc_manipulation_policy AS ENUM (
        'LABEL_AND_RETAIN',
        'LABEL_AND_DOWNWEIGHT',
        'EXCLUDE_PAID_PLACEMENTS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE disc.disc_claim_basis AS ENUM (
        'INDEPENDENT_FIRST_PARTY_OBSERVATION',
        'INDEPENDENT_PROVIDER_LINEAGE',
        'KNOWN_INCLUSION_PROBABILITIES');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE disc.disc_constraint_kind AS ENUM (
        'COLLECTOR_GAP',
        'DECODER_OUTAGE',
        'UNVERIFIED_PROGRAM_VERSION',
        'PROVIDER_UNAVAILABLE',
        'RIGHTS_EXCLUSION',
        'IDENTITY_UNRESOLVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE disc.disc_constraint_effect AS ENUM (
        'NARROW_CLAIM', 'EXCLUDE_WINDOW', 'BLOCK_CLAIM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE disc.disc_chain_access_purpose AS ENUM (
        'VERIFICATION', 'RETROSPECTIVE_BACKFILL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE disc.disc_recall_verdict AS ENUM (
        'INDEPENDENT_ESTIMATE',
        'DEPENDENT_DISCLOSED',
        'SELF_RECALL_REFUSED',
        'NO_ADMISSIBLE_BASIS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE disc.disc_lateness_basis AS ENUM (
        'SOURCE_OBSERVED_AT', 'SOURCE_PUBLISHED_AT', 'SOURCE_AVAILABLE_AT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS disc.population_constraints (
    constraint_id       text PRIMARY KEY,
    manifest_id         text NOT NULL REFERENCES
                            disc.coverage_population_manifests(manifest_id),
    kind                disc.disc_constraint_kind NOT NULL,
    effect              disc.disc_constraint_effect NOT NULL,
    source_id           text,
    collector_scope_id  text,
    program_version     text,
    window_start        timestamptz,
    window_end          timestamptz,
    window_start_slot   bigint CHECK (window_start_slot IS NULL OR window_start_slot >= 0),
    window_end_slot     bigint,
    evidence_refs       text[] NOT NULL CHECK (cardinality(evidence_refs) > 0),
    recorded_at         timestamptz NOT NULL DEFAULT now(),
    resolved_at         timestamptz,
    CONSTRAINT disc_constraint_window CHECK (
        window_start IS NULL OR window_end IS NULL OR window_end > window_start),
    CONSTRAINT disc_constraint_slot_window CHECK (
        window_start_slot IS NULL OR window_end_slot IS NULL OR
        window_end_slot >= window_start_slot),
    CONSTRAINT disc_constraint_resolution CHECK (
        resolved_at IS NULL OR resolved_at > recorded_at)
);

CREATE INDEX IF NOT EXISTS population_constraints_manifest_idx
    ON disc.population_constraints (manifest_id, recorded_at);

CREATE TABLE IF NOT EXISTS disc.chain_access_declarations (
    declaration_id               text PRIMARY KEY,
    version                      integer NOT NULL CHECK (version >= 1),
    purpose                      disc.disc_chain_access_purpose NOT NULL,
    chain_id                     text NOT NULL CHECK (length(chain_id) > 0),
    program_ids                  text[] NOT NULL CHECK (cardinality(program_ids) > 0),
    max_candidates               integer NOT NULL CHECK (max_candidates > 0),
    max_slots_per_run            bigint NOT NULL CHECK (max_slots_per_run > 0),
    max_calls_per_day            integer NOT NULL CHECK (max_calls_per_day > 0),
    max_window_seconds           bigint NOT NULL CHECK (max_window_seconds > 0),
    cost_class                   text NOT NULL CHECK (cost_class IN (
                                     'FREE_UNMETERED', 'FREE_QUOTA')),
    paid_fallback_allowed        boolean NOT NULL DEFAULT false CHECK (
                                     NOT paid_fallback_allowed),
    protected_reserve_compatible boolean NOT NULL DEFAULT true,
    tolerance_percent           integer NOT NULL CHECK (
                                     tolerance_percent BETWEEN 1 AND 100),
    created_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chain_access_declaration_version UNIQUE (declaration_id, version)
);

CREATE TABLE IF NOT EXISTS disc.chain_access_consumption (
    consumption_id     text PRIMARY KEY,
    declaration_id     text NOT NULL REFERENCES
                           disc.chain_access_declarations(declaration_id),
    consumed_at        timestamptz NOT NULL,
    slots_scanned      bigint NOT NULL CHECK (slots_scanned >= 0),
    calls_made         integer NOT NULL CHECK (calls_made >= 0),
    candidates_touched integer NOT NULL CHECK (candidates_touched >= 0),
    incident_id        text,
    CONSTRAINT disc_consumption_positive CHECK (
        slots_scanned + calls_made + candidates_touched > 0)
);

CREATE INDEX IF NOT EXISTS chain_access_consumption_declaration_idx
    ON disc.chain_access_consumption (declaration_id, consumed_at);

CREATE TABLE IF NOT EXISTS disc.recall_estimates (
    estimate_id                  text PRIMARY KEY,
    manifest_id                  text NOT NULL REFERENCES
                                     disc.coverage_population_manifests(manifest_id),
    evaluated_source_id          text NOT NULL CHECK (
                                     length(evaluated_source_id) > 0),
    claim_basis                  disc.disc_claim_basis NOT NULL,
    verdict                      disc.disc_recall_verdict NOT NULL,
    recall_estimate              double precision CHECK (
                                     recall_estimate IS NULL OR
                                     (recall_estimate >= 0 AND recall_estimate <= 1)),
    inclusion_probability_source text,
    independence_evidence        text[] NOT NULL DEFAULT ARRAY[]::text[],
    constraint_ids               text[] NOT NULL DEFAULT ARRAY[]::text[],
    as_of                        timestamptz NOT NULL,
    recorded_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT disc_recall_estimate_requires_basis CHECK (
        verdict <> 'INDEPENDENT_ESTIMATE' OR claim_basis IS NOT NULL),
    CONSTRAINT disc_estimate_needs_evidence CHECK (
        verdict NOT IN ('INDEPENDENT_ESTIMATE', 'DEPENDENT_DISCLOSED') OR
        cardinality(independence_evidence) > 0)
);

-- Corrections are new versioned rows. Historical claim inputs and outputs are
-- immutable, including against whole-table truncation.
CREATE OR REPLACE TRIGGER disc_source_profiles_append_only
    BEFORE UPDATE OR DELETE ON disc.disc_source_profiles
    FOR EACH ROW EXECUTE FUNCTION disc.refuse_mutation();
CREATE OR REPLACE TRIGGER disc_source_profiles_immutable_truncate
    BEFORE TRUNCATE ON disc.disc_source_profiles
    FOR EACH STATEMENT EXECUTE FUNCTION disc.refuse_mutation();

CREATE OR REPLACE TRIGGER disc_entry_provenance_append_only
    BEFORE UPDATE OR DELETE ON disc.universe_entry_provenance
    FOR EACH ROW EXECUTE FUNCTION disc.refuse_mutation();
CREATE OR REPLACE TRIGGER disc_entry_provenance_immutable_truncate
    BEFORE TRUNCATE ON disc.universe_entry_provenance
    FOR EACH STATEMENT EXECUTE FUNCTION disc.refuse_mutation();

CREATE OR REPLACE TRIGGER disc_constraints_append_only
    BEFORE UPDATE OR DELETE ON disc.population_constraints
    FOR EACH ROW EXECUTE FUNCTION disc.refuse_mutation();
CREATE OR REPLACE TRIGGER disc_constraints_immutable_truncate
    BEFORE TRUNCATE ON disc.population_constraints
    FOR EACH STATEMENT EXECUTE FUNCTION disc.refuse_mutation();

CREATE OR REPLACE TRIGGER disc_recall_estimates_append_only
    BEFORE UPDATE OR DELETE ON disc.recall_estimates
    FOR EACH ROW EXECUTE FUNCTION disc.refuse_mutation();
CREATE OR REPLACE TRIGGER disc_recall_estimates_immutable_truncate
    BEFORE TRUNCATE ON disc.recall_estimates
    FOR EACH STATEMENT EXECUTE FUNCTION disc.refuse_mutation();
