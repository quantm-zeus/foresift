-- g2_prod_0006_activation_kind.sql
-- Bind every activation-gate evaluation to the ACTIVATION KIND it decided, and
-- record gates outside that kind's required set as NOT_APPLICABLE — never as
-- PASS (emergency correction C1/H5; FR-PROD-001/002, AC-152/154/272).
--
-- Before this migration `evaluateActivationGate` pushed a real-looking `PASS`
-- for every gate it did not evaluate, the table stored no activation kind, and
-- the 0005 trigger demanded a "complete all-PASS set" of all eleven gates. An
-- OPERATIONAL evaluation therefore manufactured the statistical/distribution
-- evidence of an OPPORTUNITY/WORKSPACE/PUBLIC activation, at both the TypeScript
-- and the SQL layer.
--
-- Additive + corrective: no column, table or constraint from `g2_prod_0001..0005`
-- is dropped except the two verdict CHECKs this migration must widen to admit
-- `NOT_APPLICABLE`. The 0005 trigger function is replaced (CREATE OR REPLACE) so
-- the same trigger name keeps its meaning with the correct, per-kind law.
--
-- Upgrade safety: this migration sorts AFTER every migration already applied on
-- a pre-correction `main` database (its family is `g2_prod`, whose applied
-- high-water mark is `g2_prod_0005`), and it only ADDs columns/constraints to
-- the `prod` schema it owns, so the upgraded final schema is identical to a
-- fresh apply (pinned by packages/persistence/test/migrator.spec.ts).

-- --- activation kind on the evidence rows (audit C1) --------------------------

ALTER TABLE prod.activation_gate_evaluations
    ADD COLUMN IF NOT EXISTS activation_kind text;

DO $kind$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'prod'
           AND table_name = 'activation_gate_evaluations'
           AND column_name = 'activation_kind'
           AND is_nullable = 'YES'
    ) THEN
        -- No released database has rows here (the package is unreleased); a
        -- database that somehow does fails the migration closed rather than
        -- fabricating a kind for pre-correction placeholders.
        ALTER TABLE prod.activation_gate_evaluations
            ALTER COLUMN activation_kind SET NOT NULL;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'activation_gate_evaluations_kind_known'
           AND conrelid = 'prod.activation_gate_evaluations'::regclass
    ) THEN
        ALTER TABLE prod.activation_gate_evaluations
            ADD CONSTRAINT activation_gate_evaluations_kind_known
            CHECK (activation_kind IN ('OPERATIONAL', 'OPPORTUNITY', 'WORKSPACE', 'PUBLIC'));
    END IF;
END
$kind$;

-- --- widen the verdict CHECKs with NOT_APPLICABLE -----------------------------

DO $verdict$
DECLARE
    constraint_name text;
BEGIN
    -- Drop every CHECK on the evaluations table whose definition constrains
    -- `verdict`, regardless of the auto-generated name PostgreSQL chose.
    FOR constraint_name IN
        SELECT c.conname
          FROM pg_constraint c
         WHERE c.conrelid = 'prod.activation_gate_evaluations'::regclass
           AND c.contype = 'c'
           AND pg_get_constraintdef(c.oid) LIKE '%verdict%'
    LOOP
        EXECUTE format(
            'ALTER TABLE prod.activation_gate_evaluations DROP CONSTRAINT %I',
            constraint_name
        );
    END LOOP;
    ALTER TABLE prod.activation_gate_evaluations
        ADD CONSTRAINT activation_gate_evaluations_verdict_known
        CHECK (verdict IN ('PASS', 'REFUSE', 'NOT_APPLICABLE'));
    ALTER TABLE prod.activation_gate_evaluations
        ADD CONSTRAINT activation_gate_evaluations_verdict_consistency CHECK (
            (verdict = 'PASS' AND failing_gate IS NULL)
            OR (verdict = 'REFUSE' AND failing_gate IS NOT NULL)
            OR (verdict = 'NOT_APPLICABLE' AND failing_gate IS NULL)
        );
END
$verdict$;

-- --- activation kind on the governed state rows (audit C1/H5) -----------------

ALTER TABLE prod.module_states ADD COLUMN IF NOT EXISTS activation_kind text;

DO $statekind$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'module_states_activation_kind_known'
           AND conrelid = 'prod.module_states'::regclass
    ) THEN
        ALTER TABLE prod.module_states
            ADD CONSTRAINT module_states_activation_kind_known
            CHECK (
                activation_kind IS NULL
                OR activation_kind IN ('OPERATIONAL', 'OPPORTUNITY', 'WORKSPACE', 'PUBLIC')
            );
    END IF;
    -- ACTIVE is not a declaration: it names the kind that was evaluated.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'module_states_active_requires_activation_kind'
           AND conrelid = 'prod.module_states'::regclass
    ) THEN
        ALTER TABLE prod.module_states
            ADD CONSTRAINT module_states_active_requires_activation_kind
            CHECK (lifecycle_state <> 'ACTIVE' OR activation_kind IS NOT NULL);
    END IF;
    -- The declared readiness can never exceed the evaluated kind (audit C1).
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'module_states_readiness_bounded_by_kind'
           AND conrelid = 'prod.module_states'::regclass
    ) THEN
        ALTER TABLE prod.module_states
            ADD CONSTRAINT module_states_readiness_bounded_by_kind CHECK (
                lifecycle_state <> 'ACTIVE'
                OR (
                    (
                        distribution_readiness <> 'WORKSPACE_AUTHORIZED'
                        OR activation_kind = 'WORKSPACE'
                    )
                    AND (
                        distribution_readiness <> 'PUBLIC_AUTHORIZED'
                        OR activation_kind = 'PUBLIC'
                    )
                    AND (
                        operational_readiness <> 'READY_FOR_ACTIVE_PROFILE'
                        OR activation_kind <> 'OPERATIONAL'
                    )
                )
            );
    END IF;
END
$statekind$;

-- --- the kind-aware ACTIVE evidence trigger -----------------------------------

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
    IF NEW.activation_kind IN ('OPPORTUNITY', 'WORKSPACE', 'PUBLIC') THEN
        IF (NEW.scope ->> 'requires_proven') = 'true' THEN
            required_gates := array_append(required_gates, 'PROVEN_PRESENT');
        END IF;
        required_gates := required_gates || ARRAY[
            'STATISTICAL_EVIDENCE_SCOPE',
            'NEGATIVE_CONTROLS',
            'CLUSTERED_INTERVALS',
            'CALIBRATION_MATURITY'
        ];
    END IF;
    IF NEW.activation_kind IN ('WORKSPACE', 'PUBLIC') THEN
        required_gates := required_gates || 'DISTRIBUTION_EVIDENCE';
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
