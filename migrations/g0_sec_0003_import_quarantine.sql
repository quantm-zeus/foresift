-- g0_sec_0003_import_quarantine.sql
-- Alpha Lab import quarantine state machine (FR-SEC-008, §35.14, ADR-044/046).
--
-- Rules encoded here:
--   * the state VOCABULARY is CHECK-pinned and contains NO ACTIVE state —
--     imported artifacts can never directly activate policy. Terminal states
--     are exactly REJECTED | SHADOW_ELIGIBLE.
--   * transition legality (RECEIVED→QUARANTINED→SCANNED→VALIDATING→terminal)
--     is enforced by the typed repository layer; SQL pins rank monotonicity
--     via the recorded state rank so a row can never record an earlier-rank
--     state than one already observed (state_rank + prior_state_rank columns).
--   * every intake carries its step-up approval reference — imports are a
--     high-impact admin action (FR-SEC-001 coupling).
--   * scan findings are child rows preserved as evidence.

CREATE TABLE sec.import_artifacts (
    artifact_id          text PRIMARY KEY,
    manifest_sha256      text NOT NULL CHECK (manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
    producer_key_id      text NOT NULL,
    format               text NOT NULL CHECK (format IN (
                            'VERSIONED_JSON',
                            'VERSIONED_JSONL',
                            'PARQUET',
                            'APPROVED_COMPRESSED_CONTAINER')),
    byte_size            bigint NOT NULL CHECK (byte_size > 0),
    state                text NOT NULL DEFAULT 'RECEIVED' CHECK (state IN (
                            'RECEIVED',
                            'QUARANTINED',
                            'SCANNED',
                            'VALIDATING',
                            'REJECTED',
                            'SHADOW_ELIGIBLE')),
    state_rank           integer NOT NULL CHECK (state_rank BETWEEN 0 AND 4),
    prior_state_rank     integer NOT NULL DEFAULT -1,
    step_up_approval_ref text NOT NULL,
    received_at          timestamptz NOT NULL,
    state_changed_at     timestamptz NOT NULL,
    CONSTRAINT import_artifacts_rank_monotonic CHECK (state_rank >= prior_state_rank),
    CONSTRAINT import_artifacts_received_initial CHECK (
        state <> 'RECEIVED' OR state_rank = 0)
);

CREATE TABLE sec.import_scan_findings (
    finding_id   text PRIMARY KEY,
    artifact_id  text NOT NULL REFERENCES sec.import_artifacts(artifact_id),
    scanner      text NOT NULL CHECK (scanner IN (
                    'FORMAT_INSPECTION', 'PATH_ANALYSIS', 'CONTENT_SCAN', 'SIGNATURE_CHECK')),
    verdict      text NOT NULL CHECK (verdict IN ('CLEAN', 'SUSPICIOUS', 'MALICIOUS')),
    detail       text NOT NULL,
    recorded_at  timestamptz NOT NULL
);

CREATE INDEX import_scan_findings_artifact_idx ON sec.import_scan_findings (artifact_id);
