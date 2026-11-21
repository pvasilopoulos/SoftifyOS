-- AI "next best action" per customer (cached, so opening a customer does not call the AI every time),
-- customers at risk (score computed by the worker from activities and offers, no AI cost),
-- and alert state for problems that are e-mailed once when they start and once when they recover.

-- ---------------------------------------------------------------- cached AI suggestions
CREATE TABLE ai_insights (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('next_action')),
  data         jsonb NOT NULL,
  basis        text NOT NULL,              -- fingerprint of the data it was made from: different now = out of date
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_id, kind)
);

-- ---------------------------------------------------------------- customers at risk
CREATE TABLE customer_risk (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  score       smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  level       text NOT NULL CHECK (level IN ('low', 'medium', 'high')),
  reasons     jsonb NOT NULL DEFAULT '[]',  -- [{ code, n?, days?, amount? }]
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_id)
);
CREATE INDEX customer_risk_score_idx ON customer_risk (tenant_id, score DESC, customer_id);
ALTER TABLE tenants ADD COLUMN risk_computed_at timestamptz;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_insights', 'customer_risk'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO softify_app', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- alerts (worker only, no tenant access)
-- key: 'backup' | 'erp:<tenant id>'. bad flips → one e-mail; notified_at = when that e-mail was queued.
CREATE TABLE alert_state (
  key         text PRIMARY KEY,
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  bad         boolean NOT NULL,
  since       timestamptz NOT NULL DEFAULT now(),
  detail      text CHECK (char_length(detail) <= 1000),
  notified_at timestamptz
);
