-- g0_trace_0002_decision_traces.sql
-- Rollback: DROP TABLE trace.decision_traces;
-- Point-in-time authorization maps for every production decision (FR-TRACE-005).

CREATE TABLE trace.decision_traces (
    trace_id                text PRIMARY KEY,
    decision_ref            text NOT NULL UNIQUE CHECK (length(decision_ref) > 0),
    requirement_ids         text[] NOT NULL CHECK (cardinality(requirement_ids) > 0),
    policy_versions         jsonb NOT NULL CHECK (jsonb_typeof(policy_versions) = 'object'),
    feature_versions        jsonb NOT NULL CHECK (jsonb_typeof(feature_versions) = 'object'),
    model_versions          jsonb NOT NULL CHECK (jsonb_typeof(model_versions) = 'object'),
    tool_versions           jsonb NOT NULL CHECK (jsonb_typeof(tool_versions) = 'object'),
    provider_versions       jsonb NOT NULL CHECK (jsonb_typeof(provider_versions) = 'object'),
    adapter_versions        jsonb NOT NULL CHECK (jsonb_typeof(adapter_versions) = 'object'),
    artifact_versions       jsonb NOT NULL CHECK (jsonb_typeof(artifact_versions) = 'object'),
    test_release_id         text NOT NULL CHECK (length(test_release_id) > 0),
    conformance_release_id  text NOT NULL CHECK (length(conformance_release_id) > 0),
    manifest_sha256         text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
    release_report_id       text NOT NULL CHECK (length(release_report_id) > 0),
    recorded_at             timestamptz NOT NULL
);

CREATE TRIGGER decision_traces_append_only
    BEFORE UPDATE OR DELETE ON trace.decision_traces
    FOR EACH ROW EXECUTE FUNCTION trace.refuse_mutation();
