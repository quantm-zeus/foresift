-- @requirement FR-TRACE-005
CREATE TABLE trace.decision_traces (
  trace_id text PRIMARY KEY,
  decision_ref text NOT NULL UNIQUE,
  requirement_ids jsonb NOT NULL,
  policy_versions jsonb NOT NULL,
  feature_versions jsonb NOT NULL,
  model_versions jsonb NOT NULL,
  tool_versions jsonb NOT NULL,
  provider_versions jsonb NOT NULL,
  adapter_versions jsonb NOT NULL,
  artifact_versions jsonb NOT NULL,
  test_release_id text NOT NULL,
  conformance_release_id text NOT NULL,
  manifest_sha256 text NOT NULL,
  release_report_id text NOT NULL,
  recorded_at timestamptz NOT NULL
);

CREATE TRIGGER decision_traces_insert_only BEFORE UPDATE OR DELETE ON trace.decision_traces
FOR EACH ROW EXECUTE FUNCTION trace.refuse_mutation();
