-- g2_prod_0003_mcp_compat.sql
-- §69.7 MCP protocol-revision/target-client compatibility matrix and the
-- recorded conformance runs (FR-PROD-005, AC-144).
--
-- Additive only; no ALTER of a foreign family. All tables live in the dedicated
-- `prod` schema (ADR-G2PROD-1).

-- --- §69.7 protocol revisions -----------------------------------------------

-- One protocol revision row: channel (STABLE/DRAFT), SDK/package version,
-- transport mode, Origin-policy reference, and the mutually tested default
-- flag. A draft/release-candidate revision can NEVER be the default; at most
-- one revision is default (partial unique index below). `superseded_by` links
-- a replacement rather than rewriting history.
CREATE TABLE IF NOT EXISTS prod.mcp_revisions (
    revision          text PRIMARY KEY CHECK (length(revision) > 0),
    channel           text NOT NULL CHECK (channel IN ('STABLE', 'DRAFT')),
    sdk_version       text NOT NULL CHECK (length(sdk_version) > 0),
    transport         text NOT NULL CHECK (length(transport) > 0),
    origin_policy_ref text NOT NULL CHECK (length(origin_policy_ref) > 0),
    is_default        boolean NOT NULL DEFAULT false,
    superseded_by     text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mcp_revisions_no_draft_default CHECK (NOT (is_default AND channel = 'DRAFT')),
    CONSTRAINT mcp_revisions_superseded_by_fk
        FOREIGN KEY (superseded_by) REFERENCES prod.mcp_revisions(revision),
    CONSTRAINT mcp_revisions_no_self_supersede CHECK (
        superseded_by IS NULL OR superseded_by <> revision
    )
);

-- At most ONE default revision: draft revisions are additionally excluded by
-- the CHECK above, so the server can never silently serve an untested revision.
CREATE UNIQUE INDEX IF NOT EXISTS mcp_revisions_single_default_idx
    ON prod.mcp_revisions (is_default) WHERE is_default;

-- --- §69.7 target clients ---------------------------------------------------

CREATE TABLE IF NOT EXISTS prod.mcp_target_clients (
    client_id    text PRIMARY KEY CHECK (length(client_id) > 0),
    client_name  text NOT NULL CHECK (length(client_name) > 0),
    version      text NOT NULL CHECK (length(version) > 0),
    capabilities jsonb NOT NULL CHECK (jsonb_typeof(capabilities) = 'object'),
    auth_mode    text NOT NULL CHECK (length(auth_mode) > 0)
);

-- --- §69.7 compatibility matrix ---------------------------------------------

-- protocol revision × SDK/package version × transport × Origin policy × target
-- client × auth mode × conformance fixture × live-test date × result. A cell is
-- usable only with a PASS result and a non-stale live-test date; `(revision,
-- client_id)` is unique so an untested duplicate can never be mistaken for a
-- tested one.
CREATE TABLE IF NOT EXISTS prod.mcp_compatibility_matrix (
    cell_id                 text PRIMARY KEY CHECK (length(cell_id) > 0),
    revision                text NOT NULL CHECK (length(revision) > 0),
    client_id               text NOT NULL CHECK (length(client_id) > 0),
    conformance_fixture_ref text NOT NULL CHECK (length(conformance_fixture_ref) > 0),
    live_test_date          timestamptz NOT NULL,
    result                  text NOT NULL CHECK (result IN ('PASS', 'FAIL')),
    notes                   text,
    CONSTRAINT mcp_compatibility_matrix_revision_fk
        FOREIGN KEY (revision) REFERENCES prod.mcp_revisions(revision),
    CONSTRAINT mcp_compatibility_matrix_client_fk
        FOREIGN KEY (client_id) REFERENCES prod.mcp_target_clients(client_id),
    CONSTRAINT mcp_compatibility_matrix_revision_client_unique UNIQUE (revision, client_id)
);

CREATE INDEX IF NOT EXISTS mcp_compatibility_matrix_client_idx
    ON prod.mcp_compatibility_matrix (client_id, result);

-- --- §69.7 conformance runs -------------------------------------------------

CREATE TABLE IF NOT EXISTS prod.mcp_conformance_runs (
    run_id     text PRIMARY KEY CHECK (length(run_id) > 0),
    revision   text NOT NULL CHECK (length(revision) > 0),
    client_id  text NOT NULL CHECK (length(client_id) > 0),
    fixture_ref text NOT NULL CHECK (length(fixture_ref) > 0),
    result     text NOT NULL CHECK (result IN ('PASS', 'FAIL')),
    ran_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mcp_conformance_runs_revision_fk
        FOREIGN KEY (revision) REFERENCES prod.mcp_revisions(revision),
    CONSTRAINT mcp_conformance_runs_client_fk
        FOREIGN KEY (client_id) REFERENCES prod.mcp_target_clients(client_id)
);

CREATE INDEX IF NOT EXISTS mcp_conformance_runs_cell_idx
    ON prod.mcp_conformance_runs (revision, client_id, ran_at);
