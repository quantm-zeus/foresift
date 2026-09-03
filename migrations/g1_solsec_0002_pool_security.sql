-- g1_solsec_0002_pool_security.sql
-- Pool/LP authority and liquidity-removal evidence (FR-SOLSEC-003, AC-230).

CREATE TABLE pool_security_assessments (
    assessment_id              text PRIMARY KEY,
    pool_id                    text NOT NULL REFERENCES pools(pool_id),
    adapter_id                 text NOT NULL,
    adapter_version            text NOT NULL,
    adapter_support_state      text NOT NULL CHECK (adapter_support_state IN (
                                   'RESOLVED', 'DEGRADED_UNSUPPORTED',
                                   'UNABLE_TO_VERIFY')),
    lp_control_state           text CHECK (lp_control_state IN (
                                   'BURNED', 'LOCKED_WITH_EVIDENCE', 'OPEN_CONTROL',
                                   'UNABLE_TO_VERIFY')),
    withdrawal_authority_state text CHECK (withdrawal_authority_state IN (
                                   'REVOKED', 'PRESENT_OPEN',
                                   'PRESENT_WITH_OBSERVED_ABUSE', 'UNABLE_TO_VERIFY')),
    liquidity_removal_risk     text CHECK (liquidity_removal_risk IN (
                                   'NONE_EVIDENCED', 'POSSIBLE', 'OBSERVED',
                                   'UNABLE_TO_VERIFY')),
    quote_parity_state         text CHECK (quote_parity_state IN (
                                   'PASS', 'FAIL', 'UNABLE_TO_VERIFY')),
    state_completeness         text NOT NULL CHECK (state_completeness IN (
                                   'COMPLETE', 'INCOMPLETE_BLOCKING')),
    migration_lineage_id       text,
    liquidity_concentration    text CHECK (
                                   liquidity_concentration IS NULL OR (
                                     liquidity_concentration ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
                                     AND liquidity_concentration::numeric BETWEEN 0 AND 1)),
    evidence_ids               text[] NOT NULL CHECK (cardinality(evidence_ids) > 0),
    observed_at                timestamptz NOT NULL,
    available_at               timestamptz NOT NULL,
    quality_codes              text[] NOT NULL CHECK (cardinality(quality_codes) > 0),
    schema_registry_version    integer NOT NULL CHECK (schema_registry_version = 1),
    created_at                 timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pool_security_assessments_availability_order
        CHECK (available_at >= observed_at),
    CONSTRAINT pool_security_unsupported_not_resolved CHECK (
        adapter_support_state <> 'DEGRADED_UNSUPPORTED' OR (
            lp_control_state IS NULL
            AND withdrawal_authority_state IS NULL
            AND liquidity_removal_risk IS NULL
            AND quote_parity_state IS NULL
            AND state_completeness IS NULL
            AND migration_lineage_id IS NULL
            AND liquidity_concentration IS NULL
        )),
    CONSTRAINT pool_security_resolved_has_state CHECK (
        adapter_support_state <> 'RESOLVED' OR (
            lp_control_state IS NOT NULL
            AND withdrawal_authority_state IS NOT NULL
            AND liquidity_removal_risk IS NOT NULL
            AND quote_parity_state IS NOT NULL
            AND state_completeness IS NOT NULL
        )),
    CONSTRAINT pool_security_assessments_quality_known
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
            'RETROSPECTIVE_ONLY']::text[])
);

CREATE INDEX pool_security_assessments_pool_time_idx
    ON pool_security_assessments (pool_id, observed_at);

CREATE TRIGGER pool_security_assessments_immutable
    BEFORE UPDATE OR DELETE ON pool_security_assessments
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER pool_security_assessments_immutable_truncate
    BEFORE TRUNCATE ON pool_security_assessments
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
