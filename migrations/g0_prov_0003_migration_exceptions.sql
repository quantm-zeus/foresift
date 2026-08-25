-- g0_prov_0003_migration_exceptions.sql
-- Time-bounded migration exceptions with approved replacement plans
-- (FR-PROV-003; §15.4 rule 1 escape hatch).
--
-- Rules encoded here:
--   * exception_expires_at must be strictly after granted_at (CHECK).
--   * revocation is a column write of revoked_at; revoked exceptions
--     authorize nothing.
--   * Expired or revoked exceptions are refused at USE TIME against the
--     injected clock (fail-closed; no grace windows) — SQL stores truth,
--     the engine decides validity.

CREATE TABLE prov.prov_migration_exceptions (
    exception_id             text PRIMARY KEY,
    provider_id              text NOT NULL,
    operation_id             text NOT NULL,
    approver                 text NOT NULL,
    replacement_plan_ref     text NOT NULL,
    replacement_operation_id text,
    granted_at               timestamptz NOT NULL,
    exception_expires_at     timestamptz NOT NULL,
    revoked_at               timestamptz,
    evidence_refs            jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array'
                                                    AND jsonb_array_length(evidence_refs) >= 1),
    CONSTRAINT prov_migration_exceptions_window
      CHECK (exception_expires_at > granted_at),
    CONSTRAINT prov_migration_exceptions_revoked_after_grant
      CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

CREATE INDEX prov_migration_exceptions_op_idx
    ON prov.prov_migration_exceptions (provider_id, operation_id);
