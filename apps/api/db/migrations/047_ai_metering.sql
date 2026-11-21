-- AI cost control: detailed call ledger, price list per model, per-user limits (in tenants.ai_settings.limits),
-- requests for extra budget, one-off notices (80% / 100% / spikes) and reconciliation with Anthropic's billed cost.

-- ---------------------------------------------------------------- call ledger (one row per call, blocked ones too)
ALTER TABLE ai_usage
  ADD COLUMN request_id      text,                                   -- Anthropic request id
  ADD COLUMN requested_model text,                                   -- what we asked for (model = what answered)
  ADD COLUMN status          text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'refused', 'blocked')),
  ADD COLUMN error           text CHECK (char_length(error) <= 300),
  ADD COLUMN duration_ms     integer,
  ADD COLUMN entity          text CHECK (entity IN ('customer', 'conversation', 'report', 'offer')),
  ADD COLUMN entity_id       uuid;
CREATE INDEX ai_usage_user_idx   ON ai_usage (tenant_id, user_id, created_at);
CREATE INDEX ai_usage_entity_idx ON ai_usage (tenant_id, entity_id) WHERE entity_id IS NOT NULL;

-- ---------------------------------------------------------------- $ per million tokens, per model, from a date
-- Cost of a call = the row valid on its date, so changing prices never rewrites the past.
CREATE TABLE ai_prices (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  model       text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 80),
  valid_from  date NOT NULL,
  input       numeric(10, 4) NOT NULL CHECK (input >= 0),
  output      numeric(10, 4) NOT NULL CHECK (output >= 0),
  cache_read  numeric(10, 4) NOT NULL CHECK (cache_read >= 0),
  cache_write numeric(10, 4) NOT NULL CHECK (cache_write >= 0),
  PRIMARY KEY (tenant_id, model, valid_from)
);

-- ---------------------------------------------------------------- "give me more for this month"
CREATE TABLE ai_budget_requests (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       date NOT NULL,                                          -- first day of the month it applies to
  amount_usd  numeric(10, 2) NOT NULL CHECK (amount_usd > 0 AND amount_usd <= 10000),
  reason      text CHECK (char_length(reason) <= 500),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at  timestamptz,
  note        text CHECK (char_length(note) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_budget_requests_idx ON ai_budget_requests (tenant_id, status, created_at DESC);

-- Notices sent once (e.g. "user:<id>:80" for the month, "spike:<id>:<hour>")
CREATE TABLE ai_notices (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key       text NOT NULL,
  month     date NOT NULL,
  sent_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key, month)
);

-- ---------------------------------------------------------------- Anthropic billed cost per day (Admin API)
CREATE TABLE ai_reconciliation (
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day           date NOT NULL,                     -- UTC day
  estimated_usd numeric(12, 6) NOT NULL DEFAULT 0, -- our ledger
  billed_usd    numeric(12, 6),                    -- Anthropic: after discounts, before credits
  list_usd      numeric(12, 6),                    -- Anthropic: list price
  requests      integer,
  by_model      jsonb NOT NULL DEFAULT '{}',
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_prices', 'ai_budget_requests', 'ai_notices', 'ai_reconciliation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO softify_app', t);
  END LOOP;
END $$;

-- Anthropic Admin API key (read-only use: billed cost) — encrypted, never sent back
ALTER TABLE tenants
  ADD COLUMN ai_admin_key_enc text,
  ADD COLUMN ai_admin_meta    jsonb;   -- { last4, set_by, set_at, api_key_ids: [...], key_names: {...}, last_run_at, last_error }
GRANT UPDATE (ai_admin_key_enc, ai_admin_meta) ON tenants TO softify_app;
