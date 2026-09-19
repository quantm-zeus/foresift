-- @requirement FR-TRACE-005
-- Apply as one transaction. Rollback: DROP TABLE trace.decision_traces.
CREATE TABLE trace.decision_traces (
  trace_id text PRIMARY KEY CHECK (trace_id ~ '^sha256:[0-9a-f]{64}$'),
  decision_ref text NOT NULL,
  recorded_at timestamptz NOT NULL,
  requirement_ids jsonb NOT NULL CHECK (jsonb_typeof(requirement_ids) = 'array'),
  policy_versions jsonb NOT NULL CHECK (jsonb_typeof(policy_versions) = 'object'),
  feature_versions jsonb NOT NULL CHECK (jsonb_typeof(feature_versions) = 'object'),
  model_versions jsonb NOT NULL CHECK (jsonb_typeof(model_versions) = 'object'),
  provider_versions jsonb NOT NULL CHECK (jsonb_typeof(provider_versions) = 'object'),
  adapter_versions jsonb NOT NULL CHECK (jsonb_typeof(adapter_versions) = 'object'),
  artifact_versions jsonb NOT NULL CHECK (jsonb_typeof(artifact_versions) = 'object'),
  tool_name text NOT NULL,
  tool_version text NOT NULL,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  release_report_id text NOT NULL,
  UNIQUE (decision_ref, recorded_at, trace_id)
);

CREATE INDEX decision_traces_point_in_time
  ON trace.decision_traces (decision_ref, recorded_at DESC, trace_id DESC);
CREATE TRIGGER decision_traces_append_only BEFORE UPDATE OR DELETE ON trace.decision_traces
  FOR EACH ROW EXECUTE FUNCTION trace.refuse_mutation();
CREATE TRIGGER decision_traces_no_truncate BEFORE TRUNCATE ON trace.decision_traces
  FOR EACH STATEMENT EXECUTE FUNCTION trace.refuse_mutation();
