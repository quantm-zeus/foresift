-- g1_solsec_0003_provider_evidence.sql
-- Independent external-provider reports and deterministic resolution (FR-SOLSEC-005).

CREATE TABLE security_provider_reports (
    report_id             text PRIMARY KEY,
    assessment_id         text NOT NULL REFERENCES token_program_assessments(assessment_id),
    source_id             text NOT NULL REFERENCES source_identities(source_id),
    provider_report_id    text NOT NULL,
    provider_version      text NOT NULL,
    verdict               text NOT NULL CHECK (verdict IN (
                              'SAFE', 'RISK_DETECTED', 'UNABLE_TO_VERIFY')),
    raw_payload_ref       text NOT NULL CHECK (
                              raw_payload_ref ~ '^sha256:[0-9a-f]{64}$'),
    finding_ids           text[] NOT NULL,
    observed_at           timestamptz NOT NULL,
    available_at          timestamptz NOT NULL,
    quality_codes         text[] NOT NULL CHECK (cardinality(quality_codes) > 0),
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT security_provider_reports_availability_order
        CHECK (available_at >= observed_at),
    CONSTRAINT security_provider_reports_source_report_unique
        UNIQUE (source_id, provider_report_id),
    CONSTRAINT security_provider_reports_quality_known
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

CREATE INDEX security_provider_reports_assessment_time_idx
    ON security_provider_reports (assessment_id, observed_at);

CREATE TABLE security_conflicts (
    conflict_id                text PRIMARY KEY,
    assessment_id              text NOT NULL REFERENCES token_program_assessments(assessment_id),
    provider_report_id         text NOT NULL REFERENCES security_provider_reports(report_id),
    conflict_class             text NOT NULL CHECK (conflict_class IN (
                                   'PROVIDER_OPTIMISM_OVERRIDDEN',
                                   'PROVIDER_RISK_NO_DETERMINISTIC_CORROBORATION',
                                   'PROVIDER_REPORTS_DISAGREE',
                                   'DETERMINISTIC_EVIDENCE_DISAGREES')),
    deterministic_finding_ids  text[] NOT NULL CHECK (
                                   cardinality(deterministic_finding_ids) > 0
                                   AND array_position(deterministic_finding_ids, '') IS NULL),
    resolution                 text NOT NULL CHECK (resolution = 'DETERMINISTIC'),
    resolved_at                timestamptz NOT NULL,
    available_at               timestamptz NOT NULL,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT security_conflicts_availability_order
        CHECK (available_at >= resolved_at)
);

CREATE INDEX security_conflicts_assessment_idx
    ON security_conflicts (assessment_id, resolved_at);

CREATE TRIGGER security_provider_reports_immutable
    BEFORE UPDATE OR DELETE ON security_provider_reports
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER security_provider_reports_immutable_truncate
    BEFORE TRUNCATE ON security_provider_reports
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER security_conflicts_immutable
    BEFORE UPDATE OR DELETE ON security_conflicts
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER security_conflicts_immutable_truncate
    BEFORE TRUNCATE ON security_conflicts
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
