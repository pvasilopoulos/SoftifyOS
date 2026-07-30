-- SoftifyOS Phase 0: Row Level Security baseline
-- Uses GUC app.tenant_id. Column names match Prisma defaults (camelCase).

CREATE OR REPLACE FUNCTION softify_current_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '');
$$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_isolation ON tenants;
CREATE POLICY tenants_isolation ON tenants
  USING (id = softify_current_tenant_id())
  WITH CHECK (id = softify_current_tenant_id());

DROP POLICY IF EXISTS memberships_isolation ON memberships;
CREATE POLICY memberships_isolation ON memberships
  USING ("tenantId" = softify_current_tenant_id())
  WITH CHECK ("tenantId" = softify_current_tenant_id());

DROP POLICY IF EXISTS audit_events_isolation ON audit_events;
CREATE POLICY audit_events_isolation ON audit_events
  USING ("tenantId" = softify_current_tenant_id())
  WITH CHECK ("tenantId" = softify_current_tenant_id());

-- users stays without FORCE RLS so login lookup by email works.
-- Tenant-scoped access to users should go through memberships joins.
-- Note: table owner bypasses RLS until FORCE ROW LEVEL SECURITY + non-owner DB role.
