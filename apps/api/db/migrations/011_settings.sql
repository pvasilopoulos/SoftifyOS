-- Settings module: organisation profile & defaults, richer issuing companies,
-- user invitations, and an audit log of administrative changes.

-- Organisation profile & defaults
ALTER TABLE tenants
  ADD COLUMN legal_name          text,
  ADD COLUMN vat                 text,
  ADD COLUMN email               text,
  ADD COLUMN phone               text,
  ADD COLUMN website             text,
  ADD COLUMN address             text,
  ADD COLUMN timezone            text NOT NULL DEFAULT 'Europe/Athens',
  ADD COLUMN currency            text NOT NULL DEFAULT 'EUR',
  ADD COLUMN default_vat_rate    numeric(5,2) NOT NULL DEFAULT 24 CHECK (default_vat_rate >= 0 AND default_vat_rate <= 100),
  ADD COLUMN offer_prefix        text NOT NULL DEFAULT 'OFF' CHECK (offer_prefix ~ '^[A-Z0-9-]{1,10}$'),
  ADD COLUMN offer_validity_days int NOT NULL DEFAULT 30 CHECK (offer_validity_days BETWEEN 1 AND 365),
  ADD COLUMN offer_terms         text,
  ADD COLUMN updated_at          timestamptz NOT NULL DEFAULT now();

-- Issuing companies
ALTER TABLE companies
  ADD COLUMN tax_office text,
  ADD COLUMN address    text,
  ADD COLUMN phone      text,
  ADD COLUMN email      text,
  ADD COLUMN iban       text,
  ADD COLUMN is_default boolean NOT NULL DEFAULT false,
  ADD COLUMN active     boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX companies_default_uq ON companies (tenant_id) WHERE is_default;
UPDATE companies c SET is_default = true
WHERE id = (SELECT id FROM companies c2 WHERE c2.tenant_id = c.tenant_id ORDER BY created_at LIMIT 1);

-- Invitations: a one-time link to set a password (token stored hashed only)
CREATE TABLE invitations (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_user_idx ON invitations (tenant_id, user_id);
CREATE INDEX invitations_inviter_fk ON invitations (invited_by) WHERE invited_by IS NOT NULL;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON invitations TO softify_app;

-- Users who were invited but have not set a password yet
ALTER TABLE users ADD COLUMN password_set boolean NOT NULL DEFAULT true;
ALTER TABLE memberships ADD COLUMN last_seen_at timestamptz;

-- Audit log of administrative changes
CREATE TABLE audit_log (
  id         uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,              -- e.g. settings.update, user.invite, product.create
  entity     text,                       -- human-readable target
  details    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_idx ON audit_log (tenant_id, created_at DESC, id DESC);
CREATE INDEX audit_log_actor_fk ON audit_log (actor_id) WHERE actor_id IS NOT NULL;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT ON audit_log TO softify_app;

-- The app role sees and edits only its own tenant row and memberships (writes are role-checked in the API).
-- Login and the tenant switcher read across tenants with the owner connection, which is not subject to RLS.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants USING (id = app_tenant()) WITH CHECK (id = app_tenant());
GRANT UPDATE (name, legal_name, vat, email, phone, website, address, timezone, currency, default_vat_rate,
              offer_prefix, offer_validity_days, offer_terms, locale, updated_at) ON tenants TO softify_app;

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON memberships USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT INSERT, UPDATE (role, title, last_seen_at), DELETE ON memberships TO softify_app;
