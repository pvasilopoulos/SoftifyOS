-- Advanced integrations: fine-grained key permissions, expiry, IP allow-list, request log, outgoing webhooks.

-- ---------------------------------------------------------------- API keys
-- Per-resource permissions: {"customers":"write","branches":"read","spaces":"none"}
ALTER TABLE api_keys
  ADD COLUMN permissions jsonb,
  ADD COLUMN expires_at  timestamptz,
  ADD COLUMN allowed_ips text[] NOT NULL DEFAULT '{}',   -- IPs or CIDRs; empty = any
  ADD COLUMN rotated_from uuid REFERENCES api_keys(id) ON DELETE SET NULL;
UPDATE api_keys SET permissions = CASE WHEN scope = 'write'
  THEN '{"customers":"write","branches":"write","spaces":"write"}'::jsonb
  ELSE '{"customers":"read","branches":"read","spaces":"read"}'::jsonb END;
ALTER TABLE api_keys ALTER COLUMN permissions SET NOT NULL;
CREATE INDEX api_keys_rotated_fk ON api_keys (rotated_from) WHERE rotated_from IS NOT NULL;

-- ---------------------------------------------------------------- request log (kept 30 days)
CREATE TABLE api_requests (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_id      uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  method      text NOT NULL,
  path        text NOT NULL,
  status      smallint NOT NULL,
  duration_ms int NOT NULL,
  ip          text,
  items       int,                 -- records in the request (batch / upsert)
  created     int, updated int, failed int,
  error       text,                -- top-level error code
  errors      jsonb,               -- first per-item errors of a batch
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_requests_tenant_idx ON api_requests (tenant_id, created_at DESC, id DESC);
CREATE INDEX api_requests_key_idx    ON api_requests (key_id, created_at DESC) WHERE key_id IS NOT NULL;
CREATE INDEX api_requests_failed_idx ON api_requests (tenant_id, created_at DESC) WHERE status >= 400 OR failed > 0;
ALTER TABLE api_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_requests USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON api_requests TO softify_app;

-- ---------------------------------------------------------------- outgoing webhooks
CREATE TABLE webhooks (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  url         text NOT NULL CHECK (url ~ '^https?://'),
  events      text[] NOT NULL,     -- e.g. {customer.created, branch.*} or {*}
  secret      text NOT NULL,       -- HMAC signing secret (shown in the UI on demand to admins)
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures int NOT NULL DEFAULT 0
);
CREATE INDEX webhooks_tenant_idx ON webhooks (tenant_id) WHERE active;
CREATE INDEX webhooks_creator_fk ON webhooks (created_by) WHERE created_by IS NOT NULL;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhooks USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON webhooks TO softify_app;

CREATE TABLE webhook_deliveries (
  id           uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  webhook_id   uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event        text NOT NULL,
  payload      jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  attempts     int NOT NULL DEFAULT 0,
  response_code int,
  response_ms  int,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX webhook_deliveries_hook_idx ON webhook_deliveries (webhook_id, created_at DESC);
CREATE INDEX webhook_deliveries_tenant_idx ON webhook_deliveries (tenant_id, created_at DESC);
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_deliveries USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON webhook_deliveries TO softify_app;
