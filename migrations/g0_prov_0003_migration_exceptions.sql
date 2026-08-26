-- g0_prov_0003_migration_exceptions.sql
-- Time-bounded migration exceptions bound to approved replacement plans
-- (FR-PROV-003).
--
-- Rules encoded here:
--   * every exception names an approver, a reason, and a replacement-plan
--     reference — an exception without an approved replacement plan cannot
--     exist.
--   * exception_expires_at must lie strictly after created_at (SQL CHECK);
--     expiry is evaluated at USE time against the injected clock — lapsed or
--     revoked exceptions authorize nothing, with NO grace window.
--   * at most ONE active (never-revoked) exception per operation version:
--     partial unique index over unrevoked rows.

CREATE TABLE prov.prov_migration_exceptions (
    exception_id         text PRIMARY KEY,
    provider_id          text NOT NULL,
    operation_id         text NOT NULL,
    operation_version    text NOT NULL,
    approver             text NOT NULL,
    reason               text NOT NULL CHECK (length(reason) > 0),
    replacement_plan_id  text NOT NULL,
    replacement_plan     jsonb,
    created_at           timestamptz NOT NULL,
    exception_expires_at timestamptz NOT NULL,
    revoked_at           timestamptz,
    revoked_by           text,
    FOREIGN KEY (provider_id, operation_id, operation_version)
        REFERENCES prov.prov_operations (provider_id, operation_id, version),
    CONSTRAINT prov_migration_exception_window CHECK (
        exception_expires_at > created_at),
    CONSTRAINT prov_migration_exception_revocation_complete CHECK (
        (revoked_at IS NULL) = (revoked_by IS NULL))
);

-- One live exception per operation version at a time.
CREATE UNIQUE INDEX prov_migration_exceptions_single_active
    ON prov.prov_migration_exceptions (provider_id, operation_id, operation_version)
    WHERE revoked_at IS NULL;
