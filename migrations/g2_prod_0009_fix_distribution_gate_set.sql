-- g2_prod_0009_fix_distribution_gate_set.sql
-- Corrective migration: the 0006 evidence trigger appended the §69.9
-- distribution gate with `required_gates || 'DISTRIBUTION_EVIDENCE'`. In
-- PostgreSQL `text[] || unknown` resolves to `anyarray || anyarray`, so the
-- literal was parsed as an array literal and EVERY ACTIVE insert with
-- activation_kind WORKSPACE/PUBLIC aborted with
--   ERROR: malformed array literal: "DISTRIBUTION_EVIDENCE"
-- which made the entire §69.9 workspace/public activation path (FR-PROD-002,
-- AC-272/273/275/276/277) impossible to persist and was covered by no test.
--
-- `g2_prod_0006` is already applied on canonical main, so it is immutable: this
-- migration lands the corrected trigger function as a new, later-sorting
-- `g2_prod_0009` (per the plan's out-of-order law) and changes nothing else.
-- The corrected body is byte-identical to 0006 except for the single
-- `array_append` call.

CREATE OR REPLACE FUNCTION prod.foresift_prod_require_activation_evidence() RETURNS trigger AS $fn$
DECLARE
    -- The full ordered §69.4/§69.5/§69.9 gate set. Every kind's `requiredGates`
    -- is a subsequence of this list, and every gate outside the kind's set must
    -- be recorded NOT_APPLICABLE — a PASS there is a forged placeholder (C1).
    canonical_gates text[] := ARRAY[
        'IMPLEMENTED_PRESENT',
        'AVAILABLE_EVIDENCE',
        'PROVEN_PRESENT',
        'STATISTICAL_EVIDENCE_SCOPE',
        'NEGATIVE_CONTROLS',
        'CLUSTERED_INTERVALS',
        'CALIBRATION_MATURITY',
        'VERIFIED_GATE_EVIDENCE',
        'CAPACITY_CONTRACT',
        'DISTRIBUTION_EVIDENCE',
        'NO_OPEN_CONTAINMENT'
    ];
    required_gates text[];
    missing_gate text;
    duplicated_gate text;
    refusing_gate text;
    forged_gate text;
    proven_row_missing boolean;
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'module states are append-only: ACTIVE activation evidence can never be deleted or truncated'
            USING ERRCODE = 'restrict_violation';
    END IF;
    -- Only a row that is (or becomes) ACTIVE is guarded.
    IF NEW.lifecycle_state IS DISTINCT FROM 'ACTIVE' THEN
        RETURN NEW;
    END IF;
    -- An UPDATE of an already-ACTIVE row re-runs no transition; the
    -- append-only rewrite trigger governs that path.
    IF TG_OP = 'UPDATE' AND OLD.lifecycle_state IS NOT DISTINCT FROM 'ACTIVE' THEN
        RETURN NEW;
    END IF;
    -- C2: an empty activation event reference is NOT a reference. The 0001
    -- constraint only refuses NULL, so the empty string was a reachable bypass
    -- of every check below. A NULL reference is still left to that constraint so
    -- its stable constraint name remains the refusal evidence.
    IF NEW.activation_event_ref IS NULL THEN
        RETURN NEW;
    END IF;
    IF length(NEW.activation_event_ref) = 0 THEN
        RAISE EXCEPTION 'ACTIVE requires a non-empty activation event reference: an empty string is not an activation event'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.activation_kind IS NULL THEN
        RAISE EXCEPTION 'ACTIVE requires the activation kind its gate evaluations were persisted against'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.scope_hash IS NULL THEN
        RAISE EXCEPTION 'ACTIVE requires the exact scope hash its gate evaluations were persisted against'
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- The kind's required gate set. OPERATIONAL is §69.4; OPPORTUNITY adds the
    -- §69.5 statistical gates and PROVEN exactly when the exact scope demands
    -- it; WORKSPACE/PUBLIC add the §69.9 distribution gate.
    required_gates := ARRAY[
        'IMPLEMENTED_PRESENT',
        'AVAILABLE_EVIDENCE',
        'VERIFIED_GATE_EVIDENCE',
        'CAPACITY_CONTRACT',
        'NO_OPEN_CONTAINMENT'
    ];
    -- PROVEN is required exactly when the exact scope specifies it, for EVERY
    -- activation kind (audit H5 residual): an OPERATIONAL evaluation must not
    -- skip the PROVEN precondition of a requires_proven scope.
    IF (NEW.scope ->> 'requires_proven') = 'true' THEN
        required_gates := array_append(required_gates, 'PROVEN_PRESENT');
    END IF;
    IF NEW.activation_kind IN ('OPPORTUNITY', 'WORKSPACE', 'PUBLIC') THEN
        required_gates := required_gates || ARRAY[
            'STATISTICAL_EVIDENCE_SCOPE',
            'NEGATIVE_CONTROLS',
            'CLUSTERED_INTERVALS',
            'CALIBRATION_MATURITY'
        ];
    END IF;
    IF NEW.activation_kind IN ('WORKSPACE', 'PUBLIC') THEN
        required_gates := array_append(required_gates, 'DISTRIBUTION_EVIDENCE');
    END IF;

    -- A later REFUSE re-evaluation invalidates an older PASS for the same
    -- scope, event AND kind (audit H6: refusals are persisted too).
    SELECT e.gate_kind INTO refusing_gate
      FROM prod.activation_gate_evaluations e
     WHERE e.scope_hash = NEW.scope_hash
       AND e.activation_event_ref = NEW.activation_event_ref
       AND e.activation_kind = NEW.activation_kind
       AND e.verdict = 'REFUSE'
     LIMIT 1;
    IF refusing_gate IS NOT NULL THEN
        RAISE EXCEPTION 'ACTIVE requires an all-PASS persisted gate evaluation set: % refused for this activation event', refusing_gate
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- A requires_proven scope may ONLY reach ACTIVE when the exact scope's
    -- governed HISTORY actually reached PROVEN (audit H5 residual): a forged
    -- PROVEN_PRESENT evaluation PASS is not a persisted PROVEN state.
    IF (NEW.scope ->> 'requires_proven') = 'true' THEN
        SELECT NOT EXISTS (
            SELECT 1 FROM prod.module_states s
             WHERE s.module_id = NEW.module_id
               AND s.scope_hash = NEW.scope_hash
               AND s.lifecycle_state = 'PROVEN'
        ) INTO proven_row_missing;
        IF proven_row_missing THEN
            RAISE EXCEPTION 'ACTIVE requires a persisted PROVEN state for the exact scope: the scope specifies requires_proven but no governed PROVEN row exists'
                USING ERRCODE = 'restrict_violation';
        END IF;
    END IF;

    -- C1: a PASS is only admissible for a gate the kind actually requires. A
    -- PASS recorded for a skipped gate is the forged placeholder this correction
    -- removes, and it can never satisfy the missing/duplicate checks below.
    SELECT g INTO forged_gate
      FROM unnest(canonical_gates) AS g
     WHERE NOT (g = ANY (required_gates))
       AND EXISTS (
            SELECT 1 FROM prod.activation_gate_evaluations e
             WHERE e.scope_hash = NEW.scope_hash
               AND e.activation_event_ref = NEW.activation_event_ref
               AND e.activation_kind = NEW.activation_kind
               AND e.gate_kind = g
               AND e.verdict = 'PASS'
       )
     LIMIT 1;
    IF forged_gate IS NOT NULL THEN
        RAISE EXCEPTION 'ACTIVE requires evidence only for the gates activation kind % requires: gate % was recorded PASS although it is not required', NEW.activation_kind, forged_gate
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- Exactly one PASS per required gate, unexpired at insert time, for THIS kind.
    SELECT e.gate_kind INTO duplicated_gate
      FROM prod.activation_gate_evaluations e
     WHERE e.scope_hash = NEW.scope_hash
       AND e.activation_event_ref = NEW.activation_event_ref
       AND e.activation_kind = NEW.activation_kind
       AND e.gate_kind = ANY (required_gates)
       AND e.verdict = 'PASS'
       AND e.failing_gate IS NULL
       AND e.expires_at > now()
     GROUP BY e.gate_kind
    HAVING count(*) <> 1
     LIMIT 1;
    IF duplicated_gate IS NOT NULL THEN
        RAISE EXCEPTION 'ACTIVE requires exactly one unexpired PASS row for persisted gate %', duplicated_gate
            USING ERRCODE = 'restrict_violation';
    END IF;
    SELECT g INTO missing_gate
      FROM unnest(required_gates) AS g
     WHERE NOT EXISTS (
        SELECT 1 FROM prod.activation_gate_evaluations e
         WHERE e.scope_hash = NEW.scope_hash
           AND e.activation_event_ref = NEW.activation_event_ref
           AND e.activation_kind = NEW.activation_kind
           AND e.gate_kind = g
           AND e.verdict = 'PASS'
           AND e.failing_gate IS NULL
           AND e.expires_at > now()
     )
     LIMIT 1;
    IF missing_gate IS NOT NULL THEN
        RAISE EXCEPTION 'ACTIVE requires a complete, unexpired, all-PASS persisted gate evaluation set for kind %: missing gate %', NEW.activation_kind, missing_gate
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS public.foresift_prod_require_activation_evidence();
