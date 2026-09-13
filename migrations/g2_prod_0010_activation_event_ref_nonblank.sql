-- g2_prod_0010_activation_event_ref_nonblank.sql
-- Corrective migration (audit R8, MEDIUM): PostgreSQL `btrim(text)` strips ONLY
-- ASCII spaces, so the `module_states_activation_event_ref_nonblank` CHECK
-- introduced by `g2_prod_0008` accepted tab / LF / CR / VT / FF / NBSP / BOM
-- event references while TypeScript `String.prototype.trim()` treats them as
-- blank. With a complete all-PASS OPPORTUNITY set supplied, an ACTIVE row whose
-- `activation_event_ref` was `E'\t'` (and the other blank-only classes) was
-- accepted, defeating the "activation event is a real, single-use reference"
-- law (FR-PROD-001/002, AC-152/278).
--
-- `g2_prod_0008` is already applied on canonical main, so it is immutable: this
-- migration replaces the weak constraint with a strictly stronger predicate as
-- a NEW, later-sorting script (per the plan's out-of-order law). It normalizes
-- away every character JS `trim()` treats as blank in the sampled classes —
-- ASCII whitespace (space U+0020, tab U+0009, LF U+000A, CR U+000D, VT U+000B,
-- FF U+000C), NBSP (U+00A0) and BOM (U+FEFF) — and then requires at least one
-- remaining character, so blank-only and empty are unrepresentable while NULL
-- (a non-crossing row legitimately has no event) is still allowed.
--
-- Additive and self-contained: only this one CHECK constraint is dropped and
-- re-added with the same name; no column, table or other constraint is touched.

ALTER TABLE prod.module_states
    DROP CONSTRAINT IF EXISTS module_states_activation_event_ref_nonblank,
    ADD CONSTRAINT module_states_activation_event_ref_nonblank
    CHECK (
        activation_event_ref IS NULL
        OR length(
               -- Strip every sampled blank class: ASCII whitespace (tab, LF,
               -- VT, FF, CR, space) plus NBSP (U+00A0) and BOM (U+FEFF). What
               -- remains empty was blank to `String.prototype.trim()` too.
               translate(
                   activation_event_ref,
                   chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32)
                       || chr(160) || chr(65279),
                   ''
               )
           ) > 0
    );
