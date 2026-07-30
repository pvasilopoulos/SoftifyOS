-- RLS for master data hierarchy
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_isolation ON customers;
CREATE POLICY customers_isolation ON customers
  USING ("tenantId" = softify_current_tenant_id())
  WITH CHECK ("tenantId" = softify_current_tenant_id());

DROP POLICY IF EXISTS branches_isolation ON branches;
CREATE POLICY branches_isolation ON branches
  USING ("tenantId" = softify_current_tenant_id())
  WITH CHECK ("tenantId" = softify_current_tenant_id());

DROP POLICY IF EXISTS spaces_isolation ON spaces;
CREATE POLICY spaces_isolation ON spaces
  USING ("tenantId" = softify_current_tenant_id())
  WITH CHECK ("tenantId" = softify_current_tenant_id());
