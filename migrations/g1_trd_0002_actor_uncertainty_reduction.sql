-- g1_trd_0002_actor_uncertainty_reduction.sql
-- FR-TRD-004: persist the deterministic actor-attribution reduction exposed to features.

ALTER TABLE economic_trade_events
    DROP CONSTRAINT economic_trade_events_actor_resolution_state_check;

-- Historical rows predate actor-attribution reduction and are explicitly degraded.
UPDATE economic_trade_events
SET actor_resolution_state = 'PARTIAL'
WHERE actor_resolution_state = 'PARTIALLY_RESOLVED';

UPDATE economic_trade_events
SET quality_codes = array_append(array_remove(quality_codes, 'VALID'), 'PARTIAL')
WHERE actor_resolution_state = 'PARTIAL'
  AND NOT ('PARTIAL' = ANY(quality_codes));

UPDATE economic_trade_events
SET quality_codes = array_append(
    array_remove(quality_codes, 'VALID'),
    'SYSTEM_ADDRESS_UNCERTAIN'
)
WHERE actor_resolution_state = 'UNRESOLVED'
  AND NOT ('SYSTEM_ADDRESS_UNCERTAIN' = ANY(quality_codes));

ALTER TABLE economic_trade_events
    ADD CONSTRAINT economic_trade_events_actor_resolution_state_check
        CHECK (actor_resolution_state IN ('RESOLVED', 'PARTIAL', 'UNRESOLVED')),
    ADD COLUMN actor_resolution_confidence double precision NOT NULL DEFAULT 0
        CHECK (actor_resolution_confidence BETWEEN 0 AND 1),
    ADD COLUMN actor_uncertainty_factor double precision NOT NULL DEFAULT 0
        CHECK (actor_uncertainty_factor BETWEEN 0 AND 1),
    ADD COLUMN contribution_factor double precision NOT NULL DEFAULT 0
        CHECK (contribution_factor BETWEEN 0 AND 1),
    ADD CONSTRAINT economic_trade_events_actor_uncertainty_factor_matches_resolution
        CHECK (
            actor_uncertainty_factor = CASE actor_resolution_state
                WHEN 'RESOLVED' THEN actor_resolution_confidence
                WHEN 'PARTIAL' THEN 0.6 * actor_resolution_confidence
                WHEN 'UNRESOLVED' THEN 0.25 * actor_resolution_confidence
            END
        ),
    ADD CONSTRAINT economic_trade_events_contribution_factor_matches_uncertainty
        CHECK (contribution_factor = actor_uncertainty_factor),
    ADD CONSTRAINT economic_trade_events_actor_resolution_quality
        CHECK (
            (actor_resolution_state = 'RESOLVED')
            OR (actor_resolution_state = 'PARTIAL' AND 'PARTIAL' = ANY(quality_codes))
            OR (
                actor_resolution_state = 'UNRESOLVED'
                AND 'SYSTEM_ADDRESS_UNCERTAIN' = ANY(quality_codes)
            )
        );
