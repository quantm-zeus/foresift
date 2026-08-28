-- g0_cost_0002_paid_policies.sql
-- ROLLBACK: DROP TABLE cost.paid_provider_policies CASCADE;
-- Immutable, explicitly approved paid-provider policy lifecycle (FR-COST-008).

CREATE SCHEMA IF NOT EXISTS cost;

CREATE TABLE cost.paid_provider_policies (
    policy_id      text        PRIMARY KEY CHECK (policy_id ~ '^sha256:[0-9a-f]{64}$'),
    provider_id    text        NOT NULL,
    budget_units   numeric     NOT NULL CHECK (budget_units > 0),
    approved_by    text        NOT NULL,
    approved_at    timestamptz NOT NULL,
    activated_at   timestamptz,
    re_auth_due_at timestamptz NOT NULL,
    active         boolean     NOT NULL DEFAULT FALSE,
    superseded_by  text        REFERENCES cost.paid_provider_policies(policy_id),
    CHECK (activated_at IS NULL OR re_auth_due_at > activated_at),
    CHECK (NOT active OR activated_at IS NOT NULL),
    CHECK (superseded_by IS NULL OR superseded_by <> policy_id)
);

CREATE UNIQUE INDEX paid_provider_one_active_idx
  ON cost.paid_provider_policies(provider_id) WHERE active = TRUE;

CREATE FUNCTION cost.refuse_active_paid_policy_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.activated_at IS NOT NULL AND (
      NEW.budget_units IS DISTINCT FROM OLD.budget_units OR
      NEW.approved_by IS DISTINCT FROM OLD.approved_by OR
      NEW.approved_at IS DISTINCT FROM OLD.approved_at OR
      NEW.re_auth_due_at IS DISTINCT FROM OLD.re_auth_due_at OR
      NEW.provider_id IS DISTINCT FROM OLD.provider_id OR
      NEW.policy_id IS DISTINCT FROM OLD.policy_id) THEN
    RAISE EXCEPTION 'COST_PAID_POLICY_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER paid_provider_policy_immutability
BEFORE UPDATE ON cost.paid_provider_policies
FOR EACH ROW EXECUTE FUNCTION cost.refuse_active_paid_policy_mutation();
