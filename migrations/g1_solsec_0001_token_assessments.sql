-- g1_solsec_0001_token_assessments.sql
-- Deterministic SPL/Token-2022 assessments (FR-SOLSEC-001/002/004).

CREATE TABLE token_program_assessments (
    assessment_id             text PRIMARY KEY,
    asset_representation_id   text NOT NULL,
    chain_id                  text NOT NULL REFERENCES chains(chain_id),
    program_owner             text NOT NULL,
    program_version           text NOT NULL,
    analyzer_version          text NOT NULL,
    decimals                  integer NOT NULL CHECK (decimals BETWEEN 0 AND 255),
    total_supply_raw          text NOT NULL CHECK (total_supply_raw ~ '^[0-9]+$'),
    transfer_semantics_support text NOT NULL CHECK (transfer_semantics_support IN (
                                  'KNOWN_MODELED', 'KNOWN_UNMODELED',
                                  'UNKNOWN_REQUIRED', 'NOT_PRESENT')),
    deterministic_evidence_ids text[] NOT NULL CHECK (
                                  cardinality(deterministic_evidence_ids) > 0),
    observed_at               timestamptz NOT NULL,
    available_at              timestamptz NOT NULL,
    quality_codes             text[] NOT NULL CHECK (cardinality(quality_codes) > 0),
    schema_registry_version   integer NOT NULL CHECK (schema_registry_version = 1),
    created_at                timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT token_program_assessments_availability_order
        CHECK (available_at >= observed_at),
    CONSTRAINT token_program_assessments_quality_known
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

CREATE INDEX token_program_assessments_asset_time_idx
    ON token_program_assessments (asset_representation_id, observed_at);

CREATE TABLE token_control_findings (
    finding_id                text PRIMARY KEY,
    assessment_id             text NOT NULL REFERENCES token_program_assessments(assessment_id),
    control                   text NOT NULL CHECK (control IN (
                                  'MINT', 'FREEZE', 'PERMANENT_DELEGATE',
                                  'TRANSFER_FEE', 'TRANSFER_HOOK', 'CLOSE',
                                  'METADATA_UPDATE', 'DEFAULT_STATE',
                                  'NON_TRANSFERABLE', 'CONFIDENTIAL_TRANSFER',
                                  'UNKNOWN_EXTENSION')),
    control_state             text NOT NULL CHECK (control_state IN (
                                  'KNOWN_RISK', 'ADMINISTRATIVE_CONTROL',
                                  'NEUTRAL_CONFIGURATION', 'REVOKED_AUTHORITY',
                                  'UNABLE_TO_VERIFY')),
    severity                  text CHECK (severity IN (
                                  'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE')),
    authority_address         text,
    extension_data_hash       text CHECK (
                                  extension_data_hash IS NULL OR
                                  extension_data_hash ~ '^sha256:[0-9a-f]{64}$'),
    evidence_ids              text[] NOT NULL CHECK (cardinality(evidence_ids) > 0),
    observed_at               timestamptz NOT NULL,
    available_at              timestamptz NOT NULL,
    quality_codes             text[] NOT NULL CHECK (cardinality(quality_codes) > 0),
    created_at                timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT token_control_findings_assessment_control_unique
        UNIQUE (assessment_id, control),
    CONSTRAINT token_control_findings_known_risk_has_severity
        CHECK (control_state <> 'KNOWN_RISK' OR severity IS NOT NULL),
    CONSTRAINT token_control_findings_availability_order
        CHECK (available_at >= observed_at),
    CONSTRAINT token_control_findings_quality_known
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

CREATE TABLE token_extension_support (
    assessment_id             text NOT NULL REFERENCES token_program_assessments(assessment_id),
    extension_type            text NOT NULL,
    extension_data_hash       text NOT NULL CHECK (
                                  extension_data_hash ~ '^sha256:[0-9a-f]{64}$'),
    support                   text NOT NULL CHECK (support IN (
                                  'KNOWN_MODELED', 'KNOWN_UNMODELED',
                                  'UNKNOWN_REQUIRED', 'NOT_PRESENT')),
    verdict_policy_version    text NOT NULL,
    observed_at               timestamptz NOT NULL,
    available_at              timestamptz NOT NULL,
    quality_codes             text[] NOT NULL CHECK (cardinality(quality_codes) > 0),
    created_at                timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (assessment_id, extension_type, verdict_policy_version),
    CONSTRAINT token_extension_support_availability_order
        CHECK (available_at >= observed_at),
    CONSTRAINT token_extension_support_quality_known
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

CREATE TRIGGER token_program_assessments_immutable
    BEFORE UPDATE OR DELETE ON token_program_assessments
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER token_program_assessments_immutable_truncate
    BEFORE TRUNCATE ON token_program_assessments
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER token_control_findings_immutable
    BEFORE UPDATE OR DELETE ON token_control_findings
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER token_control_findings_immutable_truncate
    BEFORE TRUNCATE ON token_control_findings
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER token_extension_support_immutable
    BEFORE UPDATE OR DELETE ON token_extension_support
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER token_extension_support_immutable_truncate
    BEFORE TRUNCATE ON token_extension_support
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
