-- RLS for document series / sites / payments
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sites_isolation ON sites;
CREATE POLICY sites_isolation ON sites
  USING ("tenantId" = softify_current_tenant_id())
  WITH CHECK ("tenantId" = softify_current_tenant_id());

DROP POLICY IF EXISTS document_series_isolation ON document_series;
CREATE POLICY document_series_isolation ON document_series
  USING ("tenantId" = softify_current_tenant_id())
  WITH CHECK ("tenantId" = softify_current_tenant_id());

DROP POLICY IF EXISTS invoice_payments_isolation ON invoice_payments;
CREATE POLICY invoice_payments_isolation ON invoice_payments
  USING ("tenantId" = softify_current_tenant_id())
  WITH CHECK ("tenantId" = softify_current_tenant_id());
