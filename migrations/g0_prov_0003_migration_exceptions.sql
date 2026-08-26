-- g0_prov_0003_migration_exceptions.sql
-- Time-bounded migration exceptions with replacement plans (FR-PROV-003;
-- AC-270 negative paths).
--
-- Rules encoded here:
--   * exception_expires_at > created_at at the storage layer; use-time
--     validity (expired or revoked ⇒ authorize nothing) is evaluated against
--     the injected clock in migration-exceptions.ts — fail-closed, no grace
--     windows anywhere.
--   * revocation is paired: revoked_at and revoked_by are set or unset
--     together.

CREATE TABLE prov.prov_migration_exceptions (
    exception_id         text PRIMARY KEY,
    provider_id          text NOT NULL,
    operation_id         text NOT NULL,
    operation_version    text NOT NULL,
    approver             text NOT NULL,
    replacement_plan_ref text NOT NULL,
    reason               text NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    exception_expires_at timestamptz NOT NULL,
    revoked_at           timestamptz,
    revoked_by           text,
    FOREIGN KEY (provider_id, operation_id, operation_version)
        REFERENCES prov.prov_operations(provider_id, operation_id, version),
    CONSTRAINT prov_migration_exceptions_expiry CHECK (
        exception_expires_at > created_at),
    CONSTRAINT prov_migration_exceptions_revocation_pair CHECK (
        (revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE INDEX prov_migration_exceptions_op_idx
    ON prov.prov_migration_exceptions (provider_id, operation_id, operation_version);
