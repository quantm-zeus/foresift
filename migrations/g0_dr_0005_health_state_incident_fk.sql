-- g0_dr_0005_health_state_incident_fk.sql
-- Referential closure for recovery health states (FR-DR-001, AC-262): every
-- incident_id carried by a recovery_health_states row must reference an
-- existing recovery incident, so a machine-readable degraded-capability state
-- stays traceable to the incident that caused it. Declared here rather than
-- in g0_dr_0002 because recovery_incidents is created later (g0_dr_0003) and
-- migrations apply in lexicographic order — the same pattern as
-- g0_dr_0004_tier_measurement_incident_fk for tier_measurements.
-- The application layer additionally refuses degraded states whose incident
-- reference is absent BEFORE the database sees them (repos/recovery.ts); this
-- constraint closes the remaining hole: an incident reference that is present
-- but points at no durable incident.

ALTER TABLE recovery_health_states
    ADD CONSTRAINT recovery_health_states_incident_fk
    FOREIGN KEY (incident_id) REFERENCES recovery_incidents(incident_id);
