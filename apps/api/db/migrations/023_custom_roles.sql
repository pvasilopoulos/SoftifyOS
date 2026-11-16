-- Roles per organisation with permissions (Settings → Users & roles).
-- System roles (owner, admin, manager, sales, viewer) always exist; organisations can add their own.
-- approval_level decides which approval steps a role can sign (same scale as approval_flow_steps.required_role:
-- 0 none, 1 sales, 2 manager, 3 admin, 4 owner).
CREATE TABLE roles (
  id             uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key            text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name           text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  description    text CHECK (char_length(description) <= 200),
  permissions    text[] NOT NULL DEFAULT '{}',
  approval_level smallint NOT NULL DEFAULT 0 CHECK (approval_level BETWEEN 0 AND 4),
  is_system      boolean NOT NULL DEFAULT false,
  sort           int NOT NULL DEFAULT 100,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);
CREATE UNIQUE INDEX roles_name_uq ON roles (tenant_id, lower(name));
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON roles USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON roles TO softify_app;

CREATE OR REPLACE FUNCTION seed_system_roles(p_tenant uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO roles (tenant_id, key, name, description, permissions, approval_level, is_system, sort) VALUES
    (p_tenant, 'owner',   'Ιδιοκτήτης',    'Πλήρης έλεγχος, και διαχείριση ιδιοκτητών',
      ARRAY['customers.edit','customers.delete','offers.edit','settings.manage','users.manage','integrations.manage','audit.view'], 4, true, 1),
    (p_tenant, 'admin',   'Διαχειριστής',  'Ρυθμίσεις, χρήστες, κατάλογοι',
      ARRAY['customers.edit','customers.delete','offers.edit','settings.manage','users.manage','integrations.manage','audit.view'], 3, true, 2),
    (p_tenant, 'manager', 'Manager',       'Εγκρίσεις, διαγραφές, αρχειοθέτηση',
      ARRAY['customers.edit','customers.delete','offers.edit'], 2, true, 3),
    (p_tenant, 'sales',   'Πωλήσεις',      'Πελάτες, προσφορές, ημερολόγιο',
      ARRAY['customers.edit','offers.edit'], 1, true, 4),
    (p_tenant, 'viewer',  'Μόνο ανάγνωση', 'Μόνο προβολή δεδομένων', ARRAY[]::text[], 0, true, 5)
  ON CONFLICT (tenant_id, key) DO NOTHING;
$$;

-- Every organisation gets the system roles automatically (now and when created later)
SELECT seed_system_roles(id) FROM tenants;
CREATE OR REPLACE FUNCTION tenants_seed_roles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM seed_system_roles(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER tenants_seed_roles AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION tenants_seed_roles();

-- Memberships point to a role of their organisation (any key, not just the five built-in ones)
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_fk
  FOREIGN KEY (tenant_id, role) REFERENCES roles (tenant_id, key) ON UPDATE CASCADE ON DELETE RESTRICT;
CREATE INDEX memberships_role_idx ON memberships (tenant_id, role);
