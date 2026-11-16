-- "Customers & stores" and "Stores" views: branch search, sort orders, city facet.

ALTER TABLE branches ADD COLUMN search text GENERATED ALWAYS AS (
  search_key(name || ' ' || coalesce(city, '') || ' ' || coalesce(address, '') || ' ' || coalesce(postal_code, '')
             || ' ' || coalesce(manager_name, ''))
) STORED;
CREATE INDEX branches_search_idx ON branches USING gin (search gin_trgm_ops);

-- Keyset sort orders for the flat store list
CREATE INDEX branches_name_idx   ON branches (tenant_id, name, id);
CREATE INDEX branches_city_idx   ON branches (tenant_id, (coalesce(city, '')), name, id);
CREATE INDEX branches_spaces_idx ON branches (tenant_id, spaces_count DESC, id DESC);
-- City filter: exact match on the normalised city
CREATE INDEX branches_city_key_idx ON branches (tenant_id, (search_key(city)), name, id) WHERE city IS NOT NULL;
