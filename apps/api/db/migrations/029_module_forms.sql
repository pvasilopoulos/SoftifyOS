-- Module Forms (Settings → Module Forms): per organisation / role / user form configuration
-- (hidden, read-only, required, defaults, captions, order, sections, validation, conditions)
-- and custom fields whose values live in a `custom` jsonb column on each record.

CREATE TABLE form_configs (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form        text NOT NULL CHECK (form ~ '^[a-z_]{2,40}$'),
  scope       text NOT NULL CHECK (scope IN ('organization', 'role', 'user')),
  scope_key   text NOT NULL DEFAULT '',            -- '' / role key / user id
  config      jsonb NOT NULL DEFAULT '{}',
  version     int NOT NULL DEFAULT 1,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, form, scope, scope_key)
);
ALTER TABLE form_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON form_configs USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON form_configs TO softify_app;

CREATE TABLE form_config_history (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form        text NOT NULL,
  scope       text NOT NULL,
  scope_key   text NOT NULL DEFAULT '',
  version     int NOT NULL,
  config      jsonb NOT NULL,
  note        text CHECK (char_length(note) <= 200),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX form_config_history_idx ON form_config_history (tenant_id, form, scope, scope_key, created_at DESC);
ALTER TABLE form_config_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON form_config_history USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, DELETE ON form_config_history TO softify_app;

CREATE TABLE custom_fields (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form        text NOT NULL CHECK (form IN ('customer', 'branch', 'space', 'contact', 'activity', 'offer')),
  key         text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  type        text NOT NULL CHECK (type IN ('text', 'textarea', 'number', 'date', 'bool', 'select', 'multiselect', 'email', 'url', 'phone')),
  label       jsonb NOT NULL,                       -- {"el": "...", "en": "..."}
  options     text[] NOT NULL DEFAULT '{}',          -- select / multiselect
  sort        int NOT NULL DEFAULT 100,
  active      boolean NOT NULL DEFAULT true,
  filterable  boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, form, key)
);
ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON custom_fields USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON custom_fields TO softify_app;

-- Values of custom fields
ALTER TABLE customers  ADD COLUMN custom jsonb NOT NULL DEFAULT '{}';
ALTER TABLE branches   ADD COLUMN custom jsonb NOT NULL DEFAULT '{}';
ALTER TABLE spaces     ADD COLUMN custom jsonb NOT NULL DEFAULT '{}';
ALTER TABLE contacts   ADD COLUMN custom jsonb NOT NULL DEFAULT '{}';
ALTER TABLE activities ADD COLUMN custom jsonb NOT NULL DEFAULT '{}';
ALTER TABLE offers     ADD COLUMN custom jsonb NOT NULL DEFAULT '{}';
CREATE INDEX customers_custom_gin ON customers USING gin (custom jsonb_path_ops);
CREATE INDEX branches_custom_gin  ON branches  USING gin (custom jsonb_path_ops);
CREATE INDEX spaces_custom_gin    ON spaces    USING gin (custom jsonb_path_ops);

-- New permission
UPDATE roles SET permissions = permissions || ARRAY['forms.manage']
WHERE key IN ('owner', 'admin') AND NOT ('forms.manage' = ANY (permissions));

CREATE OR REPLACE FUNCTION seed_system_roles(p_tenant uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO roles (tenant_id, key, name, description, permissions, approval_level, is_system, sort) VALUES
    (p_tenant, 'owner',   'Ιδιοκτήτης',    'Πλήρης έλεγχος, και διαχείριση ιδιοκτητών',
      ARRAY['customers.edit','customers.delete','offers.edit','views.share','forms.manage','settings.manage','users.manage','integrations.manage','audit.view'], 4, true, 1),
    (p_tenant, 'admin',   'Διαχειριστής',  'Ρυθμίσεις, χρήστες, κατάλογοι',
      ARRAY['customers.edit','customers.delete','offers.edit','views.share','forms.manage','settings.manage','users.manage','integrations.manage','audit.view'], 3, true, 2),
    (p_tenant, 'manager', 'Manager',       'Εγκρίσεις, διαγραφές, αρχειοθέτηση',
      ARRAY['customers.edit','customers.delete','offers.edit','views.share'], 2, true, 3),
    (p_tenant, 'sales',   'Πωλήσεις',      'Πελάτες, προσφορές, ημερολόγιο',
      ARRAY['customers.edit','offers.edit'], 1, true, 4),
    (p_tenant, 'viewer',  'Μόνο ανάγνωση', 'Μόνο προβολή δεδομένων', ARRAY[]::text[], 0, true, 5)
  ON CONFLICT (tenant_id, key) DO NOTHING;
$$;
