-- g2_prod_0005_activation_evidence.sql
-- Bind ACTIVE module states to PERSISTED activation-gate evidence at the SQL
-- level (FR-PROD-001/002, AC-152/154/279; review finding F1/F2).
--
-- `g2_prod_0001_module_registry.sql` only required `activation_event_ref IS NOT
-- NULL` for an ACTIVE row: the reference was free text with no link to
-- `prod.activation_gate_evaluations`, so a raw INSERT could declare ACTIVE with
-- zero gate rows. This additive migration closes that bypass:
--   * `prod.module_states.scope_hash` records the EXACT canonical §69.5 scope
--     hash the row belongs to, so the row can be joined to its evaluations;
--   * `prod.activation_gate_evaluations.activation_event_ref` records the
--     activation event an evaluation set authorises;
--   * a BEFORE INSERT/UPDATE trigger refuses an ACTIVE row unless a COMPLETE,
--     all-PASS, unexpired evaluation set exists for the SAME scope hash and the
--     SAME activation event, with the statement-level TRUNCATE guard mirroring
--     the append-only trigger style used across the `prod` schema.
--
-- Additive only: no existing column, table, or constraint from
-- `g2_prod_0001..0004` is altered or dropped.

-- --- exact-scope + activation-event bindings (additive) -----------------------

-- The exact canonical scope hash (`sha256:<hex>` over the §69.5 scope). Nullable
-- because non-ACTIVE rows may predate the binding; an ACTIVE row may not.
ALTER TABLE prod.module_states ADD COLUMN IF NOT EXISTS scope_hash text;

-- The activation event an evaluation set authorises. Nullable for REFUSE-only
-- evaluations; the guard below requires it to match for a PASS activation set.
ALTER TABLE prod.activation_gate_evaluations
    ADD COLUMN IF NOT EXISTS activation_event_ref text;

DO $guard$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'module_states_scope_hash_format'
           AND conrelid = 'prod.module_states'::regclass
    ) THEN
        ALTER TABLE prod.module_states
            ADD CONSTRAINT module_states_scope_hash_format
            CHECK (scope_hash IS NULL OR scope_hash ~ '^sha256:[0-9a-f]{64}$');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'module_states_active_requires_scope_hash'
           AND conrelid = 'prod.module_states'::regclass
    ) THEN
        ALTER TABLE prod.module_states
            ADD CONSTRAINT module_states_active_requires_scope_hash
            CHECK (lifecycle_state <> 'ACTIVE' OR scope_hash IS NOT NULL);
    END IF;
END
$guard$;

-- --- ACTIVE requires persisted, complete, unexpired gate evidence -------------

-- TRUNCATE is handled FIRST: statement-level truncate rows have no OLD/NEW, so a
-- fall-through would compare all-NULL and wrongly allow it (the same reason the
-- g2_prod_0001 rewrite trigger orders its DELETE/TRUNCATE branch first).
CREATE OR REPLACE FUNCTION prod.foresift_prod_require_activation_evidence() RETURNS trigger AS $fn$
DECLARE
    -- The full ordered §69.4/§69.5/§69.9 gate set. Every kind's `requiredGates`
    -- is a subsequence of this list, so covering it covers the activation kind.
    required_gates text[] := ARRAY[
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
    missing_gate text;
    duplicated_gate text;
    refusing_gate text;
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
    -- A NULL reference is refused by the g2_prod_0001 CHECK constraint with its
    -- stable constraint name; leave that case to the constraint.
    IF NEW.activation_event_ref IS NULL OR NEW.activation_event_ref = '' THEN
        RETURN NEW;
    END IF;
    IF NEW.scope_hash IS NULL THEN
        RAISE EXCEPTION 'ACTIVE requires the exact scope hash its gate evaluations were persisted against'
            USING ERRCODE = 'restrict_violation';
    END IF;
    -- A later REFUSE re-evaluation invalidates an older PASS for the same event.
    SELECT e.gate_kind INTO refusing_gate
      FROM prod.activation_gate_evaluations e
     WHERE e.scope_hash = NEW.scope_hash
       AND e.activation_event_ref = NEW.activation_event_ref
       AND e.verdict = 'REFUSE'
     LIMIT 1;
    IF refusing_gate IS NOT NULL THEN
        RAISE EXCEPTION 'ACTIVE requires an all-PASS persisted gate evaluation set: % refused for this activation event', refusing_gate
            USING ERRCODE = 'restrict_violation';
    END IF;
    -- Exactly one PASS per required gate, unexpired at insert time.
    SELECT e.gate_kind INTO duplicated_gate
      FROM prod.activation_gate_evaluations e
     WHERE e.scope_hash = NEW.scope_hash
       AND e.activation_event_ref = NEW.activation_event_ref
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
           AND e.gate_kind = g
           AND e.verdict = 'PASS'
           AND e.failing_gate IS NULL
           AND e.expires_at > now()
     )
     LIMIT 1;
    IF missing_gate IS NOT NULL THEN
        RAISE EXCEPTION 'ACTIVE requires a complete, unexpired, all-PASS persisted gate evaluation set: missing gate %', missing_gate
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS module_states_requires_activation_evidence ON prod.module_states;
CREATE TRIGGER module_states_requires_activation_evidence
    BEFORE INSERT OR UPDATE ON prod.module_states
    FOR EACH ROW EXECUTE FUNCTION prod.foresift_prod_require_activation_evidence();
DROP TRIGGER IF EXISTS module_states_activation_evidence_no_truncate ON prod.module_states;
CREATE TRIGGER module_states_activation_evidence_no_truncate
    BEFORE TRUNCATE ON prod.module_states
    FOR EACH STATEMENT EXECUTE FUNCTION prod.foresift_prod_require_activation_evidence();
-- Schema hygiene: retire any pre-fix function that lived in `public`.
DROP FUNCTION IF EXISTS public.foresift_prod_require_activation_evidence();
