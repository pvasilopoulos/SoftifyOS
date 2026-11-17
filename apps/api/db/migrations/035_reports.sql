-- Reports: saved report definitions (private / role / organisation), scheduled e-mail delivery,
-- and a personal home dashboard of report widgets.

CREATE TABLE saved_reports (
  id           uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description  text CHECK (char_length(description) <= 500),
  definition   jsonb NOT NULL,          -- { source, measure, group, period, compare, filters, limit, chart }
  scope        text NOT NULL DEFAULT 'private' CHECK (scope IN ('private', 'role', 'organization')),
  role_key     text,
  schedule     jsonb,                   -- { freq: daily|weekly|monthly, weekday?, day?, hour, recipients: uuid[] }
  next_run_at  timestamptz,
  last_sent_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_reports_tenant_idx ON saved_reports (tenant_id, scope, owner_id);
CREATE INDEX saved_reports_schedule_idx ON saved_reports (next_run_at) WHERE next_run_at IS NOT NULL;

CREATE TABLE user_dashboards (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  widgets    jsonb NOT NULL DEFAULT '[]',   -- [{ id, kind: preset|saved, ref, size: sm|md|lg }]
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['saved_reports', 'user_dashboards'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO softify_app', t);
  END LOOP;
END $$;
