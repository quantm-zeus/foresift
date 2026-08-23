-- g0_dr_0004_tier_measurement_incident_fk.sql
-- Referential closure for tier measurements (FR-DR-001): every incident_id
-- recorded on a tier measurement must reference an existing recovery incident.
-- Declared here rather than in g0_dr_0001 because recovery_incidents is
-- created later (g0_dr_0003) and migrations apply in lexicographic order.

ALTER TABLE tier_measurements
    ADD CONSTRAINT tier_measurements_incident_fk
    FOREIGN KEY (incident_id) REFERENCES recovery_incidents(incident_id);
