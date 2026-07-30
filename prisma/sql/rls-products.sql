-- RLS for products catalog
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS products_isolation ON products;
CREATE POLICY products_isolation ON products
  USING ("tenantId" = softify_current_tenant_id())
  WITH CHECK ("tenantId" = softify_current_tenant_id());
