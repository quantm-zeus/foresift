-- Immutable, point-in-time production decision provenance (FR-TRACE-005).
CREATE TABLE trace.decision_traces (
    trace_id                text PRIMARY KEY CHECK (trace_id ~ '^trc-[a-f0-9]{64}$'),
    decision_ref            text NOT NULL CHECK (length(btrim(decision_ref)) > 0),
    requirement_ids         jsonb NOT NULL CHECK (
                                jsonb_typeof(requirement_ids) = 'array'
                                AND jsonb_array_length(requirement_ids) > 0),
    policy_versions         jsonb NOT NULL CHECK (
                                jsonb_typeof(policy_versions) = 'object'
                                AND policy_versions <> '{}'::jsonb),
    feature_versions        jsonb NOT NULL CHECK (
                                jsonb_typeof(feature_versions) = 'object'
                                AND feature_versions <> '{}'::jsonb),
    model_versions          jsonb NOT NULL CHECK (
                                jsonb_typeof(model_versions) = 'object'
                                AND model_versions <> '{}'::jsonb),
    tool_versions           jsonb NOT NULL CHECK (
                                jsonb_typeof(tool_versions) = 'object'
                                AND tool_versions <> '{}'::jsonb),
    provider_versions       jsonb NOT NULL CHECK (
                                jsonb_typeof(provider_versions) = 'object'
                                AND provider_versions <> '{}'::jsonb),
    adapter_versions        jsonb NOT NULL CHECK (
                                jsonb_typeof(adapter_versions) = 'object'
                                AND adapter_versions <> '{}'::jsonb),
    artifact_versions       jsonb NOT NULL CHECK (
                                jsonb_typeof(artifact_versions) = 'object'
                                AND artifact_versions <> '{}'::jsonb),
    test_release_id         text NOT NULL CHECK (length(btrim(test_release_id)) > 0),
    conformance_release_id  text NOT NULL CHECK (length(btrim(conformance_release_id)) > 0),
    manifest_sha256         text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
    release_report_id       text NOT NULL CHECK (length(btrim(release_report_id)) > 0),
    recorded_at             timestamptz NOT NULL
);

CREATE INDEX decision_traces_ref_time_idx
    ON trace.decision_traces (decision_ref, recorded_at DESC);

CREATE TRIGGER decision_traces_immutable
    BEFORE UPDATE OR DELETE ON trace.decision_traces
    FOR EACH ROW EXECUTE FUNCTION trace.refuse_mutation();

CREATE TRIGGER decision_traces_immutable_truncate
    BEFORE TRUNCATE ON trace.decision_traces
    FOR EACH STATEMENT EXECUTE FUNCTION trace.refuse_mutation();
