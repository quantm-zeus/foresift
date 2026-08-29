-- g0_col_0003_incidents_decodescope.sql
-- Rollback: DROP TABLE col.collector_decode_pauses;
--           DROP TABLE col.collector_incidents;
-- Scoped collector decoding incidents and pauses (FR-COL-007, §63.4).
--
-- A decoding pause is deliberately keyed by decoder/program/program-version:
-- there is no global scope value to select. Raw collection therefore remains
-- independent while derived facts for the affected decoder scope stay blocked
-- until an explicit revalidation instant is recorded.

CREATE SCHEMA IF NOT EXISTS col;

CREATE TABLE col.collector_incidents (
    incident_id       text PRIMARY KEY,
    kind              text NOT NULL CHECK (kind IN (
                          'PROGRAM_UPGRADE',
                          'DECODER_DRIFT',
                          'ACCOUNT_LAYOUT_CHANGE',
                          'UNKNOWN_INSTRUCTION_VARIANT',
                          'PARITY_FAILURE')),
    decoder_version   text NOT NULL CHECK (length(decoder_version) > 0),
    program_id        text NOT NULL CHECK (length(program_id) > 0),
    program_version   text NOT NULL CHECK (length(program_version) > 0),
    opened_at         timestamptz NOT NULL,
    status            text NOT NULL DEFAULT 'OPEN' CHECK (status IN (
                          'OPEN', 'REVALIDATING', 'RESOLVED')),
    evidence_refs     jsonb NOT NULL CHECK (
                          jsonb_typeof(evidence_refs) = 'array'
                          AND jsonb_array_length(evidence_refs) >= 1),
    audit_chain_ref   text NOT NULL CHECK (length(audit_chain_ref) > 0),
    revalidated_at    timestamptz,
    resolved_at       timestamptz,
    resolution_notes  text,
    -- This composite candidate key lets a pause prove both that it cites its
    -- opening incident and that the incident describes the exact same failure
    -- kind and decode scope.
    CONSTRAINT collector_incidents_scope_key UNIQUE (
        incident_id, kind, decoder_version, program_id, program_version),
    CONSTRAINT collector_incidents_revalidation_after_opening CHECK (
        revalidated_at IS NULL OR revalidated_at >= opened_at),
    CONSTRAINT collector_incidents_resolution_after_opening CHECK (
        resolved_at IS NULL OR resolved_at >= opened_at),
    CONSTRAINT collector_incidents_resolved_requires_revalidation CHECK (
        status <> 'RESOLVED'
        OR (revalidated_at IS NOT NULL AND resolved_at IS NOT NULL)),
    CONSTRAINT collector_incidents_unresolved_has_no_resolution CHECK (
        status = 'RESOLVED' OR resolved_at IS NULL),
    CONSTRAINT collector_incidents_resolution_after_revalidation CHECK (
        resolved_at IS NULL OR resolved_at >= revalidated_at)
);

CREATE INDEX collector_incidents_scope_status_idx
    ON col.collector_incidents (decoder_version, program_id, program_version, status);

CREATE TABLE col.collector_decode_pauses (
    pause_id             text PRIMARY KEY,
    decoder_version      text NOT NULL CHECK (length(decoder_version) > 0),
    program_id           text NOT NULL CHECK (length(program_id) > 0),
    program_version      text NOT NULL CHECK (length(program_version) > 0),
    reason               text NOT NULL CHECK (reason IN (
                             'PROGRAM_UPGRADE',
                             'DECODER_DRIFT',
                             'ACCOUNT_LAYOUT_CHANGE',
                             'UNKNOWN_INSTRUCTION_VARIANT',
                             'PARITY_FAILURE')),
    opening_incident_id  text NOT NULL,
    paused_at            timestamptz NOT NULL,
    -- Raw receipt is independent of decoding and must remain admitted while
    -- the affected derived-fact path is paused.
    raw_events_preserved boolean NOT NULL DEFAULT true CHECK (raw_events_preserved),
    revalidation_state   text NOT NULL DEFAULT 'PAUSED' CHECK (
                             revalidation_state IN (
                                 'PAUSED', 'REVALIDATING', 'REVALIDATED')),
    revalidated_at       timestamptz,
    -- Consumers may emit derived facts only in ALLOWED state. The coherence
    -- CHECK below makes ALLOWED impossible before explicit revalidation.
    derived_facts_state  text NOT NULL DEFAULT 'BLOCKED' CHECK (
                             derived_facts_state IN ('BLOCKED', 'ALLOWED')),
    FOREIGN KEY (
        opening_incident_id, reason, decoder_version, program_id, program_version)
        REFERENCES col.collector_incidents (
            incident_id, kind, decoder_version, program_id, program_version),
    CONSTRAINT collector_decode_pauses_revalidation_instant CHECK (
        (revalidation_state = 'REVALIDATED') = (revalidated_at IS NOT NULL)),
    CONSTRAINT collector_decode_pauses_revalidation_after_pause CHECK (
        revalidated_at IS NULL OR revalidated_at >= paused_at),
    CONSTRAINT collector_decode_pauses_derived_facts_gate CHECK (
        (derived_facts_state = 'ALLOWED') =
        (revalidation_state = 'REVALIDATED'))
);

-- At most one not-yet-revalidated pause may block a decoding scope. A new
-- incident can be represented after the previous pause has been revalidated.
CREATE UNIQUE INDEX collector_decode_pauses_active_scope_idx
    ON col.collector_decode_pauses (decoder_version, program_id, program_version)
    WHERE revalidation_state <> 'REVALIDATED';
