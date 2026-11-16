-- Records that use a list value with different case/accents get the list's exact spelling
-- (so usage counts and renames in Settings → Value lists cover them).
ALTER TABLE customers DISABLE TRIGGER customers_counter;
UPDATE customers c SET address_region = l.name FROM lookup_values l
  WHERE l.tenant_id = c.tenant_id AND l.list = 'prefecture' AND c.address_region IS NOT NULL
    AND c.address_region <> l.name AND search_key(c.address_region) = search_key(l.name);
UPDATE customers c SET category = l.name FROM lookup_values l
  WHERE l.tenant_id = c.tenant_id AND l.list = 'customer_category' AND c.category IS NOT NULL
    AND c.category <> l.name AND search_key(c.category) = search_key(l.name);
UPDATE customers c SET source = l.name FROM lookup_values l
  WHERE l.tenant_id = c.tenant_id AND l.list = 'customer_source' AND c.source IS NOT NULL
    AND c.source <> l.name AND search_key(c.source) = search_key(l.name);
UPDATE customers c SET payment_terms = l.name FROM lookup_values l
  WHERE l.tenant_id = c.tenant_id AND l.list = 'payment_terms' AND c.payment_terms IS NOT NULL
    AND c.payment_terms <> l.name AND search_key(c.payment_terms) = search_key(l.name);
ALTER TABLE customers ENABLE TRIGGER customers_counter;
UPDATE branches b SET region = l.name FROM lookup_values l
  WHERE l.tenant_id = b.tenant_id AND l.list = 'prefecture' AND b.region IS NOT NULL
    AND b.region <> l.name AND search_key(b.region) = search_key(l.name);
UPDATE spaces s SET kind = l.name FROM lookup_values l
  WHERE l.tenant_id = s.tenant_id AND l.list = 'space_kind' AND s.kind IS NOT NULL
    AND s.kind <> l.name AND search_key(s.kind) = search_key(l.name);
