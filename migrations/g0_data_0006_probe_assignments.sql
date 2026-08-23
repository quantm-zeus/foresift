-- g0_data_0006_probe_assignments.sql
-- AC-243 write-before-outcome storage for randomized evidence probes:
-- eligibility stratum, nonzero assignment probability, seed provenance,
-- selection timestamp, and requested fields are persisted BEFORE retrieval
-- completion / outcome maturity. One assignment per acquisition decision.

CREATE TABLE probe_assignments (
    decision_id            text PRIMARY KEY REFERENCES evidence_acquisition_decisions(decision_id),
    eligibility_stratum    text NOT NULL,
    -- Bounds mirror the domain/repo/Zod layers exactly: a probability is in
    -- (0, 1); certainty (>= 1) is not a randomized assignment.
    assignment_probability double precision NOT NULL
        CHECK (assignment_probability > 0 AND assignment_probability < 1),
    -- Provenance of the random seed (algorithm + material reference), never
    -- the raw secret material itself.
    seed_provenance        text NOT NULL,
    selection_at           timestamptz NOT NULL,
    requested_fields       text[] NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT probe_assignments_seed_not_raw_material
        CHECK (seed_provenance NOT LIKE 'raw:%')
);
