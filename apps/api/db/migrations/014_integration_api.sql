-- Integration API (v1): external ids for idempotent sync, and per-tenant API keys.

-- External system ids (ERP etc.). Unique per tenant; NULL for records created in the app.
ALTER TABLE customers ADD COLUMN external_id text;
ALTER TABLE branches  ADD COLUMN external_id text;
ALTER TABLE spaces    ADD COLUMN external_id text;
CREATE UNIQUE INDEX customers_external_uq ON customers (tenant_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX branches_external_uq  ON branches  (tenant_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX spaces_external_uq    ON spaces    (tenant_id, external_id) WHERE external_id IS NOT NULL;

-- Keyset listing by update time (incremental sync: "everything changed since…")
ALTER TABLE branches ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE spaces   ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX customers_updated_idx ON customers (tenant_id, updated_at, id);
CREATE INDEX branches_updated_idx  ON branches  (tenant_id, updated_at, id);
CREATE INDEX spaces_updated_idx    ON spaces    (tenant_id, updated_at, id);

-- API keys: the secret is shown once; only a SHA-256 hash is stored. The prefix identifies the key.
CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  prefix       text NOT NULL UNIQUE,
  secret_hash  text NOT NULL,
  scope        text NOT NULL CHECK (scope IN ('read', 'write')),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  requests     bigint NOT NULL DEFAULT 0,
  revoked_at   timestamptz
);
CREATE INDEX api_keys_tenant_idx ON api_keys (tenant_id, created_at DESC);
CREATE INDEX api_keys_creator_fk ON api_keys (created_by) WHERE created_by IS NOT NULL;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_keys USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON api_keys TO softify_app;
