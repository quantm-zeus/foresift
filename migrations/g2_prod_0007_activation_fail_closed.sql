-- g2_prod_0007_activation_fail_closed.sql
-- Close the remaining SQL-level fail-open paths around governed activation
-- (emergency correction C2 + audit MEDIUM 3/4; FR-PROD-001/002, AC-152/278).
--
--   * C2 — `activation_event_ref = ''` passed the 0001 `IS NOT NULL` CHECK and
--     the 0005 trigger returned early, so a raw ACTIVE INSERT with zero gate
--     rows committed. A length CHECK makes the empty string unrepresentable.
--   * MEDIUM 3 — `scope_hash` was the one identity column the one-time-supersede
--     rewrite trigger did not compare, so an ACTIVE row's exact-scope binding
--     could be rewritten. It is now immutable, like every other identity column.
--   * MEDIUM 4 — open containment was enforced only by the TypeScript path; a
--     raw INSERT could persist ACTIVE (or a `NO_OPEN_CONTAINMENT` PASS) while a
--     containment event on the exact scope was still open (§69.11). A dedicated
--     BEFORE trigger consults `prod.containment_events` for the exact scope.
--
-- Additive and self-contained: it only ADDs constraints/triggers and replaces
-- the rewrite trigger with a strictly stronger body. It sorts after every
-- migration already applied on a pre-correction `main` database.

-- --- C2: an empty activation event reference is not a reference ---------------

DO $eventref$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'module_states_activation_event_ref_nonempty'
           AND conrelid = 'prod.module_states'::regclass
    ) THEN
        ALTER TABLE prod.module_states
            ADD CONSTRAINT module_states_activation_event_ref_nonempty
            CHECK (activation_event_ref IS NULL OR length(activation_event_ref) > 0);
    END IF;
END
$eventref$;

-- --- MEDIUM 3: scope_hash and activation_kind are identity, not mutable -------

CREATE OR REPLACE FUNCTION prod.foresift_prod_refuse_module_state_rewrite() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'module states are append-only: a change records a new row (delete/truncate refused)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state_row_id IS DISTINCT FROM OLD.state_row_id
        OR NEW.module_id IS DISTINCT FROM OLD.module_id
        OR NEW.artifact_set_hash IS DISTINCT FROM OLD.artifact_set_hash
        OR NEW.scope IS DISTINCT FROM OLD.scope
        OR NEW.scope_hash IS DISTINCT FROM OLD.scope_hash
        OR NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state
        OR NEW.operational_readiness IS DISTINCT FROM OLD.operational_readiness
        OR NEW.distribution_readiness IS DISTINCT FROM OLD.distribution_readiness
        OR NEW.activation_event_ref IS DISTINCT FROM OLD.activation_event_ref
        OR NEW.activation_kind IS DISTINCT FROM OLD.activation_kind
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.superseded_by IS NULL
        OR OLD.superseded_by IS NOT NULL
    THEN
        RAISE EXCEPTION 'module states are append-only: only a one-time supersede pointer may be set'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS public.foresift_prod_refuse_module_state_rewrite();

-- --- MEDIUM 4: open containment is refused at the SQL level too ---------------

CREATE OR REPLACE FUNCTION prod.foresift_prod_refuse_active_with_open_containment() RETURNS trigger AS $fn$
DECLARE
    open_containment text;
BEGIN
    IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
        RETURN NEW;
    END IF;
    IF NEW.lifecycle_state IS DISTINCT FROM 'ACTIVE' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.lifecycle_state IS NOT DISTINCT FROM 'ACTIVE' THEN
        RETURN NEW;
    END IF;
    SELECT c.containment_id INTO open_containment
      FROM prod.containment_events c
     WHERE c.module_id = NEW.module_id
       AND c.scope_hash = NEW.scope_hash
       AND c.cleared_by_event_ref IS NULL
     ORDER BY c.created_at ASC, c.containment_id ASC
     LIMIT 1;
    IF open_containment IS NOT NULL THEN
        RAISE EXCEPTION 'ACTIVE refused: containment % is still open on the exact scope; clearContainment plus a fresh recorded evaluation is the only reactivation path',
            open_containment
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS module_states_no_open_containment ON prod.module_states;
CREATE TRIGGER module_states_no_open_containment
    BEFORE INSERT OR UPDATE ON prod.module_states
    FOR EACH ROW EXECUTE FUNCTION prod.foresift_prod_refuse_active_with_open_containment();
DROP FUNCTION IF EXISTS public.foresift_prod_refuse_active_with_open_containment();
