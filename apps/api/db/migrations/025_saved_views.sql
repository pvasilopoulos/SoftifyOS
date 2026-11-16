-- Saved views of the list pages (Customers module first): view + filters + sort + search + expand,
-- personal, for roles, or for the whole organisation.
CREATE TABLE saved_views (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module      text NOT NULL CHECK (module IN ('customers')),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  icon        text NOT NULL DEFAULT 'list' CHECK (char_length(icon) <= 30),
  color       text NOT NULL DEFAULT 'primary' CHECK (char_length(color) <= 20),
  scope       text NOT NULL CHECK (scope IN ('personal', 'role', 'organization')),
  roles       text[] NOT NULL DEFAULT '{}',          -- scope = role: which roles see it
  owner_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  config      jsonb NOT NULL,                        -- { view, filters, sort, q, expand }
  is_system   boolean NOT NULL DEFAULT false,
  sort        int NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (scope <> 'personal' OR owner_id IS NOT NULL)
);
CREATE INDEX saved_views_tenant_idx ON saved_views (tenant_id, module, sort);
CREATE INDEX saved_views_owner_fk ON saved_views (owner_id) WHERE owner_id IS NOT NULL;
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saved_views USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_views TO softify_app;

-- Per-user: favourite (pinned in the bar) and personal order
CREATE TABLE saved_view_prefs (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  view_id    uuid NOT NULL REFERENCES saved_views(id) ON DELETE CASCADE,
  favorite   boolean NOT NULL DEFAULT false,
  position   int,
  PRIMARY KEY (user_id, view_id)
);
CREATE INDEX saved_view_prefs_view_fk ON saved_view_prefs (view_id);
CREATE INDEX saved_view_prefs_tenant_idx ON saved_view_prefs (tenant_id, user_id);
ALTER TABLE saved_view_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saved_view_prefs USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_view_prefs TO softify_app;

-- New permission: create/edit views shared with roles or the whole organisation
UPDATE roles SET permissions = permissions || ARRAY['views.share']
WHERE key IN ('owner', 'admin', 'manager') AND NOT ('views.share' = ANY (permissions));

CREATE OR REPLACE FUNCTION seed_system_roles(p_tenant uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO roles (tenant_id, key, name, description, permissions, approval_level, is_system, sort) VALUES
    (p_tenant, 'owner',   'Ιδιοκτήτης',    'Πλήρης έλεγχος, και διαχείριση ιδιοκτητών',
      ARRAY['customers.edit','customers.delete','offers.edit','views.share','settings.manage','users.manage','integrations.manage','audit.view'], 4, true, 1),
    (p_tenant, 'admin',   'Διαχειριστής',  'Ρυθμίσεις, χρήστες, κατάλογοι',
      ARRAY['customers.edit','customers.delete','offers.edit','views.share','settings.manage','users.manage','integrations.manage','audit.view'], 3, true, 2),
    (p_tenant, 'manager', 'Manager',       'Εγκρίσεις, διαγραφές, αρχειοθέτηση',
      ARRAY['customers.edit','customers.delete','offers.edit','views.share'], 2, true, 3),
    (p_tenant, 'sales',   'Πωλήσεις',      'Πελάτες, προσφορές, ημερολόγιο',
      ARRAY['customers.edit','offers.edit'], 1, true, 4),
    (p_tenant, 'viewer',  'Μόνο ανάγνωση', 'Μόνο προβολή δεδομένων', ARRAY[]::text[], 0, true, 5)
  ON CONFLICT (tenant_id, key) DO NOTHING;
$$;

-- Ready-made views for every organisation
CREATE OR REPLACE FUNCTION seed_system_views(p_tenant uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO saved_views (tenant_id, module, name, icon, color, scope, config, is_system, sort)
  SELECT p_tenant, 'customers', v.name, v.icon, v.color, 'organization', v.config::jsonb, true, v.sort
  FROM (VALUES
    ('Όλοι οι πελάτες',        'users',  'primary', '{"view":"list","filters":{},"sort":"name"}', 1),
    ('Οι δικοί μου',           'user',   'info',    '{"view":"list","filters":{"c_mine":"1"},"sort":"name"}', 2),
    ('Υποψήφιοι',              'target', 'warning', '{"view":"list","filters":{"c_status":"prospect"},"sort":"recent"}', 3),
    ('Νέοι 30 ημερών',         'sparkles','success','{"view":"list","filters":{"c_created":"30"},"sort":"recent"}', 4),
    ('Ανενεργά καταστήματα',   'store',  'danger',  '{"view":"stores","filters":{"b_status":"inactive"},"sort":"name"}', 5)
  ) AS v(name, icon, color, config, sort)
  WHERE NOT EXISTS (SELECT 1 FROM saved_views s WHERE s.tenant_id = p_tenant AND s.is_system);
$$;
SELECT seed_system_views(id) FROM tenants;

CREATE OR REPLACE FUNCTION tenants_seed_roles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM seed_system_roles(NEW.id); PERFORM seed_system_views(NEW.id); RETURN NEW; END $$;
