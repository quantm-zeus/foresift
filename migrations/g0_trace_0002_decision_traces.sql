-- Complete, point-in-time, insert-only authorization trace. FR-TRACE-005.
CREATE TABLE trace.decision_traces (
    trace_id                 text PRIMARY KEY,
    decision_ref             text NOT NULL UNIQUE,
    requirement_ids          jsonb NOT NULL,
    policy_versions          jsonb NOT NULL,
    feature_versions         jsonb NOT NULL,
    model_versions           jsonb NOT NULL,
    tool_versions            jsonb NOT NULL,
    provider_versions        jsonb NOT NULL,
    adapter_versions         jsonb NOT NULL,
    artifact_versions        jsonb NOT NULL,
    test_release_id          text NOT NULL,
    conformance_release_id   text NOT NULL,
    manifest_sha256          text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
    release_report_id        text NOT NULL,
    recorded_at              timestamptz NOT NULL
);

CREATE INDEX decision_traces_recorded_idx ON trace.decision_traces (recorded_at);

CREATE TRIGGER decision_traces_append_only
    BEFORE UPDATE OR DELETE ON trace.decision_traces
    FOR EACH ROW EXECUTE FUNCTION trace.refuse_mutation();
