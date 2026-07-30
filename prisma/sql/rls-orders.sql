-- RLS for sales orders
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_isolation ON orders;
CREATE POLICY orders_isolation ON orders
  USING ("tenantId" = softify_current_tenant_id())
  WITH CHECK ("tenantId" = softify_current_tenant_id());

DROP POLICY IF EXISTS order_lines_isolation ON order_lines;
CREATE POLICY order_lines_isolation ON order_lines
  USING ("tenantId" = softify_current_tenant_id())
  WITH CHECK ("tenantId" = softify_current_tenant_id());
