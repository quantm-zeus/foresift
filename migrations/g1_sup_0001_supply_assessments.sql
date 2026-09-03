-- g1_sup_0001_supply_assessments.sql
-- Supply confidence and fallback-safe market-cap decisions (§65.6, ADR-4).

CREATE TABLE supply_assessments (
    assessment_id                      text PRIMARY KEY,
    asset_representation_id            text NOT NULL,
    as_of                              timestamptz NOT NULL,
    total_supply_raw                   text NOT NULL CHECK (total_supply_raw ~ '^[0-9]+$'),
    estimated_circulating_supply_raw   text CHECK (
                                          estimated_circulating_supply_raw IS NULL
                                          OR estimated_circulating_supply_raw ~ '^[0-9]+$'),
    excluded_supply_raw                text CHECK (
                                          excluded_supply_raw IS NULL
                                          OR excluded_supply_raw ~ '^[0-9]+$'),
    source                             text NOT NULL,
    method                             text NOT NULL,
    confidence                         double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    exclusion_evidence_ids             text[] NOT NULL DEFAULT ARRAY[]::text[],
    quality_codes                      text[] NOT NULL CHECK (cardinality(quality_codes) > 0),
    market_cap_basis                   text NOT NULL CHECK (market_cap_basis IN (
                                          'TOTAL_SUPPLY',
                                          'PROVIDER_CIRCULATING_SUPPLY',
                                          'ESTIMATED_CIRCULATING_SUPPLY')),
    available_at                       timestamptz NOT NULL,
    created_at                         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT supply_assessments_availability_order CHECK (available_at >= as_of),
    CONSTRAINT supply_assessments_exclusion_has_evidence CHECK (
        excluded_supply_raw IS NULL OR cardinality(exclusion_evidence_ids) > 0),
    CONSTRAINT supply_assessments_estimated_basis_has_value CHECK (
        market_cap_basis <> 'ESTIMATED_CIRCULATING_SUPPLY'
        OR estimated_circulating_supply_raw IS NOT NULL),
    CONSTRAINT supply_assessments_excluded_not_above_total CHECK (
        excluded_supply_raw IS NULL
        OR excluded_supply_raw::numeric <= total_supply_raw::numeric),
    CONSTRAINT supply_assessments_circulating_not_above_total CHECK (
        estimated_circulating_supply_raw IS NULL
        OR estimated_circulating_supply_raw::numeric <= total_supply_raw::numeric)
);

CREATE INDEX supply_assessments_asset_as_of_idx
    ON supply_assessments (asset_representation_id, as_of);

CREATE TABLE market_cap_fallback_decisions (
    decision_id                            text PRIMARY KEY,
    assessment_id                         text NOT NULL REFERENCES supply_assessments(assessment_id),
    candidate_id                          text NOT NULL,
    low_confidence_market_cap             boolean NOT NULL,
    hard_rejected                         boolean NOT NULL,
    market_cap_is_sole_hard_rejection     boolean NOT NULL,
    approved_liquidity_fallback_available boolean NOT NULL,
    approved_activity_fallback_available  boolean NOT NULL,
    applied_fallback                      text CHECK (applied_fallback IN ('LIQUIDITY', 'ACTIVITY')),
    policy_version                        text NOT NULL,
    decided_at                            timestamptz NOT NULL,
    rationale                             text NOT NULL,
    created_at                            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT market_cap_no_hard_rejection_with_fallback CHECK (NOT (
        low_confidence_market_cap
        AND hard_rejected
        AND market_cap_is_sole_hard_rejection
        AND (approved_liquidity_fallback_available OR approved_activity_fallback_available)
    )),
    CONSTRAINT market_cap_applied_fallback_is_approved CHECK (
        applied_fallback IS NULL
        OR (applied_fallback = 'LIQUIDITY' AND approved_liquidity_fallback_available)
        OR (applied_fallback = 'ACTIVITY' AND approved_activity_fallback_available)
    )
);

CREATE INDEX market_cap_fallback_candidate_idx
    ON market_cap_fallback_decisions (candidate_id, decided_at);

CREATE TRIGGER supply_assessments_immutable
    BEFORE UPDATE OR DELETE ON supply_assessments
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER supply_assessments_immutable_truncate
    BEFORE TRUNCATE ON supply_assessments
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER market_cap_fallback_decisions_immutable
    BEFORE UPDATE OR DELETE ON market_cap_fallback_decisions
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER market_cap_fallback_decisions_immutable_truncate
    BEFORE TRUNCATE ON market_cap_fallback_decisions
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();

