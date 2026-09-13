-- g2_prod_0008_raw_write_invariants.sql
-- Additive raw-write invariants for governed activation (final convergence audit
-- HIGH-1/HIGH-2 + the MEDIUM type/trim findings; FR-PROD-001/002/006, AC-152/278).
--
-- The governed `advanceState` path already refuses an activation-event replay and
-- always derives `scope_hash` from the exact scope. The SQL layer did not, so a
-- raw writer could:
--   * replay an activation event that already backed an ACTIVE row for the exact
--     scope (no unique constraint / trigger check existed), and
--   * declare scope S while supplying the hash of a DIFFERENT scope, evading the
--     `g2_prod_0007` containment check (which matches on `scope_hash`) and
--     reusing another scope's evidence.
-- This migration closes both at the SQL layer, and tightens the event-reference
-- and `requires_proven` shapes the earlier triggers read.
--
-- Additive only: it ADDs table constraints and one BEFORE trigger; no column,
-- table or constraint from `g2_prod_0001..0007` is altered or dropped.

-- --- shape constraints on the governed rows -----------------------------------

DO $shapes$
BEGIN
    -- Whitespace-only is empty: the TypeScript guard trims, the SQL length
    -- check did not, so `'   '` passed the C2 fix.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'module_states_activation_event_ref_nonblank'
           AND conrelid = 'prod.module_states'::regclass
    ) THEN
        ALTER TABLE prod.module_states
            ADD CONSTRAINT module_states_activation_event_ref_nonblank
            CHECK (
                activation_event_ref IS NULL
                OR length(btrim(activation_event_ref)) > 0
            );
    END IF;
    -- `requires_proven` must be a real boolean: a truthy string/number such as
    -- `1` silently skipped the PROVEN law in the 0006 trigger.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'module_states_requires_proven_is_boolean'
           AND conrelid = 'prod.module_states'::regclass
    ) THEN
        ALTER TABLE prod.module_states
            ADD CONSTRAINT module_states_requires_proven_is_boolean
            CHECK (jsonb_typeof(scope -> 'requires_proven') = 'boolean');
    END IF;
    -- A cleared containment must name a real event, not the empty string.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'containment_events_cleared_ref_nonblank'
           AND conrelid = 'prod.containment_events'::regclass
    ) THEN
        ALTER TABLE prod.containment_events
            ADD CONSTRAINT containment_events_cleared_ref_nonblank
            CHECK (
                cleared_by_event_ref IS NULL
                OR length(btrim(cleared_by_event_ref)) > 0
            );
    END IF;
END
$shapes$;

-- --- canonical scope <-> scope_hash binding (HIGH-2) --------------------------

-- Reproduce `canonicalJson(scope)` + `sha256Text` from
-- packages/persistence/src/canonical-json.ts for the FIXED §69.5 scope shape
-- (six strings plus a boolean; keys sorted lexicographically). The governed path
-- derives `scope_hash` from exactly this canonical text, so a raw writer can no
-- longer declare scope S with another scope's hash (which evaded the containment
-- check that matches on `scope_hash` and allowed foreign evidence reuse). A
-- string this function cannot reproduce verbatim fails the comparison and is
-- refused, i.e. it errs closed.
CREATE OR REPLACE FUNCTION prod.foresift_prod_scope_hash(scope jsonb) RETURNS text AS $fn$
DECLARE
    canonical_keys text[] := ARRAY[
        'delay_policy',
        'execution_scenario',
        'policy_version',
        'population_claim',
        'profile_version',
        'regime_scope',
        'requires_proven'
    ];
    parts text[] := ARRAY[]::text[];
    key_name text;
    value jsonb;
BEGIN
    IF scope IS NULL OR jsonb_typeof(scope) <> 'object' THEN
        RAISE EXCEPTION 'scope must be a JSON object' USING ERRCODE = 'restrict_violation';
    END IF;
    FOREACH key_name IN ARRAY canonical_keys LOOP
        value := scope -> key_name;
        IF value IS NULL THEN
            RAISE EXCEPTION 'scope is missing the required key %', key_name
                USING ERRCODE = 'restrict_violation';
        END IF;
        parts := array_append(parts, to_jsonb(key_name)::text || ':' || value::text);
    END LOOP;
    RETURN 'sha256:' || encode(
        sha256(convert_to('{' || array_to_string(parts, ',') || '}', 'UTF8')),
        'hex'
    );
END;
$fn$ LANGUAGE plpgsql IMMUTABLE;
DROP FUNCTION IF EXISTS public.foresift_prod_scope_hash(jsonb);

-- --- raw-write invariants on ACTIVE inserts/updates ---------------------------

CREATE OR REPLACE FUNCTION prod.foresift_prod_raw_write_invariants() RETURNS trigger AS $fn$
DECLARE
    replaying text;
    conflicting_hash text;
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RETURN NEW;
    END IF;
    -- HIGH-2: a declared scope_hash must be the canonical hash of the declared
    -- scope for EVERY governed row, ACTIVE or not: consistency with prior rows
    -- alone left a first-ever row free to select a foreign hash.
    IF NEW.scope_hash IS NOT NULL
        AND NEW.scope_hash IS DISTINCT FROM prod.foresift_prod_scope_hash(NEW.scope)
    THEN
        RAISE EXCEPTION 'scope_hash % is not the canonical hash of the declared scope',
            NEW.scope_hash
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.lifecycle_state IS DISTINCT FROM 'ACTIVE' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.lifecycle_state IS NOT DISTINCT FROM 'ACTIVE' THEN
        RETURN NEW;
    END IF;

    -- HIGH-1: an activation event is single-use per (module, exact scope). The
    -- governed path refuses replay in TypeScript; a raw INSERT did not.
    SELECT s.state_row_id INTO replaying
      FROM prod.module_states s
     WHERE s.module_id = NEW.module_id
       AND s.scope_hash = NEW.scope_hash
       AND s.lifecycle_state = 'ACTIVE'
       AND s.activation_event_ref = NEW.activation_event_ref
       AND s.state_row_id <> NEW.state_row_id
     LIMIT 1;
    IF replaying IS NOT NULL THEN
        RAISE EXCEPTION 'ACTIVE refused: activation event % already backed ACTIVE row % for the exact scope; a fresh evaluation for a distinct event is required',
            NEW.activation_event_ref, replaying
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- HIGH-2: the declared `scope_hash` must be the hash already recorded for
    -- the SAME exact scope. A raw writer could otherwise keep the declared scope
    -- and swap in another scope's hash, evading the containment check (which
    -- matches on `scope_hash`) and reusing foreign evidence.
    SELECT s.scope_hash INTO conflicting_hash
      FROM prod.module_states s
     WHERE s.module_id = NEW.module_id
       AND s.scope = NEW.scope
       AND s.scope_hash IS NOT NULL
       AND s.scope_hash IS DISTINCT FROM NEW.scope_hash
     LIMIT 1;
    IF conflicting_hash IS NOT NULL THEN
        RAISE EXCEPTION 'ACTIVE refused: the declared scope_hash % is not the hash already recorded for this exact scope (%)',
            NEW.scope_hash, conflicting_hash
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS module_states_raw_write_invariants ON prod.module_states;
CREATE TRIGGER module_states_raw_write_invariants
    BEFORE INSERT OR UPDATE ON prod.module_states
    FOR EACH ROW EXECUTE FUNCTION prod.foresift_prod_raw_write_invariants();
DROP FUNCTION IF EXISTS public.foresift_prod_raw_write_invariants();
